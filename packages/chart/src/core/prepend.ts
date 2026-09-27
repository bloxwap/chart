/**
 * Pure helpers behind {@link Chart.prependData}: picking the history rows that
 * go in front of the store, and moving index-based drawing points along with
 * the candles they sit on.
 *
 * @module
 */

import type { DrawingPoint } from '../config.js';
import type { Candle } from './data.js';

/** Whether every field a candle is drawn and scaled from is a finite number. */
const drawable = (c: Candle): boolean =>
  Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close);

/**
 * Rows of `candles` strictly older than `firstTime` (all of them when it is
 * undefined), deduped by `time` with the last row winning and sorted
 * ascending. Rows with a non-finite time, open, high, low or close are dropped
 * (before deduping, so they never displace a valid row).
 */
export function olderCandles(candles: readonly Candle[], firstTime: number | undefined): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of candles) {
    if (drawable(candle) && (firstTime === undefined || candle.time < firstTime)) byTime.set(candle.time, candle);
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** `points` with every bar index moved `added` bars to the right (history grew by `added`). */
export function shiftPoints(points: readonly DrawingPoint[], added: number): DrawingPoint[] {
  return points.map((p) => ({ ...p, index: p.index + added }));
}
