/**
 * Wave 1 features wired into the existing UI: the settings card (countdowns,
 * scale text size, time-continuous axis, volume overlay, and a Reset defaults
 * that follows the chart theme), the toolbar's `chartTheme` mapping, the
 * touch-aware idle hint, and the Heikin Ashi magnet through the toolbar.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type HTMLButtonElement, type HTMLElement, type HTMLInputElement, type HTMLSelectElement } from 'happy-dom';
import {
  CHART_THEMES,
  DEFAULT_CONFIG,
  MockCanvas,
  MockDocument,
  bloxwapDark,
  createChart,
  heikinAshi,
  mergeDeep,
  presetChartTheme,
  type Candle,
  type ChartConfig,
  type ChartPresetName,
  type DeepPartial,
} from '../dist/index.js';
import {
  DrawingController,
  createChartSettings,
  createDrawingToolbar,
  type ChartSettingsOptions,
  type DrawingToolbarOptions,
  type ThemeName,
  type UIDocument,
  type UIElement,
} from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => { for (const win of windows) void win.happyDOM.close(); });

const T0 = 1_700_000_040; // a 1m boundary, in seconds
const MOUSE_HINT = 'Drag to scroll · wheel to zoom · click a drawing to edit it';
const TOUCH_HINT = 'Drag to scroll · pinch to zoom · long-press for crosshair';

/** A wavy 1m bar, so Heikin Ashi values differ from the real ones. */
function bar(i: number, slot = i): Candle {
  const base = 100 + Math.sin(i / 4) * 8;
  return { time: T0 + slot * 60, open: base, high: base + 3, low: base - 2, close: base + Math.cos(i) * 1.5, volume: 10 + i };
}

/** 60 bars with a ten-minute gap after bar 29; the last bar opened 20s before `NOW`. */
const DATA: Candle[] = Array.from({ length: 60 }, (_, i) => bar(i, i < 30 ? i : i + 10));
const NOW = (DATA.at(-1)!.time + 20) * 1000;

interface MountOptions {
  preset?: ChartPresetName;
  theme?: ThemeName;
  config?: DeepPartial<ChartConfig>;
  settings?: Partial<Pick<ChartSettingsOptions, 'theme' | 'applyChartTheme' | 'chartTheme'>>;
}

