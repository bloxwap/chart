/**
 * Heikin Ashi transform and series renderer. HA bars are computed once per
 * data change (with an O(1) tail update while streaming), never per frame;
 * indicators keep reading the real candles.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import type { SeriesType } from '../config.js';
import { drawCandlesticks } from './candlestick.js';
import type { SeriesDrawFn } from './types.js';

type MutableCandle = { -readonly [K in keyof Candle]: Candle[K] };

/**
 * One Heikin Ashi bar from a real candle and the previous HA bar:
 * close = (O+H+L+C)/4, open = (prevOpen+prevClose)/2 (seeded with (O+C)/2
 * when there is no finite previous bar), high/low widened to include both.
 * Time and volume are carried over from the real candle.
 */
export function heikinAshiBar(candle: Candle, previous?: Candle): Candle {
  const close = (candle.open + candle.high + candle.low + candle.close) / 4;
  const open = previous !== undefined && Number.isFinite(previous.open + previous.close)
    ? (previous.open + previous.close) / 2
    : (candle.open + candle.close) / 2;
  const bar: MutableCandle = {
    time: candle.time,
    open,
    high: Math.max(candle.high, open, close),
    low: Math.min(candle.low, open, close),
    close,
  };
  if (candle.volume !== undefined) bar.volume = candle.volume;
  return bar;
}

/**
 * Brings `bars` (the HA series of `candles`) up to date in place: entries from
 * `from` on are recomputed and the array is resized to `candles.length`. Each
 * bar depends only on its predecessor, so a streaming tail edit costs O(1).
 */
export function updateHeikinAshi(bars: Candle[], candles: readonly Candle[], from: number): Candle[] {
  const start = Math.max(0, Math.min(from, bars.length, candles.length));
  bars.length = start;
  for (let i = start; i < candles.length; i++) bars.push(heikinAshiBar(candles[i], bars[i - 1]));
  return bars;
}

/** The Heikin Ashi series of `candles` (a new array; the input is not modified). */
export function heikinAshi(candles: readonly Candle[]): Candle[] {
  return updateHeikinAshi([], candles, 0);
}

/**
 * Memoized HA bars for one candle array that is mutated in place. A different
 * array recomputes everything; {@link invalidate} marks an in-place edit.
 */
export class HeikinAshiCache {
  private source: readonly Candle[] | null = null;
  private bars: Candle[] = [];
  private dirtyFrom = Infinity;

  /** Marks bars from `index` on stale (a replaced, appended or inserted candle). */
  invalidate(index: number): void {
    this.dirtyFrom = Math.min(this.dirtyFrom, index);
  }

  /** HA bars for `candles`; O(1) when nothing changed since the last call. */
  get(candles: readonly Candle[]): readonly Candle[] {
    if (candles !== this.source) {
      this.source = candles;
      this.bars = [];
    }
    updateHeikinAshi(this.bars, candles, this.dirtyFrom);
    this.dirtyFrom = Infinity;
    return this.bars;
  }

  /**
   * The main series' bars as displayed for `type`: HA bars for
   * `'heikin-ashi'`, otherwise `candles` itself (releasing any cached bars).
   */
  display(candles: readonly Candle[], type: SeriesType): readonly Candle[] {
    if (type === 'heikin-ashi') return this.get(candles);
    this.clear();
    return candles;
  }

  /** Releases the cached bars and their source array; the next get recomputes. */
  clear(): void {
    if (this.source === null) return;
    this.source = null;
    this.bars = [];
  }
}

/**
 * HA form of the animated live candle at the tail of `bars`, so the eased
 * tip is transformed exactly like the stored last bar.
 */
export function heikinAshiLive(live: Candle | undefined, bars: readonly Candle[]): Candle | undefined {
  return live === undefined ? undefined : heikinAshiBar(live, bars[bars.length - 2]);
}

/**
 * Draws Heikin Ashi bars (see {@link heikinAshi}) with the candlestick styling,
 * colored by HA direction (`colorByPreviousClose` does not apply). The chart
 * passes `RenderView.displayCandles`, i.e. already transformed bars.
 */
export const drawHeikinAshi: SeriesDrawFn = (ctx, bars, range, timeScale, priceScale, config, liveBar) => {
  drawCandlesticks(ctx, bars, range, timeScale, priceScale,
    config.colorByPreviousClose ? { ...config, colorByPreviousClose: false } : config, liveBar);
};
