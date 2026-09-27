/**
 * Polish branches combined with the integrated feature set.
 *
 * Frame-scheduled live ticks, countdown and React auto-countdown (w4):
 *
 * - The playground's wiring: one `createFrameScheduler` batched into the chart
 *   drives the datafeed, the countdown ticker and the live candle animation.
 *   A bucket roll, the countdown second, Heikin Ashi and a still crosshair
 *   land in one frame and one render. The crosshair hears one event naming the
 *   bar now under the pointer, and the animation's follow-up frames settle.
 * - Lazy history that lands while live bars wait for their frame goes in
 *   front; the queued bars then land after it, in order, as they would
 *   unscheduled.
 * - A switch during a held lazy page read aborts it through the injected
 *   controller and drops the queued bars. The late page never lands.
 * - React `<Chart>`'s countdown ticker follows the settings card: its
 *   status-line toggle starts the ticker, and Reset defaults stops it.
 *
 * Config-change events and live header / scale / dialog sync (w4):
 *
 * - Config events ride the same playground frame as scheduled live bars: a
 *   frame of ticks alone sends none and rebuilds nothing in the header, the
 *   on-chart strip or the open picker. Lazy history reports only the
 *   index-based drawings it moved. A frame carrying ticks and config work
 *   renders once and delivers its data loads, then one config event naming
 *   every section, which the header, strip and picker show after that frame.
 * - React `<Chart>`'s countdown ticker follows rendered `statusLine` /
 *   `priceAxis` config events like the header does: a resize or another
 *   section leaves it asleep.
 *
 * Touch pan over drawings, the wrapping status line and edge labels (w4):
 *
 * - A touch tap or long press on the selected drawing takes back the nudge
 *   its press made (in the same playground frame as live ticks) in one
 *   render, so config listeners hear one `'drawings'` change with the whole
 *   set, never the empty and partial sets a restore passes through. Toolbar
 *   undo and redo after a touch drag do the same.
 * - The context menu's target follows the touch rules after a finger press:
 *   the selected drawing wins under another, as its taps and drags do, while
 *   a mouse right-click still takes the topmost. Indicator sub-panes keep
 *   their study actions either way.
 * - On a phone-width datafeed chart, the frame-scheduled countdown ticker's
 *   seconds and live ticks repaint a wrapped status line: the countdown stays
 *   on the row of the value before it, nothing crosses the plot edge, the
 *   indicator rows follow the last row, and a countdown second moves nothing.
 */
import { after, before, describe, it, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type HTMLElement } from 'happy-dom';
import {
  bucketStartMs,
  createDatafeedChart,
  type AbortControllerLike,
  type Candle,
  type DatafeedChartOptions,
  type FetchBars,
  type FetchBarsRequest,
} from '../dist/datafeed/index.js';
import { createChart, heikinAshi, type Chart, type CrosshairMoveEvent, type DataLoadEvent, type FrameScheduler } from '../dist/index.js';
import { MockCanvas, MockDocument } from '../dist/dom.js';
import {
  createChartHeader,
  createChartSettings,
  createDrawingToolbar,
  createFrameScheduler,
  createIndicatorsDialog,
  createScaleButtons,
  LONG_PRESS_MS,
  startCountdownTicker,
  type CountdownTickerOptions,
  type UIDocument,
  type UIElement,
  type UIWindow,
} from '../dist/ui/index.js';
import type { ChartInstance } from '../dist/react/index.js';

const MIN = 60_000;
/** A 1m bucket start, and 30 s into it. */
const B = bucketStartMs(1_760_000_000_000, MIN);
const T0 = B + 30_000;

/** Lets every settled read run to completion. */
async function idle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Flat history through the bucket holding T0, for any symbol. */
const history: FetchBars = async ({ fromMs, toMs }) => {
  const rows: Candle[] = [];
  for (let t = Math.ceil(fromMs / MIN) * MIN; t <= Math.min(toMs, T0); t += MIN) rows.push({ time: t / 1000, open: 100, high: 101, low: 99, close: 100, volume: 1 });
  return rows;
};

/** A datafeed chart on 1m BTC bars with history loaded, at T0 on a settable clock. */
async function liveChart(options: Partial<DatafeedChartOptions> = {}) {
  let nowMs = T0;
  const errors: unknown[] = [];
  const df = createDatafeedChart({
    container: new MockCanvas(800, 400), config: { wasm: false }, fetchBars: history, now: () => nowMs,
    symbol: 'BTC', intervalMs: MIN, onError: (error) => errors.push(error), ...options,
  });
  await idle();
  assert.equal(df.chart.dataLength, 500);
  return { ...df, errors, setNow: (ms: number) => { nowMs = ms; } };
}

