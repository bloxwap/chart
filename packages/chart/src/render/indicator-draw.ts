/**
 * Indicator output painting: fills, levels, histogram bars and lines (solid,
 * dashed, stepped, dotted, per-index colored, bar-offset), plus the matching
 * autoscale extents. Unstyled lines issue exactly the draw calls of a plain
 * polyline.
 *
 * @module
 */

import type { PriceScale, TimeScale, VisibleRange } from '../core/scale.js';
import type { Canvas2DLike } from '../dom.js';
import type { IndicatorFill, IndicatorLevel, IndicatorLine, IndicatorOutput } from '../indicators/types.js';
import { seriesMinMax } from '../core/scale.js';
import { drawHistogramBars } from '../series/histogram.js';

/** Default dash pattern of {@link IndicatorLevel} lines. */
export const LEVEL_DASH: readonly number[] = [4, 4];

const NO_LINES: readonly IndicatorLine[] = [];

/**
 * Exclusive right edge of the plotted bar indices: `range.to`, extended into
 * the right-side whitespace when the chart is scrolled past the last candle,
 * so offset lines (Ichimoku spans) show there.
 */
export function indicatorRightEdge(range: VisibleRange, timeScale: TimeScale, length: number): number {
  return range.to > range.from ? Math.max(range.to, Math.ceil(length - timeScale.scrollOffset)) : range.to;
}

/** The value a line plots at bar `index` (its `offset` applied). */
export function lineValueAt(line: IndicatorLine, index: number): number | null | undefined {
  return line.values[index - (line.offset ?? 0)];
}

/** The color a line paints at bar `index` (per-index `colors` over `color`). */
export function lineColorAt(line: IndicatorLine, index: number): string {
  return line.colors?.[index - (line.offset ?? 0)] ?? line.color;
}

/** Widens `extent` by `lines` (offsets applied) over bars `[from, to)`. */
function extendByLines(extent: { min: number; max: number }, lines: readonly IndicatorLine[], from: number, to: number): void {
  for (const line of lines) {
    const offset = line.offset ?? 0;
    const mm = seriesMinMax(line.values, from - offset, to - offset);
    if (mm === null) continue;
    if (mm.min < extent.min) extent.min = mm.min;
    if (mm.max > extent.max) extent.max = mm.max;
  }
}

/**
 * Min/max of the lines and fill boundaries (offsets applied) and levels
 * plotted over bars `[from, to)`, or null when nothing is plotted there.
 * Bars are excluded.
 */
export function indicatorMinMax(output: IndicatorOutput, from: number, to: number): { min: number; max: number } | null {
  const extent = { min: Infinity, max: -Infinity };
  extendByLines(extent, output.lines, from, to);
  extendByLines(extent, output.fillLines ?? NO_LINES, from, to);
  for (const level of output.levels ?? []) {
    if (level.value < extent.min) extent.min = level.value;
    if (level.value > extent.max) extent.max = level.value;
  }
  return extent.min <= extent.max ? extent : null;
}

function isValue(value: number | null | undefined): value is number {
  return value != null && !Number.isNaN(value);
}

/** The line a fill boundary `key` names: a stroked line, else a fill-only one. */
function findLine(output: IndicatorOutput, key: string): IndicatorLine | undefined {
  for (const line of output.lines) if (line.key === key) return line;
  for (const line of output.fillLines ?? NO_LINES) if (line.key === key) return line;
  return undefined;
}

/** Strokes a `'line'` or `'step'` plot, restarting the path wherever the color changes. */
function strokeLine(
  ctx: Canvas2DLike, line: IndicatorLine, from: number, to: number,
  length: number, timeScale: TimeScale, priceScale: PriceScale,
): void {
  const { values, colors } = line;
  const offset = line.offset ?? 0;
  const step = line.style === 'step';
  ctx.strokeStyle = line.color;
  ctx.lineWidth = line.lineWidth ?? 1;
  if (line.dash !== undefined) ctx.setLineDash([...line.dash]);
  ctx.beginPath();
  let pen = false;
  let started = false;
  let color = line.color;
  let lastY = 0;
  const end = Math.min(to, values.length + offset);
  for (let p = Math.max(from, offset); p < end; p++) {
    const v = values[p - offset];
    if (v === null || Number.isNaN(v)) {
      pen = false;
      continue;
    }
    if (colors !== undefined) {
      const next = colors[p - offset] ?? line.color;
      if (next !== color) {
        if (started) {
          ctx.stroke();
          ctx.beginPath();
          started = false;
        }
        ctx.strokeStyle = color = next;
        pen = false;
      }
    }
    const x = timeScale.indexToX(p, length);
    const y = priceScale.priceToY(v);
    if (pen) {
      if (step) ctx.lineTo(x, lastY);
      ctx.lineTo(x, y);
    } else {
      ctx.moveTo(x, y);
      pen = true;
      started = true;
    }
    lastY = y;
  }
  ctx.stroke();
  if (line.dash !== undefined) ctx.setLineDash([]);
}

/** Fills one circle per value, batching consecutive same-colored dots into one path. */
function fillDots(
  ctx: Canvas2DLike, line: IndicatorLine, from: number, to: number,
  length: number, timeScale: TimeScale, priceScale: PriceScale,
): void {
  const { values, colors } = line;
  const offset = line.offset ?? 0;
  const radius = (line.lineWidth ?? 1) + 1;
  let color: string | null = null;
  ctx.beginPath();
  const end = Math.min(to, values.length + offset);
  for (let p = Math.max(from, offset); p < end; p++) {
    const v = values[p - offset];
    if (!isValue(v)) continue;
    const next = colors?.[p - offset] ?? line.color;
    if (next !== color) {
      if (color !== null) {
        ctx.fill();
        ctx.beginPath();
      }
      ctx.fillStyle = color = next;
    }
    const x = timeScale.indexToX(p, length);
    const y = priceScale.priceToY(v);
    ctx.moveTo(x + radius, y);
    ctx.ellipse(x, y, radius, radius, 0, 0, Math.PI * 2);
  }
  ctx.fill();
}

