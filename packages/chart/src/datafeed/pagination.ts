/**
 * Backward history paging over an inclusive-window bar source such as
 * Hyperliquid's `candleSnapshot`: bounded pages, boundary dedupe, stepping
 * over holes in the source, a no-progress guard and abort propagation. Pure
 * apart from `fetchBars`.
 *
 * @module
 */

import type { Candle } from '../core/data.js';
import { createAbortController, type AbortControllerLike, type DatafeedSignal } from './abort.js';
import { bucketStartMs, candleTimeMs, normalizeCandles } from './candles.js';

/** Default rows per request: Hyperliquid's `candleSnapshot` cap. */
export const DEFAULT_PAGE_SIZE = 5_000;

/**
 * Default empty pages in a row that end paging. With {@link DEFAULT_PAGE_SIZE}
 * it steps over any hole shorter than 10,000 buckets: about a week of 1m bars.
 */
export const DEFAULT_MAX_EMPTY_PAGES = 3;

/** One history read: the bars opening within `[fromMs, toMs]` (both inclusive, epoch ms). */
export interface FetchBarsRequest {
  /** The instrument, as passed to `setSymbol`. */
  readonly symbol: string;
  /** Bar width in ms. */
  readonly intervalMs: number;
  /** Earliest bar open wanted (inclusive). */
  readonly fromMs: number;
  /** Latest bar open wanted (inclusive). */
  readonly toMs: number;
  /** Bars the window holds (at most the page size); the window already bounds the read. */
  readonly countBack: number;
  /** Aborted once the read is superseded; hand it to `fetch`. Results after an abort are ignored. */
  readonly signal: DatafeedSignal;
}

/**
 * Reads every bar the source has for a {@link FetchBarsRequest}, in any order;
 * duplicates and rows outside the window are tolerated. The window never holds
 * more than `pageSize` buckets.
 */
export type FetchBars = (request: FetchBarsRequest) => Promise<readonly Candle[]>;

/** Inclusive request window, in epoch ms. */
export interface PageWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

/** Options for {@link loadHistory}. */
export interface LoadHistoryOptions {
  /** The bar source. */
  fetchBars: FetchBars;
  /** Passed through to `fetchBars`. */
  symbol: string;
  /** Bar width in whole ms; buckets open at multiples of it since the epoch. */
  intervalMs: number;
  /** Earliest bar open wanted (inclusive, epoch ms). Default 0. */
  fromMs?: number;
  /** Latest bar open wanted (inclusive, epoch ms), e.g. now or the loaded first bar's open minus 1. */
  toMs: number;
  /** Most bars wanted, counted back from `toMs`. */
  countBack: number;
  /** Aborts the paging; the returned promise then rejects with its reason. */
  signal?: DatafeedSignal;
  /**
   * Makes the controller whose signal reaches `fetchBars` when no `signal` is
   * given, e.g. for a runtime without a global `AbortController`. Default:
   * the global `AbortController`.
   */
  createAbortController?: () => AbortControllerLike;
  /**
   * Most rows one request may return: no more than the source's own
   * per-request cap. Each page is taken to hold every bar the source has from
   * its earliest row to the window's end, so a larger value against a source
   * that truncates a window to its earliest rows (rather than its latest)
   * leaves holes. Default {@link DEFAULT_PAGE_SIZE}.
   */
  pageSize?: number;
  /**
   * Empty pages in a row that end paging (a positive integer). An empty page
   * is taken as a hole in the source (a weekend, a closed session, an outage)
   * and stepped over: each empty page after the first spans `pageSize`
   * buckets, so a hole shorter than `(maxEmptyPages - 1) * pageSize` buckets
   * never ends paging. `1` stops at the first empty page. Default
   * {@link DEFAULT_MAX_EMPTY_PAGES}.
   */
  maxEmptyPages?: number;
}

/** @internal What {@link pageHistory} read, and whether older bars can exist. */
export interface HistoryRead {
  /** As {@link loadHistory} resolves. */
  readonly bars: Candle[];
  /** Paging ended at `fromMs` or on `maxEmptyPages` empty pages: nothing older is left to read. */
  readonly exhausted: boolean;
}

