/**
 * Ichimoku Cloud — TradingView's definition: Donchian midpoints for the
 * conversion (tenkan), base (kijun) and leading span B lines, leading span A
 * as their mean, both leading spans plotted `displacement - 1` bars ahead,
 * the lagging span (close) `displacement - 1` bars back, and the Kumo filled
 * between the leading spans.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef } from './types.js';
import { rollingMaxValues, rollingMinValues } from './rolling.js';
import { windowMid } from './donchian.js';
import { lengthParam } from './params.js';

/** Ichimoku line values aligned to their source bars (apply the offsets when plotting). */
export interface IchimokuValues {
  tenkan: (number | null)[];
  kijun: (number | null)[];
  senkouA: (number | null)[];
  senkouB: (number | null)[];
  chikou: (number | null)[];
}

function midline(highs: readonly number[], lows: readonly number[], period: number): (number | null)[] {
  const high = rollingMaxValues(highs, period);
  const low = rollingMinValues(lows, period);
  const out = new Array<number | null>(highs.length);
  for (let i = 0; i < highs.length; i++) {
    const mid = (high[i] + low[i]) / 2;
    out[i] = Number.isNaN(mid) ? null : mid;
  }
  return out;
}

/**
 * Computes the five Ichimoku lines in f64 JS (exact channel prices; the
 * f32 WASM kernels would round them). Values are indexed by source bar.
 */
export function ichimokuValues(
  candles: readonly Candle[],
  conversion: number,
  base: number,
  span: number,
): IchimokuValues {
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const tenkan = midline(highs, lows, conversion);
  const kijun = midline(highs, lows, base);
  const senkouB = midline(highs, lows, span);
  const senkouA = tenkan.map((t, i) => (t === null || kijun[i] === null ? null : (t + (kijun[i] as number)) / 2));
  const chikou = candles.map((c) => c.close);
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

function lengths(params: Record<string, number>): [number, number, number, number] {
  return [
    lengthParam(params, 'conversion', 9),
    lengthParam(params, 'base', 26),
    lengthParam(params, 'span', 52),
    lengthParam(params, 'displacement', 26),
  ];
}

/**
 * Ichimoku Cloud definition (params `conversion` = 9, `base` = 26,
 * `span` = 52, `displacement` = 26; main pane). Line keys: `tenkan`,
 * `kijun`, `chikou`, `senkouA`, `senkouB`; fill key `kumo`.
 */
export const ichimokuIndicator: IndicatorDef = {
  name: 'ichimoku',
  label: 'Ichimoku Cloud',
  shortName: 'Ichimoku',
  defaultParams: { conversion: 9, base: 26, span: 52, displacement: 26 },
  defaultColors: ['#2962ff', '#b71c1c', '#43a047', '#a5d6a7', '#ef9a9a', 'rgba(67, 160, 71, 0.1)', 'rgba(244, 67, 54, 0.1)'],
  defaultPane: 'main',
  inputs: [
    { key: 'conversion', label: 'Conversion line length', min: 1, step: 1, integer: true },
    { key: 'base', label: 'Base line length', min: 1, step: 1, integer: true },
    { key: 'span', label: 'Leading span B length', min: 1, step: 1, integer: true },
    { key: 'displacement', label: 'Lagging span', min: 1, step: 1, integer: true },
  ],
  styles: [
    { key: 'tenkan', label: 'Conversion line', colorIndex: 0 },
    { key: 'kijun', label: 'Base line', colorIndex: 1 },
    { key: 'chikou', label: 'Lagging span', colorIndex: 2 },
    { key: 'senkouA', label: 'Leading span A', colorIndex: 3 },
    { key: 'senkouB', label: 'Leading span B', colorIndex: 4 },
    { key: 'kumo', label: 'Kumo bullish', colorIndex: 5, kind: 'fill' },
    { key: 'kumo', label: 'Kumo bearish', colorIndex: 6, kind: 'fill' },
  ],
  update(output, candles, from, params) {
    const [conversion, base, span] = lengths(params);
    // Window rescans beat the linear pass only for short tails.
    if ((candles.length - from) * Math.max(conversion, base, span) > candles.length * 2) return undefined;
    const [tenkan, kijun, chikou, senkouA, senkouB] = output.lines.map((line) => line.values as (number | null)[]);
    for (let i = from; i < candles.length; i++) {
      const t = windowMid(candles, i, conversion);
      const k = windowMid(candles, i, base);
      tenkan[i] = t;
      kijun[i] = k;
      senkouA[i] = t === null || k === null ? null : (t + k) / 2;
      senkouB[i] = windowMid(candles, i, span);
      chikou[i] = candles[i].close;
    }
    return output;
  },
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const [conversion, base, span, displacement] = lengths(params);
    const shift = displacement - 1;
    const { tenkan, kijun, senkouA, senkouB, chikou } = ichimokuValues(candles, conversion, base, span);
    return {
      pane: 'main',
      lines: [
        { key: 'tenkan', values: tenkan, color: colors[0] ?? '#2962ff' },
        { key: 'kijun', values: kijun, color: colors[1] ?? '#b71c1c' },
        // `0 - shift` keeps a zero displacement at +0 rather than -0.
        { key: 'chikou', values: chikou, color: colors[2] ?? '#43a047', offset: 0 - shift },
        { key: 'senkouA', values: senkouA, color: colors[3] ?? '#a5d6a7', offset: shift },
        { key: 'senkouB', values: senkouB, color: colors[4] ?? '#ef9a9a', offset: shift },
      ],
      fills: [{
        key: 'kumo', upperKey: 'senkouA', lowerKey: 'senkouB',
        color: colors[5] ?? 'rgba(67, 160, 71, 0.1)', colorBelow: colors[6] ?? 'rgba(244, 67, 54, 0.1)',
      }],
    };
  },
};
