import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type HTMLElement, type HTMLInputElement, type HTMLSelectElement } from 'happy-dom';
import {
  MockContext2D,
  MockDocument,
  createChart,
  type Candle,
  type Chart,
  type ChartCanvas,
  type ChartConfig,
  type ConfigChangeEvent,
  type DeepPartial,
} from '../dist/index.js';
import { MAX_EVENT_ROUNDS } from '../dist/core/chart-events.js';
import type { IndicatorDef } from '../dist/indicators/index.js';
import { headerTokensFor, swapTokens } from '../dist/ui/header-styles.js';
import {
  BLOXWAP_HEADER_THEME,
  BLOXWAP_HEADER_TOKENS,
  createChartContextMenu,
  createChartHeader,
  createChartSettings,
  createDrawingToolbar,
  createIndicatorsDialog,
  createScaleButtons,
  type ChartContextMenuOptions,
  type ContextMenuAction,
  type ContextMenuTarget,
  type HeaderTokens,
  type ThemedHeaderTokens,
  type UIDocument,
  type UIElement,
} from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => { for (const win of windows) void win.happyDOM.close(); });

const data: Candle[] = Array.from({ length: 120 }, (_, i) => {
  const base = 100 + Math.sin(i / 6) * 8;
  return { time: 1_700_000_000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 100 + i };
});

/** A sub-pane study that draws nothing, so a right-click anywhere in its pane hits no plot. */
const blank: IndicatorDef = {
  name: 'blank', label: 'Blank pane', shortName: 'BLANK', defaultParams: {}, defaultColors: ['#123456'], defaultPane: 'sub',
  compute: (candles) => ({ pane: 'sub', lines: [{ key: 'blank', values: candles.map(() => NaN), color: '#123456' }] }),
};

function chartOf(config: DeepPartial<ChartConfig> = {}, context: () => MockContext2D | null = () => new MockContext2D()): Chart {
  const canvas: ChartCanvas = { width: 800, height: 500, getContext: context as ChartCanvas['getContext'] };
  const chart = createChart({ container: canvas, config: { wasm: false, data, ...config } });
  chart.indicators.register(blank);
  return chart;
}

/** Records every config event's keys. */
function record(chart: Chart): { keys: (keyof ChartConfig)[][]; off: () => void } {
  const keys: (keyof ChartConfig)[][] = [];
  const off = chart.subscribeConfigChange((e) => keys.push([...e.keys]));
  return { keys, off };
}