/** Number of epoch-aligned bucket opens within `[fromMs, toMs]` (both inclusive). */
export function barsInWindow(intervalMs: number, fromMs: number, toMs: number): number {
  return Math.max(0, Math.floor(toMs / intervalMs) - Math.ceil(fromMs / intervalMs) + 1);
}

/**
 * The inclusive window holding the `pageSize` buckets that end with the one
 * containing `toMs`, clamped to start no earlier than `fromMs`.
 */
export function pageWindow(intervalMs: number, fromMs: number, toMs: number, pageSize: number): PageWindow {
  return { fromMs: Math.max(fromMs, bucketStartMs(toMs, intervalMs) - intervalMs * (pageSize - 1)), toMs };
}

/**
 * Merges two candle lists: normalized (see `normalizeCandles`), deduped by
 * `time` with `b` winning over `a`, sorted ascending.
 */
export function mergeCandles(a: readonly Candle[], b: readonly Candle[]): Candle[] {
  return normalizeCandles(a.concat(b));
}

/** Throws the abort reason once `signal` is aborted. */
function throwIfAborted(signal: DatafeedSignal): void {
  if (signal.aborted) throw signal.reason ?? new Error('chart-ts: history read aborted');
}

/**
 * Pages backwards from `toMs` until `countBack` bars or `fromMs` are covered.
 * Each request spans at most `pageSize` buckets; the next one ends 1 ms before
 * the earliest bar received, because windows are inclusive. Rows outside a
 * request's window (such as an echoed boundary bar) are dropped, so every page
 * moves strictly back in time. A short page (missing buckets) keeps paging; an
 * empty one is stepped over, and `maxEmptyPages` of them in a row end the read
 * (history exhausted). Returns at most `countBack` normalized candles, the
 * latest ones.
 *
 * @throws The abort reason when `signal` aborts, even if `fetchBars` ignored it.
 */
export async function loadHistory(options: LoadHistoryOptions): Promise<Candle[]> {
  return (await pageHistory(options)).bars;
}

/**
 * @internal {@link loadHistory}, also reporting whether it ran out of history,
 * so a datafeed can stop reading without another round of empty pages.
 */
export async function pageHistory(options: LoadHistoryOptions): Promise<HistoryRead> {
  const { fetchBars, symbol, intervalMs, toMs } = options;
  const fromMs = options.fromMs ?? 0;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxEmptyPages = options.maxEmptyPages ?? DEFAULT_MAX_EMPTY_PAGES;
  const signal = options.signal ?? (options.createAbortController ?? createAbortController)().signal;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error(`chart-ts: intervalMs must be a positive integer number of ms, got ${intervalMs}`);
  }
  for (const [name, value] of [['pageSize', pageSize], ['maxEmptyPages', maxEmptyPages]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`chart-ts: ${name} must be a positive integer, got ${value}`);
  }
  const wanted = Math.min(Math.floor(options.countBack), barsInWindow(intervalMs, fromMs, toMs));
  let rows: Candle[] = [];
  let endMs = toMs;
  let empty = 0;
  let exhausted = false;
  while (rows.length < wanted) {
    // Past an empty page, whole-page windows step over the hole in as few reads as the source allows.
    const size = empty > 0 ? pageSize : Math.min(pageSize, wanted - rows.length);
    const span = pageWindow(intervalMs, fromMs, endMs, size);
    const countBack = barsInWindow(intervalMs, span.fromMs, span.toMs);
    throwIfAborted(signal);
    const received = await fetchBars({ symbol, intervalMs, fromMs: span.fromMs, toMs: span.toMs, countBack, signal });
    throwIfAborted(signal);
    // Clipping to the window is the no-progress guard: every kept row opens before the last page.
    const page = normalizeCandles(received).filter((c) => {
      const t = candleTimeMs(c);
      return t >= span.fromMs && t <= span.toMs;
    });
    rows = page.concat(rows);
    // A short page is a gap in the source, not its start: only fromMs or a run of empty pages ends the read.
    empty = page.length === 0 ? empty + 1 : 0;
    if (span.fromMs <= fromMs || empty >= maxEmptyPages) {
      exhausted = true;
      break;
    }
    // Past an empty page the next window ends before this one; otherwise before the earliest bar.
    endMs = (page.length === 0 ? span.fromMs : candleTimeMs(page[0]!)) - 1;
  }
  return { bars: rows.length > wanted ? rows.slice(rows.length - wanted) : rows, exhausted };
}
