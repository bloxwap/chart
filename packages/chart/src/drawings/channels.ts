/**
 * Channel and pitchfork tools: parallel channel, regression trend, flat
 * top/bottom, disjoint channel, and the four pitchfork variants.
 *
 * @module
 */

import { defineDrawing } from './define.js';
import type { DrawingDef, DrawPrimitive } from './types.js';
import { clampIndex, extendedLine, levelColor, mid, poly, seg, type FullView, type Pt } from './geom.js';

/** Vertical offset of `c` from the line through `a` and `b`, measured at `c.x`. */
export function offsetFromLine(a: Pt, b: Pt, c: Pt): number {
  const dx = b.x - a.x;
  const lineY = dx === 0 ? a.y : a.y + ((b.y - a.y) * (c.x - a.x)) / dx;
  return c.y - lineY;
}

/** Parallel channel: base line a–b plus a copy offset through c, filled between. */
export const parallelChannelDrawing = defineDrawing({
  name: 'parallel-channel',
  minPoints: 3,
  build: ([a, b, c]) => {
    const off = offsetFromLine(a!, b!, c!);
    const a2 = { x: a!.x, y: a!.y + off };
    const b2 = { x: b!.x, y: b!.y + off };
    return [
      poly([a!, b!, b2, a2], { closed: true, fill: true, fillAlpha: 0.1, noStroke: true }),
      seg(a!, b!),
      seg(a2, b2),
      seg(mid(a!, a2), mid(b!, b2), { dash: [4, 4], alpha: 0.6 }),
    ];
  },
});

/** Least-squares fit of closes over `[i0, i1]`: `close ≈ intercept + slope·(i − i0)`. */
export function regression(
  view: FullView,
  i0: number,
  i1: number,
): { slope: number; intercept: number; sigma: number } | null {
  const from = clampIndex(view.candles, Math.min(i0, i1));
  const to = clampIndex(view.candles, Math.max(i0, i1));
  const n = to - from + 1;
  if (from < 0 || n < 2) return null;
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const y = view.candles[from + i]!.close;
    sx += i;
    sy += y;
    sxy += i * y;
    sxx += i * i;
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const r = view.candles[from + i]!.close - (intercept + slope * i);
    ss += r * r;
  }
  return { slope, intercept, sigma: Math.sqrt(ss / n) };
}

/** Regression trend: linear fit of closes with ±2σ deviation bands. */
export const regressionTrendDrawing = defineDrawing({
  name: 'regression-trend',
  minPoints: 2,
  build: ([a, b], v, pts) => {
    const i0 = Math.min(pts[0]!.index, pts[1]!.index);
    const i1 = Math.max(pts[0]!.index, pts[1]!.index);
    const fit = regression(v, i0, i1);
    if (fit === null) return [seg(a!, b!, { dash: [4, 4] })];
    const from = clampIndex(v.candles, i0);
    const to = clampIndex(v.candles, i1);
    const at = (i: number, k: number): Pt => ({
      x: v.indexToX(i),
      y: v.priceToY(fit.intercept + fit.slope * (i - from) + k * fit.sigma),
    });
    const up = [at(from, 2), at(to, 2)];
    const dn = [at(from, -2), at(to, -2)];
    return [
      poly([up[0]!, up[1]!, dn[1]!, dn[0]!], { closed: true, fill: true, fillAlpha: 0.08, noStroke: true }),
      seg(at(from, 0), at(to, 0), { width: 2 }),
      seg(up[0]!, up[1]!, { dash: [6, 4] }),
      seg(dn[0]!, dn[1]!, { dash: [6, 4] }),
    ];
  },
});

/** Flat top/bottom: a sloped line a–b and a flat line at c's price over the same span. */
export const flatTopBottomDrawing = defineDrawing({
  name: 'flat-top-bottom',
  minPoints: 3,
  build: ([a, b, c]) => {
    const fa = { x: a!.x, y: c!.y };
    const fb = { x: b!.x, y: c!.y };
    return [
      poly([a!, b!, fb, fa], { closed: true, fill: true, fillAlpha: 0.1, noStroke: true }),
      seg(a!, b!),
      seg(fa, fb),
    ];
  },
});