/** A tick at each second `from`..`to` after T0, priced 200 + the second, on the clock the datafeed reads. */
function tickEverySecond(t: { datafeed: { pushTick(price: number, symbol?: string): void }; setNow(ms: number): void }, from: number, to: number, symbol = 'BTC'): void {
  for (let s = from; s <= to; s++) {
    t.setNow(T0 + s * 1000);
    t.datafeed.pushTick(200 + s, symbol);
  }
}

/** A frame scheduler whose frames run only when the test says so. */
function fakeFrames() {
  const tasks = new Map<number, (time: number) => void>();
  const cancelled: number[] = [];
  let seq = 0;
  return {
    tasks, cancelled,
    scheduler: {
      now: () => 0,
      request(callback: (time: number) => void): number {
        tasks.set(++seq, callback);
        return seq;
      },
      cancel(handle: number): void {
        cancelled.push(handle);
        tasks.delete(handle);
      },
    },
    /** Runs one frame: every task requested before it. */
    frame(): void {
      const run = [...tasks.values()];
      tasks.clear();
      for (const task of run) task(16);
    },
  };
}

/**
 * The playground's scheduler: `createFrameScheduler(window, (update) => chart.batch(update))` on a
 * window whose animation frames run, and whose clock moves, only when the test says so.
 */
function playgroundFrames() {
  const raf = new Map<number, (time: number) => void>();
  let seq = 0, clock = 0;
  let chart: Chart | null = null;
  const win = {
    performance: { now: () => clock },
    requestAnimationFrame(callback: (time: number) => void): number {
      raf.set(++seq, callback);
      return seq;
    },
    cancelAnimationFrame(handle: number): void {
      raf.delete(handle);
    },
  } as unknown as UIWindow;
  return {
    raf,
    scheduler: createFrameScheduler(win, (update) => chart!.batch(update)),
    bind(target: Chart): void {
      chart = target;
    },
    /** Moves the clock on by `ms`, then runs the animation frames requested so far. */
    frame(ms: number): void {
      clock += ms;
      const run = [...raf.values()];
      raf.clear();
      for (const callback of run) callback(clock);
    },
  };
}

/** Manually driven window timers. */
function fakeTimers() {
  const pending = new Map<number, () => void>();
  let seq = 0;
  return {
    pending,
    window: {
      setTimeout(handler: () => void): number {
        pending.set(++seq, handler);
        return seq;
      },
      clearTimeout(id: number | undefined): void {
        if (id !== undefined) pending.delete(id);
      },
    } satisfies CountdownTickerOptions['window'],
    /** Fires the only pending timer. */
    fire(): void {
      assert.equal(pending.size, 1);
      const [[id, handler]] = [...pending];
      pending.delete(id);
      handler();
    },
  };
}

/** Counts the chart's full renders (a render requested inside a batch only marks one pending). */
function countRenders(chart: Chart): { readonly count: number } {
  const target = chart as unknown as { render(): void; readonly batchDepth: number };
  const render = target.render.bind(chart);
  const counter = { count: 0 };
  target.render = () => {
    if (target.batchDepth === 0) counter.count++;
    render();
  };
  return counter;
}

/** The bar the chart draws under canvas x (the status line's reading). */
const under = (chart: Chart, x: number): number =>
  Math.min(chart.dataLength - 1, Math.max(0, Math.round(chart.scale.xToIndex(x))));

