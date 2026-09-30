import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type Element, type HTMLElement } from 'happy-dom';
import { MockContext2D, createChart, type Candle, type ChartCanvas, type SeriesType } from '../dist/index.js';
import {
  BLOXWAP_HEADER_TOKENS,
  CHART_TYPE_LABELS,
  DEFAULT_CHART_TYPES,
  DEFAULT_HEADER_INTERVAL_MS,
  DEFAULT_TIMEFRAMES,
  Flyouts,
  HEADER_CSS,
  HEADER_STYLE_MARKER,
  ICONS,
  STYLE_MARKER,
  createChartHeader,
  createDrawingToolbar,
  type ChartHeaderOptions,
  type HeaderTimeframe,
  type UIDocument,
  type UIElement,
} from '../dist/ui/index.js';

const data: Candle[] = Array.from({ length: 40 }, (_, i) => ({ time: 1_700_000_000 + i * 900, open: 100 + i, high: 104 + i, low: 98 + i, close: 102 + i, volume: 10 }));
const windows: Window[] = [];
after(() => { for (const win of windows) void win.happyDOM.close(); });

type Observer = { callback: () => void; targets: unknown[]; disconnected: boolean };

function mount(options: Partial<Omit<ChartHeaderOptions, 'chart' | 'document' | 'container'>> = {}, setup?: (win: Window) => void) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const observers: Observer[] = [];
  Object.defineProperty(win, 'ResizeObserver', {
    configurable: true,
    value: class {
      record: Observer;
      constructor(callback: () => void) { this.record = { callback, targets: [], disconnected: false }; observers.push(this.record); }
      observe(target: unknown) { this.record.targets.push(target); }
      disconnect() { this.record.disconnected = true; }
    },
  });
  setup?.(win);
  const doc = win.document;
  const canvas: ChartCanvas = { width: 640, height: 400, getContext: () => new MockContext2D() };
  const chart = createChart({ container: canvas, config: { wasm: false, data } });
  const host = doc.createElement('div');
  doc.body.append(host);
  const calls: [string, number][] = [];
  const datafeed = { setSymbol: (symbol: string, ms: number) => { calls.push([symbol, ms]); } };
  const header = createChartHeader({ chart, document: doc as unknown as UIDocument, container: host as unknown as UIElement, ...options });
  const root = header.element as unknown as HTMLElement;
  const q = <T extends Element = HTMLElement>(selector: string) => doc.querySelector(selector) as unknown as T;
  const qa = (selector: string) => [...doc.querySelectorAll(selector)] as unknown as HTMLElement[];
  const click = (node: Element, detail = 1) => node.dispatchEvent(new win.MouseEvent('click', { bubbles: true, detail }));
  const key = (node: Element, k: string) => {
    const event = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    node.dispatchEvent(event);
    return event;
  };
  const tf = (label: string) => qa('.cts-header-tf').find((b) => b.textContent === label)!;
  const item = (label: string) => qa('.cts-item').find((b) => b.textContent?.includes(label))!;
  return { win, doc, chart, host, header, root, calls, datafeed, observers, q, qa, click, key, tf, item };
}

