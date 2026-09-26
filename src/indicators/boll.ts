/**
 * BOLL — Bollinger Bands: SMA mid line ± `mult` population standard deviations.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import { smaValues } from './sma.js';

/**
 * Population standard deviation over sliding windows of `period`,
 * aligned like {@link smaValues} (null during warmup).
 */
export function stddevValues(values: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    const mean = sum / period;
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean;
      sq += d * d;
    }
    out[i] = Math.sqrt(sq / period);
  }
  return out;
}

/** BOLL indicator definition (params `period` = 20, `mult` = 2). */
export const bollIndicator: IndicatorDef = {
  name: 'boll',
  defaultParams: { period: 20, mult: 2 },
  defaultColors: ['#2962ff', '#ab47bc', '#ab47bc'],
  defaultPane: 'main',
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const period = Math.max(1, Math.floor(params['period'] ?? 20));
    const mult = params['mult'] ?? 2;
    const mid = smaValues(candles.map((c) => c.close), period);
    const std = stddevValues(candles.map((c) => c.close), period);
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
