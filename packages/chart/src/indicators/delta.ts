/**
 * Delta — per-bar traded volume delta (buySize − sellSize) as a direction-
 * colored histogram, computed from a {@link FootprintSource} rather than
 * candle volume. Register the definition the factory returns:
 *
 * ```ts
 * chart.indicators.register(createDeltaIndicator(source));
 * chart.addIndicator({ name: 'delta' });
 * ```
 *
 * Like every cached indicator the output recomputes when the candles change;
 * trades folded into an already-loaded bar show on the next data-driven
 * render.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import { candleDelta, candleDeltas, type FootprintSource } from '../core/footprint.js';
import { DOWN_COLOR, UP_COLOR, type IndicatorDef } from './types.js';

/**
 * The Delta indicator definition over `source` (name `'delta'`, sub pane, no
 * params; colors = up/down bars following the candles by default). Tail
 * updates re-read the source from the first changed candle.
 */
export function createDeltaIndicator(source: FootprintSource): IndicatorDef {
  return {
    name: 'delta',
    label: 'Delta',
    shortName: 'Delta',
    defaultParams: {},
    defaultColors: [UP_COLOR, DOWN_COLOR],
    defaultPane: 'sub',
    inputs: [],
    styles: [
      { key: 'delta', label: 'Buying', colorIndex: 0, kind: 'histogram' },
      { key: 'delta', label: 'Selling', colorIndex: 1, kind: 'histogram' },
    ],
    update(output, candles: readonly Candle[], from: number) {
      const values = output.bars!.values as number[];
      const up = output.bars!.up as boolean[];
      for (let i = from; i < candles.length; i++) {
        const delta = candleDelta(candles[i]!, source);
        values[i] = delta;
        up[i] = delta >= 0;
      }
      return output;
    },
    compute(candles: readonly Candle[], _params: Record<string, number>, colors: readonly string[]) {
      const values = candleDeltas(candles, source);
      return {
        pane: 'sub' as const,
        lines: [],
        bars: {
          key: 'delta',
          values,
          up: values.map((delta) => delta >= 0),
          upColor: colors[0] ?? '#26a69a',
          downColor: colors[1] ?? '#ef5350',
        },
      };
    },
  };
}
