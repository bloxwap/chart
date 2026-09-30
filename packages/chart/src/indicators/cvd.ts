/**
 * CVD — cumulative volume delta: the running sum of per-bar traded deltas
 * (buySize − sellSize) over a {@link FootprintSource}, as a sub-pane line.
 * Register the definition the factory returns:
 *
 * ```ts
 * chart.indicators.register(createCvdIndicator(source));
 * chart.addIndicator({ name: 'cvd' });
 * ```
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import { candleDelta, type FootprintSource } from '../core/footprint.js';
import type { IndicatorDef } from './types.js';

/** Continues the running total from `values[from − 1]` (0 at the first candle). */
function fillCvd(candles: readonly Candle[], source: FootprintSource, values: (number | null)[], from: number): void {
  let total = from > 0 ? values[from - 1] as number : 0;
  for (let i = from; i < candles.length; i++) {
    total += candleDelta(candles[i]!, source);
    values[i] = total;
  }
}

/** Cumulative deltas over the loaded candles: starts at 0; bars without trades add 0. */
export function cvdValues(candles: readonly Candle[], source: FootprintSource): number[] {
  const values = new Array<number>(candles.length).fill(0);
  fillCvd(candles, source, values, 0);
  return values;
}

/**
 * The CVD indicator definition over `source` (name `'cvd'`, sub pane, no
 * params). Tail updates continue the running total.
 */
export function createCvdIndicator(source: FootprintSource): IndicatorDef {
  return {
    name: 'cvd',
    label: 'Cumulative Volume Delta',
    shortName: 'CVD',
    defaultParams: {},
    defaultColors: ['#2196f3'],
    defaultPane: 'sub',
    inputs: [],
    styles: [{ key: 'cvd', label: 'CVD', colorIndex: 0, kind: 'line' }],
    update(output, candles: readonly Candle[], from: number) {
      fillCvd(candles, source, output.lines[0]!.values as (number | null)[], from);
      return output;
    },
    compute(candles: readonly Candle[], _params: Record<string, number>, colors: readonly string[]) {
      return {
        pane: 'sub' as const,
        lines: [{ key: 'cvd', values: cvdValues(candles, source), color: colors[0] ?? '#2196f3' }],
      };
    },
  };
}
