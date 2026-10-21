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
import { smallTail, TailSeries, TAIL_HISTORY_MARGIN, setSeriesValue, type MutableSeries } from './tail.js';
import { rollingCandleExtremes, rollingExtremes, smaSparseValues, updateSparse } from './rolling.js';
import { lengthParam } from './params.js';

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
  const out = new Array<number | null>(source.length);
  for (let i = 0; i < source.length; i++) {
    const range = max[i] - min[i];
    if (Number.isNaN(range) || range === 0) { out[i] = null; continue; }
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
    const { max, min } = rollingCandleExtremes(candles, lengthParam(params, 'period', 14));
    const raw = new Array<number | null>(candles.length);
    for (let i = 0; i < candles.length; i++) {
      const range = max[i] - min[i];
      raw[i] = Number.isNaN(range) || range === 0 ? null : 100 * (candles[i].close - min[i]) / range;
    }
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
