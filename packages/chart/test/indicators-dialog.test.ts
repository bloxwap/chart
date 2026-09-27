import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type HTMLElement, type HTMLInputElement, type HTMLSelectElement } from 'happy-dom';
import { createChart, MockContext2D, type Candle, type ChartCanvas, type ChartConfig, type DeepPartial } from '../dist/index.js';
import {
  BUILTIN_INDICATORS,
  cciIndicator,
  createIndicatorRegistry,
  ichimokuIndicator,
  ichimokuValues,
  indicatorLineLabels,
  indicatorStyleLabel,
  macdIndicator,
  mfiIndicator,
  obvIndicator,
  supertrendIndicator,
  volIndicator,
  vwapIndicator,
  type IndicatorDef,
  type IndicatorOutput,
} from '../dist/indicators/index.js';
import {
  createIndicatorsDialog,
  indicatorInputs,
  indicatorStyleGroups,
  INDICATORS_DIALOG_CSS,
  INDICATORS_DIALOG_STYLE_MARKER,
  type IndicatorsDialogOptions,
  type UIDocument,
} from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => { for (const win of windows) void win.happyDOM.close(); });

function walk(n: number, seed = 7): Candle[] {
  let s = seed;
  const rnd = (): number => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: Candle[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = Math.max(1, open + (rnd() - 0.5) * 4);
    out.push({ time: 1_700_000_000 + i * 3600, open, close, high: Math.max(open, close) + rnd(), low: Math.min(open, close) - rnd(), volume: 10 + ((i * 37) % 90) });
  }
  return out;
}

const data = walk(300);

/** Records the paint state at every stroke, fill and fillRect (MockContext2D only logs methods). */
class Recorder extends MockContext2D {
  strokes: { style: string; width: number }[] = [];
  fills: string[] = [];
  rects: string[] = [];
  stroke(): void {
    super.stroke();
    this.strokes.push({ style: String(this.strokeStyle), width: this.lineWidth });
  }
  fill(): void {
    super.fill();
    this.fills.push(String(this.fillStyle));
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    super.fillRect(x, y, w, h);
    this.rects.push(String(this.fillStyle));
  }
  reset(): void {
    this.calls.length = 0;
    this.strokes = [];
    this.fills = [];
    this.rects = [];
  }
  widths(color: string): number[] {
    return this.strokes.filter((s) => s.style === color).map((s) => s.width);
  }
}

interface MountOptions extends Partial<Omit<IndicatorsDialogOptions, 'chart' | 'document'>> {
  callbacks?: boolean;
  config?: DeepPartial<ChartConfig>;
  register?: IndicatorDef[];
}

