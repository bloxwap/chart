/**
 * Inline order book: a live bid/ask depth ladder docked beside the plot,
 * sharing the main pane's price scale so every row aligns with the price axis
 * and rescales with zoom/pan. Bars grow from the dock's inner edge with width
 * proportional to the level size, behind optional cumulative-depth shading;
 * the spread row is highlighted and the crosshair-hovered level gets an
 * outline plus a price/size/cumulative tooltip.
 *
 * The primitive reads the chart's book (`Chart.setDepth`, fed by the
 * datafeed's depth channel) at draw time: the depth channel already
 * re-renders the chart on every book update, so the ladder repaints through
 * the regular render instead of a second store pushed with `requestUpdate`.
 * Only the hover highlight uses `requestUpdate`, once per level crossing.
 *
 * @module
 */

import { contrastingTextColor } from '../color.js';
import { DEFAULT_CONFIG, mergeDeep, type ChartConfig, type InlineBookConfig } from '../config.js';
import { DOWN_COLOR, UP_COLOR } from '../indicators/types.js';
import { SIDE_COLOR, TEXT_COLOR } from './range-profile.js';
import type { Chart, PaneApi, PanePrimitiveHandle } from '../core/chart.js';
import type { DepthBook } from '../core/depth.js';
import {
  computeInlineBookRows,
  inlineBookRowAt,
  DEFAULT_INLINE_BOOK_ASK_COLOR,
  DEFAULT_INLINE_BOOK_BID_COLOR,
  DEFAULT_INLINE_BOOK_MAX_LEVELS,
  type InlineBookRow,
  type InlineBookRows,
  type InlineBookSide,
} from '../core/inline-book.js';
import type { Canvas2DLike } from '../dom.js';
import type { PanePrimitive, PrimitiveDrawTarget } from './primitive.js';

/** Options for {@link createInlineBookPrimitive}. */
export interface InlineBookOptions {
  /** Levels shown per side. Default {@link DEFAULT_INLINE_BOOK_MAX_LEVELS}. */
  maxLevels?: number;
  /** Bid bar color. Default {@link DEFAULT_INLINE_BOOK_BID_COLOR}. */
  bidColor?: string;
  /** Ask bar color. Default {@link DEFAULT_INLINE_BOOK_ASK_COLOR}. */
  askColor?: string;
  /** Shade cumulative depth behind the level bars. Default true. */
  cumulative?: boolean;
  /** Level-bar opacity; low values tint the rows behind vivid labels. Default 0.2. */
  opacity?: number;
  /** Cumulative shading opacity. Default 0.08. */
  cumulativeOpacity?: number;
  /**
   * `'ladder'` (default) grows every level from the dock's inner edge;
   * `'mirrored'` grows bids left and asks right from a central label column.
   */
  layout?: 'ladder' | 'mirrored';
  /** Highlight the spread row and label the spread when it fits. Default true. */
  showSpread?: boolean;
  /**
   * The true spread for the label, e.g. from a full-precision best bid/offer
   * feed when the book's levels are aggregated (the band still spans the gap
   * between the aggregated best levels). A null, negative or non-finite value
   * falls back to that gap. Default: the gap.
   */
  spread?: () => number | null;
  /** Spread-row color; `'text'` follows the theme text color. Default `'text'`. */
  spreadColor?: string;
  /** Size label per row when the row is tall enough. Default true. */
  showLabels?: boolean;
  /**
   * Row label color; `'side'` colors each size like its side, `'text'` follows
   * the theme text color. The best bid and ask are bold. Default `'side'`.
   */
  labelColor?: string;
  /** Outline the crosshair-hovered level and show its tooltip. Default true. */
  showHover?: boolean;
}

/** Input for {@link attachInlineBook}. */
export interface InlineBookAttachOptions extends InlineBookOptions {
  /** Host pane id. Default `'inline-book'`. */
  id?: string;
  /**
   * Canvas edge the book docks to, or `'overlay'` to paint it behind the
   * series along the main plot's right edge. Default `'overlay'` when the
   * config's `inlineBook.placement` is, else `'right'`.
   */
  placement?: 'left' | 'right' | 'overlay';
  /** Book width in CSS pixels. Default the config's `inlineBook.width`. */
  width?: number;
  /** Overlay only: gap in CSS pixels between the band and the price axis. Default the config's `inlineBook.inset`. */
  inset?: number;
}

