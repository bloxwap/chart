import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type HTMLInputElement } from 'happy-dom';
import { CHART_THEMES, DEFAULT_CONFIG, MockContext2D, createChart, type Candle, type ChartCanvas, type ChartPresetName } from '../dist/index.js';
import { createChartSettings, createDrawingToolbar, type UIDocument, type UIElement } from '../dist/ui/index.js';

const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const data: Candle[] = Array.from({ length: 60 }, (_, i) => ({ time: 1_700_000_000 + i * 60, open: 100 + i, high: 104 + i, low: 98 + i, close: 102 + i, volume: 1000 }));
const windows: Window[] = [];
after(() => { for (const win of windows) void win.happyDOM.close(); });

/** Records the font in effect for every fillText. */
class FontRecorder extends MockContext2D {
  texts: { text: string; font: string }[] = [];
  override fillText(text: string, x: number, y: number): void {
    super.fillText(text, x, y);
    this.texts.push({ text, font: this.font });
  }
}

function mount(preset?: ChartPresetName) {
  const win = new Window({ url: 'http://localhost/' }); windows.push(win);
  const doc = win.document;
  const ctx = new FontRecorder();
  const canvas: ChartCanvas = { width: 640, height: 400, getContext: () => ctx };
  const chart = createChart({ container: canvas, ...(preset !== undefined ? { preset } : {}), config: { wasm: false, data, statusLine: { symbol: 'BTC-USD' } } });
  const input = (name: string) => doc.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const change = (name: string, value: string) => { const node = input(name); node.value = value; node.dispatchEvent(new win.Event('change')); };
  return { win, doc, ctx, chart, input, change };
}

describe('settings Text size with scale font tokens', () => {
  it('shows and resizes the bloxwapDark scales (scaleFontSize set)', () => {
    const m = mount('bloxwapDark');
    const trigger = m.doc.createElement('button'); m.doc.body.append(trigger);
    const settings = createChartSettings({ chart: m.chart, document: m.doc as unknown as UIDocument, trigger: trigger as unknown as UIElement });
    settings.open();
    assert.equal(m.input('font-size').value, '11', 'the effective scale size, not theme.fontSize (12)');
    m.ctx.texts = [];
    m.change('font-size', '16');
    const { theme } = m.chart.getConfig();
    assert.equal(theme.scaleFontSize, 16);
    assert.equal(theme.fontSize, 16, 'the status line follows too');
    assert.ok(m.ctx.texts.some((t) => /^\d{4}-\d{2}-\d{2}/.test(t.text) && t.font === `16px ${FONT}`), 'time axis redraws at 16px');
    assert.ok(!m.ctx.texts.some((t) => t.font.startsWith('11px')), 'nothing still draws at the preset size');
    assert.equal(m.input('font-size').value, '16');
    settings.destroy();
  });

  it('keeps editing theme.fontSize alone when scaleFontSize inherits it', () => {
    const m = mount();
    const trigger = m.doc.createElement('button'); m.doc.body.append(trigger);
    const settings = createChartSettings({ chart: m.chart, document: m.doc as unknown as UIDocument, trigger: trigger as unknown as UIElement });
    settings.open();
    assert.equal(m.input('font-size').value, String(DEFAULT_CONFIG.theme.fontSize));
    m.change('font-size', '14');
    const { theme } = m.chart.getConfig();
    assert.equal(theme.fontSize, 14);
    assert.equal(theme.scaleFontSize, null);
    settings.destroy();
  });
});

describe('bloxwapDark legend font', () => {
  it('draws the status line in the system-ui stack like the scales', () => {
    const m = mount('bloxwapDark');
    const legend = m.ctx.texts.filter((t) => t.text === 'BTC-USD' || /^[OHLC] /.test(t.text));
    assert.equal(legend.length, 5);
    assert.ok(legend.every((t) => t.font === `12px ${FONT}`), legend.map((t) => t.font).join());
  });
});

describe('drawing toolbar over a preset', () => {
  function toolbar(preset: ChartPresetName, applyChartTheme?: boolean) {
    const m = mount(preset);
    const rail = m.doc.createElement('div');
    const stage = m.doc.createElement('div');
    const canvas = m.doc.createElement('div');
    stage.append(canvas);
    m.doc.body.append(rail, stage);
    const tb = createDrawingToolbar({
      chart: m.chart,
      document: m.doc as unknown as UIDocument,
      canvas: canvas as unknown as UIElement,
      rail: rail as unknown as UIElement,
      overlay: stage as unknown as UIElement,
      navigation: false,
      ...(applyChartTheme !== undefined ? { applyChartTheme } : {}),
    });
    return { ...m, tb };
  }

  it('keeps the preset with applyChartTheme: false (the documented opt-out)', () => {
    const m = toolbar('bloxwapDark', false);
    const { theme, series } = m.chart.getConfig();
    assert.deepEqual([theme.background, theme.borderColor, series.upColor], ['#171717', '#171717', '#00ff3f']);
    m.tb.destroy();
  });

  it('layers CHART_THEMES over the preset by default (theme beats preset)', () => {
    const m = toolbar('bloxwapDark');
    const { theme } = m.chart.getConfig();
    assert.equal(theme.background, CHART_THEMES.dark.theme!.background);
    assert.equal(theme.scaleFontSize, 11, 'preset-only tokens survive');
    m.tb.destroy();
  });
});
