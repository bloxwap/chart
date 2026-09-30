/**
 * Pure math for the inline order book: trimming a maintained L2 book to the
 * visible ladder, cumulative depth per level, per-row price bands and the
 * hover lookup. Rendering lives in `render/inline-book.ts`.
 *
 * @module
 */

import type { DepthBook, DepthLevel } from './depth.js';

/** Levels shown per side of the ladder by default. */
export const DEFAULT_INLINE_BOOK_MAX_LEVELS = 16;

/** Default bid color: the `'up'` token, following the theme's `series.upColor`. */
export const DEFAULT_INLINE_BOOK_BID_COLOR = 'up';

/** Default ask color: the `'down'` token, following the theme's `series.downColor`. */
export const DEFAULT_INLINE_BOOK_ASK_COLOR = 'down';

/** Default width in CSS pixels of the docked inline book pane. */
export const DEFAULT_INLINE_BOOK_WIDTH = 96;

/** One ladder row: a book level with its cumulative depth and price band. */
export interface InlineBookRow {
  readonly price: number;
  readonly size: number;
  /** Total size from the best level through this row. */
  readonly cumulative: number;
  /** Lower price boundary of the row's band. */
  readonly low: number;
  /** Upper price boundary of the row's band. */
  readonly high: number;
}

/** One side of the ladder, best-first. */
export interface InlineBookSide {
  readonly rows: readonly InlineBookRow[];
  /** Largest single-level size; sizes normalize against it for bar widths. */
  readonly maxSize: number;
  /** Total size of the shown levels; cumulative depth normalizes against it. */
  readonly maxCumulative: number;
}

/** A trimmed book ladder; see {@link computeInlineBookRows}. */
export interface InlineBookRows {
  readonly bids: InlineBookSide;
  readonly asks: InlineBookSide;
  readonly bestBid: number | null;
  readonly bestAsk: number | null;
  /** `bestAsk - bestBid`; null unless both sides have a level. */
  readonly spread: number | null;
}

/** Smallest positive gap between adjacent levels of both sides; the fallback step for ragged books. */
function minGap(book: DepthBook): number | null {
  let gap = Infinity;
  for (const side of [book.bids, book.asks]) {
    for (let i = 1; i < side.length; i++) {
      const d = Math.abs(side[i]![0] - side[i - 1]![0]);
      if (d > 0 && d < gap) gap = d;
    }
  }
  return gap === Infinity ? null : gap;
}

/**
 * Rows of one side, best-first. `outward` is 1 for asks (prices rise away
 * from the spread) and -1 for bids. A row's band reaches the midpoint toward
 * each neighbor; edge rows extend half their own step (`fallback` when the
 * side has a single level). Levels with a non-finite price or size, or a
 * non-positive size, are dropped.
 */
function sideRows(levels: readonly DepthLevel[], maxLevels: number, outward: 1 | -1, fallback: number): InlineBookSide {
  const taken = levels.filter(([p, s]) => Number.isFinite(p) && Number.isFinite(s) && s > 0).slice(0, maxLevels);
  const rows: InlineBookRow[] = [];
  let cumulative = 0;
  let maxSize = 0;
  for (let i = 0; i < taken.length; i++) {
    const [price, size] = taken[i]!;
    const next = i + 1 < taken.length ? (taken[i + 1]![0] - price) * outward : NaN;
    const prev = i > 0 ? (price - taken[i - 1]![0]) * outward : NaN;
    const step = Number.isFinite(next) && next > 0 ? next : Number.isFinite(prev) && prev > 0 ? prev : fallback;
    const outer = price + (outward * step) / 2;
    const inner = i === 0 ? price - (outward * step) / 2 : (taken[i - 1]![0] + price) / 2;
    cumulative += size;
    if (size > maxSize) maxSize = size;
    rows.push({ price, size, cumulative, low: Math.min(inner, outer), high: Math.max(inner, outer) });
  }
  return { rows, maxSize, maxCumulative: cumulative };
}

/**
 * Trims `book` to `maxLevels` per side and prices every row's band. A row
 * reaches the midpoint toward each neighbor, so a gap between levels widens
 * the rows beside it instead of leaving dead space; the best rows extend half
 * a step into the spread. `maxLevels` clamps to a positive integer.
 */
export function computeInlineBookRows(book: DepthBook, maxLevels: number): InlineBookRows {
  const levels = Math.max(1, Math.floor(maxLevels));
  const step = minGap(book) ?? 1;
  const bids = sideRows(book.bids, levels, -1, step);
  const asks = sideRows(book.asks, levels, 1, step);
  const bestBid = bids.rows[0]?.price ?? null;
  const bestAsk = asks.rows[0]?.price ?? null;
  return {
    bids,
    asks,
    bestBid,
    bestAsk,
    spread: bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null,
  };
}

/** The row whose band contains `price`, or null when the side does not cover it. */
export function inlineBookRowAt(side: InlineBookSide, price: number): InlineBookRow | null {
  for (const row of side.rows) {
    if (price >= row.low && price <= row.high) return row;
  }
  return null;
}