function mount(options: MountOptions = {}) {
  const { callbacks = true, config = {}, register = [], ...rest } = options;
  const win = new Window({ url: 'http://localhost/' });
  windows.push(win);
  const doc = win.document;
  const trigger = doc.createElement('button');
  doc.body.append(trigger);
  trigger.focus();
  const ctx = new Recorder();
  const canvas: ChartCanvas = { width: 900, height: 600, getContext: () => ctx };
  // Wrap every study so the test can read the output the chart computed.
  const outputs = new Map<string, IndicatorOutput>();
  const registry = createIndicatorRegistry();
  for (const def of [...BUILTIN_INDICATORS, ...register]) {
    registry.register({ ...def, compute(...args) {
      const output = def.compute(...args);
      outputs.set(def.name, output);
      return output;
    } });
  }
  const chart = createChart({ container: canvas, registries: { indicators: registry }, config: { wasm: false, data, ...config } });
  let changes = 0;
  let opens = 0;
  const dialog = createIndicatorsDialog({
    chart, document: doc as unknown as UIDocument, ...rest,
    ...(callbacks ? { onChange: () => { changes++; }, onOpen: () => { opens++; } } : {}),
  });
  const root = dialog.element as unknown as HTMLElement;
  const visible = (node: { closest(selector: string): unknown }): boolean => node.closest('[hidden]') === null;
  const all = (selector: string): HTMLElement[] => Array.from(root.querySelectorAll(selector)) as unknown as HTMLElement[];
  const one = (selector: string): HTMLElement => root.querySelector(selector) as unknown as HTMLElement;
  const field = (name: string) => root.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement & HTMLSelectElement;
  const change = (name: string, value: string): void => {
    const node = field(name);
    node.value = value;
    node.dispatchEvent(new win.Event('change', { bubbles: true }));
  };
  const color = (index: number, value: string): void => {
    const node = field(`color-${index}`);
    node.value = value;
    node.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const press = (text: string): void => {
    const button = all('button').find((b) => b.textContent === text && visible(b));
    assert.ok(button, `button ${text}`);
    button.click();
  };
  const key = (target: unknown, name: string, init: Record<string, unknown> = {}) => {
    const event = new win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
    (target as HTMLElement).dispatchEvent(event);
    return event;
  };
  const searchInput = one('[type="search"]') as unknown as HTMLInputElement;
  const search = (query: string): void => {
    searchInput.value = query;
    searchInput.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const options$ = (): string[] => all('.cts-ind-option').filter(visible).map((o) => o.getAttribute('data-indicator')!);
  const activeRow = (id: string): HTMLElement => one(`.cts-ind-active[data-id="${id}"]`);
  const active = (): string[] => all('.cts-ind-active').filter(visible).map((row) => row.querySelector('.cts-ind-name')!.textContent);
  const section = (label: string): HTMLElement => one(`section[aria-label="${label}"]`);
  const rowLabels = (label: string): string[] => Array.from(section(label).querySelectorAll('.cts-settings-row label'))
    .filter((node) => !(node as unknown as HTMLElement).classList.contains('cts-ind-color')).map((node) => node.textContent);
  const status = (): string => one('[role="status"]').textContent;
  const title = (): string => one('h2').textContent;
  const focused = (): unknown => doc.activeElement;
  return {
    win, doc, trigger, ctx, chart, dialog, root, outputs, visible, all, one, field, change, color, press, key, searchInput, search,
    options: options$, activeRow, active, section, rowLabels, status, title, focused,
    changes: () => changes, opens: () => opens,
  };
}

describe('indicators dialog: acceptance', () => {
  it('adds Ichimoku from the picker with custom lengths that the chart computes and draws', () => {
    const m = mount({ settingsOnAdd: true });
    m.dialog.openPicker();
    assert.equal(m.dialog.view, 'picker');
    assert.equal(m.root.hasAttribute('hidden'), false);
    assert.equal(m.root.getAttribute('role'), 'dialog');
    assert.equal(m.doc.getElementById(m.root.getAttribute('aria-labelledby')!)!.textContent, 'Indicators');
    assert.equal(m.focused(), m.searchInput, 'the search field takes focus');
    assert.equal(m.opens(), 1);
    // Overlays default to the main pane, oscillators to their own.
    const overlays = m.section('Overlays');
    const oscillators = m.section('Oscillators');
    assert.ok(overlays.querySelector('[data-indicator="ichimoku"]'));
    assert.ok(oscillators.querySelector('[data-indicator="macd"]'));
    assert.equal(overlays.querySelector('[data-indicator="macd"]'), null);
    assert.equal(m.options().length, BUILTIN_INDICATORS.length);

    m.search('ichi');
    assert.deepEqual(m.options(), ['ichimoku']);
    assert.equal(m.status(), '1 indicator found.');
    assert.equal(m.visible(oscillators), false, 'a section without matches hides');
    m.key(m.searchInput, 'Enter');
    const [cfg] = m.chart.getConfig().indicators;
    assert.equal(cfg!.name, 'ichimoku');
    assert.equal(cfg!.pane, 'main');
    assert.equal(m.dialog.view, 'settings', 'settingsOnAdd opens the new study');
    assert.equal(m.title(), 'Ichimoku Cloud');
    assert.equal(m.visible(m.one('[aria-label="Back to indicators"]')), true);
    assert.deepEqual(m.rowLabels('Inputs'), ['Conversion line length', 'Base line length', 'Leading span B length', 'Lagging span']);
    const conversion = m.field('input-conversion');
    assert.equal(conversion.value, '9');
    assert.equal(m.focused(), conversion, 'the first input takes focus');
    assert.deepEqual([conversion.getAttribute('min'), conversion.getAttribute('step'), conversion.getAttribute('inputmode')], ['1', '1', 'numeric']);
    assert.equal(conversion.getAttribute('max'), null);

    m.change('input-conversion', '7');
    m.change('input-base', '22');
    m.change('input-span', '44');
    m.change('input-displacement', '22');
    assert.deepEqual(m.chart.getIndicator(cfg!.id)!.params, { conversion: 7, base: 22, span: 44, displacement: 22 });
    const output = m.outputs.get('ichimoku')!;
    const expected = ichimokuValues(data, 7, 22, 44);
    const line = (key: string) => output.lines.find((l) => l.key === key)!;
    assert.deepEqual(line('tenkan').values, expected.tenkan);
    assert.deepEqual(line('kijun').values, expected.kijun);
    assert.deepEqual(line('senkouB').values, expected.senkouB);
    assert.equal(line('senkouA').offset, 21);
    assert.equal(line('chikou').offset, -21);
    m.ctx.reset();
    m.chart.render();
    assert.ok(m.ctx.widths('#2962ff').length > 0, 'the conversion line is drawn');
    assert.ok(m.ctx.fills.includes('rgba(67, 160, 71, 0.1)') || m.ctx.fills.includes('rgba(244, 67, 54, 0.1)'), 'the Kumo is drawn');

    // OK returns to the picker it came from, which lists the study with its inputs.
    m.press('OK');
    assert.equal(m.dialog.view, 'picker');
    assert.deepEqual(m.active(), ['Ichimoku 7 22 44 22']);
    assert.equal(m.focused(), m.searchInput);
    m.press('Done');
    assert.equal(m.dialog.view, null);
    assert.equal(m.root.hasAttribute('hidden'), true);
    assert.equal(m.focused(), m.trigger, 'focus returns to where it was');
    assert.ok(m.changes() >= 5);
  });

  it('restyles MACD line colors and widths, the histogram colors, and hides the signal line', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'macd' });
    assert.equal(m.dialog.openSettings(id), true);
    assert.equal(m.dialog.view, 'settings');
    assert.equal(m.visible(m.one('[aria-label="Back to indicators"]')), false, 'no picker to go back to');
    assert.deepEqual(m.rowLabels('Style'), ['MACD', 'Signal', 'Histogram']);
    const histogram = m.section('Style').querySelectorAll('.cts-settings-row')[2]!;
    assert.equal(histogram.querySelectorAll('[type="color"]').length, 2, 'one color per histogram direction');
    assert.equal(histogram.querySelector('select'), null, 'bars have no line width');
    assert.equal(histogram.lastElementChild!.className, 'cts-ind-width', 'but keep its slot so the colors align');
    assert.equal(histogram.firstElementChild!.getAttribute('name'), 'visible-hist', 'the visibility box leads the row');
    assert.deepEqual(Array.from(m.field('width-0').querySelectorAll('option')).map((o) => o.textContent), ['1px', '2px', '3px', '4px']);
    assert.equal(m.field('width-0').value, '1');
    // The histogram follows the candle colors until it is pinned.
    const { upColor, downColor } = m.chart.getConfig().series;
    assert.equal(m.field('color-2').value, upColor.toLowerCase());
    assert.equal(m.field('color-3').value, downColor.toLowerCase());
    assert.equal(m.field('color-0').getAttribute('aria-label'), 'MACD color');

    m.color(0, '#ff0000');
    m.color(1, '#00ff00');
    m.color(2, '#00aaff');
    m.color(3, '#ffaa00');
    m.change('width-0', '3');
    m.change('width-1', '2');
    m.field('visible-dea').click();
    const cfg = m.chart.getIndicator(id)!;
    assert.deepEqual(cfg.colors, ['#ff0000', '#00ff00', '#00aaff', '#ffaa00']);
    assert.deepEqual(cfg.lineWidths, [3, 2]);
    assert.deepEqual(cfg.hiddenLines, ['dea']);
    assert.equal(m.field('color-1').disabled, true, 'a hidden plot greys out its controls');
    assert.equal(m.field('width-1').disabled, true);
    assert.equal(m.field('visible-dea').checked, false);

    m.ctx.reset();
    m.chart.render();
    assert.ok(m.ctx.widths('#ff0000').length > 0 && m.ctx.widths('#ff0000').every((w) => w === 3));
    assert.deepEqual(m.ctx.widths('#00ff00'), [], 'the hidden signal line is not drawn');
    assert.ok(m.ctx.rects.includes('#00aaff') && m.ctx.rects.includes('#ffaa00'), 'the histogram uses the new colors');
    assert.equal(m.chart.getIndicator(id)!.params['fast'], 12);

    m.press('OK');
    assert.equal(m.dialog.view, null, 'OK closes settings opened directly');
    assert.deepEqual(m.chart.getIndicator(id)!.colors, ['#ff0000', '#00ff00', '#00aaff', '#ffaa00'], 'OK keeps the changes');
  });
});

