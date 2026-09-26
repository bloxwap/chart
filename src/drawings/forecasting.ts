/**
 * Forecasting and measurement tools: long/short position, forecast, bars
 * pattern, ghost feed, projection, anchored VWAP, fixed range volume
 * profile, price/date/date-and-price range.
 *
 * @module
 */

import type { DrawingPoint } from '../config.js';
import { defineDrawing } from './define.js';
import type { DrawingDef, DrawPrimitive } from './types.js';
import {
  arrowHead,
  clampIndex,
  compact,
  dist,
  duration,
  mid,
  pctChange,
  poly,
  seg,
  signedDelta,
  changeText,
  text,
  timeAt,
  volumeBetween,
  type FullView,
  type Pt,
} from './geom.js';
import { sweep } from './fibonacci.js';

/** Default box width for a position whose target shares the entry bar. */
const MIN_POSITION_WIDTH = 80;

function position(name: string, long: boolean): DrawingDef {
  return defineDrawing({
    name,
    minPoints: 1,
    maxPoints: 2,
    /** Adds a default stop at half the target distance (2:1 reward/risk). */
    normalize: (pts) => {
      const entry = pts[0]!;
      const target = pts[1] ?? { index: entry.index + 20, price: entry.price * (long ? 1.02 : 0.98) };
      const stop = pts[2] ?? { index: target.index, price: entry.price - (target.price - entry.price) / 2 };
      return [entry, target, stop];
    },
    build: ([e, t, s], v, pts) => {
      const entry = pts[0]!.price;
      const target = pts[1]!.price;
      const stop = pts[2]!.price;
      const left = e!.x;
      const right = Math.max(t!.x, s!.x, left + MIN_POSITION_WIDTH);
      const w = right - left;
      const reward = Math.abs(target - entry);
      const risk = Math.abs(stop - entry);
      const rr = risk === 0 ? '∞' : (reward / risk).toFixed(2);
      const cx = left + w / 2;
      const out: DrawPrimitive[] = [
        { type: 'rect', x: left, y: Math.min(e!.y, t!.y), w, h: Math.abs(t!.y - e!.y), fill: v.upColor, fillAlpha: 0.2, noStroke: true },
        { type: 'rect', x: left, y: Math.min(e!.y, s!.y), w, h: Math.abs(s!.y - e!.y), fill: v.downColor, fillAlpha: 0.2, noStroke: true },
        seg({ x: left, y: e!.y }, { x: right, y: e!.y }, { color: '#787b86' }),
        text(`Target: ${v.formatPrice(target)} (${pctChange(entry, target)})`, { x: cx, y: t!.y }, {
          align: 'center',
          baseline: long ? 'bottom' : 'top',
          bg: v.upColor,
          font: 'sans',
        }),
        text(`Stop: ${v.formatPrice(stop)} (${pctChange(entry, stop)})`, { x: cx, y: s!.y }, {
          align: 'center',
          baseline: long ? 'top' : 'bottom',
          bg: v.downColor,
          font: 'sans',
        }),
        text(`${long ? 'Long' : 'Short'} · R/R ${rr}`, { x: cx, y: e!.y }, { align: 'center', bg: '#787b86', font: 'sans' }),
      ];
      // Open P&L from the latest close inside the box's time span.
      const last = clampIndex(v.candles, Math.min(v.candles.length - 1, v.xToIndex(right)));
      if (last >= 0 && last >= pts[0]!.index) {
        const close = v.candles[last]!.close;
        const pnl = long ? close - entry : entry - close;
        out.push(
          text(`P&L ${signedDelta(v, pnl, entry)}`, { x: right + 4, y: v.priceToY(close) }, {
            bg: pnl >= 0 ? v.upColor : v.downColor,
            font: 'sans',
            size: 10,
          }),
        );
      }
      return out;
    },
  });
}

/** Long position (entry, target; stop defaults to 2:1). */
export const longPositionDrawing = position('long-position', true);
/** Short position (entry, target; stop defaults to 2:1). */
export const shortPositionDrawing = position('short-position', false);