/** Handle of an inline book attached via {@link attachInlineBook}. */
export interface InlineBookApi {
  /** The docked book pane; null for an overlay. */
  readonly pane: PaneApi | null;
  /** Merges new options (and dock `width`) and re-renders. */
  update(options: InlineBookAttachOptions): void;
  /** Drops the hover/config subscriptions, detaches the primitive and removes the pane. */
  remove(): void;
}

/** A pane primitive drawing the depth ladder; see {@link createInlineBookPrimitive}. */
export interface InlineBook extends PanePrimitive {
  /** The ladder the last draw computed, or null when no book is set. */
  readonly rows: InlineBookRows | null;
  /** Sets the crosshair-hovered price for the next draw; null clears the highlight. */
  setHover(price: number | null): void;
}

interface ResolvedInlineBookOptions {
  maxLevels: number;
  spread: (() => number | null) | null;
  layout: 'ladder' | 'mirrored';
  bidColor: string;
  askColor: string;
  cumulative: boolean;
  opacity: number;
  cumulativeOpacity: number;
  showSpread: boolean;
  spreadColor: string;
  showLabels: boolean;
  labelColor: string;
  showHover: boolean;
}

function resolveInlineBookOptions(o: InlineBookOptions): ResolvedInlineBookOptions {
  return {
    maxLevels: Math.max(1, Math.floor(o.maxLevels ?? DEFAULT_INLINE_BOOK_MAX_LEVELS)),
    spread: o.spread ?? null,
    layout: o.layout ?? 'ladder',
    bidColor: o.bidColor ?? DEFAULT_INLINE_BOOK_BID_COLOR,
    askColor: o.askColor ?? DEFAULT_INLINE_BOOK_ASK_COLOR,
    cumulative: o.cumulative ?? true,
    opacity: o.opacity ?? 0.2,
    cumulativeOpacity: o.cumulativeOpacity ?? 0.08,
    showSpread: o.showSpread ?? true,
    spreadColor: o.spreadColor ?? TEXT_COLOR,
    showLabels: o.showLabels ?? true,
    labelColor: o.labelColor ?? SIDE_COLOR,
    showHover: o.showHover ?? true,
  };
}

/** Compact level size: `0.0250`, `12.40`, `1.25K`, `3.40M`. */
export function formatBookSize(size: number): string {
  const abs = Math.abs(size);
  if (abs >= 1_000_000) return `${(size / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(size / 1_000).toFixed(2)}K`;
  if (abs >= 1) return size.toFixed(2);
  return size.toFixed(4);
}

/** Y pixels of a row band's top and bottom edges. */
function rowY(target: PrimitiveDrawTarget, row: InlineBookRow): { y0: number; y1: number } {
  return { y0: target.priceScale.priceToY(row.high), y1: target.priceScale.priceToY(row.low) };
}

/** Colors and label font a draw resolved from the options' tokens and the chart theme. */
interface BookPaint {
  readonly bid: string;
  readonly ask: string;
  readonly bidLabel: string;
  readonly askLabel: string;
  readonly spread: string;
  readonly font: string;
  /** The chart's price formatter, for the spread label and hover tooltip. */
  readonly price: (value: number) => string;
}

function token(value: string, config: ChartConfig): string {
  return value === UP_COLOR ? config.series.upColor : value === DOWN_COLOR ? config.series.downColor
    : value === TEXT_COLOR ? config.theme.textColor : value;
}

function bookPaint(o: ResolvedInlineBookOptions, config: ChartConfig): BookPaint {
  const bid = token(o.bidColor, config), ask = token(o.askColor, config);
  const side = o.labelColor === SIDE_COLOR;
  const label = token(o.labelColor, config);
  return {
    bid, ask,
    bidLabel: side ? bid : label,
    askLabel: side ? ask : label,
    spread: token(o.spreadColor, config),
    font: `11px ${config.theme.monoFamily}`,
    price: config.formatters.price,
  };
}