describe('indicators dialog: cancel and defaults', () => {
  const edits = (m: ReturnType<typeof mount>): void => {
    m.change('input-fast', '5');
    m.color(0, '#123456');
    m.change('width-1', '4');
    m.field('visible-hist').click();
    m.change('pane', 'main');
    m.field('visible').click();
  };

  it('Cancel, Escape and the close button restore the study as it was', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'macd', params: { fast: 8 }, colors: ['#111111'], lineWidths: [2], hiddenLines: ['dea'] });
    const before = structuredClone(m.chart.getIndicator(id));
    for (const leave of [
      () => m.press('Cancel'),
      () => m.key(m.field('input-slow'), 'Escape'),
      () => m.one('[aria-label="Close"]').click(),
    ]) {
      m.dialog.openSettings(id);
      edits(m);
      const edited = m.chart.getIndicator(id)!;
      assert.deepEqual([edited.params['fast'], edited.pane, edited.visible, edited.hiddenLines], [5, 'main', false, ['dea', 'hist']]);
      m.ctx.reset();
      leave();
      assert.equal(m.dialog.view, null);
      assert.deepEqual(m.chart.getIndicator(id), before);
      assert.ok(m.ctx.widths('#111111').length > 0, 'the chart repaints the restored study');
    }
  });

  it('Cancel from the picker goes back to it, and Back keeps the changes', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'macd' });
    m.dialog.openPicker();
    (m.activeRow(id).querySelector('.cts-ind-settings') as HTMLElement).click();
    assert.equal(m.dialog.view, 'settings');
    m.change('input-fast', '6');
    m.press('Cancel');
    assert.equal(m.dialog.view, 'picker');
    assert.equal(m.chart.getIndicator(id)!.params['fast'], 12);
    (m.activeRow(id).querySelector('.cts-ind-settings') as HTMLElement).click();
    m.change('input-fast', '6');
    m.one('[aria-label="Back to indicators"]').click();
    assert.equal(m.dialog.view, 'picker');
    assert.equal(m.chart.getIndicator(id)!.params['fast'], 6);
    assert.deepEqual(m.active(), ['MACD 6 26 9']);
  });

  it('Defaults restores the definition defaults and resyncs every control', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'macd', params: { fast: 5 }, colors: ['#aaaaaa', '#bbbbbb', '#cccccc'], lineWidths: [4], hiddenLines: ['hist'], pane: 'main' });
    m.dialog.openSettings(id);
    assert.equal(m.field('pane').value, 'main');
    assert.equal(m.field('visible-hist').checked, false);
    m.press('Defaults');
    const cfg = m.chart.getIndicator(id)!;
    assert.deepEqual(cfg.params, { fast: 12, slow: 26, signal: 9 });
    assert.deepEqual(cfg.colors, macdIndicator.defaultColors);
    assert.deepEqual([cfg.lineWidths, cfg.hiddenLines, cfg.pane], [[], [], 'sub']);
    assert.deepEqual([m.field('input-fast').value, m.field('width-0').value, m.field('pane').value], ['12', '1', 'sub']);
    assert.equal(m.field('visible-hist').checked, true);
    assert.equal(m.dialog.view, 'settings', 'Defaults keeps the dialog open');
  });
});

describe('indicators dialog: picker', () => {
  it('searches names, short names and groups, with an empty state', () => {
    const m = mount();
    m.dialog.openPicker();
    const boll = m.one('[data-indicator="boll"]');
    assert.deepEqual([boll.querySelector('.cts-item-label')!.textContent, boll.querySelector('.cts-item-meta')!.textContent], ['Bollinger Bands', 'BB']);
    assert.equal(m.one('[data-indicator="macd"]').querySelector('.cts-item-meta')!.textContent, '', 'no meta when the short name is the label');
    assert.equal(m.status(), '');
    m.search('rsi');
    assert.ok(m.options().includes('rsi') && m.options().includes('stochrsi'));
    assert.match(m.status(), /^\d+ indicators found\.$/);
    m.search('BB');
    assert.ok(m.options().includes('boll'));
    const clear = m.one('[aria-label="Clear search"]');
    assert.equal(m.visible(clear), true);
    m.search('zzzzzz');
    assert.deepEqual(m.options(), []);
    assert.equal(m.visible(m.one('.cts-settings-empty')), true);
    assert.equal(m.status(), '0 indicators found.');
    clear.click();
    assert.equal(m.searchInput.value, '');
    assert.equal(m.focused(), m.searchInput);
    assert.equal(m.visible(clear), false);
    assert.equal(m.visible(m.one('.cts-settings-empty')), false);
    // Escape clears a query first, then closes.
    m.search('vwap');
    m.key(m.searchInput, 'Escape');
    assert.equal(m.dialog.view, 'picker');
    assert.equal(m.searchInput.value, '');
    assert.equal(m.options().length, BUILTIN_INDICATORS.length);
    m.key(m.searchInput, 'Escape');
    assert.equal(m.dialog.view, null);
  });

  it('adds studies to their default pane and lists them with show, hide, settings and remove', () => {
    const m = mount();
    const sma = m.chart.addIndicator({ name: 'sma', params: { period: 50 } });
    const vwap = m.chart.addIndicator({ name: 'vwap', params: { anchor: 1 } });
    const odd = m.chart.addIndicator({ name: 'vwap', params: { anchor: 7 } });
    const obv = m.chart.addIndicator({ name: 'obv' });
    m.dialog.openPicker();
    assert.deepEqual(m.active(), ['SMA 50', 'VWAP Week 0', 'VWAP 7 0', 'OBV']);
    assert.deepEqual([sma, obv].map((id) => m.activeRow(id).querySelector('.cts-ind-tag')!.textContent), ['Overlay', 'Pane']);
    assert.equal(m.activeRow(sma).querySelector('.cts-ind-name')!.getAttribute('title'), 'Moving Average Simple');
    // The search filters the studies on the chart too.
    m.search('simple');
    assert.deepEqual(m.active(), ['SMA 50']);
    m.search('');

    const eye = m.activeRow(vwap).querySelector('.cts-ind-visibility') as HTMLElement;
    assert.equal(eye.getAttribute('aria-label'), 'Hide VWAP Week 0');
    eye.click();
    assert.equal(m.chart.getIndicator(vwap)!.visible, false);
    assert.equal(m.activeRow(vwap).classList.contains('cts-ind-off'), true);
    assert.equal(eye.getAttribute('aria-label'), 'Show VWAP Week 0');
    eye.click();
    assert.equal(m.chart.getIndicator(vwap)!.visible, true);
    assert.equal(m.activeRow(vwap).classList.contains('cts-ind-off'), false);

    const changes = m.changes();
    (m.activeRow(odd).querySelector('.cts-ind-remove') as HTMLElement).click();
    assert.equal(m.chart.getIndicator(odd), undefined);
    assert.deepEqual(m.active(), ['SMA 50', 'VWAP Week 0', 'OBV']);
    assert.equal(m.status(), 'Removed VWAP 7 0.');
    assert.equal(m.focused(), m.searchInput);
    assert.equal(m.changes(), changes + 1);

    // Clicking a catalog entry adds it to its default pane and keeps focus there.
    const rsi = m.one('[data-indicator="rsi"]');
    rsi.focus();
    rsi.click();
    const added = m.chart.getConfig().indicators.at(-1)!;
    assert.deepEqual([added.name, added.pane], ['rsi', 'sub']);
    assert.equal(m.status(), 'Added Relative Strength Index.');
    assert.equal(m.dialog.view, 'picker');
    assert.equal(m.focused(), rsi);
    assert.deepEqual(m.active(), ['SMA 50', 'VWAP Week 0', 'OBV', 'RSI 14']);
  });

  it('drops studies removed elsewhere when their row is used', () => {
    const m = mount();
    const a = m.chart.addIndicator({ name: 'sma' });
    const b = m.chart.addIndicator({ name: 'ema' });
    m.dialog.openPicker();
    // Inside a batch the dialog has not heard of the removal yet, so the row is still there to use.
    m.chart.batch(() => {
      m.chart.removeIndicator(a);
      (m.activeRow(a).querySelector('.cts-ind-settings') as HTMLElement).click();
      assert.deepEqual(m.active(), ['EMA 20']);
    });
    assert.equal(m.dialog.view, 'picker');
    assert.deepEqual(m.active(), ['EMA 20']);
    const changes = m.changes();
    m.chart.batch(() => {
      m.chart.removeIndicator(b);
      (m.activeRow(b).querySelector('.cts-ind-visibility') as HTMLElement).click();
    });
    assert.deepEqual(m.active(), []);
    assert.equal(m.visible(m.section('On chart')), false, 'the section hides without studies');
    assert.equal(m.changes(), changes);
  });

  it('closes with its close button or an outside press, but settings stay open', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'rsi' });
    m.dialog.openPicker();
    m.one('[aria-label="Close"]').click();
    assert.equal(m.dialog.view, null);
    m.dialog.openPicker();
    m.one('.cts-ind-option').dispatchEvent(new m.win.Event('pointerdown', { bubbles: true }));
    assert.equal(m.dialog.view, 'picker');
    m.doc.body.dispatchEvent(new m.win.Event('pointerdown', { bubbles: true }));
    assert.equal(m.dialog.view, null);
    m.dialog.openSettings(id);
    m.doc.body.dispatchEvent(new m.win.Event('pointerdown', { bubbles: true }));
    assert.equal(m.dialog.view, 'settings');
  });
});

