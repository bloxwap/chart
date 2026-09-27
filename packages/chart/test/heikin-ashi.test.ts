import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, visibleMinMax, type Chart, type FrameScheduler, type RenderView } from '../dist/index.js';
import { heikinAshi as rootHeikinAshi, heikinAshiBar as rootHeikinAshiBar, updateHeikinAshi as rootUpdate } from '../dist/index.js';
import { MockCanvas, MockContext2D } from '../dist/dom.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { DEFAULT_CONFIG, type SeriesConfig } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';
import {
  HeikinAshiCache,
  SERIES_RENDERERS,
  drawCandlesticks,
  drawHeikinAshi,
  heikinAshi,
  heikinAshiBar,
  heikinAshiLive,
  updateHeikinAshi,
} from '../dist/series/index.js';

/** Records the fill style in effect for every fillRect. */
class StyleContext extends MockContext2D {
  readonly fills: { style: string; rect: [number, number, number, number] }[] = [];
  override fillRect(x: number, y: number, w: number, h: number): void {
    this.fills.push({ style: this.fillStyle, rect: [x, y, w, h] });
    super.fillRect(x, y, w, h);
  }
}

class Frames implements FrameScheduler {
  time = 0;
  sequence = 0;
  callbacks = new Map<number, (time: number) => void>();
  now = () => this.time;
  request = (callback: (time: number) => void) => {
    const id = this.sequence++;
    this.callbacks.set(id, callback);
    return id;
  };
  cancel = (id: number) => { this.callbacks.delete(id); };
  tick(ms = 16) {
    this.time += ms;
    for (const [id, callback] of [...this.callbacks]) if (this.callbacks.delete(id)) callback(this.time);
  }
  settle() {
    for (let i = 0; i < 100 && this.callbacks.size; i++) this.tick();
    assert.equal(this.callbacks.size, 0);
  }
}

const REAL: Candle[] = [
  { time: 100, open: 10, high: 12, low: 9, close: 11, volume: 100 },
  { time: 200, open: 11, high: 11.5, low: 8, close: 8.5, volume: 200 },
  { time: 300, open: 8.5, high: 13, low: 8, close: 12 },
  { time: 400, open: 20, high: 21, low: 19, close: 20.5 }, // gap up: HA low widens to its open
  { time: 500, open: 5, high: 6, low: 4, close: 5.5 }, // gap down: HA high widens to its open
];

/** Hand-computed HA bars for {@link REAL}. */
const EXPECTED: Candle[] = [
  { time: 100, open: 10.5, high: 12, low: 9, close: 10.5, volume: 100 },
  { time: 200, open: 10.5, high: 11.5, low: 8, close: 9.75, volume: 200 },
  { time: 300, open: 10.125, high: 13, low: 8, close: 10.375 },
  { time: 400, open: 10.25, high: 21, low: 10.25, close: 20.125 },
  { time: 500, open: 15.1875, high: 15.1875, low: 4, close: 5.125 },
];

/** Deterministic random-walk candles. */
function walk(count: number, seed = 7, start = 100): Candle[] {
  let state = seed;
  const rand = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
  const out: Candle[] = [];
  let price = start;
  for (let i = 0; i < count; i++) {
    const open = price;
    const close = open + (rand() - 0.5) * 4;
    out.push({ time: 1_700_000_000 + i * 60, open, high: Math.max(open, close) + rand() * 2, low: Math.min(open, close) - rand() * 2, close, volume: 1 + i });
    price = close;
  }
  return out;
}

const view = (chart: Chart) => (chart as unknown as { lastView: RenderView }).lastView;

function chartWith(data: Candle[], extra: Record<string, unknown> = {}) {
  const canvas = new MockCanvas(800, 500);
  const chart = createChart({ container: canvas, config: { data, wasm: false, series: { type: 'heikin-ashi' }, ...extra } });
  return { chart, canvas };
}

