/**
 * Fibonacci and Gann tools: retracement, trend-based extension, channel,
 * time zone, speed/resistance fan and arcs, trend-based time, circles,
 * spiral, wedge, pitchfan, Gann box/square/fan.
 *
 * @module
 */

import { defineDrawing } from './define.js';
import type { DrawPrimitive } from './types.js';
import {
  TAU,
  dist,
  extendedLine,
  levelColor,
  mid,
  poly,
  ratio,
  seg,
  spansPlot,
  text,
  type FullView,
  type Pt,
} from './geom.js';
import { offsetFromLine } from './channels.js';

/** The retracement levels drawn, in order (0 at the second point). */
export const FIB_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Extension levels for trend-based extensions and fib channels. */
export const FIB_EXTENSION_LEVELS: readonly number[] = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236];

/** Fibonacci numbers used by the time zone tool. */
export const FIB_SEQUENCE: readonly number[] = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144];

/** Trend-based fib time ratios. */
export const FIB_TIME_LEVELS: readonly number[] = [0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.382, 2.618, 3, 3.618, 4.236];

/** Fan/arc/circle ratios. */
export const FIB_FAN_LEVELS: readonly number[] = [0.236, 0.382, 0.5, 0.618, 0.786, 1];

/** Gann box/square grid ratios. */
export const GANN_LEVELS: readonly number[] = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];

/** Gann fan price/time ratios, steepest first. */
export const GANN_FAN_RATIOS: readonly (readonly [number, string])[] = [
  [8, '8/1'],
  [4, '4/1'],
  [3, '3/1'],
  [2, '2/1'],
  [1, '1/1'],
  [1 / 2, '1/2'],
  [1 / 3, '1/3'],
  [1 / 4, '1/4'],
  [1 / 8, '1/8'],
];

/**
 * Horizontal level stack between `left` and `right`: filled bands between
 * consecutive levels, colored level lines, and `ratio (price)` labels.
 */
function levelStack(
  view: FullView,
  levels: readonly number[],
  yOf: (level: number) => number,
  priceOf: (level: number) => number,
  left: number,
  right: number,
): DrawPrimitive[] {
  const out: DrawPrimitive[] = [];
  // Labels sit left of the levels; while those are on screen they slide in rather than clip at the plot's edge.
  const inside = spansPlot(left, right, view.width);
  for (let i = 0; i < levels.length - 1; i++) {
    const y0 = yOf(levels[i]!);
    const y1 = yOf(levels[i + 1]!);
    out.push({
      type: 'rect',
      x: left,
      y: Math.min(y0, y1),
      w: right - left,
      h: Math.abs(y1 - y0),
      fill: levelColor(i + 1),
      fillAlpha: 0.1,
      noStroke: true,
    });
  }
  levels.forEach((level, i) => {
    const y = yOf(level);
    const color = levelColor(i);
    out.push(seg({ x: left, y }, { x: right, y }, { color }));
    out.push(
      text(`${ratio(level)} (${view.formatPrice(priceOf(level))})`, { x: left - 4, y }, { align: 'right', color, inside }),
    );
  });
  return out;
}

/** Fibonacci retracement (name `'fib'`, 2 points): level 0 at the second point, 1 at the first. */
export const fibDrawing = defineDrawing({
  name: 'fib',
  minPoints: 2,
  build: ([a, b], v, pts) => {
    const pa = pts[0]!.price;
    const pb = pts[1]!.price;
    const priceOf = (l: number): number => pb + (pa - pb) * l;
    return [
      seg(a!, b!, { dash: [4, 4], alpha: 0.6 }),
      ...levelStack(v, FIB_LEVELS, (l) => v.priceToY(priceOf(l)), priceOf, Math.min(a!.x, b!.x), Math.max(a!.x, b!.x)),
    ];
  },
});

/** Trend-based fib extension (3 points): projects the a→b move from c. */
export const fibExtensionDrawing = defineDrawing({
  name: 'fib-extension',
  minPoints: 3,
  build: ([a, b, c], v, pts) => {
    const move = pts[1]!.price - pts[0]!.price;
    const base = pts[2]!.price;
    const priceOf = (l: number): number => base + move * l;
    const left = c!.x;
    const right = c!.x + Math.max(60, Math.abs(b!.x - a!.x));
    return [
      poly([a!, b!, c!], { dash: [4, 4], alpha: 0.6 }),
      ...levelStack(v, FIB_EXTENSION_LEVELS, (l) => v.priceToY(priceOf(l)), priceOf, left, right),
    ];
  },
});

