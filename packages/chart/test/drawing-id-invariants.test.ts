import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, type Chart } from '../dist/index.js';
import { MockDocument } from '../dist/dom.js';

function chart(): Chart {
  return createChart({
    document: new MockDocument(),
    config: {
      wasm: false,
      data: Array.from({ length: 30 }, (_, i) => ({ time: 1_700_000_000 + i * 60, open: 10, high: 12, low: 9, close: 11 })),
    },
  });
}

describe('drawing points', () => {
  it('rejects non-finite points and too few points before changing the chart (#95)', () => {
    const c = chart();
    assert.throws(() => c.addDrawing({ id: 'sp', name: 'signpost', points: [{ index: Number.NaN, price: 100 }] }), /index and price must be finite/);
    assert.throws(() => c.addDrawing({ name: 'hline', points: [{ index: 1, price: Number.POSITIVE_INFINITY }] }), /index and price must be finite/);
    assert.throws(() => c.addDrawing({ name: 'long-position', points: [] }), /long-position" needs at least 1 point$/);
    assert.throws(() => c.addDrawing({ name: 'trendline', points: [{ index: 1, price: 1 }] }), /trendline" needs at least 2 points$/);
    assert.deepEqual(c.getConfig().drawings, []);
    c.setData(c.getData().slice());
    c.render();

    const id = c.addDrawing({ name: 'hline', points: [{ index: 2, price: 11 }] });
    assert.throws(() => c.updateDrawing(id, { points: [{ index: Number.NaN, price: 11 }] }), /must be finite/);
    assert.throws(() => c.moveDrawingPoint(id, 0, { index: 2, price: Number.NaN }), /must be finite/);
    assert.deepEqual(c.getDrawing(id)?.points, [{ index: 2, price: 11 }]);
    assert.equal(c.updateDrawing('missing', { color: '#fff' }), false);
    c.destroy();

    assert.throws(() => createChart({
      document: new MockDocument(),
      config: { wasm: false, drawings: [{ id: 'sp', name: 'signpost', points: [{ index: Number.NaN, price: 1 }], color: '#fff', lineWidth: 1, lineStyle: 'solid', text: '', image: null, locked: false, visible: true }] },
    }), /must be finite/);
    const ghost = createChart({
      document: new MockDocument(),
      config: { wasm: false, drawings: [{ id: 'g', name: 'custom-model', points: [{ index: 1, price: 2 }], color: '#fff', lineWidth: 1, lineStyle: 'solid', text: '', image: null, locked: false, visible: true }] },
    });
    assert.equal(ghost.getConfig().drawings.length, 1);
    ghost.destroy();
  });
});

describe('indicator and drawing ids', () => {
  it('rejects duplicate ids and indicator ids that collide with panes (#96)', () => {
    const c = chart();
    c.addIndicator({ id: 'x', name: 'sma', params: { period: 1 } });
    assert.throws(() => c.addIndicator({ id: 'x', name: 'sma', params: { period: 2 } }), /duplicate indicator "x"/);
    assert.equal(c.getConfig().indicators.length, 1);
    assert.throws(() => c.addIndicator({ id: 'main', name: 'rsi' }), /indicator id "main" collides with a pane/);
    c.addPane({ id: 'book' });
    assert.throws(() => c.addIndicator({ id: 'book', name: 'rsi' }), /indicator id "book" collides with a pane/);
    c.addIndicator({ id: 'study', name: 'ema' });
    assert.throws(() => c.addPane({ id: 'study' }), /pane id "study" collides with a pane/);
    assert.throws(() => c.addPane({ id: 'main' }), /pane id "main" collides with a pane/);

    c.addDrawing({ id: 'd', name: 'hline', points: [{ index: 1, price: 11 }] });
    assert.throws(() => c.addDrawing({ id: 'd', name: 'hline', points: [{ index: 2, price: 12 }] }), /duplicate drawing "d"/);
    assert.equal(c.getConfig().drawings.length, 1);
    c.updateDrawing('d', { color: '#f00' });
    assert.equal(c.getDrawing('d')?.color, '#f00');

    assert.throws(() => c.updateConfig({
      indicators: [
        { id: 'a', name: 'sma', params: {}, pane: 'main', colors: [], visible: true },
        { id: 'a', name: 'sma', params: {}, pane: 'main', colors: [], visible: true },
      ],
    }), /duplicate indicator "a"/);
    assert.equal(c.getConfig().indicators.length, 2);
    assert.throws(() => c.updateConfig({
      drawings: [
        { id: 'd', name: 'hline', points: [{ index: 1, price: 1 }], color: '#fff', lineWidth: 1, lineStyle: 'solid', text: '', image: null, locked: false, visible: true },
        { id: 'd', name: 'hline', points: [{ index: 2, price: 2 }], color: '#fff', lineWidth: 1, lineStyle: 'solid', text: '', image: null, locked: false, visible: true },
      ],
    }), /duplicate drawing "d"/);
    assert.equal(c.getConfig().drawings.length, 1);
    c.destroy();

    assert.throws(() => createChart({
      document: new MockDocument(),
      config: {
        wasm: false,
        indicators: [
          { id: 'main', name: 'sma', params: {}, pane: 'sub', colors: [], visible: true },
        ],
      },
    }), /indicator id "main" collides with a pane/);
  });
});
