import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type Element, type HTMLElement } from 'happy-dom';
import { MockContext2D, createChart, type Candle, type ChartCanvas } from '../dist/index.js';
import {
  CHART_TYPE_LABELS,
  DEFAULT_CHART_TYPES,
  DEFAULT_TIMEFRAMES,
  HOVER_OPEN_MS,
  STYLE_MARKER,
  TOOLBAR_CSS,
  createChartHeader,
  createControlRail,
  createDrawingToolbar,
  type ControlRailOptions,
  type UIDocument,
  type UIElement,
} from '../dist/ui/index.js';

const data: Candle[] = Array.from({ length: 40 }, (_, i) => ({ time: 1_700_000_000 + i * 900, open: 100 + i, high: 104 + i, low: 98 + i, close: 102 + i, volume: 10 }));
const windows: Window[] = [];
after(() => { for (const win of windows) void win.happyDOM.close(); });

function mount(options: Partial<Omit<ControlRailOptions, 'chart' | 'document' | 'container'>> = {}) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const doc = win.document;
  const canvas: ChartCanvas = { width: 640, height: 400, getContext: () => new MockContext2D() };
  const chart = createChart({ container: canvas, config: { wasm: false, data } });
  const host = doc.createElement('div');
  doc.body.append(host);
  const rail = createControlRail({ chart, document: doc as unknown as UIDocument, container: host as unknown as UIElement, ...options });
  const root = rail.element as unknown as HTMLElement;
  const q = <T extends Element = HTMLElement>(selector: string) => doc.querySelector(selector) as unknown as T;
  const qa = (selector: string) => [...doc.querySelectorAll(selector)] as unknown as HTMLElement[];
  const click = (node: Element, detail = 1) => node.dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail }));
  const key = (node: Element, k: string) => {
    const event = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    return event;
  };
  const menus = () => qa('.cts-control-rail-menu');
  const item = (menu: HTMLElement, label: string) => [...menu.querySelectorAll('.cts-item')].find((b) => b.textContent === label) as unknown as HTMLElement;
  const tfBtn = () => q('.cts-control-rail .cts-rail-scroll > .cts-btn');
  return { win, doc, chart, host, rail, root, q, qa, click, key, menus, item, tfBtn };
}

type State = { symbol: string | null; intervalMs: number | null };
function feed(initial: State, subscribe = true) {
  const calls: [string, number][] = [];
  const listeners = new Set<(state: State) => void>();
  const df = {
    ...initial,
    setSymbol(symbol: string, intervalMs: number) { calls.push([symbol, intervalMs]); df.emit({ symbol, intervalMs }); },
    emit(state: State) { df.symbol = state.symbol; df.intervalMs = state.intervalMs; for (const l of listeners) l(state); },
    ...(subscribe ? { subscribeState(l: (state: State) => void) { listeners.add(l); return () => listeners.delete(l); } } : {}),
  };
  return { df, calls, listeners };
}