/** Rows shorter than this skip their size label. */
const LABEL_MIN_ROW_PX = 11;

/** Width of the mirrored layout's central size-label column. */
const MIRROR_SPINE_PX = 34;

/** Where one side's bars grow: from `anchor` toward `dir` over at most `span` pixels, labelled at `labelX`. */
interface SideGeometry {
  readonly anchor: number;
  readonly dir: -1 | 1;
  readonly span: number;
  readonly labelX: number;
  readonly labelAlign: 'right' | 'center';
}

/** Ladder: every level grows leftward from the inner edge. Mirrored: bids left and asks right of the spine. */
function sideGeometry(target: PrimitiveDrawTarget, layout: ResolvedInlineBookOptions['layout'], ask: boolean): SideGeometry {
  if (layout === 'ladder') return { anchor: target.width, dir: -1, span: target.width, labelX: target.width - 4, labelAlign: 'right' };
  const spine = Math.min(MIRROR_SPINE_PX, target.width);
  const half = (target.width - spine) / 2;
  return ask
    ? { anchor: half + spine, dir: 1, span: half, labelX: target.width / 2, labelAlign: 'center' }
    : { anchor: half, dir: -1, span: half, labelX: target.width / 2, labelAlign: 'center' };
}

function drawSide(
  ctx: Canvas2DLike,
  target: PrimitiveDrawTarget,
  side: InlineBookSide,
  color: string,
  labelColor: string,
  font: string,
  maxSize: number,
  maxCumulative: number,
  o: ResolvedInlineBookOptions,
  g: SideGeometry,
): void {
  const alpha = ctx.globalAlpha;
  ctx.textAlign = g.labelAlign;
  ctx.textBaseline = 'middle';
  const bar = (w: number): number => (g.dir < 0 ? g.anchor - w : g.anchor);
  side.rows.forEach((row, i) => {
    const { y0, y1 } = rowY(target, row);
    if (y0 >= target.height || y1 <= 0) return;
    const h = Math.max(1, y1 - y0 - 0.5);
    ctx.fillStyle = color;
    if (o.cumulative) {
      const cw = (row.cumulative / maxCumulative) * g.span;
      ctx.globalAlpha = alpha * o.cumulativeOpacity;
      ctx.fillRect(bar(cw), y0, cw, h);
    }
    const w = (row.size / maxSize) * g.span;
    ctx.globalAlpha = alpha * o.opacity;
    ctx.fillRect(bar(w), y0, w, h);
    // Each row labels itself only when tall enough, so dense fine levels beside coarse ones never overlap.
    if (o.showLabels && y1 - y0 >= LABEL_MIN_ROW_PX) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = labelColor;
      // Medium weight keeps thin glyphs vivid over the tint; the best level is bold.
      ctx.font = i === 0 ? `bold ${font}` : `500 ${font}`;
      ctx.fillText(formatBookSize(row.size), g.labelX, (y0 + y1) / 2);
    }
  });
  ctx.globalAlpha = alpha;
}

/** The band between the best prices, drawn under the rows, with edge ticks and a spread label when it fits. */
function drawSpread(ctx: Canvas2DLike, target: PrimitiveDrawTarget, rows: InlineBookRows, paint: BookPaint, o: ResolvedInlineBookOptions): void {
  const bid = rows.bids.rows[0];
  const ask = rows.asks.rows[0];
  if (bid === undefined || ask === undefined || rows.spread === null) return;
  const y0 = target.priceScale.priceToY(ask.price);
  const y1 = target.priceScale.priceToY(bid.price);
  const y = Math.min(y0, y1);
  const h = Math.max(1, Math.abs(y1 - y0));
  const alpha = ctx.globalAlpha;
  ctx.fillStyle = paint.spread;
  ctx.globalAlpha = alpha * 0.12;
  ctx.fillRect(0, y, target.width, h);
  ctx.globalAlpha = alpha * 0.5;
  ctx.fillRect(0, y - 0.5, target.width, 1);
  ctx.fillRect(0, y + h - 0.5, target.width, 1);
  if (h >= 12) {
    ctx.globalAlpha = alpha;
    ctx.font = paint.font;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const exact = o.spread?.() ?? null;
    const spread = exact !== null && Number.isFinite(exact) && exact >= 0 ? exact : rows.spread;
    ctx.fillText(`Δ ${paint.price(spread)}`, target.width - 4, y + h / 2);
  }
  ctx.globalAlpha = alpha;
}

