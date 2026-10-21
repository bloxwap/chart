/**
 * EMA — exponential moving average of close prices (SMA-seeded, k = 2/(p+1)).
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import { TailState, smallTail } from './tail.js';
import type { WasmKernels } from '../wasm/loader.js';

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