describe('control rail: layout', () => {
  it('stacks timeframe, chart type, indicators, scale toggles and slots in a nav rail', () => {
    const win = new Window();
    windows.push(win);
    const top = [win.document.createElement('button')] as unknown as UIElement[];
    const bottom = [win.document.createElement('button'), win.document.createElement('button')] as unknown as UIElement[];
    let indicators = 0;
    const m = mount({ onIndicators: () => { indicators++; }, slots: { top, bottom } });
    assert.equal(m.root.parentElement, m.host as unknown as HTMLElement, 'appended to the container');
    assert.equal(m.root.tagName, 'NAV');
    assert.equal(m.root.getAttribute('aria-label'), 'Chart controls');
    assert.ok(['cts-theme', 'cts-rail', 'cts-control-rail'].every((c) => m.root.classList.contains(c)));
    assert.ok(m.doc.head.querySelector(`style[${STYLE_MARKER}]`), 'toolbar styles injected');

    const scroll = m.q('.cts-control-rail .cts-rail-scroll');
    assert.ok(scroll.parentElement!.classList.contains('cts-rail-scroll-wrap'), 'scrolls with paging arrows');
    const kinds = [...scroll.children].map((c) => c.getAttribute('aria-label') ?? c.className);
    assert.deepEqual(kinds, ['Timeframe: 15m', 'Chart type: Candles', 'Indicators', 'cts-rail-divider', 'Price scale', 'cts-rail-divider', 'cts-control-rail-slot']);
    assert.deepEqual([...m.q('.cts-control-rail-group').children].map((b) => b.textContent), ['Auto', '%', 'Log']);
    assert.ok(m.q('.cts-control-rail-group').querySelector('.cts-rail-scale.cts-btn'));
    assert.equal(m.rail.slots.top as unknown, (top[0] as unknown as HTMLElement).parentElement as unknown, 'top slot follows the controls');
    assert.deepEqual([...(m.rail.slots.bottom as unknown as HTMLElement).children], bottom as unknown as HTMLElement[]);
    assert.ok((m.rail.slots.bottom as unknown as HTMLElement).classList.contains('cts-rail-footer'));
    assert.equal((m.rail.slots.bottom as unknown as HTMLElement).parentElement, m.root, 'footer pinned outside the scroll');

    const indicatorsBtn = m.q('[aria-label="Indicators"]');
    assert.equal(indicatorsBtn.getAttribute('aria-haspopup'), 'dialog');
    m.click(indicatorsBtn);
    assert.equal(indicators, 1);
    assert.equal(m.menus().length, 2, 'timeframe and chart-type menus');
    assert.equal(m.menus()[0]!.querySelector('.cts-menu-label')!.textContent, 'Timeframe');
    assert.deepEqual([...m.menus()[0]!.querySelectorAll('.cts-item')].map((i) => i.textContent), DEFAULT_TIMEFRAMES.map((tf) => tf.label));
    assert.deepEqual([...m.menus()[1]!.querySelectorAll('.cts-item')].map((i) => i.textContent), DEFAULT_CHART_TYPES.map((t) => CHART_TYPE_LABELS[t]));
    assert.ok(m.tfBtn().querySelector('.cts-caret'), 'menu buttons carry the disclosure chevron');
    assert.equal(m.tfBtn().getAttribute('aria-haspopup'), 'menu');

    m.rail.destroy();
    m.click(indicatorsBtn);
    assert.equal(indicators, 1, 'destroy removes the listener');
    assert.equal(m.root.parentElement, null);
    assert.equal(m.menus().length, 0, 'menus removed');
  });

  it('hides what is switched off and skips dividers with nothing to separate', () => {
    const bare = mount({ timeframes: [], chartTypes: [], scaleButtons: false });
    assert.deepEqual([...bare.q('.cts-rail-scroll').children].map((c) => c.className), ['cts-control-rail-slot']);
    assert.equal((bare.rail.slots.top as unknown as HTMLElement).children.length, 0);
    assert.equal((bare.rail.slots.bottom as unknown as HTMLElement).children.length, 0);

    const scaleOnly = mount({ timeframes: [], chartTypes: [] });
    assert.deepEqual([...scaleOnly.q('.cts-rail-scroll').children].map((c) => c.className),
      ['cts-control-rail-group', 'cts-rail-divider', 'cts-control-rail-slot'], 'no leading divider');

    const noScale = mount({ scaleButtons: false });
    assert.deepEqual([...noScale.q('.cts-rail-scroll').children].map((c) => c.className.split(' ')[0]),
      ['cts-btn', 'cts-btn', 'cts-rail-divider', 'cts-control-rail-slot']);
  });

  it('ships its layout in the toolbar stylesheet', () => {
    assert.match(TOOLBAR_CSS, /\.cts-control-rail-slot \{ display: contents; \}/);
    assert.match(TOOLBAR_CSS, /\.cts-rail-scale\.cts-on \{ color: var\(--cts-accent\); background: var\(--cts-accent-soft\); \}/);
    assert.match(TOOLBAR_CSS, /\.cts-rail-footer \{[^}]*flex-direction: column/);
  });
});

