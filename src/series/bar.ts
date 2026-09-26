/**
 * OHLC bar series renderer.
 *
 * @module
 */

import type { SeriesDrawFn } from './types.js';

/** Draws classic OHLC bars: vertical high-low line with open/close ticks. */
export const drawBars: SeriesDrawFn = (ctx, candles, range, timeScale, priceScale, config) => {
  const tick = Math.max(1, Math.floor(timeScale.barSpacing * 0.3));
  for (let i = range.from; i < range.to; i++) {
    const c = candles[i];
    ctx.strokeStyle = c.close >= c.open ? config.upColor : config.downColor;
    ctx.lineWidth = 1;
    const x = Math.round(timeScale.indexToX(i, candles.length)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, priceScale.priceToY(c.high));
    ctx.lineTo(x, priceScale.priceToY(c.low));
    ctx.moveTo(x - tick, priceScale.priceToY(c.open));
    ctx.lineTo(x, priceScale.priceToY(c.open));
    ctx.moveTo(x, priceScale.priceToY(c.close));
    ctx.lineTo(x + tick, priceScale.priceToY(c.close));
    ctx.stroke();
  }
};
