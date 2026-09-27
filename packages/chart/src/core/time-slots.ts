/**
 * Time-continuous layout for the {@link TimeScale}: each candle maps to the slot
 * of its timestamp, so market gaps (weekends, halts, missing candles) render as
 * empty space instead of collapsing. Slots are derived on data changes only,
 * incrementally on tail appends, never per frame.
 *
 * @module
 */

import type { TimeScaleConfig } from '../config.js';
import type { Candle } from './data.js';
import type { TimeScale } from './scale.js';

/** Counts candle time deltas and tracks the most common one (ties pick the smaller). */
class DeltaTally {
  private readonly counts = new Map<number, number>();
  private modeCount = 0;
  /** Most common positive delta in seconds; 0 before any. */
  mode = 0;

  clear(): void {
    this.counts.clear();
    this.mode = 0;
    this.modeCount = 0;
  }

  /** Counts `delta` (non-positive deltas are ignored); returns whether the mode changed. */
  add(delta: number): boolean {
    if (!(delta > 0)) return false;
    const count = (this.counts.get(delta) ?? 0) + 1;
    this.counts.set(delta, count);
    if (count < this.modeCount || (count === this.modeCount && delta > this.mode)) return false;
    const changed = delta !== this.mode;
    this.mode = delta;
    this.modeCount = count;
    return changed;
  }
}

/** A usable configured interval, or `null` to infer one. */
function validInterval(ms: number | null): number | null {
  return ms !== null && ms > 0 && ms < Infinity ? ms : null;
}

/** Writes slots `from..length-1`; slot 0 is always 0 and every candle keeps a slot of its own. */
function fillSlots(out: Float64Array, candles: readonly Candle[], intervalMs: number, from: number): void {
  for (let i = Math.max(1, from); i < candles.length; i++) {
    out[i] = Math.max(out[i - 1] + 1, Math.round((candles[i].time - candles[0].time) * 1000 / intervalMs));
  }
}

/**
 * Most common positive delta between consecutive candle times, in milliseconds
 * (ties pick the smaller delta), or `null` without two distinct times.
 */
export function inferIntervalMs(candles: readonly Candle[]): number | null {
  const tally = new DeltaTally();
  for (let i = 1; i < candles.length; i++) tally.add(candles[i].time - candles[i - 1].time);
  return tally.mode > 0 ? tally.mode * 1000 : null;
}

/**
 * Slot per candle for {@link TimeScale.setSlots}: `round((time - firstTime) * 1000 / intervalMs)`,
 * bumped past the previous slot when needed so every candle keeps its own. `intervalMs`
 * defaults to {@link inferIntervalMs}.
 */
export function computeTimeSlots(candles: readonly Candle[], intervalMs: number | null = null): Float64Array {
  const out = new Float64Array(candles.length);
  fillSlots(out, candles, validInterval(intervalMs) ?? inferIntervalMs(candles) ?? 1, 1);
  return out;
}

/** Which change {@link TimeSlotSync.sync} reacts to. */
export type TimeSlotChange = 'data' | 'append' | 'config';

/** Keeps a {@link TimeScale}'s slot map in step with the candles and the `timeScale` config. */
export class TimeSlotSync {
  private buffer = new Float64Array(0);
  private length = 0;
  private intervalMs = 1;
  /** Config interval last applied: `undefined` while bar-indexed, `null` when inferred. */
  private applied: number | null | undefined = undefined;
  private readonly tally = new DeltaTally();

  constructor(private readonly scale: TimeScale) {}

  /**
   * Re-derives the slots after a change: `'data'` for replaced candles, `'append'` after a
   * tail append or last-candle update (O(1) unless the inferred interval changes), and
   * `'config'` for a `timeScale` config edit, which keeps the rightmost visible bar anchored.
   */
  sync(candles: readonly Candle[], config: TimeScaleConfig, change: TimeSlotChange): void {
    const interval = config.continuous ? validInterval(config.intervalMs) : undefined;
    if (change === 'config' && interval === this.applied) return;
    const scale = this.scale;
    const anchor = change === 'config' ? scale.xToFloatIndex(scale.width - scale.barSpacing / 2, candles.length) : 0;
    if (interval === undefined) scale.setSlots(null);
    else if (change !== 'append' || interval !== this.applied || !this.extend(candles)) this.rebuild(candles, interval);
    this.applied = interval;
    if (change === 'config') scale.scrollTo(anchor, candles.length);
  }

  private rebuild(candles: readonly Candle[], interval: number | null): void {
    const n = candles.length;
    this.tally.clear();
    if (interval === null) for (let i = 1; i < n; i++) this.tally.add(candles[i].time - candles[i - 1].time);
    this.intervalMs = interval ?? (this.tally.mode * 1000 || 1);
    if (this.buffer.length < n) this.buffer = new Float64Array(n);
    fillSlots(this.buffer, candles, this.intervalMs, 1);
    this.length = n;
    this.scale.setSlots(this.buffer.subarray(0, n));
  }

  /** Extends the slots by the appended tail candle; false when a full rebuild is needed. */
  private extend(candles: readonly Candle[]): boolean {
    const n = candles.length;
    if (n === this.length) return true;
    if (n !== this.length + 1 || this.length === 0 ||
        (this.applied === null && this.tally.add(candles[n - 1].time - candles[n - 2].time))) return false;
    if (n > this.buffer.length) {
      const grown = new Float64Array(n * 2);
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    fillSlots(this.buffer, candles, this.intervalMs, n - 1);
    this.length = n;
    this.scale.setSlots(this.buffer.subarray(0, n));
    return true;
  }
}