describe('chart header: layout', () => {
  it('renders symbol, timeframes, chart type, indicators, scale toggles and slots in order', () => {
    const win = new Window();
    windows.push(win);
    const left = [win.document.createElement('button'), win.document.createElement('span')] as unknown as UIElement[];
    const right = [win.document.createElement('button')] as unknown as UIElement[];
    left[0]!.textContent = 'L1'; left[1]!.textContent = 'L2'; right[0]!.textContent = 'R1';
    let indicators = 0;
    const m = mount({ symbol: 'BTC', onIndicators: () => { indicators++; }, slots: { left, right } });
    assert.equal(m.root.parentElement, m.host as unknown as HTMLElement, 'appended to the container');
    assert.equal(m.root.getAttribute('role'), 'group', 'every control is a tab stop, so no arrow-key toolbar role');
    assert.equal(m.root.getAttribute('aria-label'), 'Chart header');
    assert.ok(m.root.classList.contains('cts-theme') && m.root.classList.contains('cts-header'));
    assert.deepEqual([...m.root.children].map((c) => c.className.split(' ').find((n) => n.startsWith('cts-header-') && n !== 'cts-header-btn' && n !== 'cts-header-group')), [
      'cts-header-symbol', 'cts-header-timeframes', 'cts-header-tf-menu', 'cts-header-type', 'cts-header-indicators',
      'cts-header-slot', 'cts-header-spacer', 'cts-header-scale', 'cts-header-slot',
    ]);
    assert.equal(m.q('.cts-header-symbol').textContent, 'BTC');
    assert.equal(m.q('.cts-header-symbol').style.display, '');
    assert.deepEqual(m.qa('.cts-header-tf').map((b) => b.textContent), DEFAULT_TIMEFRAMES.map((t) => t.label));
    assert.deepEqual(m.qa('.cts-header-tf').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent), ['15m']);
    assert.equal(m.header.intervalMs, DEFAULT_HEADER_INTERVAL_MS);
    assert.equal(m.header.symbol, 'BTC');
    const type = m.q('.cts-header-type');
    assert.equal(type.title, 'Chart type: Candles');
    assert.equal(type.getAttribute('aria-haspopup'), 'menu');
    assert.ok(ICONS['chart-candlestick']!.includes('M7 3v2') && type.innerHTML.includes('M7 3v2'), 'candlestick icon');
    assert.ok(type.querySelector('.cts-caret'), 'disclosure chevron');
    assert.deepEqual(m.qa('.cts-header-menu')[1]!.querySelectorAll('.cts-item-label').length, DEFAULT_CHART_TYPES.length);
    const ind = m.q('.cts-header-indicators');
    assert.equal(ind.textContent, 'Indicators');
    m.click(ind);
    assert.equal(indicators, 1);
    assert.deepEqual(m.qa('.cts-header-scale-btn').map((b) => [b.textContent, b.getAttribute('aria-pressed')]), [['Auto', 'true'], ['%', 'false'], ['Log', 'false']]);
    assert.deepEqual([...m.q('.cts-header-slot-left').children].map((c) => c.textContent), ['L1', 'L2']);
    assert.deepEqual([...m.q('.cts-header-slot-right').children].map((c) => c.textContent), ['R1']);
    assert.equal(m.header.compact, false);
    m.header.destroy();
  });

  it('hides every omitted piece', () => {
    const m = mount({ timeframes: [], chartTypes: [], scaleButtons: false });
    assert.deepEqual([...m.root.children].map((c) => c.className), [
      'cts-header-symbol', 'cts-header-slot cts-header-slot-left', 'cts-header-spacer', 'cts-header-slot cts-header-slot-right',
    ]);
    assert.equal(m.q('.cts-header-symbol').style.display, 'none', 'no symbol, no label');
    assert.equal(m.q('.cts-header-slot-left').children.length, 0);
    m.header.setSymbol('');
    assert.equal(m.q('.cts-header-symbol').style.display, 'none', 'an empty label stays hidden');
    m.header.refresh();
    m.header.destroy();
  });

  it('shows a custom symbol label element and swaps it with setSymbol', () => {
    const win = new Window();
    windows.push(win);
    const badge = win.document.createElement('strong');
    badge.textContent = 'BTC-PERP';
    const m = mount({ symbol: 'BTC', symbolLabel: badge as unknown as UIElement });
    assert.equal(m.q('.cts-header-symbol').firstElementChild?.textContent, 'BTC-PERP');
    m.header.setSymbol('ETH', 'Ether');
    assert.equal(m.q('.cts-header-symbol').textContent, 'Ether');
    assert.equal(m.header.symbol, 'ETH');
    m.header.destroy();
  });

  it('injects the toolbar and header styles once per document', () => {
    const m = mount();
    const second = createChartHeader({ chart: m.chart, document: m.doc as unknown as UIDocument, container: m.host as unknown as UIElement });
    assert.equal(m.doc.head.querySelectorAll(`style[${STYLE_MARKER}]`).length, 1);
    const header = m.doc.head.querySelectorAll(`style[${HEADER_STYLE_MARKER}]`);
    assert.equal(header.length, 1);
    assert.equal(header[0]!.textContent, HEADER_CSS);
    assert.ok(m.doc.head.lastElementChild === header[0], 'header CSS comes after the toolbar CSS');
    assert.match(HEADER_CSS, /--cts-header-bg, var\(--cts-panel\)/);
    assert.doesNotMatch(HEADER_CSS, /border: 1px/, 'fill-only, zero-stroke controls');
    second.destroy();
    m.header.destroy();
  });
});

describe('chart header: timeframes', () => {
  it('drives the datafeed and marks the active timeframe', () => {
    const picked: HeaderTimeframe[] = [];
    const m2calls: [string, number][] = [];
    const m = mount({ symbol: 'BTC', onTimeframeChange: (t) => picked.push(t) });
    const m2 = mount({ symbol: 'BTC', datafeed: { setSymbol: (s, ms) => { m2calls.push([s, ms]); return Promise.resolve(); } } });
    m.click(m.tf('1h'));
    assert.deepEqual(picked.map((t) => t.label), ['1h'], 'no datafeed: the callback still fires');
    m2.click(m2.tf('1h'));
    assert.deepEqual(m2calls, [['BTC', 3_600_000]]);
    assert.equal(m2.header.intervalMs, 3_600_000);
    assert.equal(m2.tf('1h').getAttribute('aria-pressed'), 'true');
    assert.ok(m2.tf('1h').classList.contains('cts-active'));
    assert.equal(m2.tf('15m').getAttribute('aria-pressed'), 'false');
    m2.click(m2.tf('1h'));
    assert.equal(m2calls.length, 1, 're-picking the active timeframe is a no-op');
    m.header.destroy();
    m2.header.destroy();
  });

  it('waits for a symbol before calling the datafeed and follows setSymbol', () => {
    const picked: string[] = [];
    let m!: ReturnType<typeof mount>;
    m = mount({ onTimeframeChange: (t) => picked.push(t.label), datafeed: { setSymbol: (s, ms) => { m.calls.push([s, ms]); } } });
    m.click(m.tf('5m'));
    assert.deepEqual(m.calls, [], 'no symbol yet');
    assert.deepEqual(picked, ['5m']);
    m.header.setSymbol('SOL');
    assert.equal(m.q('.cts-header-symbol').textContent, 'SOL');
    assert.equal(m.q('.cts-header-symbol').style.display, '');
    m.click(m.tf('1d'));
    assert.deepEqual(m.calls, [['SOL', 86_400_000]]);
    m.header.destroy();
  });

  it('reflects setInterval without calling anything, labelling unknown intervals', () => {
    let m!: ReturnType<typeof mount>;
    m = mount({ symbol: 'BTC', intervalMs: 3_600_000, datafeed: { setSymbol: (s, ms) => { m.calls.push([s, ms]); } } });
    assert.equal(m.tf('1h').getAttribute('aria-pressed'), 'true');
    const label = () => m.q('.cts-header-tf-label').textContent;
    assert.equal(label(), '1h');
    for (const [ms, text] of [[7_200_000, '2h'], [120_000, '2m'], [172_800_000, '2d'], [1_209_600_000, '2w'], [5_184_000_000, '2M'], [90_000, '90s'], [1500, '1500ms']] as const) {
      m.header.setInterval(ms);
      assert.equal(label(), text);
      assert.equal(m.q('.cts-header-tf-menu').title, `Timeframe: ${text}`);
    }
    assert.equal(m.qa('.cts-header-tf.cts-active').length, 0);
    assert.deepEqual(m.calls, []);
    m.header.setInterval(60_000);
    assert.equal(m.tf('1m').getAttribute('aria-pressed'), 'true');
    m.header.destroy();
  });

  it('accepts a custom timeframe list', () => {
    const timeframes = [{ label: '30s', intervalMs: 30_000 }, { label: '2h', intervalMs: 7_200_000 }];
    const m = mount({ timeframes, intervalMs: 30_000 });
    assert.deepEqual(m.qa('.cts-header-tf').map((b) => [b.textContent, b.getAttribute('aria-pressed')]), [['30s', 'true'], ['2h', 'false']]);
    m.header.destroy();
  });
});

