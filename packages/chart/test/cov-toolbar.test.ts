import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createChart, type FrameScheduler } from '../dist/index.js';
import { MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import { createDrawingToolbar, type UIDocument, type UIElement } from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => {
  for (const w of windows) void w.happyDOM.close();
});

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 5) * 10;
    return { time: 1700000000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
  });
}

class TestFrames implements FrameScheduler {
  time = 0;
  seq = 0;
  callbacks = new Map<number, (time: number) => void>();
  now = () => this.time;
  request = (callback: (time: number) => void) => { const id = ++this.seq; this.callbacks.set(id, callback); return id; };
  cancel = (id: number) => { this.callbacks.delete(id); };
  tick(ms = 16) {
    this.time += ms;
    for (const [id, callback] of [...this.callbacks]) if (this.callbacks.delete(id)) callback(this.time);
  }
}

function mount(chartConfig: Record<string, unknown> = {}) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const doc = win.document;
  const rail = doc.createElement('div');
  const stage = doc.createElement('div');
  const canvas = doc.createElement('div');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 500 } });
  stage.append(canvas);
  doc.body.append(rail, stage);
  const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(200), ...chartConfig } });
  const frames = new TestFrames();
  const tb = createDrawingToolbar({
    chart,
    document: doc as unknown as UIDocument,
    canvas: canvas as unknown as UIElement,
    rail: rail as unknown as UIElement,
    overlay: stage as unknown as UIElement,
    scheduler: frames,
  });
  const key = (init: Record<string, unknown> = {}) => {
    const e = new win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    doc.dispatchEvent(e);
    return e;
  };
  const move = (x: number, y: number) => {
    canvas.dispatchEvent(new win.PointerEvent('pointermove', { clientX: x, clientY: y, button: 0, pointerType: 'mouse', bubbles: true, cancelable: true }));
    frames.tick();
  };
  const plus = () => doc.querySelector('.cts-price-plus') as unknown as { style: { display: string; left: string }; click(): void };
  return { win, doc, canvas, chart, tb, frames, key, move, plus };
}

describe('toolbar alt key axis shortcuts', () => {
  it('Alt+I toggles the price axis inversion', () => {
    const m = mount();
    assert.equal(m.chart.getConfig().priceAxis.inverted, false);
    const e = m.key({ key: 'i', code: 'KeyI', altKey: true });
    assert.equal(e.defaultPrevented, true);
    assert.equal(m.chart.getConfig().priceAxis.inverted, true);
    m.key({ key: 'i', code: 'KeyI', altKey: true });
    assert.equal(m.chart.getConfig().priceAxis.inverted, false);
  });

  it('Alt+P toggles percent scale mode on and off', () => {
    const m = mount();
    assert.equal(m.chart.getConfig().priceAxis.mode, 'regular');
    m.key({ key: 'p', code: 'KeyP', altKey: true });
    assert.equal(m.chart.getConfig().priceAxis.mode, 'percent');
    m.key({ key: 'p', code: 'KeyP', altKey: true });
    assert.equal(m.chart.getConfig().priceAxis.mode, 'regular');
  });

  it('Alt+L toggles logarithmic scale mode on and off', () => {
    const m = mount();
    m.key({ key: 'l', code: 'KeyL', altKey: true });
    assert.equal(m.chart.getConfig().priceAxis.mode, 'logarithmic');
    m.key({ key: 'l', code: 'KeyL', altKey: true });
    assert.equal(m.chart.getConfig().priceAxis.mode, 'regular');
  });

  it('Alt with an unmapped key falls through without touching the axis', () => {
    const m = mount();
    const e = m.key({ key: 'x', code: 'KeyX', altKey: true });
    assert.equal(m.chart.getConfig().priceAxis.mode, 'regular');
    assert.equal(m.chart.getConfig().priceAxis.inverted, false);
    assert.equal(e.defaultPrevented, false);
  });

  it('Alt+I with metaKey set skips the axis shortcuts', () => {
    const m = mount();
    m.key({ key: 'i', code: 'KeyI', altKey: true, metaKey: true });
    assert.equal(m.chart.getConfig().priceAxis.inverted, false);
    m.key({ key: 'i', code: 'KeyI', altKey: true, ctrlKey: true });
    assert.equal(m.chart.getConfig().priceAxis.inverted, false);
  });

  it('derives the shortcut from e.key when e.code is missing', () => {
    const m = mount();
    const e = new m.win.KeyboardEvent('keydown', { key: 'i', altKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'code', { value: undefined });
    m.doc.dispatchEvent(e);
    assert.equal(m.chart.getConfig().priceAxis.inverted, true);
  });

  it('tolerates a missing e.key when e.code is missing', () => {
    const m = mount();
    const e = new m.win.KeyboardEvent('keydown', { altKey: true, bubbles: true, cancelable: true });
    Object.defineProperty(e, 'code', { value: undefined });
    Object.defineProperty(e, 'key', { value: undefined });
    m.doc.dispatchEvent(e);
    assert.equal(m.chart.getConfig().priceAxis.inverted, false);
    assert.equal(m.chart.getConfig().priceAxis.mode, 'regular');
  });
});

describe('toolbar price axis plus button', () => {
  it('shows the plus button over the right axis and adds a price line on click', () => {
    const m = mount({ priceAxis: { plusButton: true } });
    const plot = m.chart.plotArea;
    m.move(plot.width + 10, 100);
    assert.equal(m.plus().style.display, 'block');
    assert.equal(m.plus().style.left, `${plot.width + 2}px`);
    m.plus().click();
    assert.equal(m.chart.getConfig().drawings.length, 1);
    assert.equal(m.chart.getConfig().drawings[0]!.name, 'hline');
    assert.ok(m.chart.selectedDrawing !== null);
  });

  it('hides the plus button near the plot top, bottom, and off the axis', () => {
    const m = mount({ priceAxis: { plusButton: true } });
    const plot = m.chart.plotArea;
    m.move(plot.width + 10, 5);
    assert.equal(m.plus().style.display, 'none');
    m.move(plot.width + 10, plot.height - 5);
    assert.equal(m.plus().style.display, 'none');
    m.move(plot.width - 50, 100);
    assert.equal(m.plus().style.display, 'none');
  });

  it('positions the plus button against a left-side price axis', () => {
    const m = mount({ priceAxis: { plusButton: true, position: 'left' } });
    const plot = m.chart.plotArea;
    m.move(Math.max(0, plot.left - 5), 100);
    assert.equal(m.plus().style.display, 'block');
    assert.equal(m.plus().style.left, `${plot.left - 26}px`);
    m.move(plot.left + 50, 100);
    assert.equal(m.plus().style.display, 'none');
  });

  it('keeps the plus button hidden when the price axis is hidden', () => {
    const m = mount({ priceAxis: { plusButton: true, visible: false } });
    const plot = m.chart.plotArea;
    m.move(plot.width + 10, 100);
    assert.equal(m.plus().style.display, 'none');
    m.tb.refreshViewport();
    assert.equal(m.plus().style.display, 'none');
  });

  it('ignores plus clicks before hovering the axis or with the feature off', () => {
    const cold = mount();
    cold.plus().click();
    assert.equal(cold.chart.getConfig().drawings.length, 0);

    const m = mount({ priceAxis: { plusButton: true } });
    m.move(m.chart.plotArea.width + 10, 100);
    assert.equal(m.plus().style.display, 'block');
    m.chart.updateConfig({ priceAxis: { plusButton: false } });
    m.plus().click();
    assert.equal(m.chart.getConfig().drawings.length, 0);
  });
});
