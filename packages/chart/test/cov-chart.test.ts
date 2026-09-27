import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../dist/index.js';
import { MockDocument, type ChartCanvas } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 5) * 10;
    return { time: 1700000000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
  });
}

describe('Chart coverage: render branch gaps', () => {
  it('formats drawing prices with an explicit priceAxis precision', () => {
    // Renders a fib drawing while priceAxis.precision is a number, so the
    // view's formatPrice falls to the price.toFixed(...) formatter.
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data: candles(50), priceAxis: { precision: 2 } } });
    chart.addDrawing({ name: 'fib', points: [{ index: 5, price: 95 }, { index: 40, price: 110 }] });
    chart.render();
    const ctx = doc.created[0]?.context;
    assert.ok(ctx !== undefined && ctx.callsNamed('fillText').some((c) => /0\.618 \(\d+\.\d{2}\)/.test(String(c[1]))));
    chart.destroy();
  });
  it('measures the price axis against an empty store when precision is set', () => {
    // store.last() is undefined, so the magnitude scan takes the `?? 0` fallback.
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: [], priceAxis: { precision: 2 } } });
    assert.equal(chart.dataLength, 0);
    chart.render();
    chart.destroy();
  });
  it('locks the price-to-bar ratio from the current ratio when none is configured', () => {
    // lockPriceToBarRatio with no configured ratio and no previously locked
    // ratio falls through to `this.lockedRatio ?? currentRatio`.
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(30), priceAxis: { lockPriceToBarRatio: true } } });
    assert.equal(chart.getConfig().priceAxis.lockPriceToBarRatio, true);
    chart.render();
    chart.destroy();
  });
  it('returns a price-to-bar ratio of 1 while no main price scale exists', () => {
    // A canvas without a 2D context never renders, so mainPriceScale stays null.
    const noCtx = { width: 640, height: 480, getContext: () => null } as unknown as ChartCanvas;
    const chart = createChart({ container: noCtx, config: { wasm: false, data: candles(5) } });
    assert.equal(chart.scale.priceToBarRatio(), 1);
    assert.ok(Number.isNaN(chart.scale.yToPrice(10)));
    assert.ok(Number.isNaN(chart.scale.priceToY(100)));
    chart.destroy();
  });
});