/** Forecast (2 points): source → target with change and time labels. */
export const forecastDrawing = defineDrawing({
  name: 'forecast',
  minPoints: 2,
  build: ([a, b], v, pts) => {
    const t = timeAt(v.candles, pts[1]!.index);
    const lines = [
      changeText(v, pts[0]!.price, pts[1]!.price),
      ...(t === null ? [] : [v.formatTime(t)]),
    ];
    return [
      seg(a!, b!, { width: 2 }),
      { type: 'ellipse', cx: a!.x, cy: a!.y, rx: 4, ry: 4, fill: true, fillAlpha: 1 },
      { type: 'ellipse', cx: b!.x, cy: b!.y, rx: 4, ry: 4, fill: true, fillAlpha: 1 },
      seg({ x: b!.x, y: b!.y }, { x: b!.x, y: v.height }, { dash: [3, 3], alpha: 0.5 }),
      text(lines.join('\n'), { x: b!.x + 8, y: b!.y }, { bg: true, font: 'sans' }),
    ];
  },
});

/** One synthetic candle drawn in pixel space. */
function ghostCandle(x: number, bodyW: number, open: number, close: number, high: number, low: number, color: string): DrawPrimitive[] {
  return [
    seg({ x, y: high }, { x, y: low }, { color, alpha: 0.6 }),
    {
      type: 'rect',
      x: x - bodyW / 2,
      y: Math.min(open, close),
      w: bodyW,
      h: Math.max(1, Math.abs(close - open)),
      color,
      fill: color,
      fillAlpha: 0.45,
      alpha: 0.6,
    },
  ];
}

/** Bars pattern (3 points): copies bars a..b so the copy starts at c. */
export const barsPatternDrawing = defineDrawing({
  name: 'bars-pattern',
  minPoints: 3,
  build: ([a, b], v, pts) => {
    const from = clampIndex(v.candles, Math.min(pts[0]!.index, pts[1]!.index));
    const to = clampIndex(v.candles, Math.max(pts[0]!.index, pts[1]!.index));
    if (from < 0) {
      return [{ type: 'rect', x: Math.min(a!.x, b!.x), y: Math.min(a!.y, b!.y), w: Math.abs(b!.x - a!.x), h: Math.abs(b!.y - a!.y), dash: [4, 4] }];
    }
    const shift = pts[2]!.price - v.candles[from]!.open;
    const bodyW = Math.max(1, v.barSpacing * 0.6);
    const out: DrawPrimitive[] = [];
    for (let i = from; i <= to; i++) {
      const c = v.candles[i]!;
      const x = v.indexToX(pts[2]!.index + (i - from));
      out.push(
        ...ghostCandle(
          x,
          bodyW,
          v.priceToY(c.open + shift),
          v.priceToY(c.close + shift),
          v.priceToY(c.high + shift),
          v.priceToY(c.low + shift),
          c.close >= c.open ? v.upColor : v.downColor,
        ),
      );
    }
    return out;
  },
});

/** Ghost feed (open-ended): synthetic candles following the clicked path. */
export const ghostFeedDrawing = defineDrawing({
  name: 'ghost-feed',
  minPoints: 2,
  maxPoints: Infinity,
  build: (_p, v, pts) => {
    const out: DrawPrimitive[] = [];
    const bodyW = Math.max(1, v.barSpacing * 0.6);
    for (let k = 0; k < pts.length - 1; k++) {
      const s = pts[k]!;
      const e = pts[k + 1]!;
      const bars = Math.max(1, Math.round(Math.abs(e.index - s.index)));
      const dir = e.index >= s.index ? 1 : -1;
      let open = s.price;
      for (let j = 1; j <= bars; j++) {
        const close = s.price + ((e.price - s.price) * j) / bars;
        const wick = Math.abs(close - open) * 0.6 + Math.abs(e.price - s.price) * 0.02;
        out.push(
          ...ghostCandle(
            v.indexToX(s.index + dir * j),
            bodyW,
            v.priceToY(open),
            v.priceToY(close),
            v.priceToY(Math.max(open, close) + wick),
            v.priceToY(Math.min(open, close) - wick),
            close >= open ? v.upColor : v.downColor,
          ),
        );
        open = close;
      }
    }
    return out;
  },
});