describe('chart header: chart type menu', () => {
  it('opens below its button, applies the type and updates the icon', () => {
    const changes: SeriesType[] = [];
    const m = mount({ onChartTypeChange: (t) => changes.push(t) });
    const type = m.q('.cts-header-type');
    Object.defineProperty(type, 'getBoundingClientRect', { value: () => ({ left: 200, right: 236, top: 6, bottom: 34, width: 36, height: 28 }) });
    m.click(type);
    const menu = m.qa('.cts-header-menu')[1]!;
    assert.ok(menu.classList.contains('cts-open'));
    assert.ok(type.classList.contains('cts-open'));
    assert.equal(menu.style.top, '38px', 'drops below the button');
    assert.equal(menu.style.left, '200px');
    assert.equal(m.item('Candles').getAttribute('aria-checked'), 'true');
    assert.equal(m.item('Candles').getAttribute('role'), 'menuitemradio');
    m.click(m.item('Line'));
    assert.equal(m.chart.getConfig().series.type, 'line');
    assert.deepEqual(changes, ['line']);
    assert.ok(!menu.classList.contains('cts-open'), 'closes after a pick');
    assert.ok(!type.classList.contains('cts-open'));
    assert.equal(type.title, 'Chart type: Line');
    assert.equal(type.getAttribute('aria-label'), 'Chart type: Line');
    assert.ok(ICONS['chart-line']!.includes('m6 15 4-5 4 3 5-7') && type.innerHTML.includes('m6 15 4-5 4 3 5-7'), 'line icon');
    assert.ok(!type.innerHTML.includes('M7 3v2'));
    assert.ok(type.querySelector('.cts-caret'), 'keeps the chevron');
    assert.equal(m.item('Line').getAttribute('aria-checked'), 'true');
    assert.equal(m.item('Candles').getAttribute('aria-checked'), 'false');
    m.click(type);
    m.click(m.item('Line'));
    assert.deepEqual(changes, ['line'], 're-picking the current type is a no-op');
    m.click(type);
    m.click(type);
    assert.ok(!menu.classList.contains('cts-open'), 'the button toggles');
    m.header.destroy();
  });

  it('labels every chart type with its icon', () => {
    const m = mount({ chartTypes: ['bar', 'histogram', 'area'] });
    assert.deepEqual(m.qa('.cts-header-menu')[1]!.querySelectorAll('.cts-item-label').length, 3);
    assert.deepEqual([...m.qa('.cts-header-menu')[1]!.querySelectorAll('.cts-item-label')].map((n) => n.textContent), ['Bars', 'Columns', 'Area']);
    assert.equal(CHART_TYPE_LABELS['hollow-candlestick'], 'Hollow candles');
    assert.equal(m.qa('.cts-header-menu')[1]!.querySelectorAll('.cts-active').length, 0, 'candlestick is not offered');
    m.header.setChartType('histogram');
    assert.equal(m.chart.getConfig().series.type, 'histogram');
    assert.equal(m.item('Columns').getAttribute('aria-checked'), 'true');
    m.header.destroy();
  });

  it('setChartType applies without the callback; outside changes show after the render', () => {
    const changes: SeriesType[] = [];
    const m = mount({ onChartTypeChange: (t) => changes.push(t) });
    m.header.setChartType('heikin-ashi');
    assert.equal(m.chart.getConfig().series.type, 'heikin-ashi');
    assert.equal(m.q('.cts-header-type').title, 'Chart type: Heikin Ashi');
    m.header.setChartType('heikin-ashi');
    assert.deepEqual(changes, []);
    m.chart.updateConfig({ series: { type: 'area' } });
    assert.equal(m.q('.cts-header-type').title, 'Chart type: Area', 'no refresh or pointer needed');
    assert.equal(m.item('Area').getAttribute('aria-checked'), 'true');
    m.chart.batch(() => {
      m.chart.updateConfig({ series: { type: 'bar' } });
      assert.equal(m.q('.cts-header-type').title, 'Chart type: Area', 'a batch defers the render');
      m.header.refresh();
      assert.equal(m.q('.cts-header-type').title, 'Chart type: Bars', 'refresh reads the config at once');
    });
    const type = m.q('.cts-header-type');
    m.header.destroy();
    m.chart.updateConfig({ series: { type: 'line' } });
    assert.equal(type.title, 'Chart type: Bars', 'destroyed headers stop following');
  });

  it('falls back to the raw type string for a custom series without a label', () => {
    const m = mount({ chartTypes: ['candlestick', 'line'] });
    m.chart.registerSeries('stairs', () => undefined);
    m.chart.updateConfig({ series: { type: 'stairs' } });
    const type = m.q('.cts-header-type');
    assert.equal(type.title, 'Chart type: stairs', 'no CHART_TYPE_LABELS entry, so the type itself shows');
    assert.equal(type.getAttribute('aria-label'), 'Chart type: stairs');
    assert.equal(m.qa('.cts-header-menu')[1]!.querySelectorAll('.cts-active').length, 0, 'no offered type matches');
    assert.deepEqual([...m.qa('.cts-header-menu')[1]!.querySelectorAll('.cts-item')].map((n) => (n as HTMLElement).getAttribute('aria-checked')), ['false', 'false']);
    m.header.setChartType('line');
    assert.equal(type.title, 'Chart type: Line', 'labelled types still use CHART_TYPE_LABELS');
    m.header.destroy();
  });
});

