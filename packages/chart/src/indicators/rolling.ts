/**
 * Rolling-window helpers shared by the channel and oscillator studies: JS
 * sliding max/min with the exact semantics of the WASM `rollingMax` /
 * `rollingMin` kernels, and a gap-propagating SMA.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import { TailState } from './tail.js';
import type { WasmKernels } from '../wasm/loader.js';

/**
 * Sliding-window maximum of the last `period` values (floored). NaN before
 * `period - 1`, for windows containing NaN, and everywhere when `period` is
 * below 1 or above the length. O(length) for any period; identical to the
 * WASM `rollingMax` kernel on f32 inputs.
 */
export function rollingMaxValues(values: ArrayLike<number>, period: number): Float64Array {
  const length = values.length;
  const out = new Float64Array(length);
  const window = Math.floor(period);
  if (!(window >= 1 && window <= length)) return out.fill(NaN);
  // Block prefix/suffix extremes, with the same operand order as the
  // kernels. Block boundaries avoid a remainder and callback per value.
  const suffix = new Float64Array(length);
  for (let start = 0; start < length; start += window) {
    const end = Math.min(start + window, length);
    let acc = values[start];
    out[start] = acc;
    for (let i = start + 1; i < end; i++) {
      acc = Math.max(acc, values[i]);
      out[i] = acc;
    }
    acc = values[end - 1];
    suffix[end - 1] = acc;
    for (let i = end - 2; i >= start; i--) {
      acc = Math.max(acc, values[i]);
      suffix[i] = acc;
    }
  }
  for (let i = window - 1; i < length; i++) out[i] = Math.max(suffix[i - window + 1], out[i]);
  out.fill(NaN, 0, window - 1);
  return out;
}

/** Sliding-window minimum; semantics as {@link rollingMaxValues}. */
export function rollingMinValues(values: ArrayLike<number>, period: number): Float64Array {
  const length = values.length;
  const out = new Float64Array(length);
  const window = Math.floor(period);
  if (!(window >= 1 && window <= length)) return out.fill(NaN);
  // Block prefix/suffix extremes, with the same operand order as the
  // kernels. Block boundaries avoid a remainder and callback per value.
  const suffix = new Float64Array(length);
  for (let start = 0; start < length; start += window) {
    const end = Math.min(start + window, length);
    let acc = values[start];
    out[start] = acc;
    for (let i = start + 1; i < end; i++) {
      acc = Math.min(acc, values[i]);
      out[i] = acc;
    }
    acc = values[end - 1];
    suffix[end - 1] = acc;
    for (let i = end - 2; i >= start; i--) {
      acc = Math.min(acc, values[i]);
      suffix[i] = acc;
    }
  }
  for (let i = window - 1; i < length; i++) out[i] = Math.min(suffix[i - window + 1], out[i]);
  out.fill(NaN, 0, window - 1);
  return out;
}

/** Exact price extremes without materializing high/low columns. */
export function rollingCandleExtremes(candles: readonly Candle[], period: number): { max: Float64Array; min: Float64Array } {
  const length = candles.length;
  const max = new Float64Array(length);
  const min = new Float64Array(length);
  const window = Math.floor(period);
  if (!(window >= 1 && window <= length)) return { max: max.fill(NaN), min: min.fill(NaN) };
  const suffixMax = new Float64Array(length);
  const suffixMin = new Float64Array(length);
  for (let start = 0; start < length; start += window) {
    const end = Math.min(start + window, length);
    let hi = candles[start].high, lo = candles[start].low;
    max[start] = hi;
    min[start] = lo;
    for (let i = start + 1; i < end; i++) {
      hi = Math.max(hi, candles[i].high);
      lo = Math.min(lo, candles[i].low);
      max[i] = hi;
      min[i] = lo;
    }
    hi = candles[end - 1].high;
    lo = candles[end - 1].low;
    suffixMax[end - 1] = hi;
    suffixMin[end - 1] = lo;
    for (let i = end - 2; i >= start; i--) {
      hi = Math.max(hi, candles[i].high);
      lo = Math.min(lo, candles[i].low);
      suffixMax[i] = hi;
      suffixMin[i] = lo;
    }
  }
  for (let i = window - 1; i < length; i++) {
    max[i] = Math.max(suffixMax[i - window + 1], max[i]);
    min[i] = Math.min(suffixMin[i - window + 1], min[i]);
  }
  max.fill(NaN, 0, window - 1);
  min.fill(NaN, 0, window - 1);
  return { max, min };
}

/**
 * Rolling max/min pair via the WASM kernels when available, else JS. The
 * kernel path rounds to f32, so callers use it only where that error is
 * immaterial (oscillator ratios), never for exact price levels.
 */
export function rollingExtremes(
  high: ArrayLike<number>,
  low: ArrayLike<number>,
  period: number,
  kernels: WasmKernels | null,
): { max: ArrayLike<number>; min: ArrayLike<number> } {
  if (kernels === null) return { max: rollingMaxValues(high, period), min: rollingMinValues(low, period) };
  return {
    max: kernels.rollingMax(Float32Array.from(high), period),
    min: kernels.rollingMin(Float32Array.from(low), period),
  };
}

const sparseStates = new WeakMap<readonly (number | null)[], TailState<number[]>>();

/**
 * Simple moving average over a sparse series, TradingView style: any `null`
 * (or NaN) inside a window makes that window `null`. Null during warmup.
 */
export function smaSparseValues(values: readonly (number | null)[], period: number): (number | null)[] {
  const length = values.length;
  const out = new Array<number | null>(length);
  const window = Math.floor(period);
  if (!(window >= 1)) return out.fill(null);
  const state = new TailState<number[]>(value => value.slice());
  sparseStates.set(out, state);
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < length; i++) {
    const v = values[i];
    if (v !== null && !Number.isNaN(v)) {
      sum += v;
      valid++;
    }
    if (i >= window) {
      const old = values[i - window];
      if (old !== null && !Number.isNaN(old)) {
        sum -= old;
        valid--;
      }
    }
    // A full window means every value in it (including v) is present. A
    // one-bar window passes v through exactly instead of the running sum.
    out[i] = valid === window ? window === 1 ? v : sum / window : null;
    if (i >= length - 2) state.save(i, length, [sum, valid]);
  }
  return out;
}

/** Resume sparse smoothing with the original sum and valid-value count. */
export function updateSparse(out: (number | null)[], input: { length: number; at(index: number): number | null | undefined }, from: number, period: number): boolean {
  const state = sparseStates.get(out);
  const previous = state?.get(from - 1);
  if (previous === undefined) return false;
  let [sum, valid] = previous;
  for (let i = from; i < input.length; i++) {
    const v = input.at(i) as number | null;
    if (v !== null && !Number.isNaN(v)) { sum += v; valid++; }
    if (i >= period) {
      const old = input.at(i - period) as number | null;
      if (old !== null && !Number.isNaN(old)) { sum -= old; valid--; }
    }
    out[i] = valid === period ? period === 1 ? v : sum / period : null;
    state!.save(i, input.length, [sum, valid]);
  }
  state!.prune(input.length);
  return true;
}
