import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockContext2D, type ChartCanvas } from '../dist/dom.js';
import { PriceScale, TimeScale, type VisibleRange } from '../dist/core/scale.js';
import type { Candle } from '../dist/core/data.js';
import { createChart } from '../dist/core/chart.js';
import type { ChartConfig, DeepPartial, IndicatorConfig } from '../dist/config.js';
import { drawHistogramBars } from '../dist/series/histogram.js';
import {
  drawIndicator,
  indicatorMinMax,
  indicatorRightEdge,
  lineColorAt,
  lineValueAt,
  LEVEL_DASH,
} from '../dist/render/indicator-draw.js';
import {
  BUILTIN_INDICATORS,
  applyIndicatorPatch,
  bollIndicator,
  createIndicatorRegistry,
  emaIndicator,
  indicatorLineKeys,
  indicatorStyleColors,
  kdjIndicator,
  macdIndicator,
  normalizeIndicatorConfig,
  resolveIndicatorColors,
  rsiIndicator,
  smaIndicator,
  styleIndicatorOutput,
  volIndicator,
  type IndicatorDef,
  type IndicatorLine,
  type IndicatorOutput,
} from '../dist/indicators/index.js';
import * as root from '../dist/index.js';

/** Records the paint state at every stroke, fill and text call (MockContext2D only logs methods). */
class StyleRecorder extends MockContext2D {
  strokes: { style: unknown; width: number; dash: readonly number[] }[] = [];
  /** First point of each stroked path, by stroke. */
  starts: (number[] | undefined)[] = [];
  fills: unknown[] = [];
  rects: unknown[] = [];
  texts: { text: string; style: unknown }[] = [];
  private dash: readonly number[] = [];
  private start: number[] | undefined;
  setLineDash(segments: number[]): void {
    super.setLineDash(segments);
    this.dash = segments;
  }
  beginPath(): void {
    super.beginPath();
    this.start = undefined;
  }
  moveTo(x: number, y: number): void {
    super.moveTo(x, y);
    this.start ??= [x, y];
  }
  stroke(): void {
    super.stroke();
    this.strokes.push({ style: this.strokeStyle, width: this.lineWidth, dash: this.dash });
    this.starts.push(this.start);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    super.fillRect(x, y, w, h);
    this.rects.push(this.fillStyle);
  }
  fill(): void {
    super.fill();
    this.fills.push(this.fillStyle);
  }
  fillText(text: string, x: number, y: number): void {
    super.fillText(text, x, y);
    this.texts.push({ text, style: this.fillStyle });
  }
  reset(): void {
    this.calls.length = 0;
    this.strokes = [];
    this.starts = [];
    this.fills = [];
    this.rects = [];
    this.texts = [];
  }
}

function walk(n: number, seed = 1): Candle[] {
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
    out.push({ time: i * 60, open, close, high: Math.max(open, close) + rnd(), low: Math.min(open, close) - rnd(), volume: 10 + i });
  }
  return out;
}

/** 100px plot, 10px bars, prices 0-100 mapped to y = 100 - price. */
function scales(length: number, scroll = 0): { ts: TimeScale; ps: PriceScale; range: VisibleRange } {
  const ts = new TimeScale(10, 100);
  ts.scrollOffset = scroll;
  const ps = new PriceScale();
  ps.height = 100;
  ps.topMargin = ps.bottomMargin = 0;
  ps.setRange(0, 100);
  return { ts, ps, range: ts.visibleRange(length) };
}

/** The pre-extension indicator painter, kept verbatim as the parity reference. */
function legacyDraw(ctx: MockContext2D, output: IndicatorOutput, range: VisibleRange, ts: TimeScale, ps: PriceScale): void {
  if (output.bars !== undefined) {
    drawHistogramBars(ctx, output.bars.values, output.bars.up, range, ts, ps, output.bars.upColor, output.bars.downColor);
  }
  for (const line of output.lines) {
    ctx.strokeStyle = line.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let pen = false;
    for (let i = range.from; i < range.to; i++) {
      const v = line.values[i];
      if (v === null || v === undefined || Number.isNaN(v)) {
        pen = false;
        continue;
      }
      const x = ts.indexToX(i, line.values.length);
      const y = ps.priceToY(v);
      if (pen) ctx.lineTo(x, y);
      else {
        ctx.moveTo(x, y);
        pen = true;
      }
    }
    ctx.stroke();
  }
}

function paint(output: IndicatorOutput, length: number, scroll = 0): StyleRecorder {
  const ctx = new StyleRecorder();
  const { ts, ps, range } = scales(length, scroll);
  drawIndicator(ctx, output, range, ts, ps, length);
  return ctx;
}

const coords = (ctx: MockContext2D, name: string): number[][] =>
  ctx.callsNamed(name).map((c) => (c.slice(1) as number[]).map((v) => Math.round(v * 1000) / 1000));

const lineOf = (key: string, values: (number | null)[], extra: Partial<IndicatorLine> = {}): IndicatorLine =>
  ({ key, values, color: '#123456', ...extra });

