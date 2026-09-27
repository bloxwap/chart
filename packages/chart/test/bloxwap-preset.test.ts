import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockContext2D, type ChartCanvas } from '../dist/dom.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { DEFAULT_CONFIG, resolveConfig, type ChartConfig, type DeepPartial } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';
import { renderChart, type RenderView } from '../dist/render/renderer.js';
import { scaleFont, scaleFontSize } from '../dist/render/scale-font.js';
import { relativeLuminance } from '../dist/color.js';
import {
  CHART_PRESETS,
  CHART_THEMES,
  bloxwapDark,
  createChart,
  withPreset,
  scaleFont as exportedScaleFont,
  scaleFontSize as exportedScaleFontSize,
  type ChartPresetName,
} from '../dist/index.js';

interface Op {
  op: string;
  args: unknown[];
  fill: unknown;
  stroke: unknown;
  alpha: number;
  font: string;
  dash: readonly number[];
  path: readonly (readonly number[])[];
  /** Vertical translation in effect (pane origin). */
  ty: number;
}

interface State { fill: unknown; stroke: unknown; alpha: number; font: string; dash: readonly number[]; ty: number }

/** A recording context that keeps canvas state across save/restore and snapshots it per paint. */
class Recorder extends MockContext2D {
  ops: Op[] = [];
  private dash: readonly number[] = [];
  private path: number[][] = [];
  private ty = 0;
  private readonly stack: State[] = [];
  private snap(op: string, args: unknown[]): void {
    this.ops.push({ op, args, fill: this.fillStyle, stroke: this.strokeStyle, alpha: this.globalAlpha, font: this.font, dash: this.dash, path: this.path, ty: this.ty });
  }
  override save(): void {
    super.save();
    this.stack.push({ fill: this.fillStyle, stroke: this.strokeStyle, alpha: this.globalAlpha, font: this.font, dash: this.dash, ty: this.ty });
  }
  override restore(): void {
    super.restore();
    const s = this.stack.pop()!;
    Object.assign(this, { fillStyle: s.fill, strokeStyle: s.stroke, globalAlpha: s.alpha, dash: s.dash, ty: s.ty });
    if (this.font !== s.font) this.font = s.font;
  }
  override translate(x: number, y: number): void {
    super.translate(x, y);
    this.ty += y;
  }
  override setLineDash(segments: number[]): void {
    super.setLineDash(segments);
    this.dash = segments;
  }
  override beginPath(): void {
    super.beginPath();
    this.path = [];
  }
  override moveTo(x: number, y: number): void {
    super.moveTo(x, y);
    this.path.push([x, y]);
  }
  override lineTo(x: number, y: number): void {
    super.lineTo(x, y);
    this.path.push([x, y]);
  }
  override fillRect(x: number, y: number, w: number, h: number): void {
    super.fillRect(x, y, w, h);
    this.snap('fillRect', [x, y, w, h]);
  }
  override fillText(text: string, x: number, y: number): void {
    super.fillText(text, x, y);
    this.snap('fillText', [text, x, y]);
  }
  override stroke(): void {
    super.stroke();
    this.snap('stroke', []);
  }
  override measureText(text: string): { width: number } {
    this.snap('measureText', [text]);
    return super.measureText(text);
  }
  named(op: string): Op[] {
    return this.ops.filter((o) => o.op === op);
  }
}

const PANE = '#171717';
const UP = '#00ff3f';
const DOWN = '#ff479c';
const GRID = 'rgba(255, 255, 255, 0.05)';
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const W = 640;
const H = 400;

/** 40 alternating candles; the last one rises. */
function candles(): Candle[] {
  return Array.from({ length: 40 }, (_, i) => {
    const up = i % 2 === 1;
    const open = 100 + i * 0.5;
    const close = up ? open + 2 : open - 1;
    return { time: 1_700_000_000 + i * 900, open, high: Math.max(open, close) + 1, low: Math.min(open, close) - 1, close, volume: 1000 + i * 25 };
  });
}

function presetChart(config: DeepPartial<ChartConfig> = {}): { chart: ReturnType<typeof createChart>; ctx: Recorder } {
  const ctx = new Recorder();
  const canvas: ChartCanvas = { width: W, height: H, getContext: () => ctx };
  const chart = createChart({ container: canvas, preset: 'bloxwapDark', config: { wasm: false, data: candles(), ...config } });
  return { chart, ctx };
}