function mount(options: MountOptions = {}) {
  const win = new Window({ url: 'http://localhost/' }); windows.push(win);
  const doc = win.document, trigger = doc.createElement('button'); doc.body.append(trigger);
  const canvas = new MockCanvas(800, 500);
  const chart = createChart({
    container: canvas, now: () => NOW,
    ...(options.preset !== undefined ? { preset: options.preset } : {}),
    ...(options.theme !== undefined ? { theme: options.theme } : {}),
    config: { wasm: false, data: DATA, ...options.config },
  });
  const settings = createChartSettings({ chart, document: doc as unknown as UIDocument, trigger: trigger as unknown as UIElement, ...options.settings });
  const input = (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const dropdown = (name: string) => doc.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  const check = (name: string) => input(name).click();
  const change = (name: string, value: string) => { const node = input(name); node.value = value; node.dispatchEvent(new win.Event('change')); };
  const color = (name: string, value: string) => { const node = input(name); node.value = value; node.dispatchEvent(new win.Event('input')); };
  const select = (name: string, value: string) => { const node = dropdown(name); node.value = value; node.dispatchEvent(new win.Event('change')); };
  const search = (query: string) => {
    const node = doc.querySelector<HTMLInputElement>('[type="search"]')!;
    node.value = query; node.dispatchEvent(new win.Event('input', { bubbles: true }));
  };
  const visibleRows = () => Array.from(doc.querySelectorAll('.cts-settings-row')).filter((row) => !row.closest('[hidden]'));
  const reset = () => doc.querySelector<HTMLButtonElement>('.cts-settings-reset')!.click();
  const texts = () => canvas.context.callsNamed('fillText').map((c) => String(c[1]));
  const fonts = () => canvas.context.callsNamed('set:font').map((c) => String(c[1]));
  const options_ = (name: string) => Array.from(dropdown(name).querySelectorAll('option')).map((o) => [o.getAttribute('value'), o.textContent]);
  return { win, doc, canvas, chart, settings, input, dropdown, check, change, color, select, search, visibleRows, reset, texts, fonts, options: options_ };
}

describe('settings card: Wave 1 controls', () => {
  it('counts down in the status line and on the price label', () => {
    const m = mount({ config: { statusLine: { visible: true } } });
    m.settings.open();
    assert.ok(!m.texts().includes('00:40'));
    m.check('status-countdown');
    assert.equal(m.chart.getConfig().statusLine.countdown, true);
    assert.ok(m.texts().includes('00:40'), 'the status line shows the time left in the bar');
    m.canvas.context.calls.length = 0;
    m.check('labels-countdown');
    assert.equal(m.chart.getConfig().priceAxis.labels.countdown, true);
    assert.equal(m.texts().filter((t) => t === '00:40').length, 2, 'and so does the price scale');
    m.check('status-countdown');
    m.check('labels-countdown');
    assert.deepEqual([m.chart.getConfig().statusLine.countdown, m.chart.getConfig().priceAxis.labels.countdown], [false, false]);
    m.settings.destroy();
  });

  it('lays bars out by time with the time-continuous axis', () => {
    const m = mount();
    m.settings.open();
    const gap = () => (m.chart.scale.indexToX(30) - m.chart.scale.indexToX(29)) / (m.chart.scale.indexToX(29) - m.chart.scale.indexToX(28));
    assert.ok(Math.abs(gap() - 1) < 1e-9, 'bar-indexed: the gap collapses');
    assert.equal(m.input('time-continuous').checked, false);
    m.check('time-continuous');
    assert.equal(m.chart.getConfig().timeScale.continuous, true);
    assert.ok(Math.abs(gap() - 11) < 1e-9, 'continuous: ten empty slots show');
    m.check('time-continuous');
    assert.equal(m.chart.getConfig().timeScale.continuous, false);
    m.settings.destroy();
  });

  it('sizes the scales on their own, reconciled with Text size', () => {
    const m = mount({ config: { statusLine: { visible: true } } });
    m.settings.open();
    const size = m.dropdown('scale-font-size');
    assert.equal(size.value, 'default');
    assert.deepEqual(m.options('scale-font-size')[0], ['default', 'Default (12px)'], 'Default shows the Text size it follows');
    m.canvas.context.calls.length = 0;
    m.select('scale-font-size', '16');
    assert.deepEqual([m.chart.getConfig().theme.scaleFontSize, m.chart.getConfig().theme.fontSize], [16, 12]);
    assert.ok(m.fonts().includes('16px ui-monospace, monospace'), 'the scales redraw at 16px');
    assert.ok(m.fonts().includes('12px ui-monospace, monospace'), 'the status text keeps its size');
    assert.equal(m.input('font-size').value, '16', 'Text size shows the scale size it resizes');

    // Text size moves a set scale size too, even to a size the list lacks.
    m.change('font-size', '17');
    assert.deepEqual([m.chart.getConfig().theme.scaleFontSize, m.chart.getConfig().theme.fontSize], [17, 17]);
    assert.equal(size.value, '17');
    const values = m.options('scale-font-size').map(([value]) => value);
    assert.deepEqual(values.slice(values.indexOf('16'), values.indexOf('18') + 1), ['16', '17', '18'], 'an off-list size is listed in order');

    m.select('scale-font-size', 'default');
    assert.equal(m.chart.getConfig().theme.scaleFontSize, null);
    assert.equal(m.input('font-size').value, '17');
    assert.deepEqual(m.options('scale-font-size')[0], ['default', 'Default (17px)']);
    assert.ok(!m.options('scale-font-size').some(([value]) => value === '17'), 'the extra size goes once unused');
    m.settings.destroy();
  });

  it('shows a scale size set in config even when it is off the list', () => {
    const m = mount({ config: { theme: { scaleFontSize: 11.5 } } });
    m.settings.open();
    assert.equal(m.dropdown('scale-font-size').value, '11.5');
    assert.ok(m.options('scale-font-size').some(([value, caption]) => value === '11.5' && caption === '11.5px'));
    m.settings.destroy();
  });

  it('edits the volume overlay; its colors follow the candles until picked', () => {
    const m = mount();
    m.settings.open();
    const up = m.input('volume-upColor'), down = m.input('volume-downColor');
    const follow = m.doc.querySelector<HTMLButtonElement>('[aria-label="Use the candle colors for volume"]')!;
    assert.ok(follow.closest('.cts-settings-colors'), 'the follow button sits with the swatches');
    for (const control of [up, down, m.input('volume-opacity'), m.input('volume-height')]) assert.equal(control.disabled, true, 'waits for the overlay');
    assert.equal(follow.disabled, true);

    m.check('volume-overlay');
    assert.equal(m.chart.getConfig().volume.overlay, true);
    assert.equal(up.disabled, false);
    assert.deepEqual([up.value, down.value], [DEFAULT_CONFIG.series.upColor, DEFAULT_CONFIG.series.downColor], 'tokens show the series colors');
    assert.equal(follow.disabled, true, 'nothing to reset while following');

    m.color('upColor', '#112233');
    assert.equal(up.value, '#112233', 'the token follows a new candle color');
    assert.equal(m.chart.getConfig().volume.upColor, 'up');

    m.color('volume-upColor', '#abcdef');
    assert.equal(m.chart.getConfig().volume.upColor, '#abcdef');
    assert.equal(m.chart.getConfig().series.upColor, '#112233', 'the candles keep theirs');
    assert.equal(follow.disabled, false);
    m.color('upColor', '#445566');
    assert.equal(up.value, '#abcdef', 'a picked color stays put');

    follow.click();
    assert.deepEqual([m.chart.getConfig().volume.upColor, m.chart.getConfig().volume.downColor], ['up', 'down']);
    assert.equal(up.value, '#445566');
    assert.equal(follow.disabled, true);
    m.color('volume-downColor', '#010203');
    assert.equal(follow.disabled, false, 'either color re-enables it');

    assert.equal(m.input('volume-opacity').value, '50');
    m.change('volume-opacity', '25');
    assert.equal(m.chart.getConfig().volume.opacity, 0.25);
    m.change('volume-opacity', '150');
    assert.equal(m.input('volume-opacity').value, '25', 'out of range is rejected');
    assert.equal(m.chart.getConfig().volume.opacity, 0.25);
    assert.equal(m.input('volume-height').value, '20');
    m.change('volume-height', '33.3');
    assert.equal(m.chart.getConfig().volume.height, 0.333);
    assert.equal(m.input('volume-height').value, '33.3');

    m.check('volume-overlay');
    assert.equal(follow.disabled, true, 'off with the overlay');
    assert.equal(up.disabled, true);
    m.settings.destroy();
  });

  it('finds the new controls by search', () => {
    const m = mount();
    m.settings.open();
    const has = (names: string[]) => names.every((name) => m.visibleRows().some((row) => row.contains(m.doc.querySelector(`[name="${name}"]`)!)));
    m.search('countdown');
    assert.equal(m.visibleRows().length, 2);
    assert.ok(has(['status-countdown', 'labels-countdown']));
    m.search('volume');
    assert.equal(m.visibleRows().length, 5, 'the status line value and the overlay group');
    assert.ok(has(['status-volume', 'volume-overlay', 'volume-upColor', 'volume-opacity', 'volume-height']));
    m.search('continuous');
    assert.equal(m.visibleRows().length, 1);
    assert.ok(has(['time-continuous']));
    m.search('scale text');
    assert.equal(m.visibleRows().length, 1);
    assert.ok(has(['scale-font-size']));
    m.settings.destroy();
  });
});

describe('settings card: Reset defaults', () => {
  it('restores the new controls, including a preset’s values', () => {
    const m = mount({ preset: 'bloxwapDark' });
    const initial = m.chart.getConfig();
    m.settings.open();
    m.check('status-countdown'); m.check('labels-countdown'); m.check('time-continuous');
    m.select('scale-font-size', 'default');
    m.color('volume-downColor', '#010203'); m.change('volume-opacity', '10'); m.change('volume-height', '60');
    m.check('volume-overlay');
    const edited = m.chart.getConfig();
    assert.deepEqual([edited.statusLine.countdown, edited.priceAxis.labels.countdown, edited.timeScale.continuous, edited.theme.scaleFontSize, edited.volume.overlay],
      [true, true, true, null, false]);

    m.reset();
    const restored = m.chart.getConfig();
    assert.equal(restored.statusLine.countdown, false);
    assert.equal(restored.priceAxis.labels.countdown, false);
    assert.equal(restored.timeScale.continuous, false);
    assert.equal(restored.theme.scaleFontSize, 11);
    assert.deepEqual(restored.volume, initial.volume);
    assert.equal(m.input('volume-overlay').checked, true, 'controls show the restored values');
    assert.equal(m.dropdown('scale-font-size').value, '11');
    m.settings.destroy();
  });

  it('follows the chart theme, candle colors included', () => {
    const m = mount({ theme: 'dark' });
    m.settings.open();
    m.chart.updateConfig(CHART_THEMES.light); // as the toolbar's setTheme does
    m.settings.setTheme('light');
    m.color('upColor', '#010101'); m.color('background', '#020202');
    m.reset();
    const { series, theme } = m.chart.getConfig();
    assert.deepEqual([series.upColor, series.downColor, theme.background],
      [CHART_THEMES.light.series!.upColor, CHART_THEMES.light.series!.downColor, CHART_THEMES.light.theme!.background]);
    m.settings.destroy();
  });

  it('uses a host chartTheme, limited to what the card resets', () => {
    const calls: ThemeName[] = [];
    const chartTheme = (theme: ThemeName): DeepPartial<ChartConfig> => {
      calls.push(theme);
      return theme === 'dark' ? { ...bloxwapDark, series: { ...bloxwapDark.series, type: 'line' }, indicatorPaneWeight: 2 } : CHART_THEMES.light;
    };
    const m = mount({ preset: 'bloxwapDark', settings: { theme: 'dark', chartTheme } });
    assert.deepEqual(calls, [], 'the initial theme is already on the chart');
    m.settings.setTheme('light');
    m.settings.setTheme('dark');
    assert.deepEqual(calls, ['light', 'dark']);
    m.settings.open();
    m.select('scale-font-size', '20'); m.check('volume-overlay'); m.color('background', '#fefefe');
    m.reset();
    const config = m.chart.getConfig();
    assert.deepEqual([config.theme.background, config.series.upColor, config.theme.scaleFontSize, config.volume.overlay], ['#171717', '#00ff3f', 11, true]);
    assert.equal(config.series.type, 'candlestick', 'keys the card does not own are left alone');
    assert.equal(config.indicatorPaneWeight, 1);
    m.settings.destroy();
  });

  it('resets to presetChartTheme colors, wicks and borders included', () => {
    const chartTheme = presetChartTheme('bloxwapDark');
    const m = mount({ preset: 'bloxwapDark', settings: { theme: 'dark', chartTheme } });
    m.chart.updateConfig(chartTheme('light')); // as the toolbar's setTheme does
    m.settings.setTheme('light');
    m.settings.open();
    m.color('upColor', '#010101');
    m.reset();
    const light = m.chart.getConfig();
    assert.deepEqual([light.theme.background, light.series.upColor, light.series.wickUpColor, light.series.wickDownColor, light.series.borderUpColor],
      [CHART_THEMES.light.theme!.background, CHART_THEMES.light.series!.upColor, '', '', ''], 'no bloxwap wicks on the light chart');
    m.settings.setTheme('dark');
    m.reset();
    const dark = m.chart.getConfig();
    assert.deepEqual([dark.theme.background, dark.series.upColor, dark.series.wickUpColor, dark.series.borderDownColor], ['#171717', '#00ff3f', '#00ff3f', '#ff479c']);
    m.settings.destroy();
  });

  it('keeps the initial colors with applyChartTheme: false', () => {
    const m = mount({ preset: 'bloxwapDark', settings: { applyChartTheme: false, chartTheme: () => assert.fail('not consulted') } });
    m.settings.setTheme('light');
    assert.ok(m.settings.element.classList.contains('cts-light'), 'the card itself still re-themes');
    m.settings.open();
    m.color('background', '#fefefe');
    m.reset();
    assert.equal(m.chart.getConfig().theme.background, '#171717');
    m.settings.destroy();
  });
});

/** Controllable window timers: nothing fires until `tick`. */
class FakeTimers {
  time = 0;
  private seq = 0;
  private readonly queue = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms = 0): number => { const id = ++this.seq; this.queue.set(id, { at: this.time + ms, fn }); return id; };
  clearTimeout = (id: number | undefined): void => { this.queue.delete(id!); };
  setInterval = (): number => 0;
  clearInterval = (): void => {};
  tick(ms: number): void {
    this.time += ms;
    for (const [id, t] of [...this.queue]) if (t.at <= this.time && this.queue.delete(id)) t.fn();
  }
}

