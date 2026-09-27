/**
 * Up/down direction of a main-series bar as its renderer colors it, so labels
 * (last-price badge, status line) match the drawn bar.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { SeriesConfig, SeriesType } from '../config.js';

/** Series types whose renderers honour `colorByPreviousClose`. */
const PREVIOUS_CLOSE_OPTIONAL: ReadonlySet<SeriesType> = new Set<SeriesType>(['candlestick', 'bar', 'histogram']);

/**
 * Whether bar `index` of `candles` draws in the up color. Hollow candles (and
 * candlestick/bar/histogram with `colorByPreviousClose`) compare the close with
 * the previous close, the first bar with its own open; every other type
 * compares close with open. `bar` stands in for `candles[index]` (the live
 * candle); `candles` are the displayed bars (Heikin Ashi bars for HA).
 */
export function barIsUp(series: SeriesConfig, candles: readonly Candle[], index: number, bar: Candle): boolean {
  const byPrevious = series.type === 'hollow-candlestick' || (series.colorByPreviousClose && PREVIOUS_CLOSE_OPTIONAL.has(series.type));
  return bar.close >= (byPrevious && index > 0 ? candles[index - 1].close : bar.open);
}