describe('chart header: keyboard', () => {
  it('opens menus onto the checked entry and moves with arrows, Home/End and Escape', () => {
    const m = mount({ compact: true });
    const btn = m.q('.cts-header-tf-menu');
    btn.focus();
    m.click(btn, 0);
    const active = () => m.doc.activeElement?.textContent;
    assert.equal(active(), '15m', 'keyboard open focuses the selected timeframe');
    const menu = m.qa('.cts-header-menu')[0]!;
    assert.ok(m.key(m.doc.activeElement!, 'ArrowDown').defaultPrevented);
    assert.equal(active(), '1h');
    m.key(m.doc.activeElement!, 'ArrowUp');
    m.key(m.doc.activeElement!, 'ArrowUp');
    assert.equal(active(), '5m');
    m.key(m.doc.activeElement!, 'End');
    assert.equal(active(), '1M');
    m.key(m.doc.activeElement!, 'ArrowDown');
    assert.equal(active(), '1m', 'wraps to the top');
    m.key(m.doc.activeElement!, 'ArrowUp');
    assert.equal(active(), '1M', 'wraps to the bottom');
    m.key(m.doc.activeElement!, 'Home');
    assert.equal(active(), '1m');
    assert.equal(m.key(m.doc.activeElement!, 'x').defaultPrevented, false, 'other keys pass through');
    assert.ok(m.key(m.doc.activeElement!, 'Escape').defaultPrevented);
    assert.ok(!menu.classList.contains('cts-open'));
    assert.equal(m.doc.activeElement, btn, 'focus returns to the button');
    assert.equal(m.key(btn, 'ArrowDown').defaultPrevented, false, 'ignored while closed');
    m.click(btn);
    assert.ok(menu.classList.contains('cts-open'));
    assert.equal(m.doc.activeElement, btn, 'a mouse open keeps focus on the button');
    m.key(btn, 'ArrowDown');
    assert.equal(active(), '1m', 'arrows from the button enter the menu');
    m.key(btn, 'Escape');
    m.click(btn);
    m.key(btn, 'ArrowUp');
    assert.equal(active(), '1M');
    m.click(m.doc.activeElement!);
    assert.equal(m.header.intervalMs, 2_592_000_000, 'Enter/click on an item picks it');
    assert.equal(m.q('.cts-header-tf-label').textContent, '1M');
    m.header.destroy();
  });

  it('focuses the first entry when nothing is checked', () => {
    const m = mount({ chartTypes: ['line', 'area'] });
    const type = m.q('.cts-header-type');
    m.click(type, 0);
    assert.equal(m.doc.activeElement?.textContent, 'Line');
    m.header.destroy();
  });

  it('returns focus to the menu button after a keyboard pick', () => {
    const m = mount({ compact: true });
    const type = m.q('.cts-header-type');
    type.focus();
    m.click(type, 0);
    m.key(m.doc.activeElement!, 'ArrowDown');
    assert.equal(m.doc.activeElement?.textContent, 'Hollow candles');
    m.click(m.doc.activeElement!, 0);
    assert.equal(m.chart.getConfig().series.type, 'hollow-candlestick');
    assert.equal(m.doc.activeElement, type, 'focus lands back on the chart-type button, not <body>');
    const tfBtn = m.q('.cts-header-tf-menu');
    tfBtn.focus();
    m.click(tfBtn, 0);
    m.key(m.doc.activeElement!, 'ArrowDown');
    m.click(m.doc.activeElement!, 0);
    assert.equal(m.header.intervalMs, 3_600_000);
    assert.equal(m.doc.activeElement, tfBtn, 'the timeframe dropdown does the same');
    const elsewhere = m.doc.createElement('button');
    m.doc.body.append(elsewhere);
    m.click(type);
    elsewhere.focus();
    m.click(m.item('Area'));
    assert.equal(m.chart.getConfig().series.type, 'area');
    assert.equal(m.doc.activeElement, elsewhere, 'a pointer pick with focus outside the menu leaves focus alone');
    m.header.destroy();
  });

  it('mirrors the open state in aria-expanded, however the menu closes', () => {
    const m = mount();
    const type = m.q('.cts-header-type');
    const tfBtn = m.q('.cts-header-tf-menu');
    assert.equal(type.getAttribute('aria-expanded'), 'false');
    assert.equal(tfBtn.getAttribute('aria-expanded'), 'false');
    m.click(type);
    assert.equal(type.getAttribute('aria-expanded'), 'true');
    m.click(type);
    assert.equal(type.getAttribute('aria-expanded'), 'false', 'toggled shut');
    m.click(type);
    m.click(m.item('Line'));
    assert.equal(type.getAttribute('aria-expanded'), 'false', 'after a pick');
    m.click(type);
    m.doc.body.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(type.getAttribute('aria-expanded'), 'false', 'after an outside press');
    m.click(type);
    m.click(tfBtn);
    assert.equal(type.getAttribute('aria-expanded'), 'false', 'after another menu opened');
    assert.equal(tfBtn.getAttribute('aria-expanded'), 'true');
    m.key(tfBtn, 'Escape');
    assert.equal(tfBtn.getAttribute('aria-expanded'), 'false', 'after Escape');
    m.header.destroy();
  });

  it('Tab closes the menu and carries on from its button', () => {
    const m = mount();
    const type = m.q('.cts-header-type');
    const menu = m.qa('.cts-header-menu')[1]!;
    type.focus();
    m.click(type, 0);
    const tab = m.key(m.doc.activeElement!, 'Tab');
    assert.equal(tab.defaultPrevented, false, 'the browser still moves focus on');
    assert.ok(!menu.classList.contains('cts-open'));
    assert.equal(type.getAttribute('aria-expanded'), 'false');
    assert.equal(m.doc.activeElement, type, 'Tab continues from the button, not the detached menu');
    m.click(type);
    const other = m.doc.createElement('button');
    m.doc.body.append(other);
    other.focus();
    m.key(type, 'Tab');
    assert.ok(!menu.classList.contains('cts-open'), 'Tab from the button closes a mouse-opened menu too');
    assert.equal(m.doc.activeElement, other, 'without moving focus');
    assert.equal(m.key(type, 'Tab').defaultPrevented, false, 'ignored while closed');
    m.header.destroy();
  });
});

