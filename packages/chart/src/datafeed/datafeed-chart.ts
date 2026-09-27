/**
 * A history-paging, tick-folding datafeed bound to a chart: the drop-in for a
 * TradingView UDF datafeed. `setSymbol` loads recent bars, scrolling near the
 * left edge pages older history in, and mid-price ticks fold into live bars
 * with gap backfill. Superseded reads are aborted and never touch the chart.
 * No timers: loading is driven by viewport changes and explicit calls, and a
 * failed read is retried by the edge only after a backoff.
 *
 * @module
 */

import { createChart, type Chart, type CreateChartOptions } from '../core/chart.js';
import type { Candle } from '../core/data.js';
import { Emitter, type VisibleRangeChangeEvent } from '../core/events.js';
import type { FrameScheduler } from '../core/zoom.js';
import { createAbortController, type AbortControllerLike, type DatafeedSignal } from './abort.js';
import { createLiveBarFolder, type FetchGap, type LiveBarFolder } from './live-bar-folder.js';
import { barsInWindow, loadHistory, pageHistory, type FetchBars, type HistoryRead, type LoadHistoryOptions } from './pagination.js';

/** Bars loaded by `setSymbol`: bloxwap.pro's `HISTORY_BARS`. */
export const DEFAULT_INITIAL_BARS = 500;

/** Bars requested per lazy history page. */
export const DEFAULT_PAGE_BARS = 1_000;

/** Floor of the default lazy-load threshold, in bars from the left edge. */
export const MIN_LAZY_LOAD_THRESHOLD = 50;

/**
 * After a failed read, ms before the left edge retries it on its own; it
 * doubles with each failure in a row. `loadMore()` retries at once.
 */
export const RETRY_BACKOFF_MS = 1_000;

/** Longest wait between the left edge's own retries of failed reads, in ms. */
export const MAX_RETRY_BACKOFF_MS = 30_000;

/** Context handed to a {@link DatafeedFetchGap}. */
export interface DatafeedGapRequest {
  readonly symbol: string;
  readonly intervalMs: number;
  /** Aborted when the symbol or interval changes, or the datafeed is destroyed. */
  readonly signal: DatafeedSignal;
}

/**
 * Gap-repair read for bars opening within `[fromMs, toMs]` (inclusive). A plain
 * `FetchGap` fits; the third argument names the current symbol.
 */
export type DatafeedFetchGap = (fromMs: number, toMs: number, request: DatafeedGapRequest) => Promise<readonly Candle[]>;

/** Options for {@link attachDatafeed}. */
export interface DatafeedOptions {
  /** Symbol to load right away (together with `intervalMs`). */
  symbol?: string;
  /** Bar width in whole ms for the initial `symbol`. */
  intervalMs?: number;
  /** History source; see {@link FetchBars}. */
  fetchBars: FetchBars;
  /** Gap repair for live folding. Default: `fetchBars` over the gap. */
  fetchGap?: DatafeedFetchGap;
  /** Bars loaded by `setSymbol` (a positive integer). Default {@link DEFAULT_INITIAL_BARS}. */
  initialBars?: number;
  /** Bars per lazy history page (a positive integer). Default {@link DEFAULT_PAGE_BARS}. */
  pageBars?: number;
  /**
   * Most rows one `fetchBars` call may return (a positive integer): no more
   * than the source's own per-request cap. See `LoadHistoryOptions.pageSize`.
   * Default 5000 (Hyperliquid's cap).
   */
  pageSize?: number;
  /**
   * Empty `fetchBars` pages in a row that mark the history exhausted (a
   * positive integer); shorter holes in the source are stepped over. See
   * `LoadHistoryOptions.maxEmptyPages`. Default 3.
   */
  maxEmptyPages?: number;
  /**
   * Load older history once fewer than this many bars hide past the left edge
   * (finite, nonnegative; 0 waits until blank space shows before the first bar).
   * Default: the visible bar count, at least {@link MIN_LAZY_LOAD_THRESHOLD}.
   */
  lazyLoadThreshold?: number;
  /** Wall clock in ms, also timing retry backoff. Default: the chart's clock (`chart.now()`). */
  now?: () => number;
  /**
   * Applies live bars at most once per frame, e.g. the `createFrameScheduler`
   * shared with pointer work and animations: `pushTick` still folds at once,
   * and the frame applies every bar that closed meanwhile, in order, then the
   * forming one (the latest per bucket), in one render. When the scheduler
   * runs each frame inside `chart.batch` (as `createFrameScheduler(window,
   * (update) => chart.batch(update))` does), chart events are delivered as
   * that batch ends, so a chart listener's error is thrown from the frame
   * rather than sent to `onError`. Default: each tick's bar is applied at once.
   */
  scheduler?: Pick<FrameScheduler, 'request' | 'cancel'>;
  /**
   * Makes the controller behind each symbol's reads (every `fetchBars` and
   * gap read gets its signal; a switch or `destroy` aborts it), e.g. for a
   * runtime without a global `AbortController`. Its `signal` has the host's
   * `AbortSignal` type where DOM or Node typings declare one, since it goes
   * on to `fetchBars` (and often `fetch`). Default: the global one.
   */
  createAbortController?: () => AbortControllerLike;
  /**
   * Receives history and gap read failures (never an abort from a switch),
   * and errors thrown by state listeners or while publishing live bars
   * (including from `pushTick`, which never throws, but not from a
   * `scheduler` frame run inside `chart.batch`). An error it throws is dropped.
   */
  onError?(error: unknown): void;
}

