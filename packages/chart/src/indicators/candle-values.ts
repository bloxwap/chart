/**
 * Candle-derived sources shared by the volume and typical-price studies.
 *
 * @module
 */

import type { Candle } from '../core/data.js';

/** HLC3 typical price: `(high + low + close) / 3`. */
export function typicalPrice(candle: Candle): number {
  return (candle.high + candle.low + candle.close) / 3;
}

/** Candle volume; a missing or non-finite volume counts as 0. */
export function candleVolume(candle: Candle): number {
  const volume = candle.volume;
  return volume !== undefined && Number.isFinite(volume) ? volume : 0;
}