describe('integration polish: frame-scheduled live ticks with the integrated chart', () => {
  it('lands a roll, the countdown, Heikin Ashi, the candle animation and a still crosshair in one playground frame', async () => {
    const frames = playgroundFrames();
    const t = await liveChart({
      scheduler: frames.scheduler,
      animation: { scheduler: frames.scheduler, duration: 240 },
      config: { wasm: false, series: { type: 'heikin-ashi' }, statusLine: { visible: true, countdown: true } },
    });
    frames.bind(t.chart);
    for (let i = 0; i < 20 && frames.raf.size > 0; i++) frames.frame(300); // settle the load's own transitions
    assert.equal(frames.raf.size, 0);
    const direct = await liveChart();

    const moves: CrosshairMoveEvent[] = [];
    t.chart.subscribeCrosshairMove((e) => moves.push(e));
    const x = t.chart.scale.indexToX(499);
    t.chart.setCrosshair(x, 200);
    assert.equal(moves.length, 1);
    const timers = fakeTimers();
    const ticker = startCountdownTicker({ chart: t.chart, window: timers.window, scheduler: frames.scheduler });
    const renders = countRenders(t.chart);

    // 40 s of ticks from half-way through bucket B roll into B + 1m; the countdown second fires meanwhile.
    tickEverySecond(t, 1, 40);
    tickEverySecond(direct, 1, 40);
    timers.fire();
    assert.equal(frames.raf.size, 1, 'one animation frame for the ticks and the countdown');
    assert.equal(renders.count, 0);
    assert.equal(moves.length, 1, 'the pointer hears nothing before the frame');
    assert.equal(t.chart.dataLength, 500);

    frames.frame(16);
    assert.equal(renders.count, 1, 'one render for the roll, the countdown and the animation start');
    assert.deepEqual(t.chart.getData(), direct.chart.getData(), 'the same bars as applying every tick at once');
    assert.equal(moves.length, 2, 'one crosshair event for the frame');
    const e = moves[1]!;
    const index = under(t.chart, x);
    assert.deepEqual([e.x, e.y, e.index], [x, 200, index], 'naming the bar now under the still pointer');
    assert.equal(e.candle, t.chart.getData()[index]);
    assert.deepEqual(e.displayCandle, heikinAshi(t.chart.getData())[index], 'as Heikin Ashi draws it');

    // The live candle eases on later frames of the same scheduler, never re-entering this one, and settles.
    let follow = 0;
    while (frames.raf.size > 0 && follow < 20) {
      frames.frame(60);
      follow++;
    }
    assert.ok(follow > 0 && follow < 20, `the animation settles in ${follow} frames`);
    assert.deepEqual(t.chart.getData(), direct.chart.getData(), 'the eased frames never touch the data');
    assert.deepEqual(t.errors, []);
    ticker.stop();
    t.destroy();
    direct.destroy();
  });

  it('puts lazy history in front of live bars still waiting for their frame, which then land in order', async () => {
    const frames = fakeFrames();
    const t = await liveChart({ scheduler: frames.scheduler });
    const direct = await liveChart();
    const loads: DataLoadEvent['reason'][] = [];
    t.chart.subscribeDataLoad((e) => loads.push(e.reason));

    tickEverySecond(t, 1, 40);
    tickEverySecond(direct, 1, 40);
    assert.equal(frames.tasks.size, 1);
    assert.equal(await t.datafeed.loadMore(100), 100);
    assert.equal(await direct.datafeed.loadMore(100), 100);
    assert.equal(t.chart.dataLength, 600, 'the page landed before the frame');
    assert.equal(t.chart.getData().at(-1)!.close, 100, 'the live bars still wait');
    assert.equal(frames.tasks.size, 1, 'and so does their frame');

    frames.frame();
    assert.deepEqual(loads, ['prepend', 'update', 'append']);
    assert.deepEqual(t.chart.getData(), direct.chart.getData());
    assert.equal(t.chart.dataLength, 601);
    assert.deepEqual(t.errors, []);
    t.destroy();
    direct.destroy();
  });

  it('aborts a held lazy page through the injected controller on a switch, dropping the queued bars', async () => {
    const frames = fakeFrames();
    const made: AbortController[] = [];
    const requests: FetchBarsRequest[] = [];
    const held: Array<() => void> = [];
    let hold = false;
    const fetchBars: FetchBars = (request) => {
      requests.push(request);
      if (!hold) return history(request);
      return new Promise((resolve) => held.push(() => resolve(history(request))));
    };
    const t = await liveChart({
      scheduler: frames.scheduler, fetchBars,
      createAbortController: (): AbortControllerLike => {
        const controller = new AbortController();
        made.push(controller);
        return controller;
      },
    });

    tickEverySecond(t, 1, 40);
    hold = true;
    const page = t.datafeed.loadMore(100);
    assert.equal(requests.at(-1)!.signal, made[0]!.signal, 'the page reads on the symbol\'s controller');
    hold = false;
    await t.datafeed.setSymbol('ETH', MIN);
    assert.equal(made[0]!.signal.aborted, true, 'the switch aborted it');
    assert.deepEqual(frames.cancelled, [1], 'and cancelled the queued bars\' frame');
    assert.equal(frames.tasks.size, 0);

    held[0]!(); // the source ignored the abort
    await page;
    await idle();
    assert.equal(t.datafeed.symbol, 'ETH');
    assert.equal(t.chart.dataLength, 500, 'the late BTC page never landed');
    assert.equal(t.chart.getData().at(-1)!.close, 100, 'nor did the BTC ticks');
    assert.equal(t.datafeed.error, null, 'a superseded read is not a failure');
    assert.deepEqual(t.errors, []);
    t.destroy();
    assert.equal(made[1]!.signal.aborted, true);
  });
});

