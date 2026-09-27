/**
 * MFI — money flow index: a volume-weighted RSI of HLC3 (TradingView's
 * definition).
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef, IndicatorLevel } from './types.js';
import type { StudyMeta } from './study-meta.js';
import { candleVolume, typicalPrice } from './candle-values.js';
import { windowSums } from './window-sums.js';

/**
 * Writes MFI from index `from`. A flow is `volume · tp`, positive when tp
 * rose from the previous candle and negative when it fell; like TradingView,
 * the first candle (no previous tp) counts both ways and windows are partial
 * until `period` candles exist, so values start at 50 on the first candle. No
 * negative flow in the window gives 100 (TradingView's rsi), including a
 * window without any flow. Non-finite periods leave every value null.
 */
function fillMfi(candles: readonly Candle[], period: number, values: (number | null)[], from: number): void {
  if (!Number.isFinite(period)) {
    for (let i = from; i < candles.length; i++) values[i] = null;
    return;
  }
  const base = Math.max(0, from - period + 1);
  const up = new Float64Array(candles.length - base);
  const down = new Float64Array(candles.length - base);
  let previous = base > 0 ? typicalPrice(candles[base - 1]) : NaN;
  for (let k = 0; k < up.length; k++) {
    const price = typicalPrice(candles[base + k]);
    const flow = candleVolume(candles[base + k]) * price;
    if (price > previous) up[k] = flow;
    else if (price < previous) down[k] = flow;
    else if (base + k === 0) up[k] = down[k] = flow;
    previous = price;
  }
  const positive = windowSums(up, base, period, from);
  const negative = windowSums(down, base, period, from);
  for (let i = from; i < candles.length; i++) {
    const lower = negative[i - from];
    values[i] = lower === 0 ? 100 : 100 - 100 / (1 + positive[i - from] / lower);
  }
}

function periodParam(params: Record<string, number>): number {
  return Math.max(1, Math.floor(params['period'] ?? 14));
}

/**
 * MFI = 100 − 100 / (1 + positiveFlow / negativeFlow) over the last `period`
 * HLC3 flows, plotted from the first candle as TradingView does.
 */
export function mfiValues(candles: readonly Candle[], period = 14): (number | null)[] {
  const values = new Array<number | null>(candles.length).fill(null);
  fillMfi(candles, periodParam({ period }), values, 0);
  return values;
}

/** The 80/20 overbought/oversold bands (keys `upperBand`/`lowerBand`, colors 1 and 2). */
function mfiBands(colors: readonly string[]): IndicatorLevel[] {
  return [
    { key: 'upperBand', value: 80, color: colors[1] ?? '#787b86' },
    { key: 'lowerBand', value: 20, color: colors[2] ?? '#787b86' },
  ];
}

/** Display metadata for {@link mfiIndicator}. */
export const mfiMeta: StudyMeta = {
  label: 'Money Flow Index',
  shortName: 'MFI',
  inputs: [{ key: 'period', label: 'Length', min: 1, max: 2000, step: 1, integer: true }],
  styles: [
    { key: 'mfi', label: 'MFI', colorIndex: 0, kind: 'line' },
    { key: 'upperBand', label: 'Overbought', colorIndex: 1, kind: 'level' },
    { key: 'lowerBand', label: 'Oversold', colorIndex: 2, kind: 'level' },
  ],
};

/** MFI indicator definition (name `'mfi'`, sub pane, param `period`, default 14; 80/20 bands). */
export const mfiIndicator: IndicatorDef = {
  name: 'mfi',
  ...mfiMeta,
  defaultParams: { period: 14 },
  defaultColors: ['#7e57c2', '#787b86', '#787b86'],
  defaultPane: 'sub',
  update(output, candles, from, params) {
    fillMfi(candles, periodParam(params), output.lines[0].values as (number | null)[], from);
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const values = new Array<number | null>(candles.length).fill(null);
    fillMfi(candles, periodParam(params), values, 0);
    return { pane: 'sub', lines: [{ key: 'mfi', values, color: colors[0] ?? '#7e57c2' }], levels: mfiBands(colors) };
  },
};