/** Outline of the hovered level plus a `price · size  Σ cumulative` tooltip beside it. */
function drawHover(ctx: Canvas2DLike, target: PrimitiveDrawTarget, rows: InlineBookRows, price: number, paint: BookPaint): void {
  const side = rows.bestAsk !== null && price >= rows.bestAsk ? rows.asks
    : rows.bestBid !== null && price <= rows.bestBid ? rows.bids
      : null;
  const row = side === null ? null : inlineBookRowAt(side, price);
  if (row === null || side === null) return;
  const color = side === rows.asks ? paint.ask : paint.bid;
  const { y0, y1 } = rowY(target, row);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.rect(0.5, y0 + 0.5, target.width - 1, Math.max(1, y1 - y0 - 1));
  ctx.stroke();
  const text = `${paint.price(row.price)} · ${formatBookSize(row.size)}  Σ ${formatBookSize(row.cumulative)}`;
  ctx.font = paint.font;
  const th = 16;
  const tw = Math.min(ctx.measureText(text).width + 8, target.width);
  const ty = Math.min(Math.max(0, (y0 + y1) / 2 - th / 2), Math.max(0, target.height - th));
  ctx.fillStyle = color;
  ctx.fillRect(0, ty, tw, th);
  ctx.fillStyle = contrastingTextColor(color);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 4, ty + th / 2);
}

/**
 * A primitive painting the depth ladder of the book `book` returns (null
 * draws nothing): asks above the spread, bids below, both anchored to the
 * dock's inner edge. Rows sit at their exact prices on the shared scale, so
 * the ladder rescales with the main pane on zoom and pan.
 */
export function createInlineBookPrimitive(book: () => DepthBook | null, options: InlineBookOptions = {}): InlineBook {
  return inlineBookPrimitive(book, resolveInlineBookOptions(options), () => DEFAULT_CONFIG);
}

/** The shared-resolved primitive; `attachInlineBook` mutates `resolved` to live-update. */
function inlineBookPrimitive(book: () => DepthBook | null, resolved: ResolvedInlineBookOptions, theme: () => ChartConfig): InlineBook {
  let hover: number | null = null;
  let rows: InlineBookRows | null = null;

  function draw(ctx: Canvas2DLike, target: PrimitiveDrawTarget): void {
    const current = book();
    rows = current === null ? null : computeInlineBookRows(current, resolved.maxLevels);
    if (rows === null) return;
    const maxSize = Math.max(rows.bids.maxSize, rows.asks.maxSize);
    if (maxSize <= 0) return;
    // Cumulative depth is at least the largest level, so it is positive here.
    const maxCumulative = Math.max(rows.bids.maxCumulative, rows.asks.maxCumulative);
    const paint = bookPaint(resolved, theme());
    ctx.save();
    if (resolved.showSpread) drawSpread(ctx, target, rows, paint, resolved);
    drawSide(ctx, target, rows.asks, paint.ask, paint.askLabel, paint.font, maxSize, maxCumulative, resolved, sideGeometry(target, resolved.layout, true));
    drawSide(ctx, target, rows.bids, paint.bid, paint.bidLabel, paint.font, maxSize, maxCumulative, resolved, sideGeometry(target, resolved.layout, false));
    if (resolved.showHover && hover !== null) drawHover(ctx, target, rows, hover, paint);
    ctx.restore();
  }

  return {
    get rows() {
      return rows;
    },
    setHover(price) {
      hover = price;
    },
    draw,
  };
}