/** The header, the on-chart A / % / L strip and the indicators dialog on `chart`, in a happy-dom page. */
function livePage(chart: Chart) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  const doc = win.document;
  const udoc = doc as unknown as UIDocument;
  const host = doc.createElement('div');
  const stage = doc.createElement('div');
  Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 800 });
  doc.body.append(host, stage);
  const header = createChartHeader({ chart, document: udoc, container: host as unknown as UIElement });
  const strip = createScaleButtons({ chart, document: udoc, overlay: stage as unknown as UIElement });
  const dialog = createIndicatorsDialog({ chart, document: udoc });
  const root = header.element as unknown as HTMLElement;
  const stripRoot = strip.element as unknown as HTMLElement;
  const dialogRoot = dialog.element as unknown as HTMLElement;
  const pressed = (nodes: ArrayLike<unknown>) => Array.from(nodes as ArrayLike<HTMLElement>)
    .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
  return {
    dialog,
    /** Pressed quick toggles: [header, on-chart strip]. */
    modes: () => [pressed(root.querySelectorAll('.cts-header-scale-btn')), pressed(stripRoot.querySelectorAll('.cts-scale-btn'))],
    typeTitle: () => (root.querySelector('.cts-header-type') as unknown as HTMLElement).title,
    active: () => Array.from(dialogRoot.querySelectorAll('.cts-ind-active .cts-ind-name')).map((n) => n.textContent),
    activeRow: (id: string) => dialogRoot.querySelector(`.cts-ind-active[data-id="${id}"]`),
    destroy: async () => {
      strip.destroy();
      header.destroy();
      dialog.destroy();
      await win.happyDOM.close();
    },
  };
}

describe('integration polish: config-change events with frame-scheduled live ticks', () => {
  it('rides the playground frame: ticks alone send none, and a shared frame delivers one event after its data', async () => {
    const frames = playgroundFrames();
    const t = await liveChart({ scheduler: frames.scheduler });
    frames.bind(t.chart);
    const ui = livePage(t.chart);
    const rsi = t.chart.addIndicator({ name: 'rsi' });
    const line = t.chart.addDrawing({ name: 'trendline', points: [{ index: 400, price: 100 }, { index: 450, price: 101 }] });
    ui.dialog.openPicker();
    const row = ui.activeRow(rsi);
    assert.ok(row !== null);
    const log: string[] = [];
    t.chart.subscribeDataLoad((e) => log.push(`data:${e.reason}`));
    t.chart.subscribeConfigChange((e) => log.push(`config:${e.keys.join(',')}`));
    const renders = countRenders(t.chart);

    // Ticks rolling into B + 1m: their frame loads data and changes no config.
    tickEverySecond(t, 1, 40);
    assert.deepEqual(log, [], 'nothing before the frame');
    frames.frame(16);
    assert.equal(renders.count, 1);
    assert.deepEqual(log, ['data:update', 'data:append'], 'a tick frame sends no config event');
    assert.equal(ui.activeRow(rsi), row, 'so the open picker rebuilds nothing');
    assert.equal(ui.typeTitle(), 'Chart type: Candles');
    assert.deepEqual(ui.modes(), [['Auto'], ['A']]);

    // Lazy history landing while live bars wait: only the index-based drawing it moved is config.
    log.length = 0;
    tickEverySecond(t, 41, 45);
    assert.equal(await t.datafeed.loadMore(100), 100);
    assert.deepEqual(log, ['data:prepend', 'config:drawings']);
    assert.equal(t.chart.getDrawing(line)!.points[0]!.index, 500, 'the line kept its bar');
    assert.equal(ui.activeRow(rsi), row, "'drawings' leaves the picker alone");
    frames.frame(16);
    assert.deepEqual(log, ['data:prepend', 'config:drawings', 'data:update'], 'the waiting bar lands on its frame');

    // Config work sharing a frame with ticks (as pointer work does): one render, the data first, then one event.
    log.length = 0;
    tickEverySecond(t, 46, 50);
    frames.scheduler.request(() => {
      t.chart.updateConfig({ series: { type: 'line' }, priceAxis: { mode: 'logarithmic' } });
      t.chart.updateIndicator(rsi, { params: { period: 21 } });
    });
    assert.equal(frames.raf.size, 1, 'one animation frame for both');
    assert.equal(ui.typeTitle(), 'Chart type: Candles', 'nothing shows before the frame');
    const before = renders.count;
    frames.frame(16);
    assert.equal(renders.count, before + 1, 'one render for the bars and the config');
    assert.deepEqual(log, ['data:update', 'config:series,priceAxis,indicators']);
    assert.equal(ui.typeTitle(), 'Chart type: Line');
    assert.deepEqual(ui.modes(), [['Auto', 'Log'], ['A', 'L']]);
    assert.deepEqual(ui.active(), ['RSI 21']);
    assert.equal(t.chart.getData().at(-1)!.close, 250, 'with the latest tick applied');
    assert.deepEqual(t.errors, []);
    await ui.destroy();
    t.destroy();
  });
});

