/**
 * Stochastic RSI (TradingView "Stoch RSI"): the stochastic of Wilder's RSI,
 * %K = SMA(stoch(rsi), k), %D = SMA(%K, d), with 80/20 bands. The rolling
 * RSI extremes use the WASM kernels when available: RSI is bounded to
 * 0–100 (f32 error below 4e-6), so %K stays far inside display precision.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import type { WasmKernels } from '../wasm/loader.js';
import { rsiValues } from './rsi.js';
import { smaSparseValues } from './rolling.js';
import { stochBands, stochValues } from './stoch.js';
import { lengthParam } from './params.js';

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
  const rsi = Float64Array.from(rsiValues(closes, Math.floor(rsiPeriod)), (v) => v ?? NaN);
  const k = smaSparseValues(stochValues(rsi, rsi, rsi, stochPeriod, kernels), smoothK);
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