describe('indicators dialog: keyboard and focus', () => {
  it('moves through the catalog with the arrow keys and adds the first match with Enter', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'sma' });
    m.dialog.openPicker();
    m.search('moving');
    const [first, second] = m.all('.cts-ind-option').filter(m.visible);
    assert.equal(m.key(m.searchInput, 'ArrowDown').defaultPrevented, true);
    assert.equal(m.focused(), first);
    m.key(first, 'ArrowDown');
    assert.equal(m.focused(), second);
    m.key(second, 'ArrowUp');
    m.key(first, 'ArrowUp');
    assert.equal(m.focused(), m.searchInput);
    m.key(m.searchInput, 'ArrowUp');
    assert.equal(m.focused(), m.searchInput, 'the search field is the top');
    const gear = m.activeRow(id).querySelector('.cts-ind-settings') as HTMLElement;
    assert.equal(m.key(gear, 'ArrowDown').defaultPrevented, false, 'arrows only move within the catalog');
    assert.equal(m.key(first, 'Enter').defaultPrevented, false, 'Enter on an option is the button default');
    m.search('zzzz');
    assert.equal(m.key(m.searchInput, 'Enter').defaultPrevented, false);
    assert.equal(m.chart.getConfig().indicators.length, 1);
    m.search('money flow');
    assert.equal(m.key(m.searchInput, 'Enter').defaultPrevented, true);
    assert.equal(m.chart.getConfig().indicators.at(-1)!.name, 'mfi');
  });

  it('traps Tab inside the dialog, skipping hidden and disabled controls', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'macd', hiddenLines: ['dea'] });
    m.dialog.openPicker();
    const close = m.one('[aria-label="Close"]');
    const done = m.all('button').filter(m.visible).at(-1)!;
    assert.equal(done.textContent, 'Done');
    done.focus();
    assert.equal(m.key(done, 'Tab').defaultPrevented, true);
    assert.equal(m.focused(), close, 'Tab from the last control wraps to the first');
    assert.equal(m.key(close, 'Tab', { shiftKey: true }).defaultPrevented, true);
    assert.equal(m.focused(), done);
    assert.equal(m.key(m.searchInput, 'Tab').defaultPrevented, false, 'Tab moves normally inside');
    m.dialog.openSettings(id);
    assert.equal(m.field('width-1').disabled, true);
    const ok = m.all('button').filter(m.visible).at(-1)!;
    assert.equal(ok.textContent, 'OK');
    m.key(ok, 'Tab');
    assert.equal(m.focused(), close);
    assert.equal(m.key(m.field('input-fast'), 'ArrowDown').defaultPrevented, false, 'no catalog in settings');
  });

  it('keeps keys from the chart and closes on Escape from anywhere in the page', () => {
    const m = mount();
    let reached = 0;
    m.doc.addEventListener('keydown', () => { reached++; });
    m.dialog.openPicker();
    m.key(m.searchInput, 'a');
    assert.equal(reached, 0, 'keys typed in the dialog stay in it');
    m.key(m.doc.body, 'a');
    assert.equal(m.dialog.view, 'picker');
    const escape = m.key(m.doc.body, 'Escape');
    assert.equal(escape.defaultPrevented, true);
    assert.equal(m.dialog.view, null);
    const id = m.chart.addIndicator({ name: 'rsi' });
    m.dialog.openSettings(id);
    m.change('input-period', '20');
    m.key(m.doc.body, 'Escape');
    assert.equal(m.dialog.view, null);
    assert.equal(m.chart.getIndicator(id)!.params['period'], 14, 'Escape cancels settings');
    assert.equal(m.key(m.doc.body, 'Escape').defaultPrevented, false, 'closed dialogs ignore Escape');
  });

  it('restores focus only to something focusable', () => {
    const m = mount();
    m.dialog.openPicker();
    m.dialog.openPicker();
    assert.equal(m.opens(), 1, 'reopening does not reopen');
    m.dialog.close();
    m.dialog.close();
    assert.equal(m.focused(), m.trigger);
    for (const active of [null, {}]) {
      Object.defineProperty(m.doc, 'activeElement', { configurable: true, get: () => active });
      m.dialog.openPicker();
      m.dialog.close();
      assert.equal(m.dialog.view, null);
    }
  });
});

