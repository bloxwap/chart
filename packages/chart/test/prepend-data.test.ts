import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import {
  createChart,
  SmoothScroll,
  SmoothZoom,
  type Chart,
  type ChartConfig,
  type DataLoadEvent,
  type DeepPartial,
  type FrameScheduler,
} from '../dist/index.js';
import { DataStore, type Candle } from '../dist/core/data.js';
import { olderCandles, shiftPoints } from '../dist/core/prepend.js';
import { MockCanvas, MockDocument } from '../dist/dom.js';
import { createDrawingToolbar, DrawingController, ZOOM_TOOL, type UIDocument, type UIElement } from '../dist/ui/index.js';

const T0 = 1_700_000_000;
const HOUR = 3600;
const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

/** Hourly bar `i` (negative for older history). */
function bar(i: number): Candle {
  const base = 100 + Math.sin(i / 7) * 10 + i / 50;
  return { time: T0 + i * HOUR, open: base, high: base + 2 + (i % 3), low: base - 2, close: base + 1, volume: 1000 + i };
}
const bars = (from: number, to: number): Candle[] => Array.from({ length: to - from }, (_, k) => bar(from + k));

function setup(data: Candle[], config: DeepPartial<ChartConfig> = {}, width = 800) {
  const canvas = new MockCanvas(width, 500);
  const chart = createChart({ container: canvas, config: { wasm: false, data, ...config } });
  return { chart, canvas };
}

function loads(chart: Chart): DataLoadEvent[] {
  const seen: DataLoadEvent[] = [];
  chart.subscribeDataLoad((e) => seen.push(e));
  return seen;
}

/** The candle the crosshair reports under canvas x. */
function candleUnder(chart: Chart, x: number): Candle | null {
  let seen: Candle | null = null;
  const off = chart.subscribeCrosshairMove((e) => {
    if (e.active) seen = e.candle;
  });
  chart.clearCrosshair();
  chart.setCrosshair(x, 100);
  chart.clearCrosshair();
  off();
  return seen;
}

/** Draw calls of one fresh frame. */
function frame(chart: Chart, canvas: MockCanvas): unknown[] {
  chart.render(); // settle price-axis sizing that reads the previous frame
  const start = canvas.context.calls.length;
  chart.render();
  return canvas.context.calls.slice(start);
}

describe('DataStore.prepend and prepend helpers', () => {
  it('prepends in front without touching the existing candles', () => {
    const store = new DataStore();
    store.setData(bars(0, 3));
    const before = store.raw();
    store.prepend(bars(-2, 0));
    assert.deepEqual(store.all(), bars(-2, 3));
    assert.notEqual(store.raw(), before, 'a fresh array, so identity-keyed caches rebuild');
    assert.equal(store.indexOfTime(bar(0).time), 2);
  });

  it('olderCandles keeps strictly older rows, deduped (last wins) and sorted', () => {
    const late = { ...bar(-2), close: 1 };
    const rows = [bar(-1), bar(0), bar(1), bar(-2), late, { ...bar(-3), time: NaN }, bar(-4)];
    assert.deepEqual(olderCandles(rows, bar(0).time), [bar(-4), late, bar(-1)]);
    assert.deepEqual(olderCandles([bar(1), bar(0)], undefined), [bar(0), bar(1)]);
    assert.deepEqual(olderCandles([], 5), []);
  });

  it('olderCandles drops rows with a non-finite price before deduping', () => {
    const broken = [
      { ...bar(-1), open: NaN }, { ...bar(-2), high: Infinity }, { ...bar(-3), low: -Infinity },
      { ...bar(-4), close: undefined as unknown as number }, { ...bar(-5), close: Number('x') },
    ];
    assert.deepEqual(olderCandles(broken, bar(0).time), []);
    // A broken duplicate never displaces the valid row for its time.
    assert.deepEqual(olderCandles([bar(-6), { ...bar(-6), high: NaN }], undefined), [bar(-6)]);
    // Volume stays optional.
    const { volume: _unused, ...bare } = bar(-7);
    assert.deepEqual(olderCandles([bare], undefined), [bare]);
  });

  it('shiftPoints moves bar indices and keeps prices', () => {
    const points = [{ index: 1, price: 5 }, { index: -2.5, price: 7 }];
    assert.deepEqual(shiftPoints(points, 10), [{ index: 11, price: 5 }, { index: 7.5, price: 7 }]);
    assert.deepEqual(points[0], { index: 1, price: 5 }, 'inputs are not mutated');
  });
});

