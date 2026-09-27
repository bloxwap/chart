/**
 * BOLL — Bollinger Bands: SMA mid line ± `mult` population standard deviations.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import { smaValues } from './sma.js';

/**
 * Population standard deviation in O(length) time and O(period) scratch space.
 * Each window combines a suffix of the preceding block with the current
 * block's prefix. Centered Welford moments avoid subtracting nearly equal
 * squares (or subtracting an outgoing outlier from a rolling variance).
 */
export function stddevValues(values: readonly number[], period: number): (number | null)[] {
  const out = new Array<number | null>(values.length).fill(null);
  if (!Number.isInteger(period) || period <= 0 || values.length < period) return out;
  const suffixMean = new Float64Array(period);
  const suffixM2 = new Float64Array(period);
  let previousOrigin = 0;
  let origin = 0;
  let mean = 0;
  let m2 = 0;
  for (let i = 0; i < values.length; i++) {
    const offset = i % period;
    if (offset === 0) {
      if (i >= period) {
        previousOrigin = Number.isFinite(values[i - 1]) ? values[i - 1] : 0;
        let suffixAvg = 0;
        let suffixSq = 0;
        for (let j = period - 1; j >= 0; j--) {
          const value = values[i - period + j] - previousOrigin;
          const delta = value - suffixAvg;
          suffixAvg += delta / (period - j);
          suffixSq += delta * (value - suffixAvg);
          suffixMean[j] = suffixAvg;
          suffixM2[j] = suffixSq;
        }
      }
      origin = Number.isFinite(values[i]) ? values[i] : 0;
      mean = 0;
      m2 = 0;
    }
    const count = offset + 1;
    const value = values[i] - origin;
    const delta = value - mean;
    mean += delta / count;
    m2 += delta * (value - mean);
    if (i < period - 1) continue;
    let variance = m2;
    if (count < period) {
      const difference = (origin - previousOrigin) + mean - suffixMean[count];
      variance += suffixM2[count] + difference * difference * count * (period - count) / period;
    }
    out[i] = Math.sqrt(Math.max(0, variance / period));
  }
  return out;
}

/** BOLL indicator definition (params `period` = 20, `mult` = 2). */
export const bollIndicator: IndicatorDef = {
  name: 'boll',
  label: 'Bollinger Bands',
  shortName: 'BB',
  defaultParams: { period: 20, mult: 2 },
  defaultColors: ['#2962ff', '#ab47bc', '#ab47bc'],
  defaultPane: 'main',
  inputs: [
    { key: 'period', label: 'Length', min: 1, step: 1, integer: true },
    { key: 'mult', label: 'StdDev', min: 0.001, max: 50, step: 0.1 },
  ],
  styles: [
    { key: 'mid', label: 'Basis', colorIndex: 0 },
    { key: 'upper', label: 'Upper', colorIndex: 1 },
    { key: 'lower', label: 'Lower', colorIndex: 2 },
  ],
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const period = Math.max(1, Math.floor(params['period'] ?? 20));
    const mult = params['mult'] ?? 2;
    const closes = candles.map((c) => c.close);
    const mid = smaValues(closes, period);
    const std = stddevValues(closes, period);
    const upper: (number | null)[] = new Array<number | null>(mid.length).fill(null);
    const lower: (number | null)[] = new Array<number | null>(mid.length).fill(null);
    // mid and std warm up together, so a non-null mid implies a non-null std.
    for (let i = 0; i < mid.length; i++) {
      const m = mid[i];
      if (m === null) continue;
      const s = std[i] as number;
      upper[i] = m + mult * s;
      lower[i] = m - mult * s;
    }
    return {
      pane: 'main',
      lines: [
        { key: 'mid', values: mid, color: colors[0] ?? '#2962ff' },
        { key: 'upper', values: upper, color: colors[1] ?? '#ab47bc' },
        { key: 'lower', values: lower, color: colors[2] ?? '#ab47bc' },
      ],
    };
  },
};
