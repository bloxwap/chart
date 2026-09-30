import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../dist/index.js';
import { MockDocument } from '../dist/dom.js';
import { createSeriesRegistry } from '../dist/series/index.js';
import type { Candle } from '../dist/core/data.js';
import type { PrimitiveDrawTarget } from '../dist/render/primitive.js';

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    time: 1700000000 + i * 3600,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: 1000 + i,
  }));
}

describe('SeriesRegistry', () => {
  it('pre-loads the built-in renderers', () => {
    const registry = createSeriesRegistry();
    for (const type of ['candlestick', 'line', 'area', 'bar', 'histogram', 'heikin-ashi', 'hollow-candlestick']) {
      assert.ok(registry.has(type), type);
    }
    assert.equal(registry.names().length, 7);
  });

  it('starts empty without built-ins and supports register/unregister', () => {
    const registry = createSeriesRegistry(false);
    assert.equal(registry.names().length, 0);
    const draw = (): void => {};
    assert.equal(registry.register('custom', draw), registry);
    assert.equal(registry.get('custom'), draw);
    assert.ok(registry.has('custom'));
    assert.deepEqual(registry.names(), ['custom']);
    assert.ok(registry.unregister('custom'));
    assert.equal(registry.get('custom'), undefined);
    assert.ok(!registry.unregister('custom'));
  });
});

describe('Chart.registerSeries', () => {
  it('draws a custom series type through the registered function', () => {
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: candles(20), width: 640, height: 400, series: { type: 'stairs' } },
    });
    const seen: { candles: number; from: number; to: number }[] = [];
    chart.registerSeries('stairs', (_ctx, data, range) => {
      seen.push({ candles: data.length, from: range.from, to: range.to });
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.candles, 20);
    assert.ok(seen[0]!.to > seen[0]!.from);
    chart.destroy();
  });

  it('ignores an unregistered series type instead of throwing', () => {
    assert.doesNotThrow(() => {
      const chart = createChart({
        document: new MockDocument(),
        config: { wasm: false, data: candles(5), series: { type: 'no-such-type' } },
      });
      chart.destroy();
    });
  });

  it('keeps drawing built-in types without registration', () => {
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: candles(10), series: { type: 'line' } },
    });
    assert.ok(chart.seriesRenderers.has('line'));
    chart.destroy();
  });
});

