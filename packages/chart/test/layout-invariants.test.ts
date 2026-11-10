import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../dist/index.js';
import { MockDocument } from '../dist/dom.js';

describe('canvas size and pixelRatio', () => {
  it('rejects a non-positive or non-finite pixelRatio and a bad CSS size (#93)', () => {
    for (const pixelRatio of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.throws(() => createChart({ document: new MockDocument(), pixelRatio, config: { wasm: false } }), /invalid pixelRatio/);
    }
    assert.throws(() => createChart({ document: new MockDocument(), config: { wasm: false, width: Number.NaN } }), /invalid width/);
    assert.throws(() => createChart({ document: new MockDocument(), config: { wasm: false, height: -1 } }), /invalid height/);
    assert.throws(() => createChart({ document: new MockDocument(), config: { wasm: false, priceAxis: { width: Number.NaN } } }), /invalid priceAxis\.width/);
    assert.throws(() => createChart({ document: new MockDocument(), config: { wasm: false, timeAxis: { height: Number.POSITIVE_INFINITY } } }), /invalid timeAxis\.height/);

    const doc = new MockDocument();
    const chart = createChart({ document: doc, pixelRatio: 2, config: { wasm: false, width: 100, height: 80 } });
    const canvas = doc.created[0]!;
    assert.equal(canvas.width, 200);
    const plot = chart.plotArea;
    assert.throws(() => chart.resize(800, 400, 0), /invalid pixelRatio 0/);
    assert.throws(() => chart.resize(800, 400, Number.POSITIVE_INFINITY), /invalid pixelRatio Infinity/);
    assert.throws(() => chart.resize(Number.NaN, 400), /invalid chart width/);
    assert.throws(() => chart.resize(800, -1), /invalid chart height/);
    assert.equal(canvas.width, 200);
    assert.deepEqual(chart.plotArea, plot);
    assert.ok(Number.isFinite(chart.scale.xToIndex(40)));

    chart.resize(0, 0);
    assert.equal(canvas.width, 0);
    chart.resize(50, 40);
    assert.equal(canvas.width, 100);
    assert.equal(canvas.height, 80);

    assert.throws(() => chart.updateConfig({ width: Number.NaN }), /invalid width/);
    assert.throws(() => chart.updateConfig({ height: Number.NEGATIVE_INFINITY }), /invalid height/);
    assert.throws(() => chart.updateConfig({ priceAxis: { width: -4 } }), /invalid priceAxis\.width/);
    assert.throws(() => chart.updateConfig({ timeAxis: { height: Number.NaN } }), /invalid timeAxis\.height/);
    assert.equal(chart.getConfig().width, 100);
    assert.equal(chart.getConfig().height, 80);
    chart.updateConfig({ width: 120, priceAxis: { mode: 'logarithmic' }, timeAxis: { tickCount: 4 } });
    chart.updateConfig({ height: 90, priceAxis: { width: 48 }, timeAxis: { height: 20 } });
    assert.equal(chart.getConfig().width, 120);
    assert.equal(chart.getConfig().height, 90);
    assert.equal(chart.getConfig().priceAxis.width, 48);
    assert.equal(chart.getConfig().timeAxis.height, 20);
    assert.equal(chart.getConfig().priceAxis.mode, 'logarithmic');
    chart.destroy();
  });
});

describe('time scale scroll offset', () => {
  it('keeps the visible range finite when scroll input is not (#94)', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: Array.from({ length: 80 }, (_, i) => ({ time: 1_700_000_000 + i * 60, open: 10, high: 12, low: 9, close: 11 })) } });
    chart.scale.scrollBy(3);
    const range = chart.scale.visibleRange();
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      chart.scale.scrollBy(bad);
      chart.scale.scrollTo(bad);
      chart.scale.zoomToRange(bad, 10);
      chart.scale.zoomToRange(4, bad);
    }
    assert.deepEqual(chart.scale.visibleRange(), range);
    assert.ok(Number.isFinite(range.from) && Number.isFinite(range.to));
    chart.destroy();
  });
});
