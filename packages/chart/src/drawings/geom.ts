/**
 * Shared geometry helpers for drawing models: view resolution, point
 * conversion, line extension, arrowheads, and label formatting.
 *
 * @module
 */

import type { DrawingPoint } from '../config.js';
import type { Candle } from '../core/data.js';
import type { DrawingView, DrawPrimitive, PrimitiveStyle, TextStyle } from './types.js';

/** A pixel-space point. */
export interface Pt {
  readonly x: number;
  readonly y: number;
}

/** The line variant of {@link DrawPrimitive}. */
export type LinePrimitive = Extract<DrawPrimitive, { type: 'line' }>;

/** Full circle in radians. */
export const TAU = Math.PI * 2;

/** A {@link DrawingView} with every optional extra filled in. */
export interface FullView {
  indexToX(index: number): number;
  priceToY(price: number): number;
  xToIndex(x: number): number;
  yToPrice(y: number): number;
  readonly width: number;
  readonly height: number;
  readonly candles: readonly Candle[];
  readonly barSpacing: number;
  formatPrice(price: number): string;
  formatTime(time: number): string;
  readonly upColor: string;
  readonly downColor: string;
}

/** Linear inverse of `f` sampled at 0 and 1 (views are affine). */
function affineInverse(f: (v: number) => number): (p: number) => number {
  const f0 = f(0);
  const slope = f(1) - f0;
  return (p) => (slope === 0 ? 0 : (p - f0) / slope);
}