describe('Chart.subscribeConfigChange', () => {
  it('names the sections each updateConfig changed, once each, in first-change order', () => {
    const chart = chartOf();
    const seen = record(chart);
    chart.updateConfig({ series: { type: 'line' } });
    chart.updateConfig({ priceAxis: { mode: 'logarithmic' }, timeAxis: { visible: false }, grid: undefined } as unknown as DeepPartial<ChartConfig>);
    chart.resetScale();
    assert.deepEqual(seen.keys, [['series'], ['priceAxis', 'timeAxis'], ['priceAxis']]);
    chart.updateConfig({});
    assert.equal(seen.keys.length, 3, 'an empty partial changes nothing');
  });

  it("reports 'indicators' for added, updated and removed studies, but not for unknown ids", () => {
    const chart = chartOf();
    const seen = record(chart);
    const id = chart.addIndicator({ name: 'rsi' });
    chart.updateIndicator(id, { params: { period: 21 } });
    chart.removeIndicator(id);
    assert.deepEqual(seen.keys, [['indicators'], ['indicators'], ['indicators']]);
    assert.equal(chart.updateIndicator('nope', { visible: false }), false);
    assert.equal(chart.removeIndicator('nope'), false);
    assert.equal(seen.keys.length, 3);
  });

  it("reports 'drawings' for every drawing edit, and for index-based points that prependData moves", () => {
    const chart = chartOf({ data: data.slice(60) });
    const seen = record(chart);
    const id = chart.addDrawing({ name: 'trendline', points: [{ index: 5, price: 100 }, { index: 20, price: 104 }] });
    chart.updateDrawing(id, { color: '#ff0000' });
    chart.moveDrawingPoint(id, 0, { index: 6, price: 101 });
    chart.translateDrawing(id, 5, 5);
    assert.equal(seen.keys.length, 4);
    const before = chart.getDrawing(id)!.points[0]!.index;
    chart.prependData(data.slice(50, 60));
    assert.equal(chart.getDrawing(id)!.points[0]!.index, before + 10, 'the point moved with its bar');
    assert.equal(seen.keys.length, 5);
    chart.removeDrawing(id);
    assert.equal(chart.clearDrawings(), 0);
    assert.equal(seen.keys.length, 6, 'clearing nothing changes nothing');
    // A screen-anchored note stays put through a prepend: nothing to report.
    chart.addDrawing({ name: 'anchored-note', points: [{ index: 0.5, price: 0.5 }], text: 'hi' });
    chart.prependData(data.slice(40, 50));
    assert.equal(seen.keys.length, 7);
    assert.equal(chart.clearDrawings(), 1);
    assert.deepEqual(seen.keys, Array.from({ length: 8 }, () => ['drawings']));
    // Selection, hiding and drafts are not config.
    chart.selectDrawing(null);
    chart.setDrawingsHidden(true);
    chart.setDraft(null);
    assert.equal(seen.keys.length, 8);
  });

  it('delivers once per batch, after the render, with every section the batch changed', () => {
    const chart = chartOf();
    const events: ConfigChangeEvent[] = [];
    let paneAtDelivery: string | null = null;
    let id = '';
    chart.subscribeConfigChange((e) => {
      events.push(e);
      paneAtDelivery = chart.paneAt(chart.plotArea.height + 20);
    });
    chart.batch(() => {
      chart.updateConfig({ series: { type: 'area' } });
      id = chart.addIndicator({ name: 'rsi' });
      chart.updateConfig({ series: { type: 'bar' }, grid: { visible: false } });
      chart.addDrawing({ name: 'trendline', points: [{ index: 1, price: 100 }, { index: 2, price: 101 }] });
      assert.equal(events.length, 0, 'nothing inside the batch');
    });
    assert.deepEqual(events.map((e) => e.keys), [['series', 'indicators', 'grid', 'drawings']]);
    assert.equal(paneAtDelivery, id, 'the new sub-pane is already laid out when listeners hear of it');
  });

  it('delivers data loads first, then config, then layout', () => {
    const chart = chartOf();
    const order: string[] = [];
    chart.subscribeLayoutChange(() => order.push('layout'));
    chart.subscribeConfigChange(() => order.push('config'));
    chart.subscribeDataLoad(() => order.push('data'));
    chart.batch(() => {
      chart.updateConfig({ priceAxis: { position: 'left' } });
      chart.setData(data.slice(10));
    });
    assert.deepEqual(order, ['data', 'config', 'layout']);
  });

  it('records nothing without listeners, and a listener that changes the config gets a fresh event next round', () => {
    const chart = chartOf();
    chart.updateConfig({ grid: { visible: false } });
    const a: (keyof ChartConfig)[][] = [];
    const b: (keyof ChartConfig)[][] = [];
    chart.subscribeConfigChange((e) => {
      a.push([...e.keys]);
      if (e.keys.includes('series')) chart.updateConfig({ crosshair: { mode: 'dot' } });
    });
    chart.subscribeConfigChange((e) => b.push([...e.keys]));
    chart.updateConfig({ series: { type: 'line' } });
    assert.deepEqual(a, [['series'], ['crosshair']], 'the grid change before anyone listened is not reported');
    assert.deepEqual(b, [['series'], ['crosshair']], 'every listener hears the first event before the second');
  });

  it('cuts off a feedback loop and starts fresh, and a throwing listener starves no one', () => {
    const chart = chartOf();
    let calls = 0;
    const off = chart.subscribeConfigChange(() => {
      calls++;
      chart.updateConfig({ grid: { visible: calls % 2 === 0 } });
    });
    chart.updateConfig({ series: { type: 'line' } });
    assert.equal(calls, MAX_EVENT_ROUNDS);
    off();
    const seen = record(chart);
    chart.updateConfig({ watermark: { visible: true } });
    assert.deepEqual(seen.keys, [['watermark']], 'the dropped backlog does not come back');

    const boom = new Error('boom');
    const offBoom = chart.subscribeConfigChange(() => { throw boom; });
    const later = record(chart);
    assert.throws(() => chart.updateConfig({ series: { type: 'bar' } }), boom);
    assert.deepEqual(later.keys, [['series']]);
    offBoom();
    offBoom();
  });

  it('unsubscribes idempotently and clears every listener on destroy', () => {
    const chart = chartOf();
    const seen = record(chart);
    seen.off();
    seen.off();
    chart.updateConfig({ series: { type: 'line' } });
    assert.deepEqual(seen.keys, []);
    const kept = record(chart);
    chart.destroy();
    chart.updateConfig({ series: { type: 'bar' } });
    chart.addIndicator({ name: 'rsi' });
    assert.deepEqual(kept.keys, []);
    kept.off();
  });

  it('delivers on a chart without a 2D context too', () => {
    const chart = chartOf({}, () => null);
    const seen = record(chart);
    chart.addIndicator({ name: 'rsi' });
    assert.deepEqual(seen.keys, [['indicators']]);
  });
});

describe('Chart.paneAt', () => {
  it("names the main pane, a study's sub-pane, or nothing below the panes", () => {
    const chart = chartOf();
    const id = chart.addIndicator({ name: 'rsi' });
    const main = chart.plotArea.height;
    assert.equal(chart.paneAt(0), 'main');
    assert.equal(chart.paneAt(main), 'main', 'a shared edge belongs to the upper pane');
    assert.equal(chart.paneAt(main + 1), id);
    assert.equal(chart.paneAt(499), null, 'the time axis');
    assert.equal(chart.paneAt(-1), null);
    chart.destroy();
    assert.equal(chart.paneAt(10), null, 'no frame after destroy');
    assert.equal(chartOf({}, () => null).paneAt(10), null, 'no frame without a context');
  });
});