describe('Chart.addPane', () => {
  it('stacks a host pane between the main pane and sub-panes', () => {
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: candles(20), width: 640, height: 400 },
    });
    chart.addIndicator({ name: 'rsi' });
    const pane = chart.addPane({ id: 'host', weight: 1 });
    assert.equal(pane.id, 'host');
    // plotHeight 376, weights 3:1:1 → main 225, host 75, rsi 76 (remainder).
    assert.equal(chart.paneAt(10), 'main');
    assert.equal(chart.paneAt(226), 'host');
    const hostPaneBottom = 225 + 75;
    assert.equal(chart.paneAt(hostPaneBottom + 1), chart.getConfig().indicators[0]!.id);
    assert.throws(() => chart.addPane({ id: 'host' }), /duplicate pane/);
    chart.destroy();
  });

  it('scales a stacked pane with its autoscale callback', () => {
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: candles(20), width: 640, height: 400 },
    });
    const pane = chart.addPane({ id: 'host', autoscale: () => ({ min: 10, max: 20 }) });
    const seen: PrimitiveDrawTarget[] = [];
    pane.attachPrimitive({ draw: (_ctx, t) => { seen.push(t); } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.priceScale.minPrice, 10);
    assert.equal(seen[0]!.priceScale.maxPrice, 20);
    chart.destroy();
  });

  it('shares the main pane price scale when asked', () => {
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: candles(20), width: 640, height: 400 },
    });
    const mainSeen: PrimitiveDrawTarget[] = [];
    chart.attachPrimitive({ draw: (_ctx, t) => { mainSeen.push(t); } });
    const pane = chart.addPane({ id: 'host', sharePriceScale: true });
    const hostSeen: PrimitiveDrawTarget[] = [];
    pane.attachPrimitive({ draw: (_ctx, t) => { hostSeen.push(t); } });
    assert.ok(mainSeen.length > 0 && hostSeen.length > 0);
    assert.equal(hostSeen[0]!.priceScale.minPrice, mainSeen[0]!.priceScale.minPrice);
    assert.equal(hostSeen[0]!.priceScale.maxPrice, mainSeen[0]!.priceScale.maxPrice);
    chart.destroy();
  });

  it('docks a pane at the canvas edge and shrinks the plot', () => {
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: candles(20), width: 640, height: 400 },
    });
    const fullWidth = chart.plotArea.width;
    const left = chart.addPane({ id: 'book', placement: 'left', width: 120 });
    assert.equal(chart.plotArea.left, 120);
    assert.equal(chart.plotArea.width, fullWidth - 120);
    const leftSeen: PrimitiveDrawTarget[] = [];
    left.attachPrimitive({ draw: (_ctx, t) => { leftSeen.push(t); } });
    assert.equal(leftSeen.length, 1);
    assert.equal(leftSeen[0]!.width, 120);
    assert.equal(leftSeen[0]!.height, 376);
    const right = chart.addPane({ id: 'depth', placement: 'right', width: 100 });
    assert.equal(chart.plotArea.width, fullWidth - 220);
    assert.equal(chart.plotArea.left, 120);
    const rightSeen: PrimitiveDrawTarget[] = [];
    right.attachPrimitive({ draw: (_ctx, t) => { rightSeen.push(t); } });
    assert.equal(rightSeen.length, 1);
    assert.equal(rightSeen[0]!.width, 100);
    right.setWidth(60);
    assert.equal(chart.plotArea.width, fullWidth - 180);
    chart.destroy();
  });

  it('defaults to a sequential stacked pane and re-lays out on setWeight', () => {
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: candles(20), width: 640, height: 400 },
    });
    const pane = chart.addPane();
    assert.equal(pane.id, 'pane-1');
    assert.equal(chart.addPane().id, 'pane-2');
    chart.removePane('pane-2');
    // plotHeight 376, weights 3:1 → main 282.
    assert.equal(chart.paneAt(250), 'main');
    pane.setWeight(3);
    // weights 3:3 → main 188.
    assert.equal(chart.paneAt(250), 'pane-1');
    chart.destroy();
  });

  it('removes panes by handle or id and restores the plot', () => {
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: candles(20), width: 640, height: 400 },
    });
    const fullWidth = chart.plotArea.width;
    const pane = chart.addPane({ id: 'depth', placement: 'right', width: 100 });
    pane.remove();
    assert.equal(chart.plotArea.width, fullWidth);
    chart.addPane({ id: 'again', placement: 'right', width: 100 });
    assert.ok(chart.removePane('again'));
    assert.ok(!chart.removePane('again'));
    assert.equal(chart.plotArea.width, fullWidth);
    chart.destroy();
  });
});

describe('pane primitives', () => {
  it('draws behind and above passes on the main pane with per-frame invalidation', () => {
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: candles(20), width: 640, height: 400 },
    });
    const calls: string[] = [];
    chart.attachPrimitive({ zOrder: 'behind', draw: () => { calls.push('behind'); } });
    const above = chart.attachPrimitive({ draw: () => { calls.push('above'); } });
    assert.deepEqual(calls, ['behind', 'behind', 'above']);
    above.requestUpdate();
    assert.deepEqual(calls, ['behind', 'behind', 'above', 'behind', 'above']);
    above.detach();
    assert.deepEqual(calls, ['behind', 'behind', 'above', 'behind', 'above', 'behind']);
    chart.destroy();
  });

  it('gives main-pane primitives the pane geometry and scales', () => {
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: candles(20), width: 640, height: 400 },
    });
    const seen: PrimitiveDrawTarget[] = [];
    chart.attachPrimitive({ draw: (_ctx, t) => { seen.push(t); } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.width, chart.plotArea.width);
    assert.equal(seen[0]!.height, chart.plotArea.height);
    assert.equal(seen[0]!.candles.length, 20);
    assert.ok(seen[0]!.priceScale.maxPrice > seen[0]!.priceScale.minPrice);
    chart.destroy();
  });

  it('detaches a stacked pane primitive without touching the pane', () => {
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: candles(20), width: 640, height: 400 },
    });
    const pane = chart.addPane({ id: 'host' });
    let count = 0;
    const handle = pane.attachPrimitive({ draw: () => { count++; } });
    assert.equal(count, 1);
    handle.requestUpdate();
    assert.equal(count, 2);
    handle.detach();
    assert.equal(count, 2);
    handle.requestUpdate();
    assert.equal(count, 2);
    assert.equal(chart.paneAt(chart.plotArea.height + 1), 'host');
    chart.destroy();
  });
});
