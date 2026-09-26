/**
 * Chart pattern, Elliott wave, and cycle tools.
 *
 * @module
 */

import type { DrawingPoint } from '../config.js';
import { defineDrawing } from './define.js';
import type { DrawingDef, DrawPrimitive } from './types.js';
import { extendedLine, mid, poly, ratio, seg, text, type FullView, type Pt } from './geom.js';

/**
 * Label above a peak and below a trough. A point is a peak when it sits
 * higher on screen than its neighbors (endpoints compare to their one
 * neighbor).
 */
export function pivotLabel(p: readonly Pt[], i: number, label: string, style: { circled?: boolean } = {}): DrawPrimitive {
  const cur = p[i]!;
  const prev = p[i - 1];
  const next = p[i + 1];
  const ref = prev !== undefined && next !== undefined ? (prev.y + next.y) / 2 : (prev ?? next ?? cur).y;
  const peak = cur.y <= ref;
  return text(
    label,
    { x: cur.x, y: cur.y + (peak ? -8 : 8) },
    {
      align: 'center',
      baseline: peak ? 'bottom' : 'top',
      font: 'sans',
      bold: true,
      ...(style.circled === true ? { bg: true, radius: 8 } : {}),
    },
  );
}

/** `|p[j] − p[k]| / |p[l] − p[m]|` in price, as a ratio label. */
function priceRatio(pts: readonly DrawingPoint[], j: number, k: number, l: number, m: number): string {
  const den = Math.abs(pts[l]!.price - pts[m]!.price);
  return den === 0 ? '—' : ratio(Math.abs(pts[j]!.price - pts[k]!.price) / den);
}

/** Dashed ratio connector between two pivots with a centered label. */
function ratioLink(a: Pt, b: Pt, label: string): DrawPrimitive[] {
  return [
    seg(a, b, { dash: [4, 4], alpha: 0.7 }),
    text(label, mid(a, b), { align: 'center', bg: true, size: 10 }),
  ];
}

/**
 * Harmonic 5-point pattern. XABCD measures AB/XA, BC/AB, CD/BC, AD/XA;
 * the Cypher measures C against XA and D against XC instead.
 */
function harmonic(name: string, cypher: boolean): DrawingDef {
  return defineDrawing({
    name,
    minPoints: 5,
    build: (p, _v, pts) => {
      const [x, a, b, c, d] = p;
      return [
        poly([x!, a!, b!], { closed: true, fill: true, fillAlpha: 0.15, noStroke: true }),
        poly([b!, c!, d!], { closed: true, fill: true, fillAlpha: 0.15, noStroke: true }),
        poly(p.slice(0, 5)),
        ...ratioLink(x!, b!, priceRatio(pts, 2, 1, 1, 0)),
        ...ratioLink(a!, c!, cypher ? priceRatio(pts, 3, 0, 1, 0) : priceRatio(pts, 3, 2, 2, 1)),
        ...ratioLink(b!, d!, priceRatio(pts, 4, 3, 3, 2)),
        ...ratioLink(x!, d!, cypher ? priceRatio(pts, 4, 3, 3, 0) : priceRatio(pts, 4, 1, 1, 0)),
        ...['X', 'A', 'B', 'C', 'D'].map((l, i) => pivotLabel(p, i, l)),
      ];
    },
  });
}

/** XABCD harmonic pattern (5 points). */
export const xabcdDrawing = harmonic('xabcd', false);
/** Cypher harmonic pattern (5 points). */
export const cypherDrawing = harmonic('cypher', true);

/** ABCD pattern (4 points). */
export const abcdDrawing = defineDrawing({
  name: 'abcd',
  minPoints: 4,
  build: (p, _v, pts) => {
    const [a, b, c, d] = p;
    return [
      poly(p.slice(0, 4)),
      ...ratioLink(a!, c!, priceRatio(pts, 2, 1, 1, 0)),
      ...ratioLink(b!, d!, priceRatio(pts, 3, 2, 2, 1)),
      ...['A', 'B', 'C', 'D'].map((l, i) => pivotLabel(p, i, l)),
    ];
  },
});

/** Triangle pattern (4 points): zigzag with converging a–c and b–d sides. */
export const trianglePatternDrawing = defineDrawing({
  name: 'triangle-pattern',
  minPoints: 4,
  build: (p, v) => {
    const [a, b, c, d] = p;
    return [
      poly([a!, b!, d!, c!], { closed: true, fill: true, fillAlpha: 0.12, noStroke: true }),
      poly(p.slice(0, 4)),
      extendedLine(a!, c!, v, false, true, { dash: [4, 4] }),
      extendedLine(b!, d!, v, false, true, { dash: [4, 4] }),
      ...['A', 'B', 'C', 'D'].map((l, i) => pivotLabel(p, i, l)),
    ];
  },
});

/** Three drives pattern (7 points). */
export const threeDrivesDrawing = defineDrawing({
  name: 'three-drives',
  minPoints: 7,
  build: (p, _v, pts) => [
    poly(p.slice(0, 7)),
    ...ratioLink(p[1]!, p[3]!, priceRatio(pts, 3, 2, 2, 1)),
    ...ratioLink(p[3]!, p[5]!, priceRatio(pts, 5, 4, 4, 3)),
    ...['', 'Drive 1', 'A', 'Drive 2', 'B', 'Drive 3', ''].map((l, i) => pivotLabel(p, i, l)),
  ],
});

