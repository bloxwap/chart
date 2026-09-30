/**
 * Datafeed helpers (`@bloxwap/chart/datafeed`): a history-paging datafeed
 * bound to a chart, realtime tick folding with gap backfill, plus the pure
 * paging, bucket and normalization helpers behind them.
 *
 * @module
 */

export type { Candle } from '../core/data.js';
export type { DepthBook, DepthLevel } from '../core/depth.js';
export type { Trade, TradeSide } from '../core/trade.js';
export { createTradeAggregation, MAX_FOOTPRINT_BARS } from './trade-aggregation.js';
export type { FootprintBar, FootprintLevel, TradeAggregation, TradeAggregationOptions } from './trade-aggregation.js';
export {
  createDepthBookManager,
  applyDepthLevels,
  normalizeDepthSide,
  MAX_BUFFERED_DELTAS,
  DEPTH_RETRY_BACKOFF_MS,
  DEPTH_MAX_RETRY_BACKOFF_MS,
} from './depth-book.js';
export type {
  DepthBookManager,
  DepthBookManagerOptions,
  DepthDelta,
  DepthSnapshot,
  FetchDepthSnapshot,
} from './depth-book.js';
export { bucketStartMs, candleTimeMs, applyTick, normalizeCandles } from './candles.js';
export {
  createLiveBarFolder,
  hasMissedBucket,
  seedBarFromTick,
  MAX_GAP_BARS,
  GAP_SILENCE_MS,
  ROLL_SILENCE_MS,
  MAX_PENDING_TICKS,
} from './live-bar-folder.js';
export type { FetchGap, LiveBarFolder, LiveBarFolderOptions } from './live-bar-folder.js';
export { barsInWindow, pageWindow, mergeCandles, loadHistory, DEFAULT_PAGE_SIZE, DEFAULT_MAX_EMPTY_PAGES } from './pagination.js';
export type { FetchBars, FetchBarsRequest, LoadHistoryOptions, PageWindow } from './pagination.js';
export type { AbortControllerLike, AbortSignalLike, DatafeedSignal } from './abort.js';
export {
  attachDatafeed,
  createDatafeedChart,
  datafeedFootprintSource,
  DEFAULT_INITIAL_BARS,
  DEFAULT_PAGE_BARS,
  MIN_LAZY_LOAD_THRESHOLD,
  RETRY_BACKOFF_MS,
  MAX_RETRY_BACKOFF_MS,
} from './datafeed-chart.js';
export type {
  Datafeed,
  DatafeedChart,
  DatafeedChartOptions,
  DatafeedDepthRequest,
  DatafeedFetchDepthSnapshot,
  DatafeedFetchGap,
  DatafeedGapRequest,
  DatafeedOptions,
  DatafeedState,
} from './datafeed-chart.js';
