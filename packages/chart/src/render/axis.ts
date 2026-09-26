/**
 * Axis tick selection and label drawing for the price (right) and time
 * (bottom) axes. Label fonts come from the consolidated config
 * (`theme.monoFamily` / `theme.fontSize`), computed by the renderer.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { TimeScale, VisibleRange } from '../core/scale.js';
import type { Canvas2DLike } from '../dom.js';

/**
 * Picks up to `count` evenly spaced candle indices inside `range`.
 * Always includes the first visible index when the range is non-empty.
 */
export function timeTickIndices(range: VisibleRange, count: number): number[] {
  const span = range.to - range.from;
  if (span <= 0 || count <= 0) return [];
  const step = Math.max(1, Math.floor(span / count));
  const indices: number[] = [];
  for (let i = range.from; i < range.to; i += step) indices.push(i);
  return indices;
}

/**
 * Draws time axis labels for the given tick indices along the bottom edge,
 * using the mono `font` (e.g. `12px "Geist Mono"`).
 */
export function drawTimeAxis(
  ctx: Canvas2DLike,
  candles: readonly Candle[],
  indices: readonly number[],
  timeScale: TimeScale,
  axisY: number,
  formatter: (timestamp: number) => string,
  textColor: string,
  font: string,
): void {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const i of indices) {
    const candle = candles[i];
    if (candle === undefined) continue;
    ctx.fillText(formatter(candle.time), timeScale.indexToX(i, candles.length), axisY + 4);
  }
  ctx.restore();
}
