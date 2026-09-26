import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type HTMLInputElement, type HTMLSelectElement } from 'happy-dom';
import { createChart, MockDocument, MockCanvas, MockContext2D, PriceScale, TimeScale, resolveConfig, type Candle } from '../dist/index.js';
import { drawCandlesticks } from '../dist/series/candlestick.js';
import { createChartSettings, createDrawingToolbar, type UIDocument, type UIElement } from '../dist/ui/index.js';
import { matchesSettingsSearch } from '../dist/ui/settings-search.js';

const data: Candle[] = Array.from({ length: 200 }, (_, i) => ({ time: 1700000000 + i * 60, open: 100 + i, high: 104 + i, low: 98 + i, close: 102 + i, volume: 1000 }));
const near = (a: number, b: number): void => { assert.ok(Math.abs(a - b) < 1e-7, `${a} ≠ ${b}`); };
const windows: Window[] = [];
after(() => { for (const win of windows) void win.happyDOM.close(); });

describe('price settings', () => {
  it('round-trips all scale modes, inverted axes and negative/zero data', () => {
    for (const mode of ['regular', 'percent', 'indexed', 'logarithmic'] as const) {
      for (const [min, max, base] of [[10, 1000, 100], [-100, 100, -50], [0, 1, 0]]) {
        for (const inverted of [false, true]) {
          const scale = new PriceScale(); scale.height = 400; scale.mode = mode; scale.inverted = inverted; scale.basePrice = base;
          scale.setRange(min, max);
          for (const value of [min, (min + max) / 2, max]) near(scale.yToPrice(scale.priceToY(value)), value);
          assert.equal(scale.priceToY(max) > scale.priceToY(min), inverted);
          assert.ok(scale.ticks().every(Number.isFinite));
        }
      }
    }
  });

  it('uses geometric spacing for log and transformed values for labels', () => {
    const scale = new PriceScale(); scale.height = 400; scale.setRange(10, 1000); scale.mode = 'logarithmic';
    near(scale.priceToY(100), (scale.priceToY(10) + scale.priceToY(1000)) / 2);
    scale.basePrice = 100; scale.mode = 'percent';
    assert.equal(scale.format(110, String), '10.00%');
    scale.mode = 'indexed'; assert.equal(scale.format(110, String, 3), '110.000');
    scale.mode = 'regular'; assert.equal(scale.format(110, (v) => `$${v}`), '$110');
    assert.equal(scale.format(110, String, 4), '110.0000');
  });

  it('freezes the price range when auto is disabled and fits new data when re-enabled', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data } });
    chart.updateConfig({ priceAxis: { autoScale: false } });
    const y = chart.scale.priceToY(300);
    chart.appendData({ ...data[199], time: data[199].time + 60, high: 1000, close: 999 });
    near(chart.scale.priceToY(300), y);
    chart.updateConfig({ priceAxis: { autoScale: true } });
    assert.notEqual(chart.scale.priceToY(300), y);
    assert.ok(chart.scale.priceToY(1000) > 0);
  });

  it('keeps a locked ratio across zoom and resize', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data } });
    const ratio = chart.scale.priceToBarRatio();
    chart.updateConfig({ priceAxis: { lockPriceToBarRatio: true } });
    chart.scale.zoom(2); near(chart.scale.priceToBarRatio(), ratio);
    chart.resize(900, 800); near(chart.scale.priceToBarRatio(), ratio);
    chart.updateConfig({ priceAxis: { priceToBarRatio: 2 } }); near(chart.scale.priceToBarRatio(), 2);
    chart.updateConfig({ priceAxis: { lockPriceToBarRatio: false } });
    assert.notEqual(chart.scale.priceToBarRatio(), 2);
  });

  it('can exclude distant overlay values from autoscale', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data } });
    const y = chart.scale.priceToY(200);
    chart.indicators.register({ name: 'distant', defaultParams: {}, defaultColors: ['#fff'], defaultPane: 'main',
      compute: (candles) => ({ pane: 'main', lines: [{ key: 'far', color: '#fff', values: candles.map(() => 10000) }] }) });
    chart.addIndicator({ name: 'distant' });
    assert.notEqual(chart.scale.priceToY(200), y);
    chart.updateConfig({ priceAxis: { scaleSeriesOnly: true } });
    near(chart.scale.priceToY(200), y);
  });

  it('keeps drawing hits, handles, anchored points and zoom consistent with a left scale', () => {
    const canvas = new MockCanvas(800, 500);
    const chart = createChart({ container: canvas, config: { wasm: false, data } });
    const before = chart.scale.indexToX(190);
    const id = chart.addDrawing({ name: 'trendline', points: [{ index: 170, price: 275 }, { index: 190, price: 295 }] });
    chart.selectDrawing(id);
    chart.updateConfig({ priceAxis: { position: 'left' } });
    near(chart.scale.indexToX(190), before + 64);
    const x = chart.scale.indexToX(190), y = chart.scale.priceToY(295);
    assert.equal(chart.handleAt(x, y), 1);
    assert.equal(chart.drawingAt(x, y), id);
    near(chart.scale.xToIndex(x), 190);
    near(chart.pointFromPixel(64, 0, 'anchored-text').index, 0);
    const anchor = chart.scale.xToIndex(400);
    chart.scale.zoom(1.5, 400); near(chart.scale.xToIndex(400), anchor);
    assert.ok(canvas.context.calls.some(([name, dx]) => name === 'translate' && dx === 64));
  });

  it('renders precision, reference labels and hovered status values', () => {
    const canvas = new MockCanvas(800, 500);
    const chart = createChart({ container: canvas, config: { wasm: false, data,
      statusLine: { visible: true, symbol: 'TEST', volume: true },
      priceAxis: { precision: 3, labels: { lastPrice: true, highLow: true }, lines: { lastPrice: true, previousClose: true, highLow: true } },
    } });
    const ctx = canvas.context;
    const painted: { color: string; text: string }[] = [];
    let fillStyle = '';
    Object.defineProperty(ctx, 'fillStyle', { configurable: true, get: () => fillStyle, set: (value) => { fillStyle = value; } });
    const recordFillText = ctx.fillText.bind(ctx);
    ctx.fillText = (text: string, x: number, y: number) => { painted.push({ color: fillStyle, text }); recordFillText(text, x, y); };
    const { upColor, downColor } = chart.getConfig().series;
    const texts = () => painted.map((p) => p.text);
    chart.setCrosshair(chart.scale.indexToX(190), 200);
    assert.ok(texts().includes('TEST'));
    assert.ok(texts().includes('O 290.000') && texts().includes('H 294.000') && texts().includes('L 288.000') && texts().includes('C 292.000'));
    assert.ok(painted.some((p) => p.text === 'C 292.000' && p.color === upColor));
    assert.ok(painted.some((p) => p.text === '+1.000 (+0.34%)' && p.color === upColor));
    assert.ok(texts().includes('Volume 1000'));
    assert.ok(texts().includes('301.000'));
    assert.ok(texts().some((text) => text.startsWith('H ')));
    chart.appendData({ time: data[199].time + 60, open: 305, high: 306, low: 290, close: 292, volume: 500 });
    painted.length = 0;
    chart.setCrosshair(chart.scale.indexToX(200), 200);
    assert.ok(painted.some((p) => p.text === 'C 292.000' && p.color === downColor));
    assert.ok(painted.some((p) => p.text === '-9.000 (-2.99%)' && p.color === downColor));
    assert.ok(texts().includes('Volume 500'));
    chart.updateConfig({ priceAxis: { mode: 'percent' } });
    assert.ok(canvas.context.calls.some(([name, value]) => name === 'fillText' && String(value).endsWith('%')));
  });
});

