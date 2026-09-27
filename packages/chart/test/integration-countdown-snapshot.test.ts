/**
 * Integration: the bar-close countdown and snapshot export (P2.13/P2.14)
 * against the features merged before them. The countdown badge must stack
 * under the last-price badge as the other series types display it (Heikin
 * Ashi bars, hollow-candle direction, the bloxwapDark scale font);
 * screenshots must reproduce price lines, markers, Heikin Ashi and the volume
 * overlay and read the clock when taken; and a live bar folder sharing the
 * chart's clock must restart the countdown on every rolled bucket.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createLiveBarFolder } from '../dist/datafeed/index.js';
import { bloxwapDark, createChart, heikinAshi, type Chart, type ChartConfig, type DeepPartial } from '../dist/index.js';
import { startCountdownTicker, type CountdownTickerOptions } from '../dist/ui/index.js';
import { MockCanvas, MockContext2D, MockDocument, type ChartCanvas } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';

const MIN = 60_000;
const FIFTEEN = 15 * 60;
/** The last bar opens here (UNIX seconds); with the clock at its open, 15m bars read '15:00'. */
const T0S = 1_700_000_100;

type Op =
  | { op: 'rect'; x: number; y: number; w: number; h: number; fill: string }
  | { op: 'text'; text: string; x: number; y: number; fill: string; font: string };

/** Records fills and texts with the paint state in effect. */
class Paint extends MockContext2D {
  readonly ops: Op[] = [];
  override fillRect(x: number, y: number, w: number, h: number): void {
    super.fillRect(x, y, w, h);
    this.ops.push({ op: 'rect', x, y, w, h, fill: String(this.fillStyle) });
  }
  override fillText(text: string, x: number, y: number): void {
    super.fillText(text, x, y);
    this.ops.push({ op: 'text', text, x, y, fill: String(this.fillStyle), font: this.font });
  }
}

/** A chart on an 800x400 recording canvas whose clock sits at the last bar's open. */
function mount(data: Candle[], config: DeepPartial<ChartConfig>, preset?: 'bloxwapDark'): { chart: Chart; ctx: Paint } {
  const ctx = new Paint();
  const canvas: ChartCanvas = { width: 800, height: 400, getContext: () => ctx };
  const chart = createChart({ container: canvas, now: () => T0S * 1000, ...(preset ? { preset } : {}), config: { wasm: false, data, ...config } });
  return { chart, ctx };
}

/** `n` rising 15m bars, then `last`, which opens at {@link T0S}. */
function rising(n: number, last: Omit<Candle, 'time'>): Candle[] {
  const bars: Candle[] = Array.from({ length: n }, (_, i) => ({
    time: T0S - (n - i) * FIFTEEN, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 10 + i,
  }));
  return [...bars, { time: T0S, ...last }];
}

type Rect = Extract<Op, { op: 'rect' }>;
type Text = Extract<Op, { op: 'text' }>;

/** Index of the last op before `end` matching `test`, or -1. */
function lastIndex(ops: readonly Op[], end: number, test: (o: Op) => boolean): number {
  for (let i = end - 1; i >= 0; i--) if (test(ops[i]!)) return i;
  return -1;
}

/** The countdown badge (its text right of the plot and the fill under it) and the last-price badge before it. */
function badges(ctx: Paint, chart: Chart, text = '15:00') {
  const { width: plotWidth } = chart.plotArea;
  const axisWidth = 800 - plotWidth;
  const at = lastIndex(ctx.ops, ctx.ops.length, (o) => o.op === 'text' && o.text === text && o.x > plotWidth);
  assert.ok(at > 0, `a countdown badge reading ${text}`);
  const label = ctx.ops[at] as Text;
  const countdownAt = lastIndex(ctx.ops, at, (o) => o.op === 'rect');
  const countdown = ctx.ops[countdownAt] as Rect;
  const priceAt = lastIndex(ctx.ops, countdownAt, (o) => o.op === 'rect' && o.x === plotWidth && o.w === axisWidth && o.h === countdown.h);
  assert.ok(priceAt >= 0, 'a last-price badge');
  return { label, countdown, price: ctx.ops[priceAt] as Rect };
}

/** The chart's resolved up or down series color. */
function seriesColor(chart: Chart, side: 'up' | 'down'): string {
  const { series } = chart.getConfig();
  return side === 'up' ? series.upColor : series.downColor;
}

/** Status-line texts: those left of the price axis. */
const statusLine = (ctx: Paint, chart: Chart): Text[] =>
  ctx.ops.filter((o): o is Text => o.op === 'text' && o.x < chart.plotArea.width);

