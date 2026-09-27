/**
 * Realtime tick folding: mid-price ticks update the forming bar or roll a new
 * bucket; a missed bucket or tick silence backfills history before replaying
 * the ticks buffered meanwhile. Mirrors bloxwap.pro's `LiveBarFolder`.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import { applyTick, bucketStartMs, candleTimeMs, normalizeCandles } from './candles.js';

/** Fetches history bars opening within `[fromMs, toMs]` (both inclusive). */
export type FetchGap = (fromMs: number, toMs: number) => Promise<readonly Candle[]>;

/** Maximum history-window size, in bars, for one gap repair. */
export const MAX_GAP_BARS = 5_000;

/** Tick silence (ms) after which the held bar is repaired from history. */
export const GAP_SILENCE_MS = 8_000;

/** Shorter silence threshold (ms) when a tick rolls a bucket, so a stale close never opens it. */
export const ROLL_SILENCE_MS = 2_000;

/** Cap on ticks buffered while a backfill is in flight; the oldest is evicted. */
export const MAX_PENDING_TICKS = 2_000;

/** Options for {@link createLiveBarFolder}. */
export interface LiveBarFolderOptions {
  /** Bucket width in whole ms (a positive safe integer); buckets open at multiples of it since the epoch. */
  intervalMs: number;
  /** Last history bar, or null when no history landed. */
  seedBar: Candle | null;
  /** Receives each published bar: an in-place update (same `time`) or a new bucket. */
  onBar(bar: Candle): void;
  /** History read for gap repair; without it a gap behaves as an empty backfill. */
  fetchGap?: FetchGap;
  /** Wall clock in ms; defaults to `Date.now`. */
  now?: () => number;
  /** Silence threshold inside a bucket; defaults to {@link GAP_SILENCE_MS}. */
  gapSilenceMs?: number;
  /** Silence threshold for a rolling tick; defaults to {@link ROLL_SILENCE_MS}. */
  rollSilenceMs?: number;
  /**
   * Wraps each gap repair's synchronous burst of `onBar` calls (history bars,
   * then replayed ticks), e.g. `(run) => chart.batch(run)` for one redraw per
   * repair. Must call `run` synchronously, once. Defaults to calling it directly.
   */
  batch?: (run: () => void) => void;
  /**
   * Receives an error thrown by `onBar` (or `batch`) while a gap repair
   * publishes, which would otherwise be lost in the async repair. The repair
   * still completes. Defaults to ignoring it; an error it throws is dropped.
   */
  onError?(error: unknown): void;
}

/** A live bar folder; see {@link createLiveBarFolder}. */
export interface LiveBarFolder {
  /** Folds one mid-price tick; non-finite or non-positive prices are ignored. */
  pushTick(price: number): void;
  /** Alias of {@link LiveBarFolder.pushTick}, for parity with the app class. */
  onPrice(price: number): void;
  /** The bar last published, or the seed. */
  readonly bar: Candle | null;
  /** True while a gap backfill is in flight (ticks are being buffered). */
  readonly filling: boolean;
  /** Stops all publishing, including a backfill that lands later. Safe inside `onBar`. */
  dispose(): void;
}

/** A buffered tick, stamped with the bucket it arrived in. */
interface PendingTick {
  readonly price: number;
  readonly bucketMs: number;
}

/** True when `bucketMs` lies more than one interval after the bar's bucket. */
export function hasMissedBucket(bar: Candle, bucketMs: number, intervalMs: number): boolean {
  return bucketMs - candleTimeMs(bar) > intervalMs;
}

/** Default {@link LiveBarFolderOptions.batch}: runs the burst unwrapped. */
function runNow(run: () => void): void {
  run();
}

/** A flat bar at the tick price with zero volume, opening at `bucketMs`. */
export function seedBarFromTick(price: number, bucketMs: number): Candle {
  return { time: bucketMs / 1000, open: price, high: price, low: price, close: price, volume: 0 };
}

/**
 * Creates a folder that turns mid-price ticks into bars published through
 * `onBar`. Inside the held bucket a tick updates high/low/close; the next
 * bucket opens at the previous close with volume 0. A tick landing a whole
 * bucket late, or after `gapSilenceMs` of silence (`rollSilenceMs` when it
 * rolls), triggers `fetchGap` from the held bar through now: history bars at
 * or after the last published time are applied, then the ticks buffered during
 * the read replay in order, even when the read fails. When nothing was
 * applied, a rolling first tick opens at its own price instead of the stale
 * close; a gap that remains is seeded from the tick. Silence is measured from
 * creation, so a stale seed's first tick is repaired too. A repair's `onBar`
 * burst runs inside `batch`, so a chart can redraw once per repair.
 */
