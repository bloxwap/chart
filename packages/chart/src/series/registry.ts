/**
 * Series registry: built-in renderers plus user-registered custom series.
 *
 * @module
 */

import type { SeriesType } from '../config.js';
import type { SeriesDrawFn } from './types.js';
import { drawCandlesticks } from './candlestick.js';
import { drawLine } from './line.js';
import { drawArea } from './area.js';
import { drawBars } from './bar.js';
import { drawHistogram } from './histogram.js';
import { drawHeikinAshi } from './heikin-ashi.js';
import { drawHollowCandlesticks } from './hollow-candlestick.js';

/** Maps the built-in {@link SeriesType} strings to their pure draw functions. */
export const SERIES_RENDERERS: Record<SeriesType, SeriesDrawFn> = {
  candlestick: drawCandlesticks,
  line: drawLine,
  area: drawArea,
  bar: drawBars,
  histogram: drawHistogram,
  'heikin-ashi': drawHeikinAshi,
  'hollow-candlestick': drawHollowCandlesticks,
};

/** A mutable registry of series draw functions keyed by type string. */
export class SeriesRegistry {
  private readonly fns = new Map<string, SeriesDrawFn>();

  /** Registers (or replaces) a draw function. Returns `this` for chaining. */
  register(type: string, drawFn: SeriesDrawFn): this {
    this.fns.set(type, drawFn);
    return this;
  }

  /** Looks up a draw function by type string. */
  get(type: string): SeriesDrawFn | undefined {
    return this.fns.get(type);
  }

  /** True when `type` is registered. */
  has(type: string): boolean {
    return this.fns.has(type);
  }

  /** Removes a draw function; returns whether it existed. */
  unregister(type: string): boolean {
    return this.fns.delete(type);
  }

  /** All registered type strings. */
  names(): string[] {
    return [...this.fns.keys()];
  }
}

/**
 * Creates a registry pre-loaded with the built-in {@link SeriesType} renderers.
 *
 * @param withBuiltins - Pass `false` for an empty registry.
 */
export function createSeriesRegistry(withBuiltins = true): SeriesRegistry {
  const registry = new SeriesRegistry();
  if (withBuiltins) {
    for (const type of Object.keys(SERIES_RENDERERS)) {
      registry.register(type, SERIES_RENDERERS[type as SeriesType]);
    }
  }
  return registry;
}
