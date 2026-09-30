/**
 * Maintained L2 order book: a snapshot load followed by Binance-style
 * diff-depth deltas, with sequence-gap detection and resync. Deltas arriving
 * while a snapshot is in flight are buffered and drained against it, so no
 * update between the stream's start and the snapshot is lost.
 *
 * @module
 */

import type { DepthBook, DepthLevel } from '../core/depth.js';

/** Deltas buffered while a snapshot is in flight; the oldest is evicted beyond this. */
export const MAX_BUFFERED_DELTAS = 2_000;

/**
 * After a failed snapshot read, ms before the next delta retries it on its
 * own; doubles with each failure in a row. Mirrors the datafeed's
 * `RETRY_BACKOFF_MS`.
 */
export const DEPTH_RETRY_BACKOFF_MS = 1_000;

/** Longest wait between snapshot retries, in ms. Mirrors the datafeed's `MAX_RETRY_BACKOFF_MS`. */
export const DEPTH_MAX_RETRY_BACKOFF_MS = 30_000;

/**
 * A Binance-style diff-depth event: the levels changed between
 * `firstUpdateId` and `finalUpdateId` (both inclusive). A level with size 0
 * removes the price from the book.
 */
export interface DepthDelta {
  readonly firstUpdateId: number;
  readonly finalUpdateId: number;
  readonly bids: readonly DepthLevel[];
  readonly asks: readonly DepthLevel[];
  /** Event time in ms; defaults to the manager's clock. */
  readonly time?: number;
}

/**
 * A full L2 book snapshot, sequenced by `lastUpdateId`: every delta with
 * `finalUpdateId` at or below it is already included.
 */
export interface DepthSnapshot {
  readonly lastUpdateId: number;
  readonly bids: readonly DepthLevel[];
  readonly asks: readonly DepthLevel[];
  /** Snapshot time in ms; defaults to the manager's clock. */
  readonly time?: number;
}

/** Loads the book snapshot; called once at creation and again for every gap resync. */
export type FetchDepthSnapshot = () => Promise<DepthSnapshot>;

