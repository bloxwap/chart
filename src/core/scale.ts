/**
 * Time (bar index) and price scale math: visible ranges, zoom/scroll,
 * pixel mapping, tick generation, and visible-range min/max with optional
 * WASM acceleration.
 *
 * @module
 */

import type { Candle } from './data.js';
import type { WasmKernels } from '../wasm/loader.js';
import type { PriceScaleMode } from '../config.js';

/** A half-open range of bar indices `[from, to)`. */
export interface VisibleRange {
  readonly from: number;
  readonly to: number;
}

/** Minimum and maximum bar spacing in pixels. */
export const MIN_BAR_SPACING = 0.5;
export const MAX_BAR_SPACING = 500;

/**
 * Maps bar indices to x pixels. The right edge of the viewport shows the
 * latest bar when `scrollOffset` is 0; positive offsets scroll into history.
 */
export class TimeScale {
  /** Pixels per bar. */
  barSpacing: number;
  /** Bars scrolled away from the right edge (fractional while zooming). */
  scrollOffset: number;
  /** Viewport width in pixels. */
  width: number;

  constructor(barSpacing = 6, width = 0) {
    this.barSpacing = barSpacing;
    this.scrollOffset = 0;
    this.width = width;
  }

  /** Updates the viewport width. */
  setViewport(width: number): void {
    this.width = Math.max(0, width);
  }

  /** Visible bar index range for a dataset of `dataLength` candles. */
  visibleRange(dataLength: number): VisibleRange {
    if (dataLength <= 0 || this.width <= 0) return { from: 0, to: 0 };
    const count = Math.ceil(this.width / this.barSpacing) + 1;
    const to = Math.min(dataLength, Math.max(0, Math.ceil(dataLength - this.scrollOffset)));
    const from = Math.max(0, Math.min(to, Math.floor(dataLength - this.scrollOffset - count)));
    return { from, to };
  }

  /** X pixel of the center of bar `index`. */
  indexToX(index: number, dataLength: number): number {
    return this.width - (dataLength - 1 - index - this.scrollOffset) * this.barSpacing - this.barSpacing / 2;
  }

  /** Nearest bar index for x pixel `x`. */
  xToIndex(x: number, dataLength: number): number {
    return Math.round(this.xToFloatIndex(x, dataLength));
  }

  /** Fractional bar index for x pixel `x` (no rounding; may fall outside the dataset). */
  xToFloatIndex(x: number, dataLength: number): number {
    return dataLength - 1 - this.scrollOffset - (this.width - x - this.barSpacing / 2) / this.barSpacing;
  }

  /**
   * Multiplies bar spacing by `factor`, keeping the bar under `anchorX`
   * stationary when provided. Returns whether the scale changed.
   */
  zoom(factor: number, dataLength: number, anchorX?: number): boolean {
    if (!Number.isFinite(factor) || factor <= 0 ||
        (anchorX !== undefined && !Number.isFinite(anchorX))) return false;
    const oldSpacing = this.barSpacing;
    const next = Math.min(MAX_BAR_SPACING, Math.max(MIN_BAR_SPACING, oldSpacing * factor));
    if (next === oldSpacing) return false;
    if (anchorX !== undefined) {
      this.scrollOffset += (this.width - anchorX) * (1 / oldSpacing - 1 / next);
    }
    this.barSpacing = next;
    this.clampScroll(dataLength);
    return true;
  }

  /** Scrolls by `bars` (positive moves toward history). */
  scroll(bars: number, dataLength: number): void {
    this.scrollOffset += bars;
    this.clampScroll(dataLength);
  }

  /** Scrolls so that bar `index` becomes the rightmost visible bar. */
  scrollTo(index: number, dataLength: number): void {
    this.scrollOffset = dataLength - 1 - index;
    this.clampScroll(dataLength);
  }

  /** Fits bars `[from, to]` (any order) edge to edge in the viewport. */
  fitRange(from: number, to: number, dataLength: number): void {
    const lo = Math.min(from, to);
    const hi = Math.max(from, to);
    const bars = Math.max(1, hi - lo + 1);
    if (this.width > 0) {
      this.barSpacing = Math.min(MAX_BAR_SPACING, Math.max(MIN_BAR_SPACING, this.width / bars));
    }
    this.scrollOffset = dataLength - 1 - hi;
    this.clampScroll(dataLength);
  }

  private clampScroll(dataLength: number): void {
    const maxOffset = Math.max(0, dataLength - 1);
    const minOffset = -Math.ceil(this.width / this.barSpacing);
    this.scrollOffset = Math.min(maxOffset, Math.max(minOffset, this.scrollOffset));
  }
}

/** Maps prices to y pixels within a pane of fixed height. */
export class PriceScale {
  private min = 0;
  private max = 1;
  /** Pane height in pixels. */
  height = 0;
  /** Fraction of height reserved above the max price. */
  topMargin = 0.08;
  /** Fraction of height reserved below the min price. */
  bottomMargin = 0.08;
  mode: PriceScaleMode = 'regular';
  inverted = false;
  /** First visible close; a zero reference uses 1 to keep transforms finite. */
  basePrice = 1;

