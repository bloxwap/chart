/**
 * Hollow candlestick series renderer (TradingView "Hollow candles").
 *
 * @module
 */

import type { SeriesDrawFn } from './types.js';

/**
 * Draws hollow candles. Color follows the previous close (up when
 * `close >= previous close`; the first bar compares with its open) and fill
 * follows the bar itself: filled body when `close < open`, 1px outline when
 * `close >= open`. Wicks stop at a hollow body's outline and take the wick
 * colors (defaulting to the body color); outlines take the border colors
 * (same default). `bodyVisible` gates bodies, `borderVisible` adds outlines
 * to filled bodies, `wickVisible` gates wicks. One stroke per color per frame.
 */
export const drawHollowCandlesticks: SeriesDrawFn = (ctx, candles, range, timeScale, priceScale, config, liveCandle) => {
  const bodyWidth = Math.max(1, Math.floor(timeScale.barSpacing * 0.7));
  const half = Math.floor(bodyWidth / 2);
  ctx.lineWidth = 1;
  let fill: string | undefined;
  for (let pass = 0; pass < 2; pass++) {
    const up = pass === 0;
    const color = up ? config.upColor : config.downColor;
    const wick = (up ? config.wickUpColor : config.wickDownColor) || color;
    ctx.beginPath();
    for (let i = range.from; i < range.to; i++) {
      const c = (i === candles.length - 1 ? liveCandle : undefined) ?? candles[i];
      if ((c.close >= (i > 0 ? candles[i - 1].close : c.open)) !== up) continue;
      const hollow = c.close >= c.open;
      const outlined = config.borderVisible || (hollow && config.bodyVisible);
      const x = Math.round(timeScale.indexToX(i, candles.length));
      const yHigh = priceScale.priceToY(c.high), yLow = priceScale.priceToY(c.low);
      const yOpen = priceScale.priceToY(c.open), yClose = priceScale.priceToY(c.close);
      const top = Math.min(yHigh, yLow), bottom = Math.max(yHigh, yLow);
      const bodyTop = Math.min(yOpen, yClose);
      const height = Math.max(1, Math.abs(yClose - yOpen));
      if (config.wickVisible) {
        if (fill !== wick) ctx.fillStyle = fill = wick;
        if (hollow && outlined) {
          // Keep the hollow interior clear: wick segments above and below only.
          if (bodyTop > top) ctx.fillRect(x, top, 1, bodyTop - top);
          if (bottom > bodyTop + height) ctx.fillRect(x, bodyTop + height, 1, bottom - bodyTop - height);
        } else {
          ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
        }
      }
      if (!hollow && config.bodyVisible) {
        if (fill !== color) ctx.fillStyle = fill = color;
        ctx.fillRect(x - half, bodyTop, bodyWidth, height);
      }
      if (outlined) ctx.rect(x - half + 0.5, bodyTop + 0.5, Math.max(0, bodyWidth - 1), Math.max(0, height - 1));
    }
    ctx.strokeStyle = (up ? config.borderUpColor : config.borderDownColor) || color;
    ctx.stroke();
  }
};
