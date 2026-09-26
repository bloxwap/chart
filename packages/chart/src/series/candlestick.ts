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
export const drawCandlesticks: SeriesDrawFn = (ctx, candles, range, timeScale, priceScale, config, liveCandle) => {
  const bodyWidth = Math.max(1, Math.floor(timeScale.barSpacing * 0.7));
  const wickUp = config.wickUpColor !== '' ? config.wickUpColor : config.upColor;
  const wickDown = config.wickDownColor !== '' ? config.wickDownColor : config.downColor;
  for (let i = range.from; i < range.to; i++) {
    const c = (i === candles.length - 1 ? liveCandle : undefined) ?? candles[i];
    const up = c.close >= (config.colorByPreviousClose && i > 0 ? candles[i - 1].close : c.open);
    const color = up ? config.upColor : config.downColor;
    const wickColor = up ? wickUp : wickDown;
    const x = Math.round(timeScale.indexToX(i, candles.length));
    const yHigh = priceScale.priceToY(c.high);
    const yLow = priceScale.priceToY(c.low);
    const yOpen = priceScale.priceToY(c.open);
    const yClose = priceScale.priceToY(c.close);
    if (config.wickVisible) {
      ctx.fillStyle = wickColor;
      ctx.fillRect(x, Math.min(yHigh, yLow), 1, Math.max(1, Math.abs(yLow - yHigh)));
    }
    const bodyTop = Math.min(yOpen, yClose);
    const left = x - Math.floor(bodyWidth / 2);
    const height = Math.max(1, Math.abs(yClose - yOpen));
    if (config.bodyVisible) {
      ctx.fillStyle = color;
      ctx.fillRect(left, bodyTop, bodyWidth, height);
    }
    if (config.borderVisible) {
      ctx.strokeStyle = (up ? config.borderUpColor : config.borderDownColor) || color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.rect(left + 0.5, bodyTop + 0.5, Math.max(0, bodyWidth - 1), Math.max(0, height - 1));
      ctx.stroke();
    }
  }
};
