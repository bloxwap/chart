/**
 * VOL — volume histogram, colored by candle direction.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';

/** VOL indicator definition (no params; colors = up/down bar colors). */
export const volIndicator: IndicatorDef = {
  name: 'vol',
  defaultParams: {},
  defaultColors: ['#26a69a', '#ef5350'],
  defaultPane: 'sub',
  compute(candles: readonly Candle[], _params: Record<string, number>, colors: readonly string[]) {
    const values = candles.map((c) => c.volume ?? 0);
    const up = candles.map((c) => c.close >= c.open);
    return {
      pane: 'sub',
      lines: [],
      bars: {
        values,
        up,
        upColor: colors[0] ?? '#26a69a',
        downColor: colors[1] ?? '#ef5350',
      },
    };
  },
};
