/**
 * MA Ribbon — up to eight moving averages of close, one line per enabled
 * length (TradingView's Moving Average Ribbon).
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { IndicatorDef, IndicatorLine } from './types.js';
import type { StudyMeta } from './study-meta.js';
import { smaValues } from './sma.js';
import { emaValues } from './ema.js';

const DEFAULT_LENGTHS = [20, 50, 100, 200, 0, 0, 0, 0];

/** Yellow → red → purple, in slot order. */
const DEFAULT_COLORS = ['#f6c309', '#fb9800', '#fb6500', '#f60c0c', '#d5004f', '#b0006e', '#8a0a85', '#62128f'];

/** Display metadata for {@link maRibbonIndicator}. */
export const maRibbonMeta: StudyMeta = {
  label: 'Moving Average Ribbon',
  shortName: 'MA Ribbon',
  inputs: [
    {
      key: 'type',
      label: 'MA Type',
      integer: true,
      options: [
        { value: 0, label: 'SMA' },
        { value: 1, label: 'EMA' },
      ],
    },
    ...DEFAULT_LENGTHS.map((_, i) => ({ key: `len${i + 1}`, label: `MA #${i + 1} Length`, min: 0, max: 10000, step: 1, integer: true })),
  ],
  styles: DEFAULT_LENGTHS.map((_, i) => ({ key: `ma${i + 1}`, label: `MA #${i + 1}`, colorIndex: i, kind: 'line' as const })),
};

/**
 * MA Ribbon indicator definition (name `'ma-ribbon'`, main pane). Params
 * `type` (0 = SMA, 1 = EMA; default 1) and `len1`..`len8` (defaults 20, 50,
 * 100, 200, then 0); a length below 1 or non-finite turns its slot off.
 * Emits lines `ma1`..`ma8` for enabled slots only, colored by slot.
 * Computed in f64 JS even when WASM kernels are loaded: the f32 kernels drift
 * by tenths at BTC-scale prices, visible at the status line's 2 decimals.
 */
export const maRibbonIndicator: IndicatorDef = {
  name: 'ma-ribbon',
  ...maRibbonMeta,
  defaultParams: { type: 1, len1: 20, len2: 50, len3: 100, len4: 200, len5: 0, len6: 0, len7: 0, len8: 0 },
  defaultColors: [...DEFAULT_COLORS],
  defaultPane: 'main',
  compute(candles: readonly Candle[], params: Record<string, number>, colors: readonly string[]) {
    const average = Math.floor(params['type'] ?? 1) !== 0 ? emaValues : smaValues;
    const closes = candles.map((c) => c.close);
    const lines: IndicatorLine[] = [];
    for (let slot = 0; slot < DEFAULT_LENGTHS.length; slot++) {
      const length = Math.floor(params[`len${slot + 1}`] ?? DEFAULT_LENGTHS[slot]);
      if (!Number.isSafeInteger(length) || length < 1) continue;
      lines.push({ key: `ma${slot + 1}`, values: average(closes, length), color: colors[slot] ?? DEFAULT_COLORS[slot] });
    }
    return { pane: 'main', lines };
  },
};
