import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, CHART_THEMES, contrastingTextColor, formatCountdown, barIntervalMs, barCloseMs, barCountdownMs, countdownText, drawCountdownLabel } from '../dist/index.js';
import { MockCanvas, MockContext2D, type ChartCanvas } from '../dist/dom.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { resolveConfig, type ChartConfig, type DeepPartial } from '../dist/config.js';
import { createIndicatorRegistry } from '../dist/indicators/registry.js';
import type { IndicatorDef } from '../dist/indicators/types.js';
import type { Candle } from '../dist/core/data.js';
import type { RenderView } from '../dist/render/renderer.js';
import { drawStatusLine } from '../dist/render/settings-layers.js';

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const T0 = 1_700_000_100; // last bar opens here (UNIX seconds)
const FIFTEEN = 15 * 60;

/** 15-minute bars; the last one opens at T0. */
function bars(n: number, step = FIFTEEN): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const open = 100 + i, close = open + (i % 2 === 0 ? 1 : -1);
    return { time: T0 - (n - 1 - i) * step, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 + i };
  });
}

/** Records the fill color active for every fillText/fillRect. */
class ColorContext extends MockContext2D {
  readonly texts: { text: string; color: string; x: number; y: number }[] = [];
  readonly boxes: { color: string; x: number; y: number; w: number; h: number }[] = [];
  override fillText(text: string, x: number, y: number): void {
    this.texts.push({ text, color: String(this.fillStyle), x, y });
    super.fillText(text, x, y);
  }
  override fillRect(x: number, y: number, w: number, h: number): void {
    this.boxes.push({ color: String(this.fillStyle), x, y, w, h });
    super.fillRect(x, y, w, h);
  }
}

function colorCanvas(width = 800, height = 400): { canvas: ChartCanvas; ctx: ColorContext } {
  const ctx = new ColorContext();
  return { ctx, canvas: { width, height, getContext: () => ctx } };
}

/** A hand-built frame with one 300px main pane spanning prices [min, max]. */
function view(options: {
  config?: DeepPartial<ChartConfig>;
  data?: Candle[];
  liveCandle?: Candle;
  now?: (() => number) | null;
  range?: [number, number];
  panes?: false;
} = {}): RenderView {
  const data = options.data ?? bars(20);
  const config = resolveConfig({ data, ...options.config });
  const plotWidth = 800 - config.priceAxis.width;
  const timeScale = new TimeScale(10, plotWidth);
  const priceScale = new PriceScale();
  priceScale.height = 300;
  priceScale.setRange(...(options.range ?? [90, 130]));
  const now = options.now === undefined ? () => T0 * 1000 + 5 * MIN : options.now;
  return {
    canvasWidth: 800, canvasHeight: 400, plotWidth, plotHeight: 376, pixelRatio: 1,
    candles: data, range: timeScale.visibleRange(data.length), timeScale,
    panes: options.panes === false ? [] : [{ layout: { id: 'main', kind: 'main', weight: 3, y: 0, height: 300 }, priceScale, indicators: [] }],
    config, drawings: [], crosshair: { active: false, x: 0, y: 0 },
    ...(options.liveCandle ? { liveCandle: options.liveCandle } : {}),
    ...(now !== null ? { now } : {}),
  };
}

describe('formatCountdown', () => {
  const table: [number, string][] = [
    [0, '00:00'], [-5000, '00:00'], [Number.NaN, '00:00'],
    [1, '00:01'], [999, '00:01'], [1000, '00:01'], [1001, '00:02'],
    [59_000, '00:59'], [MIN, '01:00'], [14 * MIN + 59_000, '14:59'],
    [HOUR - 1000, '59:59'], [HOUR - 1, '01:00:00'], [HOUR, '01:00:00'], [HOUR + 61_000, '01:01:01'],
    [DAY - 1000, '23:59:59'], [DAY, '1d 00:00'], [3 * DAY + 4 * HOUR + 5 * MIN + 6000, '3d 04:05'], [10 * DAY, '10d 00:00'],
  ];
  for (const [ms, text] of table) {
    it(`formats ${ms} ms as ${text}`, () => assert.equal(formatCountdown(ms), text));
  }
});

