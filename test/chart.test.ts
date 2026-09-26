import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, version } from '../dist/index.js';
import { MockCanvas, MockDocument, type ChartCanvas, type Canvas2DLike } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import type { IndicatorDef } from '../dist/indicators/index.js';
import type { DrawingDef } from '../dist/drawings/index.js';

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 5) * 10;
    return { time: 1700000000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
  });
}

describe('createChart', () => {
  it('exposes a version', () => {
    assert.equal(version, '0.1.0');
  });
  it('throws without a container or document', () => {
    assert.throws(() => createChart({}), /inject a container/);
  });
  it('creates a canvas from an injected document', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { data: candles(50), width: 640, height: 400 } });
    assert.equal(doc.created.length, 1);
    assert.equal(doc.created[0]?.width, 640);
    assert.equal(chart.dataLength, 50);
    assert.ok(doc.created[0] !== undefined && doc.created[0].context.calls.length > 100);
    chart.destroy();
  });
  it('uses an injected container canvas directly', () => {
    const canvas = new MockCanvas(300, 200);
    const chart = createChart({ container: canvas, config: { data: candles(10) } });
    assert.ok(canvas.context.calls.length > 10);
    chart.destroy();
  });
  it('renders scalar-first, then re-renders when wasm arrives', async () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { data: candles(30) } });
    const before = doc.created[0]?.context.calls.length ?? 0;
    await chart.ready;
    const after = doc.created[0]?.context.calls.length ?? 0;
    assert.ok(after > before);
    chart.destroy();
  });
  it('wasm:false resolves ready immediately', async () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false } });
    assert.equal(await chart.ready, chart);
    chart.destroy();
  });
});

