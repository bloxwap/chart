/**
 * Candlestick series renderer.
 *
 * @module
 */

import type { SeriesDrawFn } from './types.js';

/**
 * Draws OHLC candles: 1px wick plus a body rect, colored by direction.
 * Wick colors fall back to body colors when left empty.
 */
export const drawCandlesticks: SeriesDrawFn = (ctx, candles, range, timeScale, priceScale, config) => {
  const bodyWidth = Math.max(1, Math.floor(timeScale.barSpacing * 0.7));
  const wickUp = config.wickUpColor !== '' ? config.wickUpColor : config.upColor;
  const wickDown = config.wickDownColor !== '' ? config.wickDownColor : config.downColor;
  for (let i = range.from; i < range.to; i++) {
    const c = candles[i];
    const up = c.close >= c.open;
    const color = up ? config.upColor : config.downColor;
    const wickColor = up ? wickUp : wickDown;
    const x = Math.round(timeScale.indexToX(i, candles.length));
    const yHigh = priceScale.priceToY(c.high);
    const yLow = priceScale.priceToY(c.low);
    const yOpen = priceScale.priceToY(c.open);
    const yClose = priceScale.priceToY(c.close);
    ctx.fillStyle = wickColor;
    ctx.fillRect(x, yHigh, 1, Math.max(1, yLow - yHigh));
    ctx.fillStyle = color;
    const bodyTop = Math.min(yOpen, yClose);
    ctx.fillRect(x - Math.floor(bodyWidth / 2), bodyTop, bodyWidth, Math.max(1, Math.abs(yClose - yOpen)));
  }
};