/**
 * Fills between two lines, split at crossings so each side takes its own
 * color. A run starts at bar `start` (or at the crossing `(sx, sy)` before
 * it) and ends at bar `end` (or at the crossing `(ex, ey)` after it).
 */
function fillRun(
  ctx: Canvas2DLike, upper: IndicatorLine, lower: IndicatorLine, start: number, end: number,
  sx: number, sy: number, ex: number, ey: number, color: string,
  length: number, timeScale: TimeScale, priceScale: PriceScale,
): void {
  // A single bar without crossings has no area.
  if (start === end && Number.isNaN(sx) && Number.isNaN(ex)) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  let pen = !Number.isNaN(sx);
  if (pen) ctx.moveTo(sx, sy);
  for (let p = start; p <= end; p++) {
    const x = timeScale.indexToX(p, length);
    const y = priceScale.priceToY(lineValueAt(upper, p) as number);
    if (pen) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    pen = true;
  }
  if (!Number.isNaN(ex)) ctx.lineTo(ex, ey);
  for (let p = end; p >= start; p--) {
    ctx.lineTo(timeScale.indexToX(p, length), priceScale.priceToY(lineValueAt(lower, p) as number));
  }
  ctx.closePath();
  ctx.fill();
}

function drawFill(
  ctx: Canvas2DLike, fill: IndicatorFill, upper: IndicatorLine, lower: IndicatorLine,
  from: number, to: number, length: number, timeScale: TimeScale, priceScale: PriceScale,
): void {
  const upperOffset = upper.offset ?? 0;
  const lowerOffset = lower.offset ?? 0;
  const first = Math.max(from, upperOffset, lowerOffset);
  const last = Math.min(to, upper.values.length + upperOffset, lower.values.length + lowerOffset);
  const below = fill.colorBelow ?? fill.color;
  let runStart = -1;
  let sx = NaN, sy = NaN;
  let above = true;
  let prevX = 0, prevA = 0, prevB = 0;
  for (let p = first; p <= last; p++) {
    const a = p < last ? lineValueAt(upper, p) : null;
    const b = p < last ? lineValueAt(lower, p) : null;
    if (!isValue(a) || !isValue(b)) {
      if (runStart >= 0) {
        fillRun(ctx, upper, lower, runStart, p - 1, sx, sy, NaN, NaN, above ? fill.color : below, length, timeScale, priceScale);
      }
      runStart = -1;
      continue;
    }
    const x = timeScale.indexToX(p, length);
    const nowAbove = a >= b;
    if (runStart < 0) {
      runStart = p;
      sx = sy = NaN;
      above = nowAbove;
    } else if (nowAbove !== above) {
      // Lines cross between p - 1 and p: interpolate the meeting point.
      const t = (prevA - prevB) / (prevA - prevB - (a - b));
      const cx = prevX + (x - prevX) * t;
      const cy = priceScale.priceToY(prevA + (a - prevA) * t);
      fillRun(ctx, upper, lower, runStart, p - 1, sx, sy, cx, cy, above ? fill.color : below, length, timeScale, priceScale);
      runStart = p;
      sx = cx;
      sy = cy;
      above = nowAbove;
    }
    prevX = x;
    prevA = a;
    prevB = b;
  }
}

function drawLevel(ctx: Canvas2DLike, level: IndicatorLevel, width: number, priceScale: PriceScale): void {
  const y = priceScale.priceToY(level.value);
  ctx.strokeStyle = level.color;
  ctx.lineWidth = 1;
  ctx.setLineDash([...(level.dash ?? LEVEL_DASH)]);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(width, y);
  ctx.stroke();
}

/**
 * Paints one indicator output in pane coordinates: fills, then levels,
 * histogram bars and lines. `length` is the candle count that anchors bar
 * indices to x.
 */
export function drawIndicator(
  ctx: Canvas2DLike,
  output: IndicatorOutput,
  range: VisibleRange,
  timeScale: TimeScale,
  priceScale: PriceScale,
  length: number,
): void {
  const to = indicatorRightEdge(range, timeScale, length);
  if (output.fills !== undefined) {
    for (const fill of output.fills) {
      const upper = findLine(output, fill.upperKey);
      const lower = findLine(output, fill.lowerKey);
      if (upper !== undefined && lower !== undefined) {
        drawFill(ctx, fill, upper, lower, range.from, to, length, timeScale, priceScale);
      }
    }
  }
  if (output.levels !== undefined) {
    for (const level of output.levels) drawLevel(ctx, level, timeScale.width, priceScale);
    ctx.setLineDash([]);
  }
  if (output.bars !== undefined) {
    drawHistogramBars(
      ctx,
      output.bars.values,
      output.bars.up,
      range,
      timeScale,
      priceScale,
      output.bars.upColor,
      output.bars.downColor,
    );
  }
  for (const line of output.lines) {
    if (line.style === 'dots') fillDots(ctx, line, range.from, to, length, timeScale, priceScale);
    else strokeLine(ctx, line, range.from, to, length, timeScale, priceScale);
  }
}
