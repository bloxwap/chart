/**
 * CCI — commodity channel index of HLC3 (TradingView's definition).
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef, IndicatorLevel } from './types.js';
import type { StudyMeta } from './study-meta.js';
import { typicalPrice } from './candle-values.js';
import { windowSums } from './window-sums.js';

/**
 * CCI of the window of `prices` ending at `end` given its mean, or null on a
 * flat window (zero mean deviation, where TradingView divides 0 by 0).
 */
function cciAt(prices: Float64Array, end: number, period: number, mean: number): number | null {
  const price = prices[end];
  let deviation = 0;
  let flat = true;
  for (let j = end - period + 1; j <= end; j++) {
    deviation += Math.abs(prices[j] - mean);
    if (prices[j] !== price) flat = false;
  }
  return flat ? null : (price - mean) / (0.015 * (deviation / period));
}

/**
 * Writes CCI from index `from`. Window means come from subtraction-free
 * block sums, so tail updates reproduce full computes exactly; the mean
 * deviation is O(period) per candle, as in TradingView.
 */
function fillCci(candles: readonly Candle[], period: number, values: (number | null)[], from: number): void {
  // The negated `>=` keeps every value null for NaN/Infinity periods too.
  let first = from;
  while (first < candles.length && !(first >= period - 1)) values[first++] = null;
  if (first === candles.length) return;
  const base = first - period + 1;
  const prices = new Float64Array(candles.length - base);
  for (let k = 0; k < prices.length; k++) prices[k] = typicalPrice(candles[base + k]);
  const sums = windowSums(prices, base, period, first);
  for (let i = first; i < candles.length; i++) values[i] = cciAt(prices, i - base, period, sums[i - first] / period);
}

function periodParam(params: Record<string, number>): number {
  return Math.max(1, Math.floor(params['period'] ?? 20));
}

/**
 * CCI = (tp − SMA(tp, n)) / (0.015 · meanDeviation(tp, n)) with tp = HLC3.
 * Null during the first `period − 1` candles and on flat windows.
 */
export function cciValues(candles: readonly Candle[], period = 20): (number | null)[] {
  const values = new Array<number | null>(candles.length).fill(null);
  fillCci(candles, periodParam({ period }), values, 0);
  return values;
}

/** The ±100 overbought/oversold bands (keys `upperBand`/`lowerBand`, colors 1 and 2). */
function cciBands(colors: readonly string[]): IndicatorLevel[] {
  return [
    { key: 'upperBand', value: 100, color: colors[1] ?? '#787b86' },
    { key: 'lowerBand', value: -100, color: colors[2] ?? '#787b86' },
  ];
}

/** Display metadata for {@link cciIndicator}. */
export const cciMeta: StudyMeta = {
  label: 'Commodity Channel Index',
  shortName: 'CCI',
  inputs: [{ key: 'period', label: 'Length', min: 1, max: 2000, step: 1, integer: true }],
  styles: [
    { key: 'cci', label: 'CCI', colorIndex: 0, kind: 'line' },
    { key: 'upperBand', label: 'Upper band', colorIndex: 1, kind: 'level' },
    { key: 'lowerBand', label: 'Lower band', colorIndex: 2, kind: 'level' },
  ],
};

/** CCI indicator definition (name `'cci'`, sub pane, param `period`, default 20; ±100 bands). */
export const cciIndicator: IndicatorDef = {
  name: 'cci',
  ...cciMeta,
  defaultParams: { period: 20 },
  defaultColors: ['#2196f3', '#787b86', '#787b86'],
  defaultPane: 'sub',
  update(output, candles, from, params) {
    fillCci(candles, periodParam(params), output.lines[0].values as (number | null)[], from);
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const values = new Array<number | null>(candles.length).fill(null);
    fillCci(candles, periodParam(params), values, 0);
    return { pane: 'sub', lines: [{ key: 'cci', values, color: colors[0] ?? '#2196f3' }], levels: cciBands(colors) };
  },
};