/** Projection (3 points): legs a→b→c with the c/b move ratio and an arc at b. */
export const projectionDrawing = defineDrawing({
  name: 'projection',
  minPoints: 3,
  build: ([a, b, c], _v, pts) => {
    const leg1 = pts[1]!.price - pts[0]!.price;
    const leg2 = pts[2]!.price - pts[1]!.price;
    const r = dist(b!, c!);
    const from = Math.atan2(a!.y - b!.y, a!.x - b!.x);
    const d = sweep(from, Math.atan2(c!.y - b!.y, c!.x - b!.x));
    const start = d >= 0 ? from : from + d;
    return [
      poly([a!, b!, c!], { closed: true, fill: true, fillAlpha: 0.1, noStroke: true }),
      poly([a!, b!, c!]),
      { type: 'ellipse', cx: b!.x, cy: b!.y, rx: r, ry: r, start, end: start + Math.abs(d), dash: [4, 4] },
      text(`${leg1 === 0 ? '—' : Math.abs(leg2 / leg1).toFixed(3)} (${pctChange(pts[1]!.price, pts[2]!.price)})`, mid(a!, c!), {
        align: 'center',
        bg: true,
        font: 'sans',
      }),
    ];
  },
});

/** Anchored VWAP (1 point): volume-weighted average price from the anchor bar on. */
export const anchoredVwapDrawing = defineDrawing({
  name: 'anchored-vwap',
  minPoints: 1,
  build: ([a], v, pts) => {
    const from = clampIndex(v.candles, pts[0]!.index);
    if (from < 0) return [{ type: 'ellipse', cx: a!.x, cy: a!.y, rx: 4, ry: 4, fill: true, fillAlpha: 1 }];
    let pv = 0;
    let vol = 0;
    const line: Pt[] = [];
    let last = 0;
    for (let i = from; i < v.candles.length; i++) {
      const c = v.candles[i]!;
      const w = c.volume ?? 1;
      pv += ((c.high + c.low + c.close) / 3) * w;
      vol += w;
      last = vol === 0 ? c.close : pv / vol;
      line.push({ x: v.indexToX(i), y: v.priceToY(last) });
    }
    const end = line[line.length - 1]!;
    return [
      poly(line, { width: 2 }),
      { type: 'ellipse', cx: line[0]!.x, cy: line[0]!.y, rx: 3, ry: 3, fill: true, fillAlpha: 1 },
      text(`VWAP ${v.formatPrice(last)}`, { x: end.x + 4, y: end.y }, { bg: true }),
    ];
  },
});

/** Rows in the fixed range volume profile. */
export const VOLUME_PROFILE_ROWS = 24;

/** Per-row up/down volume for bars in `[from, to]`, spread uniformly over each bar's range. */
export function volumeProfile(
  v: FullView,
  from: number,
  to: number,
  rows: number,
): { lo: number; hi: number; up: number[]; down: number[] } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = from; i <= to; i++) {
    lo = Math.min(lo, v.candles[i]!.low);
    hi = Math.max(hi, v.candles[i]!.high);
  }
  const step = (hi - lo) / rows || 1;
  const up = new Array<number>(rows).fill(0);
  const down = new Array<number>(rows).fill(0);
  for (let i = from; i <= to; i++) {
    const c = v.candles[i]!;
    const r0 = Math.min(rows - 1, Math.floor((c.low - lo) / step));
    const r1 = Math.min(rows - 1, Math.floor((c.high - lo) / step));
    const share = (c.volume ?? 0) / (r1 - r0 + 1);
    for (let r = r0; r <= r1; r++) (c.close >= c.open ? up : down)[r]! += share;
  }
  return { lo, hi, up, down };
}

