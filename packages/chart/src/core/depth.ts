/**
 * L2 order book model, held outside the candle store and updated through its
 * own channel (`Chart.setDepth`), so every book change re-renders without
 * touching the bar history.
 *
 * @module
 */

/** One price level of an order book side: `[price, size]`. */
export type DepthLevel = readonly [price: number, size: number];

/**
 * An L2 order book: bids sorted best (highest) first, asks sorted best
 * (lowest) first, every size positive. A zero-size level only appears in a
 * diff, where it removes the price, never in the book itself.
 */
export interface DepthBook {
  readonly bids: readonly DepthLevel[];
  readonly asks: readonly DepthLevel[];
  /** Wall clock in ms of the last applied update. */
  readonly time: number;
}
