/**
 * Pure candle helpers shared by the datafeed modules: interval bucketing,
 * tick folding and history normalization. Bucket arithmetic runs in integer
 * milliseconds; candle `time` stays in UNIX seconds (fractional only for
 * sub-second buckets).
 *
 * @module
 */

import type { Candle } from '../core/data.js';

/** Open time (ms) of the `intervalMs` bucket containing `nowMs`; buckets are epoch-aligned. */
export function bucketStartMs(nowMs: number, intervalMs: number): number {
  return Math.floor(nowMs / intervalMs) * intervalMs;
}

/** A candle's open time in whole milliseconds, exact for any `time` produced from integer ms. */
export function candleTimeMs(candle: Candle): number {
  return Math.round(candle.time * 1000);
}

/**
 * Folds a tick into `bar`, or opens a later bucket at the previous close (its
 * high/low include that close; volume restarts at 0). A tick for the bar's own
 * or an earlier bucket updates high/low/close in place and keeps the volume.
 * The caller supplies `bucketMs`; skipped buckets are not filled.
 */
export function applyTick(bar: Candle, price: number, bucketMs: number): Candle {
  if (bucketMs > candleTimeMs(bar)) {
    return {
      time: bucketMs / 1000,
      open: bar.close,
      high: Math.max(bar.close, price),
      low: Math.min(bar.close, price),
      close: price,
      volume: 0,
    };
  }
  return { ...bar, high: Math.max(bar.high, price), low: Math.min(bar.low, price), close: price };
}

/**
 * Cleans a history page: drops rows with a non-finite OHLC or a non-finite /
 * non-positive time, zeroes a missing or non-finite volume, dedupes on `time`
 * with the last row winning, and sorts ascending. Returns fresh candles.
 */
export function normalizeCandles(candles: readonly Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of candles) {
    const { time, open, high, low, close } = candle;
    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) continue;
    if (!Number.isFinite(time) || time <= 0) continue;
    const volume = candle.volume ?? 0;
    byTime.set(time, { time, open, high, low, close, volume: Number.isFinite(volume) ? volume : 0 });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
