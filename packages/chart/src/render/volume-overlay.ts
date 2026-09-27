/**
 * Volume overlay: direction-colored bars pinned to the bottom of the main
 * pane and drawn under the series, scaled to the tallest visible bar. It has
 * its own vertical scale, so the price autoscale never sees volume.
 *
 * @module
 */

import type { SeriesConfig } from '../config.js';
import type { Canvas2DLike } from '../dom.js';
import { DOWN_COLOR, UP_COLOR } from '../indicators/types.js';
import type { RenderView } from './renderer.js';

function seriesColor(color: string, series: SeriesConfig): string {
  return color === UP_COLOR ? series.upColor : color === DOWN_COLOR ? series.downColor : color;
}

/** Fills one bar rising from `bottom`; returns the fill style now in effect. */
function paintBar(ctx: Canvas2DLike, fill: string | undefined, color: string, left: number, width: number, bottom: number, height: number): string {
  if (fill !== color) ctx.fillStyle = color;
  ctx.fillRect(left, bottom - height, width, height);
  return color;
}

/**
 * Draws `config.volume` bars in main-pane coordinates (the pane's top-left
 * at 0, 0) over a pane `paneHeight` pixels tall. Bars match the candle body
 * width and read the displayed bars (`view.displayCandles ?? view.candles`),
 * so a Heikin Ashi chart colors them by HA direction like the bars above,
 * and the last bar follows `view.liveCandle` in that same space. Heights are
 * unchanged, since HA bars carry the real volume. Missing, zero and non-finite
 * volumes draw nothing. Bars sharing a pixel column (below 1px bar spacing)
 * collapse to the tallest, so overlaps never compound the alpha. No-op unless
 * `config.volume.overlay` is set with a positive opacity and height; restores
 * `globalAlpha`.
 */
export function drawVolumeOverlay(ctx: Canvas2DLike, view: RenderView, paneHeight: number): void {
  const { volume, series } = view.config;
  if (!volume.overlay) return;
  const opacity = Math.min(1, volume.opacity);
  const fraction = Math.min(1, volume.height);
  if (!(opacity > 0 && fraction > 0)) return;
  const { range, timeScale, liveCandle } = view, candles = view.displayCandles ?? view.candles;
  const last = candles.length - 1;
  let max = 0;
  for (let i = range.from; i < range.to; i++) {
    const v = ((i === last ? liveCandle : undefined) ?? candles[i]).volume ?? 0;
    if (v > max && v < Infinity) max = v;
  }
  if (max === 0) return;
  const scale = paneHeight * fraction / max;
  const width = Math.max(1, Math.floor(timeScale.barSpacing * 0.7));
  const half = Math.floor(width / 2);
  const upColor = seriesColor(volume.upColor, series);
  const downColor = seriesColor(volume.downColor, series);
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * opacity;
  // One pending bar per pixel column, painted when the column changes.
  let fill: string | undefined;
  let colX = Number.NaN;
  let colH = 0;
  let colColor = upColor;
  for (let i = range.from; i < range.to; i++) {
    const c = (i === last ? liveCandle : undefined) ?? candles[i];
    const v = c.volume ?? 0;
    if (!(v > 0 && v < Infinity)) continue;
    const height = Math.max(1, Math.round(v * scale));
    const color = c.close >= c.open ? upColor : downColor;
    const x = Math.round(timeScale.indexToX(i, candles.length));
    if (x === colX) {
      if (height > colH) { colH = height; colColor = color; }
      continue;
    }
    if (colH > 0) fill = paintBar(ctx, fill, colColor, colX - half, width, paneHeight, colH);
    colX = x; colH = height; colColor = color;
  }
  // max > 0 guarantees at least one pending bar.
  paintBar(ctx, fill, colColor, colX - half, width, paneHeight, colH);
  ctx.globalAlpha = alpha;
}
