/**
 * Price line layer: horizontal lines across the main plot with a formatted
 * price badge on the axis and, TradingView-style, a title tag inside the
 * plot against the axis edge. Drawn after the built-in price references.
 *
 * @module
 */

import type { Canvas2DLike } from '../dom.js';
import type { RenderView } from './renderer.js';
import { contrastingTextColor } from '../color.js';
import { crisp } from './drawings.js';
import { scaleFont } from './scale-font.js';
import { priceBadgeHeight, priceBadgeTop } from './price-badge.js';

/**
 * Paints `view.priceLines` on the main pane in the renderer's plot frame.
 * Every line is stroked before any label, so labels stay on top; both passes
 * follow creation order. Lines whose price is outside the pane are skipped.
 */
export function drawPriceLines(ctx: Canvas2DLike, view: RenderView): void {
  const lines = view.priceLines;
  const pane = view.panes[0];
  if (lines === undefined || lines.length === 0 || pane === undefined) return;
  const { config, plotWidth } = view;
  const axis = config.priceAxis;
  const scale = pane.priceScale;
  const height = pane.layout.height;
  ctx.save();
  for (const line of lines) {
    const y = scale.priceToY(line.price);
    if (!line.lineVisible || !(y >= 0 && y <= height)) continue;
    const snapped = crisp(y, line.lineWidth, view.pixelRatio);
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.lineWidth;
    ctx.setLineDash(line.dash);
    ctx.beginPath();
    ctx.moveTo(0, snapped);
    ctx.lineTo(plotWidth, snapped);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  // Badges and title tags share the scale font with the built-in price badges.
  ctx.font = scaleFont(config.theme);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const labelHeight = priceBadgeHeight(config.theme);
  const axisWidth = view.canvasWidth - plotWidth;
  const left = axis.position === 'left';
  for (const line of lines) {
    const y = scale.priceToY(line.price);
    if (!line.axisLabelVisible || !(y >= 0 && y <= height)) continue;
    const top = priceBadgeTop(y, height, labelHeight);
    const fill = line.axisLabelColor || line.color;
    const text = line.axisLabelTextColor || contrastingTextColor(fill, config.theme.background);
    if (axis.visible) {
      const x = left ? -axisWidth : plotWidth;
      ctx.fillStyle = fill;
      ctx.fillRect(x, top, axisWidth, labelHeight);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, top, axisWidth, labelHeight); ctx.clip();
      ctx.fillStyle = text;
      ctx.fillText(scale.format(line.price, config.formatters.price, axis.precision), x + 4, top + labelHeight / 2);
      ctx.restore();
    }
    if (line.title !== '') {
      const width = ctx.measureText(line.title).width + 8;
      const x = left ? 0 : plotWidth - width;
      ctx.fillStyle = fill;
      ctx.fillRect(x, top, width, labelHeight);
      ctx.fillStyle = text;
      ctx.fillText(line.title, x + 4, top + labelHeight / 2);
    }
  }
  ctx.restore();
}
