import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, SmoothScroll, type FrameScheduler, type SmoothScrollOptions, type RenderView } from '../dist/index.js';
import { MockCanvas } from '../dist/dom.js';
import { Presence } from '../dist/core/presence.js';
import { RangeAnimation } from '../dist/core/range-animation.js';
import { CandleAnimation } from '../dist/core/candle-animation.js';
import { createFrameScheduler } from '../dist/ui/frames.js';
import type { UIWindow } from '../dist/ui/host.js';

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
const data = Array.from({ length: 2000 }, (_, i) => ({ time: i + 1, open: 100, close: 102, low: 98, high: 104, volume: 10 + i }));
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} vs ${b}`);
function fixture(options?: SmoothScrollOptions) {
  const frames = new Frames();
  const canvas = new MockCanvas(800, 500);
  const chart = createChart({ container: canvas, config: { data, wasm: false } });
  chart.scale.zoom(0.5);
  const scroll = new SmoothScroll(chart, frames, options);
  return { frames, chart, scroll, canvas };
}

describe('smooth chart paging', () => {
  it('moves partway on each frame and finishes exactly one page away', () => {
    const { frames, chart, scroll, canvas } = fixture();
    const range = chart.scale.visibleRange();
    const spacing = chart.scale.indexToX(1) - chart.scale.indexToX(0);
    const start = chart.scale.indexToX(0);
    const distance = (range.to - range.from) * 0.8 * spacing;
    const before = canvas.context.countCalls('fillRect');
    scroll.page(1);
    assert.equal(chart.scale.indexToX(0), start);
    assert.equal(canvas.context.countCalls('fillRect'), before);
    frames.tick(60);
    const halfway = chart.scale.indexToX(0);
    assert.ok(halfway > start && halfway < start + distance);
    frames.settle();
    close(chart.scale.indexToX(0), start + distance);
    scroll.page(-1);
    frames.settle();
    // Visible ranges round to whole candles; reciprocal pages differ by <1 bar.
    assert.ok(Math.abs(chart.scale.indexToX(0) - start) < spacing);
    chart.destroy();
  });

  it('coalesces repeated pages, clamps queued targets, and reverses immediately', () => {
    const { frames, chart, scroll } = fixture();
    const x = chart.scale.indexToX(0);
    for (let i = 0; i < 100; i++) scroll.page(1);
    assert.equal(frames.callbacks.size, 1);
    frames.tick(40);
    const mid = chart.scale.indexToX(0);
    assert.ok(mid > x);
    scroll.page(-1);
    frames.tick(16);
    assert.ok(chart.scale.indexToX(0) < mid);
    frames.settle();
    for (let i = 0; i < 100; i++) scroll.page(1);
    frames.settle();
    assert.equal(chart.scale.visibleRange().from, 0);
    scroll.page(1);
    assert.equal(frames.callbacks.size, 0);
    for (let i = 0; i < 100; i++) scroll.page(-1);
    frames.settle();
    assert.equal(chart.scale.visibleRange().to, chart.dataLength);
    scroll.page(-1);
    assert.equal(frames.callbacks.size, 0);
    chart.destroy();
  });

  it('has equal progress at different refresh rates and supports reduced motion', () => {
    const a = fixture(), b = fixture();
    a.scroll.page(1); b.scroll.page(1);
    for (let i = 0; i < 6; i++) a.frames.tick(1000 / 60);
    for (let i = 0; i < 12; i++) b.frames.tick(1000 / 120);
    close(a.chart.scale.indexToX(0), b.chart.scale.indexToX(0));
    a.frames.settle(); b.frames.settle();
    const c = fixture({ duration: 0 });
    c.scroll.page(1); c.frames.tick();
    assert.equal(c.frames.callbacks.size, 0);
    close(a.chart.scale.indexToX(0), c.chart.scale.indexToX(0));
    a.chart.destroy(); b.chart.destroy(); c.chart.destroy();
  });

  it('yields to external viewport changes and can restart or be cancelled', () => {
    const { chart, scroll, frames } = fixture();
    scroll.page(1); frames.tick(0);
    scroll.cancel(); scroll.cancel();
    assert.equal(frames.callbacks.size, 0);
    scroll.page(1);
    chart.scale.scrollBy(10);
    const external = chart.scale.indexToX(0);
    frames.tick();
    close(chart.scale.indexToX(0), external);
    scroll.page(1);
    chart.scale.zoom(2);
    frames.tick();
    assert.equal(frames.callbacks.size, 0);
    scroll.page(1);
    chart.scale.scrollBy(10);
    scroll.page(1);
    frames.settle();
    scroll.page(1);
    const stale = [...frames.callbacks.values()][0]!;
    scroll.destroy(); stale(9999); scroll.page(1);
    assert.equal(frames.callbacks.size, 0);
    chart.destroy();
  });

  it('handles invalid inputs, empty data and nonfinite geometry without scheduling', () => {
    for (const duration of [-1, NaN, Infinity]) assert.throws(() => fixture({ duration }), /duration/);
    const { chart, scroll, frames } = fixture();
    for (const bars of [0, NaN, Infinity, -Infinity]) scroll.scrollBy(bars);
    chart.setData([]); scroll.page(1);
    assert.equal(frames.callbacks.size, 0);
    for (const spacing of [0, NaN, -1, Infinity]) {
      const bad = new SmoothScroll({ dataLength: 100, scale: { ...chart.scale, indexToX: (index) => index * spacing } }, frames);
      bad.page(1); bad.scrollBy(10);
    }
    assert.equal(frames.callbacks.size, 0);
    chart.destroy();
  });

  it('honors reentrant frame callbacks and cancellation', () => {
    for (const stop of ['cancel', 'destroy'] as const) {
      const f = fixture({ onFrame: () => f.scroll[stop]() });
      f.scroll.page(1); f.frames.tick();
      assert.equal(f.frames.callbacks.size, 0);
      f.chart.destroy();
    }
    let once = false;
    const f = fixture({ onFrame: () => { if (!once) { once = true; f.scroll.page(1); } } });
    f.scroll.page(1); f.frames.tick();
    assert.equal(f.frames.callbacks.size, 1);
    f.frames.settle(); f.chart.destroy();
  });
});

describe('indicator transitions', () => {
  function animated(duration?: number, initial = false) {
    const frames = new Frames();
    const canvas = new MockCanvas(800, 500);
    const chart = createChart({ container: canvas,
      animation: duration === undefined ? { scheduler: frames } : { scheduler: frames, duration },
      config: { data, wasm: false, ...(initial ? { indicators: [
        { id: 'vol', name: 'vol', visible: true, params: {}, pane: 'sub' as const, colors: [] },
        { id: 'hidden', name: 'rsi', visible: false, params: {}, pane: 'sub' as const, colors: [] },
      ] } : {}) },
    });
    const view = () => (chart as unknown as { lastView: RenderView }).lastView;
    return { frames, canvas, chart, view };
  }

  it('expands/collapses panes and fades plots while reusing indicator computation', () => {
    const { frames, chart, view } = animated();
    const height = view().panes[0].layout.height;
    const id = chart.addIndicator({ name: 'vol' });
    assert.equal(view().panes.length, 1);
    frames.tick(60);
    const partial = view().panes[1];
    assert.ok(partial.opacity! > 0 && partial.opacity! < 1);
    assert.ok(partial.layout.height > 0 && partial.layout.height < height / 4);
    const output = partial.indicators[0];
    frames.settle();
    assert.equal(view().panes[1].opacity, 1);
    assert.equal(view().panes[1].indicators[0], output);
    const expanded = view().panes[1].layout.height;
    chart.removeIndicator(id);
    assert.equal(chart.getConfig().indicators.length, 0);
    assert.equal(view().panes[1].layout.height, expanded);
    frames.tick(60);
    assert.ok(view().panes[1].layout.height < expanded);
    frames.settle();
    assert.equal(view().panes.length, 1);
    assert.equal(view().panes[0].layout.height, height);
    chart.destroy();
  });

  it('fades overlays and smoothly adjusts their autoscale bounds', () => {
    const { frames, chart, view, canvas } = animated();
    const alphas: number[] = [];
    const stroke = canvas.context.stroke.bind(canvas.context);
    canvas.context.stroke = () => { if (canvas.context.strokeStyle === '#123456') alphas.push(canvas.context.globalAlpha); stroke(); };
    chart.indicators.register({ name: 'wide', defaultParams: {}, defaultColors: [], defaultPane: 'main',
      compute: (candles) => ({ pane: 'main', lines: [{ key: 'a', color: '#123456', values: candles.map(() => 150) }, { key: 'b', color: '#123456', values: candles.map(() => 50) }] }) });
    const before = view().panes[0].priceScale.maxPrice;
    const id = chart.addIndicator({ name: 'wide' });
    frames.tick(60);
    assert.ok(view().panes[0].priceScale.maxPrice > before && view().panes[0].priceScale.maxPrice < 150);
    assert.ok(alphas.some((a) => a > 0 && a < 1));
    frames.settle();
    assert.equal(view().panes[0].priceScale.maxPrice, 150);
    assert.equal(view().panes[0].priceScale.minPrice, 50);
    chart.removeIndicator(id); frames.tick(60);
    assert.ok(view().panes[0].priceScale.maxPrice < 150);
    frames.settle();
    assert.equal(view().panes[0].priceScale.maxPrice, before);
    chart.destroy();
  });

  it('reverses rapid hide/show and remove/re-add without duplicating a pane', () => {
    const { frames, chart, view } = animated(undefined, true);
    assert.equal(frames.callbacks.size, 0);
    chart.updateConfig({ indicators: chart.getConfig().indicators.map((i) => ({ ...i, visible: false })) });
    frames.tick(60);
    const height = view().panes[1].layout.height;
    chart.updateConfig({ indicators: [{ ...chart.getConfig().indicators[0], visible: true }] });
    assert.equal(view().panes[1].layout.height, height);
    frames.tick(60);
    assert.ok(view().panes[1].layout.height > height);
    chart.removeIndicator('vol'); frames.tick(16);
    chart.addIndicator({ name: 'vol', id: 'vol' });
    frames.settle();
    assert.equal(view().panes.length, 2);
    chart.addIndicator({ name: 'rsi' });
    chart.destroy();
    assert.equal(frames.callbacks.size, 0);
  });

  it('handles batched changes, instant motion, zero pane weights and cancellation', () => {
    const { frames, chart, view } = animated(0);
    chart.addIndicator({ name: 'vol' });
    assert.equal(frames.callbacks.size, 0);
    chart.updateConfig({ indicatorPaneWeight: 0 });
    assert.ok(view().panes[1].layout.height > 0);
    chart.destroy();
    const f = animated();
    f.chart.batch(() => {
      f.chart.addIndicator({ name: 'macd' });
      f.chart.addIndicator({ name: 'rsi' });
      f.chart.addIndicator({ name: 'sma', visible: false });
    });
    assert.equal(f.frames.callbacks.size, 1);
    f.frames.settle();
    assert.equal(f.view().panes.length, 3);
    f.chart.batch(() => { for (const ind of [...f.chart.getConfig().indicators]) f.chart.removeIndicator(ind.id); });
    f.frames.settle();
    assert.equal(f.view().panes.length, 1);
    f.chart.destroy();
  });

  it('settles cancelled entries, validates durations and removes its pending frame', () => {
    for (const duration of [NaN, -1, Infinity]) assert.throws(() => animated(duration), /duration/);
    const frames = new Frames();
    let draws = 0;
    const presence = new Presence<{ id: string }>(frames, () => { draws++; }, 240, []);
    const item = { id: 'a' };
    assert.deepEqual(presence.update([item]), []);
    assert.deepEqual(presence.update([]), []);
    assert.equal(frames.callbacks.size, 0);
    presence.update([item]); frames.tick();
    assert.equal(draws, 1);
    assert.ok(presence.update([item])[0].opacity > 0);
    presence.destroy(); presence.destroy();
    assert.equal(frames.callbacks.size, 0);
  });
});

describe('shared frame scheduler', () => {
  it('batches simultaneous animation work and respects cancellation during dispatch', () => {
    const native = new Frames();
    const win = { performance: { now: native.now }, requestAnimationFrame: native.request, cancelAnimationFrame: native.cancel } as unknown as UIWindow;
    let batches = 0;
    const frames = createFrameScheduler(win, (update) => { batches++; update(); });
    const seen: number[] = [];
    const first = frames.request(() => seen.push(1));
    frames.cancel(first);
    assert.equal(native.callbacks.size, 0);
    let cancelled = 0;
    frames.request(() => { seen.push(2); frames.cancel(cancelled); frames.request(() => seen.push(4)); });
    cancelled = frames.request(() => seen.push(3));
    assert.equal(frames.now(), 0);
    native.tick();
    assert.deepEqual(seen, [2]);
    assert.equal(batches, 1);
    native.tick();
    assert.deepEqual(seen, [2, 4]);
    assert.equal(batches, 2);
    frames.cancel(999);
  });
});

describe('animated live autoscale', () => {
  it('eases a new high and low without changing the horizontal framing', () => {
    const frames = new Frames();
    const chart = createChart({ container: new MockCanvas(800, 500), config: { data, wasm: false }, animation: { scheduler: frames } });
    const view = () => (chart as unknown as { lastView: RenderView }).lastView;
    const scale = () => view().panes[0].priceScale;
    const min = scale().minPrice, max = scale().maxPrice;
    const x = chart.scale.indexToX(1900);
    chart.appendData({ ...data.at(-1)!, high: 150, low: 70, close: 148 });
    assert.equal(scale().maxPrice, max);
    assert.equal(scale().minPrice, min);
    frames.tick(60);
    assert.ok(scale().maxPrice > max && scale().maxPrice < 150);
    assert.ok(scale().minPrice < min && scale().minPrice > 70);
    close(chart.scale.indexToX(1900), x);
    const mid = scale().maxPrice;
    chart.appendData({ ...data.at(-1)!, high: 180, close: 178 });
    assert.equal(scale().maxPrice, mid);
    frames.tick(60);
    assert.ok(scale().maxPrice > mid && scale().maxPrice < 180);
    frames.settle();
    assert.equal(scale().maxPrice, 180);
    assert.equal(scale().minPrice, 98);
    close(chart.scale.indexToX(1900), x);
    chart.destroy();
    assert.equal(frames.callbacks.size, 0);
  });

  it('animates volume ranges, resets on replacement, and tears down pending frames', () => {
    const frames = new Frames();
    const chart = createChart({ container: new MockCanvas(800, 500), config: { data, wasm: false }, animation: { scheduler: frames } });
    chart.addIndicator({ name: 'vol' }); frames.settle();
    const view = () => (chart as unknown as { lastView: RenderView }).lastView;
    const before = view().panes[1].priceScale.maxPrice;
    chart.appendData({ ...data.at(-1)!, volume: 10000 });
    assert.equal(view().panes[1].priceScale.maxPrice, before);
    frames.tick(60);
    assert.ok(view().panes[1].priceScale.maxPrice > before && view().panes[1].priceScale.maxPrice < 10000);
    frames.settle();
    assert.equal(view().panes[1].priceScale.maxPrice, 10000);
    chart.appendData({ ...data.at(-1)!, high: 200 });
    chart.setData(data);
    assert.equal(frames.callbacks.size, 0);
    chart.appendData({ ...data.at(-1)!, high: 200 });
    chart.updateConfig({ data });
    assert.equal(frames.callbacks.size, 0);
    chart.appendData({ ...data.at(-1)!, high: 200 });
    chart.destroy();
    assert.equal(frames.callbacks.size, 0);
  });

  it('is immediate with reduced motion and handles invalid bounds', () => {
    const frames = new Frames();
    const chart = createChart({ container: new MockCanvas(800, 500), config: { data, wasm: false }, animation: { scheduler: frames, duration: 0 } });
    chart.appendData({ ...data.at(-1)!, high: 200 });
    assert.equal((chart as unknown as { lastView: RenderView }).lastView.panes[0].priceScale.maxPrice, 200);
    assert.equal(frames.callbacks.size, 0);
    chart.destroy();
    const ranges = new RangeAnimation(frames, () => {}, 0);
    assert.deepEqual(ranges.update('a', Infinity, 10), { min: 0, max: 1 });
    assert.deepEqual(ranges.update('a', 10, NaN), { min: 0, max: 1 });
    ranges.retain([]); ranges.clear();
  });
});


describe('live candle animation', () => {
  function animatedCandle(duration = 240) {
    const frames = new Frames();
    const canvas = new MockCanvas(800, 500);
    const chart = createChart({ container: canvas, config: { data, wasm: false }, animation: { scheduler: frames, duration } });
    const view = () => (chart as unknown as { lastView: RenderView }).lastView;
    return { frames, canvas, chart, view };
  }

  it('eases the painted candle tip and wick without changing authoritative data or recomputing indicators', () => {
    const { chart, frames, canvas, view } = animatedCandle();
    let computations = 0;
    chart.indicators.register({ name: 'tip-check', defaultParams: {}, defaultColors: [], defaultPane: 'main',
      compute: (candles) => { computations++; return { pane: 'main', lines: [{ key: 'close', color: '#123456', values: candles.map((c) => c.close) }] }; } });
    chart.addIndicator({ name: 'tip-check' }); frames.settle();
    const previous = data.at(-1)!;
    const target = Object.freeze({ ...previous, close: 99, low: 95, high: 107 });
    const x = chart.scale.indexToX(data.length - 1);
    const source = view().candles;
    const before = computations;
    chart.appendData(target);
    assert.equal(view().candles, source, 'no full-history copy for animation');
    assert.equal(view().candles.at(-1), target);
    assert.equal(view().liveCandle!.close, previous.close);
    frames.tick(60);
    const visual = view().liveCandle!;
    assert.ok(visual.close > target.close && visual.close < previous.close);
    assert.ok(visual.low > target.low && visual.low < previous.low);
    assert.ok(visual.high < target.high && visual.high > previous.high);
    const ps = view().panes[0].priceScale;
    const body = canvas.context.callsNamed('fillRect').at(-1)!;
    close(body[2] as number, Math.min(ps.priceToY(visual.open), ps.priceToY(visual.close)));
    close(body[4] as number, Math.max(1, Math.abs(ps.priceToY(visual.open) - ps.priceToY(visual.close))));
    frames.settle();
    assert.equal(view().liveCandle, target);
    assert.equal(computations, before + 1);
    close(chart.scale.indexToX(data.length - 1), x);
    assert.equal(previous.close, 102);
    chart.destroy();
  });

  it('retargets from the current price, crosses the open smoothly and ignores volume-only changes', () => {
    const { chart, frames, view } = animatedCandle();
    const previous = data.at(-1)!;
    chart.appendData({ ...previous, high: 108, close: 106 });
    frames.tick(60);
    const mid = view().liveCandle!.close;
    chart.appendData({ ...previous, high: 108, low: 94, close: 96 });
    close(view().liveCandle!.close, mid);
    frames.tick(60);
    assert.ok(view().liveCandle!.close < mid && view().liveCandle!.close > 96);
    const target = view().candles.at(-1)!;
    chart.appendData({ ...target, volume: 8000 });
    frames.settle();
    assert.equal(view().liveCandle!.close, 96);
    assert.equal(view().liveCandle!.volume, 8000);
    assert.equal(view().liveCandle!.high, 108);
    assert.equal(view().liveCandle!.low, 94);
    chart.appendData({ ...view().candles.at(-1)!, volume: 9000 });
    // The volume pane is absent, so this does not start any visual transition.
    assert.equal(frames.callbacks.size, 0);
    chart.destroy();
  });

  it('grows a new bar from its own open and never animates historical corrections', () => {
    const { chart, frames, view } = animatedCandle();
    const next = { time: data.at(-1)!.time + 1, open: 110, high: 116, low: 108, close: 115 };
    chart.appendData(next);
    assert.equal(view().liveCandle!.open, 110);
    assert.equal(view().liveCandle!.close, 110);
    assert.equal(view().liveCandle!.high, 110);
    assert.equal(view().liveCandle!.low, 110);
    frames.tick(60);
    assert.ok(view().liveCandle!.close > 110 && view().liveCandle!.close < 115);
    assert.equal(view().candles.at(-2), data.at(-1));
    frames.settle();
    chart.appendData({ ...data[0], close: 103 });
    assert.equal(view().liveCandle, next);
    assert.equal(frames.callbacks.size, 0);
    chart.destroy();
  });

  it('resets on data replacement and cancels on destruction, with no transition in reduced motion', () => {
    const { chart, frames, view } = animatedCandle();
    chart.appendData({ ...data.at(-1)!, close: 103 });
    assert.ok(frames.callbacks.size > 0);
    chart.setData(data);
    assert.equal(view().liveCandle, data.at(-1));
    assert.equal(frames.callbacks.size, 0);
    chart.appendData({ ...data.at(-1)!, close: 103 });
    chart.updateConfig({ data });
    assert.equal(view().liveCandle, chart.getConfig().data.at(-1));
    assert.equal(frames.callbacks.size, 0);
    chart.appendData({ ...data.at(-1)!, close: 103 });
    chart.destroy();
    assert.equal(frames.callbacks.size, 0);
    const instant = animatedCandle(0);
    const target = { ...data.at(-1)!, close: 103 };
    instant.chart.appendData(target);
    assert.equal(instant.view().liveCandle, target);
    assert.equal(instant.frames.callbacks.size, 0);
    instant.chart.setData([]);
    assert.equal(instant.view().liveCandle, undefined);
    instant.chart.destroy();
  });

  it('makes equal progress at 60Hz/120Hz and settles exactly after a pause', () => {
    const a = animatedCandle(), b = animatedCandle();
    const target = { ...data.at(-1)!, open: 101, close: 101.333, high: 105.1, low: 97.8 };
    a.chart.appendData(target); b.chart.appendData(target);
    a.frames.tick(0);
    assert.equal(a.view().liveCandle!.close, 102);
    for (let i = 0; i < 6; i++) a.frames.tick(1000 / 60);
    for (let i = 0; i < 12; i++) b.frames.tick(1000 / 120);
    close(a.view().liveCandle!.close, b.view().liveCandle!.close);
    a.frames.tick(5000); b.frames.tick(5000);
    assert.equal(a.view().liveCandle, target);
    assert.equal(b.view().liveCandle, target);
    a.chart.destroy(); b.chart.destroy();
  });

  it('does not spin animation frames for invalid or unchanged prices', () => {
    const frames = new Frames();
    const animator = new CandleAnimation(frames, () => {}, 240);
    const candle = data.at(-1)!;
    assert.equal(animator.update(undefined), undefined);
    animator.update(candle);
    assert.equal(animator.update(candle), candle);
    for (const key of ['open', 'high', 'low', 'close'] as const) {
      const invalid = { ...candle, [key]: NaN };
      assert.equal(animator.update(invalid), invalid);
      assert.equal(animator.update(candle), candle);
    }
    assert.equal(frames.callbacks.size, 0);
    animator.clear(); animator.clear();
  });

  it('skips live price animation offscreen and for the volume histogram', () => {
    const { chart, frames, view } = animatedCandle();
    chart.scale.scrollTo(1000); frames.settle();
    const first = { ...data.at(-1)!, close: 103 };
    chart.appendData(first);
    assert.equal(view().liveCandle, first);
    assert.equal(frames.callbacks.size, 0);
    chart.scale.scrollTo(data.length - 1); frames.settle();
    assert.equal(view().liveCandle, first);
    chart.updateConfig({ series: { type: 'histogram' } });
    const second = { ...first, close: 99 };
    chart.appendData(second);
    assert.equal(view().liveCandle, second);
    assert.equal(frames.callbacks.size, 0);
    chart.destroy();
  });
});