const frames = { now: () => 0, request: () => 0, cancel: () => {} };

interface ToolbarMount {
  preset?: ChartPresetName;
  config?: DeepPartial<ChartConfig>;
  toolbar?: Partial<Omit<DrawingToolbarOptions, 'chart' | 'document' | 'canvas' | 'rail' | 'overlay'>>;
  before?: (win: Window) => void;
}

function toolbar(options: ToolbarMount = {}) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 }); windows.push(win);
  const timers = new FakeTimers();
  Object.assign(win, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval: timers.setInterval, clearInterval: timers.clearInterval });
  options.before?.(win);
  const doc = win.document;
  const rail = doc.createElement('div'), stage = doc.createElement('div'), canvas = doc.createElement('div');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 500 } });
  stage.append(canvas); doc.body.append(rail, stage);
  const chart = createChart({ document: new MockDocument(), ...(options.preset !== undefined ? { preset: options.preset } : {}),
    config: { wasm: false, width: 800, height: 500, data: DATA, ...options.config } });
  const tb = createDrawingToolbar({ chart, document: doc as unknown as UIDocument, canvas: canvas as unknown as UIElement,
    rail: rail as unknown as UIElement, overlay: stage as unknown as UIElement, scheduler: frames, ...options.toolbar });
  const pointer = (type: string, x: number, y: number, pointerType: string) =>
    canvas.dispatchEvent(new win.PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, button: 0, pointerType, bubbles: true, cancelable: true }));
  const press = (pointerType: string, x = 300, y = 200) => { pointer('pointerdown', x, y, pointerType); pointer('pointerup', x, y, pointerType); };
  const hint = doc.querySelector('.cts-hint') as unknown as HTMLElement;
  return { win, doc, chart, tb, timers, press, pointer, hint };
}