describe('default draw-call parity', () => {
  const ORIGINAL: IndicatorDef[] = [smaIndicator, emaIndicator, bollIndicator, macdIndicator, rsiIndicator, kdjIndicator, volIndicator];
  it('the seven original built-ins paint exactly as before at every scroll position', () => {
    const candles = walk(60, 3);
    for (const def of ORIGINAL) {
      const colors = resolveIndicatorColors(def.defaultColors, '#0f0', '#f00');
      const output = def.compute(candles, { ...def.defaultParams, period: 5, fast: 3, slow: 6, signal: 2 }, colors, null);
      for (const scroll of [0, 7, -4, 55]) {
        const ctx = new StyleRecorder();
        const legacy = new StyleRecorder();
        const { ts, ps, range } = scales(candles.length, scroll);
        ps.setRange(-20, 200);
        drawIndicator(ctx, output, range, ts, ps, candles.length);
        legacyDraw(legacy, output, range, ts, ps);
        assert.deepEqual(ctx.calls, legacy.calls, `${def.name} @ ${scroll}`);
        assert.deepEqual(ctx.strokes, legacy.strokes, `${def.name} @ ${scroll}`);
        assert.ok(ctx.countCalls('setLineDash') === 0 && ctx.countCalls('ellipse') === 0);
      }
    }
  });
  it('an empty viewport still issues the plain begin/stroke pair', () => {
    const ctx = new StyleRecorder();
    const ts = new TimeScale(10, 0);
    const ps = new PriceScale();
    drawIndicator(ctx, { pane: 'main', lines: [lineOf('a', [1, 2])] }, ts.visibleRange(2), ts, ps, 2);
    assert.deepEqual(ctx.calls.map((c) => c[0]), ['beginPath', 'stroke']);
    assert.equal(indicatorRightEdge({ from: 0, to: 0 }, ts, 2), 0);
  });
});

describe('line styles', () => {
  it('applies lineWidth and dash, restoring a solid dash afterwards', () => {
    const ctx = paint({ pane: 'main', lines: [lineOf('a', [10, 20, 30], { lineWidth: 3, dash: [6, 2] }), lineOf('b', [5, 5, 5])] }, 3);
    assert.deepEqual(ctx.strokes, [
      { style: '#123456', width: 3, dash: [6, 2] },
      { style: '#123456', width: 1, dash: [] },
    ]);
    assert.deepEqual(ctx.callsNamed('setLineDash').map((c) => c[1]), [[6, 2], []]);
  });
  it('steps horizontally then vertically, and restarts after gaps', () => {
    const ctx = paint({ pane: 'main', lines: [lineOf('s', [10, 20, null, 40, 50], { style: 'step' })] }, 5);
    // x = 55 + 10i for 5 bars in a 100px plot.
    assert.deepEqual(coords(ctx, 'moveTo'), [[55, 90], [85, 60]]);
    assert.deepEqual(coords(ctx, 'lineTo'), [[65, 90], [65, 80], [95, 60], [95, 50]]);
  });
  it('fills one circle per value for dots, sized by lineWidth and colored per index', () => {
    const ctx = paint({ pane: 'main', lines: [lineOf('d', [10, null, NaN, 40, 50, 60], {
      style: 'dots', lineWidth: 2, colors: ['#a', null, null, '#a', '#b', '#b'],
    })] }, 6);
    assert.deepEqual(coords(ctx, 'ellipse').map((c) => c.slice(0, 4)), [[45, 90, 3, 3], [75, 60, 3, 3], [85, 50, 3, 3], [95, 40, 3, 3]]);
    assert.deepEqual(coords(ctx, 'moveTo')[0], [48, 90]);
    assert.deepEqual(ctx.fills, ['#a', '#b']);
    const plain = paint({ pane: 'main', lines: [lineOf('d', [10, 20], { style: 'dots' })] }, 2);
    assert.deepEqual(coords(plain, 'ellipse').map((c) => c[2]), [2, 2]);
    assert.deepEqual(plain.fills, ['#123456']);
  });
  it('breaks the path where per-index colors change and colors missing entries with the base color', () => {
    const ctx = paint({ pane: 'main', lines: [lineOf('st', [null, 10, 20, 30, 40, 50], {
      colors: [null, '#up', '#up', '#dn', '#dn', null],
    })] }, 6);
    assert.deepEqual(ctx.strokes.map((s) => s.style), ['#up', '#dn', '#123456']);
    assert.deepEqual(coords(ctx, 'moveTo'), [[55, 90], [75, 70], [95, 50]]);
    assert.deepEqual(coords(ctx, 'lineTo'), [[65, 80], [85, 60]]);
    // A colored first point does not stroke an empty path first.
    const gap = paint({ pane: 'main', lines: [lineOf('g', [10, null, 30], { colors: ['#x', null, '#y'] })] }, 3);
    assert.deepEqual(gap.strokes.map((s) => s.style), ['#x', '#y']);
  });
  it('shifts offset lines by whole bars, into the right-side whitespace when scrolled there', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95];
    const ahead = lineOf('ahead', values, { offset: 2 });
    const back = lineOf('back', values, { offset: -3 });
    const atEdge = paint({ pane: 'main', lines: [ahead] }, 10);
    // Scrolled to the latest bar: bars 2..9 are plotted (values 0..7).
    assert.deepEqual(coords(atEdge, 'moveTo'), [[25, 90]]);
    assert.equal(coords(atEdge, 'lineTo').at(-1)![0], 95);
    const whitespace = paint({ pane: 'main', lines: [ahead, back] }, 10, -3);
    // With scrollOffset -3, bar p sits at x = 10p - 25; the last value lands on bar 11.
    assert.deepEqual(coords(whitespace, 'lineTo').filter((c) => c[0] > 65).map((c) => c[0]), [75, 85]);
    // The lagging line starts at bar 2 with value index 5.
    assert.deepEqual(coords(whitespace, 'moveTo')[1], [-5, 40]);
    const extended = paint({ pane: 'main', lines: [lineOf('long', [...values, 97, 99])] }, 10, -3);
    assert.deepEqual(coords(extended, 'lineTo').at(-1), [85, 1]);
  });
  it('value and color lookups honor offsets and per-index colors', () => {
    const shifted = lineOf('x', [1, 2, 3], { offset: 2, colors: ['#a', null, '#c'] });
    assert.equal(lineValueAt(shifted, 4), 3);
    assert.equal(lineValueAt(shifted, 1), undefined);
    assert.equal(lineColorAt(shifted, 2), '#a');
    assert.equal(lineColorAt(shifted, 3), '#123456');
    assert.equal(lineColorAt(lineOf('y', [1]), 0), '#123456');
  });
});

