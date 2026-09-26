/**
 * Histogram series renderer — candle-direction colored volume-style bars,
 * also used for indicator histogram output (VOL, MACD).
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { PriceScale, TimeScale, VisibleRange } from '../core/scale.js';
import type { SeriesConfig } from '../config.js';
import type { Canvas2DLike } from '../dom.js';
import type { SeriesDrawFn } from './types.js';

/**
 * Draws sparse histogram bars anchored at y = 0 of the price scale.
 * `up[i]` selects `upColor`/`downColor` per bar; null values are skipped.
 */
export function drawHistogramBars(
  ctx: Canvas2DLike,
  values: readonly (number | null)[],
  up: readonly boolean[],
  range: VisibleRange,
  timeScale: TimeScale,
  priceScale: PriceScale,
  upColor: string,
  downColor: string,
): void {
  const barWidth = Math.max(1, Math.floor(timeScale.barSpacing * 0.6));
  const zeroY = priceScale.priceToY(Math.max(priceScale.minPrice, Math.min(priceScale.maxPrice, 0)));
  for (let i = range.from; i < range.to; i++) {
    const v = values[i];
    if (v === null || Number.isNaN(v)) continue;
    ctx.fillStyle = up[i] ? upColor : downColor;
    const x = timeScale.indexToX(i, values.length);
    const y = priceScale.priceToY(v);
    ctx.fillRect(x - barWidth / 2, Math.min(y, zeroY), barWidth, Math.max(1, Math.abs(zeroY - y)));
  }
}

/** Histogram series over candle volumes, colored by candle direction. */
export const drawHistogram: SeriesDrawFn = (
  ctx: Canvas2DLike,
  candles: readonly Candle[],
  range: VisibleRange,
  timeScale: TimeScale,
  priceScale: PriceScale,
  config: SeriesConfig,
) => {
  const values = candles.map((c) => c.volume ?? 0);
  const up = candles.map((c) => c.close >= c.open);
  drawHistogramBars(
    ctx,
    values,
    up,
    range,
    timeScale,
    priceScale,
    config.upColor,
    config.downColor === '' ? config.histogramColor : config.downColor,
  );
};