describe('Chart.prependData', () => {
  it('is a no-op for empty, overlapping or newer input', () => {
    const { chart, canvas } = setup(bars(0, 100));
    const seen = loads(chart);
    const calls = canvas.context.calls.length;
    assert.equal(chart.prependData([]), 0);
    assert.equal(chart.prependData(bars(0, 20)), 0);
    assert.equal(chart.prependData([bar(150), { ...bar(-1), time: Number.NaN }]), 0);
    assert.equal(chart.dataLength, 100);
    assert.equal(canvas.context.calls.length, calls, 'no repaint');
    assert.deepEqual(seen, []);
    chart.destroy();
  });

  it('merges older rows, drops overlap and duplicates, and reports a prepend load', () => {
    const { chart } = setup(bars(0, 100));
    const seen = loads(chart);
    const page = [...bars(-30, 5), bar(-10), bar(-30)]; // overlaps the store; echoes some rows
    assert.equal(chart.prependData(page), 30);
    assert.equal(chart.dataLength, 130);
    assert.deepEqual(seen, [{ reason: 'prepend', length: 130, added: 30, firstTime: bar(-30).time, lastTime: bar(99).time }]);
    chart.destroy();
  });

  it('ignores rows that could not be drawn', () => {
    const { chart } = setup(bars(0, 50));
    const seen = loads(chart);
    assert.equal(chart.prependData([{ ...bar(-1), high: NaN }, { ...bar(-2), close: undefined as unknown as number }]), 0);
    assert.equal(chart.prependData([{ ...bar(-1), low: NaN }, bar(-2)]), 1);
    assert.equal(chart.dataLength, 51);
    assert.deepEqual((chart as unknown as { store: DataStore }).store.at(0), bar(-2));
    assert.deepEqual(seen.map((e) => [e.reason, e.added]), [['prepend', 1]]);
    chart.destroy();
  });

  it('fills an empty chart', () => {
    const { chart } = setup([]);
    assert.equal(chart.prependData(bars(0, 50).reverse()), 50);
    assert.equal(chart.dataLength, 50);
    assert.deepEqual(chart.scale.visibleRange(), { from: 0, to: 50 });
    chart.destroy();
  });

  it('keeps the same candles under the same pixels', () => {
    const { chart } = setup(bars(0, 300));
    chart.scale.scrollBy(37.5);
    const range = chart.scale.visibleRange();
    const probes = [range.from + 1, Math.floor((range.from + range.to) / 2), range.to - 1];
    const xs = probes.map((i) => chart.scale.indexToX(i));
    const under = xs.map((x) => candleUnder(chart, x));
    assert.deepEqual(under, probes.map((i) => bar(i)));

    assert.equal(chart.prependData(bars(-200, 0)), 200);
    assert.deepEqual(chart.scale.visibleRange(), { from: range.from + 200, to: range.to + 200 });
    probes.forEach((i, k) => close(chart.scale.indexToX(i + 200), xs[k]!));
    assert.deepEqual(xs.map((x) => candleUnder(chart, x)), under);
    chart.destroy();
  });

  it('renders exactly like a chart loaded with the merged data (indicators recompute)', () => {
    for (const type of ['candlestick', 'heikin-ashi'] as const) {
      const config: DeepPartial<ChartConfig> = { series: { type } };
      const a = setup(bars(0, 300), config);
      const b = setup(bars(-200, 300), config);
      for (const { chart } of [a, b]) {
        chart.addIndicator({ name: 'sma', params: { period: 50 } });
        chart.addIndicator({ name: 'ema', params: { period: 20 } });
        chart.addIndicator({ name: 'rsi' });
        chart.addIndicator({ name: 'macd' });
        chart.scale.scrollBy(150); // the SMA's warm-up now reaches into the prepended history
      }
      frame(a.chart, a.canvas); // prime the indicator and Heikin Ashi caches on the short data
      a.chart.prependData(bars(-200, 0));
      assert.deepEqual(frame(a.chart, a.canvas), frame(b.chart, b.canvas), type);
      a.chart.destroy();
      b.chart.destroy();
    }
  });

  it('streams correctly after a prepend (incremental indicator updates start from the merged data)', () => {
    const a = setup(bars(0, 300));
    const b = setup(bars(-100, 301));
    for (const { chart } of [a, b]) chart.addIndicator({ name: 'ema', params: { period: 30 } });
    frame(a.chart, a.canvas);
    a.chart.prependData(bars(-100, 0));
    a.chart.appendData(bar(300));
    assert.deepEqual(frame(a.chart, a.canvas), frame(b.chart, b.canvas));
    a.chart.destroy();
    b.chart.destroy();
  });

  it('moves index-based drawing points and the draft with their bars', () => {
    const { chart } = setup(bars(0, 300), {
      // A drawing whose model is not registered is still index-based.
      drawings: [{ id: 'ghost', name: 'custom-model', points: [{ index: 3, price: 1 }], color: '#fff', lineWidth: 1, lineStyle: 'solid', text: '', image: null, locked: false, visible: true }],
    });
    const line = chart.addDrawing({ name: 'trendline', points: [{ index: 250, price: 100 }, { index: 280, price: 110 }] });
    const pinned = chart.addDrawing({ name: 'anchored-text', points: [{ index: 0.25, price: 0.5 }], text: 'hi' });
    chart.selectDrawing(line);
    const handle = { x: chart.scale.indexToX(250), y: chart.scale.priceToY(100) };
    assert.equal(chart.handleAt(handle.x, handle.y), 0);
    const onLine = { x: chart.scale.indexToX(265), y: chart.scale.priceToY(105) };
    assert.equal(chart.drawingAt(onLine.x, onLine.y), line);

    chart.prependData(bars(-40, 0));
    assert.deepEqual(chart.getDrawing(line)!.points, [{ index: 290, price: 100 }, { index: 320, price: 110 }]);
    assert.deepEqual(chart.getDrawing(pinned)!.points, [{ index: 0.25, price: 0.5 }]);
    assert.deepEqual(chart.getDrawing('ghost')!.points, [{ index: 43, price: 1 }]);
    assert.equal(chart.selectedDrawing, line);
    close(chart.scale.indexToX(290), handle.x);
    assert.equal(chart.handleAt(handle.x, handle.y), 0, 'the selected handle is still under the pointer');
    assert.equal(chart.drawingAt(onLine.x, onLine.y), line, 'hit-testing follows the moved geometry');
    chart.destroy();
  });

  it('shifts the draft being previewed', () => {
    const { chart, canvas } = setup(bars(0, 300));
    chart.setDraft({ name: 'horizontal-ray', points: [{ index: 290, price: 104 }] });
    const before = frame(chart, canvas);
    chart.prependData(bars(-25, 0));
    assert.deepEqual(frame(chart, canvas), before, 'the draft is drawn at the same pixels');
    chart.setDraft({ name: 'anchored-text', points: [{ index: 0.5, price: 0.5 }], text: 'pin' });
    const pinned = frame(chart, canvas);
    chart.prependData(bars(-30, -25));
    assert.deepEqual(frame(chart, canvas), pinned, 'an anchored draft stays put');
    chart.destroy();
  });

  it('re-pins the right edge on a continuous time axis', () => {
    // Hourly bars with a weekend gap; history is prepended across another gap.
    const recent = [...bars(0, 60), ...bars(108, 200)];
    const { chart } = setup(recent, { timeScale: { continuous: true, intervalMs: HOUR * 1000 } });
    chart.scale.scrollBy(30);
    const range = chart.scale.visibleRange();
    const probes = [range.from, range.to - 1];
    const xs = probes.map((i) => chart.scale.indexToX(i));
    const slots = chart.scale.visibleSlots();

    const older = [...bars(-300, -250), ...bars(-100, 0)];
    assert.equal(chart.prependData(older), 150);
    probes.forEach((i, k) => close(chart.scale.indexToX(i + 150), xs[k]!, 1e-6));
    const after = chart.scale.visibleSlots();
    assert.equal(after.length - slots.length, 300, 'the new first candle opens 300 slots earlier');
    close(after.from - slots.from, 300, 1e-6);
    close(after.to - slots.to, 300, 1e-6);
    assert.deepEqual(chart.scale.visibleRange(), { from: range.from + 150, to: range.to + 150 });
    chart.destroy();
  });

  it('keeps the rightmost bar fixed when prepended history changes the inferred interval', () => {
    // Two-hour bars now; hourly history outnumbers them, so the inferred slot width halves.
    const recent = Array.from({ length: 40 }, (_, i) => bar(i * 2));
    const { chart } = setup(recent, { timeScale: { continuous: true } }, 400);
    chart.scale.scrollBy(4);
    const right = chart.scale.visibleRange().to - 1;
    const x = chart.scale.indexToX(right);
    const spacing = chart.scale.barSpacing();
    chart.prependData(bars(-100, 0));
    close(chart.scale.indexToX(right + 100), x, 1e-6);
    assert.equal(chart.scale.barSpacing(), spacing, 'zoom is untouched');
    // One old bar interval now spans two slots.
    close(chart.scale.indexToX(right + 100) - chart.scale.indexToX(right + 99), spacing * 2, 1e-6);
    chart.destroy();
  });
});

