/**
 * Stochastic oscillator (TradingView "Stoch"): %K = SMA(stoch, smoothK),
 * %D = SMA(%K, smoothD), with 80/20 bands. Computed on raw prices in f64
 * JS: f32 kernels would shift %K by ~ulp(price) / range, which is visible
 * against TradingView on high-priced, narrow-range markets.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef, IndicatorLevel } from './types.js';
import type { WasmKernels } from '../wasm/loader.js';
import { rollingExtremes, smaSparseValues } from './rolling.js';
import { lengthParam } from './params.js';

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
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const raw = stochValues(
      candles.map((c) => c.close), candles.map((c) => c.high), candles.map((c) => c.low),
      lengthParam(params, 'period', 14),
    );
    const k = smaSparseValues(raw, lengthParam(params, 'smoothK', 1));
    const d = smaSparseValues(k, lengthParam(params, 'smoothD', 3));
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