/** Fib channel (3 points): a–b baseline, width set by c, levels extended right. */
export const fibChannelDrawing = defineDrawing({
  name: 'fib-channel',
  minPoints: 3,
  build: ([a, b, c], v) => {
    const off = offsetFromLine(a!, b!, c!);
    const out: DrawPrimitive[] = [];
    FIB_EXTENSION_LEVELS.slice(0, 7).forEach((level, i) => {
      const s = { x: a!.x, y: a!.y + off * level };
      const e = { x: b!.x, y: b!.y + off * level };
      const color = levelColor(i);
      const line = extendedLine(s, e, v, false, true, { color });
      out.push(line);
      // Left of the level: slides in at the plot's edge while the extended level is on screen.
      out.push(text(ratio(level), { x: s.x - 4, y: s.y }, { align: 'right', color, inside: spansPlot(line.x1, line.x2, v.width) }));
    });
    return out;
  },
});

/** Fib time zones (2 points): verticals at Fibonacci multiples of the a→b bar span. */
export const fibTimeZoneDrawing = defineDrawing({
  name: 'fib-time-zone',
  minPoints: 2,
  build: ([a, b], v, pts) => {
    const step = pts[1]!.index - pts[0]!.index;
    const seq = step === 0 ? [0] : FIB_SEQUENCE;
    const out: DrawPrimitive[] = [];
    seq.forEach((n, i) => {
      const x = v.indexToX(pts[0]!.index + step * n);
      const color = levelColor(i);
      out.push(seg({ x, y: 0 }, { x, y: v.height }, { color }));
      out.push(text(String(n), { x: x + 3, y: v.height - 4 }, { baseline: 'bottom', color, inside: spansPlot(x, x, v.width) }));
    });
    out.push(seg(a!, b!, { dash: [4, 4], alpha: 0.5 }));
    return out;
  },
});

/** Fib speed/resistance fan (2 points): price and time fans from a through the a–b box. */
export const fibSpeedFanDrawing = defineDrawing({
  name: 'fib-speed-fan',
  minPoints: 2,
  build: ([a, b], v) => {
    const out: DrawPrimitive[] = [
      { type: 'rect', x: Math.min(a!.x, b!.x), y: Math.min(a!.y, b!.y), w: Math.abs(b!.x - a!.x), h: Math.abs(b!.y - a!.y), dash: [2, 3], alpha: 0.5 },
    ];
    const inside = spansPlot(a!.x, b!.x, v.width);
    GANN_LEVELS.forEach((level, i) => {
      const color = levelColor(i);
      const py = { x: b!.x, y: b!.y + (a!.y - b!.y) * level };
      const tx = { x: b!.x + (a!.x - b!.x) * level, y: b!.y };
      out.push(extendedLine(a!, py, v, false, true, { color }));
      if (level !== 0) out.push(extendedLine(a!, tx, v, false, true, { color, alpha: 0.7 }));
      out.push(text(ratio(level), { x: b!.x + 4, y: py.y }, { color, inside }));
    });
    return out;
  },
});

/** Trend-based fib time (3 points): verticals at ratios of the a→b span, from c. */
export const fibTimeDrawing = defineDrawing({
  name: 'fib-time',
  minPoints: 3,
  build: ([a, b, c], v, pts) => {
    const span = pts[1]!.index - pts[0]!.index;
    const out: DrawPrimitive[] = [poly([a!, b!, c!], { dash: [4, 4], alpha: 0.5 })];
    FIB_TIME_LEVELS.forEach((level, i) => {
      const x = v.indexToX(pts[2]!.index + span * level);
      const color = levelColor(i);
      out.push(seg({ x, y: 0 }, { x, y: v.height }, { color }));
      out.push(text(ratio(level), { x: x + 3, y: v.height - 4 }, { baseline: 'bottom', color, inside: spansPlot(x, x, v.width) }));
    });
    return out;
  },
});

/** Fib circles (2 points): concentric circles at the midpoint of a–b. */
export const fibCirclesDrawing = defineDrawing({
  name: 'fib-circles',
  minPoints: 2,
  build: ([a, b]) => {
    const c = mid(a!, b!);
    const r = dist(a!, b!) / 2;
    const out: DrawPrimitive[] = [seg(a!, b!, { dash: [4, 4], alpha: 0.5 })];
    [...FIB_FAN_LEVELS, 1.618, 2.618].forEach((level, i) => {
      const color = levelColor(i);
      out.push({ type: 'ellipse', cx: c.x, cy: c.y, rx: r * level, ry: r * level, color });
      out.push(text(ratio(level), { x: c.x + r * level + 3, y: c.y }, { color }));
    });
    return out;
  },
});