/** First index of `price` in the sorted side, or -1. */
function levelIndex(side: readonly DepthLevel[], price: number, descending: boolean): number {
  let lo = 0, hi = side.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const p = side[mid]![0];
    if (p === price) return mid;
    if (descending ? p > price : p < price) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Index where `price` belongs in the sorted side. */
function insertionIndex(side: readonly DepthLevel[], price: number, descending: boolean): number {
  let lo = 0, hi = side.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (descending ? side[mid]![0] > price : side[mid]![0] < price) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Applies diff levels to a sorted side in place: a size of 0 removes the
 * price, any other size upserts it. Levels with a non-finite price or size,
 * or a negative size, are ignored.
 */
export function applyDepthLevels(side: DepthLevel[], levels: readonly DepthLevel[], descending: boolean): void {
  for (const level of levels) {
    const [price, size] = level;
    if (!Number.isFinite(price) || !Number.isFinite(size) || size < 0) continue;
    const at = levelIndex(side, price, descending);
    if (size === 0) {
      if (at >= 0) side.splice(at, 1);
    } else if (at >= 0) {
      side[at] = level;
    } else {
      side.splice(insertionIndex(side, price, descending), 0, level);
    }
  }
}

/** A sorted book side from raw levels: invalid and zero sizes dropped, duplicate prices resolved last-wins. */
export function normalizeDepthSide(levels: readonly DepthLevel[], descending: boolean): DepthLevel[] {
  const side: DepthLevel[] = [];
  applyDepthLevels(side, levels, descending);
  return side;
}

/** Options for {@link createDepthBookManager}. */
export interface DepthBookManagerOptions {
  /** Snapshot source, called at creation and on every sequence-gap resync. */
  fetchSnapshot: FetchDepthSnapshot;
  /** Receives each maintained book: the snapshot first, then every applied delta. */
  onBook(book: DepthBook): void;
  /** Wall clock in ms, also timing snapshot-retry backoff; defaults to `Date.now`. */
  now?: () => number;
  /** Cap on deltas buffered while a snapshot is in flight; the oldest is evicted. Defaults to {@link MAX_BUFFERED_DELTAS}. */
  maxBufferedDeltas?: number;
  /** First retry delay (ms) after a failed snapshot read, doubling per failure in a row. Defaults to {@link DEPTH_RETRY_BACKOFF_MS}. */
  retryBackoffMs?: number;
  /** Longest snapshot retry delay (ms). Defaults to {@link DEPTH_MAX_RETRY_BACKOFF_MS}. */
  maxRetryBackoffMs?: number;
  /**
   * Wraps the synchronous burst of `onBook` calls when a snapshot lands (the
   * snapshot itself, then each buffered delta), e.g. `(run) => chart.batch(run)`
   * for one redraw per resync. Must call `run` synchronously, once. Defaults
   * to calling it directly.
   */
  batch?: (run: () => void) => void;
  /**
   * Receives snapshot read failures (retried with backoff on the next delta)
   * and errors thrown by `onBook` or `batch` while a snapshot settles, which
   * would otherwise be lost in the async settle. An error it throws is dropped.
   */
  onError?(error: unknown): void;
}

/** A maintained L2 book; see {@link createDepthBookManager}. */
export interface DepthBookManager {
  /**
   * Folds one diff-depth event into the book. Until the first snapshot lands
   * the delta is buffered; afterwards a stale one (`finalUpdateId` at or below
   * the book's) is dropped and one covering the next update id is applied. A
   * later one reveals a sequence gap: the book resyncs from a fresh snapshot
   * with the delta (and the ones behind it) buffered for the drain. An event
   * with non-integer ids or `firstUpdateId` above `finalUpdateId` is ignored.
   */
  pushDelta(delta: DepthDelta): void;
  /** The last published book, or null before the first snapshot. */
  readonly book: DepthBook | null;
  /** True while no live book exists: the snapshot is in flight or being retried, or a gap resync is. */
  readonly syncing: boolean;
  /** Stops all publishing, including a snapshot that lands later. Safe inside `onBook`. */
  dispose(): void;
}

/** Default {@link DepthBookManagerOptions.batch}: runs the burst unwrapped. */
function runNow(run: () => void): void {
  run();
}

function isValidDelta(delta: DepthDelta): boolean {
  return Number.isSafeInteger(delta.firstUpdateId) && Number.isSafeInteger(delta.finalUpdateId) &&
    delta.firstUpdateId <= delta.finalUpdateId;
}

/**
 * Creates a manager that keeps an L2 book current from a snapshot plus a
 * diff-depth stream. The first snapshot load starts at once; deltas pushed
 * meanwhile are buffered, then drained against it (dropping events the
 * snapshot already covers). A live delta that does not cover the next update
 * id reveals a gap: the sequence is dropped, a fresh snapshot is read at
 * once, and the buffered deltas drain against it. A gap found while draining
 * means the stream made no progress since the last settle, so the resync
 * waits out the same backoff as a failed read and the next arriving delta
 * drives it — a silent stream cannot tight-loop the source. A failed
 * snapshot read is retried by the next arriving delta after a backoff that
 * doubles per failure (capped at `maxRetryBackoffMs`); there are no timers.
 * A settle's `onBook` burst runs inside `batch`, so a chart can redraw once
 * per resync.
 */
export function createDepthBookManager(options: DepthBookManagerOptions): DepthBookManager {
  const now = options.now ?? Date.now;
  const maxBuffered = options.maxBufferedDeltas ?? MAX_BUFFERED_DELTAS;
  const backoffMs = options.retryBackoffMs ?? DEPTH_RETRY_BACKOFF_MS;
  const maxBackoffMs = options.maxRetryBackoffMs ?? DEPTH_MAX_RETRY_BACKOFF_MS;
  const batch = options.batch ?? runNow;
  const report = (error: unknown): void => {
    try {
      options.onError?.(error);
    } catch {
      // The handler failed too: nowhere left to send it, and nothing awaits the settle.
    }
  };
  let bids: DepthLevel[] = [];
  let asks: DepthLevel[] = [];
  let lastUpdateId: number | null = null;
  let book: DepthBook | null = null;
  let buffered: DepthDelta[] = [];
  let fetching = false;
  let failures = 0;
  let retryAtMs = -Infinity;
  let disposed = false;

  function publish(time?: number): void {
    book = { bids: bids.slice(), asks: asks.slice(), time: time ?? now() };
    options.onBook(book);
  }

  /** Applies one delta against the live book; false reveals a sequence gap. */
  function applyDelta(delta: DepthDelta): boolean {
    if (lastUpdateId === null || delta.finalUpdateId <= lastUpdateId) return true;
    if (delta.firstUpdateId > lastUpdateId + 1) return false;
    applyDepthLevels(bids, delta.bids, true);
    applyDepthLevels(asks, delta.asks, false);
    lastUpdateId = delta.finalUpdateId;
    publish(delta.time);
    return true;
  }

  function buffer(delta: DepthDelta): void {
    buffered.push(delta);
    if (buffered.length > maxBuffered) buffered.shift();
  }

  /** Drops the sequence and resyncs from a fresh snapshot, keeping `delta` and the ones behind it for the drain. */
  function resync(delta?: DepthDelta): void {
    lastUpdateId = null;
    if (delta !== undefined) buffer(delta);
    if (!fetching) void sync();
  }

  /**
   * A gap found while draining means the stream made no progress since the
   * last settle, so reading again at once could tight-loop the source (a
   * silent stream gaps against every snapshot). Back off instead; the next
   * arriving delta drives the read, by which time the snapshot has moved on.
   */
  function resyncAfterBackoff(): void {
    lastUpdateId = null;
    retryAtMs = now() + Math.min(maxBackoffMs, backoffMs * 2 ** failures++);
  }

  /**
   * Applies the deltas buffered during the read; a gap re-queues the rest and
   * resyncs. A throwing `onBook` does not strand the deltas behind it: the
   * first error is rethrown once the drain ends.
   */
  function drain(): void {
    const queued = buffered;
    buffered = [];
    let failure: { readonly error: unknown } | undefined;
    for (let i = 0; i < queued.length; i++) {
      if (disposed) break; // onBook may dispose re-entrantly
      let applied: boolean;
      try {
        applied = applyDelta(queued[i]!);
      } catch (error) {
        // The failed delta already advanced the sequence when its publish threw.
        failure ??= { error };
        continue;
      }
      if (!applied) {
        buffered = queued.slice(i).concat(buffered);
        resyncAfterBackoff();
        break;
      }
    }
    if (failure !== undefined) throw failure.error;
  }

  async function sync(): Promise<void> {
    fetching = true;
    let snapshot: DepthSnapshot;
    try {
      snapshot = await options.fetchSnapshot();
    } catch (error) {
      fetching = false;
      if (disposed) return;
      // A delta storm would otherwise retry a rate-limited source on every event.
      retryAtMs = now() + Math.min(maxBackoffMs, backoffMs * 2 ** failures++);
      report(error);
      return;
    }
    fetching = false;
    if (disposed) return;
    if (!Number.isSafeInteger(snapshot.lastUpdateId) || snapshot.lastUpdateId < 0) {
      retryAtMs = now() + Math.min(maxBackoffMs, backoffMs * 2 ** failures++);
      report(new Error(`chart-ts: depth snapshot lastUpdateId must be a nonnegative safe integer, got ${snapshot.lastUpdateId}`));
      return;
    }
    failures = 0;
    retryAtMs = -Infinity;
    try {
      batch(() => {
        bids = normalizeDepthSide(snapshot.bids, true);
        asks = normalizeDepthSide(snapshot.asks, false);
        lastUpdateId = snapshot.lastUpdateId;
        try {
          publish(snapshot.time);
        } finally {
          // A failed snapshot publish must not strand the buffered deltas.
          drain();
        }
      });
    } catch (error) {
      // Nothing awaits the settle: a throw here would be an unhandled rejection.
      report(error);
    }
  }

  function pushDelta(delta: DepthDelta): void {
    if (disposed || !isValidDelta(delta)) return;
    if (lastUpdateId === null) {
      buffer(delta);
      // Deltas keep arriving, so they drive the retry of a failed read: no timer.
      if (!fetching && now() >= retryAtMs) void sync();
      return;
    }
    if (!applyDelta(delta)) resync(delta);
  }

  void sync();
  return {
    pushDelta,
    get book() {
      return book;
    },
    get syncing() {
      return fetching || lastUpdateId === null;
    },
    dispose() {
      disposed = true;
      buffered = [];
    },
  };
}