/** Disjoint channel: line a–b and a mirror-slope line starting at c. */
export const disjointChannelDrawing = defineDrawing({
  name: 'disjoint-channel',
  minPoints: 3,
  build: ([a, b, c]) => {
    const c2 = { x: b!.x, y: c!.y - (b!.y - a!.y) };
    const c1 = { x: a!.x, y: c!.y };
    return [
      poly([a!, b!, c2, c1], { closed: true, fill: true, fillAlpha: 0.1, noStroke: true }),
      seg(a!, b!),
      seg(c1, c2),
    ];
  },
});

/** Where each pitchfork variant puts its median-line origin. */
export type PitchforkKind = 'standard' | 'schiff' | 'modified-schiff' | 'inside';

/** Median-line origin for a pitchfork variant. */
export function pitchforkOrigin(kind: PitchforkKind, a: Pt, b: Pt, c: Pt): Pt {
  switch (kind) {
    case 'schiff':
      return { x: a.x, y: (a.y + b.y) / 2 };
    case 'modified-schiff':
      return mid(a, b);
    case 'inside':
      return mid(a, mid(b, c));
    default:
      return a;
  }
}

/** Tine offsets along b–c, relative to its midpoint (−1 = b, 1 = c). */
const TINES = [-1, -0.5, 0, 0.5, 1];

function pitchfork(kind: PitchforkKind): (p: Pt[], v: FullView) => DrawPrimitive[] {
  return ([a, b, c], v) => {
    const m = mid(b!, c!);
    const o = pitchforkOrigin(kind, a!, b!, c!);
    const dx = m.x - o.x;
    const dy = m.y - o.y;
    const starts = TINES.map((t) => ({ x: m.x + ((c!.x - b!.x) / 2) * t, y: m.y + ((c!.y - b!.y) / 2) * t }));
    const ends = starts.map((s) => extendedLine(s, { x: s.x + dx, y: s.y + dy }, v, false, true));
    const out: DrawPrimitive[] = [];
    for (let i = 0; i < ends.length - 1; i++) {
      const e0 = ends[i]!;
      const e1 = ends[i + 1]!;
      out.push(
        poly(
          [
            { x: e0.x1, y: e0.y1 },
            { x: e0.x2, y: e0.y2 },
            { x: e1.x2, y: e1.y2 },
            { x: e1.x1, y: e1.y1 },
          ],
          { closed: true, fill: levelColor(i + 1), fillAlpha: 0.08, noStroke: true },
        ),
      );
    }
    out.push(seg(o, m, { dash: [4, 4] }), seg(a!, b!, { alpha: 0.6 }), seg(b!, c!));
    ends.forEach((e, i) => out.push({ ...e, ...(i % 2 === 1 ? { dash: [4, 4], alpha: 0.7 } : {}) }));
    return out;
  };
}

function pitchforkDef(name: string, kind: PitchforkKind): DrawingDef {
  return defineDrawing({ name, minPoints: 3, build: pitchfork(kind) });
}

/** Andrews' pitchfork. */
export const pitchforkDrawing = pitchforkDef('pitchfork', 'standard');
/** Schiff pitchfork: origin raised halfway toward b. */
export const schiffPitchforkDrawing = pitchforkDef('schiff-pitchfork', 'schiff');
/** Modified Schiff pitchfork: origin at the a–b midpoint. */
export const modifiedSchiffPitchforkDrawing = pitchforkDef('modified-schiff-pitchfork', 'modified-schiff');
/** Inside pitchfork: origin halfway between a and the median midpoint. */
export const insidePitchforkDrawing = pitchforkDef('inside-pitchfork', 'inside');

/** All channel and pitchfork tools, in toolbar order. */
export const CHANNEL_DRAWINGS = [
  parallelChannelDrawing,
  regressionTrendDrawing,
  flatTopBottomDrawing,
  disjointChannelDrawing,
  pitchforkDrawing,
  schiffPitchforkDrawing,
  modifiedSchiffPitchforkDrawing,
  insidePitchforkDrawing,
] as const;