describe('candle settings', () => {
  it('independently renders body, borders and wick with their direction colors', () => {
    const candle = [{ time: 1, open: 10, close: 20, high: 22, low: 8 }];
    const time = new TimeScale(10, 100), price = new PriceScale(); price.height = 200; price.setRange(0, 30);
    const config = resolveConfig().series;
    for (const [bodyVisible, borderVisible, wickVisible] of [[false, false, false], [true, false, false], [false, false, true], [false, true, false]]) {
      const ctx = new MockContext2D();
      drawCandlesticks(ctx, candle, { from: 0, to: 1 }, time, price, { ...config, bodyVisible, borderVisible, wickVisible, borderUpColor: '#123456' });
      assert.equal(ctx.countCalls('fillRect'), Number(bodyVisible) + Number(wickVisible));
      assert.equal(ctx.countCalls('stroke'), Number(borderVisible));
      if (borderVisible) assert.equal(ctx.strokeStyle, '#123456');
    }
    price.inverted = true;
    const ctx = new MockContext2D(); drawCandlesticks(ctx, candle, { from: 0, to: 1 }, time, price, config);
    assert.ok(ctx.calls.filter(([name]) => name === 'fillRect').every((call) => Number(call[4]) > 0));
  });

  it('uses previous close even when the previous bar is outside the visible range', () => {
    const candles = [{ time: 1, open: 100, close: 110, high: 110, low: 100 }, { time: 2, open: 130, close: 120, high: 130, low: 120 }];
    const time = new TimeScale(10, 100), price = new PriceScale(); price.height = 200; price.setRange(100, 140);
    const config = resolveConfig().series, ctx = new MockContext2D();
    drawCandlesticks(ctx, candles, { from: 1, to: 2 }, time, price, config); assert.equal(ctx.fillStyle, config.downColor);
    drawCandlesticks(ctx, candles, { from: 1, to: 2 }, time, price, { ...config, colorByPreviousClose: true }); assert.equal(ctx.fillStyle, config.upColor);
  });
});

