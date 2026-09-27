import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type HTMLElement, type HTMLInputElement, type HTMLSelectElement } from 'happy-dom';
import { createChart, MockDocument, type Candle } from '../dist/index.js';
import { createChartSettings, type ChartSettings, type UIDocument, type UIElement } from '../dist/ui/index.js';

const data: Candle[] = Array.from({ length: 200 }, (_, i) => ({ time: 1700000000 + i * 60, open: 100 + i, high: 104 + i, low: 98 + i, close: 102 + i, volume: 1000 }));
const windows: Window[] = [];
after(() => { for (const win of windows) void win.happyDOM.close(); });

interface MountOptions {
  theme?: 'dark' | 'light';
  onOpen?: () => void;
  onChange?: () => void;
}

function mount(options: MountOptions = {}) {
  const win = new Window({ url: 'http://localhost/' }); windows.push(win);
  const doc = win.document, trigger = doc.createElement('button'); doc.body.append(trigger);
  const chart = createChart({ document: new MockDocument(), config: { wasm: false, data } });
  const settings: ChartSettings = createChartSettings({ chart, document: doc as unknown as UIDocument, trigger: trigger as unknown as UIElement, ...options });
  const input = (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const check = (name: string) => input(name).click();
  const change = (name: string, value: string) => { const node = input(name); node.value = value; node.dispatchEvent(new win.Event('change')); };
  const color = (name: string, value: string) => { const node = input(name); node.value = value; node.dispatchEvent(new win.Event('input')); };
  const select = (name: string, value: string) => { const node = doc.querySelector<HTMLSelectElement>(`[name="${name}"]`)!; node.value = value; node.dispatchEvent(new win.Event('change')); };
  return { win, doc, chart, trigger, settings, input, check, change, color, select };
}

describe('settings card coverage', () => {
  it('fires every control write callback and updates the chart config', () => {
    let changed = 0;
    const m = mount({ onChange: () => { changed++; } });
    m.settings.open();

    m.check('previous-close');
    assert.equal(m.chart.getConfig().series.colorByPreviousClose, true);
    m.color('upColor', '#111111'); m.color('downColor', '#222222');
    m.color('borderUpColor', '#333333'); m.color('borderDownColor', '#444444');
    m.color('wickUpColor', '#555555'); m.color('wickDownColor', '#666666');
    assert.equal(m.chart.getConfig().series.downColor, '#222222');
    assert.equal(m.chart.getConfig().series.borderDownColor, '#444444');
    assert.equal(m.chart.getConfig().series.wickDownColor, '#666666');

    m.select('precision', '3');
    assert.equal(m.chart.getConfig().priceAxis.precision, 3);
    m.select('precision', 'default');
    assert.equal(m.chart.getConfig().priceAxis.precision, null);

    m.check('status-visible');
    assert.equal(m.chart.getConfig().statusLine.visible, true);
    m.change('symbol', 'ACME');
    assert.equal(m.chart.getConfig().statusLine.symbol, 'ACME');
    for (const key of ['symbolVisible', 'ohlc', 'change', 'volume', 'indicators'] as const) {
      const before = m.chart.getConfig().statusLine[key];
      m.check(`status-${key}`);
      assert.equal(m.chart.getConfig().statusLine[key], !before);
    }

    m.check('autoScale');
    assert.equal(m.chart.getConfig().priceAxis.autoScale, false);
    m.check('lockPriceToBarRatio');
    assert.equal(m.chart.getConfig().priceAxis.lockPriceToBarRatio, true);
    m.check('lockPriceToBarRatio');
    assert.equal(m.chart.getConfig().priceAxis.lockPriceToBarRatio, false);
    assert.equal(m.chart.getConfig().priceAxis.priceToBarRatio, null);
    m.check('scaleSeriesOnly');
    assert.equal(m.chart.getConfig().priceAxis.scaleSeriesOnly, true);
    m.check('inverted');
    assert.equal(m.chart.getConfig().priceAxis.inverted, true);
    m.check('price-axis');
    assert.equal(m.chart.getConfig().priceAxis.visible, false);
    m.check('time-axis');
    assert.equal(m.chart.getConfig().timeAxis.visible, false);
    for (const key of ['labels-lastPrice', 'labels-highLow', 'labels-indicator', 'lines-lastPrice', 'lines-previousClose', 'lines-highLow']) m.check(key);
    assert.equal(m.chart.getConfig().priceAxis.labels.highLow, true);
    assert.equal(m.chart.getConfig().priceAxis.lines.highLow, true);

    m.color('background', '#101010'); m.color('textColor', '#202020'); m.color('borderColor', '#303030');
    assert.equal(m.chart.getConfig().theme.textColor, '#202020');
    m.change('font-size', '16');
    assert.equal(m.chart.getConfig().theme.fontSize, 16);
    m.check('grid-visible'); m.check('grid-horizontal'); m.check('grid-vertical');
    assert.equal(m.chart.getConfig().grid.horizontal, false);
    m.color('grid-color', '#404040');
    assert.equal(m.chart.getConfig().grid.color, '#404040');
    m.check('crosshair-visible'); m.check('crosshair-dashed');
    assert.equal(m.chart.getConfig().crosshair.dashed, false);
    m.color('crosshair-color', '#505050');
    assert.equal(m.chart.getConfig().crosshair.color, '#505050');
    m.check('watermark');
    assert.equal(m.chart.getConfig().watermark.visible, true);
    m.change('watermark-text', 'Sample');
    assert.equal(m.chart.getConfig().watermark.text, 'Sample');
    assert.ok(changed > 30);
    m.settings.destroy();
  });

  it('rejects empty, non-finite and out-of-range numeric input', () => {
    const m = mount();
    m.settings.open();
    const ratio = m.input('priceToBarRatio');
    const before = ratio.value;
    for (const bad of ['', 'abc', '1e13']) {
      ratio.value = bad; ratio.dispatchEvent(new m.win.Event('change'));
      assert.equal(ratio.value, before, `rejects ${bad}`);
      assert.equal(m.chart.getConfig().priceAxis.priceToBarRatio, null);
    }
    const font = m.input('font-size');
    const fontBefore = font.value;
    font.value = '30'; font.dispatchEvent(new m.win.Event('change'));
    assert.equal(font.value, fontBefore);
    assert.notEqual(m.chart.getConfig().theme.fontSize, 30);
    m.settings.destroy();
  });

  it('covers theme option, lifecycle edge paths and outside/Escape dismissal', () => {
    let opened = 0;
    const m = mount({ theme: 'light', onOpen: () => { opened++; } });
    assert.ok(m.settings.element.classList.contains('cts-light'));

    m.settings.open();
    assert.equal(opened, 1);
    m.settings.open();
    assert.equal(opened, 1, 'second open is a no-op');
    m.trigger.click();
    assert.equal(m.trigger.getAttribute('aria-expanded'), 'false', 'trigger toggles closed while open');

    m.settings.setTheme('dark');
    assert.ok(!m.settings.element.classList.contains('cts-light'));
    m.settings.setTheme('dark');
    m.settings.setTheme('light');

    m.settings.open();
    (m.settings.element as unknown as HTMLElement).dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(m.trigger.getAttribute('aria-expanded'), 'true', 'pointerdown inside the card keeps it open');
    m.trigger.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(m.trigger.getAttribute('aria-expanded'), 'true', 'pointerdown on the trigger keeps it open');
    m.doc.body.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(m.trigger.getAttribute('aria-expanded'), 'true', 'non-Escape key on the document keeps it open');
    m.doc.body.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(m.trigger.getAttribute('aria-expanded'), 'false', 'document Escape closes the card');
    m.doc.body.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    m.doc.body.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true }));
    m.settings.destroy();
  });

  it('renders explicit series colors and falls back to black for unparsable colors', () => {
    const m = mount();
    m.chart.updateConfig({
      series: { borderUpColor: '#123456', borderDownColor: 'rgb(1, 2, 3)', wickUpColor: '#654321', wickDownColor: '#abcdef' },
      grid: { color: 'not-a-color' },
    });
    m.settings.open();
    assert.equal(m.input('borderUpColor').value, '#123456');
    assert.equal(m.input('wickDownColor').value, '#abcdef');
    assert.equal(m.input('grid-color').value, '#000000');
    m.check('inverted');
    assert.equal(m.chart.getConfig().priceAxis.inverted, true);
    m.settings.destroy();
  });

  it('announces matches across several sections with plural phrasing', () => {
    const m = mount();
    m.settings.open();
    const search = m.doc.querySelector<HTMLInputElement>('[type="search"]')!;
    search.value = 'color';
    search.dispatchEvent(new m.win.Event('input', { bubbles: true }));
    const status = m.doc.querySelector('[role="status"]')!;
    assert.match(status.textContent ?? '', /^Matches in [2-9]\d* settings sections\.$/);
    m.settings.destroy();
  });

  it('indexes host controls whose textContent is null', () => {
    const win = new Window({ url: 'http://localhost/' }); windows.push(win);
    const doc = win.document, trigger = doc.createElement('button'); doc.body.append(trigger);
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data } });
    const extraContent = doc.createElement('div');
    Object.defineProperty(extraContent, 'textContent', { configurable: true, get: () => null });
    const settings = createChartSettings({ chart, document: doc as unknown as UIDocument, trigger: trigger as unknown as UIElement,
      extraContent: extraContent as unknown as UIElement });
    settings.open();
    assert.equal(doc.querySelector('[aria-label="Playback and data"]')!.hasAttribute('hidden'), false);
    settings.destroy();
  });
});