// ---------------------------------------------------------------- UI pages

/** A toolbar page with the header, the on-chart strip, the settings card and the indicators dialog. */
function page(options: { tokens?: HeaderTokens | ThemedHeaderTokens; theme?: 'dark' | 'light' } = {}) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const doc = win.document;
  const udoc = doc as unknown as UIDocument;
  const chart = chartOf();
  const host = doc.createElement('div');
  const rail = doc.createElement('div');
  const stage = doc.createElement('div');
  const trigger = doc.createElement('button');
  Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 800 });
  doc.body.append(host, rail, stage, trigger);
  const toolbar = createDrawingToolbar({ chart, document: udoc, canvas: stage as unknown as UIElement, rail: rail as unknown as UIElement,
    overlay: stage as unknown as UIElement, navigation: false, applyChartTheme: false });
  const settings = createChartSettings({ chart, document: udoc, trigger: trigger as unknown as UIElement });
  const dialog = createIndicatorsDialog({ chart, document: udoc });
  const header = createChartHeader({ chart, document: udoc, container: host as unknown as UIElement, flyouts: toolbar.flyouts,
    ...(options.tokens !== undefined ? { tokens: options.tokens } : {}), ...(options.theme !== undefined ? { theme: options.theme } : {}) });
  const strip = createScaleButtons({ chart, document: udoc, overlay: stage as unknown as UIElement,
    ...(options.tokens !== undefined ? { tokens: options.tokens } : {}), ...(options.theme !== undefined ? { theme: options.theme } : {}) });
  const root = header.element as unknown as HTMLElement;
  const stripRoot = strip.element as unknown as HTMLElement;
  const card = settings.element as unknown as HTMLElement;
  const dialogRoot = dialog.element as unknown as HTMLElement;
  const pressed = (nodes: ArrayLike<unknown>) => Array.from(nodes as ArrayLike<HTMLElement>)
    .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
  /** Pressed quick toggles: [header, on-chart strip]. */
  const modes = () => [pressed(root.querySelectorAll('.cts-header-scale-btn')), pressed(stripRoot.querySelectorAll('.cts-scale-btn'))];
  const typeTitle = () => (root.querySelector('.cts-header-type') as unknown as HTMLElement).title;
  const altL = () => doc.body.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'l', code: 'KeyL', altKey: true, bubbles: true, cancelable: true }));
  const select = (name: string, value: string) => {
    const node = card.querySelector(`select[name="${name}"]`) as unknown as HTMLSelectElement;
    node.value = value;
    node.dispatchEvent(new win.Event('change'));
  };
  const check = (name: string) => (card.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement).click();
  const menus = () => Array.from(doc.querySelectorAll('.cts-header-menu')) as unknown as HTMLElement[];
  // The dialog.
  const activeRow = (id: string) => dialogRoot.querySelector(`.cts-ind-active[data-id="${id}"]`) as unknown as HTMLElement | null;
  const active = () => Array.from(dialogRoot.querySelectorAll('.cts-ind-active .cts-ind-name')).map((n) => n.textContent);
  const field = (name: string) => dialogRoot.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement & HTMLSelectElement;
  const searchInput = dialogRoot.querySelector('[type="search"]') as unknown as HTMLInputElement;
  const search = (query: string) => {
    searchInput.value = query;
    searchInput.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const status = () => (dialogRoot.querySelector('[role="status"]') as unknown as HTMLElement).textContent;
  const destroy = () => {
    strip.destroy();
    header.destroy();
    dialog.destroy();
    settings.destroy();
    toolbar.destroy();
  };
  return {
    win, doc, chart, toolbar, settings, dialog, header, strip, root, stripRoot, card, dialogRoot, modes, typeTitle, altL, select, check, menus,
    activeRow, active, field, searchInput, search, status, destroy,
  };
}

