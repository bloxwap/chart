/**
 * MACD — DIF = EMA(fast) − EMA(slow), DEA = EMA(DIF, signal), histogram = DIF − DEA.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import { DOWN_COLOR, UP_COLOR, type IndicatorDef, type IndicatorOutput } from './types.js';
import { TailState, smallTail } from './tail.js';
import { emaValues } from './ema.js';

const states = new WeakMap<IndicatorOutput, TailState<number[]>>();

/** MACD indicator definition (params `fast` = 12, `slow` = 26, `signal` = 9). */
export const macdIndicator: IndicatorDef = {
  name: 'macd',
  label: 'MACD',
  shortName: 'MACD',
  defaultParams: { fast: 12, slow: 26, signal: 9 },
  defaultColors: ['#2962ff', '#ff6d00', UP_COLOR, DOWN_COLOR],
  defaultPane: 'sub',
  inputs: [
    { key: 'fast', label: 'Fast length', min: 1, step: 1, integer: true },
    { key: 'slow', label: 'Slow length', min: 1, step: 1, integer: true },
    { key: 'signal', label: 'Signal smoothing', min: 1, step: 1, integer: true },
  ],
  styles: [
    { key: 'dif', label: 'MACD', colorIndex: 0 },
    { key: 'dea', label: 'Signal', colorIndex: 1 },
    { key: 'hist', label: 'Histogram positive', colorIndex: 2, kind: 'histogram' },
    { key: 'hist', label: 'Histogram negative', colorIndex: 3, kind: 'histogram' },
  ],
  update(output, candles, from, params) {
    const state = states.get(output);
    const fast = Math.max(1, Math.floor(params['fast'] ?? 12));
    const slow = Math.max(fast + 1, Math.floor(params['slow'] ?? 26));
    const signal = Math.max(1, Math.floor(params['signal'] ?? 9));
    const snapshot = state?.get(from - 1);
    if (!smallTail(candles.length, from) || snapshot === undefined || !Number.isFinite(signal)) return undefined;
    let [previousFast, previousSlow, previous] = snapshot;
    const fastWeight = 2 / (fast + 1), slowWeight = 2 / (slow + 1);
    const [dif, dea] = output.lines.map(line => line.values as (number | null)[]);
    const hist = output.bars!.values as (number | null)[];
    const up = output.bars!.up as boolean[];
    const weight = 2 / (signal + 1);
    for (let i = from; i < candles.length; i++) {
      previousFast = candles[i].close * fastWeight + previousFast * (1 - fastWeight);
      previousSlow = candles[i].close * slowWeight + previousSlow * (1 - slowWeight);
      const value = previousFast - previousSlow;
      previous = value * weight + previous * (1 - weight);
      dif[i] = value;
      dea[i] = previous;
      const bar = value - previous;
      hist[i] = bar;
      up[i] = bar >= 0;
      state!.save(i, candles.length, [previousFast, previousSlow, previous]);
    }
    state!.prune(candles.length);
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const fast = Math.max(1, Math.floor(params['fast'] ?? 12));
    const slow = Math.max(fast + 1, Math.floor(params['slow'] ?? 26));
    const signal = Math.max(1, Math.floor(params['signal'] ?? 9));
    const closes = candles.map((c) => c.close);
    const emaFast = emaValues(closes, fast);
    const emaSlow = emaValues(closes, slow);

    const dif = new Array<number | null>(closes.length).fill(null);
    const dea = new Array<number | null>(closes.length).fill(null);
    const hist = new Array<number | null>(closes.length).fill(null);
    const up = new Array<boolean>(closes.length).fill(true);
    const weight = 2 / (signal + 1);
    const state = new TailState<number[]>(value => value.slice());
    let signalSum = 0;
    let previous = 0;
    // Fuse DIF, the SMA-seeded signal EMA and histogram in one pass. No
    // copied DIF tail or second full signal array is needed.
    for (let i = slow - 1; i < closes.length; i++) {
      const value = (emaFast[i] as number) - (emaSlow[i] as number);
      dif[i] = value;
      const count = i - slow + 2;
      if (count <= signal) signalSum += value;
      if (count < signal) continue;
      previous = count === signal ? signalSum / signal : value * weight + previous * (1 - weight);
      dea[i] = previous;
      const bar = value - previous;
      hist[i] = bar;
      up[i] = bar >= 0;
      if (i >= closes.length - 2) state.save(i, closes.length, [emaFast[i] as number, emaSlow[i] as number, previous]);
    }

    const output: IndicatorOutput = {
      pane: 'sub',
      bars: {
        key: 'hist',
        values: hist,
        up,
        upColor: colors[2] ?? '#26a69a',
        downColor: colors[3] ?? '#ef5350',
      },
      lines: [
        { key: 'dif', values: dif, color: colors[0] ?? '#2962ff' },
        { key: 'dea', values: dea, color: colors[1] ?? '#ff6d00' },
      ],
    };
    states.set(output, state);
    return output;
  },
};