describe('drawing toolbar: chartTheme', () => {
  it('maps themes to host configs, e.g. presetChartTheme for bloxwapDark', () => {
    const calls: ThemeName[] = [];
    const brand = presetChartTheme('bloxwapDark');
    const m = toolbar({ preset: 'bloxwapDark', toolbar: { chartTheme: (theme) => { calls.push(theme); return brand(theme); } } });
    assert.deepEqual(calls, ['dark'], 'applied on mount');
    const look = () => {
      const { theme, series, crosshair } = m.chart.getConfig();
      return [theme.background, series.upColor, series.wickUpColor, series.wickDownColor, series.borderUpColor, series.borderDownColor, crosshair.labelBackground, crosshair.labelColor];
    };
    const bloxwap = ['#171717', '#00ff3f', '#00ff3f', '#ff479c', '#00ff3f', '#ff479c', '#262626', '#fafafa'];
    assert.deepEqual(look(), bloxwap, 'the preset survives the mount');
    m.tb.setTheme('light');
    assert.deepEqual(look(), [CHART_THEMES.light.theme!.background, CHART_THEMES.light.series!.upColor, '', '', '', '',
      DEFAULT_CONFIG.crosshair.labelBackground, DEFAULT_CONFIG.crosshair.labelColor], 'no bloxwap wicks, borders or labels linger');
    m.tb.setTheme('dark');
    assert.deepEqual(look(), bloxwap);
    m.tb.destroy();
  });

  it('with presetChartTheme, never undoes the chart config or the user settings', () => {
    const m = toolbar({ preset: 'bloxwapDark', config: { volume: { overlay: false }, statusLine: { visible: false }, theme: { scaleFontSize: 14 } },
      toolbar: { chartTheme: presetChartTheme('bloxwapDark') } });
    const kept = () => { const c = m.chart.getConfig(); return [c.volume.overlay, c.statusLine.visible, c.theme.scaleFontSize, c.theme.fontFamily]; };
    assert.deepEqual(kept(), [false, false, 14, bloxwapDark.theme!.fontFamily], 'config beats the preset after the mount');
    assert.equal(m.chart.getConfig().theme.background, '#171717');
    m.chart.updateConfig({ volume: { overlay: true }, statusLine: { visible: true }, theme: { scaleFontSize: 16 } }); // the user's settings
    m.tb.setTheme('light');
    m.tb.setTheme('dark');
    assert.deepEqual(kept(), [true, true, 16, bloxwapDark.theme!.fontFamily]);
    m.tb.destroy();
  });

  it('is ignored with applyChartTheme: false', () => {
    const m = toolbar({ preset: 'bloxwapDark', toolbar: { applyChartTheme: false, chartTheme: () => assert.fail('not consulted') } });
    m.tb.setTheme('light');
    assert.equal(m.chart.getConfig().theme.background, '#171717');
    m.tb.destroy();
  });
});