  /** Converts raw prices to the selected scale's units. */
  toScale(price: number): number {
    const base = this.basePrice || 1;
    if (this.mode === 'percent') return (price - base) / Math.abs(base) * 100;
    if (this.mode === 'indexed') return price / base * 100;
    if (this.mode === 'logarithmic') {
      return this.min > 0 ? Math.log10(Math.max(Number.MIN_VALUE, price))
        : Math.sign(price) * Math.log10(1 + Math.abs(price));
    }
    return price;
  }

  fromScale(value: number): number {
    const base = this.basePrice || 1;
    if (this.mode === 'percent') return base + value / 100 * Math.abs(base);
    if (this.mode === 'indexed') return value / 100 * base;
    if (this.mode === 'logarithmic') return this.min > 0 ? 10 ** value : Math.sign(value) * (10 ** Math.abs(value) - 1);
    return value;
  }

  format(price: number, formatter: (value: number) => string, precision: number | null = null): string {
    const value = this.mode === 'percent' || this.mode === 'indexed' ? this.toScale(price) : price;
    const digits = precision === null ? null : Math.max(0, Math.min(12, Math.round(precision)));
    const text = digits !== null ? value.toFixed(digits)
      : this.mode === 'percent' || this.mode === 'indexed' ? value.toFixed(2) : formatter(value);
    return text + (this.mode === 'percent' ? '%' : '');
  }

  /** Sets the displayed price range; degenerate ranges are padded. */
  setRange(min: number, max: number): void {
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      this.min = 0;
      this.max = 1;
      return;
    }
    if (min === max) {
      const pad = Math.abs(min) * 0.01 || 1;
      this.min = min - pad;
      this.max = max + pad;
      return;
    }
    this.min = Math.min(min, max);
    this.max = Math.max(min, max);
  }

  /** Current minimum price of the range. */
  get minPrice(): number {
    return this.min;
  }

  /** Current maximum price of the range. */
  get maxPrice(): number {
    return this.max;
  }

  /** Y pixel for `price`. */
  priceToY(price: number): number {
    const usable = this.height * (1 - this.topMargin - this.bottomMargin);
    const min = this.toScale(this.min), max = this.toScale(this.max);
    const fraction = (this.toScale(price) - min) / (max - min);
    return this.height * this.topMargin + (this.inverted ? fraction : 1 - fraction) * usable;
  }

  /** Price for y pixel `y`. */
  yToPrice(y: number): number {
    const usable = this.height * (1 - this.topMargin - this.bottomMargin);
    const min = this.toScale(this.min), max = this.toScale(this.max);
    const fraction = usable > 0 ? (y - this.height * this.topMargin) / usable : 0.5;
    return this.fromScale(min + (this.inverted ? fraction : 1 - fraction) * (max - min));
  }

  /** Roughly `count` "nice" tick prices spanning the range. */
  ticks(count = 6): number[] {
    const a = this.toScale(this.min), b = this.toScale(this.max);
    return priceTicks(Math.min(a, b), Math.max(a, b), count).map((value) => this.fromScale(value));
  }
}

/** Picks a 1/2/5·10^n step close to `raw`. */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
  return nice * mag;
}

/** Generates "nice" tick values between `min` and `max`. */
export function priceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min || count <= 0) return [];
  if (min === max) return [min];
  const step = niceStep((max - min) / Math.max(1, count));
  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return ticks;
}

/**
 * Min/max of `high`/`low` over candles in `[from, to)`.
 * Uses the WASM SIMD kernel when available, otherwise a scalar JS loop.
 */
export function visibleMinMax(
  candles: readonly Candle[],
  from: number,
  to: number,
  kernels: WasmKernels | null,
): { min: number; max: number } {
  const start = Math.max(0, from);
  const end = Math.min(candles.length, to);
  if (end <= start) return { min: 0, max: 1 };
  if (kernels !== null) {
    const n = end - start;
    const buf = new Float32Array(n * 2);
    for (let i = start; i < end; i++) {
      const c = candles[i];
      buf[i - start] = c.low;
      buf[n + i - start] = c.high;
    }
    return kernels.minmax(buf);
  }
  let min = Infinity;
  let max = -Infinity;
  for (let i = start; i < end; i++) {
    const c = candles[i];
    if (c.low < min) min = c.low;
    if (c.high > max) max = c.high;
  }
  return { min, max };
}

/** Min/max over a sparse indicator value series within `[from, to)`. */
export function seriesMinMax(
  values: readonly (number | null)[],
  from: number,
  to: number,
): { min: number; max: number } | null {
  const start = Math.max(0, from);
  const end = Math.min(values.length, to);
  let min = Infinity;
  let max = -Infinity;
  let seen = false;
  for (let i = start; i < end; i++) {
    const v = values[i];
    if (v === null || Number.isNaN(v)) continue;
    seen = true;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return seen ? { min, max } : null;
}