describe('indicators dialog: settings controls', () => {
  it('validates, rounds and clamps number inputs and uses selects for choices', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'vwap', params: { anchor: 7 } });
    m.dialog.openSettings(id);
    const anchor = m.field('input-anchor');
    assert.equal(anchor.tagName, 'SELECT');
    assert.deepEqual(Array.from(anchor.querySelectorAll('option')).map((o) => o.textContent), ['Session', 'Week', 'Month']);
    m.change('input-anchor', '2');
    assert.equal(m.chart.getIndicator(id)!.params['anchor'], 2);
    const bands = m.field('input-bands');
    assert.deepEqual([bands.getAttribute('step'), bands.getAttribute('min'), bands.getAttribute('inputmode')], ['0.5', '0', 'decimal']);
    m.change('input-bands', '1.25');
    assert.equal(m.chart.getIndicator(id)!.params['bands'], 1.25, 'decimals are kept');
    m.change('input-bands', '-3');
    assert.equal(m.chart.getIndicator(id)!.params['bands'], 0, 'clamped to min');
    for (const bad of ['', 'Infinity']) {
      m.change('input-bands', bad);
      assert.equal(bands.value, '0', `${JSON.stringify(bad)} reverts`);
    }
    m.dialog.close();

    const cci = m.chart.addIndicator({ name: 'cci' });
    m.dialog.openSettings(cci);
    assert.equal(m.field('input-period').getAttribute('max'), '2000');
    m.change('input-period', '12.6');
    assert.equal(m.chart.getIndicator(cci)!.params['period'], 13, 'lengths round');
    m.change('input-period', '99999');
    assert.equal(m.chart.getIndicator(cci)!.params['period'], 2000, 'clamped to max');
    assert.equal(m.field('input-period').value, '2000');
  });

  it('groups plots that share a key and shows levels and fills without widths', () => {
    const m = mount();
    const st = m.chart.addIndicator({ name: 'supertrend' });
    m.dialog.openSettings(st);
    assert.deepEqual(m.rowLabels('Style'), ['Up trend / Down trend']);
    assert.equal(m.all('[name^="visible-"]').length, 1);
    assert.equal(m.all('[name^="width-"]').length, 1);
    assert.equal(m.field('width-0').getAttribute('aria-label'), 'Up trend / Down trend line width');
    m.dialog.close();

    const cci = m.chart.addIndicator({ name: 'cci', colors: ['#aa0000', '#aa0001', '#aa0002'] });
    m.dialog.openSettings(cci);
    assert.deepEqual(m.rowLabels('Style'), ['CCI', 'Upper band', 'Lower band']);
    assert.deepEqual(m.all('[name^="width-"]').map((node) => node.getAttribute('name')), ['width-0'], 'levels have no width');
    m.field('visible-upperBand').click();
    assert.deepEqual(m.chart.getIndicator(cci)!.hiddenLines, ['upperBand']);
    m.ctx.reset();
    m.chart.render();
    assert.deepEqual([m.ctx.widths('#aa0001').length, m.ctx.widths('#aa0002').length], [0, 1], 'only the lower band draws');
    m.field('visible-upperBand').click();
    assert.deepEqual(m.chart.getIndicator(cci)!.hiddenLines, []);
    m.dialog.close();

    const vol = m.chart.addIndicator({ name: 'vol' });
    m.dialog.openSettings(vol);
    assert.deepEqual(m.rowLabels('Style'), ['Growing / Falling']);
    assert.equal(m.all('.cts-ind-width').length, 0, 'no width slots when no plot has a width');
    m.dialog.close();

    const ichimoku = m.chart.addIndicator({ name: 'ichimoku' });
    m.dialog.openSettings(ichimoku);
    assert.deepEqual(m.rowLabels('Style'), ['Conversion line', 'Base line', 'Lagging span', 'Leading span A', 'Leading span B', 'Kumo']);
    assert.equal(m.all('[name^="width-"]').length, 5);
  });

  it('keeps translucent colors translucent and shows tokens and wide-gamut colors', () => {
    const m = mount({ config: { series: { upColor: 'color(display-p3 0 1 0.55)' } } });
    const id = m.chart.addIndicator({ name: 'ichimoku' });
    m.dialog.openSettings(id);
    assert.equal(m.field('color-5').value, '#43a047');
    m.color(5, '#ff0000');
    assert.equal(m.chart.getIndicator(id)!.colors[5], 'rgba(255, 0, 0, 0.1)');
    assert.equal((m.field('color-5').closest('label') as unknown as HTMLElement).title, 'Kumo bullish: rgba(255, 0, 0, 0.1)');
    assert.equal((m.field('color-5').previousElementSibling as unknown as HTMLElement).style.background, 'rgb(255, 0, 0)', 'the chip shows the color at full opacity');
    m.color(0, '#00ff00');
    assert.equal(m.chart.getIndicator(id)!.colors[0], '#00ff00', 'opaque colors stay hex');
    m.dialog.close();

    const macd = m.chart.addIndicator({ name: 'macd' });
    m.dialog.openSettings(macd);
    assert.equal(m.field('color-2').value, '#00ff8c', 'display-p3 shows its nearest sRGB');
    assert.equal((m.field('color-2').closest('label') as unknown as HTMLElement).title, 'Histogram positive: color(display-p3 0 1 0.55)');
    m.color(2, '#0000ff');
    assert.deepEqual(m.chart.getIndicator(macd)!.colors, ['#2962ff', '#ff6d00', '#0000ff', 'down'], 'pinning one token keeps the other');
  });

  it('handles widths set outside the menu, padding and invalid entries', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'macd', lineWidths: [6, Infinity] });
    m.dialog.openSettings(id);
    assert.deepEqual(Array.from(m.field('width-0').querySelectorAll('option')).map((o) => o.textContent), ['1px', '2px', '3px', '4px', '6px']);
    assert.equal(m.field('width-0').value, '6');
    assert.equal(m.field('width-1').value, '1', 'an invalid width shows the default');
    m.change('width-1', '2');
    assert.deepEqual(m.chart.getIndicator(id)!.lineWidths, [6, 2]);
    m.dialog.close();

    const other = m.chart.addIndicator({ name: 'macd' });
    m.dialog.openSettings(other);
    m.change('width-1', '4');
    assert.deepEqual(m.chart.getIndicator(other)!.lineWidths, [0, 4], 'earlier plots keep their own width');
    const psar = m.chart.addIndicator({ name: 'psar' });
    m.dialog.openSettings(psar);
    assert.deepEqual(m.rowLabels('Style'), ['SAR']);
    m.change('width-0', '3');
    assert.deepEqual(m.chart.getIndicator(psar)!.lineWidths, [3], 'dots take a size');
  });

  it('moves a study between panes, hides it, and jumps between sections', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'rsi' });
    m.dialog.openSettings(id);
    assert.deepEqual(m.all('.cts-settings-tab').map((t) => t.textContent), ['Inputs', 'Style', 'Visibility']);
    m.all('.cts-settings-tab')[1]!.click();
    assert.equal(m.focused(), m.field('visible-value'));
    m.all('.cts-settings-tab')[2]!.click();
    assert.equal(m.focused(), m.field('pane'));
    m.change('pane', 'main');
    assert.equal(m.chart.getIndicator(id)!.pane, 'main');
    m.field('visible').click();
    assert.equal(m.chart.getIndicator(id)!.visible, false);
    m.field('visible').click();
    assert.equal(m.chart.getIndicator(id)!.visible, true);
    m.dialog.close();

    const obv = m.chart.addIndicator({ name: 'obv' });
    m.dialog.openSettings(obv);
    assert.deepEqual(m.all('.cts-settings-tab').map((t) => t.textContent), ['Style', 'Visibility'], 'no Inputs without inputs');
    assert.equal(m.focused(), m.field('visible-obv'));
  });

  it('closes when the study is removed elsewhere, and refuses unknown ids', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'rsi' });
    assert.equal(m.dialog.openSettings('nope'), false);
    assert.equal(m.dialog.view, null);
    m.dialog.openSettings(id);
    m.chart.removeIndicator(id);
    const changes = m.changes();
    m.change('input-period', '10');
    assert.equal(m.dialog.view, null);
    assert.equal(m.changes(), changes);
    assert.equal(m.chart.getConfig().indicators.length, 0);
  });
});