describe('control rail: timeframes', () => {
  it('picks from the menu, calling the datafeed and onTimeframeChange once per change', () => {
    const picks: string[] = [];
    const calls: [string, number][] = [];
    const m = mount({ symbol: 'BTC', datafeed: { setSymbol: (s, ms) => { calls.push([s, ms]); } }, onTimeframeChange: (tf) => picks.push(tf.label) });
    const menu = m.menus()[0]!;
    assert.equal(m.item(menu, '15m').getAttribute('aria-checked'), 'true');
    m.click(m.tfBtn());
    assert.ok(menu.classList.contains('cts-open'));
    m.click(m.item(menu, '1h'));
    assert.ok(!menu.classList.contains('cts-open'), 'a pick closes the menu');
    assert.equal(m.rail.intervalMs, 3_600_000);
    assert.equal(m.tfBtn().querySelector('.cts-btn-label')!.textContent, '1h');
    assert.equal(m.tfBtn().title, 'Timeframe: 1h');
    assert.equal(m.item(menu, '1h').getAttribute('aria-checked'), 'true');
    assert.equal(m.item(menu, '15m').getAttribute('aria-checked'), 'false');
    m.click(m.item(menu, '1h'));
    assert.deepEqual(calls, [['BTC', 3_600_000]], 'the selected interval is a no-op');
    assert.deepEqual(picks, ['1h']);
  });

  it('labels an interval outside the list, and without a symbol calls no datafeed', () => {
    const calls: [string, number][] = [];
    const m = mount({ intervalMs: 7_200_000, datafeed: { setSymbol: (s, ms) => { calls.push([s, ms]); } } });
    assert.equal(m.tfBtn().querySelector('.cts-btn-label')!.textContent, '2h');
    assert.ok(m.menus()[0]!.querySelectorAll('[aria-checked="true"]').length === 0);
    m.click(m.item(m.menus()[0]!, '4h'));
    assert.deepEqual(calls, [], 'no symbol known yet');
    m.rail.setSymbol('SOL');
    assert.equal(m.rail.symbol, 'SOL');
    m.click(m.item(m.menus()[0]!, '1d'));
    assert.deepEqual(calls, [['SOL', 86_400_000]]);
    m.rail.setInterval(60_000);
    assert.equal(m.tfBtn().title, 'Timeframe: 1m');
    assert.deepEqual(calls.length, 1, 'setInterval does not call the datafeed');
    const bare = mount({ timeframes: [{ label: 'Tick', intervalMs: 1000 }] });
    bare.click(bare.item(bare.menus()[0]!, 'Tick'));
    assert.equal(bare.rail.intervalMs, 1000, 'no datafeed: the pick still shows');
  });

  it('drives the menu from the keyboard like the header', () => {
    const m = mount();
    const btn = m.tfBtn();
    btn.focus();
    m.click(btn, 0);
    assert.equal(m.doc.activeElement?.textContent, '15m', 'keyboard open focuses the checked entry');
    m.key(m.doc.activeElement!, 'ArrowDown');
    assert.equal(m.doc.activeElement?.textContent, '1h');
    m.key(m.doc.activeElement!, 'Escape');
    assert.equal(m.doc.activeElement, btn);
    assert.ok(!m.menus()[0]!.classList.contains('cts-open'));
  });
});

