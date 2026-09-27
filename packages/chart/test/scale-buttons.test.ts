import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type Element, type HTMLElement } from 'happy-dom';
import { MockContext2D, createChart, type Candle, type ChartCanvas, type LayoutChangeEvent } from '../dist/index.js';
import { ChartEvents } from '../dist/core/chart-events.js';
import { Crosshair } from '../dist/core/crosshair.js';
import { DataStore } from '../dist/core/data.js';
import { TimeScale } from '../dist/core/scale.js';
import {
  BLOXWAP_HEADER_TOKENS,
  SCALE_TOGGLES,
  createChartHeader,
  createScaleButtons,
  scaleToggleState,
  syncScaleToggles,
  toggleScale,
  type ScaleButtonsOptions,
  type UIDocument,
  type UIElement,
} from '../dist/ui/index.js';

const data: Candle[] = Array.from({ length: 40 }, (_, i) => ({ time: 1_700_000_000 + i * 60, open: 100 + i, high: 104 + i, low: 98 + i, close: 102 + i }));
const windows: Window[] = [];
after(() => { for (const win of windows) void win.happyDOM.close(); });

type Observer = { callback: () => void; targets: unknown[]; disconnected: boolean };

function mount(options: Partial<Omit<ScaleButtonsOptions, 'chart' | 'document' | 'overlay'>> = {}, resizeObserver = true) {
  const win = new Window({ url: 'http://localhost/' });
  windows.push(win);
  const observers: Observer[] = [];
  Object.defineProperty(win, 'ResizeObserver', {
    configurable: true,
    value: resizeObserver ? class {
      record: Observer;
      constructor(callback: () => void) { this.record = { callback, targets: [], disconnected: false }; observers.push(this.record); }
      observe(target: unknown) { this.record.targets.push(target); }
      disconnect() { this.record.disconnected = true; }
    } : undefined,
  });
  const doc = win.document;
  const canvas: ChartCanvas = { width: 640, height: 400, getContext: () => new MockContext2D() };
  const chart = createChart({ container: canvas, config: { wasm: false, data } });
  const overlay = doc.createElement('div');
  Object.defineProperty(overlay, 'clientWidth', { configurable: true, value: 640 });
  doc.body.append(overlay);
  const buttons = createScaleButtons({ chart, document: doc as unknown as UIDocument, overlay: overlay as unknown as UIElement, ...options });
  const root = buttons.element as unknown as HTMLElement;
  const box = () => [root.style.left, root.style.top, root.style.width, root.style.height];
  const btn = (letter: string) => [...root.querySelectorAll('.cts-scale-btn')].find((b) => b.textContent === letter) as unknown as HTMLElement;
  const pressed = () => [...root.querySelectorAll('.cts-scale-btn')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
  const click = (node: Element) => node.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  return { win, doc, chart, canvas, overlay, buttons, root, box, btn, pressed, click, observers };
}

describe('scale toggle state', () => {
  it('maps the price axis to pressed toggles; indexed presses neither % nor Log', () => {
    assert.deepEqual(scaleToggleState({ autoScale: true, mode: 'regular' }), { auto: true, percent: false, log: false });
    assert.deepEqual(scaleToggleState({ autoScale: false, mode: 'percent' }), { auto: false, percent: true, log: false });
    assert.deepEqual(scaleToggleState({ autoScale: true, mode: 'logarithmic' }), { auto: true, percent: false, log: true });
    assert.deepEqual(scaleToggleState({ autoScale: true, mode: 'indexed' }), { auto: true, percent: false, log: false });
    assert.deepEqual(SCALE_TOGGLES.map((t) => [t.key, t.label, t.short]), [['auto', 'Auto', 'A'], ['percent', '%', '%'], ['log', 'Log', 'L']]);
  });

  it('toggleScale edits the config on a chart with no buttons', () => {
    const canvas: ChartCanvas = { width: 320, height: 200, getContext: () => new MockContext2D() };
    const chart = createChart({ container: canvas, config: { wasm: false, data, priceAxis: { lockPriceToBarRatio: true } } });
    syncScaleToggles(chart);
    toggleScale(chart, 'percent');
    assert.equal(chart.getConfig().priceAxis.mode, 'percent');
    assert.equal(chart.getConfig().priceAxis.priceToBarRatio, null);
    toggleScale(chart, 'log');
    assert.equal(chart.getConfig().priceAxis.mode, 'logarithmic', '% and Log are mutually exclusive');
    toggleScale(chart, 'log');
    assert.equal(chart.getConfig().priceAxis.mode, 'regular');
    toggleScale(chart, 'auto');
    assert.equal(chart.getConfig().priceAxis.autoScale, false);
    toggleScale(chart, 'auto');
    assert.equal(chart.getConfig().priceAxis.autoScale, true);
  });
});

describe('on-chart scale buttons', () => {
  it('sits at the foot of the right price axis, above the time axis', () => {
    const m = mount();
    assert.equal(m.root.parentElement, m.overlay);
    assert.ok(m.root.classList.contains('cts-theme') && m.root.classList.contains('cts-scale-buttons'));
    assert.equal(m.root.getAttribute('aria-label'), 'Price scale');
    assert.deepEqual([...m.root.children].map((b) => b.textContent), ['A', '%', 'L']);
    assert.deepEqual([...m.root.children].map((b) => b.getAttribute('title')), ['Auto (fits data to screen)', 'Percent scale', 'Logarithmic scale']);
    const plot = m.chart.plotArea;
    assert.deepEqual(plot, { left: 0, width: 576, height: 376 });
    assert.deepEqual(m.box(), ['576px', '0px', '64px', '376px'], 'covers the axis column down to the time axis');
    assert.equal(m.root.style.display, '');
    assert.deepEqual(m.pressed(), ['A']);
    m.buttons.destroy();
  });

  it('follows the axis to the left side and back, with no refresh', () => {
    const m = mount();
    m.chart.updateConfig({ priceAxis: { position: 'left' } });
    assert.deepEqual(m.box(), ['0px', '0px', '64px', '376px']);
    m.chart.updateConfig({ priceAxis: { position: 'right' } });
    assert.deepEqual(m.box(), ['576px', '0px', '64px', '376px']);
    m.buttons.destroy();
  });

  it('tracks sub-panes, the time axis, resizes and the axis visibility, with no refresh', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'rsi', pane: 'sub' });
    const main = m.chart.plotArea.height;
    assert.ok(main < 376, 'main pane shrinks for the sub-pane');
    assert.equal(m.root.style.height, `${main}px`, 'stays on the main pane scale, off the RSI axis');
    m.chart.removeIndicator(id);
    assert.equal(m.root.style.height, '376px', 'grows back when the sub-pane goes');
    m.chart.updateConfig({ timeAxis: { visible: false } });
    assert.equal(m.root.style.height, '400px', 'runs to the bottom without a time axis');
    m.chart.updateConfig({ timeAxis: { visible: true } });
    m.chart.resize(640, 250);
    assert.deepEqual(m.box(), ['576px', '0px', '64px', '226px'], 'a height-only resize re-places them');
    Object.defineProperty(m.overlay, 'clientWidth', { configurable: true, value: 800 });
    m.chart.resize(800, 500);
    assert.deepEqual(m.box(), ['736px', '0px', '64px', '476px'], 'a canvas resize re-measures the host');
    m.root.style.left = '1px';
    m.chart.scale.scrollBy(3);
    m.chart.scale.zoom(1.2);
    m.chart.updateConfig({ series: { type: 'line' } });
    assert.equal(m.root.style.left, '1px', 'scrolls, zooms and unrelated config never rewrite the styles');
    Object.defineProperty(m.overlay, 'clientWidth', { configurable: true, value: 900 });
    const observer = m.observers.find((o) => o.targets.includes(m.overlay))!;
    observer.callback();
    assert.deepEqual(m.box(), ['736px', '0px', '164px', '476px'], 'the resize observer re-measures the host');
    m.chart.updateConfig({ priceAxis: { visible: false } });
    assert.equal(m.root.style.display, 'none');
    m.chart.updateConfig({ priceAxis: { visible: true } });
    assert.equal(m.root.style.display, '');
    assert.equal(m.root.style.left, '736px');
    m.buttons.destroy();
    assert.ok(observer.disconnected);
  });

  it('hides when the chart has no layout yet', () => {
    const m = mount();
    const empty = createChart({ container: { width: 0, height: 0, getContext: () => null }, config: { wasm: false } });
    const b = createScaleButtons({ chart: empty, document: m.doc as unknown as UIDocument, overlay: m.overlay as unknown as UIElement });
    assert.equal((b.element as unknown as HTMLElement).style.display, 'none');
    b.destroy();
    m.buttons.destroy();
  });

  it('offsets by the canvas position inside the overlay', () => {
    const win = new Window();
    windows.push(win);
    const canvasEl = win.document.createElement('canvas');
    Object.defineProperty(canvasEl, 'getBoundingClientRect', { value: () => ({ left: 60, top: 40, right: 700, bottom: 440, width: 640, height: 400 }) });
    Object.defineProperty(canvasEl, 'clientWidth', { value: 640 });
    const m = mount({ canvas: canvasEl as unknown as UIElement });
    Object.defineProperty(m.overlay, 'getBoundingClientRect', { value: () => ({ left: 10, top: 10, right: 800, bottom: 500, width: 790, height: 490 }) });
    m.buttons.refresh();
    assert.deepEqual(m.box(), ['626px', '30px', '64px', '376px']);
    assert.ok(m.observers[0]!.targets.includes(canvasEl), 'observes the canvas');
    m.buttons.destroy();
  });

  it('toggles the scale, and every group on the chart follows', () => {
    const m = mount();
    const host = m.doc.createElement('div');
    m.doc.body.append(host);
    const header = createChartHeader({ chart: m.chart, document: m.doc as unknown as UIDocument, container: host as unknown as UIElement });
    const headerPressed = () => [...m.doc.querySelectorAll('.cts-header-scale-btn')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
    m.click(m.btn('L'));
    assert.equal(m.chart.getConfig().priceAxis.mode, 'logarithmic');
    assert.deepEqual(m.pressed(), ['A', 'L']);
    assert.deepEqual(headerPressed(), ['Auto', 'Log'], 'the header follows the on-chart buttons');
    m.click(m.doc.querySelectorAll('.cts-header-scale-btn')[1]!);
    assert.equal(m.chart.getConfig().priceAxis.mode, 'percent');
    assert.deepEqual(m.pressed(), ['A', '%'], 'the on-chart buttons follow the header');
    m.chart.updateConfig({ priceAxis: { mode: 'regular', autoScale: false } });
    assert.deepEqual(m.pressed(), [], 'outside config changes show after the render');
    assert.deepEqual(headerPressed(), []);
    m.chart.batch(() => {
      m.chart.updateConfig({ priceAxis: { mode: 'logarithmic' } });
      assert.deepEqual(m.pressed(), [], 'a batch defers the render');
      syncScaleToggles(m.chart);
      assert.deepEqual(m.pressed(), ['L'], 'syncScaleToggles updates every group at once');
      assert.deepEqual(headerPressed(), ['Log']);
    });
    m.chart.updateConfig({ priceAxis: { mode: 'regular' } });
    header.destroy();
    m.click(m.btn('A'));
    assert.equal(m.chart.getConfig().priceAxis.autoScale, true, 'still works after the header is gone');
    m.buttons.destroy();
    m.click(m.btn('%'));
    assert.equal(m.chart.getConfig().priceAxis.mode, 'regular', 'destroyed buttons do nothing');
    assert.equal(m.root.parentElement, null);
    m.chart.resize(900, 500);
    assert.equal(m.root.style.width, '64px', 'no longer placed after destroy');
    m.chart.updateConfig({ priceAxis: { mode: 'logarithmic' } });
    assert.deepEqual(m.pressed(), ['A'], 'destroyed buttons stop following');
    syncScaleToggles(m.chart);
    assert.deepEqual(m.pressed(), ['A'], 'or syncing');
  });

  it('themes, tokens and works without ResizeObserver', () => {
    const m = mount({ theme: 'light', tokens: BLOXWAP_HEADER_TOKENS }, false);
    assert.equal(m.observers.length, 0);
    assert.ok(m.root.classList.contains('cts-light'));
    assert.equal(m.root.style.getPropertyValue('--cts-header-accent'), '#00ff3f');
    assert.equal(m.root.style.left, '576px', 'tokens keep the placement styles');
    m.buttons.setTheme('dark');
    assert.ok(!m.root.classList.contains('cts-light'));
    m.buttons.destroy();
  });
});

