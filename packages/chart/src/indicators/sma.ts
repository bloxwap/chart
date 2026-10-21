/**
 * SMA — simple moving average of close prices.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import { TailState, smallTail } from './tail.js';
import type { WasmKernels } from '../wasm/loader.js';

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

/** Full compute directly from candle closes, retaining recurrence checkpoints. */
export function smaCandleValues(candles: readonly Candle[], period: number): (number | null)[] {
  if (Number.isNaN(period)) return smaValues(candles.map(c => c.close), period);
  const out: (number | null)[] = new Array<number | null>(candles.length);
  if (period <= 0 || candles.length < period) return out.fill(null);
  out.fill(null, 0, period - 1);
  const state = new TailState<number>(value => value);
  sums.set(out, state);
  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) out[i] = sum / period;
    if (i >= candles.length - 2) state.save(i, candles.length, sum);
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
      values = smaCandleValues(candles, period);
    }
    return {
      pane: 'main',
      lines: [{ key: 'value', values, color: colors[0] ?? '#2962ff' }],
    };
  },
};
