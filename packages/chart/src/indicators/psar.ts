/**
 * Parabolic SAR (TradingView `ta.sar`), plotted as dots.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import { numberParam } from './params.js';

/**
 * Wilder's Parabolic SAR, transcribed from TradingView's `ta.sar`: the
 * second bar seeds the trend from the close direction, the acceleration
 * factor starts at `start`, grows by `increment` on each new extreme up to
 * `maximum`, and the SAR never enters the prior two bars' range. Null on
 * the first bar.
 */
export function psarValues(
  candles: readonly Candle[],
  start: number,
  increment: number,
  maximum: number,
): (number | null)[] {
  const out = new Array<number | null>(candles.length).fill(null);
  let result = 0;
  let extreme = 0;
  let acceleration = start;
  let rising = false;
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    let firstTrendBar = false;
    if (i === 1) {
      rising = c.close > prev.close;
      extreme = rising ? c.high : c.low;
      result = rising ? prev.low : prev.high;
      firstTrendBar = true;
    }
    result += acceleration * (extreme - result);
    if (rising ? result > c.low : result < c.high) {
      // Stop and reverse.
      firstTrendBar = true;
      rising = !rising;
      result = rising ? Math.min(c.low, extreme) : Math.max(c.high, extreme);
      extreme = rising ? c.high : c.low;
      acceleration = start;
    }
    if (!firstTrendBar && (rising ? c.high > extreme : c.low < extreme)) {
      extreme = rising ? c.high : c.low;
      acceleration = Math.min(acceleration + increment, maximum);
    }
    if (rising) {
      result = Math.min(result, prev.low);
      if (i > 1) result = Math.min(result, candles[i - 2].low);
    } else {
      result = Math.max(result, prev.high);
      if (i > 1) result = Math.max(result, candles[i - 2].high);
    }
    out[i] = result;
  }
  return out;
}

/** Parabolic SAR definition (params `start` = 0.02, `increment` = 0.02, `max` = 0.2; main pane, dots). */
export const psarIndicator: IndicatorDef = {
  name: 'psar',
  label: 'Parabolic SAR',
  shortName: 'SAR',
  defaultParams: { start: 0.02, increment: 0.02, max: 0.2 },
  defaultColors: ['#2962ff'],
  defaultPane: 'main',
  inputs: [
    { key: 'start', label: 'Start', min: 0, step: 0.01 },
    { key: 'increment', label: 'Increment', min: 0, step: 0.01 },
    { key: 'max', label: 'Max value', min: 0, step: 0.01 },
  ],
  styles: [{ key: 'value', label: 'SAR', colorIndex: 0, kind: 'dots' }],
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const values = psarValues(
      candles,
      numberParam(params, 'start', 0.02),
      numberParam(params, 'increment', 0.02),
      numberParam(params, 'max', 0.2),
    );
    return {
      pane: 'main',
      lines: [{ key: 'value', values, color: colors[0] ?? '#2962ff', style: 'dots' }],
    };
  },
};