const isHorizontal = (o: Op, y: number, width: number): boolean =>
  o.path.length === 2 && o.path[0]![1] === y && o.path[1]![1] === y && o.path[0]![0] === 0 && o.path[1]![0] === width;

describe('scale font tokens', () => {
  it('inherit theme.fontSize and theme.monoFamily by default, reproducing the previous font', () => {
    const { theme } = DEFAULT_CONFIG;
    assert.equal(theme.scaleFontSize, null);
    assert.equal(theme.scaleFontFamily, '');
    assert.equal(scaleFontSize(theme), theme.fontSize);
    assert.equal(scaleFont(theme), `${theme.fontSize}px ${theme.monoFamily}`);
    assert.equal(exportedScaleFont, scaleFont);
    assert.equal(exportedScaleFontSize, scaleFontSize);
  });

  it('override size and family independently', () => {
    const base = DEFAULT_CONFIG.theme;
    assert.equal(scaleFont({ ...base, scaleFontSize: 11 }), '11px ui-monospace, monospace');
    assert.equal(scaleFont({ ...base, scaleFontFamily: 'Inter' }), '12px Inter');
    assert.equal(scaleFontSize({ ...base, fontSize: 15, scaleFontSize: 9 }), 9);
  });

  it('drive axis ticks, crosshair labels and price badges but not the status line', () => {
    const data = candles();
    const timeScale = new TimeScale(12, 576);
    const priceScale = new PriceScale();
    priceScale.height = 376;
    priceScale.setRange(95, 125);
    const config = resolveConfig({
      theme: { fontSize: 14, monoFamily: 'Mono', scaleFontSize: 10, scaleFontFamily: 'Scale' },
      statusLine: { visible: true },
      priceAxis: { labels: { lastPrice: true } },
    });
    const view: RenderView = {
      canvasWidth: W, canvasHeight: H, plotWidth: 576, plotHeight: 376, pixelRatio: 1,
      candles: data, range: timeScale.visibleRange(data.length), timeScale,
      panes: [{ layout: { id: 'main', kind: 'main', weight: 3, y: 0, height: 376 }, priceScale, indicators: [] }],
      config, drawings: [], crosshair: { active: true, x: 300, y: 150 },
    };
    const ctx = new Recorder();
    renderChart(ctx, view);
    const texts = ctx.named('fillText');
    const status = texts.filter((o) => /^(Symbol|[OHLC] )/.test(o.args[0] as string));
    assert.ok(status.length >= 5);
    assert.ok(status.every((o) => o.font === '14px Mono'), 'status line keeps theme.fontSize/monoFamily');
    const scale = texts.filter((o) => !status.includes(o) && !/^[+\-−]/.test(o.args[0] as string));
    assert.ok(scale.length > 8, 'ticks, time labels, badge and crosshair labels');
    assert.ok(scale.every((o) => o.font === '10px Scale'), scale.map((o) => o.font).join());
    // Badge and crosshair boxes size from the scale font: 10 + 8.
    const rects = ctx.named('fillRect');
    const badge = rects.filter((o) => o.fill === config.series.upColor && o.args[0] === 576);
    const priceLabel = rects.filter((o) => o.fill === config.crosshair.labelBackground && o.args[0] === 576);
    const timeLabel = rects.filter((o) => o.fill === config.crosshair.labelBackground && o.args[1] === 376);
    for (const boxes of [badge, priceLabel, timeLabel]) {
      assert.equal(boxes.length, 1);
      assert.equal(boxes[0]!.args[3], 18);
    }
  });

  it('size the price axis for an explicit precision with the scale font', () => {
    const { ctx } = presetChart({ priceAxis: { precision: 2 } });
    const measure = ctx.named('measureText').find((o) => (o.args[0] as string).startsWith('−'))!;
    assert.equal(measure.font, `11px ${FONT}`);
  });
});