describe('bar interval and remaining time', () => {
  it('prefers a valid explicit interval and otherwise infers it from the last two candles', () => {
    const data = bars(5);
    assert.equal(barIntervalMs(data, 60_000), 60_000);
    assert.equal(barIntervalMs(data, null), FIFTEEN * 1000);
    for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(barIntervalMs(data, invalid), FIFTEEN * 1000);
    // The last delta wins over earlier spacing (e.g. history in hours, live bars in minutes).
    const mixed = [...bars(3, 3600).slice(0, 2), { ...data[4]!, time: T0 + 7200 }, { ...data[4]!, time: T0 + 7260 }];
    assert.equal(barIntervalMs(mixed, null), 60_000);
  });

  it('is unknown with fewer than two candles or non-increasing times', () => {
    assert.equal(barIntervalMs([], null), null);
    assert.equal(barIntervalMs(bars(1), null), null);
    const [a] = bars(1);
    assert.equal(barIntervalMs([a!, { ...a! }], null), null);
    assert.equal(barIntervalMs([a!, { ...a!, time: a!.time - 60 }], null), null);
    assert.equal(barIntervalMs(bars(1), 60_000), 60_000);
  });

  it('measures from the last bar open plus one interval, and is null without data or interval', () => {
    const data = bars(3);
    assert.equal(barCountdownMs(data, null, T0 * 1000), FIFTEEN * 1000);
    assert.equal(barCountdownMs(data, null, T0 * 1000 + 14 * MIN), MIN);
    assert.equal(barCountdownMs(data, null, T0 * 1000 + 20 * MIN), -5 * MIN);
    assert.equal(barCountdownMs(bars(1), 5 * MIN, T0 * 1000 + MIN), 4 * MIN);
    assert.equal(barCountdownMs([], 60_000, 0), null);
    assert.equal(barCountdownMs(bars(1), null, 0), null);
  });

  it('closes month-spanning bars on UTC calendar months, and fixed bars after one interval', () => {
    const utc = (y: number, m: number, d = 1, h = 0) => Date.UTC(y, m - 1, d, h);
    const open = utc(2026, 2); // February: 28 days
    // A month-long interval from any source (inferred 28-31 days, or explicit) closes on the next 1st.
    for (const days of [28, 30, 31]) assert.equal(barCloseMs(open, days * DAY), utc(2026, 3));
    assert.equal(barCloseMs(utc(2026, 1), 28 * DAY), utc(2026, 2)); // a February-length delta read on a January bar
    assert.equal(barCloseMs(utc(2025, 11), 92 * DAY), utc(2026, 2)); // 3M
    assert.equal(barCloseMs(utc(2025, 1), 365 * DAY), utc(2026, 1)); // 12M
    assert.equal(barCloseMs(utc(2024, 1), 366 * DAY), utc(2025, 1)); // 12M across a leap year
    // Anything else is a fixed duration: minutes, weeks, or day counts outside N×[28, 31].
    for (const interval of [MIN, 15 * MIN, DAY, 7 * DAY, 14 * DAY, 27 * DAY, 32 * DAY, 45 * DAY]) {
      assert.equal(barCloseMs(open, interval), open + interval);
    }
  });

  it('counts monthly bars down to the next calendar month', () => {
    // Candles on Aug 1, Sep 1 and Oct 1 infer a 30-day interval; October has 31 days.
    const monthly = [8, 9, 10].map((m) => ({ time: Date.UTC(2026, m - 1, 1) / 1000, open: 1, high: 2, low: 0.5, close: 1.5 }));
    const now = Date.UTC(2026, 9, 31, 12);
    assert.equal(barCountdownMs(monthly, null, now), 12 * HOUR);
    assert.equal(countdownText(view({ data: monthly, now: () => now })), '12:00:00');
    // An explicit month-long interval (e.g. from a "1M" resolution) behaves the same.
    assert.equal(barCountdownMs(monthly.slice(2), 30 * DAY, Date.UTC(2026, 9, 1)), 31 * DAY);
  });

  it('formats a frame only when the view carries a clock', () => {
    assert.equal(countdownText(view()), '10:00');
    assert.equal(countdownText(view({ now: null })), null);
    assert.equal(countdownText(view({ data: bars(1) })), null);
    assert.equal(countdownText(view({ data: bars(1), config: { timeAxis: { intervalMs: HOUR } } })), '55:00');
  });
});

