/**
 * EMA — exponential moving average of close prices (SMA-seeded, k = 2/(p+1)).
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import type { WasmKernels } from '../wasm/loader.js';

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

/** EMA via the WASM kernel: NaNs become `null`. */
export function emaWasm(values: readonly number[], period: number, kernels: WasmKernels): (number | null)[] {
  const out = kernels.ema(Float32Array.from(values), period);
  return Array.from(out, (v) => (Number.isNaN(v) ? null : v));
}

/** EMA indicator definition (name `'ema'`, param `period`, default 20). */
export const emaIndicator: IndicatorDef = {
  name: 'ema',
  defaultParams: { period: 20 },
  defaultColors: ['#ff6d00'],
  defaultPane: 'main',
  compute(
    candles: readonly Candle[],
    params: Record<string, number>,
    colors: readonly string[],
    kernels: WasmKernels | null,
  ) {
    const period = Math.max(1, Math.floor(params['period'] ?? 20));
    const closes = candles.map((c) => c.close);
    const values = kernels !== null ? emaWasm(closes, period, kernels) : emaValues(closes, period);
    return {
      pane: 'main',
      lines: [{ key: 'value', values, color: colors[0] ?? '#ff6d00' }],
    };
  },
};