describe('drawing UI across prepends', () => {
  it('keeps points being placed on their bars', () => {
    const { chart } = setup(bars(0, 300));
    const controller = new DrawingController(chart);
    const y = chart.scale.priceToY(100);
    const x0 = chart.scale.indexToX(250), x1 = chart.scale.indexToX(270);
    controller.arm('trendline');
    controller.pointerDown(x0, y);
    controller.pointerUp(x0, y); // first point placed
    chart.prependData(bars(-60, 0));
    chart.appendData({ ...bar(299), close: 99 }); // other loads leave the points alone
    controller.pointerDown(x1, y);
    controller.pointerUp(x1, y);
    const drawing = chart.getConfig().drawings.at(-1)!;
    assert.deepEqual(drawing.points.map((p) => p.index), [310, 330]);
    close(chart.scale.indexToX(310), x0);
    chart.destroy();
  });

  it('keeps a freehand stroke in progress on its bars', () => {
    const { chart } = setup(bars(0, 300));
    const controller = new DrawingController(chart);
    const y = chart.scale.priceToY(100);
    const x0 = chart.scale.indexToX(240), x1 = chart.scale.indexToX(260);
    controller.arm('brush');
    controller.pointerDown(x0, y);
    chart.prependData(bars(-10, 0));
    controller.pointerMove(x1, y);
    controller.pointerUp(x1, y);
    const points = chart.getConfig().drawings.at(-1)!.points;
    close(points[0]!.index, 250, 1e-6);
    close(points.at(-1)!.index, 270, 1e-6);
    chart.destroy();
  });

  it('leaves anchored tools and idle modes alone', () => {
    const { chart } = setup(bars(0, 300));
    const controller = new DrawingController(chart);
    controller.arm('anchored-text');
    chart.prependData(bars(-5, 0));
    assert.deepEqual(controller.points, []);
    controller.arm(ZOOM_TOOL);
    chart.prependData(bars(-10, -5));
    controller.disarm();
    chart.prependData(bars(-15, -10));
    assert.deepEqual(controller.points, []);
    assert.equal(chart.dataLength, 315);
    chart.destroy();
  });

  it('undo and redo restore drawings on the bars they were drawn on', () => {
    const { chart } = setup(bars(0, 300));
    const controller = new DrawingController(chart);
    const { history } = controller;
    const line = chart.addDrawing({ id: 'line', name: 'trendline', points: [{ index: 10, price: 100 }, { index: 20, price: 110 }] });
    chart.addDrawing({ id: 'pin', name: 'anchored-text', points: [{ index: 0.25, price: 0.5 }], text: 'x' });
    history.checkpoint();
    chart.moveDrawingPoint(line, 0, { index: 15, price: 100 });
    chart.prependData(bars(-50, 0));
    chart.appendData(bar(300)); // not a prepend: snapshots stay
    controller.undo();
    assert.deepEqual(chart.getDrawing('line')!.points, [{ index: 60, price: 100 }, { index: 70, price: 110 }]);
    assert.deepEqual(chart.getDrawing('pin')!.points, [{ index: 0.25, price: 0.5 }]);
    chart.prependData(bars(-60, -50));
    controller.redo();
    assert.deepEqual(chart.getDrawing('line')!.points, [{ index: 75, price: 100 }, { index: 80, price: 110 }]);
    assert.deepEqual(chart.getDrawing('pin')!.points, [{ index: 0.25, price: 0.5 }]);
    chart.destroy();
  });
});