describe('chart header: datafeed as the source of truth', () => {
  type State = { symbol: string | null; intervalMs: number | null };
  function feed(initial: State, subscribe = true) {
    const calls: [string, number][] = [];
    const listeners = new Set<(state: State) => void>();
    const df = {
      ...initial,
      setSymbol(symbol: string, intervalMs: number) { calls.push([symbol, intervalMs]); df.emit({ symbol, intervalMs }); return Promise.resolve(); },
      emit(state: State) { df.symbol = state.symbol; df.intervalMs = state.intervalMs; for (const l of listeners) l(state); },
      ...(subscribe ? { subscribeState(l: (state: State) => void) { listeners.add(l); return () => listeners.delete(l); } } : {}),
    };
    return { df, calls, listeners };
  }

  it('starts from the datafeed and reloads its symbol on a pick', () => {
    const f = feed({ symbol: 'ETH', intervalMs: 3_600_000 });
    const m = mount({ datafeed: f.df });
    assert.equal(m.header.symbol, 'ETH');
    assert.equal(m.q('.cts-header-symbol').textContent, 'ETH');
    assert.equal(m.header.intervalMs, 3_600_000);
    assert.equal(m.tf('1h').getAttribute('aria-pressed'), 'true', 'shows the loaded interval, not 15m');
    m.click(m.tf('1h'));
    assert.deepEqual(f.calls, [], 'the loaded interval is a no-op');
    m.click(m.tf('15m'));
    assert.deepEqual(f.calls, [['ETH', 900_000]], '15m is selectable straight away');
    const stale = mount({ datafeed: f.df, symbol: 'BTC', intervalMs: 60_000 });
    assert.equal(stale.header.symbol, 'ETH', 'what the datafeed has loaded beats stale options');
    assert.equal(stale.header.intervalMs, 900_000);
    stale.header.destroy();
    const badge = m.doc.createElement('b');
    badge.textContent = 'Ether';
    const labelled = mount({ datafeed: f.df, symbolLabel: badge as unknown as UIElement });
    assert.equal(labelled.q('.cts-header-symbol').textContent, 'Ether', 'a custom label for the loaded symbol stays');
    labelled.header.destroy();
    m.header.destroy();
  });

  it('follows switches made elsewhere and stops on destroy', () => {
    const f = feed({ symbol: null, intervalMs: null });
    const m = mount({ datafeed: f.df });
    assert.equal(m.header.symbol, undefined, 'nothing loaded yet');
    assert.equal(m.header.intervalMs, DEFAULT_HEADER_INTERVAL_MS);
    f.df.emit({ symbol: null, intervalMs: null });
    assert.equal(m.header.symbol, undefined, 'null states are ignored');
    const sized = { client: 800, expanded: 700 };
    Object.defineProperty(m.root, 'clientWidth', { get: () => sized.client });
    Object.defineProperty(m.root, 'scrollWidth', { get: () => (m.root.classList.contains('cts-header-compact') ? sized.client : sized.expanded) });
    sized.expanded = 900;
    f.df.emit({ symbol: 'SOL', intervalMs: 14_400_000 });
    assert.equal(m.header.symbol, 'SOL');
    assert.equal(m.q('.cts-header-symbol').textContent, 'SOL');
    assert.equal(m.tf('4h').getAttribute('aria-pressed'), 'true');
    assert.equal(m.header.compact, true, 'a longer bar re-fits');
    m.header.setInterval(60_000);
    f.df.emit({ symbol: 'SOL', intervalMs: 14_400_000 });
    assert.equal(m.header.intervalMs, 14_400_000, 'an unchanged symbol still brings the interval back');
    f.df.emit({ symbol: 'SOL', intervalMs: 14_400_000 });
    assert.equal(m.header.symbol, 'SOL', 'unchanged states change nothing');
    m.header.setSymbol('BTC');
    m.click(m.tf('1d'));
    assert.deepEqual(f.calls, [['SOL', 86_400_000]], 'the loaded symbol wins over a stale header symbol');
    assert.equal(m.header.symbol, 'SOL', 'and the header follows the reload');
    assert.equal(f.listeners.size, 1);
    m.header.destroy();
    assert.equal(f.listeners.size, 0, 'unsubscribed');
  });

  it('refresh() catches up with a datafeed that cannot report changes', () => {
    const f = feed({ symbol: 'BTC', intervalMs: 900_000 }, false);
    const picked: string[] = [];
    const m = mount({ datafeed: f.df, onTimeframeChange: (tf) => picked.push(tf.label) });
    f.df.emit({ symbol: 'ETH', intervalMs: 3_600_000 });
    assert.equal(m.header.symbol, 'BTC', 'no subscribeState: stale until refreshed');
    m.click(m.tf('15m'));
    assert.deepEqual(f.calls, [['ETH', 900_000]], 'a pick still reloads the loaded symbol at the shown interval');
    assert.deepEqual(picked, ['15m']);
    f.df.emit({ symbol: 'ETH', intervalMs: 3_600_000 });
    m.header.refresh();
    assert.equal(m.header.symbol, 'ETH');
    assert.equal(m.tf('1h').getAttribute('aria-pressed'), 'true');
    m.header.destroy();
  });
});

