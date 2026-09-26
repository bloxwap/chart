/**
 * Line series renderer (close prices).
 *
 * @module
 */

import type { SeriesDrawFn } from './types.js';

/** Draws a single stroked polyline through the close prices. */
export const drawLine: SeriesDrawFn = (ctx, candles, range, timeScale, priceScale, config, liveCandle) => {
  if (range.to <= range.from) return;
  ctx.strokeStyle = config.lineColor;
  ctx.lineWidth = config.lineWidth;
  ctx.beginPath();
  let started = false;
  for (let i = range.from; i < range.to; i++) {
    const c = (i === candles.length - 1 ? liveCandle : undefined) ?? candles[i];
    const x = timeScale.indexToX(i, candles.length);
    const y = priceScale.priceToY(c.close);
    if (started) {
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
      started = true;
    }
  }
  ctx.stroke();
};
