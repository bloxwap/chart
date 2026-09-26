/**
 * KDJ — stochastic oscillator with 1/3 smoothing (K, D) and J = 3K − 2D.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';

/**
 * Classic KDJ. RSV = (close − lowestLow(n)) / (highestHigh(n) − lowestLow(n)) × 100
 * (50 on a flat window); K and D start at 50 and smooth RSV/K by 1/3.
 * Values are null until the first full window at index `n - 1`.
 */
export function kdjValues(
  candles: readonly Candle[],
  n: number,
): { k: (number | null)[]; d: (number | null)[]; j: (number | null)[] } {
  const len = candles.length;
  const k: (number | null)[] = new Array<number | null>(len).fill(null);
  const d: (number | null)[] = new Array<number | null>(len).fill(null);
  const j: (number | null)[] = new Array<number | null>(len).fill(null);
  if (n <= 0 || len < n) return { k, d, j };
  let prevK = 50;
  let prevD = 50;
  for (let i = n - 1; i < len; i++) {
    let low = Infinity;
    let high = -Infinity;
    for (let m = i - n + 1; m <= i; m++) {
      const c = candles[m];
      if (c.low < low) low = c.low;
      if (c.high > high) high = c.high;
    }
    const close = candles[i].close;
    const rsv = high === low ? 50 : ((close - low) / (high - low)) * 100;
    const curK = (2 / 3) * prevK + (1 / 3) * rsv;
    const curD = (2 / 3) * prevD + (1 / 3) * curK;
    k[i] = curK;
    d[i] = curD;
    j[i] = 3 * curK - 2 * curD;
    prevK = curK;
    prevD = curD;
  }
  return { k, d, j };
}

/** KDJ indicator definition (name `'kdj'`, param `period`, default 9). */
export const kdjIndicator: IndicatorDef = {
  name: 'kdj',
  defaultParams: { period: 9 },
  defaultColors: ['#2962ff', '#ff6d00', '#ab47bc'],
  defaultPane: 'sub',
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const period = Math.max(1, Math.floor(params['period'] ?? 9));
    const { k, d, j } = kdjValues(candles, period);
    return {
      pane: 'sub',
      lines: [
        { key: 'k', values: k, color: colors[0] ?? '#2962ff' },
        { key: 'd', values: d, color: colors[1] ?? '#ff6d00' },
        { key: 'j', values: j, color: colors[2] ?? '#ab47bc' },
      ],
    };
  },
};