describe('indicators dialog: custom and unregistered studies', () => {
  const custom: IndicatorDef = {
    name: 'my-osc',
    defaultParams: { length: 10, smoothK: 1.5 },
    defaultColors: ['#123456', '#654321'],
    defaultPane: 'sub',
    compute: (candles, params, colors) => ({ pane: 'sub', lines: [
      { key: 'a', values: candles.map((c) => c.close - (params['length'] ?? 0)), color: colors[0] ?? '#123456' },
      { key: 'b', values: candles.map((c) => c.open * (params['smoothK'] ?? 1)), color: colors[1] ?? '#654321' },
    ] }),
  };

  it('describes a custom indicator without metadata from its defaults', () => {
    const m = mount({ register: [custom] });
    m.dialog.openPicker();
    const option = m.section('Oscillators').querySelector('[data-indicator="my-osc"]')!;
    assert.equal(option.querySelector('.cts-item-label')!.textContent, 'My osc');
    option.dispatchEvent(new m.win.MouseEvent('click', { bubbles: true }));
    const id = m.chart.getConfig().indicators[0]!.id;
    assert.deepEqual(m.active(), ['My osc 10 1.5']);
    (m.activeRow(id).querySelector('.cts-ind-settings') as HTMLElement).click();
    assert.equal(m.title(), 'My osc');
    assert.deepEqual(m.rowLabels('Inputs'), ['Length', 'Smooth K']);
    const length = m.field('input-length');
    assert.deepEqual([length.getAttribute('step'), length.getAttribute('inputmode'), length.getAttribute('min')], ['any', 'decimal', null]);
    assert.deepEqual(m.rowLabels('Style'), ['Plot 1', 'Plot 2']);
    assert.equal(m.all('[name^="visible-"]').length, 0, 'unknown plot keys cannot be hidden');
    m.change('input-length', '12.5');
    assert.equal(m.chart.getIndicator(id)!.params['length'], 12.5);
    m.change('width-1', '3');
    assert.deepEqual(m.chart.getIndicator(id)!.lineWidths, [0, 3]);
    m.color(0, '#abcdef');
    m.ctx.reset();
    m.chart.render();
    assert.ok(m.ctx.widths('#654321').every((w) => w === 3) && m.ctx.widths('#654321').length > 0);
    assert.ok(m.ctx.widths('#abcdef').length > 0);
    m.press('Defaults');
    assert.deepEqual(m.chart.getIndicator(id)!.colors, ['#123456', '#654321']);
  });

  it('uses partial metadata: labels, whole-number inputs and missing colors', () => {
    const partial: IndicatorDef = {
      ...custom, name: 'partial', label: 'Partial Study', defaultParams: { n: 3 }, defaultColors: ['#010203'], defaultPane: 'main',
      inputs: [{ key: 'n', label: 'N', integer: true, min: 2, max: 9 }],
      styles: [{ key: 'a', label: 'A', colorIndex: 0 }, { key: 'band', label: 'Band', colorIndex: 1, kind: 'fill' }],
    };
    const short: IndicatorDef = { ...custom, name: 'short-only', shortName: 'SO', defaultParams: {}, defaultColors: [], styles: [] };
    const m = mount({ register: [partial, short] });
    m.dialog.openPicker();
    const option = m.one('[data-indicator="partial"]');
    assert.deepEqual([option.querySelector('.cts-item-label')!.textContent, option.querySelector('.cts-item-meta')!.textContent], ['Partial Study', '']);
    assert.equal(m.one('[data-indicator="short-only"]').querySelector('.cts-item-label')!.textContent, 'SO');
    const id = m.chart.addIndicator({ name: 'partial' });
    m.dialog.openSettings(id);
    assert.equal(m.field('input-n').getAttribute('step'), '1');
    m.change('input-n', '1');
    assert.equal(m.chart.getIndicator(id)!.params['n'], 2);
    m.change('input-n', '4.4');
    assert.equal(m.chart.getIndicator(id)!.params['n'], 4);
    assert.equal(m.field('color-1').value, '#000000', 'a color index past the defaults shows black');
    m.color(1, '#ff00ff');
    assert.deepEqual(m.chart.getIndicator(id)!.colors, ['#010203', '#ff00ff']);
    m.dialog.close();
    const so = m.chart.addIndicator({ name: 'short-only' });
    m.dialog.openSettings(so);
    assert.equal(m.title(), 'SO');
    assert.deepEqual(m.all('.cts-settings-tab').map((t) => t.textContent), ['Visibility']);
  });

  it('falls back to an unregistered study’s own config and to defaults for missing params', () => {
    const m = mount({ config: { indicators: [
      { id: 'ghost', name: 'ghost', params: { size: 3 }, pane: 'main', colors: ['red'], visible: true },
      { id: 'bare', name: 'macd', params: {}, pane: 'sub', colors: [], visible: true },
    ] } });
    m.dialog.openPicker();
    assert.deepEqual(m.active(), ['Ghost 3', 'MACD 12 26 9']);
    m.dialog.openSettings('bare');
    assert.equal(m.field('input-fast').value, '12');
    m.dialog.openSettings('ghost');
    assert.equal(m.title(), 'Ghost');
    assert.deepEqual(m.rowLabels('Inputs'), ['Size']);
    assert.equal(m.field('color-0').value, '#000000', 'named colors cannot show in a color input');
    m.color(0, '#00ff00');
    assert.deepEqual(m.chart.getIndicator('ghost')!.colors, ['#00ff00']);
    m.change('input-size', '5');
    m.press('Defaults');
    assert.deepEqual([m.chart.getIndicator('ghost')!.params, m.chart.getIndicator('ghost')!.colors], [{ size: 3 }, ['red']]);
  });
});

describe('indicators dialog: theme, styles and lifecycle', () => {
  it('themes, injects its zero-stroke styles once, works without callbacks and cleans up', () => {
    const m = mount({ theme: 'light', callbacks: false });
    assert.equal(m.root.classList.contains('cts-light'), true);
    m.dialog.setTheme('dark');
    assert.equal(m.root.classList.contains('cts-light'), false);
    const second = createIndicatorsDialog({ chart: m.chart, document: m.doc as unknown as UIDocument });
    assert.equal(m.doc.head.querySelectorAll(`style[${INDICATORS_DIALOG_STYLE_MARKER}]`).length, 1);
    assert.equal(m.doc.head.querySelectorAll('style[data-chart-ts-ui]').length, 1);
    assert.notEqual(second.element, m.dialog.element);
    assert.doesNotMatch(INDICATORS_DIALOG_CSS, /border:\s*1px/, 'cards and controls are fill-only');
    assert.match(INDICATORS_DIALOG_CSS, /\.cts-settings\.cts-ind-dialog \{ border: 0; \}/, 'the card drops the settings border');
    second.destroy();

    const id = m.chart.addIndicator({ name: 'rsi' });
    m.dialog.openPicker();
    m.one('[data-indicator="ema"]').click();
    (m.activeRow(id).querySelector('.cts-ind-visibility') as HTMLElement).click();
    m.dialog.openSettings(id);
    m.change('input-period', '9');
    m.press('Cancel');
    assert.equal(m.chart.getIndicator(id)!.params['period'], 14);

    m.dialog.openPicker();
    m.dialog.destroy();
    assert.equal(m.dialog.view, null);
    assert.equal(m.doc.body.contains(m.root), false);
    m.key(m.doc.body, 'Escape');
    m.doc.body.dispatchEvent(new m.win.Event('pointerdown', { bubbles: true }));
    assert.equal(m.dialog.view, null);
  });
});