describe('chart header: scale toggles', () => {
  it('follows the toolbar shortcuts and any updateConfig with no pointer or refresh', () => {
    const m = mount();
    const stage = m.doc.createElement('div');
    const rail = m.doc.createElement('div');
    m.doc.body.append(rail, stage);
    const toolbar = createDrawingToolbar({ chart: m.chart, document: m.doc as unknown as UIDocument, canvas: stage as unknown as UIElement,
      rail: rail as unknown as UIElement, overlay: stage as unknown as UIElement, navigation: false, applyChartTheme: false });
    const pressed = () => m.qa('.cts-header-scale-btn').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
    const alt = (code: string) => m.doc.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: code.slice(3).toLowerCase(), code, altKey: true, bubbles: true }));
    alt('KeyL');
    assert.equal(m.chart.getConfig().priceAxis.mode, 'logarithmic');
    assert.deepEqual(pressed(), ['Auto', 'Log'], 'Alt+L shows at once');
    alt('KeyP');
    assert.deepEqual(pressed(), ['Auto', '%'], 'Alt+P shows at once');
    m.chart.updateConfig({ priceAxis: { autoScale: false, mode: 'regular' } });
    assert.deepEqual(pressed(), [], 'so does a settings-panel or host updateConfig');
    toolbar.destroy();
    m.header.destroy();
  });

  it('toggles auto, percent and log, mutually exclusive, and reflects outside changes', () => {
    const m = mount();
    const btn = (label: string) => m.qa('.cts-header-scale-btn').find((b) => b.textContent === label)!;
    const pressed = () => m.qa('.cts-header-scale-btn').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
    assert.equal(m.q('.cts-header-scale').getAttribute('aria-label'), 'Price scale');
    m.chart.updateConfig({ priceAxis: { lockPriceToBarRatio: true } });
    m.click(btn('Log'));
    assert.equal(m.chart.getConfig().priceAxis.mode, 'logarithmic');
    assert.equal(m.chart.getConfig().priceAxis.priceToBarRatio, null, 'releases the ratio like Alt+L');
    assert.deepEqual(pressed(), ['Auto', 'Log']);
    assert.ok(btn('Log').classList.contains('cts-on'));
    m.click(btn('%'));
    assert.equal(m.chart.getConfig().priceAxis.mode, 'percent');
    assert.deepEqual(pressed(), ['Auto', '%']);
    m.click(btn('%'));
    assert.equal(m.chart.getConfig().priceAxis.mode, 'regular');
    m.click(btn('Auto'));
    assert.equal(m.chart.getConfig().priceAxis.autoScale, false);
    assert.deepEqual(pressed(), []);
    m.chart.updateConfig({ priceAxis: { mode: 'indexed', autoScale: true } });
    m.header.refresh();
    assert.deepEqual(pressed(), ['Auto'], 'indexed presses neither % nor Log');
    m.click(btn('Log'));
    assert.equal(m.chart.getConfig().priceAxis.mode, 'logarithmic', 'Log from indexed');
    m.header.destroy();
  });
});