describe('integration polish: React <Chart> countdown ticker with the settings card', () => {
  type ReactModule = typeof import('react');
  let React: ReactModule;
  let act: (fn: () => void) => void;
  let createRoot: typeof import('react-dom/client').createRoot;
  let Chart: typeof import('../dist/react/index.js').Chart;
  let GlobalRegistrator: typeof import('@happy-dom/global-registrator').GlobalRegistrator;

  before(async () => {
    ({ GlobalRegistrator } = await import('@happy-dom/global-registrator'));
    GlobalRegistrator.register({ url: 'http://localhost/', width: 1024, height: 768 });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    React = await import('react');
    act = React.act as typeof act;
    ({ createRoot } = await import('react-dom/client'));
    ({ Chart } = await import('../dist/react/index.js'));
  });

  after(async () => {
    await GlobalRegistrator.unregister();
  });

  it('starts on the status-line toggle and stops on Reset defaults', (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] }); // the page window's timers, which the ticker reads
    type Node = { append(...nodes: Node[]): void; querySelector(selector: string): (Node & { click(): void }) | null };
    const doc = (globalThis as unknown as { document: Node & { createElement(tag: string): Node; body: Node } }).document;
    const start = 1_700_000_100;
    const data: Candle[] = [0, 1, 2].map((i) => ({ time: start - (2 - i) * 60, open: 1, high: 2, low: 0.5, close: 1.5 }));
    let nowMs = start * 1000 + 400, refreshes = 0;
    const onReady = (chart: ChartInstance): void => {
      const refresh = chart.refreshOverlay.bind(chart);
      chart.refreshOverlay = () => {
        refreshes++;
        refresh();
      };
    };
    const host = doc.createElement('div');
    const trigger = doc.createElement('button');
    doc.body.append(host, trigger);
    const root = createRoot(host as never);
    const ref = React.createRef<ChartInstance | null>();
    act(() => root.render(React.createElement(Chart, { data, theme: 'dark', now: () => nowMs, onReady, ref, config: { wasm: false, statusLine: { visible: true } } })));
    const chart = ref.current!;
    const settings = createChartSettings({ chart, document: doc as unknown as UIDocument, trigger: trigger as unknown as UIElement, theme: 'dark' });
    settings.open();
    const advance = (ms: number): void => {
      for (let step = 0; step < ms; step += 100) {
        nowMs += 100;
        t.mock.timers.tick(100);
      }
    };

    advance(3000);
    assert.equal(refreshes, 0, 'no countdown configured: no ticker');
    doc.querySelector('[name="status-countdown"]')!.click();
    assert.equal(chart.getConfig().statusLine.countdown, true);
    advance(600); // to the next whole second of the chart clock
    assert.equal(refreshes, 1, 'the card\'s toggle started the ticker');
    advance(2000);
    assert.equal(refreshes, 3);

    doc.querySelector('.cts-settings-reset')!.click();
    assert.equal(chart.getConfig().statusLine.countdown, false);
    advance(5000);
    assert.equal(refreshes, 3, 'Reset defaults hid the countdown and stopped the ticker');

    settings.destroy();
    act(() => root.unmount());
  });

  it('follows rendered statusLine / priceAxis config events, not resizes or other sections', (t: TestContext) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    type Node = { append(...nodes: Node[]): void };
    const doc = (globalThis as unknown as { document: Node & { createElement(tag: string): Node; body: Node } }).document;
    const start = 1_700_000_100;
    const data: Candle[] = [0, 1, 2].map((i) => ({ time: start - (2 - i) * 60, open: 1, high: 2, low: 0.5, close: 1.5 }));
    let nowMs = start * 1000 + 400, refreshes = 0;
    const onReady = (chart: ChartInstance): void => {
      const refresh = chart.refreshOverlay.bind(chart);
      chart.refreshOverlay = () => {
        refreshes++;
        refresh();
      };
    };
    const host = doc.createElement('div');
    doc.body.append(host);
    const root = createRoot(host as never);
    const ref = React.createRef<ChartInstance | null>();
    act(() => root.render(React.createElement(Chart, { data, theme: 'dark', now: () => nowMs, onReady, ref, config: { wasm: false, statusLine: { visible: true } } })));
    const chart = ref.current!;
    const advance = (ms: number): void => {
      for (let step = 0; step < ms; step += 100) {
        nowMs += 100;
        t.mock.timers.tick(100);
      }
    };

    // An in-place edit sends no event, so the countdown starts ticking only when the follower resyncs.
    chart.getConfig().statusLine.countdown = true;
    const layouts: number[] = [];
    chart.subscribeLayoutChange((e) => layouts.push(e.width));
    chart.resize(641, 301, 1);
    assert.deepEqual(layouts, [641], 'a layout change rendered');
    advance(3000);
    assert.equal(refreshes, 0, 'a resize leaves the follower asleep');
    chart.updateConfig({ grid: { visible: false } });
    advance(3000);
    assert.equal(refreshes, 0, 'so does another section');
    chart.updateConfig({ statusLine: {} });
    advance(1000);
    assert.equal(refreshes, 1, "a 'statusLine' event starts the ticker");

    chart.getConfig().statusLine.countdown = false;
    chart.updateConfig({ priceAxis: {} });
    advance(3000);
    assert.equal(refreshes, 1, "a 'priceAxis' event stops it");
    act(() => root.unmount());
  });
});