describe('heikinAshi transform', () => {
  it('matches hand-computed bars, widening high/low and carrying time and volume', () => {
    const bars = heikinAshi(REAL);
    assert.deepEqual(bars, EXPECTED);
    assert.equal('volume' in bars[2]!, false, 'no volume key when the candle has none');
    assert.equal(REAL[0]!.open, 10, 'input untouched');
    assert.notEqual(heikinAshi(REAL), heikinAshi(REAL), 'a fresh array per call');
    assert.deepEqual(heikinAshi([]), []);
  });

  it('seeds from the candle itself when the previous bar is missing or not finite', () => {
    assert.deepEqual(heikinAshiBar(REAL[1]!), { time: 200, open: 9.75, high: 11.5, low: 8, close: 9.75, volume: 200 });
    const broken = { ...EXPECTED[0]!, open: NaN };
    assert.equal(heikinAshiBar(REAL[1]!, broken).open, (11 + 8.5) / 2);
    assert.deepEqual(heikinAshiBar(REAL[1]!, EXPECTED[0]), EXPECTED[1]);
  });

  it('is re-exported from the package root', () => {
    assert.equal(rootHeikinAshi, heikinAshi);
    assert.equal(rootHeikinAshiBar, heikinAshiBar);
    assert.equal(rootUpdate, updateHeikinAshi);
  });

  it('incremental tail updates equal a full recompute and keep earlier bars', () => {
    const data = walk(400);
    const live: Candle[] = [];
    const bars: Candle[] = [];
    for (const candle of data) {
      // Stream each bar as three ticks: open print, a revision, then the close.
      live.push({ ...candle, high: candle.open, low: candle.open, close: candle.open });
      updateHeikinAshi(bars, live, live.length - 1);
      live[live.length - 1] = { ...candle, close: (candle.open + candle.close) / 2, high: Math.max(candle.open, candle.close), low: Math.min(candle.open, candle.close) };
      updateHeikinAshi(bars, live, live.length - 1);
      live[live.length - 1] = candle;
      const prior = bars[live.length - 2];
      assert.equal(updateHeikinAshi(bars, live, live.length - 1), bars, 'updates in place');
      assert.equal(bars[live.length - 2], prior, 'earlier bars are not recomputed');
    }
    assert.deepEqual(bars, heikinAshi(data));
  });

  it('recomputes from any index, truncates and ignores a from beyond the data', () => {
    const data = walk(50);
    const bars = heikinAshi(data);
    const edited = data.slice();
    edited[20] = { ...edited[20]!, close: edited[20]!.close + 5 };
    const kept = bars[19];
    updateHeikinAshi(bars, edited, 20);
    assert.deepEqual(bars, heikinAshi(edited));
    assert.equal(bars[19], kept);
    const tail = bars[49];
    updateHeikinAshi(bars, edited, Infinity);
    assert.equal(bars[49], tail, 'nothing recomputed');
    updateHeikinAshi(bars, edited.slice(0, 10), 30);
    assert.deepEqual(bars, heikinAshi(edited.slice(0, 10)));
    updateHeikinAshi(bars, edited, -5);
    assert.deepEqual(bars, heikinAshi(edited));
  });
});

