/**
 * OHLC bar series renderer.
 *
 * @module
 */

import type { SeriesDrawFn } from './types.js';

/** Draws classic OHLC bars: vertical high-low line with open/close ticks. */
export const drawBars: SeriesDrawFn = (ctx, candles, range, timeScale, priceScale, config, liveCandle) => {
  const tick = Math.max(1, Math.floor(timeScale.barSpacing * 0.3));
  ctx.lineWidth = 1;
  for (let i = range.from; i < range.to; i++) {
    const c = (i === candles.length - 1 ? liveCandle : undefined) ?? candles[i];
    ctx.strokeStyle = c.close >= (config.colorByPreviousClose && i > 0 ? candles[i - 1].close : c.open) ? config.upColor : config.downColor;
    const x = Math.round(timeScale.indexToX(i, candles.length)) + 0.5;
    const openY = priceScale.priceToY(c.open), closeY = priceScale.priceToY(c.close);
    ctx.beginPath();
    ctx.moveTo(x, priceScale.priceToY(c.high));
    ctx.lineTo(x, priceScale.priceToY(c.low));
    ctx.moveTo(x - tick, openY);
    ctx.lineTo(x, openY);
    ctx.moveTo(x, closeY);
    ctx.lineTo(x + tick, closeY);
    ctx.stroke();
  }
};
