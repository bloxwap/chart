/**
 * Pure footprint math: per-level price bands inside a bar, the zoom
 * level-of-detail pick, and per-candle delta aggregation over a footprint
 * source. Rendering lives in `series/footprint.ts`; the delta and CVD
 * sub-pane indicators in `indicators/delta.ts` and `indicators/cvd.ts`.
 *
 * @module
 */

import type { Candle } from './data.js';

/** The level shape a footprint source serves (`FootprintLevel`-compatible). */
export interface FootprintLevelLike {
  readonly price: number;
  readonly buySize: number;
  readonly sellSize: number;
}

/** The bar shape a footprint source serves (`FootprintBar`-compatible). */
export interface FootprintBarLike {
  /** Bar open time in ms. */
  readonly time: number;
  /** Levels sorted by price ascending. */
  readonly levels: readonly FootprintLevelLike[];
  readonly buySize: number;
  readonly sellSize: number;
}

/**
 * A per-bar footprint lookup by ms timestamp. A `TradeAggregation` satisfies
 * this directly; a `Datafeed` needs `datafeedFootprintSource` (its session
 * replaces the store on every `setSymbol`, so a captured store would go stale).
 */
export interface FootprintSource {
  /** The aggregated bar whose bucket contains `timeMs`, or null. */
  bar(timeMs: number): FootprintBarLike | null;
}

/** What a footprint bar paints per level at the current zoom. */
export type FootprintDisplay = 'bid-ask' | 'delta' | 'profile';

/** The level of detail one footprint bar renders at. */
export type FootprintLod = 'text' | 'bars' | 'delta';

/** Pixel thresholds for {@link footprintLod}. */
export interface FootprintLodThresholds {
  /** Smallest row height that fits a bid×ask label. */
  readonly textCellHeight: number;
  /** Smallest bar width that fits a bid×ask label. */
  readonly textBarWidth: number;
  /** Smallest row height that fits a per-level bar; below it the bar collapses to delta coloring. */
  readonly barCellHeight: number;
}

/** Default LOD thresholds in CSS pixels. */
export const DEFAULT_FOOTPRINT_LOD: FootprintLodThresholds = { textCellHeight: 11, textBarWidth: 44, barCellHeight: 3 };

/** One level's price band: midpoints toward the neighbors, half a step past the edges. */
export interface FootprintBand {
  readonly price: number;
  readonly low: number;
  readonly high: number;
}

/** Smallest positive gap between adjacent level prices; the fallback step for a single level. */
function minGap(levels: readonly FootprintLevelLike[]): number | null {
  let gap = Infinity;
  for (let i = 1; i < levels.length; i++) {
    const d = levels[i]!.price - levels[i - 1]!.price;
    if (d > 0 && d < gap) gap = d;
  }
  return gap === Infinity ? null : gap;
}

/**
 * Price bands of a footprint bar's levels (ascending). A band reaches the
 * midpoint toward each neighbor, so a gap between traded prices widens the
 * cells beside it instead of leaving dead space; edge levels extend half
 * their own step (`fallback` for a single level). Levels with a non-finite
 * price are dropped.
 */
export function footprintBands(levels: readonly FootprintLevelLike[]): FootprintBand[] {
  const taken = levels.filter((level) => Number.isFinite(level.price));
  const fallback = minGap(taken) ?? 1;
  const bands: FootprintBand[] = [];
  for (let i = 0; i < taken.length; i++) {
    const price = taken[i]!.price;
    const next = i + 1 < taken.length ? taken[i + 1]!.price - price : NaN;
    const prev = i > 0 ? price - taken[i - 1]!.price : NaN;
    const step = Number.isFinite(next) && next > 0 ? next : Number.isFinite(prev) && prev > 0 ? prev : fallback;
    bands.push({
      price,
      low: i === 0 ? price - step / 2 : (taken[i - 1]!.price + price) / 2,
      high: i === taken.length - 1 ? price + step / 2 : (price + taken[i + 1]!.price) / 2,
    });
  }
  return bands;
}

/**
 * The detail one bar renders at: a bid×ask label per level when the cells fit
 * the text (`'bid-ask'` display only), per-level bars while rows stay visible,
 * else a single column colored by the bar's delta.
 */
export function footprintLod(
  barWidthPx: number,
  cellHeightPx: number,
  display: FootprintDisplay,
  thresholds: FootprintLodThresholds = DEFAULT_FOOTPRINT_LOD,
): FootprintLod {
  if (display === 'bid-ask' && cellHeightPx >= thresholds.textCellHeight && barWidthPx >= thresholds.textBarWidth) return 'text';
  if (cellHeightPx >= thresholds.barCellHeight) return 'bars';
  return 'delta';
}

/** A footprint bar's traded delta: buy (ask-side) size minus sell (bid-side) size. */
export function barDelta(bar: FootprintBarLike): number {
  return bar.buySize - bar.sellSize;
}

/** A candle's traded delta from `source` (candle times are seconds, the source buckets in ms); no footprint bar counts 0. */
export function candleDelta(candle: Candle, source: FootprintSource): number {
  const bar = source.bar(candle.time * 1000);
  return bar === null ? 0 : barDelta(bar);
}

/** Per-candle traded deltas, one per candle, in candle order. */
export function candleDeltas(candles: readonly Candle[], source: FootprintSource): number[] {
  return candles.map((candle) => candleDelta(candle, source));
}
