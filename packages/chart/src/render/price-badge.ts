/**
 * Price-axis badge geometry and the latest displayed bar, shared by the
 * last-price badge, price-line badges and the countdown badge so they stay
 * stacked and colored alike.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { ThemeConfig } from '../config.js';
import type { RenderView } from './renderer.js';
import { barIsUp } from '../series/direction.js';
import { scaleFontSize } from './scale-font.js';

/** Height in CSS pixels of a price-axis badge: the scale text plus 4px padding above and below. */
export function priceBadgeHeight(theme: ThemeConfig): number {
  return scaleFontSize(theme) + 8;
}

/** Top of a badge centered on `y`, clamped inside a pane `paneHeight` tall. */
export function priceBadgeTop(y: number, paneHeight: number, badgeHeight: number): number {
  return Math.max(0, Math.min(paneHeight - badgeHeight, y - badgeHeight / 2));
}

/**
 * The latest main-series bar as displayed (the live candle when set, a Heikin
 * Ashi bar for `'heikin-ashi'`) and the up or down color its renderer paints
 * it in. The view must hold at least one candle.
 */
export function lastDisplayedBar(view: RenderView): { bar: Candle; color: string } {
  const candles = view.displayCandles ?? view.candles;
  const index = candles.length - 1;
  const bar = view.liveCandle ?? candles[index]!;
  const { series } = view.config;
  return { bar, color: barIsUp(series, candles, index, bar) ? series.upColor : series.downColor };
}
