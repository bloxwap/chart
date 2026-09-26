/**
 * Area series renderer (close prices with a translucent fill to the baseline).
 *
 * @module
 */

import { withAlpha } from '../color.js';
import type { SeriesDrawFn } from './types.js';

/** Draws the close line plus a filled area down to the pane bottom. */
export const drawArea: SeriesDrawFn = (ctx, candles, range, timeScale, priceScale, config) => {
  if (range.to <= range.from) return;
  const baseline = priceScale.priceToY(priceScale.minPrice);
  ctx.beginPath();
  let firstX = 0;
  let lastX = 0;
  for (let i = range.from; i < range.to; i++) {
    const c = candles[i];
    const x = timeScale.indexToX(i, candles.length);
    const y = priceScale.priceToY(c.close);
    if (i === range.from) {
      ctx.moveTo(x, y);
      firstX = x;
    } else {
      ctx.lineTo(x, y);
    }
    lastX = x;
  }
  ctx.save();
  ctx.fillStyle = withAlpha(config.areaFillColor, config.areaFillOpacity);
  ctx.lineTo(lastX, baseline);
  ctx.lineTo(firstX, baseline);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = config.lineColor;
  ctx.lineWidth = config.lineWidth;
  ctx.stroke();
};