function mount(withExtras = false) {
  const win = new Window({ url: 'http://localhost/' }); windows.push(win);
  const doc = win.document, trigger = doc.createElement('button'); doc.body.append(trigger);
  const chart = createChart({ document: new MockDocument(), config: { wasm: false, data, series: { upColor: 'color(display-p3 0 1 0.55)' } } });
  let changed = 0;
  const extraContent = doc.createElement('div');
  extraContent.innerHTML = '<button type="button">Live feed</button><button type="button">Navigation arrows</button>';
  const settings = createChartSettings({ chart, document: doc as unknown as UIDocument, trigger: trigger as unknown as UIElement,
    ...(withExtras ? { extraContent: extraContent as unknown as UIElement } : {}), onChange: () => { changed++; } });
  const input = (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const select = (name: string, value: string) => { const node = doc.querySelector<HTMLSelectElement>(`[name="${name}"]`)!; node.value = value; node.dispatchEvent(new win.Event('change')); };
  const check = (name: string) => input(name).click();
  const search = (query: string) => {
    const node = doc.querySelector<HTMLInputElement>('[type="search"]')!;
    node.value = query; node.dispatchEvent(new win.Event('input', { bubbles: true }));
    return node;
  };
  const visibleRows = () => Array.from(doc.querySelectorAll('.cts-settings-row')).filter((row) => !row.closest('[hidden]'));
  return { win, doc, chart, trigger, settings, input, select, check, search, visibleRows, changed: () => changed };
}

describe('settings fuzzy matching', () => {
  it('handles partial words, abbreviations, accents and misspellings without loose short matches', () => {
    for (const [query, fields] of [
      ['gird', ['Horizontal grid lines']],
      ['bakground', ['Background color']],
      ['logrithmc', ['Logarithmic']],
      ['crshr', ['Crosshair']],
      ['COLOUR', ['Colour']],
      ['precision', ['Précision']],
      ['  color   wick ', ['Candles', 'Wick up color']],
      ['border up', ['borderUpColor']],
      ['', ['Grid']],
      ['---', ['Grid']],
    ] as const) assert.equal(matchesSettingsSearch(query, fields), true, query);
    for (const query of ['zzzzzz', 'gx', 'crosshair volume', 'gridlock', 'priceless']) {
      assert.equal(matchesSettingsSearch(query, ['Grid color', 'Canvas']), false, query);
    }
  });
});

describe('unified settings card', () => {
  it('filters across sections and choices while keeping matching controls live', () => {
    const m = mount(); m.settings.open();
    const total = m.visibleRows().length;
    const original = m.chart.getConfig();
    const search = m.search('gird');
    assert.ok(m.visibleRows().length > 0 && m.visibleRows().length < total);
    assert.ok(m.visibleRows().every((row) => /grid/i.test(row.textContent)));
    assert.equal(m.doc.querySelector('[aria-label="Candles"]')!.hasAttribute('hidden'), true);
    assert.deepEqual(m.chart.getConfig(), original, 'search must not change chart settings');
    search.focus(); m.search('log scale');
    assert.equal(m.visibleRows().length, 1);
    assert.ok(m.visibleRows()[0].contains(m.input('scale-mode')));
    assert.equal(m.doc.activeElement, search);
    m.select('scale-mode', 'logarithmic');
    assert.equal(m.chart.getConfig().priceAxis.mode, 'logarithmic');
    assert.equal(m.changed(), 1);
    assert.equal(m.visibleRows().length, 1);
    m.search('wick up color');
    assert.equal(m.visibleRows().length, 1);
    m.input('wickUpColor').value = '#123456'; m.input('wickUpColor').dispatchEvent(new m.win.Event('input'));
    assert.equal(m.chart.getConfig().series.wickUpColor, '#123456');
    m.search('scale');
    assert.ok(m.doc.querySelector('[aria-label="Scales and lines"]')!.querySelector('.cts-settings-row:not([hidden])'));
    m.settings.destroy();
  });

  it('hides empty sections and subheadings, announces no matches, and clears with Escape or the button', () => {
    const m = mount(); m.settings.open();
    const total = m.visibleRows().length;
    const search = m.search('inverted');
    assert.equal(m.visibleRows().length, 1);
    assert.ok(Array.from(m.doc.querySelectorAll('.cts-settings-group')).every((group) => group.hasAttribute('hidden')));
    m.search('zzzzzz');
    assert.equal(m.visibleRows().length, 0);
    assert.ok(Array.from(m.doc.querySelectorAll('.cts-settings-section')).every((section) => section.hasAttribute('hidden')));
    assert.equal(m.doc.querySelector('.cts-settings-empty')!.hasAttribute('hidden'), false);
    assert.equal(m.doc.querySelector('[role="status"]')!.textContent, 'No settings found.');
    search.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(search.value, ''); assert.equal(m.visibleRows().length, total);
    assert.equal(m.trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(m.doc.activeElement, search);
    assert.equal(m.doc.querySelector('.cts-settings-empty')!.hasAttribute('hidden'), true);
    m.search('background');
    m.doc.querySelector<HTMLInputElement>('[aria-label="Clear settings search"]')!.click();
    assert.equal(search.value, ''); assert.equal(m.visibleRows().length, total);
    assert.equal(m.doc.querySelector('[aria-label="Clear settings search"]')!.hasAttribute('hidden'), true);
    search.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(m.trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(m.doc.activeElement, m.trigger);
    m.settings.destroy();
  });

  it('searches host controls, preserves queries during reset, and restores all sections on navigation or reopen', () => {
    const m = mount(true); m.settings.open();
    const search = m.search('live fed');
    const extra = () => m.doc.querySelector('[aria-label="Playback and data"]')!;
    assert.equal(extra().hasAttribute('hidden'), false);
    assert.equal(m.visibleRows().length, 0);
    m.search('grid'); assert.equal(extra().hasAttribute('hidden'), true);
    m.doc.querySelector<HTMLInputElement>('.cts-settings-reset')!.click();
    assert.equal(search.value, 'grid');
    assert.ok(m.visibleRows().every((row) => /grid/i.test(row.textContent)));
    const canvas = Array.from(m.doc.querySelectorAll<HTMLInputElement>('.cts-settings-tab')).find((button) => button.textContent === 'Canvas')!;
    canvas.click(); assert.equal(search.value, '');
    assert.equal(extra().hasAttribute('hidden'), false);
    assert.equal(m.doc.activeElement, m.input('background'));
    m.search('watermark'); m.settings.close(); m.settings.open();
    assert.equal(search.value, ''); assert.ok(m.visibleRows().length > 10);
    m.settings.destroy();
  });

  it('opens from the gear, updates live, keeps current values on reopen and restores focus', () => {
    const m = mount();
    assert.equal(m.doc.querySelector('[role="dialog"]')!.getAttribute('hidden'), '');
    m.trigger.click();
    assert.equal(m.trigger.getAttribute('aria-expanded'), 'true');
    m.check('bodyVisible'); assert.equal(m.chart.getConfig().series.bodyVisible, false);
    assert.equal(m.input('upColor').disabled, true);
    m.select('scale-mode', 'logarithmic'); assert.equal(m.chart.getConfig().priceAxis.mode, 'logarithmic');
    m.select('scale-position', 'left'); assert.equal(m.chart.plotArea.left, 64);
    m.select('precision', '6'); assert.equal(m.chart.getConfig().priceAxis.precision, 6);
    m.check('labels-lastPrice'); m.check('lines-previousClose'); m.check('plusButton');
    assert.equal(m.chart.getConfig().priceAxis.labels.lastPrice, true);
    assert.equal(m.chart.getConfig().priceAxis.lines.previousClose, true);
    assert.equal(m.chart.getConfig().priceAxis.plusButton, true);
    assert.equal(m.changed(), 7);
    m.doc.querySelector('.cts-settings-head button')!.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(m.trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(m.doc.activeElement, m.trigger);
    m.trigger.click(); assert.equal(m.input('bodyVisible').checked, false);
    assert.equal(m.chart.getConfig().series.upColor, 'color(display-p3 0 1 0.55)');
    m.settings.destroy(); assert.equal(m.doc.querySelector('[role="dialog"]'), null);
  });

  it('validates ratios, enables them when locked and resets only appearance settings', () => {
    const m = mount(); m.settings.open();
    assert.equal(m.input('priceToBarRatio').disabled, true);
    m.check('lockPriceToBarRatio'); assert.equal(m.input('priceToBarRatio').disabled, false);
    const ratio = m.chart.scale.priceToBarRatio();
    m.input('priceToBarRatio').value = '-1'; m.input('priceToBarRatio').dispatchEvent(new m.win.Event('change'));
    near(m.chart.scale.priceToBarRatio(), ratio);
    m.input('priceToBarRatio').value = '2'; m.input('priceToBarRatio').dispatchEvent(new m.win.Event('change')); near(m.chart.scale.priceToBarRatio(), 2);
    const id = m.chart.addDrawing({ name: 'hline', points: [{ index: 0, price: 200 }] });
    m.chart.updateConfig({ series: { type: 'line' }, crosshair: { mode: 'dot' } });
    m.doc.querySelector<HTMLInputElement>('.cts-settings-reset')!.click();
    assert.equal(m.chart.getConfig().priceAxis.lockPriceToBarRatio, false);
    assert.ok(m.chart.getDrawing(id)); assert.equal(m.chart.dataLength, 200);
    assert.equal(m.chart.getConfig().series.type, 'line');
    assert.equal(m.chart.getConfig().crosshair.mode, 'dot');
    m.settings.setTheme('light'); assert.ok(m.settings.element.classList.contains('cts-light'));
    m.doc.body.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(m.trigger.getAttribute('aria-expanded'), 'false');
    m.settings.destroy();
  });

  it('protects text input from drawing shortcuts and the plus action supports undo', () => {
    const m = mount(), canvas = m.doc.createElement('div'), overlay = m.doc.createElement('div'), rail = m.doc.createElement('div');
    overlay.append(canvas); m.doc.body.append(overlay, rail);
    const callbacks = new Map<number, (time: number) => void>(); let seq = 0;
    const toolbar = createDrawingToolbar({ chart: m.chart, document: m.doc as unknown as UIDocument, canvas: canvas as unknown as UIElement,
      overlay: overlay as unknown as UIElement, rail: rail as unknown as UIElement,
      scheduler: { now: () => 0, request: (fn) => { callbacks.set(++seq, fn); return seq; }, cancel: (id) => { callbacks.delete(id); } },
    });
    const id = m.chart.addDrawing({ name: 'hline', points: [{ index: 0, price: 200 }] }); toolbar.controller.select(id);
    m.settings.open(); m.input('symbol').dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); assert.ok(m.chart.getDrawing(id));
    m.check('plusButton'); m.settings.close();
    canvas.dispatchEvent(new m.win.PointerEvent('pointermove', { clientX: 750, clientY: 150, bubbles: true }));
    for (const fn of callbacks.values()) fn(16); callbacks.clear();
    const plus = m.doc.querySelector<HTMLInputElement>('.cts-price-plus')!;
    assert.equal(plus.style.display, 'block'); plus.click();
    assert.equal(m.chart.getConfig().drawings.length, 2); toolbar.controller.undo(); assert.equal(m.chart.getConfig().drawings.length, 1);
    toolbar.destroy(); m.settings.destroy();
  });
});