describe('Chart API', () => {
  it('setData replaces data and appendData updates the last candle', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(10) } });
    chart.setData(candles(5));
    assert.equal(chart.dataLength, 5);
    chart.appendData({ time: 1700000000 + 5 * 3600, open: 1, high: 2, low: 0, close: 1.5, volume: 7 });
    assert.equal(chart.dataLength, 6);
    chart.appendData({ time: 1700000000 + 5 * 3600, open: 1, high: 2, low: 0, close: 42 });
    assert.equal(chart.dataLength, 6);
    chart.destroy();
  });
  it('updateConfig deep-merges and applies new data', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false } });
    chart.updateConfig({ series: { type: 'line' }, data: candles(3) });
    assert.equal(chart.getConfig().series.type, 'line');
    assert.equal(chart.dataLength, 3);
    chart.updateConfig({ series: { type: 'area' } });
    assert.equal(chart.getConfig().series.type, 'area');
    chart.destroy();
  });
  it('addIndicator validates names, generates ids, and renders sub-panes', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(60) } });
    assert.throws(() => chart.addIndicator({ name: 'nope' }), /unknown indicator/);
    const id1 = chart.addIndicator({ name: 'sma', params: { period: 5 } });
    const id2 = chart.addIndicator({ name: 'macd' });
    const id3 = chart.addIndicator({ name: 'vol', id: 'my-vol', colors: ['#111', '#222'] });
    assert.equal(id1, 'ind-1');
    assert.equal(id2, 'ind-2');
    assert.equal(id3, 'my-vol');
    assert.equal(chart.getConfig().indicators.length, 3);
    // macd created a sub-pane → two pane separators.
    const strokes = doc.created[0]?.context.countCalls('stroke') ?? 0;
    assert.ok(strokes > 10);
    assert.equal(chart.removeIndicator(id2), true);
    assert.equal(chart.removeIndicator(id2), false);
    assert.equal(chart.getConfig().indicators.length, 2);
    chart.destroy();
  });
  it('respects indicator pane override to main', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(30) } });
    chart.addIndicator({ name: 'rsi', pane: 'main' });
    assert.equal(chart.getConfig().indicators[0]?.pane, 'main');
    chart.destroy();
  });
  it('supports custom registered indicators end-to-end', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(10) } });
    const custom: IndicatorDef = {
      name: 'double-close',
      defaultParams: { factor: 2 },
      defaultColors: ['#000'],
      defaultPane: 'main',
      compute(cs, params, colors) {
        return {
          pane: 'main',
          lines: [
            { key: 'value', values: cs.map((c) => c.close * (params['factor'] ?? 1)), color: colors[0] ?? '#000' },
          ],
        };
      },
    };
    chart.indicators.register(custom);
    const id = chart.addIndicator({ name: 'double-close' });
    assert.ok(id.startsWith('ind-'));
    chart.destroy();
  });
  it('addDrawing validates names and renders primitives', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(50) } });
    assert.throws(() => chart.addDrawing({ name: 'nope', points: [] }), /unknown drawing/);
    const id = chart.addDrawing({ name: 'trendline', points: [{ index: 5, price: 95 }, { index: 40, price: 110 }] });
    chart.addDrawing({ name: 'fib', points: [{ index: 5, price: 95 }, { index: 40, price: 110 }], color: '#f0f', lineWidth: 2 });
    chart.addDrawing({ name: 'rect', points: [{ index: 10, price: 95 }, { index: 30, price: 105 }], visible: false });
    assert.equal(chart.getConfig().drawings.length, 3);
    const ctx = doc.created[0]?.context;
    assert.ok(ctx !== undefined && ctx.callsNamed('fillText').some((c) => c[1] === '0.618'));
    assert.equal(chart.removeDrawing(id), true);
    assert.equal(chart.removeDrawing('nope'), false);
    chart.destroy();
  });
  it('skips drawings with too few points or unregistered leftovers', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(10) } });
    chart.addDrawing({ name: 'trendline', points: [{ index: 1, price: 100 }] });
    chart.getConfig().drawings.push({ id: 'x', name: 'ghost', points: [], color: '#000', lineWidth: 1, visible: true });
    chart.render();
    chart.destroy();
  });
  it('handles ghost indicators and all-null sub-pane outputs', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(10) } });
    // Unregistered name left in config: skipped at render time.
    chart.getConfig().indicators.push({ id: 'ghost', name: 'ghost', params: {}, pane: 'sub', colors: [], visible: true });
    // RSI with a period longer than the data: all-null output → default sub-pane range.
    chart.addIndicator({ name: 'rsi', params: { period: 500 } });
    // Main-pane indicator with all-null values does not disturb autoscale.
    chart.addIndicator({ name: 'sma', params: { period: 500 } });
    chart.render();
    assert.ok((doc.created[0]?.context.calls.length ?? 0) > 10);
    chart.destroy();
  });
  it('supports custom registered drawings', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(10) } });
    const dot: DrawingDef = {
      name: 'dot',
      minPoints: 1,
      geometry: (points, view) =>
        points.map((p) => ({ type: 'text' as const, text: '•', x: view.indexToX(p.index), y: view.priceToY(p.price) })),
    };
    chart.drawings.register(dot);
    chart.addDrawing({ name: 'dot', points: [{ index: 2, price: 101 }] });
    assert.equal(chart.getConfig().drawings.length, 1);
    chart.destroy();
  });
  it('resize changes the canvas and re-renders', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(10) } });
    const before = doc.created[0]?.context.calls.length ?? 0;
    chart.resize(1024, 768);
    assert.equal(doc.created[0]?.width, 1024);
    assert.ok((doc.created[0]?.context.calls.length ?? 0) > before);
    chart.destroy();
  });
  it('resize applies the pixel ratio to the backing store (CSS px contract)', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(10) } });
    chart.resize(400, 300, 2);
    assert.equal(doc.created[0]?.width, 800);
    assert.equal(doc.created[0]?.height, 600);
    chart.resize(400, 300, 1.5);
    assert.equal(doc.created[0]?.width, 600);
    assert.equal(doc.created[0]?.height, 450);
    chart.resize(320, 240, 1); // explicit override back to 1
    assert.equal(doc.created[0]?.width, 320);
    assert.equal(doc.created[0]?.height, 240);
    chart.destroy();
  });
  it('resize keeps the stored ratio when pixelRatio is omitted', () => {
    const doc = new MockDocument();
    const chart = createChart({
      document: doc,
      config: { wasm: false, width: 200, height: 100, data: candles(10) },
      pixelRatio: 2,
    });
    assert.equal(doc.created[0]?.width, 400);
    chart.resize(300, 200); // ratio persists
    assert.equal(doc.created[0]?.width, 600);
    assert.equal(doc.created[0]?.height, 400);
    assert.ok(doc.created[0]?.context.calls.some((c) => c[0] === 'scale' && c[1] === 2 && c[2] === 2));
    chart.destroy();
  });
  it('honors CreateChartOptions.pixelRatio for the initial size and context scale', () => {
    const doc = new MockDocument();
    const chart = createChart({
      document: doc,
      config: { wasm: false, width: 200, height: 100, data: candles(10) },
      pixelRatio: 2,
    });
    assert.equal(doc.created[0]?.width, 400);
    assert.equal(doc.created[0]?.height, 200);
    assert.ok(doc.created[0]?.context.calls.some((c) => c[0] === 'scale' && c[1] === 2 && c[2] === 2));
    chart.destroy();
  });
  it('pixel↔data conversions round-trip at pixelRatio 2 (CSS pixels)', () => {
    const canvas = new MockCanvas(1000, 600); // backing store; CSS size 500x300
    const chart = createChart({ container: canvas, config: { wasm: false, data: candles(100) }, pixelRatio: 2 });
    for (const i of [0, 42, 99]) {
      assert.ok(Math.abs(chart.scale.xToIndex(chart.scale.indexToX(i)) - i) < 1e-9);
    }
    const y = chart.scale.priceToY(105);
    assert.ok(Number.isFinite(y));
    assert.ok(Math.abs(chart.scale.yToPrice(y) - 105) < 1e-9);
    chart.destroy();
  });
  it('scale api scrolls and zooms', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(100), width: 500, height: 300 } });
    const r0 = chart.scale.visibleRange();
    assert.equal(r0.to, 100);
    chart.scale.scrollBy(10);
    assert.ok(chart.scale.visibleRange().to <= 90);
    chart.scale.scrollTo(50);
    assert.equal(chart.scale.visibleRange().to, 51);
    chart.scale.zoom(1.5, 200);
    chart.scale.zoom(0.5);
    assert.ok(chart.scale.visibleRange().to <= 51);
    chart.destroy();
  });
  it('scale api converts pixels to data and back', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(100), width: 500, height: 300 } });
    // x: indexToX and fractional xToIndex are exact inverses.
    for (const i of [0, 42, 99]) {
      const x = chart.scale.indexToX(i);
      assert.ok(Math.abs(chart.scale.xToIndex(x) - i) < 1e-9);
    }
    // Fractional index between bars.
    const mid = chart.scale.xToIndex((chart.scale.indexToX(10) + chart.scale.indexToX(11)) / 2);
    assert.ok(Math.abs(mid - 10.5) < 1e-9);
    // y: priceToY and yToPrice round-trip through the main pane scale.
    const y = chart.scale.priceToY(105);
    assert.ok(Number.isFinite(y));
    assert.ok(Math.abs(chart.scale.yToPrice(y) - 105) < 1e-9);
    chart.destroy();
  });
  it('scale conversion returns NaN before a main pane exists', () => {
    const canvas = new MockCanvas(0, 0);
    const chart = createChart({ container: canvas, config: { wasm: false, data: candles(10) } });
    assert.ok(Number.isNaN(chart.scale.yToPrice(50)));
    assert.ok(Number.isNaN(chart.scale.priceToY(100)));
    chart.destroy();
  });
  it('crosshair set/clear re-renders', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(20) } });
    chart.setCrosshair(100, 50);
    const withCh = doc.created[0]?.context.countCalls('setLineDash') ?? 0;
    assert.ok(withCh > 0);
    chart.clearCrosshair();
    chart.destroy();
  });
  it('destroy stops rendering', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(10) } });
    chart.destroy();
    assert.equal(chart.dataLength, 0);
    const calls = doc.created[0]?.context.calls.length ?? 0;
    chart.render();
    chart.setData(candles(5));
    assert.equal(doc.created[0]?.context.calls.length, calls);
  });
  it('render is a no-op when the canvas has no 2d context', () => {
    const stub: ChartCanvas = {
      width: 100,
      height: 100,
      getContext: (): Canvas2DLike | null => null,
    };
    const chart = createChart({ container: stub, config: { wasm: false, data: candles(5) } });
    chart.render();
    chart.destroy();
  });
  it('accepts injected registries', () => {
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false },
    });
    assert.ok(chart.indicators.has('sma'));
    assert.ok(chart.drawings.has('fib'));
    chart.destroy();
  });
  it('uses caller-provided registries when given', async () => {
    const { createIndicatorRegistry } = await import('../dist/indicators/index.js');
    const { createDrawingRegistry } = await import('../dist/drawings/index.js');
    const indicators = createIndicatorRegistry(false);
    const drawings = createDrawingRegistry(false);
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false },
      registries: { indicators, drawings },
    });
    assert.equal(chart.indicators, indicators);
    assert.equal(chart.drawings, drawings);
    assert.equal(chart.indicators.has('sma'), false);
    chart.destroy();
  });
  it('renders nothing on a zero-size canvas', () => {
    const canvas = new MockCanvas(0, 0);
    const chart = createChart({ container: canvas, config: { wasm: false, data: candles(10) } });
    chart.render();
    // Only the background/watermark layers paint; no panes exist.
    assert.ok(canvas.context.countCalls('fillRect') >= 1);
    chart.destroy();
  });
  it('renders display-p3 series colors straight to the canvas', () => {
    const doc = new MockDocument();
    const chart = createChart({
      document: doc,
      config: {
        wasm: false,
        data: candles(10),
        series: { upColor: 'color(display-p3 0 1 0)', downColor: 'color(display-p3 1 0 0)' },
      },
    });
    chart.render();
    chart.destroy();
    assert.ok(doc.created[0] !== undefined);
  });
  it('renders with both axes hidden', () => {
    const doc = new MockDocument();
    const chart = createChart({
      document: doc,
      config: { wasm: false, data: candles(10), priceAxis: { visible: false }, timeAxis: { visible: false } },
    });
    assert.ok((doc.created[0]?.context.calls.length ?? 0) > 10);
    chart.destroy();
  });
  it('renders an empty dataset', () => {
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false } });
    chart.render();
    assert.ok((doc.created[0]?.context.calls.length ?? 0) >= 1);
    chart.destroy();
  });
});