/** Fixed range volume profile (2 points): volume by price over bars a..b, with POC and value area. */
export const volumeProfileDrawing = defineDrawing({
  name: 'volume-profile',
  minPoints: 2,
  build: ([a, b], v, pts) => {
    const left = Math.min(a!.x, b!.x);
    const right = Math.max(a!.x, b!.x);
    const from = clampIndex(v.candles, Math.min(pts[0]!.index, pts[1]!.index));
    const to = clampIndex(v.candles, Math.max(pts[0]!.index, pts[1]!.index));
    const frame: DrawPrimitive = { type: 'rect', x: left, y: Math.min(a!.y, b!.y), w: right - left, h: Math.abs(b!.y - a!.y), dash: [4, 4], alpha: 0.5 };
    if (from < 0) return [frame];
    const prof = volumeProfile(v, from, to, VOLUME_PROFILE_ROWS);
    const totals = prof.up.map((u, i) => u + prof.down[i]!);
    const max = Math.max(...totals) || 1;
    const poc = totals.indexOf(Math.max(...totals));
    // Value area: grow from the POC until 70% of volume is covered.
    const sum = totals.reduce((s, x) => s + x, 0);
    let lo = poc;
    let hi = poc;
    let acc = totals[poc]!;
    while (acc < sum * 0.7 && (lo > 0 || hi < totals.length - 1)) {
      const below = lo > 0 ? totals[lo - 1]! : -1;
      const above = hi < totals.length - 1 ? totals[hi + 1]! : -1;
      if (above >= below) acc += totals[++hi]!;
      else acc += totals[--lo]!;
    }
    const rowH = (prof.hi - prof.lo) / VOLUME_PROFILE_ROWS;
    const width = (right - left) * 0.7;
    const top = v.priceToY(prof.hi);
    const bottom = v.priceToY(prof.lo);
    const out: DrawPrimitive[] = [{ ...frame, y: top, h: bottom - top }];
    totals.forEach((total, r) => {
      const y0 = v.priceToY(prof.lo + rowH * (r + 1));
      const h = Math.max(1, v.priceToY(prof.lo + rowH * r) - y0 - 1);
      const inVa = r >= lo && r <= hi;
      const uw = (prof.up[r]! / max) * width;
      const dw = (prof.down[r]! / max) * width;
      const alpha = inVa ? 0.55 : 0.25;
      if (total > 0) {
        out.push({ type: 'rect', x: left, y: y0, w: uw, h, fill: v.upColor, fillAlpha: alpha, noStroke: true });
        out.push({ type: 'rect', x: left + uw, y: y0, w: dw, h, fill: v.downColor, fillAlpha: alpha, noStroke: true });
      }
    });
    const pocY = v.priceToY(prof.lo + rowH * (poc + 0.5));
    out.push(seg({ x: left, y: pocY }, { x: right, y: pocY }, { color: '#f23645', width: 2 }));
    out.push(text(`POC ${v.formatPrice(prof.lo + rowH * (poc + 0.5))}`, { x: right + 4, y: pocY }, { bg: '#f23645' }));
    return out;
  },
});

/** Price span summary, e.g. `+1.23 (+0.45%)`. */
function priceSpan(v: FullView, pts: readonly DrawingPoint[]): string {
  return changeText(v, pts[0]!.price, pts[1]!.price);
}

/** Bar/time span summary, e.g. `12 bars, 3h`. */
function dateSpan(v: FullView, pts: readonly DrawingPoint[]): string {
  const bars = Math.round(pts[1]!.index - pts[0]!.index);
  const t0 = timeAt(v.candles, pts[0]!.index);
  const t1 = timeAt(v.candles, pts[1]!.index);
  return `${bars} bars${t0 !== null && t1 !== null ? `, ${duration(t1 - t0)}` : ''}`;
}

