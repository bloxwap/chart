/**
 * VOL — volume histogram, colored by candle direction.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import { DOWN_COLOR, UP_COLOR, type IndicatorDef } from './types.js';

/** VOL indicator definition (no params; colors = up/down bars, following the candles by default). */
export const volIndicator: IndicatorDef = {
  name: 'vol',
  defaultParams: {},
  defaultColors: [UP_COLOR, DOWN_COLOR],
  defaultPane: 'sub',
  update(output, candles, from) {
    const values = output.bars!.values as number[];
    const up = output.bars!.up as boolean[];
    for (let i = from; i < candles.length; i++) {
      values[i] = candles[i].volume ?? 0;
      up[i] = candles[i].close >= candles[i].open;
    }
    return output;
  },
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