describe('chart.subscribeLayoutChange', () => {
  function chartWith(width = 640, height = 400) {
    const canvas: ChartCanvas = { width, height, getContext: () => new MockContext2D() };
    return createChart({ container: canvas, config: { wasm: false, data } });
  }

  it('fires after renders that change the geometry or the config, never on scroll, zoom or pointer moves', () => {
    const chart = chartWith();
    const seen: LayoutChangeEvent[] = [];
    const off = chart.subscribeLayoutChange((e) => seen.push(e));
    chart.scale.scrollBy(4);
    chart.scale.zoom(1.5);
    chart.setCrosshair(100, 100);
    chart.appendData({ time: data.at(-1)!.time + 60, open: 1, high: 2, low: 0.5, close: 1.5 });
    assert.equal(seen.length, 0);
    chart.updateConfig({ priceAxis: { mode: 'percent' } });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.config, chart.getConfig());
    assert.deepEqual({ ...seen[0]!, config: null }, { width: 640, height: 400, plotLeft: 0, plotWidth: 576, plotHeight: 376, config: null });
    chart.updateConfig({ priceAxis: { position: 'left' } });
    assert.equal(seen.at(-1)!.plotLeft, 64);
    chart.addIndicator({ name: 'rsi', pane: 'sub' });
    assert.ok(seen.at(-1)!.plotHeight < 376, 'a sub-pane shrinks the main pane');
    assert.equal(seen.at(-1)!.config, seen.at(-2)!.config, 'the config object is the same; the geometry moved');
    chart.resize(800, 300);
    assert.deepEqual([seen.at(-1)!.width, seen.at(-1)!.height], [800, 300]);
    const count = seen.length;
    chart.batch(() => {
      chart.updateConfig({ priceAxis: { mode: 'regular' } });
      chart.updateConfig({ priceAxis: { inverted: true } });
    });
    assert.equal(seen.length, count + 1, 'a batch emits once');
    off();
    chart.updateConfig({ priceAxis: { inverted: false } });
    assert.equal(seen.length, count + 1, 'unsubscribed');
    chart.destroy();
  });

  it('diffs from the state at subscription, and a listener that changes the layout supersedes the event', () => {
    const chart = chartWith();
    chart.updateConfig({ priceAxis: { mode: 'percent' } });
    const first: string[] = [];
    const second: string[] = [];
    chart.subscribeLayoutChange((e) => {
      first.push(e.config.priceAxis.position);
      if (e.config.priceAxis.position === 'right') chart.updateConfig({ priceAxis: { position: 'left' } });
    });
    chart.subscribeLayoutChange((e) => second.push(e.config.priceAxis.position));
    chart.render();
    assert.deepEqual(first, [], 'nothing changed since subscribing');
    chart.updateConfig({ priceAxis: { mode: 'regular' } });
    assert.deepEqual(first, ['right', 'left']);
    assert.deepEqual(second, ['left'], 'the stale event stops; everyone gets the fresh one');
    chart.destroy();
    chart.updateConfig({ priceAxis: { mode: 'percent' } });
    assert.deepEqual(first, ['right', 'left'], 'destroyed charts stay silent');
  });

  it('stays silent for an event host that reports no layout', () => {
    const events = new ChartEvents({ store: new DataStore(), timeScale: new TimeScale(6, 600), crosshair: new Crosshair(), plotLeft: () => 0, panes: () => [] });
    const seen: LayoutChangeEvent[] = [];
    events.subscribeLayoutChange((e) => seen.push(e));
    events.flush();
    assert.equal(seen.length, 0);
    events.dispose();
    assert.equal(events.layoutChange.size, 0, 'dispose drops layout listeners');
  });
});