describe('presetChartTheme', () => {
  it('gives the preset theme the preset colors alone', () => {
    const dark = presetChartTheme('bloxwapDark')('dark');
    assert.deepEqual(dark, {
      theme: { background: '#171717', textColor: '#a1a1a1', borderColor: '#171717' },
      grid: { color: 'rgba(255, 255, 255, 0.05)' },
      crosshair: { color: '#737373', labelBackground: '#262626', labelColor: '#fafafa' },
      series: { upColor: '#00ff3f', downColor: '#ff479c', wickUpColor: '#00ff3f', wickDownColor: '#ff479c', borderUpColor: '#00ff3f', borderDownColor: '#ff479c' },
    }, 'no fonts, sizes, toggles or volume');
  });

  it('gives the other theme its built-in colors, with the preset-only colors back at their defaults', () => {
    const light = presetChartTheme('bloxwapDark')('light');
    assert.deepEqual(light, {
      theme: CHART_THEMES.light.theme,
      grid: CHART_THEMES.light.grid,
      crosshair: { color: CHART_THEMES.light.crosshair!.color, labelBackground: DEFAULT_CONFIG.crosshair.labelBackground, labelColor: 'auto' },
      series: { upColor: '#089981', downColor: '#f23645', wickUpColor: '', wickDownColor: '', borderUpColor: '', borderDownColor: '' },
    });
  });

  it('takes a config partial and the theme it belongs to', () => {
    const map = presetChartTheme({ theme: { background: '#fdfdfd', fontFamily: 'serif' }, series: { lineColor: '#123456' }, volume: { overlay: true } }, 'light');
    const light = map('light');
    assert.equal(light.theme!.background, '#fdfdfd');
    assert.equal(light.series!.lineColor, '#123456');
    assert.equal(light.grid!.color, CHART_THEMES.light.grid!.color, 'built-in colors fill what the preset leaves out');
    assert.equal(light.theme!.fontFamily, undefined);
    assert.equal(light.volume, undefined);
    assert.deepEqual(map('dark'), mergeDeep(CHART_THEMES.dark, { series: { lineColor: DEFAULT_CONFIG.series.lineColor } }));
    assert.throws(() => presetChartTheme('nope' as ChartPresetName), /chart-ts: unknown preset "nope"/);
  });

  it('returns fresh objects', () => {
    const map = presetChartTheme('bloxwapDark');
    map('dark').series!.upColor = '#000000';
    map('light').series!.wickUpColor = '#000000';
    assert.equal(map('dark').series!.upColor, '#00ff3f');
    assert.equal(map('light').series!.wickUpColor, '');
  });
});