describe('fills and levels', () => {
  const A = [null, 50, 60, 40, 40, null, 30, null, 20, 25];
  const B = [null, 45, 45, 50, 30, null, 35, null, 10, 30];
  it('splits the band at crossings, colors each side, and skips zero-area runs', () => {
    const output: IndicatorOutput = {
      pane: 'main',
      lines: [lineOf('a', A), lineOf('b', B)],
      fills: [{ upperKey: 'a', lowerKey: 'b', color: 'G', colorBelow: 'R' }],
    };
    const ctx = paint(output, 10);
    assert.deepEqual(ctx.fills, ['G', 'R', 'G', 'G', 'R']);
    // First run: bars 1-2 above, closing at the crossing (31, 52) on the way to bar 3.
    const first = ctx.calls.slice(0, ctx.calls.findIndex((c) => c[0] === 'fill') + 1)
      .map((c) => [c[0], ...(c.slice(1) as number[]).map((v) => Math.round(v * 1000) / 1000)]);
    assert.deepEqual(first, [
      ['beginPath'], ['moveTo', 15, 50], ['lineTo', 25, 40], ['lineTo', 31, 52],
      ['lineTo', 25, 55], ['lineTo', 15, 55], ['closePath'], ['fill'],
    ]);
    // Five polygons (bar 6 alone has no area) plus the two line strokes.
    assert.equal(ctx.countCalls('closePath'), 5);
    assert.equal(ctx.countCalls('stroke'), 2);
    const oneColor = paint({ ...output, fills: [{ upperKey: 'a', lowerKey: 'b', color: 'G' }] }, 10);
    assert.deepEqual(oneColor.fills, ['G', 'G', 'G', 'G', 'G']);
  });
  it('resolves boundaries from fill-only lines without stroking them', () => {
    const ctx = paint({
      pane: 'main',
      lines: [lineOf('a', A)],
      fillLines: [lineOf('b', B)],
      fills: [{ upperKey: 'a', lowerKey: 'b', color: 'G', colorBelow: 'R' }, { upperKey: 'a', lowerKey: 'none', color: 'X' }],
    }, 10);
    assert.deepEqual(ctx.fills, ['G', 'R', 'G', 'G', 'R']);
    assert.equal(ctx.countCalls('stroke'), 1);
  });
  it('aligns boundaries with different offsets and ignores fills with missing lines', () => {
    const ctx = paint({
      pane: 'main',
      lines: [lineOf('up', [10, 10, 10], { offset: 2 }), lineOf('lo', [0, 0, 0, 0, 0])],
      fills: [
        { upperKey: 'up', lowerKey: 'lo', color: 'F' },
        { upperKey: 'nope', lowerKey: 'lo', color: 'X' },
        { upperKey: 'up', lowerKey: 'nope', color: 'Y' },
      ],
    }, 5);
    assert.deepEqual(ctx.fills, ['F']);
    assert.deepEqual(coords(ctx, 'moveTo')[0], [75, 90]);
  });
  it('draws levels dashed by default across the plot, under bars and lines', () => {
    const ctx = paint({
      pane: 'sub',
      lines: [lineOf('k', [50, 60])],
      levels: [{ value: 80, color: '#u' }, { value: 20, color: '#l', dash: [] }, { value: 50, color: '#m', dash: [2, 2] }],
    }, 2);
    assert.deepEqual(ctx.strokes.slice(0, 3), [
      { style: '#u', width: 1, dash: LEVEL_DASH },
      { style: '#l', width: 1, dash: [] },
      { style: '#m', width: 1, dash: [2, 2] },
    ]);
    assert.deepEqual(coords(ctx, 'moveTo').slice(0, 3), [[0, 20], [0, 80], [0, 50]]);
    assert.deepEqual(coords(ctx, 'lineTo').slice(0, 3), [[100, 20], [100, 80], [100, 50]]);
    assert.deepEqual(ctx.strokes[3], { style: '#123456', width: 1, dash: [] });
  });
});