describe('integration: countdown badge x displayed series', () => {
  // The raw last bar falls (close < open) but its Heikin Ashi bar rises.
  const haData = rising(29, { open: 129, high: 132, low: 126, close: 127.5, volume: 50 });
  const haLast = heikinAshi(haData).at(-1)!;

  it('stacks under the Heikin Ashi last-price badge, at the HA close and in the HA direction', () => {
    const raw = haData.at(-1)!;
    assert.ok(raw.close < raw.open && haLast.close >= haLast.open && haLast.close !== raw.close);
    const { chart, ctx } = mount(haData, {
      series: { type: 'heikin-ashi' },
      statusLine: { visible: true, countdown: true },
      priceAxis: { labels: { lastPrice: true, countdown: true } },
    });
    const { countdown, price, label } = badges(ctx, chart);
    const h = 12 + 8;
    assert.equal(price.y, chart.scale.priceToY(haLast.close) - h / 2, 'the price badge centers on the HA close');
    assert.equal(countdown.y, price.y + h, 'the countdown sits directly under it');
    assert.deepEqual([countdown.x, countdown.w, countdown.h], [price.x, price.w, h]);
    assert.equal(price.fill, seriesColor(chart, 'up'));
    assert.equal(countdown.fill, price.fill);
    assert.equal(label.font, '12px ui-monospace, monospace');
    // The HA status line still ends with the countdown of the latest bar.
    assert.equal(statusLine(ctx, chart).at(-1)!.text, '15:00');
    chart.destroy();

    // Control: the same data as plain candles is a falling bar at the raw close.
    const plain = mount(haData, { priceAxis: { labels: { lastPrice: true, countdown: true } } });
    const control = badges(plain.ctx, plain.chart);
    assert.equal(control.price.y, plain.chart.scale.priceToY(raw.close) - h / 2);
    assert.equal(control.countdown.y, control.price.y + h);
    assert.equal(control.countdown.fill, seriesColor(plain.chart, 'down'));
    assert.equal(control.price.fill, control.countdown.fill);
    plain.chart.destroy();
  });

  it('takes the Heikin Ashi last-price place when that badge is off', () => {
    const { chart, ctx } = mount(haData, { series: { type: 'heikin-ashi' }, priceAxis: { labels: { countdown: true } } });
    const { width: plotWidth } = chart.plotArea;
    const rects = ctx.ops.filter((o): o is Rect => o.op === 'rect' && o.x === plotWidth && o.h === 20);
    assert.equal(rects.length, 1);
    assert.equal(rects[0]!.y, chart.scale.priceToY(haLast.close) - 10);
    chart.destroy();
  });

  it('takes the hollow-candle direction (close vs previous close) like the last-price badge', () => {
    // Opens above and closes below its open, yet above the previous close: hollow up.
    const data = rising(29, { open: 131, high: 132, low: 129, close: 130, volume: 50 });
    assert.ok(data.at(-1)!.close < data.at(-1)!.open && data.at(-1)!.close >= data.at(-2)!.close);
    const labels = { priceAxis: { labels: { lastPrice: true, countdown: true } } } as const;
    const hollow = mount(data, { ...labels, series: { type: 'hollow-candlestick' } });
    const up = badges(hollow.ctx, hollow.chart);
    assert.equal(up.price.fill, seriesColor(hollow.chart, 'up'));
    assert.equal(up.countdown.fill, up.price.fill);
    hollow.chart.destroy();
    // Plain candles compare with the open, so both badges fall; with
    // colorByPreviousClose they compare with the previous close and rise again.
    const plain = mount(data, labels);
    const down = badges(plain.ctx, plain.chart);
    assert.equal(down.price.fill, seriesColor(plain.chart, 'down'));
    assert.equal(down.countdown.fill, down.price.fill);
    plain.chart.destroy();
    const byPrevious = mount(data, { ...labels, series: { colorByPreviousClose: true } });
    const previous = badges(byPrevious.ctx, byPrevious.chart);
    assert.equal(previous.countdown.fill, seriesColor(byPrevious.chart, 'up'));
    assert.equal(previous.countdown.fill, previous.price.fill);
    byPrevious.chart.destroy();
  });

  it('uses the bloxwapDark scale font and badge height, while the status line keeps its own font', () => {
    const data = rising(29, { open: 129, high: 131, low: 128, close: 130, volume: 50 });
    const { chart, ctx } = mount(data, { statusLine: { countdown: true }, priceAxis: { labels: { countdown: true } } }, 'bloxwapDark');
    const theme = bloxwapDark.theme!;
    const h = theme.scaleFontSize! + 8;
    const { countdown, price, label } = badges(ctx, chart);
    assert.equal(price.h, h);
    assert.equal(countdown.h, h);
    assert.equal(countdown.y, price.y + h);
    assert.equal(countdown.fill, bloxwapDark.series!.upColor);
    assert.equal(label.font, `${theme.scaleFontSize}px ${theme.scaleFontFamily}`);
    assert.equal(label.y, countdown.y + h / 2);
    const status = statusLine(ctx, chart).at(-1)!;
    assert.equal(status.text, '15:00');
    assert.equal(status.font, `12px ${theme.monoFamily}`);
    chart.destroy();
  });
});