describe('control rail: datafeed as the source of truth', () => {
  it('starts from the datafeed, reloads its symbol and follows its switches', () => {
    const f = feed({ symbol: 'ETH', intervalMs: 3_600_000 });
    const m = mount({ symbol: 'BTC', datafeed: f.df });
    assert.equal(m.rail.symbol, 'ETH', 'the loaded symbol wins over an explicit one');
    assert.equal(m.rail.intervalMs, 3_600_000, 'the loaded interval wins over the 15m default');
    m.click(m.item(m.menus()[0]!, '4h'));
    assert.deepEqual(f.calls, [['ETH', 14_400_000]], 'reloads what the datafeed has loaded');
    assert.equal(m.rail.symbol, 'ETH', 'follows the reported symbol');
    f.df.emit({ symbol: 'SOL', intervalMs: 60_000 });
    assert.equal(m.rail.intervalMs, 60_000);
    assert.equal(m.tfBtn().title, 'Timeframe: 1m');
    f.df.emit({ symbol: null, intervalMs: null });
    assert.equal(m.rail.symbol, 'SOL', 'a cleared state keeps the last symbol');
    assert.equal(m.rail.intervalMs, 60_000);
    m.rail.destroy();
    assert.equal(f.listeners.size, 0, 'destroy unsubscribes');
  });

  it('refresh() catches up with a datafeed that cannot be subscribed to', () => {
    const f = feed({ symbol: null, intervalMs: null }, false);
    const m = mount({ datafeed: f.df });
    assert.equal(m.rail.symbol, undefined);
    assert.equal(m.rail.intervalMs, 900_000);
    f.df.symbol = 'BTC';
    f.df.intervalMs = 300_000;
    assert.equal(m.rail.intervalMs, 900_000, 'stale until refreshed');
    m.rail.refresh();
    assert.equal(m.rail.symbol, 'BTC');
    assert.equal(m.rail.intervalMs, 300_000);
    m.rail.refresh();
    assert.equal(m.rail.intervalMs, 300_000, 'an unchanged interval is kept');
  });
});

describe('control rail: chart type', () => {
  it('applies picks, follows config changes and keeps the candle glyph for a custom series', () => {
    const picks: string[] = [];
    const m = mount({ onChartTypeChange: (t) => picks.push(t) });
    const btn = () => m.q('.cts-control-rail .cts-rail-scroll > .cts-btn:nth-child(2)');
    const menu = m.menus()[1]!;
    m.click(m.item(menu, 'Line'));
    assert.equal(m.chart.getConfig().series.type, 'line');
    assert.equal(btn().title, 'Chart type: Line');
    assert.equal(m.item(menu, 'Line').getAttribute('aria-checked'), 'true');
    m.click(m.item(menu, 'Line'));
    assert.deepEqual(picks, ['line'], 'the current type is a no-op');
    m.rail.setChartType('bar');
    assert.equal(m.chart.getConfig().series.type, 'bar');
    assert.deepEqual(picks, ['line'], 'setChartType does not call onChartTypeChange');
    m.chart.updateConfig({ series: { type: 'area' } });
    m.chart.render();
    assert.equal(btn().title, 'Chart type: Area', 'follows rendered config changes');
    m.chart.registerSeries('footprint', () => undefined);
    m.chart.updateConfig({ series: { type: 'footprint' as never } });
    m.rail.refresh();
    assert.equal(btn().title, 'Chart type: footprint');
    assert.ok(btn().querySelector('svg'), 'a type without a glyph keeps the candlestick');
    assert.ok(btn().querySelector('.cts-caret'), 'the chevron survives icon swaps');
    assert.ok(menu.querySelectorAll('[aria-checked="true"]').length === 0);
  });

  it('offers only the given types', () => {
    const m = mount({ chartTypes: ['candlestick', 'line'] });
    assert.deepEqual([...m.menus()[1]!.querySelectorAll('.cts-item')].map((i) => i.textContent), ['Candles', 'Line']);
  });
});

