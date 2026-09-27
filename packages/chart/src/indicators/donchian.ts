/**
 * Donchian Channels — highest high, lowest low and their midpoint over a
 * lookback, with a filled channel. Also provides the channel midpoint used
 * by Ichimoku.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import { rollingMaxValues, rollingMinValues } from './rolling.js';
import { lengthParam } from './params.js';

/**
 * Upper (highest high), lower (lowest low) and basis (their mean) over
 * `period` bars; null during warmup and for windows with NaN prices.
 * Computed in f64 JS so channel prices stay exact (no f32 kernels).
 */
export function donchianValues(
  candles: readonly Candle[],
  period: number,
): { upper: (number | null)[]; lower: (number | null)[]; basis: (number | null)[] } {
  const highs = rollingMaxValues(candles.map((c) => c.high), period);
  const lows = rollingMinValues(candles.map((c) => c.low), period);
  const upper = new Array<number | null>(candles.length);
  const lower = new Array<number | null>(candles.length);
  const basis = new Array<number | null>(candles.length);
  for (let i = 0; i < candles.length; i++) {
    const hi = highs[i], lo = lows[i];
    upper[i] = Number.isNaN(hi) ? null : hi;
    lower[i] = Number.isNaN(lo) ? null : lo;
    basis[i] = Number.isNaN(hi) || Number.isNaN(lo) ? null : (hi + lo) / 2;
  }
  return { upper, lower, basis };
}

/**
 * Highest high and lowest low of the `period` bars ending at `i >= period - 1`
 * by direct scan, NaN-propagating like {@link rollingMaxValues}.
 */
export function windowExtremes(candles: readonly Candle[], i: number, period: number): { high: number; low: number } {
  let high = -Infinity;
  let low = Infinity;
  for (let at = i - period + 1; at <= i; at++) {
    high = Math.max(high, candles[at].high);
    low = Math.min(low, candles[at].low);
  }
  return { high, low };
}

/** Channel midpoint `(highest high + lowest low) / 2` at bar `i`, or null (warmup/NaN). */
export function windowMid(candles: readonly Candle[], i: number, period: number): number | null {
  if (i < period - 1) return null;
  const { high, low } = windowExtremes(candles, i, period);
  const mid = (high + low) / 2;
  return Number.isNaN(mid) ? null : mid;
}

/** Donchian Channels definition (name `'donchian'`, param `period`, default 20; main pane). */
export const donchianIndicator: IndicatorDef = {
  name: 'donchian',
  label: 'Donchian Channels',
  shortName: 'DC',
  defaultParams: { period: 20 },
  defaultColors: ['#ff6d00', '#2962ff', '#2962ff', 'rgba(33, 150, 243, 0.1)'],
  defaultPane: 'main',
  inputs: [{ key: 'period', label: 'Length', min: 1, step: 1, integer: true }],
  styles: [
    { key: 'basis', label: 'Basis', colorIndex: 0 },
    { key: 'upper', label: 'Upper', colorIndex: 1 },
    { key: 'lower', label: 'Lower', colorIndex: 2 },
    { key: 'background', label: 'Background', colorIndex: 3, kind: 'fill' },
  ],
  update(output, candles, from, params) {
    const period = lengthParam(params, 'period', 20);
    // Window rescans beat the linear pass only for short tails.
    if ((candles.length - from) * period > candles.length * 2) return undefined;
    const [basis, upper, lower] = output.lines.map((line) => line.values as (number | null)[]);
    for (let i = from; i < candles.length; i++) {
      if (i < period - 1) {
        upper[i] = lower[i] = basis[i] = null;
        continue;
      }
      const { high, low } = windowExtremes(candles, i, period);
      upper[i] = Number.isNaN(high) ? null : high;
      lower[i] = Number.isNaN(low) ? null : low;
      basis[i] = Number.isNaN(high) || Number.isNaN(low) ? null : (high + low) / 2;
    }
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const period = lengthParam(params, 'period', 20);
    const { upper, lower, basis } = donchianValues(candles, period);
    return {
      pane: 'main',
      lines: [
        { key: 'basis', values: basis, color: colors[0] ?? '#ff6d00' },
        { key: 'upper', values: upper, color: colors[1] ?? '#2962ff' },
        { key: 'lower', values: lower, color: colors[2] ?? '#2962ff' },
      ],
      fills: [{ key: 'background', upperKey: 'upper', lowerKey: 'lower', color: colors[3] ?? 'rgba(33, 150, 243, 0.1)' }],
    };
  },
};
