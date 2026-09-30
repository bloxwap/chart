/**
 * The tape record: one executed trade (price, size, aggressor side). Trades
 * stream through their own datafeed channel (`pushTrade` / `subscribeTrades`)
 * and aggregate outside the candle store for footprint use.
 *
 * @module
 */

/** The aggressor side of a trade: a `'buy'` lifted the ask, a `'sell'` hit the bid. */
export type TradeSide = 'buy' | 'sell';

/**
 * One executed trade. `time` is wall clock in ms, matching the depth channel;
 * candle `time` stays in UNIX seconds.
 */
export interface Trade {
  readonly time: number;
  readonly price: number;
  readonly size: number;
  readonly side: TradeSide;
}