describe('live header and scale buttons', () => {
  it('Alt+L, the settings card and updateConfig show at once on the header and the on-chart strip', () => {
    const p = page();
    assert.deepEqual(p.modes(), [['Auto'], ['A']]);
    p.altL();
    assert.equal(p.chart.getConfig().priceAxis.mode, 'logarithmic');
    assert.deepEqual(p.modes(), [['Auto', 'Log'], ['A', 'L']], "the toolbar's Alt+L");
    p.settings.open();
    p.select('scale-mode', 'percent');
    assert.deepEqual(p.modes(), [['Auto', '%'], ['A', '%']], 'the settings card');
    p.check('autoScale');
    assert.deepEqual(p.modes(), [['%'], ['%']]);
    p.settings.close();
    p.chart.updateConfig({ priceAxis: { mode: 'regular', autoScale: true } });
    assert.deepEqual(p.modes(), [['Auto'], ['A']], 'updateConfig');

    assert.equal(p.typeTitle(), 'Chart type: Candles');
    p.chart.updateConfig({ series: { type: 'heikin-ashi' } });
    assert.equal(p.typeTitle(), 'Chart type: Heikin Ashi', 'a series type set in code');
    p.destroy();
  });

  it('resyncs on its own sections only', () => {
    const p = page();
    // Edits in place send no event, so a resync shows only when something re-reads the config.
    const config = p.chart.getConfig();
    config.series.type = 'line';
    config.priceAxis.mode = 'logarithmic';
    p.chart.updateConfig({ grid: { visible: false }, crosshair: { mode: 'dot' } });
    p.chart.addIndicator({ name: 'rsi' });
    assert.equal(p.typeTitle(), 'Chart type: Candles', 'other sections leave the chart type button alone');
    assert.deepEqual(p.modes(), [['Auto'], ['A']], 'and the scale toggles');
    p.chart.updateConfig({ priceAxis: {} });
    assert.deepEqual(p.modes(), [['Auto', 'Log'], ['A', 'L']], "a 'priceAxis' event resyncs the toggles");
    assert.equal(p.typeTitle(), 'Chart type: Candles', 'but not the chart type');
    p.chart.updateConfig({ series: {} });
    assert.equal(p.typeTitle(), 'Chart type: Line', "a 'series' event resyncs the chart type");
    p.destroy();
  });

  it('waits for a batch to render, and stops following once destroyed', () => {
    const p = page();
    p.chart.batch(() => {
      p.chart.updateConfig({ series: { type: 'line' }, priceAxis: { mode: 'logarithmic' } });
      assert.equal(p.typeTitle(), 'Chart type: Candles');
      assert.deepEqual(p.modes(), [['Auto'], ['A']]);
    });
    assert.equal(p.typeTitle(), 'Chart type: Line');
    assert.deepEqual(p.modes(), [['Auto', 'Log'], ['A', 'L']]);
    p.header.destroy();
    p.strip.destroy();
    p.chart.updateConfig({ series: { type: 'bar' }, priceAxis: { mode: 'regular' } });
    assert.equal(p.typeTitle(), 'Chart type: Line');
    assert.deepEqual(p.modes(), [['Auto', 'Log'], ['A', 'L']]);
    p.dialog.destroy();
    p.settings.destroy();
    p.toolbar.destroy();
  });
});

describe('per-theme header tokens', () => {
  it('BLOXWAP_HEADER_THEME dresses the header, its menus and the strip on dark only', () => {
    assert.deepEqual(BLOXWAP_HEADER_THEME, { dark: BLOXWAP_HEADER_TOKENS });
    const p = page({ tokens: BLOXWAP_HEADER_THEME });
    const nodes = () => [p.root, p.stripRoot, ...p.menus()];
    assert.equal(p.menus().length, 2);
    for (const node of nodes()) {
      assert.equal(node.style.getPropertyValue('--cts-header-bg'), '#171717');
      assert.equal(node.style.getPropertyValue('--cts-accent'), '#00ff3f');
    }
    const [left, width] = [p.stripRoot.style.left, p.stripRoot.style.width];
    assert.ok(left !== '' && width !== '');
    p.header.setTheme('light');
    p.strip.setTheme('light');
    for (const node of nodes()) {
      assert.equal(node.style.getPropertyValue('--cts-header-bg'), '', 'light falls back to the default light tokens');
      assert.equal(node.style.getPropertyValue('--cts-panel'), '');
    }
    assert.ok(p.root.classList.contains('cts-light') && p.stripRoot.classList.contains('cts-light'));
    assert.deepEqual([p.stripRoot.style.left, p.stripRoot.style.width], [left, width], 'placement styles stay');
    p.header.setTheme('dark');
    p.strip.setTheme('dark');
    for (const node of nodes()) assert.equal(node.style.getPropertyValue('--cts-header-radius'), '9999px');
    p.destroy();
  });

  it('swaps one set for the other, starting from the theme passed in', () => {
    const tokens: ThemedHeaderTokens = {
      dark: { '--cts-header-bg': '#000000', '--cts-header-accent': '#00ff00' },
      light: { '--cts-header-bg': '#ffffff', '--cts-header-text': '#111111' },
    };
    const p = page({ tokens, theme: 'light' });
    const read = (name: string) => [p.root.style.getPropertyValue(name), p.stripRoot.style.getPropertyValue(name)];
    assert.deepEqual(read('--cts-header-bg'), ['#ffffff', '#ffffff']);
    assert.deepEqual(read('--cts-header-text'), ['#111111', '#111111']);
    assert.deepEqual(read('--cts-header-accent'), ['', '']);
    p.header.setTheme('dark');
    p.strip.setTheme('dark');
    assert.deepEqual(read('--cts-header-bg'), ['#000000', '#000000']);
    assert.deepEqual(read('--cts-header-text'), ['', ''], 'the light-only token is cleared');
    assert.deepEqual(read('--cts-header-accent'), ['#00ff00', '#00ff00']);
    p.destroy();

    // A light-only set leaves dark alone.
    const q = page({ tokens: { light: { '--cts-header-bg': '#fafafa' } } });
    assert.equal(q.root.style.getPropertyValue('--cts-header-bg'), '');
    q.header.setTheme('light');
    assert.equal(q.root.style.getPropertyValue('--cts-header-bg'), '#fafafa');
    q.destroy();
  });

  it('keeps a flat set on both themes, as before', () => {
    const p = page({ tokens: BLOXWAP_HEADER_TOKENS, theme: 'light' });
    assert.equal(p.root.style.getPropertyValue('--cts-header-accent'), '#00ff3f');
    p.header.setTheme('dark');
    p.header.setTheme('light');
    assert.equal(p.root.style.getPropertyValue('--cts-header-accent'), '#00ff3f');
    for (const menu of p.menus()) assert.equal(menu.style.getPropertyValue('--cts-edge'), 'transparent');
    p.destroy();
  });

  it('resolves sets per theme, and replaces the inline style where a DOM has no per-property access', () => {
    const flat = { '--a': '1' };
    assert.deepEqual(headerTokensFor(undefined, 'dark'), {});
    assert.equal(headerTokensFor(flat, 'light'), flat);
    assert.deepEqual(headerTokensFor({ dark: flat }, 'light'), {});
    assert.equal(headerTokensFor({ light: flat }, 'light'), flat);
    assert.equal(headerTokensFor({ dark: 'x' } as unknown as HeaderTokens, 'dark').dark, 'x', 'a flat set may use any property name');

    const attributes: [string, string][] = [];
    const node = { style: {}, setAttribute: (name: string, value: string) => { attributes.push([name, value]); } } as unknown as UIElement;
    swapTokens(node, { '--a': '1' }, { '--b': '2', '--c': '3' });
    swapTokens(node, { '--b': '2' }, {});
    swapTokens(node, flat, flat);
    assert.deepEqual(attributes, [['style', '--b: 2; --c: 3'], ['style', '']], 'the same set again touches nothing');
  });
});

