/**
 * Series marker layer: circles, squares and arrows pinned above, below or
 * inside bars, with optional captions. Only markers on bars inside (or just
 * beyond) the visible range are visited (binary search by time), so a long
 * order history costs nothing off screen.
 *
 * @module
 */

import type { Canvas2DLike } from '../dom.js';
import type { PriceScale } from '../core/scale.js';
import type { SeriesMarker, SeriesMarkerShape } from '../core/price-lines.js';
import type { RenderView } from './renderer.js';

/** Smallest glyph box in CSS pixels, before the marker's `size` multiplier. */
export const MARKER_MIN_SIZE = 12;
/** Largest glyph box in CSS pixels, before the marker's `size` multiplier. */
export const MARKER_MAX_SIZE = 30;

/** Glyph height relative to the marker box: arrows fill it, round and square glyphs are smaller. */
const SHAPE_SCALE: Readonly<Record<SeriesMarkerShape, number>> = { arrowUp: 1, arrowDown: 1, circle: 0.8, square: 0.7 };

/**
 * Caption half-width allowance in em. Bars up to this far, plus two glyph
 * boxes, beyond either plot edge still paint their markers under the clip,
 * so captions and large glyphs slide in while scrolling instead of popping.
 */
const CAPTION_REACH_EM = 8;

/** Index of the first marker with `time >= time` in a time-sorted list. */
export function firstMarkerAtOrAfter(markers: readonly SeriesMarker[], time: number): number {
  let lo = 0, hi = markers.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (markers[mid]!.time < time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** A marker's size multiplier: 1 when absent or not finite, never negative. */
function sizeFactor(size: number | undefined): number {
  return size !== undefined && Number.isFinite(size) ? Math.max(0, size) : 1;
}

function drawShape(ctx: Canvas2DLike, shape: SeriesMarkerShape, x: number, y: number, size: number): void {
  const half = size / 2;
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.ellipse(x, y, half, half, 0, 0, Math.PI * 2);
  } else if (shape === 'square') {
    ctx.rect(x - half, y - half, size, size);
  } else {
    // Head over the first half, shaft over the second; `dir` points the tip.
    const dir = shape === 'arrowUp' ? -1 : 1;
    const shaft = size / 6;
    ctx.moveTo(x, y + dir * half);
    ctx.lineTo(x + half, y);
    ctx.lineTo(x + shaft, y);
    ctx.lineTo(x + shaft, y - dir * half);
    ctx.lineTo(x - shaft, y - dir * half);
    ctx.lineTo(x - shaft, y);
    ctx.lineTo(x - half, y);
    ctx.closePath();
  }
  ctx.fill();
}

/**
 * Paints `view.markers` in the main pane's frame (inside its clip). A marker
 * belongs to the last displayed bar (`view.displayCandles ?? view.candles`,
 * so Heikin Ashi bars on a `'heikin-ashi'` series, with `view.liveCandle`
 * over the last one) at or before its time. Stacks grow away from
 * the bar per position: `aboveBar` up from the bar's top edge, `belowBar`
 * down from its bottom edge (the high and low swap edges on an inverted
 * scale), `inBar` up from a glyph centered on the close. Line and area series
 * anchor every position at the close. A negative `size` draws nothing; a
 * non-finite one counts as 1.
 */
export function drawMarkers(ctx: Canvas2DLike, view: RenderView, scale: PriceScale): void {
  const markers = view.markers;
  const { range, timeScale } = view, candles = view.displayCandles ?? view.candles;
  if (markers === undefined || markers.length === 0 || range.to <= range.from) return;
  const { theme, series } = view.config;
  const box = Math.min(Math.max(timeScale.barSpacing, MARKER_MIN_SIZE), MARKER_MAX_SIZE);
  const fontSize = theme.fontSize;
  const reach = Math.ceil((box * 2 + fontSize * CAPTION_REACH_EM) / timeScale.barSpacing);
  const from = Math.max(0, range.from - reach);
  const to = Math.min(candles.length, range.to + reach);
  let m = firstMarkerAtOrAfter(markers, candles[from]!.time);
  const end = to < candles.length ? candles[to]!.time : Infinity;
  if (m >= markers.length || markers[m]!.time >= end) return;
  const closeOnly = series.type === 'line' || series.type === 'area';
  ctx.save();
  ctx.font = `${fontSize}px ${theme.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let bar = from;
  let stackBar = -1, above = 0, below = 0, inside = 0, insideBase = 0;
  let x = 0, barTop = 0, barBottom = 0, close = 0;
  for (; m < markers.length && markers[m]!.time < end; m++) {
    const marker = markers[m]!;
    while (bar + 1 < to && candles[bar + 1]!.time <= marker.time) bar++;
    if (bar !== stackBar) {
      stackBar = bar;
      above = below = inside = 0;
      const c = (bar === candles.length - 1 ? view.liveCandle : undefined) ?? candles[bar]!;
      x = timeScale.indexToX(bar, candles.length);
      close = scale.priceToY(c.close);
      const highY = closeOnly ? close : scale.priceToY(c.high);
      const lowY = closeOnly ? close : scale.priceToY(c.low);
      // On-screen extremes, so an inverted scale still keeps glyphs off the bar.
      barTop = Math.min(highY, lowY);
      barBottom = Math.max(highY, lowY);
    }
    const unit = box * sizeFactor(marker.size);
    const size = unit * SHAPE_SCALE[marker.shape];
    const margin = Math.max(unit * 0.1, 3);
    const text = marker.text ?? '';
    const step = size + margin + (text === '' ? 0 : fontSize + margin);
    let y: number, textY: number;
    if (marker.position === 'belowBar') {
      const top = barBottom + margin + below;
      y = top + size / 2;
      textY = top + size + margin + fontSize / 2;
      below += step;
    } else {
      let bottom: number;
      if (marker.position === 'aboveBar') {
        bottom = barTop - margin - above;
        above += step;
      } else {
        // The first in-bar glyph centers on the close; later ones stack above it.
        if (inside === 0) insideBase = close + size / 2;
        bottom = insideBase - inside;
        inside += step;
      }
      y = bottom - size / 2;
      textY = bottom - size - margin - fontSize / 2;
    }
    ctx.fillStyle = marker.color;
    drawShape(ctx, marker.shape, x, y, size);
    if (text !== '') ctx.fillText(text, x, textY);
  }
  ctx.restore();
}