/**
 * Paints `book` behind the series in a `width()`-pixel band of the main pane,
 * `inset()` pixels in from the price axis, so the book takes no plot width.
 */
function overlayPrimitive(book: InlineBook, width: () => number, inset: () => number): PanePrimitive {
  return {
    zOrder: 'behind',
    draw(ctx, target) {
      const w = Math.min(width(), target.width);
      ctx.save();
      ctx.translate(Math.max(0, target.width - w - inset()), 0);
      book.draw(ctx, { ...target, width: w });
      ctx.restore();
    },
  };
}

/** The config section as primitive options; `enabled` and `width` are handled by the attach. */
function configOptions(config: InlineBookConfig): InlineBookOptions {
  return {
    maxLevels: config.maxLevels,
    layout: config.layout,
    bidColor: config.bidColor,
    askColor: config.askColor,
    cumulative: config.cumulative,
    showLabels: config.showLabels,
  };
}

/**
 * Docks the live inline order book at `placement` (sharing the main price
 * scale), reading `chart.depth` on every render. Options resolve over the
 * config's `inlineBook` section, and an attached book follows later
 * `updateConfig({ inlineBook })` writes (level count, colors, cumulative
 * shading, labels, width). The crosshair hover repaints once per level
 * crossing, not per pointer move.
 */
export function attachInlineBook(chart: Chart, options: InlineBookAttachOptions = {}): InlineBookApi {
  let explicit: InlineBookAttachOptions = options;
  const resolved = resolveInlineBookOptions(mergeDeep(configOptions(chart.getConfig().inlineBook), explicit));
  const placement = options.placement ?? (chart.getConfig().inlineBook.placement === 'overlay' ? 'overlay' : 'right');
  let dockWidth = options.width ?? chart.getConfig().inlineBook.width;
  const primitive = inlineBookPrimitive(() => chart.depth, resolved, () => chart.getConfig());
  let pane: PaneApi | null = null;
  let handle: PanePrimitiveHandle;
  if (placement === 'overlay') {
    handle = chart.attachPrimitive(overlayPrimitive(primitive, () => dockWidth,
      () => explicit.inset ?? chart.getConfig().inlineBook.inset));
  } else {
    pane = chart.addPane({ id: options.id ?? 'inline-book', placement, width: dockWidth, sharePriceScale: true });
    handle = pane.attachPrimitive(primitive);
  }
  const resize = (width: number): void => {
    dockWidth = width;
    pane?.setWidth(width);
  };
  let hoverKey: string | null = null;

  /** Repaints the hover only when the pointer crosses into another level. */
  const offCrosshair = chart.subscribeCrosshairMove((event) => {
    const price = event.active ? event.price : null;
    let key: string | null = null;
    if (price !== null && primitive.rows !== null) {
      const rows = primitive.rows;
      const side = rows.bestAsk !== null && price >= rows.bestAsk ? rows.asks
        : rows.bestBid !== null && price <= rows.bestBid ? rows.bids
          : null;
      const row = side === null ? null : inlineBookRowAt(side, price);
      if (row !== null) key = `${side === rows.asks ? 'a' : 'b'}:${row.price}`;
    }
    if (key === hoverKey) return;
    hoverKey = key;
    primitive.setHover(key === null ? null : price);
    handle.requestUpdate();
  });

  const offConfig = chart.subscribeConfigChange(({ keys }) => {
    if (!keys.includes('inlineBook')) return;
    const config = chart.getConfig().inlineBook;
    Object.assign(resolved, resolveInlineBookOptions(mergeDeep(configOptions(config), explicit)));
    if (explicit.width === undefined && config.width !== dockWidth) resize(config.width);
    handle.requestUpdate();
  });

  return {
    pane,
    update(next) {
      explicit = mergeDeep(explicit, next);
      Object.assign(resolved, resolveInlineBookOptions(mergeDeep(configOptions(chart.getConfig().inlineBook), explicit)));
      if (next.width !== undefined && next.width !== dockWidth) resize(next.width);
      handle.requestUpdate();
    },
    remove() {
      offCrosshair();
      offConfig();
      handle.detach();
      pane?.remove();
    },
  };
}