/** A snapshot of a {@link Datafeed}'s progress. */
export interface DatafeedState {
  readonly symbol: string | null;
  readonly intervalMs: number | null;
  /** True while a history read for the current symbol is in flight. */
  readonly loading: boolean;
  /**
   * True once paging ran out of history (`maxEmptyPages` empty pages in a
   * row, or a page that added no bars): no older history exists.
   */
  readonly exhausted: boolean;
  /** The last load's failure, or null; cleared by the next successful load. */
  readonly error: unknown;
}

/** A datafeed driving one chart; see {@link attachDatafeed}. */
export interface Datafeed extends DatafeedState {
  /** The current state as a plain snapshot. */
  readonly state: DatafeedState;
  /**
   * Switches instrument and/or interval: aborts every read of the previous
   * one, loads `initialBars` ending now, shows them scrolled to the latest
   * bar, and restarts live folding from the last bar. Resolves once that load
   * settles; failures go to `onError` and `error` instead of rejecting.
   *
   * @throws When `intervalMs` is not a positive integer.
   */
  setSymbol(symbol: string, intervalMs: number): Promise<void>;
  /**
   * Loads up to `bars` (default `pageBars`, rounded down) older bars in front
   * of the chart. Single flight: while a read is in flight this returns it.
   * Retries the initial load when that failed, and a failed page at once,
   * whatever the left edge's backoff. Resolves to the bars added (0
   * when exhausted, superseded or failed, and without a read when `bars` is
   * not a finite number of at least 1); never rejects.
   */
  loadMore(bars?: number): Promise<number>;
  /**
   * Folds a mid-price tick into the live bar. Ignored until history has
   * landed, and when `symbol` is given but is not the current one. With a
   * `scheduler` the bar reaches the chart on its next frame. Errors from
   * publishing the bar go to `onError`, except a chart listener's error in a
   * batched `scheduler` frame, which that frame throws.
   */
  pushTick(price: number, symbol?: string): void;
  /** Calls `listener` with each new state. Returns an unsubscribe function. */
  subscribeState(listener: (state: DatafeedState) => void): () => void;
  /** Aborts every read, stops live folding and detaches from the chart (which stays alive). */
  destroy(): void;
}

/** Options for {@link createDatafeedChart}: chart options plus the datafeed's. */
export interface DatafeedChartOptions extends CreateChartOptions, DatafeedOptions {}

/** A chart with its datafeed; see {@link createDatafeedChart}. */
export interface DatafeedChart {
  readonly chart: Chart;
  readonly datafeed: Datafeed;
  /** Destroys the datafeed, then the chart. */
  destroy(): void;
}

