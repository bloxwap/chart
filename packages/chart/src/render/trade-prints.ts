/**
 * Trade prints: a pane primitive painting recent trades as circles pinned to
 * their bar and price, colored by aggressor side and sized by trade size.
 * Attach it to the main pane (`chart.attachPrimitive`) and push trades from
 * the datafeed's tape channel, calling the handle's `requestUpdate` to repaint.
 *
 * @module
 */

import type { Trade } from '../core/trade.js';
import type { Canvas2DLike } from '../dom.js';
import type { PanePrimitive, PrimitiveDrawTarget } from './primitive.js';

/** Trades retained by default; the oldest is evicted beyond the cap. */
export const MAX_TRADE_PRINTS = 1_000;

/** Smallest print radius in CSS pixels. */
export const TRADE_PRINT_MIN_RADIUS = 2;

/** Largest print radius in CSS pixels. */
export const TRADE_PRINT_MAX_RADIUS = 8;

/** Buy-side default, the default theme's `series.upColor`. */
export const TRADE_PRINT_BUY_COLOR = '#089981';

/** Sell-side default, the default theme's `series.downColor`. */
export const TRADE_PRINT_SELL_COLOR = '#f23645';

/** Options for {@link createTradePrintsPrimitive}. */
export interface TradePrintsOptions {
  /** Cap on retained trades; the oldest is evicted beyond it. Defaults to {@link MAX_TRADE_PRINTS}. */
  readonly maxTrades?: number;
  /** Buy-side print color. Defaults to {@link TRADE_PRINT_BUY_COLOR}. */
  readonly buyColor?: string;
  /** Sell-side print color. Defaults to {@link TRADE_PRINT_SELL_COLOR}. */
  readonly sellColor?: string;
  /** Smallest print radius in CSS pixels. Defaults to {@link TRADE_PRINT_MIN_RADIUS}. */
  readonly minRadius?: number;
  /** Largest print radius in CSS pixels. Defaults to {@link TRADE_PRINT_MAX_RADIUS}. */
  readonly maxRadius?: number;
}

/** A pane primitive drawing trade prints; see {@link createTradePrintsPrimitive}. */
export interface TradePrints extends PanePrimitive {
  /** Number of retained trades. */
  readonly size: number;
  /**
   * Retains one trade for the next paint. A trade with a non-finite time,
   * price or size, a non-positive size, or an unknown side is ignored.
   */
  push(trade: Trade): void;
  /** Drops every retained trade. */
  clear(): void;
}

/** Index of the last candle with `time <= timeSec`, or -1 before the first one. */
function barAtOrBefore(candles: PrimitiveDrawTarget['candles'], timeSec: number): number {
  let lo = 0, hi = candles.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (candles[mid]!.time <= timeSec) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/**
 * Creates a primitive painting each retained trade as a circle at its bar's
 * slot and its price: buys in `buyColor`, sells in `sellColor`, radius the
 * square root of the trade size clamped to `[minRadius, maxRadius]`. A trade
 * belongs to the last bar at or before its time (as markers do), so a live
 * tape lands on the forming bar; one before the first bar never paints. Only
 * trades on bars inside the visible range paint. Prints draw above the pane's
 * series; the store is bounded by `maxTrades`, so a fast tape costs a bounded
 * ring, not the whole session.
 *
 * @throws When `maxTrades` is not a positive integer or a radius is negative
 * or not finite, or `minRadius` exceeds `maxRadius`.
 */
export function createTradePrintsPrimitive(options: TradePrintsOptions = {}): TradePrints {
  const maxTrades = options.maxTrades ?? MAX_TRADE_PRINTS;
  const buyColor = options.buyColor ?? TRADE_PRINT_BUY_COLOR;
  const sellColor = options.sellColor ?? TRADE_PRINT_SELL_COLOR;
  const minRadius = options.minRadius ?? TRADE_PRINT_MIN_RADIUS;
  const maxRadius = options.maxRadius ?? TRADE_PRINT_MAX_RADIUS;
  if (!Number.isSafeInteger(maxTrades) || maxTrades <= 0) {
    throw new Error(`chart-ts: maxTrades must be a positive integer, got ${maxTrades}`);
  }
  if (!(Number.isFinite(minRadius) && minRadius >= 0) || !(Number.isFinite(maxRadius) && maxRadius >= minRadius)) {
    throw new Error(`chart-ts: expected 0 <= minRadius <= maxRadius, got ${minRadius} and ${maxRadius}`);
  }
  let trades: Trade[] = [];

  function draw(ctx: Canvas2DLike, target: PrimitiveDrawTarget): void {
    const { candles, range, timeScale, priceScale } = target;
    if (trades.length === 0 || candles.length === 0 || range.to <= range.from) return;
    ctx.save();
    for (const trade of trades) {
      const bar = barAtOrBefore(candles, trade.time / 1000);
      if (bar < range.from || bar >= range.to) continue;
      const x = timeScale.indexToX(bar, candles.length);
      const y = priceScale.priceToY(trade.price);
      const radius = Math.min(maxRadius, Math.max(minRadius, Math.sqrt(trade.size)));
      ctx.beginPath();
      ctx.fillStyle = trade.side === 'buy' ? buyColor : sellColor;
      ctx.ellipse(x, y, radius, radius, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  return {
    get size() {
      return trades.length;
    },
    push(trade) {
      const { time, price, size, side } = trade;
      if (!Number.isFinite(time) || !Number.isFinite(price) || !Number.isFinite(size) || size <= 0) return;
      if (side !== 'buy' && side !== 'sell') return;
      trades.push(trade);
      if (trades.length > maxTrades) trades.shift();
    },
    clear() {
      trades = [];
    },
    draw,
  };
}