describe('drawing toolbar: touch hint', () => {
  it('names touch gestures after a finger press, and mouse ones after a mouse press', () => {
    const m = toolbar();
    assert.equal(m.hint.textContent, MOUSE_HINT);
    m.timers.tick(3_000);
    assert.ok(m.hint.classList.contains('cts-hint-hidden'));

    m.press('touch');
    assert.equal(m.hint.textContent, TOUCH_HINT);
    assert.ok(!m.hint.classList.contains('cts-hint-hidden'), 'the new hint shows again');
    assert.equal(m.hint.getAttribute('aria-hidden'), 'false');
    assert.ok(m.hint.classList.contains('cts-quiet'));
    m.timers.tick(3_000);
    assert.ok(m.hint.classList.contains('cts-hint-hidden'), 'then fades like the first');
    m.press('touch');
    assert.ok(m.hint.classList.contains('cts-hint-hidden'), 'the same hint does not come back');

    m.press('mouse');
    assert.equal(m.hint.textContent, MOUSE_HINT);
    assert.ok(!m.hint.classList.contains('cts-hint-hidden'));
    m.tb.destroy();
  });

  it('keeps tool instructions while placing with a finger', () => {
    const m = toolbar();
    m.press('touch');
    m.tb.controller.arm('trendline');
    assert.match(m.hint.textContent!, /^Trend line/);
    m.tb.controller.disarm();
    assert.equal(m.hint.textContent, TOUCH_HINT);
    m.tb.destroy();
  });

  it('starts with the touch hint on a coarse pointer, unless navigation is off', () => {
    const coarse = (win: Window) => Object.assign(win, { matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' }) });
    const phone = toolbar({ before: coarse });
    assert.equal(phone.hint.textContent, TOUCH_HINT);
    assert.equal(phone.tb.controller.touch, true);
    phone.tb.destroy();
    const still = toolbar({ before: coarse, toolbar: { navigation: false } });
    assert.equal(still.hint.textContent, MOUSE_HINT, 'no gestures, no gesture hint');
    still.tb.destroy();
    const bare = toolbar({ before: (win) => Object.assign(win, { matchMedia: undefined }) });
    assert.equal(bare.hint.textContent, MOUSE_HINT);
    bare.tb.destroy();
  });

  it('DrawingController.setTouch emits a change only when the input kind flips', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: DATA } });
    const c = new DrawingController(chart);
    let changes = 0;
    c.on('change', () => { changes++; });
    assert.equal(c.touch, false);
    c.setTouch(true); c.setTouch(true);
    assert.equal(changes, 1);
    assert.deepEqual(c.hint(), { title: '', detail: TOUCH_HINT, quiet: true });
    c.setTouch(false);
    assert.equal(changes, 2);
    assert.equal(c.hint().detail, MOUSE_HINT);
  });
});

