/**
 * Trade aggregation for footprint charts: a store keyed by (bar, price) that
 * folds the trade stream into per-bucket levels of buy and sell size and
 * count. Pure and synchronous — no snapshot, no retry: trades are a fire-and-
 * forget stream, so a gap is simply missing prints, never a resync.
 *
 * @module
 */

import type { Trade } from '../core/trade.js';
import { bucketStartMs } from './candles.js';

/** Bars retained by default; the oldest bucket is evicted beyond the cap. */
export const MAX_FOOTPRINT_BARS = 2_000;

/** One price level of a footprint bar: size and trade count per aggressor side. */
export interface FootprintLevel {
  readonly price: number;
  readonly buySize: number;
  readonly sellSize: number;
  readonly buyCount: number;
  readonly sellCount: number;
}

/** The trades of one bar bucket, aggregated per price level. */
export interface FootprintBar {
  /** Bar open time in ms (the epoch-aligned bucket start). */
  readonly time: number;
  /** Levels sorted by price ascending. */
  readonly levels: readonly FootprintLevel[];
  readonly buySize: number;
  readonly sellSize: number;
  readonly buyCount: number;
  readonly sellCount: number;
}

/** Options for {@link createTradeAggregation}. */
export interface TradeAggregationOptions {
  /** Bar width in whole ms; trades bucket into epoch-aligned bars of this size. */
  readonly intervalMs: number;
  /** Cap on retained bars; the oldest bucket is evicted beyond it. Defaults to {@link MAX_FOOTPRINT_BARS}. */
  readonly maxBars?: number;
}

/** A (bar, price) trade aggregation store; see {@link createTradeAggregation}. */
export interface TradeAggregation {
  /** Bar width in ms. */
  readonly intervalMs: number;
  /** Number of retained bars. */
  readonly size: number;
  /**
   * Folds one trade into its (bar, price) level. A trade with a non-finite
   * time, price or size, a non-positive size, or an unknown side is ignored.
   */
  push(trade: Trade): void;
  /** The aggregated bar whose bucket contains `timeMs`, or null when no trade landed there. */
  bar(timeMs: number): FootprintBar | null;
  /** The aggregated bars opening within `[fromMs, toMs]` (inclusive), oldest first. */
  barsInRange(fromMs: number, toMs: number): FootprintBar[];
  /** Drops every retained bar. */
  clear(): void;
}

interface MutableLevel {
  price: number;
  buySize: number;
  sellSize: number;
  buyCount: number;
  sellCount: number;
}

interface MutableBar {
  readonly time: number;
  readonly levels: Map<number, MutableLevel>;
  buySize: number;
  sellSize: number;
  buyCount: number;
  sellCount: number;
}

function toFootprintBar(bar: MutableBar): FootprintBar {
  return {
    time: bar.time,
    levels: [...bar.levels.values()].sort((a, b) => a.price - b.price),
    buySize: bar.buySize,
    sellSize: bar.sellSize,
    buyCount: bar.buyCount,
    sellCount: bar.sellCount,
  };
}

/**
 * Creates a store aggregating trades per (bar, price). Buckets are
 * epoch-aligned bars of `intervalMs`; within one, each price accumulates buy
 * and sell size and count. Reads return fresh, sorted snapshots.
 *
 * @throws When `intervalMs` or `maxBars` is not a positive integer.
 */
export function createTradeAggregation(options: TradeAggregationOptions): TradeAggregation {
  const { intervalMs } = options;
  const maxBars = options.maxBars ?? MAX_FOOTPRINT_BARS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
    throw new Error(`chart-ts: intervalMs must be a positive integer number of ms, got ${intervalMs}`);
  }
  if (!Number.isSafeInteger(maxBars) || maxBars <= 0) {
    throw new Error(`chart-ts: maxBars must be a positive integer, got ${maxBars}`);
  }
  const bars = new Map<number, MutableBar>();

  function push(trade: Trade): void {
    const { time, price, size, side } = trade;
    if (!Number.isFinite(time) || !Number.isFinite(price) || !Number.isFinite(size) || size <= 0) return;
    if (side !== 'buy' && side !== 'sell') return;
    const bucket = bucketStartMs(time, intervalMs);
    let bar = bars.get(bucket);
    if (bar === undefined) {
      bar = { time: bucket, levels: new Map(), buySize: 0, sellSize: 0, buyCount: 0, sellCount: 0 };
      bars.set(bucket, bar);
      if (bars.size > maxBars) {
        let oldest = bucket;
        for (const key of bars.keys()) if (key < oldest) oldest = key;
        bars.delete(oldest);
        // A late trade for an already-evicted bucket drops with its own bar.
        if (oldest === bucket) return;
      }
    }
    let level = bar.levels.get(price);
    if (level === undefined) {
      level = { price, buySize: 0, sellSize: 0, buyCount: 0, sellCount: 0 };
      bar.levels.set(price, level);
    }
    if (side === 'buy') {
      level.buySize += size;
      level.buyCount += 1;
      bar.buySize += size;
      bar.buyCount += 1;
    } else {
      level.sellSize += size;
      level.sellCount += 1;
      bar.sellSize += size;
      bar.sellCount += 1;
    }
  }

  return {
    intervalMs,
    get size() {
      return bars.size;
    },
    push,
    bar(timeMs) {
      const bar = bars.get(bucketStartMs(timeMs, intervalMs));
      return bar === undefined ? null : toFootprintBar(bar);
    },
    barsInRange(fromMs, toMs) {
      const out: FootprintBar[] = [];
      for (const bar of bars.values()) {
        if (bar.time >= fromMs && bar.time <= toMs) out.push(toFootprintBar(bar));
      }
      return out.sort((a, b) => a.time - b.time);
    },
    clear() {
      bars.clear();
    },
  };
}
