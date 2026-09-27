/**
 * RSI — Wilder's relative strength index.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';

/**
 * Wilder RSI: initial average gain/loss over the first `period` changes,
 * then smoothed by `avg = (prev * (period - 1) + current) / period`.
 * RSI is 100 when average loss is 0, 0 when average gain is 0.
 */
export function rsiValues(closes: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(closes.length).fill(null);
  if (period <= 0 || closes.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/** RSI indicator definition (name `'rsi'`, param `period`, default 14). */
export const rsiIndicator: IndicatorDef = {
  name: 'rsi',
  label: 'Relative Strength Index',
  shortName: 'RSI',
  defaultParams: { period: 14 },
  defaultColors: ['#7e57c2'],
  defaultPane: 'sub',
  inputs: [{ key: 'period', label: 'RSI length', min: 1, step: 1, integer: true }],
  styles: [{ key: 'value', label: 'RSI', colorIndex: 0 }],
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const period = Math.max(1, Math.floor(params['period'] ?? 14));
    const closes = candles.map((c) => c.close);
    return {
      pane: 'sub',
      lines: [{ key: 'value', values: rsiValues(closes, period), color: colors[0] ?? '#7e57c2' }],
    };
  },
};
