/**
 * Rolling-window helpers shared by the channel and oscillator studies: JS
 * sliding max/min with the exact semantics of the WASM `rollingMax` /
 * `rollingMin` kernels, and a gap-propagating SMA.
 *
 * @module
 */

import type { WasmKernels } from '../wasm/loader.js';

function rolling(values: ArrayLike<number>, period: number, pick: (a: number, b: number) => number): Float64Array {
  const length = values.length;
  const out = new Float64Array(length).fill(NaN);
  const window = Math.floor(period);
  if (!(window >= 1 && window <= length)) return out;
  // van Herk/Gil-Werman, as in the kernel: block prefix extremes in `out`,
  // block suffix extremes in `suffix`, then one combine per window.
  const suffix = new Float64Array(length);
  let acc = 0;
  for (let i = 0; i < length; i++) {
    acc = i % window === 0 ? values[i] : pick(acc, values[i]);
    out[i] = acc;
  }
  for (let i = length - 1; i >= 0; i--) {
    acc = i === length - 1 || i % window === window - 1 ? values[i] : pick(acc, values[i]);
    suffix[i] = acc;
  }
  for (let i = window - 1; i < length; i++) out[i] = pick(suffix[i - window + 1], out[i]);
  out.fill(NaN, 0, window - 1);
  return out;
}

/**
 * Sliding-window maximum of the last `period` values (floored). NaN before
 * `period - 1`, for windows containing NaN, and everywhere when `period` is
 * below 1 or above the length. O(length) for any period; identical to the
 * WASM `rollingMax` kernel on f32 inputs.
 */
export function rollingMaxValues(values: ArrayLike<number>, period: number): Float64Array {
  return rolling(values, period, Math.max);
}

/** Sliding-window minimum; semantics as {@link rollingMaxValues}. */
export function rollingMinValues(values: ArrayLike<number>, period: number): Float64Array {
  return rolling(values, period, Math.min);
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

/**
 * Simple moving average over a sparse series, TradingView style: any `null`
 * (or NaN) inside a window makes that window `null`. Null during warmup.
 */
export function smaSparseValues(values: readonly (number | null)[], period: number): (number | null)[] {
  const length = values.length;
  const out = new Array<number | null>(length).fill(null);
  const window = Math.floor(period);
  if (!(window >= 1)) return out;
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
    if (valid === window) out[i] = window === 1 ? v : sum / window;
  }
  return out;
}
