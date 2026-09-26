/**
 * MACD — DIF = EMA(fast) − EMA(slow), DEA = EMA(DIF, signal), histogram = DIF − DEA.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import { emaValues } from './ema.js';

/** MACD indicator definition (params `fast` = 12, `slow` = 26, `signal` = 9). */
export const macdIndicator: IndicatorDef = {
  name: 'macd',
  defaultParams: { fast: 12, slow: 26, signal: 9 },
  defaultColors: ['#2962ff', '#ff6d00', '#26a69a', '#ef5350'],
  defaultPane: 'sub',
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const fast = Math.max(1, Math.floor(params['fast'] ?? 12));
    const slow = Math.max(fast + 1, Math.floor(params['slow'] ?? 26));
    const signal = Math.max(1, Math.floor(params['signal'] ?? 9));
    const closes = candles.map((c) => c.close);
    const emaFast = emaValues(closes, fast);
    const emaSlow = emaValues(closes, slow);

    // DIF is defined once both EMAs exist.
    const dif: (number | null)[] = closes.map((_, i) => {
      const f = emaFast[i];
      const s = emaSlow[i];
      return f == null || s == null ? null : f - s;
    });
    const firstDif = dif.findIndex((v) => v !== null);

    // DEA = EMA of the dense tail of DIF, re-indexed back.
    const dea: (number | null)[] = new Array<number | null>(closes.length).fill(null);
    if (firstDif >= 0) {
      const tail = dif.slice(firstDif) as number[];
      const deaTail = emaValues(tail, signal);
      for (let i = 0; i < deaTail.length; i++) dea[firstDif + i] = deaTail[i];
    }

    const hist: (number | null)[] = dif.map((d, i) => {
      const e = dea[i];
      return d === null || e == null ? null : d - e;
    });
    const up = hist.map((h) => (h ?? 0) >= 0);

    return {
      pane: 'sub',
      bars: {
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
  },
};