describe('extents', () => {
  it('covers offset lines, extended values and levels over plotted bars', () => {
    const output: IndicatorOutput = {
      pane: 'main',
      lines: [lineOf('a', [5, 6, 7], { offset: 2 }), lineOf('b', [null, 1, 2, 3, NaN]), lineOf('c', [null])],
      levels: [{ value: 0.5, color: 'x' }, { value: 9, color: 'x' }, { value: 4, color: 'x' }, { value: NaN, color: 'x' }],
    };
    assert.deepEqual(indicatorMinMax({ ...output, levels: [] }, 0, 3), { min: 1, max: 5 });
    assert.deepEqual(indicatorMinMax({ ...output, levels: [] }, 3, 5), { min: 3, max: 7 });
    assert.deepEqual(indicatorMinMax(output, 0, 5), { min: 0.5, max: 9 });
    assert.equal(indicatorMinMax({ pane: 'sub', lines: [lineOf('z', [null, null])] }, 0, 2), null);
    assert.deepEqual(indicatorMinMax({ pane: 'sub', lines: [], levels: [{ value: 3, color: 'x' }] }, 0, 0), { min: 3, max: 3 });
  });
  it('covers fill-only boundary lines, offsets applied', () => {
    const output: IndicatorOutput = { pane: 'main', lines: [lineOf('a', [1, 2, 3])], fillLines: [lineOf('b', [0, 9, 20], { offset: 1 })] };
    assert.deepEqual(indicatorMinMax(output, 0, 3), { min: 0, max: 9 });
    assert.deepEqual(indicatorMinMax({ pane: 'main', lines: [], fillLines: [lineOf('b', [null, 4])] }, 0, 2), { min: 4, max: 4 });
  });
  it('extends the right edge only when scrolled into whitespace', () => {
    const ts = new TimeScale(10, 100);
    assert.equal(indicatorRightEdge(ts.visibleRange(50), ts, 50), 50);
    ts.scrollOffset = 5;
    assert.equal(indicatorRightEdge(ts.visibleRange(50), ts, 50), 45);
    ts.scrollOffset = -4.5;
    assert.equal(indicatorRightEdge(ts.visibleRange(50), ts, 50), 55);
  });
});

describe('instance styling', () => {
  const output: IndicatorOutput = {
    pane: 'sub',
    lines: [lineOf('k', [1]), lineOf('d', [2]), lineOf('j', [3])],
    bars: { key: 'hist', values: [1], up: [true], upColor: 'u', downColor: 'd' },
    fills: [{ key: 'band', upperKey: 'k', lowerKey: 'd', color: 'f' }, { upperKey: 'k', lowerKey: 'j', color: 'g' }],
    levels: [{ key: 'top', value: 80, color: 'l' }, { value: 20, color: 'l' }],
  };
  it('returns the output itself when nothing is styled', () => {
    assert.equal(styleIndicatorOutput(output, {}), output);
    assert.equal(styleIndicatorOutput(output, { lineWidths: [], hiddenLines: [] }), output);
  });
  it('applies positive finite widths by line position', () => {
    const styled = styleIndicatorOutput(output, { lineWidths: [2, 0, Infinity] });
    assert.deepEqual(styled.lines.map((l) => l.lineWidth), [2, undefined, undefined]);
    assert.equal(styled.lines[1], output.lines[1]);
    assert.equal(styled.bars, output.bars);
    assert.equal(styleIndicatorOutput(output, { lineWidths: [NaN, -1] }).lines[0]!.lineWidth, undefined);
    assert.equal(output.lines[0]!.lineWidth, undefined);
  });
  it('hides lines, bars, fills and levels by key; a hidden boundary keeps its visible fill', () => {
    const styled = styleIndicatorOutput(output, { hiddenLines: ['j', 'hist', 'top'], lineWidths: [4, 5, 6] });
    assert.deepEqual(styled.lines.map((l) => [l.key, l.lineWidth]), [['k', 4], ['d', 5]]);
    assert.equal(styled.bars, undefined);
    // Fill 'g' (k..j) stays, as in TradingView; its hidden boundary j bounds it without a stroke.
    assert.deepEqual(styled.fills!.map((f) => f.color), ['f', 'g']);
    assert.deepEqual(styled.fillLines, [output.lines[2]]);
    assert.deepEqual(styled.levels!.map((l) => l.value), [20]);
    assert.deepEqual(styleIndicatorOutput(output, { hiddenLines: ['band'] }).fills!.map((f) => f.color), ['g']);
    // A hidden fill releases its boundaries: d then bounds nothing visible and drops entirely.
    const released = styleIndicatorOutput(output, { hiddenLines: ['band', 'd'] });
    assert.deepEqual(released.lines.map((l) => l.key), ['k', 'j']);
    assert.ok(!('fillLines' in released));
    // Fill-only lines the indicator supplies itself are kept ahead of moved ones; k moves once for two fills.
    const own = lineOf('own', [9]);
    assert.deepEqual(styleIndicatorOutput({ ...output, fillLines: [own] }, { hiddenLines: ['k'] }).fillLines, [own, output.lines[0]]);
    const unfilled = styleIndicatorOutput({ pane: 'main', lines: [lineOf('a', [1])] }, { hiddenLines: ['a'] });
    assert.deepEqual(unfilled, { pane: 'main', lines: [] });
    const bare = styleIndicatorOutput({ pane: 'main', lines: [lineOf('a', [1])], bars: output.bars! }, { hiddenLines: ['x'] });
    assert.ok(!('fills' in bare) && !('levels' in bare) && bare.bars === output.bars);
    const { key: _key, ...keylessBars } = output.bars!;
    const keyless = styleIndicatorOutput({ ...output, bars: keylessBars }, { hiddenLines: ['hist'] });
    assert.equal(keyless.bars, keylessBars);
  });
  it('normalises old-shaped configs in place and applies patches', () => {
    const cfg: IndicatorConfig = { id: 'x', name: 'sma', params: { period: 5, other: 1 }, pane: 'main', colors: ['a'], visible: true };
    const resolved = normalizeIndicatorConfig(cfg);
    assert.equal(resolved, cfg);
    assert.deepEqual([resolved.lineWidths, resolved.hiddenLines], [[], []]);
    const widths = resolved.lineWidths;
    assert.equal(normalizeIndicatorConfig(cfg).lineWidths, widths);
    const colors = ['b', 'c'];
    applyIndicatorPatch(cfg, { params: { period: 9 }, colors, lineWidths: [2], hiddenLines: ['value'], pane: 'sub', visible: false });
    assert.deepEqual(cfg, { id: 'x', name: 'sma', params: { period: 9, other: 1 }, pane: 'sub', colors: ['b', 'c'], visible: false,
      lineWidths: [2], hiddenLines: ['value'] });
    assert.notEqual(cfg.colors, colors);
    applyIndicatorPatch(cfg, {});
    assert.deepEqual(cfg.params, { period: 9, other: 1 });
  });
});