describe('live indicators dialog', () => {
  it('lists studies the API adds, changes and removes while the picker is open, keeping the search', () => {
    const p = page();
    const rsi = p.chart.addIndicator({ name: 'rsi' });
    p.dialog.openPicker();
    assert.deepEqual(p.active(), ['RSI 14']);
    const ema = p.chart.addIndicator({ name: 'ema' });
    assert.deepEqual(p.active(), ['RSI 14', 'EMA 20'], 'an API add appears at once');
    p.chart.updateIndicator(rsi, { params: { period: 21 } });
    assert.deepEqual(p.active(), ['RSI 21', 'EMA 20'], 'so does an API change');
    p.chart.updateIndicator(ema, { visible: false });
    assert.ok(p.activeRow(ema)!.classList.contains('cts-ind-off'));
    assert.equal(p.activeRow(ema)!.querySelector('.cts-ind-visibility')!.getAttribute('aria-label'), 'Show EMA 20');
    p.search('rsi');
    p.chart.removeIndicator(ema);
    assert.deepEqual(p.active(), ['RSI 21']);
    assert.match(p.status(), /^1 on chart, /, 'the search still filters the new list');
    const row = p.activeRow(rsi);
    p.chart.updateConfig({ grid: { visible: false } });
    p.chart.updateConfig({ series: { upColor: '#00ff00' } });
    p.dialog.refresh();
    assert.equal(p.activeRow(rsi), row, 'changes that leave the list as it is rebuild nothing');
    p.destroy();
  });

  it("follows the toolbar's Hide indicators without host wiring", () => {
    const p = page();
    const rsi = p.chart.addIndicator({ name: 'rsi' });
    p.dialog.openPicker();
    const seen = record(p.chart);
    p.toolbar.controller.setHidden(false, true);
    assert.equal(p.chart.getIndicator(rsi)!.visible, false);
    assert.ok(p.activeRow(rsi)!.classList.contains('cts-ind-off'));
    p.toolbar.controller.setHidden(true, true);
    assert.equal(p.chart.drawingsHidden, true);
    assert.deepEqual(seen.keys, [['indicators']], 'hiding drawings alone changes no study');
    p.toolbar.controller.setHidden(false, false);
    assert.equal(p.chart.getIndicator(rsi)!.visible, true);
    assert.ok(!p.activeRow(rsi)!.classList.contains('cts-ind-off'));
    p.destroy();
  });

  it("keeps focus on a row's button through a rebuild, and hands it to the search when its row goes", () => {
    const p = page();
    const rsi = p.chart.addIndicator({ name: 'rsi' });
    const sma = p.chart.addIndicator({ name: 'sma' });
    p.dialog.openPicker();
    const eye = p.activeRow(rsi)!.querySelector('.cts-ind-visibility') as unknown as HTMLElement;
    eye.focus();
    eye.click();
    const again = p.activeRow(rsi)!.querySelector('.cts-ind-visibility') as unknown as HTMLElement;
    assert.notEqual(again, eye, 'the row was rebuilt');
    assert.ok(p.doc.activeElement === again, "focus moved to the rebuilt row's eye");
    assert.equal(again.getAttribute('aria-label'), 'Show RSI 14');
    p.chart.updateIndicator(sma, { params: { period: 30 } });
    assert.ok(p.doc.activeElement === p.activeRow(rsi)!.querySelector('.cts-ind-visibility'), 'another study changing keeps it too');
    (p.activeRow(sma)!.querySelector('.cts-ind-settings') as unknown as HTMLElement).focus();
    p.chart.removeIndicator(sma);
    assert.ok(p.doc.activeElement === p.searchInput, 'its study went: focus goes to the search');
    p.destroy();
  });

  it('keeps open settings in step with API and candle-color changes, and closes them when the study goes', () => {
    const p = page();
    const vol = p.chart.addIndicator({ name: 'vol' });
    const rsi = p.chart.addIndicator({ name: 'rsi' });
    assert.equal(p.dialog.openSettings(rsi), true);
    p.chart.updateIndicator(rsi, { params: { period: 30 }, pane: 'main' });
    assert.equal(p.field('input-period').value, '30');
    assert.equal(p.field('pane').value, 'main');
    p.chart.removeIndicator(vol);
    assert.equal(p.dialog.view, 'settings', 'another study going leaves them open');

    const vol2 = p.chart.addIndicator({ name: 'vol' });
    p.dialog.openSettings(vol2);
    p.chart.updateConfig({ series: { upColor: '#00ff00' } });
    assert.equal(p.field('color-0').value, '#00ff00', "the 'up' color follows the candles at once");
    p.chart.removeIndicator(vol2);
    assert.equal(p.dialog.view, null, 'removing the study closes its settings');
    p.dialog.destroy();
    assert.doesNotThrow(() => p.chart.addIndicator({ name: 'rsi' }), 'a destroyed dialog no longer listens');
    p.header.destroy();
    p.strip.destroy();
    p.settings.destroy();
    p.toolbar.destroy();
  });
});