function fallbackTime(time: number): string {
  return new Date(time * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** Fills in the optional extras of a view with affine/neutral defaults. */
export function resolveView(view: DrawingView): FullView {
  return {
    indexToX: (i) => view.indexToX(i),
    priceToY: (p) => view.priceToY(p),
    xToIndex: view.xToIndex !== undefined ? (x) => view.xToIndex!(x) : affineInverse((i) => view.indexToX(i)),
    yToPrice: view.yToPrice !== undefined ? (y) => view.yToPrice!(y) : affineInverse((p) => view.priceToY(p)),
    width: view.width,
    height: view.height,
    candles: view.candles ?? [],
    barSpacing: view.barSpacing ?? Math.abs(view.indexToX(1) - view.indexToX(0)),
    formatPrice: view.formatPrice ?? ((p) => p.toFixed(2)),
    formatTime: view.formatTime ?? fallbackTime,
    upColor: view.upColor ?? '#26a69a',
    downColor: view.downColor ?? '#ef5350',
  };
}

/** Converts data points to pixel points. */
export function toPx(points: readonly DrawingPoint[], view: DrawingView): Pt[] {
  return points.map((p) => ({ x: view.indexToX(p.index), y: view.priceToY(p.price) }));
}

/** Converts anchored (screen-fraction) points to pixel points. */
export function anchoredPx(points: readonly DrawingPoint[], view: DrawingView): Pt[] {
  return points.map((p) => ({ x: p.index * view.width, y: p.price * view.height }));
}

/** Midpoint of two points. */
export function mid(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Euclidean distance. */
export function dist(a: Pt, b: Pt): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** A line segment primitive between two points. */
export function seg(a: Pt, b: Pt, style: PrimitiveStyle = {}): LinePrimitive {
  return { type: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...style };
}

/** A polyline primitive through the points. */
export function poly(pts: readonly Pt[], style: PrimitiveStyle & { closed?: boolean } = {}): DrawPrimitive {
  const flat: number[] = [];
  for (const p of pts) flat.push(p.x, p.y);
  return { type: 'path', points: flat, ...style };
}

/** A text primitive. */
export function text(value: string, at: Pt, style: TextStyle = {}): DrawPrimitive {
  return { type: 'text', text: value, x: at.x, y: at.y, ...style };
}

/**
 * Largest `t ≥ 0` such that `a + t·d` stays inside the padded viewport.
 * Returns 0 when the direction is zero.
 */
export function exitParam(a: Pt, dx: number, dy: number, width: number, height: number): number {
  const pad = 2;
  let t = Infinity;
  if (dx !== 0) t = Math.min(t, ((dx > 0 ? width + pad : -pad) - a.x) / dx);
  if (dy !== 0) t = Math.min(t, ((dy > 0 ? height + pad : -pad) - a.y) / dy);
  return t === Infinity ? 0 : Math.max(0, t);
}

/**
 * The line through `a` and `b`, optionally extended past `a` (`back`) and/or
 * past `b` (`fwd`) to the viewport edge.
 */
export function extendedLine(
  a: Pt,
  b: Pt,
  view: { readonly width: number; readonly height: number },
  back: boolean,
  fwd: boolean,
  style: PrimitiveStyle = {},
): LinePrimitive {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let start = a;
  let end = b;
  if (fwd) {
    const t = exitParam(b, dx, dy, view.width, view.height);
    end = { x: b.x + dx * t, y: b.y + dy * t };
  }
  if (back) {
    const t = exitParam(a, -dx, -dy, view.width, view.height);
    start = { x: a.x - dx * t, y: a.y - dy * t };
  }
  return seg(start, end, style);
}

/** A filled triangular arrowhead with its tip at `tip`, pointing away from `from`. */
export function arrowHead(from: Pt, tip: Pt, size: number, style: PrimitiveStyle = {}): DrawPrimitive {
  const len = dist(from, tip) || 1;
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const bx = tip.x - ux * size;
  const by = tip.y - uy * size;
  const hw = size * 0.5;
  return poly(
    [tip, { x: bx - uy * hw, y: by + ux * hw }, { x: bx + uy * hw, y: by - ux * hw }],
    { closed: true, fill: true, fillAlpha: 1, ...style },
  );
}

/** Signed percentage change from `a` to `b`. */
export function pctChange(a: number, b: number): string {
  if (a === 0) return '0.00%';
  const v = ((b - a) / Math.abs(a)) * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/** Decimal places in a formatted number, e.g. `2` for `"117.41"`. */
export function decimalsOf(formatted: string): number {
  const m = /\.(\d+)/.exec(formatted);
  return m === null ? 0 : m[1]!.length;
}

/**
 * Signed price difference with an explicit `+`, at the precision the view
 * formats `reference` with — so a 0.68 move on a 117.41 price reads
 * `+0.68`, not the six decimals a sub-1 number would get on its own.
 */
export function signedDelta(view: FullView, diff: number, reference: number): string {
  return `${diff >= 0 ? '+' : '-'}${Math.abs(diff).toFixed(decimalsOf(view.formatPrice(reference)))}`;
}

/** `+0.68 (+0.58%)` for a move from `from` to `to`. */
export function changeText(view: FullView, from: number, to: number): string {
  return `${signedDelta(view, to - from, from)} (${pctChange(from, to)})`;
}

/** Human duration for a span of seconds, e.g. `3d 4h`, `45m`. */
export function duration(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

/**
 * Timestamp of a (possibly fractional or out-of-range) bar index,
 * extrapolated from the first/last bar spacing. `null` without data.
 */
export function timeAt(candles: readonly Candle[], index: number): number | null {
  const n = candles.length;
  if (n === 0) return null;
  const i = Math.round(index);
  if (i >= 0 && i < n) return candles[i]!.time;
  if (n === 1) return candles[0]!.time;
  const step = i < 0 ? candles[1]!.time - candles[0]!.time : candles[n - 1]!.time - candles[n - 2]!.time;
  return i < 0 ? candles[0]!.time + i * step : candles[n - 1]!.time + (i - n + 1) * step;
}

/** Sum of volume for bars in `[from, to]` (inclusive, clamped). */
export function volumeBetween(candles: readonly Candle[], from: number, to: number): number {
  const a = Math.max(0, Math.round(Math.min(from, to)));
  const b = Math.min(candles.length - 1, Math.round(Math.max(from, to)));
  let v = 0;
  for (let i = a; i <= b; i++) v += candles[i]!.volume ?? 0;
  return v;
}

/** Compact number, e.g. `12.3K`, `4.5M`. */
export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return `${Math.round(v)}`;
}

/** Bar index nearest a data point, clamped into the dataset (or -1 without data). */
export function clampIndex(candles: readonly Candle[], index: number): number {
  if (candles.length === 0) return -1;
  return Math.min(candles.length - 1, Math.max(0, Math.round(index)));
}

/** Level palette shared by Fibonacci/Gann tools (TradingView-like order). */
export const LEVEL_COLORS: readonly string[] = [
  '#787b86',
  '#f23645',
  '#ff9800',
  '#4caf50',
  '#089981',
  '#00bcd4',
  '#787b86',
  '#2962ff',
  '#f23645',
  '#9c27b0',
  '#e91e63',
];

/** Color for level `i`, cycling through {@link LEVEL_COLORS}. */
export function levelColor(i: number): string {
  return LEVEL_COLORS[i % LEVEL_COLORS.length]!;
}

/** Formats a ratio label like `0.618`, trimming to at most 3 decimals. */
export function ratio(v: number): string {
  return Number(v.toFixed(3)).toString();
}
