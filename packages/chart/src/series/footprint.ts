/**
 * Footprint series renderer: traded bid×ask volume per price cell inside each
 * bar, fed by a {@link FootprintSource} (the trade aggregation behind the
 * datafeed's `pushTrade`). Zoomed in, each level shows its `sell × buy` label
 * (bid × ask: seller-initiated size first); when the cells no longer fit the
 * text the bar degrades to per-level volume bars, and zoomed further out to a
 * single column colored by the bar's delta (see {@link footprintLod}).
 *
 * The source is a factory option rather than a draw argument: register the
 * result via `Chart.registerSeries('footprint', createFootprintSeries(source))`
 * and select it with `series: { type: 'footprint' }`. Reads happen at draw
 * time, so the cells repaint through the regular render like the inline book
 * reads `Chart.depth`.
 *
 * @module
 */

import type { GLFrame } from '../render/gl/backend.js';
import type { SeriesConfig } from '../config.js';
import {
  barDelta,
  footprintBands,
  footprintLod,
  DEFAULT_FOOTPRINT_LOD,
  type FootprintBand,
  type FootprintBarLike,
  type FootprintDisplay,
  type FootprintLevelLike,
  type FootprintLodThresholds,
  type FootprintSource,
} from '../core/footprint.js';
import type { Canvas2DLike } from '../dom.js';
import type { PriceScale } from '../core/scale.js';
import type { SeriesDrawFn } from './types.js';

/** The conventional type string for the footprint series. */
export const FOOTPRINT_SERIES_TYPE = 'footprint';

/** Options for {@link createFootprintSeries}. */
export interface FootprintSeriesOptions {
  /** Per-level content: bid×ask labels (collapsing with zoom), delta bars, or plain volume bars. Default `'bid-ask'`. */
  display?: FootprintDisplay;
  /** Buy-side (ask, delta-positive) color. Default the series config's `upColor`. */
  upColor?: string;
  /** Sell-side (bid, delta-negative) color. Default the series config's `downColor`. */
  downColor?: string;
  /** Cell label color; default null colors each label by the level's delta sign. */
  textColor?: string | null;
  /** LOD overrides in CSS pixels; missing entries keep {@link DEFAULT_FOOTPRINT_LOD}. */
  lodThresholds?: Partial<FootprintLodThresholds>;
}

/** A fixed store, or a getter for swapping sessions without re-registering. */
export type FootprintSeriesSource = FootprintSource | (() => FootprintSource | null);

interface ResolvedFootprintOptions {
  display: FootprintDisplay;
  upColor: string;
  downColor: string;
  textColor: string | null;
  thresholds: FootprintLodThresholds;
}

function resolveFootprintOptions(o: FootprintSeriesOptions, config: SeriesConfig): ResolvedFootprintOptions {
  return {
    display: o.display ?? 'bid-ask',
    upColor: o.upColor ?? config.upColor,
    downColor: o.downColor ?? config.downColor,
    textColor: o.textColor ?? null,
    thresholds: { ...DEFAULT_FOOTPRINT_LOD, ...o.lodThresholds },
  };
}

/** Compact level size: `0`, `0.0250`, `12.40`, `1.25K`, `3.40M`. */
export function formatFootprintSize(size: number): string {
  const abs = Math.abs(size);
  if (abs === 0) return '0';
  if (abs >= 1_000_000) return `${(size / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(size / 1_000).toFixed(2)}K`;
  if (abs >= 1) return size.toFixed(2);
  return size.toFixed(4);
}

interface CellRow {
  band: FootprintBand;
  level: FootprintLevelLike;
  y0: number;
  y1: number;
}

function cellRows(bar: FootprintBarLike, priceScale: PriceScale): { rows: CellRow[]; cellPx: number } {
  const levels = bar.levels.filter((level) => Number.isFinite(level.price));
  const bands = footprintBands(levels);
  const rows: CellRow[] = [];
  let cellPx = Infinity;
  for (let i = 0; i < bands.length; i++) {
    const y0 = priceScale.priceToY(bands[i]!.high);
    const y1 = priceScale.priceToY(bands[i]!.low);
    rows.push({ band: bands[i]!, level: levels[i]!, y0, y1 });
    if (y1 - y0 < cellPx) cellPx = y1 - y0;
  }
  return { rows, cellPx };
}