describe('HeikinAshiCache', () => {
  it('memoizes per array, updates in-place edits from the invalidated index, and resets on a new array', () => {
    const cache = new HeikinAshiCache();
    const data = walk(30);
    const bars = cache.get(data);
    assert.deepEqual(bars, heikinAshi(data));
    assert.equal(cache.get(data), bars, 'unchanged data returns the memoized bars');
    const b0 = bars[0], b28 = bars[28];
    data.push(walk(31)[30]!);
    data[29] = { ...data[29]!, close: data[29]!.close + 1 };
    cache.invalidate(29);
    cache.invalidate(40); // the lowest invalidation wins
    const updated = cache.get(data);
    assert.equal(updated, bars);
    assert.deepEqual(updated, heikinAshi(data));
    assert.equal(updated[0], b0);
    assert.equal(updated[28], b28);
    const other = walk(10, 3);
    const fresh = cache.get(other);
    assert.notEqual(fresh, bars, 'a new source never mutates bars handed out earlier');
    assert.deepEqual(fresh, heikinAshi(other));
    assert.equal(bars.length, 31);
  });

  it('display() returns HA bars for heikin-ashi and the candles themselves, releasing the cache, otherwise', () => {
    const cache = new HeikinAshiCache();
    const state = cache as unknown as { source: readonly Candle[] | null; bars: Candle[] };
    const data = walk(20);
    assert.equal(cache.display(data, 'candlestick'), data, 'nothing cached, candles pass through');
    assert.equal(state.source, null);
    const bars = cache.display(data, 'heikin-ashi');
    assert.deepEqual(bars, heikinAshi(data));
    assert.equal(cache.display(data, 'heikin-ashi'), bars, 'memoized');
    assert.equal(cache.display(data, 'hollow-candlestick'), data);
    assert.equal(state.source, null, 'source array released');
    assert.equal(state.bars.length, 0, 'HA bars released');
    assert.equal(bars.length, 20, 'bars handed out earlier are not mutated');
    const again = cache.display(data, 'heikin-ashi');
    assert.notEqual(again, bars, 'recomputed after release');
    assert.deepEqual(again, bars);
  });

  it('clear() releases everything and is a no-op on an empty cache', () => {
    const cache = new HeikinAshiCache();
    const state = cache as unknown as { source: readonly Candle[] | null; bars: Candle[] };
    const empty = state.bars;
    cache.clear();
    assert.equal(state.bars, empty, 'no allocation when nothing is cached');
    const data = walk(10);
    const bars = cache.get(data);
    cache.invalidate(3);
    cache.clear();
    assert.equal(state.source, null);
    assert.equal(state.bars.length, 0);
    const fresh = cache.get(data);
    assert.notEqual(fresh, bars);
    assert.deepEqual(fresh, heikinAshi(data));
  });

  it('transforms the animated live candle against the previous HA bar', () => {
    const bars = heikinAshi(REAL);
    assert.equal(heikinAshiLive(undefined, bars), undefined);
    const live = { ...REAL[4]!, close: 5.9, high: 6.5 };
    assert.deepEqual(heikinAshiLive(live, bars), heikinAshiBar(live, bars[3]));
    assert.deepEqual(heikinAshiLive(REAL[0]!, heikinAshi([REAL[0]!])), EXPECTED[0]);
  });
});

describe('drawHeikinAshi', () => {
  function scales(): { ts: TimeScale; ps: PriceScale } {
    const ts = new TimeScale(10, 300);
    const ps = new PriceScale();
    ps.height = 200;
    ps.setRange(4, 21);
    return { ts, ps };
  }
  const cfg = (partial: Partial<SeriesConfig> = {}): SeriesConfig => ({ ...DEFAULT_CONFIG.series, upColor: '#0a0', downColor: '#a00', ...partial });

  it('is registered and draws exactly like candlesticks over HA bars by default', () => {
    assert.equal(SERIES_RENDERERS['heikin-ashi'], drawHeikinAshi);
    const { ts, ps } = scales();
    const a = new MockContext2D(), b = new MockContext2D();
    drawHeikinAshi(a, EXPECTED, { from: 0, to: 5 }, ts, ps, cfg({ borderVisible: true }));
    drawCandlesticks(b, EXPECTED, { from: 0, to: 5 }, ts, ps, cfg({ borderVisible: true }));
    assert.deepEqual(a.calls, b.calls);
  });

  it('colors by HA direction even when colorByPreviousClose is on', () => {
    const { ts, ps } = scales();
    // Bar 1 rises within itself but closes below bar 0's close.
    const bars: Candle[] = [
      { time: 1, open: 10, high: 12, low: 9, close: 11.5 },
      { time: 2, open: 10.75, high: 11, low: 10, close: 10.9 },
      { time: 3, open: 10.8, high: 11, low: 9, close: 9.5 },
    ];
    const config = cfg({ colorByPreviousClose: true, wickUpColor: '#0f0', wickDownColor: '#f00' });
    const ctx = new StyleContext();
    drawHeikinAshi(ctx, bars, { from: 0, to: 3 }, ts, ps, config);
    assert.deepEqual(ctx.fills.map((f) => f.style), ['#0f0', '#0a0', '#0f0', '#0a0', '#f00', '#a00']);
    assert.equal(config.colorByPreviousClose, true, 'caller config untouched');
    const plain = new StyleContext();
    drawCandlesticks(plain, bars, { from: 0, to: 3 }, ts, ps, config);
    assert.equal(plain.fills[3]!.style, '#a00', 'plain candles would color bar 1 down');
  });

  it('draws the transformed live bar in place of the last one', () => {
    const { ts, ps } = scales();
    const liveBar = heikinAshiLive({ ...REAL[4]!, close: 6 }, EXPECTED)!;
    const ctx = new StyleContext();
    drawHeikinAshi(ctx, EXPECTED, { from: 4, to: 5 }, ts, ps, cfg(), liveBar);
    const body = ctx.fills[1]!.rect;
    assert.equal(body[1], Math.min(ps.priceToY(liveBar.open), ps.priceToY(liveBar.close)));
  });
});