describe('bloxwapDark preset', () => {
  it('is registered by name and exported directly, leaving the themes alone', () => {
    assert.equal(CHART_PRESETS.bloxwapDark, bloxwapDark);
    assert.deepEqual(Object.keys(CHART_PRESETS), ['bloxwapDark'] satisfies ChartPresetName[]);
    assert.deepEqual(Object.keys(CHART_THEMES), ['dark', 'light']);
  });

  it('contrasts both candle colors with the pane (WCAG 3:1 for graphics)', () => {
    const pane = relativeLuminance(PANE)!;
    for (const color of [UP, DOWN]) {
      const l = relativeLuminance(color)!;
      assert.ok((Math.max(l, pane) + 0.05) / (Math.min(l, pane) + 0.05) >= 3, color);
    }
  });

  it('renders the brand tokens (draw-call regression)', () => {
    const { chart, ctx } = presetChart({ indicators: [{ id: 'v', name: 'vol', pane: 'sub', params: {}, colors: ['up', 'down'], visible: true }] });
    const { width: plotWidth, height: mainHeight } = chart.plotArea;
    const { from, to } = chart.scale.visibleRange();
    const n = to - from;
    const rects = ctx.named('fillRect');
    // Every fill is accounted for: background, n volume bars, n wicks + n bodies,
    // n VOL sub-pane bars and the last-price badge. No status-line background.
    assert.equal(rects.length, 4 * n + 2);

    // Background: the pane card color over the whole canvas.
    assert.deepEqual(rects[0]!.args, [0, 0, W, H]);
    assert.equal(rects[0]!.fill, PANE);

    // Grid: faint white, never the default grid color.
    const strokes = ctx.named('stroke');
    const grid = strokes.filter((o) => o.stroke === GRID);
    assert.ok(grid.length >= 8);
    assert.ok(!strokes.some((o) => o.stroke === DEFAULT_CONFIG.grid.color));

    // Scales: 11px system-ui in #a1a1a1.
    const scaleTexts = ctx.named('fillText').filter((o) => o.font === `11px ${FONT}`);
    assert.ok(scaleTexts.some((o) => /^\d{4}-\d{2}-\d{2}/.test(o.args[0] as string)), 'time axis');
    assert.ok(scaleTexts.filter((o) => o.fill === '#a1a1a1').length >= 8, 'price and time ticks');

    // Candles: brand fills at full alpha, matching wicks, no border strokes.
    const main = rects.filter((o) => o.ty === 0 && o.alpha === 1 && (o.fill === UP || o.fill === DOWN) && o.args[0] !== plotWidth);
    assert.equal(main.length, 2 * n);
    const wicks = main.filter((o) => o.args[2] === 1);
    assert.ok(wicks.some((o) => o.fill === UP) && wicks.some((o) => o.fill === DOWN));
    assert.ok(main.filter((o) => o.args[2] !== 1).some((o) => o.fill === UP));
    assert.ok(main.filter((o) => o.args[2] !== 1).some((o) => o.fill === DOWN));
    const branded = strokes.filter((o) => o.stroke === UP || o.stroke === DOWN);
    assert.equal(branded.length, 1, 'only the last-price line strokes in a candle color');

    // Volume overlay: same hues at 50% alpha, pinned to the main pane bottom.
    const volume = rects.filter((o) => o.alpha === 0.5);
    assert.equal(volume.length, n);
    assert.ok(volume.every((o) => o.ty === 0 && (o.fill === UP || o.fill === DOWN) && (o.args[1] as number) + (o.args[3] as number) === mainHeight));
    assert.ok(volume.some((o) => o.fill === UP) && volume.some((o) => o.fill === DOWN));
    assert.equal(Math.max(...volume.map((o) => o.args[3] as number)), Math.round(mainHeight * 0.2));
    // The VOL sub-pane indicator still renders beside the overlay, in the candle colors.
    const sub = rects.filter((o) => o.ty === mainHeight);
    assert.equal(sub.length, n);
    assert.ok(sub.every((o) => o.alpha === 1 && (o.fill === UP || o.fill === DOWN)));

    // Last price: dashed line and badge in the rising color.
    assert.deepEqual(branded[0]!.dash, [4, 4]);
    assert.equal(branded[0]!.stroke, UP);
    assert.ok(rects.some((o) => o.fill === UP && o.args[0] === plotWidth && o.args[3] === 19), 'badge on the axis');

    // Pane separators paint the pane color: invisible.
    const separators = strokes.filter((o) => o.stroke === PANE);
    assert.ok(separators.some((o) => isHorizontal(o, 0, plotWidth)));
    assert.ok(separators.some((o) => isHorizontal(o, mainHeight, plotWidth)));
    assert.ok(!strokes.some((o) => o.stroke === DEFAULT_CONFIG.theme.borderColor));

    // Status line: on, in the system-ui stack (TV's custom_font_family covers the legend),
    // no volume segment (and no background, per the fill count).
    const status = ctx.named('fillText').filter((o) => o.args[0] === 'Symbol' || /^[OHLC] /.test(o.args[0] as string));
    assert.equal(status.length, 5);
    assert.ok(status.every((o) => o.font === `12px ${FONT}`), status.map((o) => o.font).join());
    assert.equal(status[0]!.fill, '#a1a1a1');
    assert.ok(!ctx.named('fillText').some((o) => (o.args[0] as string).startsWith('Volume')));
  });

  it('turns the last-price line and badge to the falling color on a down bar', () => {
    const { chart, ctx } = presetChart();
    const last = chart.getConfig().data.at(-1)!;
    ctx.ops = [];
    chart.appendData({ ...last, close: last.open - 3, low: last.open - 4 });
    const line = ctx.named('stroke').filter((o) => o.stroke === UP || o.stroke === DOWN);
    assert.equal(line.length, 1);
    assert.equal(line[0]!.stroke, DOWN);
    assert.ok(ctx.named('fillRect').some((o) => o.fill === DOWN && o.args[0] === chart.plotArea.width && o.args[3] === 19));
    assert.equal(ctx.named('fillRect').filter((o) => o.alpha === 0.5).at(-1)!.fill, DOWN, 'the last volume bar follows');
  });

  it('draws a neutral crosshair with #262626 labels and #fafafa text at 11px', () => {
    const { chart, ctx } = presetChart();
    ctx.ops = [];
    chart.setCrosshair(200, 120);
    const lines = ctx.named('stroke').filter((o) => o.stroke === '#737373');
    assert.equal(lines.length, 2);
    const boxes = ctx.named('fillRect').filter((o) => o.fill === '#262626');
    assert.equal(boxes.length, 2);
    assert.ok(boxes.every((o) => o.args[3] === 19));
    const labels = ctx.named('fillText').filter((o) => o.fill === '#fafafa');
    assert.equal(labels.length, 2);
    assert.ok(labels.every((o) => o.font === `11px ${FONT}`));
  });
});