describe('indicator dialog metadata helpers', () => {
  it('derive inputs and grouped style rows', () => {
    assert.equal(indicatorInputs(macdIndicator), macdIndicator.inputs);
    assert.deepEqual(indicatorInputs({ defaultParams: { period: 5, smoothK: 1, 'fast-len': 2 } }).map((i) => i.label), ['Period', 'Smooth K', 'Fast len']);
    assert.deepEqual(indicatorStyleGroups(macdIndicator), [
      { key: 'dif', label: 'MACD', colors: [{ label: 'MACD', colorIndex: 0 }], widthIndex: 0 },
      { key: 'dea', label: 'Signal', colors: [{ label: 'Signal', colorIndex: 1 }], widthIndex: 1 },
      { key: 'hist', label: 'Histogram', colors: [{ label: 'Histogram positive', colorIndex: 2 }, { label: 'Histogram negative', colorIndex: 3 }], widthIndex: null },
    ]);
    assert.deepEqual(indicatorStyleGroups(volIndicator).map((g) => g.label), ['Growing / Falling']);
    assert.deepEqual(indicatorStyleGroups(supertrendIndicator).map((g) => [g.label, g.widthIndex]), [['Up trend / Down trend', 0]]);
    assert.equal(indicatorStyleGroups(ichimokuIndicator).at(-1)!.label, 'Kumo');
    assert.deepEqual(indicatorStyleGroups({ defaultColors: ['#1', '#2'] }).map((g) => [g.key, g.label, g.widthIndex]), [[null, 'Plot 1', 0], [null, 'Plot 2', 1]]);
    assert.deepEqual(indicatorStyleGroups({ styles: [], defaultColors: ['#1'] }), []);
    assert.deepEqual(indicatorStyleGroups(obvIndicator).map((g) => g.label), ['OBV']);
  });
});

describe('study metadata polish: CCI/MFI levels and the VWAP band fill', () => {
  it('computes keyed levels and fills colored by their style rows', () => {
    const candles = walk(80, 3);
    assert.deepEqual(cciIndicator.compute(candles, { period: 20 }, cciIndicator.defaultColors, null).levels, [
      { key: 'upperBand', value: 100, color: '#787b86' },
      { key: 'lowerBand', value: -100, color: '#787b86' },
    ]);
    assert.deepEqual(mfiIndicator.compute(candles, {}, ['#1', '#2', '#3'], null).levels!.map((l) => [l.key, l.value, l.color]), [['upperBand', 80, '#2'], ['lowerBand', 20, '#3']]);
    assert.deepEqual(vwapIndicator.compute(candles, { bands: 0 }, [], null).fills, undefined);
    assert.deepEqual(vwapIndicator.compute(candles, { bands: 1 }, [], null).fills, [
      { key: 'bandsFill', upperKey: 'upper', lowerKey: 'lower', color: 'rgba(76, 175, 80, 0.1)' },
    ]);
    assert.equal(vwapIndicator.compute(candles, { bands: 1 }, ['a', 'b', 'c', 'd'], null).fills![0]!.color, 'd');
  });

  it('draws them on the chart, hideable by key, and keeps the band when its lines hide', () => {
    const m = mount();
    const vwap = m.chart.addIndicator({ name: 'vwap', params: { bands: 1 }, colors: ['#b00001', '#b00002', '#b00003', 'rgba(1, 2, 3, 0.5)'] });
    const mfi = m.chart.addIndicator({ name: 'mfi', colors: ['#c00001', '#c00002', '#c00003'] });
    m.ctx.reset();
    m.chart.render();
    assert.ok(m.ctx.fills.includes('rgba(1, 2, 3, 0.5)'));
    assert.ok(m.ctx.widths('#c00002').length === 1 && m.ctx.widths('#c00003').length === 1, 'both MFI levels draw');
    m.chart.updateIndicator(vwap, { hiddenLines: ['upper', 'lower'] });
    m.ctx.reset();
    m.chart.render();
    assert.ok(m.ctx.fills.includes('rgba(1, 2, 3, 0.5)'), 'the band outlives its boundary lines');
    assert.deepEqual(m.ctx.widths('#b00002'), []);
    m.chart.updateIndicator(vwap, { hiddenLines: ['bandsFill'] });
    m.chart.updateIndicator(mfi, { hiddenLines: ['lowerBand'] });
    m.ctx.reset();
    m.chart.render();
    assert.equal(m.ctx.fills.includes('rgba(1, 2, 3, 0.5)'), false);
    assert.deepEqual(m.ctx.widths('#c00003'), []);
  });
});