export function createLiveBarFolder(options: LiveBarFolderOptions): LiveBarFolder {
  const intervalMs = options.intervalMs;
  // Bars store seconds and compare in rounded ms, so a fractional width would
  // make every tick in a bucket look like a roll.
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error(`chart-ts: intervalMs must be a positive integer number of ms, got ${intervalMs}`);
  }
  const fetchGap = options.fetchGap;
  const now = options.now ?? Date.now;
  const gapSilenceMs = options.gapSilenceMs ?? GAP_SILENCE_MS;
  const rollSilenceMs = options.rollSilenceMs ?? ROLL_SILENCE_MS;
  const batch = options.batch ?? runNow;
  const report = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // The handler failed too: nowhere left to send it, and nothing awaits the repair.
    }
  };
  let current = options.seedBar;
  let filling = false;
  let pending: PendingTick[] = [];
  let lastTickMs = now();
  let disposed = false;

  function publish(next: Candle): void {
    current = next;
    options.onBar(next);
  }

  /** When `openAtTick`, a rolled bucket opens at the tick instead of the held close. */
  function fold(price: number, bucketMs: number, openAtTick: boolean): void {
    const prev = current;
    if (prev === null || hasMissedBucket(prev, bucketMs, intervalMs) || (openAtTick && bucketMs > candleTimeMs(prev))) {
      publish(seedBarFromTick(price, bucketMs));
      return;
    }
    publish(applyTick(prev, price, bucketMs));
  }

  async function fillGap(read: FetchGap, stale: Candle, nowMs: number): Promise<void> {
    filling = true;
    let candles: readonly Candle[] = [];
    try {
      // Reads are inclusive at both ends, so (N - 1) intervals hold N bars.
      const fromMs = Math.max(candleTimeMs(stale), nowMs - intervalMs * (MAX_GAP_BARS - 1));
      candles = await read(fromMs, nowMs);
    } catch {
      // Replay buffered ticks even when the backfill fails.
    }
    if (disposed) {
      filling = false;
      return;
    }
    try {
      batch(() => settle(candles, stale.time));
    } catch (error) {
      // Nothing awaits the repair: a throw here would be an unhandled rejection.
      report(error);
    }
  }

  /** Applies history at or after `last`, then replays the ticks buffered during the read. */
  function settle(candles: readonly Candle[], last: number): void {
    let repaired = false;
    try {
      // Ticks are buffered meanwhile, so only this loop moves the held bar.
      for (const bar of normalizeCandles(candles)) {
        if (disposed) return; // onBar may dispose re-entrantly
        if (bar.time < last) continue;
        publish(bar);
        last = bar.time;
        repaired = true;
      }
    } catch (error) {
      // As in the app, an onBar failure still replays the buffered ticks.
      report(error);
    } finally {
      filling = false;
      const queued = pending;
      pending = [];
      // With no history applied, the first tick gets the open-at-tick fallback.
      for (const tick of queued) {
        if (disposed) break; // onBar may dispose re-entrantly
        fold(tick.price, tick.bucketMs, !repaired);
        repaired = true;
      }
    }
  }

  function pushTick(price: number): void {
    if (disposed) return;
    if (!Number.isFinite(price) || price <= 0) return;
    const nowMs = now();
    const silentMs = nowMs - lastTickMs;
    lastTickMs = nowMs;
    const bucketMs = bucketStartMs(nowMs, intervalMs);
    if (filling) {
      // Keep recent ticks so forming highs/lows survive the read.
      pending.push({ price, bucketMs });
      if (pending.length > MAX_PENDING_TICKS) pending.shift();
      return;
    }
    const held = current;
    if (held !== null) {
      const rolls = bucketMs > candleTimeMs(held);
      if (hasMissedBucket(held, bucketMs, intervalMs) || silentMs >= (rolls ? rollSilenceMs : gapSilenceMs)) {
        if (fetchGap === undefined) {
          fold(price, bucketMs, true);
          return;
        }
        pending.push({ price, bucketMs });
        void fillGap(fetchGap, held, nowMs);
        return;
      }
    }
    fold(price, bucketMs, false);
  }

  return {
    pushTick,
    onPrice: pushTick,
    get bar() {
      return current;
    },
    get filling() {
      return filling;
    },
    dispose() {
      disposed = true;
      pending = [];
    },
  };
}