/** Fib spiral (2 points): a golden spiral centered on a, passing through b. */
export const fibSpiralDrawing = defineDrawing({
  name: 'fib-spiral',
  minPoints: 2,
  build: ([a, b]) => {
    const r0 = dist(a!, b!);
    const phase = Math.atan2(b!.y - a!.y, b!.x - a!.x);
    const phi = (1 + Math.sqrt(5)) / 2;
    const pts: Pt[] = [];
    for (let theta = -6 * Math.PI; theta <= 2 * Math.PI; theta += Math.PI / 24) {
      const r = r0 * phi ** ((theta * 2) / Math.PI);
      pts.push({ x: a!.x + r * Math.cos(phase + theta), y: a!.y + r * Math.sin(phase + theta) });
    }
    return [seg(a!, b!, { dash: [4, 4], alpha: 0.5 }), poly(pts)];
  },
});

/** Fib speed/resistance arcs (2 points): half circles around a toward b. */
export const fibSpeedArcsDrawing = defineDrawing({
  name: 'fib-speed-arcs',
  minPoints: 2,
  build: ([a, b]) => {
    const r = dist(a!, b!);
    const up = b!.y <= a!.y;
    const out: DrawPrimitive[] = [seg(a!, b!, { dash: [4, 4], alpha: 0.5 })];
    FIB_FAN_LEVELS.forEach((level, i) => {
      const color = levelColor(i);
      out.push({
        type: 'ellipse',
        cx: a!.x,
        cy: a!.y,
        rx: r * level,
        ry: r * level,
        start: up ? Math.PI : 0,
        end: up ? TAU : Math.PI,
        color,
      });
      out.push(text(ratio(level), { x: a!.x + r * level + 3, y: a!.y }, { color }));
    });
    return out;
  },
});

/** Signed shortest sweep from angle `from` to `to`, in (−π, π]. */
export function sweep(from: number, to: number): number {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d <= -Math.PI) d += TAU;
  return d;
}

/** Fib wedge (3 points): rays a→b, a→c and level arcs between them. */
export const fibWedgeDrawing = defineDrawing({
  name: 'fib-wedge',
  minPoints: 3,
  build: ([a, b, c], v) => {
    const r = dist(a!, b!);
    const ab = Math.atan2(b!.y - a!.y, b!.x - a!.x);
    const d = sweep(ab, Math.atan2(c!.y - a!.y, c!.x - a!.x));
    const start = d >= 0 ? ab : ab + d;
    const out: DrawPrimitive[] = [extendedLine(a!, b!, v, false, true), extendedLine(a!, c!, v, false, true)];
    FIB_FAN_LEVELS.forEach((level, i) => {
      out.push({
        type: 'ellipse',
        cx: a!.x,
        cy: a!.y,
        rx: r * level,
        ry: r * level,
        start,
        end: start + Math.abs(d),
        color: levelColor(i),
      });
    });
    return out;
  },
});

/**
 * Rays from `origin` through each point of `through`, filled between
 * neighbors and labeled; a label whose point is on screen stays whole.
 */
function fanRays(view: FullView, origin: Pt, through: readonly Pt[], labels: readonly string[]): DrawPrimitive[] {
  const rays = through.map((p) => extendedLine(origin, p, view, false, true));
  const out: DrawPrimitive[] = [];
  for (let i = 0; i < rays.length - 1; i++) {
    out.push(
      poly([origin, { x: rays[i]!.x2, y: rays[i]!.y2 }, { x: rays[i + 1]!.x2, y: rays[i + 1]!.y2 }], {
        closed: true,
        fill: levelColor(i + 1),
        fillAlpha: 0.08,
        noStroke: true,
      }),
    );
  }
  rays.forEach((ray, i) => {
    const color = levelColor(i);
    out.push({ ...ray, color });
    // Gated per point: labels sharing a row (a flat b–c, the gann 1×n points) don't pile up at the edge.
    out.push(text(labels[i]!, { x: through[i]!.x + 4, y: through[i]!.y }, { color, size: 10, inside: spansPlot(through[i]!.x, through[i]!.x, view.width) }));
  });
  return out;
}

/** Pitchfan (3 points): fan from a through levels along b–c. */
export const pitchfanDrawing = defineDrawing({
  name: 'pitchfan',
  minPoints: 3,
  build: ([a, b, c], v) => {
    const through = GANN_LEVELS.map((l) => ({ x: b!.x + (c!.x - b!.x) * l, y: b!.y + (c!.y - b!.y) * l }));
    return [seg(b!, c!, { dash: [4, 4], alpha: 0.6 }), ...fanRays(v, a!, through, GANN_LEVELS.map(ratio))];
  },
});

