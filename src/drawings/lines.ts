/**
 * Line tools: trend line, ray, info line, extended line, trend angle,
 * horizontal line/ray, vertical line, cross line.
 *
 * @module
 */

import { defineDrawing } from './define.js';
import type { DrawPrimitive } from './types.js';
import {
  duration,
  extendedLine,
  changeText,
  seg,
  text,
  timeAt,
  type FullView,
  type Pt,
} from './geom.js';

/** Price tag pinned to the right edge of the plot at `y`. */
export function priceTag(view: FullView, y: number, price: number): DrawPrimitive {
  return text(view.formatPrice(price), { x: view.width - 2, y }, { align: 'right', bg: true });
}

/** Time tag pinned to the bottom edge of the plot at `x`. */
export function timeTag(view: FullView, x: number, index: number): DrawPrimitive[] {
  const t = timeAt(view.candles, index);
  if (t === null) return [];
  return [text(view.formatTime(t), { x, y: view.height - 2 }, { align: 'center', baseline: 'bottom', bg: true })];
}

/** Trend line (name `'trendline'`, 2 points). */
export const trendlineDrawing = defineDrawing({
  name: 'trendline',
  minPoints: 2,
  build: ([a, b]) => [seg(a!, b!)],
});

/** Ray: starts at the first point and extends through the second to the edge. */
export const rayDrawing = defineDrawing({
  name: 'ray',
  minPoints: 2,
  build: ([a, b], v) => [extendedLine(a!, b!, v, false, true)],
});

/** Extended line: infinite in both directions. */
export const extendedLineDrawing = defineDrawing({
  name: 'extended-line',
  minPoints: 2,
  build: ([a, b], v) => [extendedLine(a!, b!, v, true, true)],
});

/** Screen-space angle of `a → b` in degrees (up is positive). */
export function screenAngle(a: Pt, b: Pt): number {
  return (Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI;
}

/** Info line: a trend line with a stats box (change, %, bars, span, angle). */
export const infoLineDrawing = defineDrawing({
  name: 'info-line',
  minPoints: 2,
  build: ([a, b], v, pts) => {
    const p0 = pts[0]!;
    const p1 = pts[1]!;
    const bars = Math.round(p1.index - p0.index);
    const t0 = timeAt(v.candles, p0.index);
    const t1 = timeAt(v.candles, p1.index);
    const span = t0 !== null && t1 !== null ? `, ${duration(t1 - t0)}` : '';
    const lines = [
      changeText(v, p0.price, p1.price),
      `${bars} bars${span}`,
      `${screenAngle(a!, b!).toFixed(1)}°`,
    ];
    return [
      seg(a!, b!),
      text(lines.join('\n'), { x: b!.x + 8, y: b!.y }, { baseline: 'middle', bg: true, font: 'sans' }),
    ];
  },
});

/** Trend angle: a trend line with a horizontal reference, an angle arc and label. */
export const trendAngleDrawing = defineDrawing({
  name: 'trend-angle',
  minPoints: 2,
  build: ([a, b]) => {
    const deg = screenAngle(a!, b!);
    const r = 40;
    const rad = (deg * Math.PI) / 180;
    // Canvas angles grow clockwise; the arc sweeps from the reference (0) to -rad.
    const start = Math.min(0, -rad);
    const end = Math.max(0, -rad);
    return [
      seg(a!, b!),
      seg(a!, { x: a!.x + r + 16, y: a!.y }, { dash: [4, 4] }),
      { type: 'ellipse', cx: a!.x, cy: a!.y, rx: r, ry: r, start, end },
      text(`${deg.toFixed(2)}°`, { x: a!.x + r + 20, y: a!.y - Math.sign(deg) * 10 }, { font: 'sans' }),
    ];
  },
});

/** Horizontal line across the whole plot with a price tag (name `'hline'`, 1 point). */
export const hlineDrawing = defineDrawing({
  name: 'hline',
  minPoints: 1,
  build: ([a], v, pts) => [seg({ x: 0, y: a!.y }, { x: v.width, y: a!.y }), priceTag(v, a!.y, pts[0]!.price)],
});

/** Horizontal ray: from the point to the right edge, with a price tag. */
export const horizontalRayDrawing = defineDrawing({
  name: 'horizontal-ray',
  minPoints: 1,
  build: ([a], v, pts) => [seg(a!, { x: v.width, y: a!.y }), priceTag(v, a!.y, pts[0]!.price)],
});

/** Vertical line through the whole pane with a time tag. */
export const verticalLineDrawing = defineDrawing({
  name: 'vertical-line',
  minPoints: 1,
  build: ([a], v, pts) => [seg({ x: a!.x, y: 0 }, { x: a!.x, y: v.height }), ...timeTag(v, a!.x, pts[0]!.index)],
});

/** Cross line: horizontal + vertical through one point, with both tags. */
export const crossLineDrawing = defineDrawing({
  name: 'cross-line',
  minPoints: 1,
  build: ([a], v, pts) => [
    seg({ x: 0, y: a!.y }, { x: v.width, y: a!.y }),
    seg({ x: a!.x, y: 0 }, { x: a!.x, y: v.height }),
    priceTag(v, a!.y, pts[0]!.price),
    ...timeTag(v, a!.x, pts[0]!.index),
  ],
});

/** All line tools, in toolbar order. */
export const LINE_DRAWINGS = [
  trendlineDrawing,
  rayDrawing,
  infoLineDrawing,
  extendedLineDrawing,
  trendAngleDrawing,
  hlineDrawing,
  horizontalRayDrawing,
  verticalLineDrawing,
  crossLineDrawing,
] as const;
