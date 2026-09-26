/**
 * Series renderer contract: pure draw functions registered by type string.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { PriceScale, TimeScale, VisibleRange } from '../core/scale.js';
import type { SeriesConfig } from '../config.js';
import type { Canvas2DLike } from '../dom.js';

/** Pure draw call for one series type over the visible candle range. */
export type SeriesDrawFn = (
  ctx: Canvas2DLike,
  candles: readonly Candle[],
  range: VisibleRange,
  timeScale: TimeScale,
  priceScale: PriceScale,
  config: SeriesConfig,
) => void;