function rangeBox(a: Pt, b: Pt, color: string): DrawPrimitive {
  return {
    type: 'rect',
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
    fill: color,
    fillAlpha: 0.15,
    noStroke: true,
  };
}

/** Double-headed-free measuring arrow from `from` to `to`. */
function measureArrow(from: Pt, to: Pt, color: string): DrawPrimitive[] {
  return [seg(from, to, { color }), arrowHead(from, to, 8, { color })];
}

/** Price range (2 points): vertical span with change and percent. */
export const priceRangeDrawing = defineDrawing({
  name: 'price-range',
  minPoints: 2,
  build: ([a, b], v, pts) => {
    const color = pts[1]!.price >= pts[0]!.price ? v.upColor : v.downColor;
    const x = (a!.x + b!.x) / 2;
    return [
      rangeBox(a!, b!, color),
      seg({ x: a!.x, y: a!.y }, { x: b!.x, y: a!.y }, { color }),
      seg({ x: a!.x, y: b!.y }, { x: b!.x, y: b!.y }, { color }),
      ...measureArrow({ x, y: a!.y }, { x, y: b!.y }, color),
      text(priceSpan(v, pts), { x, y: b!.y + (b!.y <= a!.y ? -6 : 6) }, { align: 'center', baseline: b!.y <= a!.y ? 'bottom' : 'top', bg: color, font: 'sans' }),
    ];
  },
});

/** Date range (2 points): horizontal span with bars, time and volume. */
export const dateRangeDrawing = defineDrawing({
  name: 'date-range',
  minPoints: 2,
  build: ([a, b], v, pts) => {
    const color = '#2962ff';
    const y = (a!.y + b!.y) / 2;
    const vol = volumeBetween(v.candles, pts[0]!.index, pts[1]!.index);
    return [
      rangeBox(a!, b!, color),
      seg({ x: a!.x, y: a!.y }, { x: a!.x, y: b!.y }, { color }),
      seg({ x: b!.x, y: a!.y }, { x: b!.x, y: b!.y }, { color }),
      ...measureArrow({ x: a!.x, y }, { x: b!.x, y }, color),
      text(`${dateSpan(v, pts)}\nVol ${compact(vol)}`, { x: (a!.x + b!.x) / 2, y: Math.max(a!.y, b!.y) + 6 }, {
        align: 'center',
        baseline: 'top',
        bg: color,
        font: 'sans',
      }),
    ];
  },
});

/** Date and price range (2 points): both spans in one box — the ruler/measure tool. */
export const datePriceRangeDrawing = defineDrawing({
  name: 'date-price-range',
  minPoints: 2,
  build: ([a, b], v, pts) => {
    const color = pts[1]!.price >= pts[0]!.price ? v.upColor : v.downColor;
    const vol = volumeBetween(v.candles, pts[0]!.index, pts[1]!.index);
    const cx = (a!.x + b!.x) / 2;
    const cy = (a!.y + b!.y) / 2;
    const up = b!.y <= a!.y;
    return [
      rangeBox(a!, b!, color),
      ...measureArrow({ x: cx, y: a!.y }, { x: cx, y: b!.y }, color),
      ...measureArrow({ x: a!.x, y: cy }, { x: b!.x, y: cy }, color),
      text(`${priceSpan(v, pts)}\n${dateSpan(v, pts)}\nVol ${compact(vol)}`, { x: cx, y: b!.y + (up ? -6 : 6) }, {
        align: 'center',
        baseline: up ? 'bottom' : 'top',
        bg: color,
        font: 'sans',
      }),
    ];
  },
});

/** All forecasting and measurement tools, in toolbar order. */
export const FORECAST_DRAWINGS = [
  longPositionDrawing,
  shortPositionDrawing,
  forecastDrawing,
  barsPatternDrawing,
  ghostFeedDrawing,
  projectionDrawing,
  anchoredVwapDrawing,
  volumeProfileDrawing,
  priceRangeDrawing,
  dateRangeDrawing,
  datePriceRangeDrawing,
] as const;