/** One symbol + interval; replaced wholesale by `setSymbol`. */
interface Session {
  readonly symbol: string;
  readonly intervalMs: number;
  readonly controller: AbortControllerLike;
  folder: LiveBarFolder | null;
  inflight: Promise<number> | null;
  /** The initial load has landed on the chart. */
  loaded: boolean;
  exhausted: boolean;
  error: unknown;
  /** Failed loads in a row. */
  failures: number;
  /** The left edge starts no read before this time (ms); an explicit `loadMore` ignores it. */
  retryAtMs: number;
}

/**
 * Binds a paging datafeed to an existing chart (e.g. one from `<Chart onReady>`
 * or the one a toolbar wraps). Loading starts at once when `symbol` and
 * `intervalMs` are given, otherwise at the first `setSymbol`.
 *
 * @throws When only one of `symbol` / `intervalMs` is given, when a count
 * option (`initialBars`, `pageBars`, `pageSize`, `maxEmptyPages`) is not a
 * positive integer or `lazyLoadThreshold` is negative or not finite, or as
 * `setSymbol`.
 */
export function attachDatafeed(chart: Chart, options: DatafeedOptions): Datafeed {
  const { fetchBars, fetchGap, pageSize, maxEmptyPages, lazyLoadThreshold, scheduler, onError } = options;
  const newController = options.createAbortController ?? createAbortController;
  const initialBars = options.initialBars ?? DEFAULT_INITIAL_BARS;
  const pageBars = options.pageBars ?? DEFAULT_PAGE_BARS;
  for (const [name, value] of [['initialBars', initialBars], ['pageBars', pageBars], ['pageSize', pageSize ?? 1], ['maxEmptyPages', maxEmptyPages ?? 1]] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`chart-ts: ${name} must be a positive integer, got ${value}`);
  }
  if (lazyLoadThreshold !== undefined && !(Number.isFinite(lazyLoadThreshold) && lazyLoadThreshold >= 0)) {
    throw new Error(`chart-ts: lazyLoadThreshold must be finite and nonnegative, got ${lazyLoadThreshold}`);
  }
  const now = options.now ?? (() => chart.now());
  const pageOptions: Pick<LoadHistoryOptions, 'pageSize' | 'maxEmptyPages'> = {};
  if (pageSize !== undefined) pageOptions.pageSize = pageSize;
  if (maxEmptyPages !== undefined) pageOptions.maxEmptyPages = maxEmptyPages;
  const states = new Emitter<DatafeedState>();
  let session: Session | null = null;
  let destroyed = false;
  let lastRange: VisibleRangeChangeEvent | null = null;
  let firstTime: number | null = null;
  /** Live bars awaiting the scheduler's frame, by open time: in bucket order, the latest per bucket. */
  const queued = new Map<number, Candle>();
  let framePending = false;
  let frame = 0;

  function report(error: unknown): void {
    try {
      onError?.(error);
    } catch {
      // The host's handler failed too: nowhere left to send it.
    }
  }

  function snapshot(): DatafeedState {
    return {
      symbol: session?.symbol ?? null,
      intervalMs: session?.intervalMs ?? null,
      loading: session !== null && session.inflight !== null,
      exhausted: session?.exhausted ?? false,
      error: session?.error ?? null,
    };
  }

  function notify(): void {
    try {
      states.emit(snapshot());
    } catch (error) {
      report(error);
    }
  }

  /** Aborts a session's reads and stops its live folding, dropping bars not yet applied. */
  function end(s: Session | null): void {
    s?.controller.abort();
    s?.folder?.dispose();
    queued.clear();
    if (!framePending) return;
    framePending = false;
    scheduler!.cancel(frame);
  }

  /** Applies a live bar at once, or on the scheduler's next frame. */
  function publish(bar: Candle): void {
    if (scheduler === undefined) {
      chart.appendData(bar);
      return;
    }
    queued.set(bar.time, bar);
    if (framePending) return;
    framePending = true;
    frame = scheduler.request(applyQueued);
  }

  /**
   * Applies the queued bars in order (closed buckets, then the forming one) in one render.
   * Inside a scheduler's own `chart.batch`, the chart delivers events when that batch ends:
   * a listener's error then leaves through the frame, past this catch.
   */
  function applyQueued(): void {
    framePending = false;
    const bars = [...queued.values()];
    queued.clear();
    try {
      chart.batch(() => {
        for (const bar of bars) chart.appendData(bar);
      });
    } catch (error) {
      report(error); // a chart listener's failure must not break a non-batching scheduler's frame
    }
  }

  /** Runs `load` as the session's single flight, turning failures into state. */
  function start(s: Session, load: () => Promise<number>): Promise<number> {
    const flight = settle(s, load);
    s.inflight = flight;
    notify();
    return flight;
  }

  async function settle(s: Session, load: () => Promise<number>): Promise<number> {
    let added = 0;
    try {
      added = await load();
      s.error = null;
      s.failures = 0;
      s.retryAtMs = -Infinity;
    } catch (error) {
      if (s !== session) return 0; // superseded: its abort is not a failure
      s.error = error;
      // A drag at the edge would otherwise retry a rate-limited source on every frame.
      s.retryAtMs = now() + Math.min(MAX_RETRY_BACKOFF_MS, RETRY_BACKOFF_MS * 2 ** s.failures++);
      report(error);
    }
    if (s !== session) return 0;
    s.inflight = null;
    notify();
    // The viewport may still sit at the edge; failures wait for the next approach after the backoff.
    if (added > 0) maybeLoad();
    return added;
  }

  /** The session's gap read: `fetchGap`, else `fetchBars` over the gap; failures are reported, then left to the folder. */
  function gapFetch(s: Session): FetchGap {
    const request: DatafeedGapRequest = { symbol: s.symbol, intervalMs: s.intervalMs, signal: s.controller.signal };
    return async (fromMs, toMs) => {
      try {
        return fetchGap !== undefined
          ? await fetchGap(fromMs, toMs, request)
          : await loadHistory({ fetchBars, ...request, fromMs, toMs, countBack: barsInWindow(s.intervalMs, fromMs, toMs), ...pageOptions });
      } catch (error) {
        if (s === session) report(error); // a superseded read's abort is not a failure
        throw error;
      }
    };
  }

  async function initialLoad(s: Session): Promise<number> {
    let read: HistoryRead;
    try {
      read = await pageHistory({
        fetchBars, symbol: s.symbol, intervalMs: s.intervalMs, toMs: now(), countBack: initialBars,
        signal: s.controller.signal, ...pageOptions,
      });
    } catch (error) {
      // A failed switch must not leave the previous symbol's bars on screen.
      if (s === session) chart.setData([]);
      throw error;
    }
    // A switch can land between the read's own abort check and this continuation.
    if (s !== session) return 0;
    const { bars } = read;
    s.loaded = true;
    s.exhausted = read.exhausted;
    s.folder = createLiveBarFolder({
      intervalMs: s.intervalMs,
      seedBar: bars[bars.length - 1] ?? null,
      onBar: publish,
      fetchGap: gapFetch(s),
      now,
      batch: (run) => chart.batch(run),
      onError: report,
    });
    chart.batch(() => {
      chart.updateConfig({ timeAxis: { intervalMs: s.intervalMs }, timeScale: { intervalMs: s.intervalMs } });
      chart.setData(bars);
      chart.scale.scrollTo(bars.length - 1);
    });
    return bars.length;
  }

  async function pageLoad(s: Session, bars: number): Promise<number> {
    const toMs = firstTime === null ? now() : Math.round(firstTime * 1000) - 1;
    const older = await pageHistory({
      fetchBars, symbol: s.symbol, intervalMs: s.intervalMs, toMs, countBack: bars,
      signal: s.controller.signal, ...pageOptions,
    });
    if (s !== session) return 0;
    const added = chart.prependData(older.bars);
    if (added === 0 || older.exhausted) s.exhausted = true;
    return added;
  }

  function loadMore(bars = pageBars): Promise<number> {
    const s = session;
    // Asking for no bars must not read, nor mark the history exhausted.
    if (s === null || !(Number.isFinite(bars) && bars >= 1)) return Promise.resolve(0);
    if (s.inflight !== null) return s.inflight;
    if (!s.loaded) return start(s, () => initialLoad(s));
    if (s.exhausted) return Promise.resolve(0);
    return start(s, () => pageLoad(s, Math.floor(bars)));
  }

  /** Starts a page load when the viewport is within the threshold of the left edge, and no failure is backing off. */
  function maybeLoad(): void {
    const s = session, range = lastRange;
    if (s === null || range === null || !s.loaded || s.inflight !== null || s.exhausted || now() < s.retryAtMs) return;
    const threshold = lazyLoadThreshold ?? Math.max(MIN_LAZY_LOAD_THRESHOLD, range.logicalTo - range.logicalFrom + 1);
    if (range.barsBefore < threshold) void loadMore();
  }

  function setSymbol(symbol: string, intervalMs: number): Promise<void> {
    if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0) {
      throw new Error(`chart-ts: intervalMs must be a positive integer number of ms, got ${intervalMs}`);
    }
    if (destroyed) return Promise.resolve();
    end(session);
    const s: Session = {
      symbol, intervalMs, controller: newController(), folder: null, inflight: null,
      loaded: false, exhausted: false, error: null, failures: 0, retryAtMs: -Infinity,
    };
    session = s;
    return start(s, () => initialLoad(s)).then(() => undefined);
  }

  const offRange = chart.subscribeVisibleRangeChange((e) => {
    lastRange = e;
    maybeLoad();
  });
  const offData = chart.subscribeDataLoad((e) => {
    firstTime = e.firstTime;
  });

  const datafeed: Datafeed = {
    get symbol() {
      return snapshot().symbol;
    },
    get intervalMs() {
      return snapshot().intervalMs;
    },
    get loading() {
      return snapshot().loading;
    },
    get exhausted() {
      return snapshot().exhausted;
    },
    get error() {
      return snapshot().error;
    },
    get state() {
      return snapshot();
    },
    setSymbol,
    loadMore,
    pushTick(price, symbol) {
      if (symbol !== undefined && symbol !== session?.symbol) return;
      try {
        session?.folder?.pushTick(price);
      } catch (error) {
        // A price-feed callback is no place for a chart listener's failure.
        report(error);
      }
    },
    subscribeState: (listener) => states.subscribe(listener),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      end(session);
      session = null;
      offRange();
      offData();
      states.clear();
    },
  };

  if (options.symbol !== undefined || options.intervalMs !== undefined) {
    try {
      if (options.symbol === undefined || options.intervalMs === undefined) {
        throw new Error('chart-ts: give symbol and intervalMs together');
      }
      void datafeed.setSymbol(options.symbol, options.intervalMs);
    } catch (error) {
      datafeed.destroy();
      throw error;
    }
  }
  return datafeed;
}

/**
 * Creates a chart fed by a paging datafeed:
 *
 * ```ts
 * import { createDatafeedChart } from '@bloxwap/chart/datafeed';
 *
 * const { chart, datafeed } = createDatafeedChart({
 *   container: canvas,
 *   fetchBars: ({ symbol, intervalMs, fromMs, toMs, signal }) => candleSnapshot(symbol, intervalMs, fromMs, toMs, signal),
 *   symbol: 'BTC',
 *   intervalMs: 15 * 60_000,
 * });
 * priceFeed.subscribe('BTC', (price) => datafeed.pushTick(price, 'BTC'));
 * ```
 *
 * @throws As {@link createChart} and {@link attachDatafeed}.
 */
export function createDatafeedChart(options: DatafeedChartOptions): DatafeedChart {
  // Each side reads only its own fields; `now` drives both the chart and the datafeed.
  const chart = createChart(options);
  let datafeed: Datafeed;
  try {
    datafeed = attachDatafeed(chart, options);
  } catch (error) {
    chart.destroy();
    throw error;
  }
  return {
    chart,
    datafeed,
    destroy() {
      datafeed.destroy();
      chart.destroy();
    },
  };
}
