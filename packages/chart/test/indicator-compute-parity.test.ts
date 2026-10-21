import { it } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_INDICATORS } from '../dist/indicators/index.js';
import type { Candle } from '../dist/core/data.js';
import { initWasm } from '../dist/wasm/loader.js';
import { rollingMaxValues, rollingMinValues, rollingCandleExtremes, smaSparseValues } from '../dist/indicators/rolling.js';
import { stochValues } from '../dist/indicators/stoch.js';
import { stochRsiValues } from '../dist/indicators/stochrsi.js';
import { smaCandleValues } from '../dist/indicators/sma.js';
import { emaCandleValues } from '../dist/indicators/ema.js';
import { rsiCandleValues } from '../dist/indicators/rsi.js';
import type { IndicatorDef, IndicatorLevel } from '../dist/indicators/types.js';
import type { WasmKernels } from '../dist/wasm/loader.js';
import { TailState, TailSeries, smallTail, TAIL_HISTORY_MARGIN, setSeriesValue, type MutableSeries } from '../dist/indicators/tail.js';
import { lengthParam } from '../dist/indicators/params.js';

// Frozen pre-change modules. Namespaces isolate their module scopes; imports
// between frozen modules are rewired to namespace aliases. Arithmetic is unchanged.
namespace ReferenceRolling {
// Frozen from HEAD before issue #62 compute optimizations.
/**
 * Rolling-window helpers shared by the channel and oscillator studies: JS
 * sliding max/min with the exact semantics of the WASM `rollingMax` /
 * `rollingMin` kernels, and a gap-propagating SMA.
 *
 * @module
 */

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

const sparseStates = new WeakMap<readonly (number | null)[], TailState<number[]>>();

/**
 * Simple moving average over a sparse series, TradingView style: any `null`
 * (or NaN) inside a window makes that window `null`. Null during warmup.
 */
export function smaSparseValues(values: readonly (number | null)[], period: number): (number | null)[] {
  const length = values.length;
  const out = new Array<number | null>(length).fill(null);
  const window = Math.floor(period);
  if (!(window >= 1)) return out;
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
    if (valid === window) out[i] = window === 1 ? v : sum / window;
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
}

namespace ReferenceSma {
// Frozen from HEAD before issue #62 compute optimizations.
/**
 * SMA — simple moving average of close prices.
 *
 * @module
 */

const wasmStates = new WeakMap<readonly (number | null)[], TailState<number>>();

const sums = new WeakMap<readonly (number | null)[], TailState<number>>();

/** Scalar SMA: `out[i] = mean(values[i-period+1 .. i])`, null during warmup. */
export function smaValues(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const state = new TailState<number>(value => value);
  sums.set(out, state);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
    if (i >= values.length - 2) state.save(i, values.length, sum);
  }
  return out;
}

/** Resume the exact running sum, including its accumulated rounding error. */
export function updateSma(out: (number | null)[], candles: readonly Candle[], from: number, period: number): boolean {
  const state = sums.get(out);
  let sum = state?.get(from - 1);
  if (sum === undefined) return false;
  for (let i = from; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    out[i] = i >= period - 1 ? sum / period : null;
    state!.save(i, candles.length, sum);
  }
  state!.prune(candles.length);
  return true;
}

/** SMA via the WASM kernel: NaNs become `null`. */
export function smaWasm(values: readonly number[] | Float32Array, period: number, kernels: WasmKernels): (number | null)[] {
  const out = kernels.sma(values instanceof Float32Array ? values : Float32Array.from(values), period);
  const valuesOut = new Array<number | null>(out.length);
  for (let i = 0; i < out.length; i++) valuesOut[i] = Number.isNaN(out[i]) ? null : out[i];
  return valuesOut;
}

/** SMA indicator definition (name `'sma'`, param `period`, default 20). */
export const smaIndicator: IndicatorDef = {
  name: 'sma',
  label: 'Moving Average Simple',
  shortName: 'SMA',
  defaultParams: { period: 20 },
  defaultColors: ['#2962ff'],
  defaultPane: 'main',
  inputs: [{ key: 'period', label: 'Length', min: 1, step: 1, integer: true }],
  styles: [{ key: 'value', label: 'MA', colorIndex: 0 }],
  update(output, candles, from, params, _colors, kernels) {
    if (!smallTail(candles.length, from)) return undefined;
    const period = Math.max(1, Math.floor(params['period'] ?? 20));
    if (kernels !== null) {
      const out = output.lines[0].values as (number | null)[];
      const state = wasmStates.get(out);
      let previous = state?.get(from - 1);
      if (previous === undefined || from < period) return undefined;
      const factor = 1 / period;
      for (let i = from; i < candles.length; i++) {
        previous = previous + (Math.fround(candles[i].close) - Math.fround(candles[i - period].close));
        const value = Math.fround(previous * factor);
        out[i] = Number.isNaN(value) ? null : value;
        state!.save(i, candles.length, previous);
      }
      state!.prune(candles.length);
      return output;
    }
    return updateSma(output.lines[0].values as (number | null)[], candles, from, period) ? output : undefined;
  },
  compute(
    candles: readonly Candle[],
    params: Record<string, number>,
    colors: readonly string[],
    kernels: WasmKernels | null,
  ) {
    const period = Math.max(1, Math.floor(params['period'] ?? 20));
    let values: (number | null)[];
    if (kernels !== null) {
      const closes = new Float32Array(candles.length);
      const state = new TailState<number>(value => value);
      let previous = 0;
      // Match kernels.wat: promote f32 inputs, retain f64 recurrence state.
      for (let i = 0; i < candles.length; i++) {
        closes[i] = candles[i].close;
        if (i < period) {
          previous += closes[i];
        } else {
          previous = previous + (closes[i] - closes[i - period]);
        }
        if (i >= candles.length - 2) state.save(i, candles.length, previous);
      }
      values = smaWasm(closes, period, kernels);
      wasmStates.set(values, state);
    } else {
      values = smaValues(candles.map((c) => c.close), period);
    }
    return {
      pane: 'main',
      lines: [{ key: 'value', values, color: colors[0] ?? '#2962ff' }],
    };
  },
};
}

