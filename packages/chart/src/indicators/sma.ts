/**
 * SMA — simple moving average of close prices.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import type { WasmKernels } from '../wasm/loader.js';

/** Scalar SMA: `out[i] = mean(values[i-period+1 .. i])`, null during warmup. */
export function smaValues(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
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
      for (let i = 0; i < candles.length; i++) closes[i] = candles[i].close;
      values = smaWasm(closes, period, kernels);
    } else {
      values = smaValues(candles.map((c) => c.close), period);
    }
    return {
      pane: 'main',
      lines: [{ key: 'value', values, color: colors[0] ?? '#2962ff' }],
    };
  },
};