class Frames implements FrameScheduler {
  time = 0;
  seq = 0;
  callbacks = new Map<number, (time: number) => void>();
  now = () => this.time;
  request = (callback: (time: number) => void) => {
    const id = ++this.seq;
    this.callbacks.set(id, callback);
    return id;
  };
  cancel = (id: number) => { this.callbacks.delete(id); };
  tick(ms = 16) {
    this.time += ms;
    for (const [id, callback] of [...this.callbacks]) if (this.callbacks.delete(id)) callback(this.time);
  }
  settle() {
    for (let i = 0; i < 200 && this.callbacks.size > 0; i++) this.tick();
    assert.equal(this.callbacks.size, 0, 'the animation settled');
  }
}

/** X of the latest bar: where a right-anchored viewport sits, whatever history is loaded. */
const latestX = (chart: Chart) => chart.scale.indexToX(chart.dataLength - 1);

describe('navigation animations across prepends', () => {
  it('a smooth scroll (page arrows, fling) runs to its target when history lands mid-way', () => {
    for (const prepend of [false, true]) {
      const { chart } = setup(bars(0, 300));
      const frames = new Frames();
      const scroll = new SmoothScroll(chart, frames);
      const spacing = chart.scale.barSpacing();
      const start = latestX(chart);
      const x150 = chart.scale.indexToX(150);
      scroll.scrollBy(100);
      frames.tick(); frames.tick();
      if (prepend) assert.equal(chart.prependData(bars(-500, 0)), 500);
      frames.settle();
      close(latestX(chart), start + 100 * spacing, 1e-6);
      // The same candle moved by exactly the scrolled distance.
      close(chart.scale.indexToX(prepend ? 650 : 150), x150 + 100 * spacing, 1e-6);
      chart.destroy();
    }
  });

  it('keeps a scroll that outruns the loaded history going into history that lands mid-way', () => {
    const run = (prepend: boolean) => {
      const { chart } = setup(bars(0, 300));
      const frames = new Frames();
      const scroll = new SmoothScroll(chart, frames, { duration: 700 });
      const spacing = chart.scale.barSpacing();
      const start = latestX(chart);
      scroll.scrollBy(400); // more than the ~180 bars left of the viewport
      frames.tick(); frames.tick();
      if (prepend) chart.prependData(bars(-500, 0));
      const moved: number[] = [];
      let x = latestX(chart);
      while (frames.callbacks.size > 0) {
        frames.tick();
        moved.push(latestX(chart) - x);
        x = latestX(chart);
      }
      const result = { bars: (latestX(chart) - start) / spacing, from: chart.scale.visibleRange().from, moved };
      chart.destroy();
      return result;
    };
    const stuck = run(false);
    assert.equal(stuck.from, 0, 'without new history it stops at the first bar');
    assert.ok(stuck.bars < 200);
    const loaded = run(true);
    close(loaded.bars, 400, 1e-6);
    assert.ok(loaded.from > 0);
    // It eases on from where it was: every frame moves toward history, none jumps a page.
    assert.ok(loaded.moved.every((dx) => dx >= 0 && dx < 60 * 6), loaded.moved.join());
  });

  it('keeps scrolling when a live bar opens, and stops when the data shrinks under it', () => {
    const { chart } = setup(bars(0, 300));
    const frames = new Frames();
    const scroll = new SmoothScroll(chart, frames);
    const spacing = chart.scale.barSpacing();
    const start = latestX(chart);
    scroll.scrollBy(50);
    frames.tick();
    chart.appendData(bar(300));
    frames.settle();
    close(latestX(chart), start + 50 * spacing, 1e-6);

    scroll.scrollBy(50);
    frames.tick();
    chart.setData(bars(0, 20)); // a right-anchored viewport stays put, with no history left of it
    const x = latestX(chart);
    frames.tick();
    assert.equal(frames.callbacks.size, 0);
    assert.equal(latestX(chart), x);
    chart.destroy();
  });

  it('a smooth zoom keeps easing, about the same candle, when history lands mid-zoom', () => {
    for (const continuous of [false, true]) {
      const results = [false, true].map((prepend) => {
        const recent = [...bars(0, 100), ...bars(130, 330)];
        const { chart } = setup(recent, continuous ? { timeScale: { continuous: true, intervalMs: HOUR * 1000 } } : {});
        const frames = new Frames();
        const zoom = new SmoothZoom(chart.scale, frames);
        const spacing = chart.scale.barSpacing();
        const anchor = 400;
        const under = chart.scale.xToIndex(anchor);
        zoom.zoomBy(0.4, anchor);
        frames.tick(); frames.tick();
        if (prepend) assert.equal(chart.prependData([...bars(-600, -300), ...bars(-200, 0)]), 500);
        frames.settle();
        close(chart.scale.barSpacing(), spacing * 0.4, 1e-9);
        close(chart.scale.indexToX(under + (prepend ? 500 : 0)), anchor, 1e-6);
        const right = latestX(chart);
        chart.destroy();
        return right;
      });
      close(results[1]!, results[0]!, 1e-6);
    }
  });

  it('still yields to a real viewport change after a prepend', () => {
    const { chart } = setup(bars(0, 300));
    const frames = new Frames();
    const zoom = new SmoothZoom(chart.scale, frames);
    const scroll = new SmoothScroll(chart, frames);
    zoom.zoomBy(2, 400);
    frames.tick();
    chart.prependData(bars(-50, 0));
    chart.scale.scrollBy(3);
    const spacing = chart.scale.barSpacing();
    frames.tick();
    assert.equal(chart.scale.barSpacing(), spacing, 'the zoom yielded');
    scroll.scrollBy(40);
    frames.tick();
    chart.prependData(bars(-60, -50));
    chart.scale.zoom(1.5);
    const x = latestX(chart);
    frames.settle();
    assert.equal(latestX(chart), x, 'the scroll yielded');
    chart.destroy();
  });
});