namespace ReferenceEma {
// Frozen from HEAD before issue #62 compute optimizations.
/**
 * EMA — exponential moving average of close prices (SMA-seeded, k = 2/(p+1)).
 *
 * @module
 */

const wasmStates = new WeakMap<readonly (number | null)[], TailState<number>>();

/** Scalar EMA over a dense series, seeded with the SMA of the first `period`. */
export function emaValues(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** EMA's previous output is the complete recurrence state after seeding. */
export function updateEma(out: (number | null)[], candles: readonly Candle[], from: number, period: number): boolean {
  if (!Number.isFinite(period) || from < period || out[from - 1] === undefined) return false;
  const k = 2 / (period + 1);
  let prev = out[from - 1] as number;
  for (let i = from; i < candles.length; i++) {
    prev = candles[i].close * k + prev * (1 - k);
    out[i] = prev;
  }
  return true;
}

/** EMA via the WASM kernel: NaNs become `null`. */
export function emaWasm(values: readonly number[] | Float32Array, period: number, kernels: WasmKernels): (number | null)[] {
  const out = kernels.ema(values instanceof Float32Array ? values : Float32Array.from(values), period);
  const valuesOut = new Array<number | null>(out.length);
  for (let i = 0; i < out.length; i++) valuesOut[i] = Number.isNaN(out[i]) ? null : out[i];
  return valuesOut;
}

/** EMA indicator definition (name `'ema'`, param `period`, default 20). */
export const emaIndicator: IndicatorDef = {
  name: 'ema',
  label: 'Moving Average Exponential',
  shortName: 'EMA',
  defaultParams: { period: 20 },
  defaultColors: ['#ff6d00'],
  defaultPane: 'main',
  inputs: [{ key: 'period', label: 'Length', min: 1, step: 1, integer: true }],
  styles: [{ key: 'value', label: 'EMA', colorIndex: 0 }],
  update(output, candles, from, params, _colors, kernels) {
    if (!smallTail(candles.length, from)) return undefined;
    const period = Math.max(1, Math.floor(params['period'] ?? 20));
    if (kernels !== null) {
      const out = output.lines[0].values as (number | null)[];
      const state = wasmStates.get(out);
      let previous = state?.get(from - 1);
      if (previous === undefined || from < period) return undefined;
      const factor = 2 / (period + 1);
      for (let i = from; i < candles.length; i++) {
        previous = Math.fround(candles[i].close) * factor + previous * (1 - factor);
        const value = Math.fround(previous);
        out[i] = Number.isNaN(value) ? null : value;
        state!.save(i, candles.length, previous);
      }
      state!.prune(candles.length);
      return output;
    }
    return updateEma(output.lines[0].values as (number | null)[], candles, from,
      period) ? output : undefined;
  },
  compute(
    candles: readonly Candle[],
    params: Record<string, number>,
    colors: readonly string[],
    kernels: WasmKernels | null,
  ) {
    const period = Math.max(1, Math.floor(params['period'] ?? 20));
    let values: (number | null)[];
    if (kernels !== null) {
      const closes = new Float32Array(candles.length);
      const state = new TailState<number>(value => value);
      let previous = 0;
      const k = 2 / (period + 1);
      // Match kernels.wat: promote f32 inputs, retain f64 recurrence state.
      for (let i = 0; i < candles.length; i++) {
        closes[i] = candles[i].close;
        if (i < period) {
          previous += closes[i];
          if (i === period - 1) previous /= period;
        } else {
          previous = closes[i] * k + previous * (1 - k);
        }
        if (i >= candles.length - 2) state.save(i, candles.length, previous);
      }
      values = emaWasm(closes, period, kernels);
      wasmStates.set(values, state);
    } else {
      values = emaValues(candles.map((c) => c.close), period);
    }
    return {
      pane: 'main',
      lines: [{ key: 'value', values, color: colors[0] ?? '#ff6d00' }],
    };
  },
};
}

namespace ReferenceRsi {
// Frozen from HEAD before issue #62 compute optimizations.
/**
 * RSI — Wilder's relative strength index.
 *
 * @module
 */

const averages = new WeakMap<MutableSeries, TailState<number[]>>();

/**
 * Wilder RSI: initial average gain/loss over the first `period` changes,
 * then smoothed by `avg = (prev * (period - 1) + current) / period`.
 * RSI is 100 when average loss is 0, 0 when average gain is 0.
 */
export function rsiValues(closes: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(closes.length).fill(null);
  if (period <= 0 || closes.length <= period) return out;
  const state = new TailState<number[]>(value => value.slice());
  averages.set(out, state);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  state.save(period, closes.length, [avgGain, avgLoss]);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    if (i >= closes.length - 2) state.save(i, closes.length, [avgGain, avgLoss]);
  }
  return out;
}

/** Keep only the RSI lookback needed by a composite oscillator. */
export function retainRsi(out: (number | null)[], capacity: number): TailSeries {
  const retained = new TailSeries(out, capacity);
  const state = averages.get(out);
  if (state !== undefined) averages.set(retained, state);
  return retained;
}

/** Resume Wilder averages without inverting the rounded RSI ratio. */
export function updateRsi(out: MutableSeries, candles: readonly Candle[], from: number, period: number): boolean {
  const state = averages.get(out);
  const previous = state?.get(from - 1);
  if (previous === undefined) return false;
  let [gain, loss] = previous;
  for (let i = from; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    gain = (gain * (period - 1) + (change > 0 ? change : 0)) / period;
    loss = (loss * (period - 1) + (change < 0 ? -change : 0)) / period;
    setSeriesValue(out, i, loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
    state!.save(i, candles.length, [gain, loss]);
  }
  state!.prune(candles.length);
  return true;
}

/** RSI indicator definition (name `'rsi'`, param `period`, default 14). */
export const rsiIndicator: IndicatorDef = {
  name: 'rsi',
  label: 'Relative Strength Index',
  shortName: 'RSI',
  defaultParams: { period: 14 },
  defaultColors: ['#7e57c2'],
  defaultPane: 'sub',
  inputs: [{ key: 'period', label: 'RSI length', min: 1, step: 1, integer: true }],
  styles: [{ key: 'value', label: 'RSI', colorIndex: 0 }],
  update(output, candles, from, params) {
    if (!smallTail(candles.length, from)) return undefined;
    return updateRsi(output.lines[0].values as (number | null)[], candles, from,
      Math.max(1, Math.floor(params['period'] ?? 14))) ? output : undefined;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const period = Math.max(1, Math.floor(params['period'] ?? 14));
    const closes = candles.map((c) => c.close);
    return {
      pane: 'sub',
      lines: [{ key: 'value', values: rsiValues(closes, period), color: colors[0] ?? '#7e57c2' }],
    };
  },
};
}

namespace ReferenceAtr {
// Frozen from HEAD before issue #62 compute optimizations.
/**
 * ATR — Average True Range: Wilder's RMA of the true range (TradingView
 * `ta.atr`).
 *
 * @module
 */

/**
 * True range per bar: `high − low` on the first bar, then
 * `max(high − low, |high − prevClose|, |low − prevClose|)`.
 */
export function trueRangeValues(candles: readonly Candle[]): number[] {
  const out = new Array<number>(candles.length);
  for (let i = 0; i < candles.length; i++) out[i] = trueRange(candles, i);
  return out;
}

function trueRange(candles: readonly Candle[], i: number): number {
  const c = candles[i];
  if (i === 0) return c.high - c.low;
  const prevClose = candles[i - 1].close;
  return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
}

/**
 * Wilder's moving average (`ta.rma`): the SMA of the first `period` values
 * at index `period - 1`, then `v / period + prev × (1 − 1 / period)`.
 * `period` is floored, as in the rolling helpers; all null below 1.
 */
export function rmaValues(values: readonly number[], period: number): (number | null)[] {
  const out = new Array<number | null>(values.length).fill(null);
  const window = Math.floor(period);
  if (!(window >= 1) || values.length < window) return out;
  const alpha = 1 / window;
  let sum = 0;
  for (let i = 0; i < window; i++) sum += values[i];
  let prev = sum / window;
  out[window - 1] = prev;
  for (let i = window; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/** ATR over `period` bars (floored); null during the `period - 1` warmup bars. */
export function atrValues(candles: readonly Candle[], period: number): (number | null)[] {
  return rmaValues(trueRangeValues(candles), period);
}

/** ATR indicator definition (name `'atr'`, param `period`, default 14; sub-pane). */
export const atrIndicator: IndicatorDef = {
  name: 'atr',
  label: 'Average True Range',
  shortName: 'ATR',
  defaultParams: { period: 14 },
  defaultColors: ['#b71c1c'],
  defaultPane: 'sub',
  inputs: [{ key: 'period', label: 'Length', min: 1, step: 1, integer: true }],
  styles: [{ key: 'value', label: 'ATR', colorIndex: 0 }],
  update(output, candles, from, params) {
    const period = lengthParam(params, 'period', 14);
    // The recurrence continues from the cached value before `from`.
    if (from < period) return undefined;
    const values = output.lines[0].values as (number | null)[];
    const alpha = 1 / period;
    for (let i = from; i < candles.length; i++) {
      values[i] = alpha * trueRange(candles, i) + (1 - alpha) * (values[i - 1] as number);
    }
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const period = lengthParam(params, 'period', 14);
    return {
      pane: 'sub',
      lines: [{ key: 'value', values: atrValues(candles, period), color: colors[0] ?? '#b71c1c' }],
    };
  },
};
}

namespace ReferenceDonchian {
// Frozen from HEAD before issue #62 compute optimizations.
/**
 * Donchian Channels — highest high, lowest low and their midpoint over a
 * lookback, with a filled channel. Also provides the channel midpoint used
 * by Ichimoku.
 *
 * @module
 */

const { rollingMaxValues, rollingMinValues } = ReferenceRolling;

/**
 * Upper (highest high), lower (lowest low) and basis (their mean) over
 * `period` bars; null during warmup and for windows with NaN prices.
 * Computed in f64 JS so channel prices stay exact (no f32 kernels).
 */
export function donchianValues(
  candles: readonly Candle[],
  period: number,
): { upper: (number | null)[]; lower: (number | null)[]; basis: (number | null)[] } {
  const highs = rollingMaxValues(candles.map((c) => c.high), period);
  const lows = rollingMinValues(candles.map((c) => c.low), period);
  const upper = new Array<number | null>(candles.length);
  const lower = new Array<number | null>(candles.length);
  const basis = new Array<number | null>(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const hi = highs[i], lo = lows[i];
    upper[i] = Number.isNaN(hi) ? null : hi;
    lower[i] = Number.isNaN(lo) ? null : lo;
    basis[i] = Number.isNaN(hi) || Number.isNaN(lo) ? null : (hi + lo) / 2;
  }
  return { upper, lower, basis };
}

/**
 * Highest high and lowest low of the `period` bars ending at `i >= period - 1`
 * by direct scan, NaN-propagating like {@link rollingMaxValues}.
 */
export function windowExtremes(candles: readonly Candle[], i: number, period: number): { high: number; low: number } {
  let high = -Infinity;
  let low = Infinity;
  for (let at = i - period + 1; at <= i; at++) {
    high = Math.max(high, candles[at].high);
    low = Math.min(low, candles[at].low);
  }
  return { high, low };
}

/** Channel midpoint `(highest high + lowest low) / 2` at bar `i`, or null (warmup/NaN). */
export function windowMid(candles: readonly Candle[], i: number, period: number): number | null {
  if (i < period - 1) return null;
  const { high, low } = windowExtremes(candles, i, period);
  const mid = (high + low) / 2;
  return Number.isNaN(mid) ? null : mid;
}

/** Donchian Channels definition (name `'donchian'`, param `period`, default 20; main pane). */
export const donchianIndicator: IndicatorDef = {
  name: 'donchian',
  label: 'Donchian Channels',
  shortName: 'DC',
  defaultParams: { period: 20 },
  defaultColors: ['#ff6d00', '#2962ff', '#2962ff', 'rgba(33, 150, 243, 0.1)'],
  defaultPane: 'main',
  inputs: [{ key: 'period', label: 'Length', min: 1, step: 1, integer: true }],
  styles: [
    { key: 'basis', label: 'Basis', colorIndex: 0 },
    { key: 'upper', label: 'Upper', colorIndex: 1 },
    { key: 'lower', label: 'Lower', colorIndex: 2 },
    { key: 'background', label: 'Background', colorIndex: 3, kind: 'fill' },
  ],
  update(output, candles, from, params) {
    const period = lengthParam(params, 'period', 20);
    // Window rescans beat the linear pass only for short tails.
    if ((candles.length - from) * period > candles.length * 2) return undefined;
    const [basis, upper, lower] = output.lines.map((line) => line.values as (number | null)[]);
    for (let i = from; i < candles.length; i++) {
      if (i < period - 1) {
        upper[i] = lower[i] = basis[i] = null;
        continue;
      }
      const { high, low } = windowExtremes(candles, i, period);
      upper[i] = Number.isNaN(high) ? null : high;
      lower[i] = Number.isNaN(low) ? null : low;
      basis[i] = Number.isNaN(high) || Number.isNaN(low) ? null : (high + low) / 2;
    }
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const period = lengthParam(params, 'period', 20);
    const { upper, lower, basis } = donchianValues(candles, period);
    return {
      pane: 'main',
      lines: [
        { key: 'basis', values: basis, color: colors[0] ?? '#ff6d00' },
        { key: 'upper', values: upper, color: colors[1] ?? '#2962ff' },
        { key: 'lower', values: lower, color: colors[2] ?? '#2962ff' },
      ],
      fills: [{ key: 'background', upperKey: 'upper', lowerKey: 'lower', color: colors[3] ?? 'rgba(33, 150, 243, 0.1)' }],
    };
  },
};
}

namespace ReferenceStoch {
// Frozen from HEAD before issue #62 compute optimizations.
/**
 * Stochastic oscillator (TradingView "Stoch"): %K = SMA(stoch, smoothK),
 * %D = SMA(%K, smoothD), with 80/20 bands. Computed on raw prices in f64
 * JS: f32 kernels would shift %K by ~ulp(price) / range, which is visible
 * against TradingView on high-priced, narrow-range markets.
 *
 * @module
 */

const { rollingExtremes, smaSparseValues, updateSparse } = ReferenceRolling;

const rawStates = new WeakMap<readonly (number | null)[], TailSeries>();

/**
 * Raw stochastic (`ta.stoch`): `100 × (source − lowest(low)) / (highest(high)
 * − lowest(low))` over `period` bars. Null during warmup, for windows with
 * NaN, and on flat windows (TradingView's 0/0 is na). With `kernels` the
 * rolling extremes run in WASM on f32 values and the source is rounded to
 * f32 too, which keeps results within 0–100; pass kernels only for bounded
 * inputs (e.g. RSI) where f32 rounding is immaterial.
 */
export function stochValues(
  source: ArrayLike<number>,
  high: ArrayLike<number>,
  low: ArrayLike<number>,
  period: number,
  kernels: WasmKernels | null = null,
): (number | null)[] {
  const { max, min } = rollingExtremes(high, low, period, kernels);
  const out = new Array<number | null>(source.length).fill(null);
  for (let i = 0; i < source.length; i++) {
    const range = max[i] - min[i];
    if (Number.isNaN(range) || range === 0) continue;
    const value = kernels === null ? source[i] : Math.fround(source[i]);
    out[i] = 100 * (value - min[i]) / range;
  }
  return out;
}

/** Extremes are bounded windows; min/max preserve NaNs and signed zero. */
export function updateStoch(raw: MutableSeries, length: number, from: number, period: number,
  source: (i: number) => number, high: (i: number) => number, low: (i: number) => number): void {
  for (let i = from; i < length; i++) {
    let max = -Infinity, min = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      max = Math.max(max, high(j));
      min = Math.min(min, low(j));
    }
    const range = max - min;
    setSeriesValue(raw, i, Number.isNaN(range) || range === 0 ? null : 100 * (source(i) - min) / range);
  }
}

/** The 80/20 overbought/oversold bands shared by Stoch and Stoch RSI. */
export function stochBands(colors: readonly string[], upperIndex: number): IndicatorLevel[] {
  return [
    { key: 'upperBand', value: 80, color: colors[upperIndex] ?? '#787b86' },
    { key: 'lowerBand', value: 20, color: colors[upperIndex + 1] ?? '#787b86' },
  ];
}

/** Stochastic definition (params `period` = 14, `smoothK` = 1, `smoothD` = 3; sub-pane). */
export const stochIndicator: IndicatorDef = {
  name: 'stoch',
  label: 'Stochastic',
  shortName: 'Stoch',
  defaultParams: { period: 14, smoothK: 1, smoothD: 3 },
  defaultColors: ['#2962ff', '#ff6d00', '#787b86', '#787b86'],
  defaultPane: 'sub',
  inputs: [
    { key: 'period', label: '%K length', min: 1, step: 1, integer: true },
    { key: 'smoothK', label: '%K smoothing', min: 1, step: 1, integer: true },
    { key: 'smoothD', label: '%D smoothing', min: 1, step: 1, integer: true },
  ],
  styles: [
    { key: 'k', label: '%K', colorIndex: 0 },
    { key: 'd', label: '%D', colorIndex: 1 },
    { key: 'upperBand', label: 'Upper band', colorIndex: 2, kind: 'level' },
    { key: 'lowerBand', label: 'Lower band', colorIndex: 3, kind: 'level' },
  ],
  update(output, candles, from, params) {
    const period = lengthParam(params, 'period', 14);
    const k = output.lines[0].values as (number | null)[];
    const d = output.lines[1].values as (number | null)[];
    const raw = rawStates.get(k);
    if (raw === undefined || from < period || !smallTail(candles.length, from, period)) return undefined;
    updateStoch(raw, candles.length, from, period, i => candles[i].close, i => candles[i].high, i => candles[i].low);
    if (!updateSparse(k, raw, from, lengthParam(params, 'smoothK', 1))) return undefined;
    updateSparse(d, k, from, lengthParam(params, 'smoothD', 3));
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const raw = stochValues(
      candles.map((c) => c.close), candles.map((c) => c.high), candles.map((c) => c.low),
      lengthParam(params, 'period', 14),
    );
    const k = smaSparseValues(raw, lengthParam(params, 'smoothK', 1));
    const d = smaSparseValues(k, lengthParam(params, 'smoothD', 3));
    const smoothK = lengthParam(params, 'smoothK', 1);
    if (smoothK <= candles.length) rawStates.set(k, new TailSeries(raw, smoothK + TAIL_HISTORY_MARGIN));
    return {
      pane: 'sub',
      lines: [
        { key: 'k', values: k, color: colors[0] ?? '#2962ff' },
        { key: 'd', values: d, color: colors[1] ?? '#ff6d00' },
      ],
      levels: stochBands(colors, 2),
    };
  },
};
}

namespace ReferenceStochrsi {
// Frozen from HEAD before issue #62 compute optimizations.
/**
 * Stochastic RSI (TradingView "Stoch RSI"): the stochastic of Wilder's RSI,
 * %K = SMA(stoch(rsi), k), %D = SMA(%K, d), with 80/20 bands. The rolling
 * RSI extremes use the WASM kernels when available: RSI is bounded to
 * 0–100 (f32 error below 4e-6), so %K stays far inside display precision.
 *
 * @module
 */

const { rsiValues, updateRsi, retainRsi } = ReferenceRsi;
const { smaSparseValues, updateSparse } = ReferenceRolling;
const { stochBands, stochValues, updateStoch } = ReferenceStoch;

const states = new WeakMap<readonly (number | null)[], {
  rsi: TailSeries; raw: TailSeries;
}>();

/**
 * %K and %D of the Stochastic RSI. Null until RSI and both smoothing
 * windows are warm, and where the RSI window is flat (0/0). Every length is
 * floored.
 */
export function stochRsiValues(
  closes: readonly number[],
  rsiPeriod: number,
  stochPeriod: number,
  smoothK: number,
  smoothD: number,
  kernels: WasmKernels | null = null,
): { k: (number | null)[]; d: (number | null)[] } {
  const rsiValuesOut = rsiValues(closes, Math.floor(rsiPeriod));
  const rsi = Float64Array.from(rsiValuesOut, (v) => v ?? NaN);
  const raw = stochValues(rsi, rsi, rsi, stochPeriod, kernels);
  const k = smaSparseValues(raw, smoothK);
  if (stochPeriod >= 1 && stochPeriod <= closes.length && smoothK >= 1 && smoothK <= closes.length) {
    states.set(k, { rsi: retainRsi(rsiValuesOut, Math.floor(stochPeriod) + TAIL_HISTORY_MARGIN),
      raw: new TailSeries(raw, Math.floor(smoothK) + TAIL_HISTORY_MARGIN) });
  }
  return { k, d: smaSparseValues(k, smoothD) };
}

/** Stochastic RSI definition (params `rsi` = 14, `stoch` = 14, `k` = 3, `d` = 3; sub-pane). */
export const stochRsiIndicator: IndicatorDef = {
  name: 'stochrsi',
  label: 'Stochastic RSI',
  shortName: 'Stoch RSI',
  defaultParams: { rsi: 14, stoch: 14, k: 3, d: 3 },
  defaultColors: ['#2962ff', '#ff6d00', '#787b86', '#787b86'],
  defaultPane: 'sub',
  inputs: [
    { key: 'k', label: 'K', min: 1, step: 1, integer: true },
    { key: 'd', label: 'D', min: 1, step: 1, integer: true },
    { key: 'rsi', label: 'RSI length', min: 1, step: 1, integer: true },
    { key: 'stoch', label: 'Stochastic length', min: 1, step: 1, integer: true },
  ],
  styles: [
    { key: 'k', label: 'K', colorIndex: 0 },
    { key: 'd', label: 'D', colorIndex: 1 },
    { key: 'upperBand', label: 'Upper band', colorIndex: 2, kind: 'level' },
    { key: 'lowerBand', label: 'Lower band', colorIndex: 3, kind: 'level' },
  ],
  update(output, candles, from, params, _colors, kernels) {
    const k = output.lines[0].values as (number | null)[];
    const d = output.lines[1].values as (number | null)[];
    const state = states.get(k);
    const period = lengthParam(params, 'stoch', 14);
    if (state === undefined || from < period || !smallTail(candles.length, from, period)) return undefined;
    if (!updateRsi(state.rsi, candles, from, lengthParam(params, 'rsi', 14))) return undefined;
    const value = kernels === null
      ? (i: number): number => state.rsi.at(i) ?? NaN
      : (i: number): number => Math.fround(state.rsi.at(i) ?? NaN);
    updateStoch(state.raw, candles.length, from, period, value, value, value);
    // The RSI checkpoint also guarantees both smoothing checkpoints exist.
    updateSparse(k, state.raw, from, lengthParam(params, 'k', 3));
    updateSparse(d, k, from, lengthParam(params, 'd', 3));
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[], kernels: WasmKernels | null) {
    const { k, d } = stochRsiValues(
      candles.map((c) => c.close),
      lengthParam(params, 'rsi', 14), lengthParam(params, 'stoch', 14),
      lengthParam(params, 'k', 3), lengthParam(params, 'd', 3), kernels,
    );
    return {
      pane: 'sub',
      lines: [
        { key: 'k', values: k, color: colors[0] ?? '#2962ff' },
        { key: 'd', values: d, color: colors[1] ?? '#ff6d00' },
      ],
      levels: stochBands(colors, 2),
    };
  },
};
}

namespace ReferenceIchimoku {
// Frozen from HEAD before issue #62 compute optimizations.
/**
 * Ichimoku Cloud — TradingView's definition: Donchian midpoints for the
 * conversion (tenkan), base (kijun) and leading span B lines, leading span A
 * as their mean, both leading spans plotted `displacement - 1` bars ahead,
 * the lagging span (close) `displacement - 1` bars back, and the Kumo filled
 * between the leading spans.
 *
 * @module
 */

const { rollingMaxValues, rollingMinValues } = ReferenceRolling;
const { windowMid } = ReferenceDonchian;

/** Ichimoku line values aligned to their source bars (apply the offsets when plotting). */
export interface IchimokuValues {
  tenkan: (number | null)[];
  kijun: (number | null)[];
  senkouA: (number | null)[];
  senkouB: (number | null)[];
  chikou: (number | null)[];
}

function midline(highs: readonly number[], lows: readonly number[], period: number): (number | null)[] {
  const high = rollingMaxValues(highs, period);
  const low = rollingMinValues(lows, period);
  const out = new Array<number | null>(highs.length);
  for (let i = 0; i < highs.length; i++) {
    const mid = (high[i] + low[i]) / 2;
    out[i] = Number.isNaN(mid) ? null : mid;
  }
  return out;
}

/**
 * Computes the five Ichimoku lines in f64 JS (exact channel prices; the
 * f32 WASM kernels would round them). Values are indexed by source bar.
 */
export function ichimokuValues(
  candles: readonly Candle[],
  conversion: number,
  base: number,
  span: number,
): IchimokuValues {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const tenkan = midline(highs, lows, conversion);
  const kijun = midline(highs, lows, base);
  const senkouB = midline(highs, lows, span);
  const senkouA = tenkan.map((t, i) => (t === null || kijun[i] === null ? null : (t + (kijun[i] as number)) / 2));
  const chikou = candles.map((c) => c.close);
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

function lengths(params: Record<string, number>): [number, number, number, number] {
  return [
    lengthParam(params, 'conversion', 9),
    lengthParam(params, 'base', 26),
    lengthParam(params, 'span', 52),
    lengthParam(params, 'displacement', 26),
  ];
}

/**
 * Ichimoku Cloud definition (params `conversion` = 9, `base` = 26,
 * `span` = 52, `displacement` = 26; main pane). Line keys: `tenkan`,
 * `kijun`, `chikou`, `senkouA`, `senkouB`; fill key `kumo`.
 */
export const ichimokuIndicator: IndicatorDef = {
  name: 'ichimoku',
  label: 'Ichimoku Cloud',
  shortName: 'Ichimoku',
  defaultParams: { conversion: 9, base: 26, span: 52, displacement: 26 },
  defaultColors: ['#2962ff', '#b71c1c', '#43a047', '#a5d6a7', '#ef9a9a', 'rgba(67, 160, 71, 0.1)', 'rgba(244, 67, 54, 0.1)'],
  defaultPane: 'main',
  inputs: [
    { key: 'conversion', label: 'Conversion line length', min: 1, step: 1, integer: true },
    { key: 'base', label: 'Base line length', min: 1, step: 1, integer: true },
    { key: 'span', label: 'Leading span B length', min: 1, step: 1, integer: true },
    { key: 'displacement', label: 'Lagging span', min: 1, step: 1, integer: true },
  ],
  styles: [
    { key: 'tenkan', label: 'Conversion line', colorIndex: 0 },
    { key: 'kijun', label: 'Base line', colorIndex: 1 },
    { key: 'chikou', label: 'Lagging span', colorIndex: 2 },
    { key: 'senkouA', label: 'Leading span A', colorIndex: 3 },
    { key: 'senkouB', label: 'Leading span B', colorIndex: 4 },
    { key: 'kumo', label: 'Kumo bullish', colorIndex: 5, kind: 'fill' },
    { key: 'kumo', label: 'Kumo bearish', colorIndex: 6, kind: 'fill' },
  ],
  update(output, candles, from, params) {
    const [conversion, base, span] = lengths(params);
    // Window rescans beat the linear pass only for short tails.
    if ((candles.length - from) * Math.max(conversion, base, span) > candles.length * 2) return undefined;
    const [tenkan, kijun, chikou, senkouA, senkouB] = output.lines.map((line) => line.values as (number | null)[]);
    for (let i = from; i < candles.length; i++) {
      const t = windowMid(candles, i, conversion);
      const k = windowMid(candles, i, base);
      tenkan[i] = t;
      kijun[i] = k;
      senkouA[i] = t === null || k === null ? null : (t + k) / 2;
      senkouB[i] = windowMid(candles, i, span);
      chikou[i] = candles[i].close;
    }
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const [conversion, base, span, displacement] = lengths(params);
    const shift = displacement - 1;
    const { tenkan, kijun, senkouA, senkouB, chikou } = ichimokuValues(candles, conversion, base, span);
    return {
      pane: 'main',
      lines: [
        { key: 'tenkan', values: tenkan, color: colors[0] ?? '#2962ff' },
        { key: 'kijun', values: kijun, color: colors[1] ?? '#b71c1c' },
        // `0 - shift` keeps a zero displacement at +0 rather than -0.
        { key: 'chikou', values: chikou, color: colors[2] ?? '#43a047', offset: 0 - shift },
        { key: 'senkouA', values: senkouA, color: colors[3] ?? '#a5d6a7', offset: shift },
        { key: 'senkouB', values: senkouB, color: colors[4] ?? '#ef9a9a', offset: shift },
      ],
      fills: [{
        key: 'kumo', upperKey: 'senkouA', lowerKey: 'senkouB',
        color: colors[5] ?? 'rgba(67, 160, 71, 0.1)', colorBelow: colors[6] ?? 'rgba(244, 67, 54, 0.1)',
      }],
    };
  },
};
}

const { smaIndicator : sma } = ReferenceSma;
const { emaIndicator : ema } = ReferenceEma;
const { rsiIndicator : rsi } = ReferenceRsi;
const { atrIndicator : atr } = ReferenceAtr;
const { donchianIndicator : donchian } = ReferenceDonchian;
const { stochIndicator : stoch } = ReferenceStoch;
const { stochRsiIndicator : stochrsi, stochRsiValues : referenceStochRsi } = ReferenceStochrsi;
const { ichimokuIndicator : ichimoku } = ReferenceIchimoku;
const referenceRolling = ReferenceRolling;
const { stochValues : referenceStoch } = ReferenceStoch;
const { smaValues : referenceSma } = ReferenceSma;
const { emaValues : referenceEma } = ReferenceEma;
const { rsiValues : referenceRsi } = ReferenceRsi;

function walk(length: number, seed: number, mode: number): Candle[] {
  let close = 100;
  return Array.from({ length }, (_, time) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const open = close;
    close += seed / 4294967296 - 0.5;
    const candle = { time, open, close, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1 };
    if (mode === 1 && time % 17 === 3) candle.high = candle.low = candle.close = NaN;
    if (mode === 2) {
      // Also exercise runtime nulls, infinities, signed zero, and flat windows.
      const value = [0, -0, Infinity, -Infinity, null, NaN, 1][time % 7] as number;
      candle.close = candle.high = candle.low = value;
    }
    if (mode === 3) candle.close = candle.high = candle.low = -0;
    return candle;
  });
}

const variants: Record<string, number>[] = [
  {},
  { period: 1, rsi: 1, stoch: 1, k: 1, d: 1, smoothK: 1, smoothD: 1, conversion: 1, base: 1, span: 1, displacement: 1 },
  { period: 7, rsi: 5, stoch: 6, k: 2, d: 4, smoothK: 3, smoothD: 2, conversion: 3, base: 7, span: 11, displacement: 4 },
  { period: 1001, rsi: 1001, stoch: 1001, k: 1001, d: 1001, conversion: 1001, base: 1001, span: 1001 },
  { period: 3.7, rsi: 3.7, stoch: 3.7, k: 2.7, d: 2.7 },
  { period: NaN, rsi: NaN, stoch: NaN, k: NaN, d: NaN, conversion: NaN, base: NaN, span: NaN },
  { period: Infinity, rsi: Infinity, stoch: Infinity, k: Infinity, d: Infinity },
];

it('full compute matches frozen pre-optimization implementations with Object.is number semantics', async () => {
  const wasm = await initWasm();
  assert.ok(wasm);
  for (const reference of [sma, ema, rsi, atr, donchian, stoch, stochrsi, ichimoku]) {
    const current = BUILTIN_INDICATORS.find(def => def.name === reference.name)!;
    for (const kernels of [null, wasm]) for (const seed of [1, 47, 901]) {
      for (const length of [0, 1, 6, 7, 8, 9, 13, 14, 19, 20, 25, 26, 51, 52, 1000]) for (const mode of [0, 1, 2, 3]) {
        const candles = walk(length, seed, mode);
        for (const params of variants) {
          let expected;
          try { expected = reference.compute(candles, params, [], kernels); }
          catch (error) {
            // Existing WASM kernels reject some non-finite periods with a trap.
            assert.throws(() => current.compute(candles, params, [], kernels), (actual: unknown) =>
              actual instanceof Error && error instanceof Error && actual.constructor === error.constructor && actual.message === error.message);
            continue;
          }
          const actual = current.compute(candles, params, [], kernels);
          // strict deepEqual compares number leaves using Object.is and detects holes.
          assert.deepEqual(actual, expected, `${reference.name}, seed=${seed}, length=${length}, mode=${mode}, params=${JSON.stringify(params)}, wasm=${!!kernels}`);
          for (const line of actual.lines) for (let i = 0; i < line.values.length; i++) {
            assert.ok(Object.hasOwn(line.values, i), `${reference.name}: output hole at ${i}`);
          }
        }
      }
    }
  }
});

it('rolling and composite scalar helpers retain invalid-window, gap and signed-zero semantics', async () => {
  for (const kernels of [null, await initWasm()]) for (const length of [0, 1, 6, 7, 8, 1000]) {
    for (const mode of [0, 1, 2, 3]) {
      const candles = walk(length, 47, mode);
      const values = candles.map(c => c.close);
      for (const period of [-1, 0, 1, 2, 7, 7.9, 1001, NaN, Infinity]) {
        assert.deepEqual(rollingMaxValues(values, period), referenceRolling.rollingMaxValues(values, period));
        assert.deepEqual(rollingMinValues(values, period), referenceRolling.rollingMinValues(values, period));
        const extremes = rollingCandleExtremes(candles, period);
        assert.deepEqual(extremes.max, referenceRolling.rollingMaxValues(candles.map(c => c.high), period));
        assert.deepEqual(extremes.min, referenceRolling.rollingMinValues(candles.map(c => c.low), period));
        const sparse = values.map((v, i) => i % 5 === 0 ? null : v);
        assert.deepEqual(smaSparseValues(sparse, period), referenceRolling.smaSparseValues(sparse, period));
        assert.deepEqual(stochValues(values, values, values, period, kernels), referenceStoch(values, values, values, period, kernels));
        assert.deepEqual(stochRsiValues(values, period, period, period, period, kernels), referenceStochRsi(values, period, period, period, period, kernels));
        // Indicator params sanitize negative/zero periods before these helpers.
        for (const [current, reference] of [[smaCandleValues, referenceSma], [emaCandleValues, referenceEma], [rsiCandleValues, referenceRsi]] as const) {
          if (Number.isInteger(period) || !Number.isFinite(period)) assert.deepEqual(current(candles, period), reference(values, period));
        }
      }
    }
  }
});
