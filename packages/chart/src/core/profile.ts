/**
 * Volume-at-price and TPO (time-at-price) profile math shared by the fixed
 * range volume profile drawing and the session profile pane. Profiles bin a
 * bar range into price rows, find the point of control (POC) and grow a value
 * area around it.
 *
 * @module
 */

import type { Candle } from './data.js';

/** Point of control and value-area row bounds of a profile. */
export interface ValueArea {
  /** Row with the most volume/TPO (point of control). */
  readonly poc: number;
  /** Lowest row inside the value area. */
  readonly low: number;
  /** Highest row inside the value area. */
  readonly high: number;
}

/** A price-row profile over a bar range. */
export interface PriceProfile {
  /** Lowest price of the profiled bars. */
  readonly lo: number;
  /** Highest price of the profiled bars. */
  readonly hi: number;
  /** Number of price rows. */
  readonly rows: number;
  /** Price height of one row. */
  readonly step: number;
  /** Total per row (volume, or TPO count). */
  readonly totals: readonly number[];
  /** Point of control row index. */
  readonly poc: number;
  /** Value-area low row index. */
  readonly valueAreaLow: number;
  /** Value-area high row index. */
  readonly valueAreaHigh: number;
  /** Mid-price of the POC row. */
  readonly pocPrice: number;
  /** Bottom price of the value area. */
  readonly valueAreaLowPrice: number;
  /** Top price of the value area. */
  readonly valueAreaHighPrice: number;
}

/** A volume profile: per-row totals split by bar direction. */
export interface VolumeProfile extends PriceProfile {
  /** Rising-bar volume per row. */
  readonly up: readonly number[];
  /** Falling-bar volume per row. */
  readonly down: readonly number[];
}

/** A run of consecutive bars belonging to one session. */
export interface SessionRange {
  /** Session bucket index: `floor(time_ms / sessionMs)`. */
  readonly session: number;
  /** First bar index (inclusive). */
  readonly from: number;
  /** Last bar index (inclusive). */
  readonly to: number;
  /** Session start as a UNIX timestamp in seconds. */
  readonly start: number;
}

/** Fraction of volume/TPO the value area covers by default. */
export const DEFAULT_VALUE_AREA_PERCENT = 0.7;

/** Default session length: one day in milliseconds. */
export const DEFAULT_SESSION_MS = 86_400_000;

/** Row index containing `price`, clamped to `0..rows-1`. */
export function profileRowAt(lo: number, step: number, rows: number, price: number): number {
  return Math.min(rows - 1, Math.max(0, Math.floor((price - lo) / step)));
}

function bounds(candles: readonly Candle[], from: number, to: number, rows: number): { start: number; end: number; lo: number; hi: number; step: number } | null {
  if (rows <= 0 || candles.length === 0) return null;
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(candles.length - 1, Math.max(from, to));
  if (end < start) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = start; i <= end; i++) {
    lo = Math.min(lo, candles[i]!.low);
    hi = Math.max(hi, candles[i]!.high);
  }
  return { start, end, lo, hi, step: (hi - lo) / rows || 1 };
}

/**
 * Per-row up/down volume for bars in `[from, to]`, spread uniformly over each
 * bar's range; `null` for an empty range.
 */
export function volumeProfileRows(
  candles: readonly Candle[],
  from: number,
  to: number,
  rows: number,
): { lo: number; hi: number; up: number[]; down: number[] } | null {
  const b = bounds(candles, from, to, rows);
  if (!b) return null;
  const up = new Array<number>(rows).fill(0);
  const down = new Array<number>(rows).fill(0);
  for (let i = b.start; i <= b.end; i++) {
    const c = candles[i]!;
    const r0 = profileRowAt(b.lo, b.step, rows, c.low);
    const r1 = profileRowAt(b.lo, b.step, rows, c.high);
    const share = (c.volume ?? 0) / (r1 - r0 + 1);
    for (let r = r0; r <= r1; r++) (c.close >= c.open ? up : down)[r]! += share;
  }
  return { lo: b.lo, hi: b.hi, up, down };
}

/**
 * Per-row TPO count for bars in `[from, to]`: one count per bar whose range
 * covers the row; `null` for an empty range.
 */
export function tpoProfileRows(
  candles: readonly Candle[],
  from: number,
  to: number,
  rows: number,
): { lo: number; hi: number; counts: number[] } | null {
  const b = bounds(candles, from, to, rows);
  if (!b) return null;
  const counts = new Array<number>(rows).fill(0);
  for (let i = b.start; i <= b.end; i++) {
    const c = candles[i]!;
    const r0 = profileRowAt(b.lo, b.step, rows, c.low);
    const r1 = profileRowAt(b.lo, b.step, rows, c.high);
    for (let r = r0; r <= r1; r++) counts[r]! += 1;
  }
  return { lo: b.lo, hi: b.hi, counts };
}