describe('drawing toolbar: Heikin Ashi magnet', () => {
  it('snaps placed points to the displayed Heikin Ashi OHLC', () => {
    const m = toolbar({ config: { series: { type: 'heikin-ashi' } } });
    const ha = heikinAshi(DATA);
    const i = 40;
    const real = [DATA[i]!.open, DATA[i]!.high, DATA[i]!.low, DATA[i]!.close];
    const target = ha[i]!.open;
    assert.ok(!real.includes(target), 'the fixture has a Heikin Ashi-only price');
    const x = m.chart.scale.indexToX(i), y = m.chart.scale.priceToY(target) + 2;
    m.tb.controller.setMagnet('strong');
    assert.deepEqual(m.tb.controller.pointAt(x + 1, y, 'hline'), { index: i, price: target });
    m.tb.controller.arm('hline');
    m.pointer('pointermove', x, y, 'mouse');
    m.press('mouse', x, y);
    const [drawing] = m.chart.getConfig().drawings;
    assert.deepEqual(drawing!.points, [{ index: i, price: target }]);

    m.chart.updateConfig({ series: { type: 'candlestick' } });
    assert.ok(real.includes(m.tb.controller.pointAt(x, y, 'hline').price), 'candlesticks snap to the real bar');
    m.tb.destroy();
  });
});