describe('integration: screenshots x price lines, markers, Heikin Ashi and the volume overlay', () => {
  function shotChart() {
    const doc = new MockDocument();
    let now = T0S * 1000;
    const data = rising(39, { open: 139, high: 141, low: 137, close: 138, volume: 90 });
    const chart = createChart({
      document: doc, preset: 'bloxwapDark', now: () => now,
      config: {
        wasm: false, width: 800, height: 400, data,
        series: { type: 'heikin-ashi' },
        statusLine: { countdown: true },
        priceAxis: { labels: { countdown: true } },
      },
    });
    chart.series.createPriceLine({ price: 120, color: '#ffaa00', title: 'target' });
    chart.series.setMarkers([{ time: data[30]!.time, position: 'aboveBar', color: '#00aaff', shape: 'arrowDown', text: 'sell' }]);
    return { chart, doc, live: doc.created[0]!, advance: (ms: number) => { now += ms; } };
  }

  it('reproduces the live frame, including every merged layer', () => {
    const { chart, live } = shotChart();
    live.context.calls.length = 0;
    chart.render();
    const frame = [...live.context.calls];
    const shot = chart.takeScreenshot() as MockCanvas;
    assert.deepEqual(shot.context.calls, frame);
    const texts = shot.context.callsNamed('fillText').map((c) => c[1]);
    assert.ok(texts.includes('target'), 'the price-line title');
    assert.ok(texts.includes('sell'), 'the marker caption');
    assert.equal(texts.filter((t) => t === '15:00').length, 2, 'status-line and badge countdowns');
    chart.destroy();
  });

  it('reads the clock when taken, without repainting the live chart', () => {
    const { chart, live, advance } = shotChart();
    const before = live.context.calls.length;
    advance(5_000);
    const shot = chart.takeScreenshot() as MockCanvas;
    assert.equal(live.context.calls.length, before);
    const texts = shot.context.callsNamed('fillText').map((c) => c[1]);
    assert.equal(texts.filter((t) => t === '14:55').length, 2);
    assert.ok(!texts.includes('15:00'));
    // Encoding frees the copy and leaves price lines and markers untouched.
    assert.equal(chart.toDataURL({ type: 'image/png' }), 'data:image/png;mock,800x400');
    assert.equal(chart.series.priceLines().length, 1);
    assert.equal(chart.series.markers().length, 1);
    chart.destroy();
  });
});

/** Manually driven timers for the countdown ticker. */
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
    fire(): void {
      assert.equal(pending.size, 1);
      const [[id, handler]] = [...pending];
      pending.delete(id);
      handler();
    },
  };
}

describe('integration: live bar folder x countdown ticker', () => {
  const T0 = 1_700_000_040_000; // a 1m boundary
  const HISTORY: Candle[] = Array.from({ length: 20 }, (_, i) => ({
    time: (T0 - (19 - i) * MIN) / 1000, open: 100, high: 102, low: 99, close: 101, volume: 10,
  }));
  const statusTexts = (canvas: MockCanvas): string[] => canvas.context.callsNamed('fillText').map((c) => String(c[1]));

  it('counts down the held bucket and restarts at a full interval when a tick rolls the next one', () => {
    let now = T0 + 58_000;
    const canvas = new MockCanvas(800, 400);
    const chart = createChart({ container: canvas, now: () => now,
      config: { wasm: false, data: HISTORY, statusLine: { visible: true, countdown: true } } });
    assert.equal(statusTexts(canvas).at(-1), '00:02');
    const folder = createLiveBarFolder({ intervalMs: MIN, seedBar: HISTORY.at(-1)!, onBar: (b) => chart.appendData(b), now: () => now });
    const timers = fakeTimers();
    const ticker = startCountdownTicker({ chart, window: timers.window });

    now += 1_000;
    timers.fire();
    assert.equal(statusTexts(canvas).at(-1), '00:01');
    // The bucket closes before any tick arrives: the overdue bar reads 00:00.
    now = T0 + MIN + 50;
    timers.fire();
    assert.equal(statusTexts(canvas).at(-1), '00:00');
    // The rolling tick appends the next bar; the same clock gives a fresh interval.
    now += 50;
    folder.pushTick(101.5);
    assert.equal(chart.dataLength, HISTORY.length + 1);
    assert.equal(statusTexts(canvas).at(-1), '01:00');
    now += 1_000;
    timers.fire();
    assert.equal(statusTexts(canvas).at(-1), '00:59');
    ticker.stop();
    folder.dispose();
    chart.destroy();
  });

  it('counts down a folder-seeded first bar only when timeAxis.intervalMs mirrors the folder interval', () => {
    const now = T0 + 15_000;
    const run = (intervalMs: number | null) => {
      const canvas = new MockCanvas(800, 400);
      const chart = createChart({ container: canvas, now: () => now,
        config: { wasm: false, statusLine: { visible: true, countdown: true }, timeAxis: { intervalMs } } });
      const folder = createLiveBarFolder({ intervalMs: MIN, seedBar: null, onBar: (b) => chart.appendData(b), now: () => now });
      folder.pushTick(100);
      assert.equal(chart.dataLength, 1);
      const texts = statusTexts(canvas);
      folder.dispose();
      chart.destroy();
      return texts;
    };
    assert.equal(run(MIN).at(-1), '00:45');
    assert.ok(!run(null).includes('00:45'), 'no countdown while the interval is unknown');
  });
});