// ---------------------------------------------------------------- context menu

function menuPage(extra: Partial<Omit<ChartContextMenuOptions, 'chart' | 'document' | 'canvas'>> = {}) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const doc = win.document;
  const canvas = doc.createElement('div');
  doc.body.append(canvas);
  const chart = createChart({ document: new MockDocument(), config: { wasm: false, data, width: 800, height: 500 } });
  chart.indicators.register(blank);
  const menu = createChartContextMenu({ chart, document: doc as unknown as UIDocument, canvas: canvas as unknown as UIElement, ...extra });
  const root = menu.element as unknown as HTMLElement;
  const labels = () => Array.from(root.querySelectorAll('.cts-item-label')).map((n) => n.textContent);
  const headings = () => Array.from(root.querySelectorAll('.cts-menu-label')).map((n) => n.textContent);
  const item = (label: string) => {
    const found = Array.from(root.querySelectorAll('.cts-item')).find((row) => row.querySelector('.cts-item-label')!.textContent === label);
    assert.ok(found, `menu item ${label} in [${labels().join(', ')}]`);
    return found as unknown as HTMLElement;
  };
  const rightClick = (x: number, y: number) =>
    canvas.dispatchEvent(new win.PointerEvent('contextmenu', { clientX: x, clientY: y, button: 2, pointerType: 'mouse', bubbles: true, cancelable: true }));
  return { win, doc, chart, menu, root, labels, headings, item, rightClick };
}

describe('context menu in an indicator sub-pane', () => {
  it("offers the pane's study actions instead of the main price scale toggles", () => {
    const actions: [ContextMenuAction, ContextMenuTarget][] = [];
    const settings: string[] = [];
    const m = menuPage({
      onChartSettings: () => undefined,
      onIndicatorSettings: (id) => { settings.push(id); },
      onAction: (action, target) => { actions.push([action, target]); },
    });
    const id = m.chart.addIndicator({ name: 'blank' });
    const y = m.chart.plotArea.height + 30;
    assert.equal(m.chart.paneAt(y), id);
    m.rightClick(400, y);
    assert.deepEqual(m.menu.target, { kind: 'chart', x: 400, y, paneId: id } satisfies ContextMenuTarget);
    assert.deepEqual(m.labels(), ['Reset chart view', 'Settings…', 'Hide', 'Remove', 'Chart settings…', 'Remove all indicators']);
    assert.deepEqual(m.headings(), ['BLANK'], "the pane's study, and no price scale group");
    m.item('Settings…').click();
    assert.deepEqual(settings, [id]);
    m.rightClick(400, y);
    m.item('Hide').click();
    assert.equal(m.chart.getIndicator(id)!.visible, false);
    const study = { kind: 'indicator', id, key: '', x: 400, y } satisfies ContextMenuTarget;
    assert.deepEqual(actions, [['indicator-settings', study], ['hide-indicator', study]],
      'indicator actions come with an indicator target, as from a plot');

    // The main pane keeps its toggles, with no pane id.
    m.rightClick(400, 40);
    assert.deepEqual(m.menu.target, { kind: 'chart', x: 400, y: 40 });
    assert.deepEqual(m.headings(), ['Price scale']);
    m.menu.close();
    // So does the time axis below every pane.
    m.rightClick(400, 495);
    assert.deepEqual(m.menu.target, { kind: 'chart', x: 400, y: 495 });
    m.menu.close();
  });

  it('removes the study or resets the view from its pane, and does nothing once the study is gone', () => {
    const actions: ContextMenuAction[] = [];
    const m = menuPage({ onAction: (action) => { actions.push(action); } });
    const id = m.chart.addIndicator({ name: 'blank' });
    const y = m.chart.plotArea.height + 30;
    m.rightClick(400, y);
    assert.deepEqual(m.labels(), ['Reset chart view', 'Hide', 'Remove', 'Remove all indicators'], 'no hooks, no Settings rows');
    m.item('Remove').click();
    assert.equal(m.chart.getIndicator(id), undefined);

    const next = m.chart.addIndicator({ name: 'blank' });
    m.chart.scale.scrollBy(10);
    m.rightClick(400, y);
    m.item('Reset chart view').click();
    assert.equal(m.chart.scale.visibleRange().to, data.length, 'the view is back on the latest bar');
    m.rightClick(400, y);
    const hide = m.item('Hide');
    m.chart.removeIndicator(next);
    hide.click();
    assert.equal(m.menu.target, null);
    assert.deepEqual(actions, ['remove-indicator', 'reset-view'], 'a stale study action does nothing');
  });

  it('falls back to the price scale group when the pane last drawn has lost its study', () => {
    const m = menuPage();
    const id = m.chart.addIndicator({ name: 'blank' });
    const y = m.chart.plotArea.height + 30;
    m.chart.batch(() => {
      m.chart.removeIndicator(id);
      m.menu.open(400, y);
    });
    assert.deepEqual(m.menu.target, { kind: 'chart', x: 400, y, paneId: id });
    assert.deepEqual(m.headings(), ['Price scale']);
    assert.ok(m.labels().includes('Logarithmic'));
    m.menu.destroy();
  });
});

