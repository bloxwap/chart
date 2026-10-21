/**
 * RSI — Wilder's relative strength index.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import { TailState, TailSeries, smallTail, setSeriesValue, type MutableSeries } from './tail.js';
import type { IndicatorDef } from './types.js';

const averages = new WeakMap<MutableSeries, TailState<number[]>>();

/**
 * Wilder RSI: initial average gain/loss over the first `period` changes,
 * then smoothed by `avg = (prev * (period - 1) + current) / period`.
 * RSI is 100 when average loss is 0, 0 when average gain is 0.
 */
export function rsiValues(closes: readonly number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array<number | null>(closes.length).fill(null);
  if (period <= 0 || closes.length <= period) return out;
  const state = new TailState<number[]>(value => value.slice());
  averages.set(out, state);
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
  state.save(period, closes.length, [avgGain, avgLoss]);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    if (i >= closes.length - 2) state.save(i, closes.length, [avgGain, avgLoss]);
  }
  return out;
}

/** Full compute directly from candle closes, retaining recurrence checkpoints. */
export function rsiCandleValues(candles: readonly Candle[], period: number): (number | null)[] {
  if (Number.isNaN(period)) return rsiValues(candles.map(c => c.close), period);
  const out: (number | null)[] = new Array<number | null>(candles.length);
  if (period <= 0 || candles.length <= period) return out.fill(null);
  out.fill(null, 0, period);
  const state = new TailState<number[]>(value => value.slice());
  averages.set(out, state);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  state.save(period, candles.length, [avgGain, avgLoss]);
  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    if (i >= candles.length - 2) state.save(i, candles.length, [avgGain, avgLoss]);
  }
  return out;
}

/** Keep only the RSI lookback needed by a composite oscillator. */
export function retainRsi(out: (number | null)[], capacity: number): TailSeries {
  const retained = new TailSeries(out, capacity);
  const state = averages.get(out);
  if (state !== undefined) averages.set(retained, state);
  return retained;
}

/** Resume Wilder averages without inverting the rounded RSI ratio. */
export function updateRsi(out: MutableSeries, candles: readonly Candle[], from: number, period: number): boolean {
  const state = averages.get(out);
  const previous = state?.get(from - 1);
  if (previous === undefined) return false;
  let [gain, loss] = previous;
  for (let i = from; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    gain = (gain * (period - 1) + (change > 0 ? change : 0)) / period;
    loss = (loss * (period - 1) + (change < 0 ? -change : 0)) / period;
    setSeriesValue(out, i, loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
    state!.save(i, candles.length, [gain, loss]);
  }
  state!.prune(candles.length);
  return true;
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
  update(output, candles, from, params) {
    if (!smallTail(candles.length, from)) return undefined;
    return updateRsi(output.lines[0].values as (number | null)[], candles, from,
      Math.max(1, Math.floor(params['period'] ?? 14))) ? output : undefined;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const period = Math.max(1, Math.floor(params['period'] ?? 14));
    return {
      pane: 'sub',
      lines: [{ key: 'value', values: rsiCandleValues(candles, period), color: colors[0] ?? '#7e57c2' }],
    };
  },
};