const windows: Window[] = [];
after(() => {
  for (const w of windows) void w.happyDOM.close();
});

describe('drawing UI teardown', () => {
  /** Data-load listeners on the chart. */
  const listeners = (chart: Chart) => (chart as unknown as { events: { dataLoad: { size: number } } }).events.dataLoad.size;

  it('a disposed controller and its history stop following prepends', () => {
    const { chart } = setup(bars(0, 300));
    const base = listeners(chart);
    const controller = new DrawingController(chart);
    assert.equal(listeners(chart), base + 2);
    chart.addDrawing({ id: 'line', name: 'trendline', points: [{ index: 10, price: 100 }, { index: 20, price: 110 }] });
    controller.history.checkpoint();
    chart.removeDrawing('line');
    const y = chart.scale.priceToY(100);
    controller.arm('trendline');
    controller.pointerDown(chart.scale.indexToX(250), y);
    controller.pointerUp(chart.scale.indexToX(250), y);
    const placing = controller.points.map((p) => p.index);
    controller.dispose();
    assert.equal(listeners(chart), base);
    chart.prependData(bars(-40, 0));
    assert.deepEqual(controller.points.map((p) => p.index), placing, 'points being placed no longer shift');
    controller.disarm();
    controller.undo();
    assert.deepEqual(chart.getDrawing('line')!.points.map((p) => p.index), [10, 20], 'snapshots no longer shift');
    chart.destroy();
  });

  it('destroying a toolbar leaves no data-load listeners on a chart that lives on', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: bars(0, 200) } });
    const base = listeners(chart);
    for (let i = 0; i < 3; i++) {
      const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
      windows.push(win);
      const doc = win.document;
      const rail = doc.createElement('div');
      const stage = doc.createElement('div');
      const canvas = doc.createElement('div');
      stage.append(canvas);
      doc.body.append(rail, stage);
      const toolbar = createDrawingToolbar({
        chart,
        document: doc as unknown as UIDocument,
        canvas: canvas as unknown as UIElement,
        rail: rail as unknown as UIElement,
        overlay: stage as unknown as UIElement,
        scheduler: new Frames(),
      });
      assert.ok(listeners(chart) > base);
      toolbar.destroy();
      assert.equal(listeners(chart), base, `after toolbar ${i + 1}`);
    }
    assert.equal(chart.prependData(bars(-10, 0)), 10);
    chart.destroy();
  });
});