describe('status line countdown', () => {
  it('is off by default and never reads the clock then', () => {
    let reads = 0;
    const { canvas, ctx } = colorCanvas();
    const chart = createChart({ container: canvas, now: () => { reads++; return T0 * 1000; },
      config: { wasm: false, data: bars(30), statusLine: { visible: true } } });
    chart.setCrosshair(100, 100); chart.clearCrosshair(); chart.refreshOverlay();
    assert.equal(chart.getConfig().statusLine.countdown, false);
    assert.equal(chart.getConfig().priceAxis.labels.countdown, false);
    assert.equal(chart.getConfig().timeAxis.intervalMs, null);
    assert.equal(reads, 0);
    assert.ok(!ctx.texts.some((t) => /^\d\d:\d\d$/.test(t.text)));
    chart.destroy();
  });

  it('shows the time left in the theme text color after the other segments', () => {
    const { canvas, ctx } = colorCanvas();
    let now = T0 * 1000 + 61_500;
    const theme = CHART_THEMES.dark;
    const chart = createChart({ container: canvas, theme: 'dark', now: () => now,
      config: { wasm: false, data: bars(30), statusLine: { visible: true, countdown: true, volume: true } } });
    const countdown = ctx.texts.filter((t) => t.text === '13:59');
    assert.equal(countdown.length, 1);
    assert.equal(countdown[0]!.color, theme.theme!.textColor);
    // Volume normally ends the line; the countdown is spaced away from it.
    const volume = ctx.texts.find((t) => t.text.startsWith('Volume '))!;
    assert.equal(countdown[0]!.x - volume.x, (volume.text.length + 3) * 6);
    assert.equal(countdown[0]!.y, volume.y);
    // A later clock reading is picked up by an overlay repaint.
    now += 60_000;
    chart.refreshOverlay();
    assert.ok(ctx.texts.some((t) => t.text === '12:59' && t.color === theme.theme!.textColor));
    // Overdue bars clamp at zero.
    now += HOUR;
    chart.refreshOverlay();
    assert.ok(ctx.texts.some((t) => t.text === '00:00'));
    chart.destroy();
  });

  it('stands alone at the left edge when it is the only segment', () => {
    const ctx = new ColorContext();
    drawStatusLine(ctx, view({ config: { statusLine: { visible: true, countdown: true, symbolVisible: false, ohlc: false, change: false, indicators: false } } }));
    assert.deepEqual(ctx.texts.map((t) => [t.text, t.x]), [['10:00', 12]]);
  });

  it('is hidden while the interval is unknown, and uses an explicit interval', () => {
    const hidden = new ColorContext();
    drawStatusLine(hidden, view({ data: bars(1), config: { statusLine: { visible: true, countdown: true } } }));
    assert.ok(hidden.texts.length > 0);
    assert.ok(!hidden.texts.some((t) => t.text.includes(':')));
    const noClock = new ColorContext();
    drawStatusLine(noClock, view({ now: null, config: { statusLine: { visible: true, countdown: true } } }));
    assert.ok(!noClock.texts.some((t) => t.text.includes(':')));
    const explicit = new ColorContext();
    drawStatusLine(explicit, view({ data: bars(1), config: { timeAxis: { intervalMs: 4 * HOUR }, statusLine: { visible: true, countdown: true } } }));
    assert.ok(explicit.texts.some((t) => t.text === '03:55:00'));
  });

  it('keeps counting down the latest bar while the crosshair hovers history', () => {
    const { canvas, ctx } = colorCanvas();
    const chart = createChart({ container: canvas, now: () => T0 * 1000 + 2 * DAY,
      config: { wasm: false, data: bars(30), timeAxis: { intervalMs: 7 * DAY }, statusLine: { visible: true, countdown: true } } });
    chart.setCrosshair(chart.scale.indexToX(3), 50);
    assert.ok(ctx.texts.filter((t) => t.text === '5d 00:00').length >= 2);
    chart.destroy();
  });
});

