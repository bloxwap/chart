/**
 * ATR — Average True Range: Wilder's RMA of the true range (TradingView
 * `ta.atr`).
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import { lengthParam } from './params.js';

/**
 * True range per bar: `high − low` on the first bar, then
 * `max(high − low, |high − prevClose|, |low − prevClose|)`.
 */
export function trueRangeValues(candles: readonly Candle[]): number[] {
  const out = new Array<number>(candles.length);
  for (let i = 0; i < candles.length; i++) out[i] = trueRange(candles, i);
  return out;
}

function trueRange(candles: readonly Candle[], i: number): number {
  const c = candles[i];
  if (i === 0) return c.high - c.low;
  const prevClose = candles[i - 1].close;
  return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
}

/**
 * Wilder's moving average (`ta.rma`): the SMA of the first `period` values
 * at index `period - 1`, then `v / period + prev × (1 − 1 / period)`.
 * `period` is floored, as in the rolling helpers; all null below 1.
 */
export function rmaValues(values: readonly number[], period: number): (number | null)[] {
  const out = new Array<number | null>(values.length).fill(null);
  const window = Math.floor(period);
  if (!(window >= 1) || values.length < window) return out;
  const alpha = 1 / window;
  let sum = 0;
  for (let i = 0; i < window; i++) sum += values[i];
  let prev = sum / window;
  out[window - 1] = prev;
  for (let i = window; i < values.length; i++) {
    prev = alpha * values[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/** ATR over `period` bars (floored); null during the `period - 1` warmup bars. */
export function atrValues(candles: readonly Candle[], period: number): (number | null)[] {
  return rmaValues(trueRangeValues(candles), period);
}

/** ATR indicator definition (name `'atr'`, param `period`, default 14; sub-pane). */
export const atrIndicator: IndicatorDef = {
  name: 'atr',
  label: 'Average True Range',
  shortName: 'ATR',
  defaultParams: { period: 14 },
  defaultColors: ['#b71c1c'],
  defaultPane: 'sub',
  inputs: [{ key: 'period', label: 'Length', min: 1, step: 1, integer: true }],
  styles: [{ key: 'value', label: 'ATR', colorIndex: 0 }],
  update(output, candles, from, params) {
    const period = lengthParam(params, 'period', 14);
    // The recurrence continues from the cached value before `from`.
    if (from < period) return undefined;
    const values = output.lines[0].values as (number | null)[];
    const alpha = 1 / period;
    for (let i = from; i < candles.length; i++) {
      values[i] = alpha * trueRange(candles, i) + (1 - alpha) * (values[i - 1] as number);
    }
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const period = lengthParam(params, 'period', 14);
    return {
      pane: 'sub',
      lines: [{ key: 'value', values: atrValues(candles, period), color: colors[0] ?? '#b71c1c' }],
    };
  },
};