function recordingChart(extra: DeepPartial<ChartConfig> = {}) {
  const ctx = new StyleRecorder();
  const canvas: ChartCanvas = { width: 800, height: 400, getContext: () => ctx };
  let computes = 0;
  const counted: IndicatorDef = {
    name: 'counted', defaultParams: { period: 1 }, defaultColors: ['#c0ffee', '#bada55'], defaultPane: 'main',
    compute(candles, params, colors) {
      computes++;
      return { pane: 'main', lines: [
        { key: 'a', color: colors[0] ?? 'x', values: candles.map((c) => c.close * (params['period'] ?? 1)) },
        { key: 'b', color: colors[1] ?? 'y', values: candles.map((c) => c.close + 1) },
      ] };
    },
  };
  const registry = createIndicatorRegistry().register(counted);
  const chart = createChart({ container: canvas, registries: { indicators: registry }, config: { wasm: false, data: walk(50, 2), ...extra } });
  return { chart, ctx, count: () => computes };
}

describe('Chart.getIndicator / updateIndicator', () => {
  it('addIndicator fills and copies styling fields; getIndicator normalises config-provided indicators', () => {
    const widths = [2];
    const { chart } = recordingChart({
      indicators: [{ id: 'old', name: 'sma', params: { period: 3 }, pane: 'main', colors: ['#111'], visible: true }],
    });
    const id = chart.addIndicator({ name: 'ema', lineWidths: widths, hiddenLines: ['value'] });
    const added = chart.getIndicator(id)!;
    assert.deepEqual([added.lineWidths, added.hiddenLines], [[2], ['value']]);
    assert.notEqual(added.lineWidths, widths);
    assert.deepEqual([chart.getIndicator(chart.addIndicator({ name: 'rsi' }))!.lineWidths], [[]]);
    const old = chart.getIndicator('old')!;
    assert.deepEqual([old.lineWidths, old.hiddenLines], [[], []]);
    assert.equal(chart.getConfig().indicators[0], old);
    assert.equal(chart.getIndicator('missing'), undefined);
    assert.equal(chart.updateIndicator('missing', { visible: false }), false);
    chart.destroy();
  });

  it('recomputes only for params/colors; widths and hidden plots repaint from the cache', () => {
    const { chart, ctx, count } = recordingChart();
    const id = chart.addIndicator({ name: 'counted' });
    assert.equal(count(), 1);
    ctx.reset();
    assert.equal(chart.updateIndicator(id, { lineWidths: [3] }), true);
    assert.equal(count(), 1);
    assert.deepEqual(ctx.strokes.filter((s) => s.style === '#c0ffee').map((s) => s.width), [3]);
    ctx.reset();
    chart.updateIndicator(id, { hiddenLines: ['b'] });
    assert.equal(count(), 1);
    assert.equal(ctx.strokes.some((s) => s.style === '#bada55'), false);
    chart.updateIndicator(id, { params: { period: 1 } });
    assert.equal(count(), 1, 'an unchanged param value hits the cache');
    chart.updateIndicator(id, { params: { period: 2 } });
    assert.equal(count(), 2);
    ctx.reset();
    chart.updateIndicator(id, { colors: ['#abcdef', '#bada55'] });
    assert.equal(count(), 3);
    assert.deepEqual(ctx.strokes.filter((s) => s.style === '#abcdef').map((s) => s.width), [3]);
    chart.destroy();
  });

  it('pane and visibility changes relayout without recomputing', () => {
    const { chart, ctx, count } = recordingChart();
    const id = chart.addIndicator({ name: 'counted' });
    const panes = (): number => ctx.callsNamed('clip').length;
    ctx.reset();
    chart.render();
    const mainOnly = panes();
    ctx.reset();
    chart.updateIndicator(id, { pane: 'sub' });
    assert.equal(panes(), mainOnly + 1);
    assert.equal(count(), 1);
    ctx.reset();
    chart.updateIndicator(id, { visible: false });
    assert.equal(panes(), mainOnly);
    assert.equal(ctx.strokes.some((s) => s.style === '#c0ffee'), false);
    chart.destroy();
  });

  it('acceptance: add Ichimoku with custom lengths and restyle MACD colors without code', () => {
    const { chart, ctx } = recordingChart({ data: walk(200, 2) });
    const ichimoku = chart.addIndicator({ name: 'ichimoku', params: { conversion: 7, base: 22, span: 44, displacement: 22 } });
    assert.deepEqual(chart.getIndicator(ichimoku)!.params, { conversion: 7, base: 22, span: 44, displacement: 22 });
    const macd = chart.addIndicator({ name: 'macd' });
    ctx.reset();
    chart.updateIndicator(macd, { colors: ['#010101', '#020202', '#030303', '#040404'], lineWidths: [2, 2] });
    const macdStrokes = ctx.strokes.filter((s) => s.style === '#010101' || s.style === '#020202');
    assert.deepEqual(macdStrokes.map((s) => s.width), [2, 2]);
    assert.ok(ctx.rects.includes('#030303') && ctx.rects.includes('#040404'));
    // Ichimoku draws its Kumo and five lines on the main pane.
    assert.ok(ctx.fills.includes('rgba(67, 160, 71, 0.1)') || ctx.fills.includes('rgba(244, 67, 54, 0.1)'));
    assert.ok(ctx.strokes.some((s) => s.style === '#2962ff'));
    chart.destroy();
  });
});