describe('chart header: flyouts, theme and tokens', () => {
  it('shares the toolbar flyouts, one menu open at a time, and leaves them usable after destroy', () => {
    const m = mount({}, undefined);
    m.header.destroy();
    const stage = m.doc.createElement('div');
    const canvasEl = m.doc.createElement('div');
    const rail = m.doc.createElement('div');
    stage.append(canvasEl);
    m.doc.body.append(rail, stage);
    const toolbar = createDrawingToolbar({ chart: m.chart, document: m.doc as unknown as UIDocument, canvas: canvasEl as unknown as UIElement,
      rail: rail as unknown as UIElement, overlay: stage as unknown as UIElement, navigation: false, applyChartTheme: false });
    const before = m.doc.body.children.length;
    const header = createChartHeader({ chart: m.chart, document: m.doc as unknown as UIDocument, container: m.host as unknown as UIElement, flyouts: toolbar.flyouts, theme: 'light' });
    assert.equal(m.doc.body.children.length, before, 'no extra portal');
    const menus = m.qa('.cts-header-menu');
    assert.equal(menus.length, 2);
    assert.ok(menus.every((menu) => menu.parentElement === toolbar.flyouts.portal as unknown as HTMLElement));
    assert.ok(header.element.classList.contains('cts-light'));
    assert.ok(!(toolbar.flyouts.portal as unknown as HTMLElement).classList.contains('cts-light'), 'the shared portal belongs to the toolbar');
    const type = m.q('.cts-header-type');
    m.click(type);
    assert.equal(toolbar.flyouts.open, menus[1] as unknown as UIElement);
    m.doc.body.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(toolbar.flyouts.open, null, 'outside press closes it');
    m.click(type);
    header.destroy();
    assert.equal(toolbar.flyouts.open, null, 'destroy closes its open menu');
    assert.equal(m.qa('.cts-header-menu').length, 0);
    assert.equal(m.qa('.cts-header').length, 0);
    const menu = toolbar.flyouts.create();
    toolbar.flyouts.show(menu, rail as unknown as UIElement);
    assert.equal(toolbar.flyouts.open, menu, 'the shared flyouts still work');
    toolbar.destroy();
  });

  it('owns and removes its own portal, themes it and applies tokens', () => {
    const m = mount({ theme: 'light', tokens: BLOXWAP_HEADER_TOKENS });
    const portal = m.qa('.cts-header-menu')[0]!.parentElement as HTMLElement;
    assert.ok(portal.classList.contains('cts-theme') && portal.classList.contains('cts-light'));
    assert.ok(m.root.classList.contains('cts-light'));
    assert.equal(m.root.style.getPropertyValue('--cts-header-accent'), '#00ff3f');
    assert.equal(m.root.style.getPropertyValue('--cts-header-bg'), '#171717');
    assert.equal(m.root.style.getPropertyValue('--cts-header-radius'), '9999px');
    for (const menu of m.qa('.cts-header-menu')) {
      assert.equal(menu.style.getPropertyValue('--cts-accent'), '#00ff3f', 'menus match');
      assert.equal(menu.style.getPropertyValue('--cts-edge'), 'transparent', 'borderless menus');
    }
    m.header.setTheme('dark');
    assert.ok(!m.root.classList.contains('cts-light'));
    assert.ok(!portal.classList.contains('cts-light'));
    m.header.setTheme('light');
    assert.ok(m.root.classList.contains('cts-light'));
    m.click(m.q('.cts-header-type'));
    m.header.destroy();
    assert.equal(portal.parentElement, null, 'portal removed');
    assert.equal(m.root.parentElement, null, 'bar removed');
  });

  it('puts tokens on its menus, so they also reach a shared toolbar portal', () => {
    const m = mount({}, undefined);
    m.header.destroy();
    const stage = m.doc.createElement('div');
    const rail = m.doc.createElement('div');
    m.doc.body.append(rail, stage);
    const toolbar = createDrawingToolbar({ chart: m.chart, document: m.doc as unknown as UIDocument, canvas: stage as unknown as UIElement,
      rail: rail as unknown as UIElement, overlay: stage as unknown as UIElement, navigation: false, applyChartTheme: false });
    const header = createChartHeader({ chart: m.chart, document: m.doc as unknown as UIDocument, container: m.host as unknown as UIElement,
      flyouts: toolbar.flyouts, tokens: BLOXWAP_HEADER_TOKENS });
    const menus = m.qa('.cts-header-menu');
    assert.ok(menus.every((menu) => menu.parentElement === toolbar.flyouts.portal as unknown as HTMLElement));
    for (const menu of menus) {
      assert.equal(menu.style.getPropertyValue('--cts-panel'), '#171717');
      assert.equal(menu.style.getPropertyValue('--cts-edge'), 'transparent', 'zero-stroke menus in the shared portal');
    }
    assert.equal((toolbar.flyouts.portal as unknown as HTMLElement).style.getPropertyValue('--cts-panel'), '', 'the portal itself is untouched');
    m.click(m.q('.cts-header-type'));
    const menu = menus[1]!;
    assert.ok(menu.style.top !== '' && menu.style.getPropertyValue('--cts-accent') === '#00ff3f', 'placement keeps the tokens');
    header.destroy();
    toolbar.destroy();
  });

  it('removes every listener on destroy', () => {
    let indicators = 0;
    let m!: ReturnType<typeof mount>;
    m = mount({ symbol: 'BTC', onIndicators: () => { indicators++; }, datafeed: { setSymbol: (s, ms) => { m.calls.push([s, ms]); } } });
    const tfButton = m.tf('1h');
    const tfItem = m.item('4h');
    const typeItem = m.item('Area');
    const log = m.qa('.cts-header-scale-btn')[2]!;
    const ind = m.q('.cts-header-indicators');
    const observer = m.observers.find((o) => o.targets.includes(m.root))!;
    m.header.destroy();
    assert.ok(observer.disconnected);
    for (const node of [tfButton, tfItem, typeItem, log, ind]) m.click(node);
    assert.deepEqual(m.calls, []);
    assert.equal(indicators, 0);
    assert.equal(m.chart.getConfig().series.type, 'candlestick');
    assert.equal(m.chart.getConfig().priceAxis.mode, 'regular');
    assert.equal(m.header.intervalMs, DEFAULT_HEADER_INTERVAL_MS);
  });
});

