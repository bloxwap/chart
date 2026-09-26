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
  if (!Number.isInteger(n) || n <= 0 || len < n) return { k, d, j };
  // Monotonic index queues: each bar enters/leaves once, using O(n) memory
  // for the lookback window rather than rescanning it for every candle.
  const lows = new Uint32Array(n);
  const highs = new Uint32Array(n);
  let lowHead = 0, lowTail = 0, highHead = 0, highTail = 0;
  let prevK = 50;
  let prevD = 50;
  for (let i = 0; i < len; i++) {
    if (lowHead < lowTail && lows[lowHead % n] <= i - n) lowHead++;
    if (highHead < highTail && highs[highHead % n] <= i - n) highHead++;
    const c = candles[i];
    if (!Number.isNaN(c.low)) {
      while (lowHead < lowTail && candles[lows[(lowTail - 1) % n]].low >= c.low) lowTail--;
      lows[lowTail++ % n] = i;
    }
    if (!Number.isNaN(c.high)) {
      while (highHead < highTail && candles[highs[(highTail - 1) % n]].high <= c.high) highTail--;
      highs[highTail++ % n] = i;
    }
    if (i < n - 1) continue;
    const low = lowHead < lowTail ? candles[lows[lowHead % n]].low : Infinity;
    const high = highHead < highTail ? candles[highs[highHead % n]].high : -Infinity;
    const close = c.close;
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