// Touch pan over drawings, the wrapping status line and edge labels (w4) with the integrated feature set.

/** Window timers on a clock that moves only when the test says so. */
class ClockTimers {
  time = 0;
  private seq = 0;
  private readonly queue = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms = 0): number => {
    this.queue.set(++this.seq, { at: this.time + ms, fn });
    return this.seq;
  };
  clearTimeout = (id: number | undefined): void => {
    if (id !== undefined) this.queue.delete(id);
  };
  /** Moves the clock on by `ms`, running the timers that come due. */
  tick(ms: number): void {
    this.time += ms;
    for (const [id, t] of [...this.queue]) if (t.at <= this.time && this.queue.delete(id)) t.fn();
  }
}

/** The drawing toolbar (touch gestures on, with its context menu) on an 800x400 `chart`, in a happy-dom page. */
function touchPage(chart: Chart, scheduler: FrameScheduler) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  const timers = new ClockTimers();
  Object.assign(win, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval: () => 0, clearInterval: () => {} });
  const doc = win.document;
  const rail = doc.createElement('div');
  const stage = doc.createElement('div');
  const canvas = doc.createElement('div');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 400 } });
  stage.append(canvas);
  doc.body.append(rail, stage);
  const tb = createDrawingToolbar({
    chart,
    scheduler,
    contextMenu: true,
    document: doc as unknown as UIDocument,
    canvas: canvas as unknown as UIElement,
    rail: rail as unknown as UIElement,
    overlay: stage as unknown as UIElement,
  });
  const pointer = (type: string, id: number, x: number, y: number, pointerType = 'touch', button = 0) =>
    canvas.dispatchEvent(new win.PointerEvent(type, { pointerId: id, clientX: x, clientY: y, button, pointerType, bubbles: true, cancelable: true }));
  return {
    timers,
    controller: tb.controller,
    menu: tb.contextMenu!,
    pointer,
    tap(id: number, x: number, y: number): void {
      pointer('pointerdown', id, x, y);
      pointer('pointerup', id, x, y);
    },
    /** A mouse right-click: its press, then the `contextmenu` event. */
    rightClick(x: number, y: number): void {
      pointer('pointerdown', 99, x, y, 'mouse', 2);
      pointer('pointerup', 99, x, y, 'mouse', 2);
      canvas.dispatchEvent(new win.MouseEvent('contextmenu', { clientX: x, clientY: y, button: 2, bubbles: true, cancelable: true }));
    },
    destroy: async () => {
      tb.destroy();
      await win.happyDOM.close();
    },
  };
}

const pointsOf = (chart: Chart, id: string) => chart.getDrawing(id)!.points.map((p) => ({ ...p }));
const crosshairShown = (chart: Chart): boolean => (chart as unknown as { crosshair: { active: boolean } }).crosshair.active;

