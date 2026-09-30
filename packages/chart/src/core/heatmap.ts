/**
 * Depth history for the liquidity heatmap: a bounded window of time-bucketed
 * book snapshots plus the pure math the renderer needs (bucket placement on
 * the time axis, intensity normalization). Rendering lives in
 * `render/heatmap.ts`; the snapshots are plain data so a later WebGL2 pass
 * can consume the same window.
 *
 * @module
 */

import type { Candle } from './data.js';
import type { DepthBook, DepthLevel } from './depth.js';

/** Default wall-clock bucket width: at most one retained snapshot per second. */
export const DEFAULT_HEATMAP_BUCKET_MS = 1000;

/** Default retained buckets; at 1s buckets about eight minutes of book history. */
export const DEFAULT_HEATMAP_MAX_BUCKETS = 500;

/** Default levels kept per side per snapshot (best-first). */
export const DEFAULT_HEATMAP_MAX_LEVELS = 50;

/** Default ramp color at zero intensity. */
export const DEFAULT_HEATMAP_COLOR_LOW = '#2962ff';

/** Default ramp color at full intensity. */
export const DEFAULT_HEATMAP_COLOR_HIGH = '#ffd54f';

/** Default peak cell alpha at full intensity. */
export const DEFAULT_HEATMAP_OPACITY = 0.85;

/** Default cell alpha at zero intensity (the ramp fades out entirely). */
export const DEFAULT_HEATMAP_MIN_OPACITY = 0;

/**
 * One color stop of a custom heatmap gradient. A bare color string is placed
 * evenly by its index among the stops; `at` pins a stop to an intensity (0-1).
 * A stop color's own alpha scales the ramp's alpha there, so `rgba(...)`
 * stops can fade parts of the gradient.
 */
export type HeatmapStop = string | { readonly color: string; readonly at?: number };

/** Default intensity curve exponent; below 1 lifts small sizes (sqrt by default). */
export const DEFAULT_HEATMAP_GAMMA = 0.5;

/** One time bucket of the depth history: the newest book of the bucket, trimmed. */
export interface HeatmapSnapshot {
  /** Bucket start, wall clock ms (`floor(time / bucketMs) * bucketMs`). */
  readonly time: number;
  /** Bid levels, best (highest) first, trimmed to the history's `maxLevels`. */
  readonly bids: readonly DepthLevel[];
  /** Ask levels, best (lowest) first, trimmed to the history's `maxLevels`. */
  readonly asks: readonly DepthLevel[];
}

/**
 * A bounded FIFO window of time-bucketed book snapshots. `record` buckets a
 * book by wall clock (`book.time`), keeps the newest book of each bucket, and
 * evicts the oldest bucket past `maxBuckets`, so memory stays at roughly
 * `maxBuckets` × 2 × `maxLevels` level pairs (~50k pairs, well under a
 * megabyte of numbers, with the defaults). Repeat deliveries of one book
 * (same `book.time`, e.g. re-renders that did not change the book) and
 * out-of-order books are ignored.
 */
export class DepthHistory {
  /** Wall-clock bucket width in ms. Applies to newly recorded books; retained buckets keep their original grid. */
  bucketMs: number;
  /** Window capacity in buckets; shrinking it evicts the oldest buckets. */
  maxBuckets: number;
  /** Levels kept per side per snapshot. Applies to newly recorded books. */
  maxLevels: number;
  private snapshots: HeatmapSnapshot[] = [];
  /** `book.time` of the last recorded book. */
  private lastBookTime = -Infinity;

  constructor(options: { bucketMs?: number; maxBuckets?: number; maxLevels?: number } = {}) {
    this.bucketMs = Math.max(1, Math.floor(options.bucketMs ?? DEFAULT_HEATMAP_BUCKET_MS));
    this.maxBuckets = Math.max(1, Math.floor(options.maxBuckets ?? DEFAULT_HEATMAP_MAX_BUCKETS));
    this.maxLevels = Math.max(1, Math.floor(options.maxLevels ?? DEFAULT_HEATMAP_MAX_LEVELS));
  }

  /** Retained bucket count. */
  get length(): number {
    return this.snapshots.length;
  }

  /** Bucket `index`, oldest first; undefined outside the window. */
  at(index: number): HeatmapSnapshot | undefined {
    return this.snapshots[index];
  }

