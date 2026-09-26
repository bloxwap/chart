import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, LINE_STYLE_DASH, WEAK_MAGNET_PX } from '../dist/index.js';
import { MockCanvas, MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 5) * 10;
    return { time: 1700000000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
  });
}

function setup(n = 50) {
  const doc = new MockDocument();
  const chart = createChart({ document: doc, config: { wasm: false, data: candles(n) } });
  return { chart, ctx: doc.created[0]!.context };
}

describe('drawing management', () => {
  it('stores defaults, normalizes points, updates and clears', () => {
    const { chart } = setup();
    const id = chart.addDrawing({ name: 'long-position', points: [{ index: 10, price: 100 }, { index: 20, price: 110 }] });
    const d = chart.getDrawing(id)!;
    assert.equal(d.points.length, 3);
    assert.deepEqual([d.color, d.lineWidth, d.lineStyle, d.text, d.image, d.locked], ['#2962ff', 1, 'solid', '', null, false]);
    assert.equal(chart.updateDrawing(id, { color: '#f00', text: 'hi', lineStyle: 'dotted' }), true);
    assert.equal(chart.getDrawing(id)!.color, '#f00');
    assert.equal(chart.updateDrawing('nope', {}), false);
    chart.addDrawing({ name: 'text', points: [{ index: 5, price: 100 }], text: 'note', lineStyle: 'dashed', locked: true, image: null });
    assert.equal(chart.clearDrawings(), 2);
    assert.equal(chart.getConfig().drawings.length, 0);
    assert.throws(() => chart.getDrawing('x') ?? chart.addDrawing({ name: 'bogus', points: [] }), /unknown drawing/);
    chart.destroy();
  });
  it('exposes the line style dash table', () => {
    assert.equal(LINE_STYLE_DASH.solid, undefined);
    assert.deepEqual(LINE_STYLE_DASH.dashed, [6, 4]);
  });
  it('hides all drawings and skips them in hit tests', () => {
    const { chart, ctx } = setup();
    const id = chart.addDrawing({ name: 'hline', points: [{ index: 5, price: 100 }] });
    const y = chart.scale.priceToY(100);
    assert.equal(chart.drawingAt(100, y), id);
    chart.setDrawingsHidden(true);
    assert.equal(chart.drawingsHidden, true);
    assert.equal(chart.drawingAt(100, y), null);
    const before = ctx.countCalls('clip');
    chart.render();
    assert.equal(ctx.countCalls('clip'), before + 1); // only the main series clip, no drawing clip
    chart.setDrawingsHidden(false);
    assert.equal(chart.drawingAt(100, y), id);
    chart.updateDrawing(id, { visible: false });
    assert.equal(chart.drawingAt(100, y), null);
    chart.destroy();
  });
});

describe('selection, handles and editing', () => {
  it('selects, reports handles, moves points and translates', () => {
    const { chart, ctx } = setup();
    const id = chart.addDrawing({ name: 'trendline', points: [{ index: 10, price: 100 }, { index: 30, price: 105 }] });
    chart.selectDrawing('missing');
    assert.equal(chart.selectedDrawing, null);
    assert.equal(chart.handleAt(0, 0), -1);
    chart.selectDrawing(id);
    assert.equal(chart.selectedDrawing, id);
    const hx = chart.scale.indexToX(30);
    const hy = chart.scale.priceToY(105);
    assert.equal(chart.handleAt(hx, hy), 1);
    assert.equal(chart.handleAt(hx + 50, hy), -1);
    // Handles paint as small ellipses.
    assert.ok(ctx.callsNamed('ellipse').some((c) => c[3] === 4.5));

    assert.equal(chart.moveDrawingPoint(id, 1, { index: 35, price: 106 }), true);
    assert.deepEqual(chart.getDrawing(id)!.points[1], { index: 35, price: 106 });
    assert.equal(chart.moveDrawingPoint(id, 5, { index: 1, price: 1 }), false);
    assert.equal(chart.moveDrawingPoint('nope', 0, { index: 1, price: 1 }), false);

    const before = chart.getDrawing(id)!.points[0]!;
    assert.equal(chart.translateDrawing(id, chart.scale.indexToX(12) - chart.scale.indexToX(10), 0), true);
    const after = chart.getDrawing(id)!.points[0]!;
    assert.ok(Math.abs(after.index - before.index - 2) < 1e-9);
    assert.ok(Math.abs(after.price - before.price) < 1e-9);
    assert.equal(chart.translateDrawing('nope', 1, 1), false);

    chart.removeDrawing(id);
    assert.equal(chart.selectedDrawing, null);
    chart.destroy();
  });
  it('removing an unselected drawing keeps the selection', () => {
    const { chart } = setup();
    const a = chart.addDrawing({ name: 'hline', points: [{ index: 1, price: 100 }] });
    const b = chart.addDrawing({ name: 'hline', points: [{ index: 1, price: 101 }] });
    chart.selectDrawing(a);
    chart.removeDrawing(b);
    assert.equal(chart.selectedDrawing, a);
    chart.selectDrawing(null);
    assert.equal(chart.selectedDrawing, null);
    chart.destroy();
  });
  it('anchored drawings convert through screen fractions', () => {
    const { chart } = setup();
    const p = chart.pointFromPixel(368, 238, 'anchored-note');
    assert.deepEqual(p, { index: 0.5, price: 0.5 });
    const id = chart.addDrawing({ name: 'anchored-note', points: [p] });
    chart.selectDrawing(id);
    assert.equal(chart.handleAt(368, 238), 0);
    chart.translateDrawing(id, 36.8, 0);
    assert.ok(Math.abs(chart.getDrawing(id)!.points[0]!.index - 0.55) < 1e-9);
    // Non-anchored names and unknown names use data coordinates.
    assert.notDeepEqual(chart.pointFromPixel(368, 238, 'trendline'), p);
    assert.notDeepEqual(chart.pointFromPixel(368, 238, 'unknown'), p);
    chart.destroy();
  });
  it('anchored conversion is zero before layout', () => {
    const chart = createChart({ container: new MockCanvas(0, 0), config: { wasm: false, data: candles(5) } });
    assert.deepEqual(chart.pointFromPixel(10, 10, 'anchored-text'), { index: 0, price: 0 });
    chart.destroy();
  });
  it('drawingAt returns the topmost hit', () => {
    const { chart } = setup();
    const a = chart.addDrawing({ name: 'rect', points: [{ index: 10, price: 95 }, { index: 30, price: 105 }] });
    const b = chart.addDrawing({ name: 'rect', points: [{ index: 15, price: 97 }, { index: 25, price: 103 }] });
    const x = chart.scale.indexToX(20);
    const y = chart.scale.priceToY(100);
    assert.equal(chart.drawingAt(x, y), b);
    chart.removeDrawing(b);
    assert.equal(chart.drawingAt(x, y), a);
    assert.equal(chart.drawingAt(1, 1), null);
    chart.destroy();
  });
});