describe('heikin-ashi chart', () => {
  it('builds display bars once from the real candles and draws them', () => {
    const data = walk(60);
    const { chart, canvas } = chartWith(data);
    const v = view(chart);
    assert.deepEqual(v.displayCandles, heikinAshi(data));
    assert.deepEqual(v.candles, data, 'the view keeps the real candles');
    assert.equal(v.liveCandle, undefined);
    const ps = v.panes[0]!.priceScale;
    const bodyWidth = Math.max(1, Math.floor(v.timeScale.barSpacing * 0.7));
    const bodyOf = (c: Candle, i: number) => {
      const x = Math.round(v.timeScale.indexToX(i, data.length));
      const yo = ps.priceToY(c.open), yc = ps.priceToY(c.close);
      return ['fillRect', x - Math.floor(bodyWidth / 2), Math.min(yo, yc), bodyWidth, Math.max(1, Math.abs(yc - yo))];
    };
    const rects = canvas.context.callsNamed('fillRect');
    const ha = v.displayCandles!;
    for (const i of [0, 30, 59]) {
      assert.ok(rects.some((r) => JSON.stringify(r) === JSON.stringify(bodyOf(ha[i]!, i))), `HA body ${i}`);
      assert.ok(!rects.some((r) => JSON.stringify(r) === JSON.stringify(bodyOf(data[i]!, i))), `no real body ${i}`);
    }
    const before = v.displayCandles!;
    const snapshot = [...before];
    chart.render();
    chart.render();
    const after = view(chart).displayCandles!;
    assert.equal(after, before);
    assert.equal(after.length, snapshot.length);
    assert.ok(after.every((bar, i) => bar === snapshot[i]), 'no per-frame recompute: every HA bar object is reused');
  });

  it('autoscales the main pane on HA extremes, candlesticks on real ones', () => {
    const flat = Array.from({ length: 100 }, (_, i) => ({ time: i + 1, open: 100, high: 101, low: 99, close: 100.5 }));
    const high = Array.from({ length: 50 }, (_, i) => ({ time: i + 101, open: 300, high: 301, low: 299, close: 300.5 }));
    const data = [...flat, ...high];
    const { chart } = chartWith(data);
    chart.scale.zoomToRange(101, 149);
    const range = chart.scale.visibleRange();
    assert.ok(range.from >= 100 && range.from <= 102, `${range.from}`);
    const expected = visibleMinMax(heikinAshi(data), range.from, range.to, null);
    const real = visibleMinMax(data, range.from, range.to, null);
    const ps = () => view(chart).panes[0]!.priceScale;
    assert.equal(ps().minPrice, expected.min);
    assert.equal(ps().maxPrice, expected.max);
    assert.ok(expected.min < real.min - 10, 'the lagging HA open widens the range below every real low');
    chart.updateConfig({ series: { type: 'candlestick' } });
    assert.equal(ps().minPrice, real.min);
    assert.equal(ps().maxPrice, real.max);
    assert.equal(view(chart).displayCandles, view(chart).candles);
  });

  it('uses the HA close as the percent-scale base', () => {
    const data = walk(40);
    const { chart } = chartWith(data, { priceAxis: { mode: 'percent' } });
    const ps = view(chart).panes[0]!.priceScale;
    const first = Math.max(0, Math.ceil(chart.scale.xToIndex(0)));
    assert.equal(ps.basePrice, heikinAshi(data)[first]!.close);
    assert.notEqual(ps.basePrice, data[first]!.close);
  });

  it('keeps indicators on the real candles', () => {
    const data = walk(40);
    const { chart } = chartWith(data);
    let seen: readonly Candle[] = [];
    chart.indicators.register({ name: 'probe', defaultParams: {}, defaultColors: ['#123456'], defaultPane: 'main',
      compute: (candles) => { seen = candles; return { pane: 'main', lines: [{ key: 'close', color: '#123456', values: candles.map((c) => c.close) }] }; } });
    chart.addIndicator({ name: 'probe' });
    assert.equal(seen, view(chart).candles);
    assert.equal(seen[5]!.close, data[5]!.close);
    assert.equal(view(chart).panes[0]!.indicators[0]!.lines[0]!.values[5], data[5]!.close);
  });

  it('streams appends incrementally and recomputes on inserts, setData and data updates', () => {
    const data = walk(80);
    const { chart } = chartWith(data.slice(0, 60));
    const bars = view(chart).displayCandles!;
    const early = bars[10];
    chart.appendData(data[60]!); // new bar
    chart.appendData({ ...data[60]!, close: data[60]!.close + 3, high: data[60]!.high + 3 }); // tick on the last bar
    assert.equal(view(chart).displayCandles, bars, 'updated in place');
    assert.equal(bars[10], early);
    assert.deepEqual(bars, heikinAshi(view(chart).candles));
    chart.appendData({ ...data[30]!, time: data[30]!.time + 30 }); // out-of-order insert
    assert.deepEqual(view(chart).displayCandles, heikinAshi(view(chart).candles));
    chart.setData(data);
    assert.notEqual(view(chart).displayCandles, bars);
    assert.deepEqual(view(chart).displayCandles, heikinAshi(data));
    chart.updateConfig({ data: data.slice(0, 20) });
    assert.deepEqual(view(chart).displayCandles, heikinAshi(data.slice(0, 20)));
  });

  it('catches up on appends made while another series type was showing', () => {
    const data = walk(50);
    const { chart } = chartWith(data.slice(0, 40));
    chart.updateConfig({ series: { type: 'candlestick' } });
    for (const candle of data.slice(40)) chart.appendData(candle);
    assert.equal(view(chart).displayCandles, view(chart).candles);
    chart.updateConfig({ series: { type: 'heikin-ashi' } });
    assert.deepEqual(view(chart).displayCandles, heikinAshi(data));
  });

  it('handles an empty dataset and a first streamed candle', () => {
    const { chart } = chartWith([]);
    assert.deepEqual(view(chart).displayCandles, []);
    chart.appendData(REAL[0]!);
    assert.deepEqual(view(chart).displayCandles, [EXPECTED[0]]);
  });

  it('animates the live bar in HA space and lands on the stored HA bar', () => {
    const frames = new Frames();
    const data = walk(100);
    const canvas = new MockCanvas(800, 500);
    const chart = createChart({ container: canvas, config: { data, wasm: false, series: { type: 'heikin-ashi' } }, animation: { scheduler: frames, duration: 200 } });
    const bars = () => view(chart).displayCandles!;
    assert.deepEqual(view(chart).liveCandle, bars().at(-1));
    const last = data.at(-1)!;
    const before = bars().at(-1)!;
    chart.appendData({ ...last, close: last.close + 10, high: last.high + 10 });
    const target = bars().at(-1)!;
    frames.tick(60);
    const live = view(chart).liveCandle!;
    assert.equal(live.open, (bars().at(-2)!.open + bars().at(-2)!.close) / 2, 'HA open is fixed by the previous bar');
    assert.ok(live.close > before.close && live.close < target.close, `${live.close} between ${before.close} and ${target.close}`);
    assert.equal(live.time, last.time);
    frames.settle();
    assert.deepEqual(view(chart).liveCandle, target);
    chart.destroy();
  });

  it('shows HA OHLC and change in the status line, following the crosshair', () => {
    const data = walk(40);
    const fmt = (value: number) => value.toFixed(4);
    const { chart, canvas } = chartWith(data, { statusLine: { visible: true, change: true }, formatters: { price: fmt } });
    const ha = heikinAshi(data);
    const texts = () => canvas.context.callsNamed('fillText').map((c) => c[1] as string);
    const last = ha[39]!, prev = ha[38]!;
    for (const text of [`O ${fmt(last.open)}`, `H ${fmt(last.high)}`, `L ${fmt(last.low)}`, `C ${fmt(last.close)}`]) {
      assert.ok(texts().includes(text), text);
    }
    const change = last.close - prev.close;
    assert.ok(texts().some((t) => t.startsWith(`${change >= 0 ? '+' : ''}${fmt(change)} (`)), 'change vs previous HA close');
    assert.ok(!texts().includes(`C ${fmt(data[39]!.close)}`));
    canvas.context.calls.length = 0;
    chart.setCrosshair(chart.scale.indexToX(12), 100);
    assert.ok(texts().includes(`O ${fmt(ha[12]!.open)}`));
    assert.ok(texts().includes(`C ${fmt(ha[12]!.close)}`));
  });

  it('labels the HA close as the last price and HA extremes as high/low', () => {
    const data = walk(40);
    const fmt = (value: number) => value.toFixed(4);
    const { chart, canvas } = chartWith(data, {
      formatters: { price: fmt },
      priceAxis: { labels: { lastPrice: true, highLow: true }, lines: { lastPrice: true } },
    });
    const ha = heikinAshi(data);
    const texts = canvas.context.callsNamed('fillText').map((c) => c[1] as string);
    const range = chart.scale.visibleRange();
    const mm = visibleMinMax(ha, range.from, range.to, null);
    assert.ok(texts.includes(fmt(ha[39]!.close)), 'HA close on the price line');
    assert.ok(!texts.includes(fmt(data[39]!.close)));
    assert.ok(texts.includes(`H ${fmt(mm.max)}`));
    assert.ok(texts.includes(`L ${fmt(mm.min)}`));
  });

  it('releases the cached HA bars on destroy and while another type is showing', () => {
    const data = walk(300);
    const { chart } = chartWith(data);
    const cache = (chart as unknown as { heikinAshi: { source: readonly Candle[] | null; bars: Candle[] } }).heikinAshi;
    assert.equal(cache.bars.length, 300);
    chart.updateConfig({ series: { type: 'candlestick' } });
    assert.equal(cache.source, null, 'switching away drops the source array');
    assert.equal(cache.bars.length, 0);
    chart.updateConfig({ series: { type: 'heikin-ashi' } });
    assert.deepEqual(view(chart).displayCandles, heikinAshi(data), 'switching back recomputes');
    chart.destroy();
    assert.equal(cache.source, null, 'destroy drops the source array');
    assert.equal(cache.bars.length, 0, 'destroy drops the HA bars');
  });

  it('magnet-snaps to the displayed HA values, and to real values on candlesticks', () => {
    const { chart } = chartWith(REAL);
    // HA bar 4 is {open 15.1875, high 15.1875, low 4, close 5.125}; the real high is 6.
    const x = chart.scale.indexToX(4);
    assert.deepEqual(chart.snapPoint(x, chart.scale.priceToY(15), 'strong'), { index: 4, price: 15.1875 });
    assert.deepEqual(chart.snapPoint(x, chart.scale.priceToY(5.2), 'weak'), { index: 4, price: 5.125 });
    const ha = view(chart).displayCandles;
    chart.appendData({ ...REAL[4]!, close: 9, high: 9 }); // tick on the last bar, snapped before any repaint is observed
    const tip = heikinAshi(view(chart).candles)[4]!;
    assert.equal(chart.snapPoint(x, chart.scale.priceToY(tip.close), 'strong').price, tip.close);
    assert.equal(view(chart).displayCandles, ha, 'snapping reuses the cached bars');
    chart.updateConfig({ series: { type: 'candlestick' } });
    const real = view(chart).candles[4]!;
    assert.deepEqual(chart.snapPoint(chart.scale.indexToX(4), chart.scale.priceToY(15), 'strong'), { index: 4, price: real.high });
  });

  it('leaves other series types on the real candles', () => {
    const data = walk(30);
    for (const type of ['candlestick', 'bar', 'line', 'area', 'histogram', 'hollow-candlestick'] as const) {
      const canvas = new MockCanvas(800, 500);
      const chart = createChart({ container: canvas, config: { data, wasm: false, series: { type } } });
      assert.equal(view(chart).displayCandles, view(chart).candles, type);
    }
  });
});