describe('integration polish: touch over drawings with config events and frame-scheduled ticks', () => {
  it('takes back a touch nudge on the selected drawing in one render; config listeners hear the whole set once', async () => {
    const frames = playgroundFrames();
    const t = await liveChart({ scheduler: frames.scheduler });
    frames.bind(t.chart);
    const page = touchPage(t.chart, frames.scheduler);
    const { scale } = t.chart;
    // Four flat trendlines across x 200–400, 60 px apart.
    const [line] = [100, 160, 220, 280].map((y) => t.chart.addDrawing({
      name: 'trendline',
      points: [{ index: Math.round(scale.xToIndex(200)), price: scale.yToPrice(y) }, { index: Math.round(scale.xToIndex(400)), price: scale.yToPrice(y) }],
    }));
    page.tap(1, 300, 100);
    assert.equal(t.chart.selectedDrawing, line);
    const before = pointsOf(t.chart, line!);
    const log: string[] = [];
    t.chart.subscribeDataLoad((e) => log.push(`data:${e.reason}`));
    t.chart.subscribeConfigChange((e) => log.push(`config:${e.keys.join(',')}:${t.chart.getConfig().drawings.length}`));
    const renders = countRenders(t.chart);

    // A jittery tap sharing its frame with a live tick (inside the bar's range, so nothing rescales).
    page.pointer('pointerdown', 2, 300, 100);
    t.setNow(T0 + 1000);
    t.datafeed.pushTick(100.5);
    page.pointer('pointermove', 2, 303, 102);
    assert.deepEqual(log, [], 'nothing before the frame');
    const frameRenders = renders.count;
    frames.frame(16);
    assert.equal(renders.count - frameRenders, 1, 'one render for the tick and the nudge');
    assert.deepEqual(log, ['data:update', 'config:drawings:4'], 'the data first, then the nudge');
    assert.notDeepEqual(pointsOf(t.chart, line!), before);
    const upRenders = renders.count;
    page.pointer('pointerup', 2, 303, 102);
    assert.deepEqual(pointsOf(t.chart, line!), before, 'the release takes the nudge back');
    assert.deepEqual(log.slice(2), ['config:drawings:4'], 'in one event with every drawing, never the empty or partial sets between');
    assert.ok(renders.count - upRenders <= 3, `a render for the restore and the selection, not one per drawing (${renders.count - upRenders})`);
    assert.equal(t.chart.selectedDrawing, line, 'the tap keeps the selection');
    assert.equal(page.controller.history.canUndo, false);
    assert.equal(t.chart.getData().at(-1)!.close, 100.5, 'and the tick stays');

    // Holding still on it: the press is taken back the same way, and the finger shows the crosshair.
    log.length = 0;
    page.pointer('pointerdown', 3, 300, 100);
    page.pointer('pointermove', 3, 301, 102);
    frames.frame(16);
    assert.deepEqual(log, ['config:drawings:4']);
    page.timers.tick(LONG_PRESS_MS);
    assert.deepEqual(log, ['config:drawings:4', 'config:drawings:4']);
    assert.equal(crosshairShown(t.chart), true);
    assert.deepEqual(pointsOf(t.chart, line!), before);
    assert.equal(t.chart.selectedDrawing, line);
    page.pointer('pointerup', 3, 301, 102);
    page.tap(4, 600, 330); // hides the crosshair
    assert.equal(crosshairShown(t.chart), false);
    assert.equal(t.chart.selectedDrawing, line);

    // Undo and redo after a touch drag: one render and one event each, with the whole set.
    page.pointer('pointerdown', 5, 300, 100);
    for (const y of [120, 140]) {
      page.pointer('pointermove', 5, 300, y);
      frames.frame(16);
    }
    page.pointer('pointerup', 5, 300, 140);
    const moved = pointsOf(t.chart, line!);
    assert.notDeepEqual(moved, before);
    assert.equal(page.controller.history.canUndo, true);
    log.length = 0;
    let r = renders.count;
    page.controller.undo();
    assert.equal(renders.count - r, 1, 'undo renders once');
    assert.deepEqual(log, ['config:drawings:4']);
    assert.deepEqual(pointsOf(t.chart, line!), before);
    assert.equal(t.chart.selectedDrawing, line);
    r = renders.count;
    page.controller.redo();
    assert.equal(renders.count - r, 1, 'redo renders once');
    assert.deepEqual(log, ['config:drawings:4', 'config:drawings:4']);
    assert.deepEqual(pointsOf(t.chart, line!), moved);
    assert.deepEqual(t.errors, []);
    await page.destroy();
    t.destroy();
  });

  it('points the context menu at the selection under another drawing after a finger press, and at the top one for a mouse', async () => {
    const frames = playgroundFrames();
    const t = await liveChart({ scheduler: frames.scheduler });
    frames.bind(t.chart);
    const page = touchPage(t.chart, frames.scheduler);
    const { scale } = t.chart;
    const at = (x: number): number => Math.round(scale.xToIndex(x));
    // Fib bands across x 350–480 under a long position across x 400–520.
    const bands = t.chart.addDrawing({ name: 'fib', points: [{ index: at(350), price: scale.yToPrice(340) }, { index: at(480), price: scale.yToPrice(100) }] });
    const box = t.chart.addDrawing({ name: 'long-position', points: [{ index: at(400), price: scale.yToPrice(250) }, { index: at(520), price: scale.yToPrice(150) }] });
    page.tap(1, 370, 200); // the bands alone
    assert.equal(t.chart.selectedDrawing, bands);
    assert.equal(page.controller.touch, true);
    assert.equal(t.chart.drawingAt(440, 200), box, 'the box lies on top there');
    assert.deepEqual(page.menu.targetAt(440, 200), { kind: 'drawing', id: bands, x: 440, y: 200 }, 'a finger targets the selection, as its drag there would');
    assert.deepEqual(page.menu.targetAt(500, 200), { kind: 'drawing', id: box, x: 500, y: 200 }, 'and the top one where the selection misses');
    page.menu.open(440, 200);
    assert.equal(t.chart.selectedDrawing, bands, 'opening the menu there keeps the selection');
    assert.equal((page.menu.element as unknown as HTMLElement).querySelector('.cts-menu-label')?.textContent, page.controller.label('fib'));
    page.menu.close();

    // A mouse right-click at the same spot keeps its topmost-first target.
    page.rightClick(440, 200);
    assert.equal(page.controller.touch, false);
    assert.deepEqual(page.menu.target, { kind: 'drawing', id: box, x: 440, y: 200 });
    assert.equal(t.chart.selectedDrawing, box);
    page.menu.close();
    assert.deepEqual(t.errors, []);
    await page.destroy();
    t.destroy();
  });
});