describe('drawing view', () => {
  it('gives custom models the inverse price mapping', () => {
    const { chart } = setup();
    let seen = NaN;
    chart.drawings.register({
      name: 'probe',
      minPoints: 1,
      geometry: (_pts, view) => {
        seen = view.yToPrice!(view.priceToY(101));
        return [];
      },
    });
    chart.addDrawing({ name: 'probe', points: [{ index: 1, price: 1 }] });
    assert.ok(Math.abs(seen - 101) < 1e-9);
    chart.destroy();
  });
});

describe('draft preview', () => {
  it('renders a draft with handles and clears it', () => {
    const { chart, ctx } = setup();
    chart.setDraft({ name: 'trendline', points: [{ index: 10, price: 100 }, { index: 20, price: 104 }] });
    const handles = ctx.callsNamed('ellipse').filter((c) => c[3] === 4.5).length;
    assert.equal(handles, 2);
    chart.setDraft({ name: 'text', points: [{ index: 10, price: 100 }], color: '#f0f', lineWidth: 2, lineStyle: 'dashed', text: 'Draft' });
    assert.ok(ctx.callsNamed('fillText').some((c) => c[1] === 'Draft'));
    chart.setDraft({ name: 'trendline', points: [{ index: 10, price: 100 }] }); // too few points: skipped
    chart.setDraft({ name: 'unknown', points: [] });
    chart.setDraft(null);
    chart.destroy();
  });
});

describe('magnet snapping', () => {
  it('strong snaps to the nearest OHLC; weak only when close; off is raw', () => {
    const { chart } = setup();
    const data = candles(50);
    const bar = data[20]!;
    const x = chart.scale.indexToX(20.3);
    const nearHigh = chart.scale.priceToY(bar.high) + 3;
    assert.deepEqual(chart.snapPoint(x, nearHigh, 'strong'), { index: 20, price: bar.high });
    assert.deepEqual(chart.snapPoint(x, nearHigh, 'weak'), { index: 20, price: bar.high });
    const far = chart.scale.priceToY(bar.high) - WEAK_MAGNET_PX * 3;
    const weakFar = chart.snapPoint(x, far, 'weak');
    assert.equal(weakFar.index, 20);
    assert.notEqual(weakFar.price, bar.high);
    const off = chart.snapPoint(x, far, 'off');
    assert.ok(Math.abs(off.index - 20.3) < 1e-9);
    // Clamped to the dataset edges.
    assert.equal(chart.snapPoint(chart.scale.indexToX(80), nearHigh, 'strong').index, 49);
    chart.destroy();
  });
  it('returns the raw point without data', () => {
    const { chart } = setup(0);
    const p = chart.snapPoint(10, 10, 'strong');
    assert.ok(Number.isFinite(p.index));
    chart.destroy();
  });
});

describe('zoomToRange', () => {
  it('fits the requested bars edge to edge', () => {
    const { chart } = setup(200);
    chart.scale.zoomToRange(150, 100);
    const r = chart.scale.visibleRange();
    assert.ok(r.from <= 100 && r.from >= 98, `from ${r.from}`);
    assert.equal(r.to, 151);
    chart.destroy();
  });
  it('keeps spacing when the viewport is empty', async () => {
    const { TimeScale } = await import('../dist/core/scale.js');
    const ts = new TimeScale(6, 0);
    ts.fitRange(10, 20, 100);
    assert.equal(ts.barSpacing, 6);
    assert.equal(ts.scrollOffset, 79);
  });
});

describe('crosshair modes', () => {
  it('draws dot, demonstration halo, or nothing for arrow', () => {
    for (const [mode, ellipses] of [['dot', 1], ['demonstration', 2], ['arrow', 0]] as const) {
      const doc = new MockDocument();
      const chart = createChart({ document: doc, config: { wasm: false, data: candles(20), crosshair: { mode } } });
      const ctx = doc.created[0]!.context;
      const before = ctx.countCalls('ellipse');
      const dashes = ctx.countCalls('setLineDash');
      chart.setCrosshair(100, 50);
      assert.equal(ctx.countCalls('ellipse') - before, ellipses, mode);
      assert.equal(ctx.countCalls('setLineDash'), dashes, mode);
      chart.destroy();
    }
  });
});