describe('chart header: responsive compaction', () => {
  /** Simulated layout: the content is `expanded` px wide, or `collapsed` px while compact. */
  function sized(m: ReturnType<typeof mount>) {
    const size = { client: 800, expanded: 800, collapsed: 500 };
    Object.defineProperty(m.root, 'clientWidth', { get: () => size.client });
    Object.defineProperty(m.root, 'scrollWidth', {
      get: () => Math.max(size.client, m.root.classList.contains('cts-header-compact') ? size.collapsed : size.expanded),
    });
    const observer = m.observers.find((o) => o.targets.includes(m.root))!;
    return {
      size, observer,
      resize(client: number, expanded = size.expanded) { size.client = client; size.expanded = expanded; observer.callback(); },
    };
  }

  it('collapses the timeframes into a dropdown when the bar overflows and expands once it fits', () => {
    let m!: ReturnType<typeof mount>;
    m = mount({ symbol: 'BTC', onIndicators: () => undefined, datafeed: { setSymbol: (s, ms) => { m.calls.push([s, ms]); } } });
    const s = sized(m);
    s.resize(800, 760);
    assert.equal(m.header.compact, false);
    s.resize(420);
    assert.equal(m.header.compact, true);
    assert.ok(m.root.classList.contains('cts-header-compact'));
    assert.equal(m.q('.cts-header-tf-label').textContent, '15m');
    s.resize(700);
    assert.equal(m.header.compact, true, 'still narrower than the expanded bar needs');
    m.click(m.q('.cts-header-tf-menu'));
    m.click(m.item('4h'));
    assert.deepEqual(m.calls, [['BTC', 14_400_000]], 'the dropdown drives the datafeed too');
    assert.equal(m.q('.cts-header-tf-label').textContent, '4h');
    assert.equal(m.tf('4h').getAttribute('aria-pressed'), 'true', 'the strip stays in sync while hidden');
    s.resize(760);
    assert.equal(m.header.compact, false, 'expands once the expanded bar fits');
    s.size.expanded = 900;
    m.header.refresh();
    assert.equal(m.header.compact, true, 'refresh re-fits too');
    m.header.destroy();
  });

  it('re-fits when its own content grows or shrinks, with no resize of the bar', () => {
    const win = new Window();
    windows.push(win);
    const slot = win.document.createElement('button') as unknown as UIElement;
    const m = mount({ symbol: 'BTC', slots: { right: [slot] } });
    const s = sized(m);
    s.resize(760, 740);
    assert.equal(m.header.compact, false);
    for (const piece of ['.cts-header-symbol', '.cts-header-slot-left', '.cts-header-slot-right']) {
      assert.ok(s.observer.targets.includes(m.q(piece)), `observes ${piece}`);
    }
    s.size.expanded = 900;
    m.header.setSymbol('1000PEPE-USDC-PERPETUAL');
    assert.equal(m.header.compact, true, 'a longer symbol compacts at once');
    s.size.expanded = 700;
    m.header.setSymbol('BTC');
    assert.equal(m.header.compact, false, 'and a shorter one expands again');
    s.size.expanded = 780;
    m.header.setInterval(3_600_000);
    assert.equal(m.header.compact, true, 'setInterval re-fits too');
    s.size.expanded = 740;
    s.observer.callback();
    assert.equal(m.header.compact, false, 'slot content shrinking is observed');
    m.header.destroy();
  });

  it('can be forced compact or expanded, and works without ResizeObserver', () => {
    const forced = mount({ compact: true });
    assert.equal(forced.header.compact, true);
    forced.header.destroy();
    const never = mount({ compact: false });
    const s = sized(never);
    s.resize(100, 900);
    assert.equal(never.header.compact, false);
    never.header.destroy();
    const plain = mount({}, (win) => Object.defineProperty(win, 'ResizeObserver', { configurable: true, value: undefined }));
    assert.equal(plain.observers.length, 0);
    Object.defineProperty(plain.root, 'clientWidth', { value: 300 });
    Object.defineProperty(plain.root, 'scrollWidth', { value: 900 });
    plain.header.refresh();
    assert.equal(plain.header.compact, true);
    plain.header.destroy();
  });
});

describe('Flyouts placement', () => {
  function flyouts(innerWidth?: number) {
    const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
    windows.push(win);
    if (innerWidth === undefined) Object.defineProperty(win, 'innerWidth', { value: undefined });
    else Object.defineProperty(win, 'innerWidth', { value: innerWidth });
    const doc = win.document as unknown as UIDocument;
    const portal = win.document.createElement('div');
    win.document.body.append(portal);
    const f = new Flyouts(doc, portal as unknown as UIElement);
    const anchor = win.document.createElement('button') as unknown as UIElement;
    return { win, f, anchor, at(rect: object) { Object.defineProperty(anchor, 'getBoundingClientRect', { configurable: true, value: () => rect }); } };
  }

  it("drops 'below' menus under the anchor, flips them above near the bottom and clamps to the viewport", () => {
    const h = flyouts(1200);
    const menu = h.f.create('', 'below');
    Object.defineProperty(menu, 'offsetHeight', { value: 200 });
    Object.defineProperty(menu, 'offsetWidth', { value: 240 });
    h.at({ left: 100, right: 140, top: 10, bottom: 40 });
    h.f.show(menu, h.anchor);
    assert.deepEqual([menu.style.left, menu.style.top], ['100px', '44px']);
    h.f.close();
    h.at({ left: 1100, right: 1140, top: 700, bottom: 730 });
    h.f.show(menu, h.anchor);
    assert.deepEqual([menu.style.left, menu.style.top], ['952px', '496px'], 'flipped above and clamped left');
    h.f.close();
    h.at({ left: 10, right: 40, top: 100, bottom: 700 });
    h.f.show(menu, h.anchor);
    assert.equal(menu.style.top, '8px', 'never above the viewport');
    h.f.destroy();
    const n = flyouts();
    const loose = n.f.create('', 'below');
    n.at({ left: 1500, right: 1540, top: 0, bottom: 20 });
    n.f.show(loose, n.anchor);
    assert.equal(loose.style.left, '1500px', 'no innerWidth: aligned to the anchor');
    n.f.destroy();
  });

  it('clears cts-open from an unregistered opener on close', () => {
    const h = flyouts(1200);
    const menu = h.f.create();
    h.at({ left: 0, right: 20, top: 0, bottom: 20 });
    h.f.toggle(menu, h.anchor);
    assert.ok(h.anchor.classList.contains('cts-open'));
    h.f.toggle(menu, h.anchor);
    assert.ok(!h.anchor.classList.contains('cts-open'));
    h.f.destroy();
  });
});