describe('control rail: scale toggles', () => {
  it('toggles the price axis and follows it', () => {
    const m = mount();
    const [auto, percent, log] = [...m.q('.cts-control-rail-group').children] as HTMLElement[];
    assert.ok(auto!.classList.contains('cts-on'), 'autoScale is on by default');
    m.click(log!);
    assert.equal(m.chart.getConfig().priceAxis.mode, 'logarithmic');
    assert.equal(log!.getAttribute('aria-pressed'), 'true');
    m.click(percent!);
    assert.equal(log!.getAttribute('aria-pressed'), 'false', '% and Log exclude each other');
    m.rail.destroy();
    m.click(auto!);
    assert.equal(m.chart.getConfig().priceAxis.autoScale, true, 'destroy removes the toggles\' listeners');
  });
});

describe('control rail: flyouts and theme', () => {
  it('owns a themed portal by default and removes it on destroy', () => {
    const m = mount({ theme: 'light' });
    const portal = m.menus()[0]!.parentElement!;
    assert.equal(portal.parentElement, m.doc.body as unknown as HTMLElement);
    assert.ok(portal.classList.contains('cts-light') && m.root.classList.contains('cts-light'));
    m.rail.setTheme('dark');
    assert.ok(!portal.classList.contains('cts-light') && !m.root.classList.contains('cts-light'));
    m.click(m.tfBtn());
    m.rail.destroy();
    assert.equal(portal.parentElement, null);
  });

  it('shares the toolbar flyouts, one menu open at a time, and leaves them usable after destroy', () => {
    const win = new Window({ url: 'http://localhost/' });
    windows.push(win);
    const doc = win.document;
    const canvas: ChartCanvas = { width: 640, height: 400, getContext: () => new MockContext2D() };
    const chart = createChart({ container: canvas, config: { wasm: false, data } });
    const stage = doc.createElement('div');
    const tools = doc.createElement('div');
    const host = doc.createElement('div');
    stage.append(doc.createElement('div'));
    doc.body.append(host, tools, stage);
    const toolbar = createDrawingToolbar({ chart, document: doc as unknown as UIDocument, canvas: stage.firstElementChild as unknown as UIElement,
      rail: tools as unknown as UIElement, overlay: stage as unknown as UIElement, navigation: false, applyChartTheme: false });
    const before = doc.body.children.length;
    const rail = createControlRail({ chart, document: doc as unknown as UIDocument, container: host as unknown as UIElement, flyouts: toolbar.flyouts, theme: 'light' });
    assert.equal(doc.body.children.length, before, 'no extra portal');
    const header = createChartHeader({ chart, document: doc as unknown as UIDocument, container: host as unknown as UIElement, flyouts: toolbar.flyouts });
    const menus = [...doc.querySelectorAll('.cts-control-rail-menu')] as unknown as HTMLElement[];
    assert.ok(menus.every((menu) => menu.parentElement === toolbar.flyouts.portal as unknown as HTMLElement));
    const railBtn = doc.querySelector('.cts-control-rail .cts-rail-scroll > .cts-btn') as unknown as HTMLElement;
    railBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.equal(toolbar.flyouts.open, menus[0] as unknown as UIElement);
    (doc.querySelector('.cts-header-type') as unknown as HTMLElement).dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    assert.notEqual(toolbar.flyouts.open, menus[0] as unknown as UIElement, 'the header menu replaces the rail menu');
    header.destroy();
    railBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
    rail.destroy();
    assert.equal(toolbar.flyouts.open, null, 'destroy closes its open menu');
    assert.ok(!(toolbar.flyouts.portal as unknown as HTMLElement).classList.contains('cts-light'), 'the shared portal belongs to the toolbar');
    const menu = toolbar.flyouts.create();
    toolbar.flyouts.show(menu, tools as unknown as UIElement);
    assert.equal(toolbar.flyouts.open, menu, 'the shared flyouts still work');
    toolbar.destroy();
  });

  it('opens a menu on mouse hover, like the drawing rail', async () => {
    const m = mount();
    m.tfBtn().dispatchEvent(new m.win.PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await new Promise((resolve) => setTimeout(resolve, HOVER_OPEN_MS + 40));
    assert.ok(m.menus()[0]!.classList.contains('cts-open'));
    m.rail.destroy();
  });
});