/** Zoomed all the way out: one column over the bar's traded range, colored by the bar's delta. */
function drawDeltaColumn(ctx: Canvas2DLike, bar: FootprintBarLike, rows: readonly CellRow[], x: number, w: number, o: ResolvedFootprintOptions): void {
  const alpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha * 0.35;
  ctx.fillStyle = barDelta(bar) >= 0 ? o.upColor : o.downColor;
  ctx.fillRect(x, rows[rows.length - 1]!.y0, w, Math.max(1, rows[0]!.y1 - rows[rows.length - 1]!.y0));
  ctx.globalAlpha = alpha;
}

/** Per-level volume bars: bid×ask halves split at the center, delta bars, or plain volume bars. */
function drawLevelBars(ctx: Canvas2DLike, rows: readonly CellRow[], x: number, w: number, o: ResolvedFootprintOptions): void {
  let maxTotal = 0, maxSide = 0, maxDelta = 0;
  for (const { level } of rows) {
    const total = level.buySize + level.sellSize;
    if (total > maxTotal) maxTotal = total;
    if (level.buySize > maxSide) maxSide = level.buySize;
    if (level.sellSize > maxSide) maxSide = level.sellSize;
    const delta = Math.abs(level.buySize - level.sellSize);
    if (delta > maxDelta) maxDelta = delta;
  }
  const normalizer = o.display === 'delta' ? maxDelta : o.display === 'profile' ? maxTotal : maxSide;
  if (normalizer <= 0) return;
  for (const { level, y0, y1 } of rows) {
    const h = Math.max(1, y1 - y0 - 0.5);
    if (o.display === 'bid-ask') {
      const half = w / 2;
      const sellW = (level.sellSize / normalizer) * half;
      const buyW = (level.buySize / normalizer) * half;
      if (sellW > 0) {
        ctx.fillStyle = o.downColor;
        ctx.fillRect(x + half - sellW, y0, sellW, h);
      }
      if (buyW > 0) {
        ctx.fillStyle = o.upColor;
        ctx.fillRect(x + half, y0, buyW, h);
      }
    } else {
      const delta = level.buySize - level.sellSize;
      const size = o.display === 'delta' ? Math.abs(delta) : level.buySize + level.sellSize;
      ctx.fillStyle = delta >= 0 ? o.upColor : o.downColor;
      ctx.fillRect(x, y0, (size / normalizer) * w, h);
    }
  }
}

/** Zoomed in: a `sell × buy` label per level over a faint delta-signed tint. */
function drawTextCells(ctx: Canvas2DLike, rows: readonly CellRow[], x: number, w: number, o: ResolvedFootprintOptions, gl?: GLFrame): void {
  const alpha = ctx.globalAlpha;
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const { level, y0, y1 } of rows) {
    const h = Math.max(1, y1 - y0 - 0.5);
    const up = level.buySize >= level.sellSize;
    ctx.globalAlpha = alpha * 0.12;
    ctx.fillStyle = up ? o.upColor : o.downColor;
    ctx.fillRect(x, y0, w, h);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = o.textColor ?? (up ? o.upColor : o.downColor);
    const label = `${formatFootprintSize(level.sellSize)}×${formatFootprintSize(level.buySize)}`;
    const labelX = x + w / 2, labelY = (y0 + y1) / 2;
    if (!gl?.text?.(label, labelX, labelY, ctx.fillStyle as string, alpha)) ctx.fillText(label, labelX, labelY);
  }
}

/**
 * A {@link SeriesDrawFn} painting the footprint of each visible bar. Bars
 * without a footprint bucket (no trades, or a source without the session's
 * history) draw nothing. The source maps candle times (seconds) to the
 * store's ms buckets, so its `intervalMs` should match the chart's bars.
 */
export function createFootprintSeries(source: FootprintSeriesSource, options: FootprintSeriesOptions = {}): SeriesDrawFn {
  const resolve = typeof source === 'function' ? source : () => source;
  return (ctx, candles, range, timeScale, priceScale, config, _liveCandle, gl) => {
    const store = resolve();
    if (store === null) return;
    const o = resolveFootprintOptions(options, config);
    const w = Math.max(1, timeScale.barSpacing - 1);
    for (let i = range.from; i < range.to; i++) {
      const bar = store.bar(candles[i]!.time * 1000);
      if (bar === null || bar.levels.length === 0) continue;
      const { rows, cellPx } = cellRows(bar, priceScale);
      const x = Math.round(timeScale.indexToX(i, candles.length) - w / 2);
      const lod = footprintLod(timeScale.barSpacing, cellPx, o.display, o.thresholds);
      if (lod === 'text') drawTextCells(ctx, rows, x, w, o, gl);
      else if (lod === 'bars') drawLevelBars(ctx, rows, x, w, o);
      else drawDeltaColumn(ctx, bar, rows, x, w, o);
    }
  };
}