describe('integration polish: the wrapped status line with the frame-scheduled countdown', () => {
  it('keeps the countdown on its value\'s row through live ticks and seconds on a phone-width chart', async () => {
    const frames = playgroundFrames();
    const canvas = new MockCanvas(390, 400);
    const t = await liveChart({
      container: canvas,
      scheduler: frames.scheduler,
      config: { wasm: false, statusLine: { visible: true, symbol: 'BTCUSD', volume: true, countdown: true }, priceAxis: { precision: 1 } },
    });
    frames.bind(t.chart);
    t.chart.addIndicator({ name: 'sma' });
    const timers = fakeTimers();
    const ticker = startCountdownTicker({ chart: t.chart, window: timers.window, scheduler: frames.scheduler });
    const plotWidth = t.chart.plotArea.width;
    const renders = countRenders(t.chart);
    // MockContext2D measures 6 px per character; the theme font is 12 px.
    /** The status line drawn since call `from`, checked, with the first indicator row. */
    const statusLine = (from: number, countdown: string) => {
      const drawn = canvas.context.calls.slice(from).filter((c) => c[0] === 'fillText').map((c) => ({ text: String(c[1]), x: Number(c[2]), y: Number(c[3]) }));
      const out = drawn.slice(drawn.map((d) => d.text).lastIndexOf('BTCUSD'));
      const sma = out.findIndex((d) => d.text.startsWith('SMA'));
      const status = out.slice(0, sma);
      const rows = [...new Set(status.map((d) => d.y))];
      assert.ok(rows.length > 1, `the line wraps on a ${plotWidth} px plot`);
      for (const d of status) assert.ok(d.x + d.text.length * 6 <= plotWidth, `${d.text} stays inside the plot`);
      const i = status.findIndex((d) => d.text === countdown);
      assert.ok(i > 0, `the countdown ${countdown} follows a value`);
      const previous = status[i - 1]!;
      assert.equal(status[i]!.y, previous.y, `${countdown} shares the row of ${previous.text}`);
      assert.equal(status[i]!.x, previous.x + (previous.text.length + 3) * 6, 'three spaces after it');
      assert.equal(out[sma]!.y, rows.at(-1)! + 12 + 8, 'the indicator rows follow the last row');
      return status;
    };

    // Ticks and the countdown second land in one frame.
    let mark = canvas.context.calls.length;
    tickEverySecond(t, 1, 20);
    timers.fire();
    frames.frame(16);
    assert.equal(renders.count, 1, 'one render for the ticks and the countdown');
    const first = statusLine(mark, '00:10');
    assert.ok(first.some((d) => d.text === 'C 220.0'), 'with the latest tick');

    // The next second repaints the overlay alone: only the countdown changes, and nothing moves.
    t.setNow(T0 + 21_000);
    mark = canvas.context.calls.length;
    timers.fire();
    frames.frame(16);
    assert.equal(renders.count, 1, 'an overlay repaint');
    const second = statusLine(mark, '00:09');
    assert.deepEqual(second.map((d) => [d.x, d.y]), first.map((d) => [d.x, d.y]));
    assert.deepEqual(second.map((d) => d.text), first.map((d) => (d.text === '00:10' ? '00:09' : d.text)));

    // Ticks on into the next bar reset the countdown, still beside its value.
    mark = canvas.context.calls.length;
    tickEverySecond(t, 21, 31);
    timers.fire();
    frames.frame(16);
    statusLine(mark, '00:59');
    assert.deepEqual(t.errors, []);
    ticker.stop();
    t.destroy();
  });
});
