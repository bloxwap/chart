/**
 * Geometric shape tools: brush, highlighter, arrows, rectangle, rotated
 * rectangle, path, circle, ellipse, polyline, triangle, arc, curve and
 * double curve.
 *
 * @module
 */

import { defineDrawing } from './define.js';
import type { DrawPrimitive } from './types.js';
import { arrowHead, dist, mid, poly, seg, text, type Pt } from './geom.js';

/** Brush: freehand stroke. */
export const brushDrawing = defineDrawing({
  name: 'brush',
  minPoints: 2,
  maxPoints: Infinity,
  freehand: true,
  build: (p) => [poly(p)],
});

/** Highlighter: wide translucent freehand stroke. */
export const highlighterDrawing = defineDrawing({
  name: 'highlighter',
  minPoints: 2,
  maxPoints: Infinity,
  freehand: true,
  build: (p) => [poly(p, { width: 14, alpha: 0.35 })],
});

/** Arrow marker: a filled block arrow from a to b. */
export const arrowMarkerDrawing = defineDrawing({
  name: 'arrow-marker',
  minPoints: 2,
  build: ([a, b]) => {
    const len = dist(a!, b!) || 1;
    const ux = (b!.x - a!.x) / len;
    const uy = (b!.y - a!.y) / len;
    const head = Math.min(24, len * 0.6);
    const shaft = 5;
    const wing = 12;
    const nx = -uy;
    const ny = ux;
    const hx = b!.x - ux * head;
    const hy = b!.y - uy * head;
    return [
      poly(
        [
          { x: a!.x + nx * shaft, y: a!.y + ny * shaft },
          { x: hx + nx * shaft, y: hy + ny * shaft },
          { x: hx + nx * wing, y: hy + ny * wing },
          b!,
          { x: hx - nx * wing, y: hy - ny * wing },
          { x: hx - nx * shaft, y: hy - ny * shaft },
          { x: a!.x - nx * shaft, y: a!.y - ny * shaft },
        ],
        { closed: true, fill: true, fillAlpha: 0.85 },
      ),
    ];
  },
});

/** Arrow: a line with an arrowhead at b. */
export const arrowDrawing = defineDrawing({
  name: 'arrow',
  minPoints: 2,
  build: ([a, b]) => [seg(a!, b!), arrowHead(a!, b!, 10)],
});

/** Block arrow glyph pointing up (`dir = -1`) or down (`dir = 1`) with its tip at `tip`. */
function arrowGlyph(tip: Pt, dir: 1 | -1, color: string): DrawPrimitive {
  const s = -dir;
  return poly(
    [
      tip,
      { x: tip.x + 9, y: tip.y + s * 10 },
      { x: tip.x + 4, y: tip.y + s * 10 },
      { x: tip.x + 4, y: tip.y + s * 22 },
      { x: tip.x - 4, y: tip.y + s * 22 },
      { x: tip.x - 4, y: tip.y + s * 10 },
      { x: tip.x - 9, y: tip.y + s * 10 },
    ],
    { closed: true, fill: color, fillAlpha: 1, color },
  );
}

/** Arrow mark up: a green up arrow under the point, optional caption below. */
export const arrowUpDrawing = defineDrawing({
  name: 'arrow-up',
  minPoints: 1,
  wantsText: true,
  build: ([a], v, _pts, meta) => [
    arrowGlyph({ x: a!.x, y: a!.y + 4 }, -1, v.upColor),
    ...(meta.text === '' ? [] : [text(meta.text, { x: a!.x, y: a!.y + 30 }, { align: 'center', baseline: 'top', color: v.upColor, font: 'sans' })]),
  ],
});

/** Arrow mark down: a red down arrow above the point, optional caption above. */
export const arrowDownDrawing = defineDrawing({
  name: 'arrow-down',
  minPoints: 1,
  wantsText: true,
  build: ([a], v, _pts, meta) => [
    arrowGlyph({ x: a!.x, y: a!.y - 4 }, 1, v.downColor),
    ...(meta.text === '' ? [] : [text(meta.text, { x: a!.x, y: a!.y - 30 }, { align: 'center', baseline: 'bottom', color: v.downColor, font: 'sans' })]),
  ],
});

/** Rectangle (name `'rect'`, 2 points): an axis-aligned box, lightly filled. */
export const rectDrawing = defineDrawing({
  name: 'rect',
  minPoints: 2,
  build: ([a, b]) => [
    {
      type: 'rect',
      x: Math.min(a!.x, b!.x),
      y: Math.min(a!.y, b!.y),
      w: Math.abs(b!.x - a!.x),
      h: Math.abs(b!.y - a!.y),
      fill: true,
    },
  ],
});