/**
 * Point of control (first row with the highest total) and the value area that
 * grows from it until `percent` of the grand total is covered.
 */
export function valueArea(totals: readonly number[], percent = DEFAULT_VALUE_AREA_PERCENT): ValueArea {
  let poc = 0;
  for (let i = 1; i < totals.length; i++) if (totals[i]! > totals[poc]!) poc = i;
  const sum = totals.reduce((s, x) => s + x, 0);
  let low = poc;
  let high = poc;
  let acc = totals[poc] ?? 0;
  while (acc < sum * percent && (low > 0 || high < totals.length - 1)) {
    const below = low > 0 ? totals[low - 1]! : -1;
    const above = high < totals.length - 1 ? totals[high + 1]! : -1;
    if (above >= below) acc += totals[++high]!;
    else acc += totals[--low]!;
  }
  return { poc, low, high };
}

function finishProfile(lo: number, hi: number, rows: number, totals: readonly number[], percent: number): PriceProfile {
  const step = (hi - lo) / rows || 1;
  const va = valueArea(totals, percent);
  return {
    lo,
    hi,
    rows,
    step,
    totals,
    poc: va.poc,
    valueAreaLow: va.low,
    valueAreaHigh: va.high,
    pocPrice: lo + step * (va.poc + 0.5),
    valueAreaLowPrice: lo + step * va.low,
    valueAreaHighPrice: lo + step * (va.high + 1),
  };
}

/** Volume profile over bars `[from, to]` with POC and value area; `null` for an empty range. */
export function computeVolumeProfile(
  candles: readonly Candle[],
  from: number,
  to: number,
  rows: number,
  valueAreaPercent = DEFAULT_VALUE_AREA_PERCENT,
): VolumeProfile | null {
  const prof = volumeProfileRows(candles, from, to, rows);
  if (!prof) return null;
  const totals = prof.up.map((u, i) => u + prof.down[i]!);
  return { ...finishProfile(prof.lo, prof.hi, rows, totals, valueAreaPercent), up: prof.up, down: prof.down };
}

/** TPO profile over bars `[from, to]` with POC and value area; `null` for an empty range. */
export function computeTpoProfile(
  candles: readonly Candle[],
  from: number,
  to: number,
  rows: number,
  valueAreaPercent = DEFAULT_VALUE_AREA_PERCENT,
): PriceProfile | null {
  const prof = tpoProfileRows(candles, from, to, rows);
  if (!prof) return null;
  return finishProfile(prof.lo, prof.hi, rows, prof.counts, valueAreaPercent);
}

/**
 * Consecutive bar runs of `[from, to]` grouped into sessions of `sessionMs`
 * milliseconds, bucketed by `floor(time / sessionMs)` in UTC.
 */
export function sessionRanges(
  candles: readonly Candle[],
  from: number,
  to: number,
  sessionMs = DEFAULT_SESSION_MS,
): SessionRange[] {
  const start = Math.max(0, Math.min(from, to));
  const end = Math.min(candles.length - 1, Math.max(from, to));
  const ranges: SessionRange[] = [];
  let current: { session: number; from: number; to: number; start: number } | null = null;
  for (let i = start; i <= end; i++) {
    const session = Math.floor((candles[i]!.time * 1000) / sessionMs);
    if (current && current.session === session) {
      current.to = i;
    } else {
      current = { session, from: i, to: i, start: (session * sessionMs) / 1000 };
      ranges.push(current);
    }
  }
  return ranges;
}

/**
 * A round profile row step at or above `raw`: 1, 2, 2.5 or 5 times a power of ten,
 * so profile rows land on round prices. Non-positive or non-finite input gives 1.
 */
export function profileStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/**
 * Up/down volume of bars `[from, to]` (inclusive, clamped to the data) on a
 * fixed price grid: `rows` rows of `step` from `lo`. Each bar's volume is
 * spread evenly over every grid row its low–high range touches, including
 * rows off the grid, so a bar reaching past the grid keeps only its on-grid
 * share. Up bars (`close >= open`) fill `up`, the rest `down`.
 */
export function gridVolumeRows(
  candles: readonly Candle[],
  from: number,
  to: number,
  lo: number,
  step: number,
  rows: number,
): { up: number[]; down: number[] } {
  const up = new Array<number>(rows).fill(0);
  const down = new Array<number>(rows).fill(0);
  const start = Math.max(0, from);
  const end = Math.min(candles.length - 1, to);
  for (let i = start; i <= end; i++) {
    const c = candles[i]!;
    const r0 = Math.floor((c.low - lo) / step);
    const r1 = Math.floor((c.high - lo) / step);
    if (!(r1 >= 0 && r0 < rows)) continue; // off the grid, or a NaN extreme
    const share = (c.volume ?? 0) / (r1 - r0 + 1);
    const side = c.close >= c.open ? up : down;
    for (let r = Math.max(0, r0); r <= Math.min(rows - 1, r1); r++) side[r]! += share;
  }
  return { up, down };
}