describe('price axis countdown badge', () => {
  const labelHeight = 12 + 8;
  it('sits under the last-price badge in the candle color with contrasting text', () => {
    const ctx = new ColorContext();
    const v = view({ config: { priceAxis: { labels: { lastPrice: true, countdown: true } } } });
    drawCountdownLabel(ctx, v);
    const last = v.candles.at(-1)!;
    const y = v.panes[0]!.priceScale.priceToY(last.close);
    const top = y - labelHeight / 2 + labelHeight;
    assert.ok(last.close < last.open);
    assert.deepEqual(ctx.boxes, [{ color: v.config.series.downColor, x: v.plotWidth, y: top, w: 800 - v.plotWidth, h: labelHeight }]);
    assert.equal(ctx.texts.length, 1);
    assert.equal(ctx.texts[0]!.text, '10:00');
    assert.equal(ctx.texts[0]!.x, v.plotWidth + 4);
    assert.equal(ctx.texts[0]!.y, top + labelHeight / 2);
    assert.equal(ctx.texts[0]!.color, contrastingTextColor(v.config.series.downColor, v.config.theme.background));
    // An up bar paints the badge in the up color.
    const up = new ColorContext();
    drawCountdownLabel(up, view({ data: bars(19), config: { priceAxis: { labels: { countdown: true } } } }));
    assert.equal(up.boxes[0]!.color, v.config.series.upColor);
  });

  it('flips above the price badge near the pane bottom and centers on the price without one', () => {
    const data = bars(20);
    const low = data.at(-1)!.close;
    const bottom = new ColorContext();
    const v = view({ data, range: [low, low + 40], config: { priceAxis: { labels: { lastPrice: true, countdown: true } } } });
    drawCountdownLabel(bottom, v);
    const y = v.panes[0]!.priceScale.priceToY(low); // 276 of 300
    assert.equal(bottom.boxes[0]!.y, y - labelHeight / 2 - labelHeight);
    const alone = new ColorContext();
    drawCountdownLabel(alone, view({ config: { priceAxis: { labels: { countdown: true } } } }));
    const w = view();
    assert.equal(alone.boxes[0]!.y, w.panes[0]!.priceScale.priceToY(w.candles.at(-1)!.close) - labelHeight / 2);
  });

  it('widens into the plot when the text is wider than the axis', () => {
    // MockContext2D measures 6px per character: '5d 00:00' is 48px + 8px padding.
    const config = { timeAxis: { intervalMs: 7 * DAY }, priceAxis: { width: 40, labels: { countdown: true } } };
    const right = new ColorContext();
    const v = view({ now: () => T0 * 1000 + 2 * DAY, config });
    drawCountdownLabel(right, v);
    assert.equal(right.texts[0]!.text, '5d 00:00');
    assert.equal(right.boxes[0]!.w, 56);
    assert.equal(right.boxes[0]!.x + right.boxes[0]!.w, 800); // flush with the canvas edge
    assert.equal(right.texts[0]!.x, right.boxes[0]!.x + 4);
    assert.equal(right.countCalls('clip'), 0);
    const left = new ColorContext();
    drawCountdownLabel(left, view({ now: () => T0 * 1000 + 2 * DAY, config: { ...config, priceAxis: { ...config.priceAxis, position: 'left' } } }));
    assert.deepEqual([left.boxes[0]!.x, left.boxes[0]!.w], [-40, 56]);
  });

  it('follows a left axis and the live candle direction', () => {
    const ctx = new ColorContext();
    const data = bars(20);
    const liveCandle = { ...data.at(-1)!, open: 120, close: 110 };
    const v = view({ data, liveCandle, config: { priceAxis: { position: 'left', labels: { countdown: true } } } });
    drawCountdownLabel(ctx, v);
    assert.equal(ctx.boxes[0]!.x, -(800 - v.plotWidth));
    assert.equal(ctx.boxes[0]!.color, v.config.series.downColor);
  });

  it('is skipped when off, without an axis, pane, clock or interval, or off-pane', () => {
    const cases: RenderView[] = [
      view(),
      view({ config: { priceAxis: { visible: false, labels: { countdown: true } } } }),
      view({ panes: false, config: { priceAxis: { labels: { countdown: true } } } }),
      view({ now: null, config: { priceAxis: { labels: { countdown: true } } } }),
      view({ data: bars(1), config: { priceAxis: { labels: { countdown: true } } } }),
      view({ range: [200, 300], config: { priceAxis: { labels: { countdown: true } } } }),
      view({ range: [10, 20], config: { priceAxis: { labels: { countdown: true } } } }),
      view({ liveCandle: { ...bars(20).at(-1)!, close: Number.NaN }, config: { priceAxis: { labels: { countdown: true } } } }),
    ];
    for (const v of cases) {
      const ctx = new ColorContext();
      drawCountdownLabel(ctx, v);
      assert.equal(ctx.calls.length, 0);
    }
  });

  it('is painted by the chart overlay above the static layers', () => {
    const { canvas, ctx } = colorCanvas();
    const chart = createChart({ container: canvas, now: () => T0 * 1000,
      config: { wasm: false, data: bars(30), priceAxis: { labels: { lastPrice: true, countdown: true } } } });
    assert.ok(ctx.texts.some((t) => t.text === '15:00' && t.x > chart.plotArea.width));
    chart.destroy();
  });
});