/** Rotated rectangle (3 points): side a–b, width to c's perpendicular distance. */
export const rotatedRectDrawing = defineDrawing({
  name: 'rotated-rect',
  minPoints: 3,
  build: ([a, b, c]) => {
    const len = dist(a!, b!) || 1;
    const nx = -(b!.y - a!.y) / len;
    const ny = (b!.x - a!.x) / len;
    const w = (c!.x - b!.x) * nx + (c!.y - b!.y) * ny;
    return [
      poly([a!, b!, { x: b!.x + nx * w, y: b!.y + ny * w }, { x: a!.x + nx * w, y: a!.y + ny * w }], {
        closed: true,
        fill: true,
      }),
    ];
  },
});

/** Path (open-ended): a polyline ending in an arrowhead. */
export const pathDrawing = defineDrawing({
  name: 'path',
  minPoints: 2,
  maxPoints: Infinity,
  build: (p) => [poly(p), arrowHead(p[p.length - 2]!, p[p.length - 1]!, 10)],
});

/** Circle (2 points): center a, radius to b. */
export const circleDrawing = defineDrawing({
  name: 'circle',
  minPoints: 2,
  build: ([a, b]) => {
    const r = dist(a!, b!);
    return [{ type: 'ellipse', cx: a!.x, cy: a!.y, rx: r, ry: r, fill: true }];
  },
});

/** Ellipse (2 points): inscribed in the a–b box. */
export const ellipseDrawing = defineDrawing({
  name: 'ellipse',
  minPoints: 2,
  build: ([a, b]) => {
    const c = mid(a!, b!);
    return [{ type: 'ellipse', cx: c.x, cy: c.y, rx: Math.abs(b!.x - a!.x) / 2, ry: Math.abs(b!.y - a!.y) / 2, fill: true }];
  },
});

/** Polyline (open-ended): a closed, filled polygon. */
export const polylineDrawing = defineDrawing({
  name: 'polyline',
  minPoints: 2,
  maxPoints: Infinity,
  build: (p) => [poly(p, { closed: true, fill: true })],
});

/** Triangle (3 points), filled. */
export const triangleDrawing = defineDrawing({
  name: 'triangle',
  minPoints: 3,
  build: ([a, b, c]) => [poly([a!, b!, c!], { closed: true, fill: true })],
});

/** Cubic control points for the quadratic from `a` to `b` passing through `through` at t = ½. */
export function quadThrough(a: Pt, b: Pt, through: Pt): { c1: Pt; c2: Pt } {
  const ctrl = { x: 2 * through.x - (a.x + b.x) / 2, y: 2 * through.y - (a.y + b.y) / 2 };
  return {
    c1: { x: a.x + ((ctrl.x - a.x) * 2) / 3, y: a.y + ((ctrl.y - a.y) * 2) / 3 },
    c2: { x: b.x + ((ctrl.x - b.x) * 2) / 3, y: b.y + ((ctrl.y - b.y) * 2) / 3 },
  };
}

/** Arc (3 points): from a to b bulging through c, filled against the chord. */
export const arcDrawing = defineDrawing({
  name: 'arc',
  minPoints: 3,
  build: ([a, b, c]) => {
    const { c1, c2 } = quadThrough(a!, b!, c!);
    return [{ type: 'bezier', x1: a!.x, y1: a!.y, cx1: c1.x, cy1: c1.y, cx2: c2.x, cy2: c2.y, x2: b!.x, y2: b!.y, fill: true }];
  },
});

/** Curve (3 points): from a to b through c. */
export const curveDrawing = defineDrawing({
  name: 'curve',
  minPoints: 3,
  build: ([a, b, c]) => {
    const { c1, c2 } = quadThrough(a!, b!, c!);
    return [{ type: 'bezier', x1: a!.x, y1: a!.y, cx1: c1.x, cy1: c1.y, cx2: c2.x, cy2: c2.y, x2: b!.x, y2: b!.y }];
  },
});

/** Double curve (3 points): an S-curve from a to b; c bends the first half, mirrored for the second. */
export const doubleCurveDrawing = defineDrawing({
  name: 'double-curve',
  minPoints: 3,
  build: ([a, b, c]) => {
    const m = mid(a!, b!);
    return [
      { type: 'bezier', x1: a!.x, y1: a!.y, cx1: c!.x, cy1: c!.y, cx2: 2 * m.x - c!.x, cy2: 2 * m.y - c!.y, x2: b!.x, y2: b!.y },
    ];
  },
});

/** All shape tools, in toolbar order. */
export const SHAPE_DRAWINGS = [
  brushDrawing,
  highlighterDrawing,
  arrowMarkerDrawing,
  arrowDrawing,
  arrowUpDrawing,
  arrowDownDrawing,
  rectDrawing,
  rotatedRectDrawing,
  pathDrawing,
  circleDrawing,
  ellipseDrawing,
  polylineDrawing,
  triangleDrawing,
  arcDrawing,
  curveDrawing,
  doubleCurveDrawing,
] as const;