/** Head and shoulders (7 points): three humps, neckline through the troughs. */
export const headShouldersDrawing = defineDrawing({
  name: 'head-shoulders',
  minPoints: 7,
  build: (p, v) => [
    poly([p[0]!, p[1]!, p[2]!], { closed: true, fill: true, fillAlpha: 0.12, noStroke: true }),
    poly([p[2]!, p[3]!, p[4]!], { closed: true, fill: true, fillAlpha: 0.18, noStroke: true }),
    poly([p[4]!, p[5]!, p[6]!], { closed: true, fill: true, fillAlpha: 0.12, noStroke: true }),
    poly(p.slice(0, 7)),
    extendedLine(p[2]!, p[4]!, v, true, true, { dash: [6, 4] }),
    pivotLabel(p, 1, 'Left Shoulder'),
    pivotLabel(p, 3, 'Head'),
    pivotLabel(p, 5, 'Right Shoulder'),
  ],
});

function elliott(name: string, labels: readonly string[]): DrawingDef {
  return defineDrawing({
    name,
    minPoints: labels.length,
    build: (p) => [
      poly(p.slice(0, labels.length)),
      ...labels.flatMap((l, i) => (l === '' ? [] : [pivotLabel(p, i, l, { circled: true })])),
    ],
  });
}

/** Elliott impulse wave (12345), 6 points. */
export const elliottImpulseDrawing = elliott('elliott-impulse', ['', '1', '2', '3', '4', '5']);
/** Elliott correction wave (ABC), 4 points. */
export const elliottCorrectionDrawing = elliott('elliott-correction', ['', 'A', 'B', 'C']);
/** Elliott triangle wave (ABCDE), 6 points. */
export const elliottTriangleDrawing = elliott('elliott-triangle', ['', 'A', 'B', 'C', 'D', 'E']);
/** Elliott double combo wave (WXY), 4 points. */
export const elliottDoubleComboDrawing = elliott('elliott-double-combo', ['', 'W', 'X', 'Y']);
/** Elliott triple combo wave (WXYXZ), 6 points. */
export const elliottTripleComboDrawing = elliott('elliott-triple-combo', ['', 'W', 'X', 'Y', 'X', 'Z']);

/** Max repetitions a cycle tool draws per frame. */
const MAX_CYCLES = 400;

/** Integer multiples `k` whose `origin + k·period` falls inside the plot. */
function visibleCycles(v: FullView, originX: number, periodPx: number): number[] {
  const lo = Math.ceil((0 - originX) / periodPx);
  const hi = Math.floor((v.width - originX) / periodPx);
  const out: number[] = [];
  for (let k = Math.max(lo, hi - MAX_CYCLES); k <= hi; k++) out.push(k);
  return out;
}

/** Cyclic lines (2 points): verticals repeating every a→b span across the plot. */
export const cyclicLinesDrawing = defineDrawing({
  name: 'cyclic-lines',
  minPoints: 2,
  build: ([a, b], v) => {
    const period = Math.abs(b!.x - a!.x);
    if (period < 1) return [seg({ x: a!.x, y: 0 }, { x: a!.x, y: v.height })];
    return visibleCycles(v, a!.x, period).map((k) => {
      const x = a!.x + k * period;
      return seg({ x, y: 0 }, { x, y: v.height }, k === 0 || k === 1 ? {} : { dash: [4, 4] });
    });
  },
});

/** Time cycles (2 points): repeating half-ellipses of diameter a→b. */
export const timeCyclesDrawing = defineDrawing({
  name: 'time-cycles',
  minPoints: 2,
  build: ([a, b], v) => {
    const d = Math.abs(b!.x - a!.x);
    if (d < 1) return [seg(a!, b!)];
    const ry = Math.abs(b!.y - a!.y) || d / 2;
    const up = b!.y <= a!.y;
    return visibleCycles(v, a!.x, d).map((k) => ({
      type: 'ellipse' as const,
      cx: a!.x + k * d + d / 2,
      cy: a!.y,
      rx: d / 2,
      ry,
      start: up ? Math.PI : 0,
      end: up ? Math.PI * 2 : Math.PI,
      ...(k === 0 ? { fill: true as const, fillAlpha: 0.1 } : {}),
    }));
  },
});

/** Sine line (2 points): a at a crest/trough, b half a period later. */
export const sineLineDrawing = defineDrawing({
  name: 'sine-line',
  minPoints: 2,
  build: ([a, b], v) => {
    const half = b!.x - a!.x;
    if (Math.abs(half) < 1) return [seg(a!, b!)];
    const amp = (b!.y - a!.y) / 2;
    const cy = (a!.y + b!.y) / 2;
    const pts: Pt[] = [];
    for (let x = 0; x <= v.width; x += 2) {
      pts.push({ x, y: cy - amp * Math.cos((Math.PI * (x - a!.x)) / half) });
    }
    return [poly(pts)];
  },
});

/** All pattern, Elliott and cycle tools, in toolbar order. */
export const PATTERN_DRAWINGS = [
  xabcdDrawing,
  cypherDrawing,
  headShouldersDrawing,
  abcdDrawing,
  trianglePatternDrawing,
  threeDrivesDrawing,
  elliottImpulseDrawing,
  elliottCorrectionDrawing,
  elliottTriangleDrawing,
  elliottDoubleComboDrawing,
  elliottTripleComboDrawing,
  cyclicLinesDrawing,
  timeCyclesDrawing,
  sineLineDrawing,
] as const;