describe('chart autoscale and status line', () => {
  const spike: IndicatorDef = {
    name: 'spike', defaultParams: {}, defaultColors: ['#5b1ce0'], defaultPane: 'main',
    compute: (candles, _p, colors) => ({ pane: 'main', lines: [{
      key: 'spike', color: colors[0]!, offset: 5, values: candles.map((c, i) => (i === candles.length - 1 ? 1000 : c.close)),
    }] }),
  };
  it('includes offset values only once they scroll into view, and ignores hidden lines', () => {
    const { chart } = recordingChart();
    chart.indicators.register(spike);
    const id = chart.addIndicator({ name: 'spike' });
    const top = (): number => chart.scale.yToPrice(0);
    assert.ok(top() < 200);
    chart.scale.scrollBy(-10);
    assert.ok(top() > 1000);
    chart.updateIndicator(id, { hiddenLines: ['spike'] });
    assert.ok(top() < 200);
    chart.destroy();
  });

  it('keeps sub-pane levels inside the autoscaled range', () => {
    const { chart, ctx } = recordingChart();
    chart.indicators.register({
      name: 'band', defaultParams: {}, defaultColors: [], defaultPane: 'sub',
      compute: (candles) => ({ pane: 'sub', lines: [{ key: 'v', color: '#0a0b0c', values: candles.map((_, i) => 40 + (i % 20)) }],
        levels: [{ value: 80, color: '#808080' }, { value: 20, color: '#202020' }] }),
    });
    ctx.reset();
    chart.addIndicator({ name: 'band' });
    const levelY = (color: string): number => ctx.starts[ctx.strokes.findIndex((s) => s.style === color)]![1]!;
    // Sub pane: 376px plot minus the 282px main pane; 8% margins top and bottom.
    assert.ok(Math.abs(levelY('#808080') - 94 * 0.08) < 1e-9);
    assert.ok(Math.abs(levelY('#202020') - 94 * 0.92) < 1e-9);
    chart.destroy();
  });

  it('status line lists only visible lines, reading shifted values and per-index colors', () => {
    const { chart, ctx } = recordingChart({ statusLine: { visible: true, indicators: true } });
    chart.indicators.register({
      name: 'shifted', defaultParams: {}, defaultColors: [], defaultPane: 'main',
      compute: (candles) => ({ pane: 'main', lines: [
        { key: 'ahead', color: '#aaaaaa', offset: 2, values: candles.map((_, i) => 100 + i), colors: candles.map(() => '#a1a1a1') },
        { key: 'hidden', color: '#bbbbbb', values: candles.map(() => 150) },
      ] }),
    });
    ctx.reset();
    chart.addIndicator({ name: 'shifted', hiddenLines: ['hidden'] });
    const rows = ctx.texts.filter((t) => /^[A-Z]+ {2}/.test(t.text));
    assert.deepEqual(rows, [{ text: 'AHEAD  147.00', style: '#a1a1a1' }]);
    chart.destroy();
  });
});