/** Gann box (2 points): price/time grid at Gann ratios plus diagonals. */
export const gannBoxDrawing = defineDrawing({
  name: 'gann-box',
  minPoints: 2,
  build: ([a, b], v) => gannGrid(a!, b!, false, v.width),
});

/**
 * Grid shared by Gann box and squares; `arcs` adds the quarter-circle set.
 * Labels stay within a plot `width` px wide while their line is on screen.
 */
function gannGrid(a: Pt, b: Pt, arcs: boolean, width: number): DrawPrimitive[] {
  const w = b.x - a.x;
  const h = b.y - a.y;
  const out: DrawPrimitive[] = [
    { type: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(w), h: Math.abs(h), fill: true, fillAlpha: 0.05 },
  ];
  GANN_LEVELS.forEach((level, i) => {
    const color = levelColor(i);
    const x = a.x + w * level;
    const y = a.y + h * level;
    out.push(seg({ x, y: a.y }, { x, y: b.y }, { color, alpha: 0.8 }));
    out.push(seg({ x: a.x, y }, { x: b.x, y }, { color, alpha: 0.8 }));
    // Column labels share a row, so each is gated on its own line; row labels on the box.
    out.push(text(ratio(level), { x, y: Math.min(a.y, b.y) - 4 }, { align: 'center', baseline: 'bottom', color, size: 10, inside: spansPlot(x, x, width) }));
    out.push(text(ratio(level), { x: Math.min(a.x, b.x) - 4, y }, { align: 'right', color, size: 10, inside: spansPlot(a.x, b.x, width) }));
  });
  out.push(seg(a, b, { dash: [4, 4] }), seg({ x: a.x, y: b.y }, { x: b.x, y: a.y }, { dash: [4, 4] }));
  if (arcs) {
    for (const [i, level] of [0.25, 0.5, 0.75, 1].entries()) {
      const rx = Math.abs(w) * level;
      const ry = Math.abs(h) * level;
      // Quarter arc from a's corner, opening toward b.
      const sx = w >= 0 ? 1 : -1;
      const sy = h >= 0 ? 1 : -1;
      const start = sx > 0 ? (sy > 0 ? 0 : -Math.PI / 2) : sy > 0 ? Math.PI / 2 : Math.PI;
      out.push({ type: 'ellipse', cx: a.x, cy: a.y, rx, ry, start, end: start + Math.PI / 2, color: levelColor(i + 2) });
    }
    for (const level of [0.25, 0.5, 0.75]) {
      out.push(seg(a, { x: b.x, y: a.y + h * level }, { alpha: 0.5 }));
      out.push(seg(a, { x: a.x + w * level, y: b.y }, { alpha: 0.5 }));
    }
  }
  return out;
}

/** Gann square fixed (2 points): a pixel-square grid with fans and arcs. */
export const gannSquareFixedDrawing = defineDrawing({
  name: 'gann-square-fixed',
  minPoints: 2,
  build: ([a, b], v) => {
    const side = Math.max(Math.abs(b!.x - a!.x), Math.abs(b!.y - a!.y));
    const sb = { x: a!.x + (b!.x >= a!.x ? side : -side), y: a!.y + (b!.y >= a!.y ? side : -side) };
    return gannGrid(a!, sb, true, v.width);
  },
});

/** Gann square (2 points): the square grid stretched to the a–b rectangle. */
export const gannSquareDrawing = defineDrawing({
  name: 'gann-square',
  minPoints: 2,
  build: ([a, b], v) => gannGrid(a!, b!, true, v.width),
});

/** Gann fan (2 points): 1×1 through b, with 8/1 … 1/8 angles. */
export const gannFanDrawing = defineDrawing({
  name: 'gann-fan',
  minPoints: 2,
  build: ([a, b], v) => {
    const w = b!.x - a!.x;
    const h = b!.y - a!.y;
    const through = GANN_FAN_RATIOS.map(([r]) =>
      r >= 1 ? { x: a!.x + w / r, y: b!.y } : { x: b!.x, y: a!.y + h * r },
    );
    return fanRays(v, a!, through, GANN_FAN_RATIOS.map(([, label]) => label));
  },
});

/** All Fibonacci and Gann tools, in toolbar order. */
export const FIB_DRAWINGS = [
  fibDrawing,
  fibExtensionDrawing,
  fibChannelDrawing,
  fibTimeZoneDrawing,
  fibSpeedFanDrawing,
  fibTimeDrawing,
  fibCirclesDrawing,
  fibSpiralDrawing,
  fibSpeedArcsDrawing,
  fibWedgeDrawing,
  pitchfanDrawing,
  gannBoxDrawing,
  gannSquareFixedDrawing,
  gannSquareDrawing,
  gannFanDrawing,
] as const;