// ---------------------------------------------------------------- follow-ups

/**
 * Drops `style.removeProperty` from `node`, as in a DOM without per-property
 * access, and records its style attribute writes (happy-dom sends inline
 * property writes through them too).
 */
function withoutPerPropertyStyles(node: HTMLElement): string[] {
  Object.defineProperty(node.style, 'removeProperty', { configurable: true, value: undefined });
  const writes: string[] = [];
  const setAttribute = node.setAttribute.bind(node);
  node.setAttribute = (name: string, value: string) => {
    if (name === 'style') writes.push(value);
    setAttribute(name, value);
  };
  return writes;
}

describe('header tokens without per-property styles', () => {
  it('leaves the inline style alone on a theme switch when there are no tokens', () => {
    const p = page();
    const writes = [withoutPerPropertyStyles(p.root), withoutPerPropertyStyles(p.stripRoot)];
    const placed = () => [p.stripRoot.style.left, p.stripRoot.style.top, p.stripRoot.style.width, p.stripRoot.style.height, p.stripRoot.style.display];
    const before = placed();
    assert.ok(before[0] !== '' && before[2] !== '');
    for (const theme of ['light', 'dark', 'light'] as const) {
      p.header.setTheme(theme);
      p.strip.setTheme(theme);
    }
    assert.deepEqual(writes, [[], []], 'no style attribute rewrites');
    assert.deepEqual(placed(), before, "the strip's box stays");
    assert.equal(headerTokensFor(undefined, 'dark'), headerTokensFor(undefined, 'light'), 'one shared empty set');
    assert.equal(swapTokens(p.root as unknown as UIElement, {}, {}), false, 'two empty sets touch nothing');
    p.destroy();
  });

  it("writes the strip's box again after a per-theme set replaced the whole inline style", () => {
    const tokens: ThemedHeaderTokens = { dark: { '--cts-header-bg': '#000000' }, light: { '--cts-header-bg': '#ffffff' } };
    const p = page({ tokens });
    const writes = withoutPerPropertyStyles(p.stripRoot);
    const placed = () => [p.stripRoot.style.left, p.stripRoot.style.top, p.stripRoot.style.width, p.stripRoot.style.height];
    const before = placed();
    p.strip.setTheme('light');
    assert.equal(writes[0], '--cts-header-bg: #ffffff', 'the tokens replaced the whole inline style');
    assert.equal(p.stripRoot.style.getPropertyValue('--cts-header-bg'), '#ffffff');
    assert.deepEqual(placed(), before, 'left, top, width and height are back');
    p.chart.updateConfig({ priceAxis: { visible: false } });
    assert.equal(p.stripRoot.style.display, 'none', 'and it still hides with the axis');
    const count = writes.length;
    p.strip.setTheme('light');
    assert.equal(writes.length, count, 'the same set again writes nothing');
    p.destroy();
  });
});