describe('fills with hidden boundaries (chart)', () => {
  it('keeps the band and its autoscale extent when both boundary lines are hidden', () => {
    const { chart, ctx } = recordingChart();
    chart.indicators.register({
      name: 'cloud', defaultParams: {}, defaultColors: [], defaultPane: 'main',
      compute: (candles) => ({ pane: 'main',
        lines: [
          { key: 'hi', color: '#1e1e1e', values: candles.map((c, i) => (i === candles.length - 1 ? 1000 : c.close + 5)) },
          { key: 'lo', color: '#2e2e2e', values: candles.map((c) => c.close - 5) },
        ],
        fills: [{ key: 'cloud', upperKey: 'hi', lowerKey: 'lo', color: '#3e3e3e' }] }),
    });
    const top = (): number => chart.scale.yToPrice(0);
    ctx.reset();
    const id = chart.addIndicator({ name: 'cloud', hiddenLines: ['hi', 'lo'] });
    assert.ok(ctx.fills.includes('#3e3e3e'));
    assert.ok(!ctx.strokes.some((s) => s.style === '#1e1e1e' || s.style === '#2e2e2e'));
    assert.ok(top() > 1000);
    ctx.reset();
    chart.updateIndicator(id, { hiddenLines: ['hi', 'lo', 'cloud'] });
    assert.ok(!ctx.fills.includes('#3e3e3e'));
    assert.ok(top() < 200);
    chart.destroy();
  });
  it('Ichimoku keeps its Kumo when both leading spans are unchecked', () => {
    const { chart, ctx } = recordingChart({ data: walk(200, 2) });
    ctx.reset();
    chart.addIndicator({ name: 'ichimoku', hiddenLines: ['senkouA', 'senkouB'] });
    assert.ok(ctx.fills.includes('rgba(67, 160, 71, 0.1)') || ctx.fills.includes('rgba(244, 67, 54, 0.1)'));
    assert.ok(!ctx.strokes.some((s) => s.style === '#a5d6a7' || s.style === '#ef9a9a'));
    assert.ok(ctx.strokes.some((s) => s.style === '#2962ff'));
    chart.destroy();
  });
});

/**
 * Price-axis badges as [fill color, text] pairs: a badge fills a rect, clips
 * to that same rect and writes its text there.
 */
class BadgeRecorder extends StyleRecorder {
  private events: { kind: string; value: unknown; box?: string }[] = [];
  fillRect(x: number, y: number, w: number, h: number): void {
    super.fillRect(x, y, w, h);
    this.events.push({ kind: 'fill', value: this.fillStyle, box: [x, y, w, h].join() });
  }
  rect(x: number, y: number, w: number, h: number): void {
    super.rect(x, y, w, h);
    this.events.push({ kind: 'clip', value: null, box: [x, y, w, h].join() });
  }
  fillText(text: string, x: number, y: number): void {
    super.fillText(text, x, y);
    this.events.push({ kind: 'text', value: text });
  }
  badges(): [unknown, unknown][] {
    const out: [unknown, unknown][] = [];
    const e = this.events;
    for (let i = 2; i < e.length; i++) {
      if (e[i - 2]!.kind === 'fill' && e[i - 1]!.kind === 'clip' && e[i - 2]!.box === e[i - 1]!.box && e[i]!.kind === 'text') {
        out.push([e[i - 2]!.value, e[i]!.value]);
      }
    }
    this.events = [];
    return out;
  }
}

describe('price-axis indicator labels', () => {
  function labelled(data: Candle[], def: IndicatorDef, colors?: string[]) {
    const ctx = new BadgeRecorder();
    const canvas: ChartCanvas = { width: 800, height: 400, getContext: () => ctx };
    const chart = createChart({ container: canvas, config: {
      wasm: false, data, priceAxis: { labels: { indicator: true, lastPrice: false } },
    } });
    chart.indicators.register(def);
    ctx.badges();
    chart.addIndicator(colors === undefined ? { name: def.name } : { name: def.name, colors });
    return { chart, ctx };
  }
  const badges: IndicatorDef = {
    name: 'badges', defaultParams: {}, defaultColors: [], defaultPane: 'main',
    compute: (candles) => {
      const n = candles.length;
      return { pane: 'main', lines: [
        { key: 'tail', color: '#e0e0e0', values: candles.map((_, i) => 300 + i), colors: candles.map((_, i) => (i === n - 1 ? '#d0d0d0' : null)) },
        { key: 'back', color: '#c1c1c1', offset: -3, values: candles.map((_, i) => 200 + i) },
        { key: 'ahead', color: '#c2c2c2', offset: 2, values: candles.map((_, i) => 150 + i) },
        { key: 'gone', color: '#b1b1b1', offset: -(n + 10), values: candles.map(() => 250) },
        { key: 'warm', color: '#a1a1a1', values: candles.map(() => null) },
      ] };
    },
  };

  it('read each line at its last plotted bar in view, with offsets and per-index colors', () => {
    const { chart, ctx } = labelled(walk(50, 2), badges);
    // Latest bar: 'back' ends 3 bars early showing the newest value; 'ahead' shows the value drawn at the last candle.
    assert.deepEqual(ctx.badges(), [['#d0d0d0', '349.00'], ['#c1c1c1', '249.00'], ['#c2c2c2', '197.00']]);
    chart.scale.scrollBy(10);
    assert.deepEqual(ctx.badges(), [['#e0e0e0', '339.00'], ['#c1c1c1', '242.00'], ['#c2c2c2', '187.00']]);
    // Scrolled into the whitespace, the forward-shifted line is read where it ends.
    chart.scale.scrollBy(-20);
    assert.deepEqual(ctx.badges(), [['#d0d0d0', '349.00'], ['#c1c1c1', '249.00'], ['#c2c2c2', '199.00']]);
    chart.destroy();
  });

  it("Supertrend's badge takes the trend color of its last bar", () => {
    const falling: Candle[] = Array.from({ length: 40 }, (_, i) => {
      const close = 200 - i * 2;
      return { time: i * 60, open: close + 1, high: close + 1.5, low: close - 1.5, close };
    });
    const { chart, ctx } = labelled(falling, { ...BUILTIN_INDICATORS.find((d) => d.name === 'supertrend')!, name: 'st-badge' },
      ['#00aa00', '#aa0000']);
    const rects = ctx.badges().map(([color]) => color);
    assert.deepEqual(rects, ['#aa0000']);
    chart.destroy();
  });
});