describe('refreshOverlay and the chart clock', () => {
  function counted(canvas: ChartCanvas, now: () => number) {
    let computes = 0;
    const def: IndicatorDef = {
      name: 'counted', defaultParams: {}, defaultColors: ['red'], defaultPane: 'main',
      compute(candles) {
        computes++;
        return { pane: 'main', lines: [{ key: 'v', color: 'red', values: candles.map((c) => c.close) }] };
      },
    };
    // Every full render() looks the indicator up; an overlay repaint never does.
    const indicators = createIndicatorRegistry(false).register(def);
    const get = indicators.get.bind(indicators);
    let lookups = 0;
    indicators.get = (name) => { lookups++; return get(name); };
    const chart = createChart({ container: canvas, now, registries: { indicators },
      config: { wasm: false, data: bars(40), statusLine: { visible: true, countdown: true },
        indicators: [{ id: 'c', name: 'counted', params: {}, colors: ['red'], pane: 'main', visible: true }] } });
    return { chart, computes: () => computes, lookups: () => lookups };
  }

  it('repaints the countdown over the cached base without recomputing indicators', () => {
    const canvas = new MockCanvas(800, 400), cache = new MockCanvas(800, 400);
    Object.assign(canvas, { ownerDocument: { createElement: () => cache } });
    let now = T0 * 1000;
    const { chart, computes, lookups } = counted(canvas, () => now);
    assert.equal(computes(), 1);
    const looked = lookups();
    now += 1000;
    chart.refreshOverlay();
    assert.equal(lookups(), looked);
    const cacheCalls = cache.context.calls.length;
    const drawn = canvas.context.countCalls('drawImage');
    assert.equal(drawn, 1);
    now += 1000;
    chart.refreshOverlay();
    assert.equal(computes(), 1);
    assert.equal(cache.context.calls.length, cacheCalls);
    assert.equal(canvas.context.countCalls('drawImage'), drawn + 1);
    const texts = canvas.context.callsNamed('fillText').map((c) => c[1]);
    assert.ok(texts.includes('14:59') && texts.includes('14:58'));
    chart.destroy();
  });

  it('falls back to a full paint from the last view, still without recomputing', () => {
    const canvas = new MockCanvas(800, 400);
    let now = T0 * 1000;
    const { chart, computes, lookups } = counted(canvas, () => now);
    const looked = lookups();
    now += 3000;
    chart.refreshOverlay();
    assert.equal(computes(), 1);
    // The frame is repainted from the last view: no indicator pass at all.
    assert.equal(lookups(), looked);
    assert.ok(canvas.context.callsNamed('fillText').some((c) => c[1] === '14:57'));
    // Coalesced inside a batch, and a no-op once destroyed.
    const before = canvas.context.calls.length;
    chart.batch(() => { chart.refreshOverlay(); chart.refreshOverlay(); assert.equal(canvas.context.calls.length, before); });
    assert.ok(canvas.context.calls.length > before);
    assert.equal(lookups(), looked);
    // Control: a full render() does walk the indicators (its cache also skips compute).
    chart.render();
    assert.equal(lookups(), looked + 1);
    assert.equal(computes(), 1);
    chart.destroy();
    const after = canvas.context.calls.length;
    chart.refreshOverlay();
    assert.equal(canvas.context.calls.length, after);
  });

  it('exposes the injected clock and defaults to the wall clock', () => {
    const fixed = createChart({ container: new MockCanvas(100, 100), now: () => 42, config: { wasm: false } });
    assert.equal(fixed.now(), 42);
    fixed.destroy();
    const wall = createChart({ container: new MockCanvas(100, 100), config: { wasm: false } });
    const before = Date.now();
    const value = wall.now();
    assert.ok(value >= before && value <= Date.now());
    wall.destroy();
  });
});