describe('createChart preset option', () => {
  const make = (options: Omit<Parameters<typeof createChart>[0], 'container'>): ChartConfig =>
    createChart({ container: { width: 100, height: 100, getContext: () => new MockContext2D() }, ...options }).getConfig();

  it('layers preset < theme < config', () => {
    const preset = make({ preset: 'bloxwapDark', config: { wasm: false } });
    assert.equal(preset.theme.background, PANE);
    assert.equal(preset.theme.scaleFontSize, 11);
    assert.equal(preset.volume.overlay, true);
    const themed = make({ preset: 'bloxwapDark', theme: 'light', config: { wasm: false } });
    assert.equal(themed.theme.background, '#ffffff', 'the theme wins over the preset');
    assert.equal(themed.series.upColor, '#089981');
    assert.equal(themed.theme.scaleFontSize, 11, 'preset-only tokens survive');
    const configured = make({ preset: 'bloxwapDark', theme: 'light', config: { wasm: false, theme: { background: '#000000' }, volume: { overlay: false } } });
    assert.equal(configured.theme.background, '#000000', 'config wins over both');
    assert.equal(configured.volume.overlay, false);
  });

  it('accepts a config partial as the preset and matches updateConfig(bloxwapDark)', () => {
    assert.equal(make({ preset: { grid: { color: '#123456' } }, config: { wasm: false } }).grid.color, '#123456');
    const direct = make({ preset: bloxwapDark });
    const chart = createChart({ container: { width: 100, height: 100, getContext: () => new MockContext2D() } });
    chart.updateConfig(bloxwapDark);
    const { formatters: _a, ...updated } = chart.getConfig();
    const { formatters: _b, ...created } = direct;
    assert.deepEqual(updated, created);
  });

  it('keeps today\'s config without a preset and rejects unknown names', () => {
    const plain = make({ config: { wasm: false } });
    assert.equal(plain.theme.background, DEFAULT_CONFIG.theme.background);
    assert.equal(plain.volume.overlay, false);
    for (const name of ['nope', 'toString']) {
      assert.throws(() => make({ preset: name as ChartPresetName }), new RegExp(`chart-ts: unknown preset "${name}"`));
    }
  });

  it('withPreset returns the partial untouched without a preset and never aliases the preset', () => {
    const partial = { grid: { visible: false } };
    assert.equal(withPreset(undefined, partial), partial);
    assert.equal(withPreset(undefined, undefined), undefined);
    const layered = withPreset('bloxwapDark', undefined)!;
    assert.deepEqual(layered, bloxwapDark);
    layered.theme!.background = '#ffffff';
    assert.equal(bloxwapDark.theme!.background, PANE);
  });
});