describe('built-in metadata', () => {
  it('every engine-owned built-in has a label, short name, inputs for its params and styles for its colors', () => {
    const candles = walk(80, 4);
    const owned = ['sma', 'ema', 'boll', 'macd', 'rsi', 'kdj', 'vol', 'atr', 'supertrend', 'ichimoku', 'donchian', 'stoch', 'stochrsi', 'psar'];
    const defs = BUILTIN_INDICATORS.filter((def) => owned.includes(def.name));
    assert.equal(defs.length, owned.length);
    for (const def of defs) {
      assert.ok(def.label && def.shortName, def.name);
      assert.deepEqual(def.inputs!.map((i) => i.key).sort(), Object.keys(def.defaultParams).sort(), def.name);
      for (const input of def.inputs!) assert.ok(input.label.length > 0 && (input.integer !== true || input.step === 1), def.name);
      assert.deepEqual([...new Set(def.styles!.map((s) => s.colorIndex))].sort(), def.defaultColors.map((_, i) => i), def.name);
      const output = def.compute(candles, def.defaultParams, resolveIndicatorColors(def.defaultColors, '#0f0', '#f00'), null);
      assert.deepEqual(indicatorLineKeys(def), output.lines.map((l) => l.key), def.name);
      // Line colors come from the style rows' color indices.
      for (const style of def.styles!) {
        const plot = output.lines.find((l) => l.key === style.key);
        if (plot !== undefined && plot.colors === undefined) {
          assert.equal(plot.color, resolveIndicatorColors(def.defaultColors, '#0f0', '#f00')[style.colorIndex], def.name);
        }
        const kind = style.kind ?? 'line';
        if (kind === 'histogram') assert.equal(output.bars!.key, style.key, def.name);
        if (kind === 'fill') assert.ok(output.fills!.some((f) => f.key === style.key), def.name);
        if (kind === 'level') assert.ok(output.levels!.some((l) => l.key === style.key), def.name);
        if (kind === 'line' || kind === 'dots') assert.ok(plot !== undefined, def.name);
      }
    }
  });
  it('indicatorStyleColors pads configured colors with the defaults, keeping tokens', () => {
    assert.deepEqual(indicatorStyleColors(macdIndicator, ['#111']), ['#111', ...macdIndicator.defaultColors.slice(1)]);
    assert.deepEqual(indicatorStyleColors(macdIndicator, ['#111']).slice(2), ['up', 'down']);
    const colors = ['x', 'y'];
    const padded = indicatorStyleColors({ defaultColors: ['a'] }, colors);
    assert.deepEqual(padded, ['x', 'y']);
    assert.notEqual(padded, colors);
  });
  it('indicatorLineKeys ignores non-stroke rows and de-duplicates shared keys', () => {
    assert.deepEqual(indicatorLineKeys({}), []);
    assert.deepEqual(indicatorLineKeys({ styles: [
      { key: 'a', label: 'A', colorIndex: 0 }, { key: 'a', label: 'A2', colorIndex: 1, kind: 'line' },
      { key: 'h', label: 'H', colorIndex: 2, kind: 'histogram' }, { key: 'p', label: 'P', colorIndex: 3, kind: 'dots' },
    ] }), ['a', 'p']);
  });
  it('the root barrel exports the engine API and new studies', () => {
    for (const name of ['atrIndicator', 'supertrendIndicator', 'ichimokuIndicator', 'donchianIndicator', 'stochIndicator',
      'stochRsiIndicator', 'psarIndicator', 'rollingMaxValues', 'rollingMinValues', 'styleIndicatorOutput', 'drawIndicator',
      'indicatorLineKeys', 'indicatorStyleColors', 'normalizeIndicatorConfig', 'applyIndicatorPatch', 'LEVEL_DASH']) {
      assert.ok(name in root, name);
    }
  });
});
