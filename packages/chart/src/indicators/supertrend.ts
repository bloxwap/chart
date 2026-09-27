/**
 * Supertrend — ATR bands around hl2 that ratchet with the trend
 * (TradingView `ta.supertrend`). One line, colored per bar by direction.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import { DOWN_COLOR, UP_COLOR, type IndicatorDef } from './types.js';
import { atrValues } from './atr.js';
import { lengthParam, numberParam } from './params.js';

/**
 * Supertrend line and direction per bar (`up[i]` true in an uptrend, when the
 * line is the lower band). Null during the ATR warmup. Follows Pine's seeding
 * exactly: the first valid bar starts in a downtrend with its bands ratcheted
 * against `nz(band[1]) = 0` (a no-op for positive prices once a previous
 * close exists). With `period` 1 that seed makes TradingView plot 0 on bar 0;
 * that one bar is left empty here, and every later bar matches.
 */
export function supertrendValues(
  candles: readonly Candle[],
  period: number,
  factor: number,
): { values: (number | null)[]; up: boolean[] } {
  const values = new Array<number | null>(candles.length).fill(null);
  const up = new Array<boolean>(candles.length).fill(false);
  const atr = atrValues(candles, period);
  let started = false;
  let prevUpper = 0, prevLower = 0, prevTrend = 0;
  for (let i = 0; i < candles.length; i++) {
    const range = atr[i];
    if (range === null) continue;
    const c = candles[i];
    const mid = (c.high + c.low) / 2;
    // close[1] is na on bar 0, and na comparisons are false.
    const prevClose = i > 0 ? candles[i - 1].close : NaN;
    let upper = mid + factor * range;
    let lower = mid - factor * range;
    lower = lower > prevLower || prevClose < prevLower ? lower : prevLower;
    upper = upper < prevUpper || prevClose > prevUpper ? upper : prevUpper;
    const uptrend = started && (prevTrend === prevUpper ? c.close > upper : !(c.close < lower));
    const trend = uptrend ? lower : upper;
    if (i > 0) values[i] = trend;
    up[i] = uptrend;
    prevUpper = upper;
    prevLower = lower;
    prevTrend = trend;
    started = true;
  }
  return { values, up };
}

/** Supertrend indicator definition (params `period` = 10, `multiplier` = 3; main pane). */
export const supertrendIndicator: IndicatorDef = {
  name: 'supertrend',
  label: 'Supertrend',
  shortName: 'Supertrend',
  defaultParams: { period: 10, multiplier: 3 },
  defaultColors: [UP_COLOR, DOWN_COLOR],
  defaultPane: 'main',
  inputs: [
    { key: 'period', label: 'ATR length', min: 1, step: 1, integer: true },
    { key: 'multiplier', label: 'Factor', min: 0.01, step: 0.01 },
  ],
  styles: [
    { key: 'supertrend', label: 'Up trend', colorIndex: 0 },
    { key: 'supertrend', label: 'Down trend', colorIndex: 1 },
  ],
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const period = lengthParam(params, 'period', 10);
    const factor = numberParam(params, 'multiplier', 3);
    const upColor = colors[0] ?? '#26a69a';
    const downColor = colors[1] ?? '#ef5350';
    const { values, up } = supertrendValues(candles, period, factor);
    const lineColors = values.map((v, i) => (v === null ? null : up[i] ? upColor : downColor));
    return {
      pane: 'main',
      lines: [{ key: 'supertrend', values, color: upColor, colors: lineColors }],
    };
  },
};