describe('indicators dialog: review hardening', () => {
  it('closes instead of throwing when any settings control is used after the study is removed elsewhere', () => {
    const m = mount();
    const actions: [string, () => void][] = [
      ['color', () => m.color(1, '#ff0000')],
      ['visibility', () => m.field('visible-dea').click()],
      ['width', () => m.change('width-0', '3')],
      ['number input', () => m.change('input-fast', '5')],
      ['pane', () => m.change('pane', 'main')],
      ['show on chart', () => m.field('visible').click()],
      ['Defaults', () => m.press('Defaults')],
      ['Cancel', () => m.press('Cancel')],
      ['OK', () => m.press('OK')],
      ['close button', () => m.one('[aria-label="Close"]').click()],
      ['Escape', () => m.key(m.doc.body, 'Escape')],
    ];
    for (const [name, act] of actions) {
      const id = m.chart.addIndicator({ name: 'macd' });
      m.dialog.openSettings(id);
      const changes = m.changes();
      // Inside a batch the dialog has not heard of the removal yet, so its controls are still there to use.
      m.chart.batch(() => {
        m.chart.removeIndicator(id);
        assert.doesNotThrow(act, name);
      });
      assert.equal(m.dialog.view, null, `${name} closes the settings`);
      assert.equal(m.changes(), changes, `${name} reports no change`);
      assert.deepEqual(m.chart.getConfig().indicators, [], `${name} does not bring the study back`);
    }
    const vwap = m.chart.addIndicator({ name: 'vwap' });
    m.dialog.openSettings(vwap);
    m.chart.batch(() => {
      m.chart.removeIndicator(vwap);
      assert.doesNotThrow(() => m.change('input-anchor', '1'), 'choice inputs too');
    });
    assert.equal(m.dialog.view, null);
  });

  it('Cancel reverts params that the config left to the defaults', () => {
    const m = mount({ config: { indicators: [{ id: 'bare', name: 'macd', params: {}, pane: 'sub', colors: [], visible: true }] } });
    const defaults = macdIndicator.compute(data, macdIndicator.defaultParams, macdIndicator.defaultColors, null).lines.map((l) => l.values);
    m.dialog.openSettings('bare');
    m.change('input-fast', '5');
    m.change('input-slow', '40');
    assert.deepEqual(m.chart.getIndicator('bare')!.params, { fast: 5, slow: 40 });
    assert.notDeepEqual(m.outputs.get('macd')!.lines.map((l) => l.values), defaults);
    m.press('Cancel');
    assert.equal(m.dialog.view, null);
    assert.deepEqual(m.chart.getIndicator('bare')!.params, { fast: 12, slow: 26, signal: 9 });
    assert.deepEqual(m.outputs.get('macd')!.lines.map((l) => l.values), defaults, 'the chart draws the default MACD again');
  });

  it('reopening the study being edited keeps its edits and what Cancel restores', () => {
    const m = mount();
    const id = m.chart.addIndicator({ name: 'macd' });
    const before = structuredClone(m.chart.getIndicator(id));
    m.dialog.openSettings(id);
    m.change('input-fast', '5');
    m.color(0, '#ff0000');
    m.field('input-slow').focus();
    assert.equal(m.dialog.openSettings(id), true);
    assert.equal(m.dialog.view, 'settings');
    assert.equal(m.focused(), m.field('input-fast'), 'focus returns to the first field');
    assert.equal(m.field('input-fast').value, '5');
    m.press('Cancel');
    assert.deepEqual(m.chart.getIndicator(id), before, 'the first edits are reverted too');
    // Another study still opens its own settings, keeping the first one's edits.
    const rsi = m.chart.addIndicator({ name: 'rsi' });
    m.dialog.openSettings(id);
    m.change('input-fast', '7');
    m.dialog.openSettings(rsi);
    assert.equal(m.title(), 'Relative Strength Index');
    m.press('Cancel');
    assert.equal(m.chart.getIndicator(id)!.params['fast'], 7);
  });

  it('the close button closes settings opened from the picker, discarding the edits', () => {
    const m = mount({ settingsOnAdd: true });
    m.dialog.openPicker();
    m.one('[data-indicator="rsi"]').click();
    const [cfg] = m.chart.getConfig().indicators;
    assert.equal(m.dialog.view, 'settings');
    m.change('input-period', '20');
    m.one('[aria-label="Close"]').click();
    assert.equal(m.dialog.view, null);
    assert.equal(m.root.hasAttribute('hidden'), true);
    assert.equal(m.chart.getIndicator(cfg!.id)!.params['period'], 14);
    assert.equal(m.focused(), m.trigger);
    // Escape still steps back to the picker.
    m.dialog.openPicker();
    (m.activeRow(cfg!.id).querySelector('.cts-ind-settings') as HTMLElement).click();
    m.key(m.field('input-period'), 'Escape');
    assert.equal(m.dialog.view, 'picker');
  });

  it('counts studies on the chart in the search status and empty state', () => {
    const m = mount();
    m.chart.addIndicator({ name: 'sma', params: { period: 50 } });
    m.dialog.openPicker();
    m.search('50');
    assert.deepEqual(m.active(), ['SMA 50']);
    assert.deepEqual(m.options(), []);
    assert.equal(m.visible(m.one('.cts-settings-empty')), false, 'a matching study on the chart is a result');
    assert.equal(m.status(), '1 on chart, 0 indicators to add.');
    m.search('simple');
    assert.equal(m.status(), '1 on chart, 1 indicator to add.');
    m.search('zzzz');
    assert.equal(m.visible(m.one('.cts-settings-empty')), true);
    assert.equal(m.status(), '0 indicators found.');
  });

  it('Enter adds nothing until something is typed', () => {
    const m = mount();
    m.dialog.openPicker();
    assert.equal(m.key(m.searchInput, 'Enter').defaultPrevented, false);
    m.search('   ');
    assert.equal(m.key(m.searchInput, 'Enter').defaultPrevented, false);
    assert.deepEqual(m.chart.getConfig().indicators, []);
    assert.equal(m.dialog.view, 'picker');
  });

  it('is aria-modal only while open', () => {
    const m = mount();
    assert.equal(m.root.getAttribute('aria-modal'), null);
    m.dialog.openPicker();
    assert.equal(m.root.getAttribute('aria-modal'), 'true');
    const id = m.chart.addIndicator({ name: 'rsi' });
    m.dialog.openSettings(id);
    assert.equal(m.root.getAttribute('aria-modal'), 'true');
    m.dialog.close();
    assert.equal(m.root.getAttribute('aria-modal'), null);
  });

  it('show/hide in the picker follows the live config, and removing a gone study changes nothing', () => {
    const m = mount();
    const rsi = m.chart.addIndicator({ name: 'rsi' });
    const sma = m.chart.addIndicator({ name: 'sma' });
    m.dialog.openPicker();
    const eye = m.activeRow(rsi).querySelector('.cts-ind-visibility') as HTMLElement;
    // Inside a batch the row still reads "Hide": the click follows the config, not the stale button.
    m.chart.batch(() => {
      m.chart.updateIndicator(rsi, { visible: false });
      eye.click();
    });
    assert.equal(m.chart.getIndicator(rsi)!.visible, true, 'the first click shows the study the API hid');
    assert.equal(eye.getAttribute('aria-label'), 'Hide RSI 14');
    assert.equal(m.activeRow(rsi).classList.contains('cts-ind-off'), false);

    m.search('sma');
    assert.equal(m.status(), '1 on chart, 1 indicator to add.');
    const changes = m.changes();
    m.chart.batch(() => {
      m.chart.removeIndicator(sma);
      (m.activeRow(sma).querySelector('.cts-ind-remove') as HTMLElement).click();
    });
    assert.equal(m.changes(), changes);
    assert.equal(m.status(), '1 indicator found.', 'the search status recounts instead of announcing a removal');
    assert.equal(m.activeRow(sma), null);
    assert.equal(m.focused(), m.searchInput);
  });
});

describe('study metadata polish: status line labels', () => {
  const rows = (m: ReturnType<typeof mount>): string[] => m.ctx.callsNamed('fillText')
    .map((call) => String(call[1])).map((text) => /^(.*\S) {2}\S+$/.exec(text)?.[1]).filter((label): label is string => label !== undefined);

  it('names lines by short name or style label, falling back to the key', () => {
    const custom: IndicatorDef = {
      name: 'raw', defaultParams: {}, defaultColors: ['#123456'], defaultPane: 'sub',
      compute: (candles) => ({ pane: 'sub', lines: [{ key: 'raw', values: candles.map((c) => c.close), color: '#123456' }] }),
    };
    const m = mount({ register: [custom], config: { statusLine: { visible: true, indicators: true } } });
    for (const name of ['sma', 'macd', 'supertrend', 'boll', 'raw']) m.chart.addIndicator({ name });
    m.ctx.reset();
    m.chart.render();
    assert.deepEqual(rows(m), ['SMA', 'Supertrend', 'Basis', 'Upper', 'Lower', 'MACD', 'Signal', 'RAW'],
      'main-pane studies first, then each sub-pane; single-line studies use their short name');
  });

  it('derives labels from style metadata and caches them per definition', () => {
    assert.deepEqual([...indicatorLineLabels(macdIndicator)], [['dif', 'MACD'], ['dea', 'Signal']], 'histogram bars are not lines');
    assert.equal(indicatorLineLabels(macdIndicator), indicatorLineLabels(macdIndicator));
    assert.deepEqual([...indicatorLineLabels(cciIndicator)], [['cci', 'CCI']], 'levels are not lines');
    assert.deepEqual([...indicatorLineLabels(ichimokuIndicator)].map(([, label]) => label),
      ['Conversion line', 'Base line', 'Lagging span', 'Leading span A', 'Leading span B']);
    assert.deepEqual([...indicatorLineLabels({ styles: [{ key: 'a', label: 'Fast line', colorIndex: 0 }] })], [['a', 'Fast line']], 'no short name: the style label');
    assert.deepEqual([...indicatorLineLabels({ shortName: 'X', styles: [
      { key: 'a', label: 'Up trend', colorIndex: 0 }, { key: 'a', label: 'Down trend', colorIndex: 1 }, { key: 'b', label: 'Base', colorIndex: 2, kind: 'dots' },
    ] })], [['a', 'Up trend / Down trend'], ['b', 'Base']]);
    assert.equal(indicatorLineLabels({}).size, 0);
    assert.deepEqual([indicatorStyleLabel(['Histogram positive', 'Histogram negative']), indicatorStyleLabel(['Kumo bullish', 'Kumo bearish']), indicatorStyleLabel(['A'])],
      ['Histogram', 'Kumo', 'A']);
  });
});