describe('live indicators dialog: follow-ups', () => {
  it('keeps a value being typed while other studies or the chart type change, and resyncs when its own study or the candle colors do', () => {
    const p = page();
    const rsi = p.chart.addIndicator({ name: 'rsi' });
    const ema = p.chart.addIndicator({ name: 'ema' });
    p.dialog.openSettings(rsi);
    const period = p.field('input-period');
    const widths = Array.from(p.field('width-0').querySelectorAll('option'));
    period.value = '33'; // typed, not committed
    p.chart.updateIndicator(ema, { params: { period: 50 } });
    p.chart.addIndicator({ name: 'sma' });
    p.chart.updateConfig({ series: { type: 'line' } });
    assert.equal(period.value, '33', 'changes that leave this study and the candle colors alone keep it');
    assert.deepEqual(Array.from(p.field('width-0').querySelectorAll('option')), widths, 'nothing was rebuilt');
    p.chart.updateConfig({ series: { downColor: '#ff0000' } });
    assert.equal(period.value, '14', 'a candle color change resyncs');
    period.value = '33';
    p.chart.updateIndicator(rsi, { params: { period: 21 } });
    assert.equal(period.value, '21', 'so does a change to this study');
    for (const typed of ['0', '-5']) {
      period.value = typed;
      period.dispatchEvent(new p.win.Event('change'));
      assert.equal(period.value, '1', `${typed} shows clamped to the minimum, even when the study already had it`);
    }
    p.destroy();
  });

  it('follows only indicator and series events', () => {
    const p = page();
    const rsi = p.chart.addIndicator({ name: 'rsi', params: { period: 14 } });
    p.dialog.openPicker();
    const cfg = p.chart.getConfig().indicators.find((c) => c.id === rsi)!;
    // Edits in place send no event, so a relist shows only when something re-reads the config.
    (cfg.params as Record<string, number>).period = 30;
    p.chart.updateConfig({ grid: { visible: false }, priceAxis: { mode: 'logarithmic' } });
    assert.deepEqual(p.active(), ['RSI 14'], 'other sections leave the list alone');
    p.chart.updateConfig({ series: {} });
    assert.deepEqual(p.active(), ['RSI 30'], "a 'series' event relists");
    (cfg.params as Record<string, number>).period = 40;
    p.chart.addDrawing({ name: 'hline', points: [{ index: 5, price: 100 }] });
    assert.deepEqual(p.active(), ['RSI 30']);
    p.chart.updateIndicator('nope', {});
    p.chart.updateIndicator(rsi, {});
    assert.deepEqual(p.active(), ['RSI 40'], "an 'indicators' event relists");
    p.destroy();
  });

  it('goes back to the picker when a study whose settings it opened is removed', () => {
    const p = page();
    const rsi = p.chart.addIndicator({ name: 'rsi' });
    const ema = p.chart.addIndicator({ name: 'ema' });
    p.dialog.openPicker();
    (p.activeRow(rsi)!.querySelector('.cts-ind-settings') as unknown as HTMLElement).click();
    assert.equal(p.dialog.view, 'settings');
    p.chart.removeIndicator(rsi);
    assert.equal(p.dialog.view, 'picker', 'as Back or OK would');
    assert.deepEqual(p.active(), ['EMA 20']);
    assert.ok(p.doc.activeElement === p.searchInput);

    // A control used after an unheard removal leaves the same way.
    (p.activeRow(ema)!.querySelector('.cts-ind-settings') as unknown as HTMLElement).click();
    p.chart.batch(() => {
      p.chart.removeIndicator(ema);
      p.field('visible').click();
      assert.equal(p.dialog.view, 'picker');
    });
    assert.deepEqual(p.active(), []);
    p.dialog.openSettings(p.chart.addIndicator({ name: 'sma' }));
    p.chart.removeIndicator(p.chart.getConfig().indicators[0]!.id);
    assert.equal(p.dialog.view, null, 'settings opened elsewhere close');
    p.destroy();
  });
});

describe("the toolbar's Hide drawings / Hide indicators", () => {
  it('leaves studies alone unless the indicators flag flips, and brings back only what it hid', () => {
    const p = page();
    const rsi = p.chart.addIndicator({ name: 'rsi' });
    const sma = p.chart.addIndicator({ name: 'sma' });
    const { controller } = p.toolbar;
    p.chart.updateIndicator(rsi, { visible: false });
    const seen = record(p.chart);
    controller.setHidden(true, false);
    assert.equal(p.chart.getIndicator(rsi)!.visible, false, 'hiding drawings keeps a study hidden on its own hidden');
    assert.deepEqual(seen.keys, [], 'and reports no indicator change');
    controller.setHidden(true, true);
    assert.equal(p.chart.getIndicator(sma)!.visible, false);
    assert.deepEqual(seen.keys, [['indicators']]);
    controller.setHidden(false, true);
    assert.equal(p.chart.drawingsHidden, false);
    assert.deepEqual(seen.keys, [['indicators']], 'showing drawings leaves studies hidden');
    const late = p.chart.addIndicator({ name: 'ema' });
    controller.setHidden(false, false);
    assert.deepEqual([rsi, sma, late].map((id) => p.chart.getIndicator(id)!.visible), [false, true, true],
      'showing brings back what it hid; a study hidden on its own stays hidden');
    controller.setHidden(false, true);
    p.chart.removeIndicator(sma);
    controller.setHidden(false, false);
    assert.deepEqual(p.chart.getConfig().indicators.map((c) => [c.id, c.visible]), [[rsi, false], [late, true]], 'a removed study stays gone');
    p.destroy();
  });
});
