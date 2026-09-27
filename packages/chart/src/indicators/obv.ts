/**
 * OBV — on-balance volume (TradingView's definition).
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import type { StudyMeta } from './study-meta.js';
import { candleVolume } from './candle-values.js';

/** Continues the running total from `values[from − 1]` (0 at the first candle). */
function fillObv(candles: readonly Candle[], values: (number | null)[], from: number): void {
  let total = from > 0 ? values[from - 1] as number : 0;
  for (let i = from; i < candles.length; i++) {
    if (i > 0) {
      const change = candles[i].close - candles[i - 1].close;
      if (change > 0) total += candleVolume(candles[i]);
      else if (change < 0) total -= candleVolume(candles[i]);
    }
    values[i] = total;
  }
}

/**
 * Cumulative OBV: starts at 0, then adds the candle's volume on a higher
 * close and subtracts it on a lower one. Missing volume counts as 0.
 */
export function obvValues(candles: readonly Candle[]): number[] {
  const values = new Array<number>(candles.length).fill(0);
  fillObv(candles, values, 0);
  return values;
}

/** Display metadata for {@link obvIndicator}. */
export const obvMeta: StudyMeta = {
  label: 'On Balance Volume',
  shortName: 'OBV',
  inputs: [],
  styles: [{ key: 'obv', label: 'OBV', colorIndex: 0, kind: 'line' }],
};

/** OBV indicator definition (name `'obv'`, sub pane, no params). Tail updates continue the running total. */
export const obvIndicator: IndicatorDef = {
  name: 'obv',
  ...obvMeta,
  defaultParams: {},
  defaultColors: ['#2196f3'],
  defaultPane: 'sub',
  update(output, candles, from) {
    fillObv(candles, output.lines[0].values as (number | null)[], from);
    return output;
  },
  compute(candles: readonly Candle[], _params: Record<string, number>, colors: readonly string[]) {
    return { pane: 'sub', lines: [{ key: 'obv', values: obvValues(candles), color: colors[0] ?? '#2196f3' }] };
  },
};