  /** Start of the bucket containing `timeMs`. */
  bucketStart(timeMs: number): number {
    return Math.floor(timeMs / this.bucketMs) * this.bucketMs;
  }

  /** Index of the first bucket starting at or after `timeMs` (the length when none is). */
  firstAtOrAfter(timeMs: number): number {
    let lo = 0;
    let hi = this.snapshots.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.snapshots[mid]!.time < timeMs) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /**
   * Folds `book` into its time bucket, replacing the bucket's previous
   * snapshot when the book is newer. Returns whether the window changed.
   */
  record(book: DepthBook | null): boolean {
    if (book === null || !Number.isFinite(book.time) || book.time <= this.lastBookTime) return false;
    const start = this.bucketStart(book.time);
    const last = this.snapshots[this.snapshots.length - 1];
    if (last !== undefined && start < last.time) return false;
    const bids = trimLevels(book.bids, this.maxLevels);
    const asks = trimLevels(book.asks, this.maxLevels);
    if (last !== undefined && last.time === start) {
      this.snapshots[this.snapshots.length - 1] = { time: start, bids, asks };
    } else {
      this.snapshots.push({ time: start, bids, asks });
      while (this.snapshots.length > this.maxBuckets) this.snapshots.shift();
    }
    this.lastBookTime = book.time;
    return true;
  }

  /** Applies new grid knobs to future records; shrinking `maxBuckets` evicts the oldest buckets now. */
  configure(options: { bucketMs?: number; maxBuckets?: number; maxLevels?: number }): void {
    if (options.bucketMs !== undefined) this.bucketMs = Math.max(1, Math.floor(options.bucketMs));
    if (options.maxBuckets !== undefined) this.maxBuckets = Math.max(1, Math.floor(options.maxBuckets));
    if (options.maxLevels !== undefined) this.maxLevels = Math.max(1, Math.floor(options.maxLevels));
    while (this.snapshots.length > this.maxBuckets) this.snapshots.shift();
  }

  /** Drops all retained buckets. */
  clear(): void {
    this.snapshots = [];
    this.lastBookTime = -Infinity;
  }
}

/** Best-first valid levels (finite price, positive size), copied and capped. */
function trimLevels(levels: readonly DepthLevel[], maxLevels: number): DepthLevel[] {
  const out: DepthLevel[] = [];
  for (const [price, size] of levels) {
    if (out.length >= maxLevels) break;
    if (Number.isFinite(price) && Number.isFinite(size) && size > 0) out.push([price, size]);
  }
  return out;
}

/**
 * Intensity 0-1 of one level: `(size / max)^gamma`, clamped. Zero when the
 * level or the normalizer is not positive.
 */
export function heatmapIntensity(size: number, max: number, gamma: number): number {
  if (!(size > 0) || !(max > 0)) return 0;
  return Math.min(1, size / max) ** Math.max(0.05, gamma);
}

/**
 * Fractional position of a wall-clock time on the time axis: a fractional
 * bar index in bar-indexed mode (`slots` null), or a fractional slot on a
 * continuous axis, linear in candle time between neighbors (so a gap between
 * two candles spans its full slot count). Past the last candle the position
 * extrapolates along the last interval; before the first candle it is null
 * (off the data's left edge). Convert with
 * `width - (lastUnit - position - scrollOffset) * barSpacing - barSpacing / 2`.
 */
export function heatPosition(candles: readonly Candle[], slots: ArrayLike<number> | null, timeMs: number): number | null {
  const n = candles.length;
  if (n === 0) return null;
  const t = timeMs / 1000;
  if (t < candles[0]!.time) return null;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (candles[mid]!.time <= t) lo = mid;
    else hi = mid - 1;
  }
  if (lo === n - 1) {
    const interval = n > 1 ? candles[n - 1]!.time - candles[n - 2]!.time : 0;
    const extra = interval > 0 ? (t - candles[lo]!.time) / interval : 0;
    // Past the data the axis lays out one slot per bar interval.
    return slots === null ? lo + extra : slots[lo]! + extra;
  }
  const t0 = candles[lo]!.time;
  const t1 = candles[lo + 1]!.time;
  const frac = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  return slots === null ? lo + frac : slots[lo]! + frac * (slots[lo + 1]! - slots[lo]!);
}
