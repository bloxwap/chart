import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, DEFAULT_PRICE_LINE_COLOR, drawPriceLines, LINE_STYLE_DASH, type PriceLine } from '../dist/index.js';
import { MockContext2D, type ChartCanvas } from '../dist/dom.js';
import { contrastingTextColor } from '../dist/color.js';
import { crisp } from '../dist/render/drawings.js';
import { PriceLineState } from '../dist/core/price-lines.js';
import { createIndicatorRegistry } from '../dist/indicators/registry.js';
import type { IndicatorDef } from '../dist/indicators/types.js';
import type { Candle } from '../dist/core/data.js';
import type { DeepPartial, ChartConfig } from '../dist/config.js';
import type { RenderView } from '../dist/render/renderer.js';

const MARK = '#35b5ff';
const LAST = 'rgba(255, 255, 255, 0.6)';

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 5) * 10;
    return { time: 1700000000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
  });
}

interface Op {
  readonly op: 'stroke' | 'fillRect' | 'fillText';
  readonly style: string;
  readonly width: number;
  readonly dash: readonly number[];
  readonly path: readonly (readonly [number, number])[];
  readonly args: readonly unknown[];
}

/** Records the paint state at each stroke, filled rect and text. */
class Recorder extends MockContext2D {
  readonly ops: Op[] = [];
  private dash: number[] = [];
  private readonly dashes: number[][] = [];
  private path: [number, number][] = [];
  override setLineDash(segments: number[]): void { super.setLineDash(segments); this.dash = [...segments]; }
  // Like a real canvas, the dash pattern is part of the saved state.
  override save(): void { super.save(); this.dashes.push(this.dash); }
  override restore(): void { super.restore(); this.dash = this.dashes.pop() ?? []; }
  override beginPath(): void { super.beginPath(); this.path = []; }
  override moveTo(x: number, y: number): void { super.moveTo(x, y); this.path.push([x, y]); }
  override lineTo(x: number, y: number): void { super.lineTo(x, y); this.path.push([x, y]); }
  override stroke(): void {
    super.stroke();
    this.ops.push({ op: 'stroke', style: String(this.strokeStyle), width: this.lineWidth, dash: this.dash, path: this.path, args: [] });
  }
  override fillRect(x: number, y: number, w: number, h: number): void {
    super.fillRect(x, y, w, h);
    this.ops.push({ op: 'fillRect', style: String(this.fillStyle), width: 0, dash: [], path: [], args: [x, y, w, h] });
  }
  override fillText(text: string, x: number, y: number): void {
    super.fillText(text, x, y);
    this.ops.push({ op: 'fillText', style: String(this.fillStyle), width: 0, dash: [], path: [], args: [text, x, y] });
  }
  reset(): void { this.ops.length = 0; this.calls.length = 0; }
  frames(): number { return this.countCalls('scale'); }
  strokesOf(color: string): Op[] { return this.ops.filter((o) => o.op === 'stroke' && o.style === color); }
  textsOf(text: string): Op[] { return this.ops.filter((o) => o.op === 'fillText' && o.args[0] === text); }
}

function near(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} ≈ ${expected}`);
}

function fixture(config: DeepPartial<ChartConfig> = {}, registry?: ReturnType<typeof createIndicatorRegistry>) {
  const ctx = new Recorder();
  const canvas: ChartCanvas = { width: 800, height: 400, getContext: () => ctx };
  const chart = createChart({
    container: canvas,
    config: { wasm: false, data: candles(60), ...config },
    ...(registry !== undefined ? { registries: { indicators: registry } } : {}),
  });
  return { chart, ctx };
}

describe('series price lines: lifecycle', () => {
  it('resolves defaults, lists lines in creation order and removes idempotently', () => {
    const { chart, ctx } = fixture();
    const a = chart.series.createPriceLine({ price: 100 });
    const b = chart.series.createPriceLine({
      price: 105, color: MARK, lineStyle: 'dashed', lineWidth: 2, title: 'mark', axisLabelVisible: false,
      lineVisible: false, axisLabelColor: '#000000', axisLabelTextColor: '#ffffff', autoscale: true, id: 'mark',
    });
    assert.equal(a.id, 'pl-1');
    assert.deepEqual(a.options(), {
      id: 'pl-1', price: 100, color: DEFAULT_PRICE_LINE_COLOR, lineStyle: 'solid', lineWidth: 1, title: '',
      axisLabelVisible: true, lineVisible: true, axisLabelColor: '', axisLabelTextColor: '', autoscale: false,
    });
    assert.equal(b.id, 'mark');
    assert.deepEqual(b.options(), {
      id: 'mark', price: 105, color: MARK, lineStyle: 'dashed', lineWidth: 2, title: 'mark', axisLabelVisible: false,
      lineVisible: false, axisLabelColor: '#000000', axisLabelTextColor: '#ffffff', autoscale: true,
    });
    assert.deepEqual(chart.series.priceLines(), [a, b]);
    // The listing is a copy.
    (chart.series.priceLines() as PriceLine[]).length = 0;
    assert.equal(chart.series.priceLines().length, 2);

    ctx.reset();
    a.remove();
    assert.equal(ctx.frames(), 1);
    a.remove();
    assert.equal(ctx.frames(), 1, 'a second remove is a no-op');
    assert.equal(chart.series.removePriceLine(a), false);
    a.applyOptions({ price: 101 });
    assert.equal(ctx.frames(), 1, 'a removed handle never repaints');
    assert.equal(a.options().price, 100);
    assert.deepEqual(chart.series.priceLines(), [b]);
    assert.equal(chart.series.removePriceLine(b), true);
    assert.equal(chart.series.priceLines().length, 0);

    // A handle from another chart is not live here.
    const other = fixture();
    const foreign = other.chart.series.createPriceLine({ price: 1 });
    assert.equal(chart.series.removePriceLine(foreign), false);
    assert.equal(other.chart.series.priceLines().length, 1);
    other.chart.destroy();
    chart.destroy();
  });

  it('applyOptions patches, ignores ids and undefined values, and skips no-op patches', () => {
    const { chart, ctx } = fixture();
    const line = chart.series.createPriceLine({ price: 100, id: 'x' });
    ctx.reset();
    line.applyOptions({ price: 100 });
    line.applyOptions({});
    line.applyOptions({ id: 'renamed' });
    line.applyOptions({ color: undefined } as unknown as Partial<{ color: string }>);
    assert.equal(ctx.frames(), 0, 'unchanged patches do not repaint');
    line.applyOptions({ price: 101, title: 'mark' });
    assert.equal(ctx.frames(), 1);
    assert.equal(line.id, 'x');
    assert.equal(line.options().price, 101);
    assert.equal(line.options().title, 'mark');
    chart.destroy();
  });
});

describe('series price lines: rendering', () => {
  it('strokes each style across the plot with its color, width and dash', () => {
    const { chart, ctx } = fixture();
    const { width } = chart.plotArea;
    ctx.reset();
    chart.batch(() => {
      chart.series.createPriceLine({ price: 103.37, color: MARK, lineStyle: 'dashed', title: 'mark' });
      chart.series.createPriceLine({ price: 96, color: LAST, lineStyle: 'dotted', title: 'last' });
      chart.series.createPriceLine({ price: 100, color: '#ff00ff', lineWidth: 2 });
      chart.series.createPriceLine({ price: 102, color: '#00ff00', lineStyle: 'dashed', lineWidth: 3 });
    });
    const [mark] = ctx.strokesOf(MARK);
    assert.ok(mark);
    const y = crisp(chart.scale.priceToY(103.37), 1, 1);
    assert.deepEqual(mark.path, [[0, y], [width, y]]);
    assert.equal(mark.width, 1);
    assert.deepEqual(mark.dash, [...LINE_STYLE_DASH.dashed!]);
    const [last] = ctx.strokesOf(LAST);
    assert.deepEqual(last?.dash, [...LINE_STYLE_DASH.dotted!]);
    assert.deepEqual(last?.path, [[0, crisp(chart.scale.priceToY(96), 1, 1)], [width, crisp(chart.scale.priceToY(96), 1, 1)]]);
    const [solid] = ctx.strokesOf('#ff00ff');
    assert.equal(solid?.width, 2);
    assert.deepEqual(solid?.dash, []);
    assert.equal(solid?.path[0]?.[1], crisp(chart.scale.priceToY(100), 2, 1));
    const [wide] = ctx.strokesOf('#00ff00');
    assert.deepEqual(wide?.dash, LINE_STYLE_DASH.dashed!.map((v) => v * 3), 'dashes scale with the line width');

    // Restyling recomputes the dash; recoloring does not need to.
    const line = chart.series.priceLines()[2]!;
    line.applyOptions({ lineStyle: 'dotted', lineWidth: 1 });
    assert.deepEqual(ctx.strokesOf('#ff00ff').at(-1)?.dash, [...LINE_STYLE_DASH.dotted!]);
    chart.destroy();
  });

  it('draws the formatted price badge and a title tag inside the plot at the axis edge', () => {
    const { chart, ctx } = fixture();
    const { width } = chart.plotArea;
    const axisWidth = 800 - width;
    const labelHeight = 12 + 8;
    ctx.reset();
    chart.series.createPriceLine({ price: 103.37, color: MARK, lineStyle: 'dashed', title: 'mark' });
    const y = chart.scale.priceToY(103.37);
    const top = y - labelHeight / 2;
    const text = contrastingTextColor(MARK, '#ffffff');
    const badge = ctx.ops.find((o) => o.op === 'fillRect' && o.style === MARK && o.args[0] === width);
    assert.deepEqual(badge?.args, [width, top, axisWidth, labelHeight]);
    const [price] = ctx.textsOf('103.37');
    assert.deepEqual(price?.args, ['103.37', width + 4, top + labelHeight / 2]);
    assert.equal(price?.style, text);
    // measureText is 6px per glyph in the mock: 'mark' → 24 + 8 padding.
    const tag = ctx.ops.find((o) => o.op === 'fillRect' && o.style === MARK && o.args[0] === width - 32);
    assert.deepEqual(tag?.args, [width - 32, top, 32, labelHeight]);
    const [title] = ctx.textsOf('mark');
    assert.deepEqual(title?.args, ['mark', width - 28, top + labelHeight / 2]);
    assert.equal(title?.style, text);
    chart.destroy();
  });

  it('uses explicit label colors, clamps badges into the pane and honors precision', () => {
    const { chart, ctx } = fixture({ priceAxis: { precision: 1 } });
    const top = chart.scale.yToPrice(2);
    ctx.reset();
    chart.series.createPriceLine({ price: top, color: MARK, axisLabelColor: '#101010', axisLabelTextColor: '#fafafa', title: 'hi' });
    const badge = ctx.ops.find((o) => o.op === 'fillRect' && o.style === '#101010' && o.args[0] === chart.plotArea.width);
    assert.equal(badge?.args[1], 0, 'a badge near the top edge is clamped inside the pane');
    const [price] = ctx.textsOf(top.toFixed(1));
    assert.equal(price?.style, '#fafafa');
    assert.equal(ctx.textsOf('hi')[0]?.style, '#fafafa');
    assert.equal(ctx.strokesOf(MARK).length, 1, 'the line keeps its own color');
    chart.destroy();
  });

  it('paints above the built-in references with every line before any label, in creation order', () => {
    const { chart, ctx } = fixture({ priceAxis: { lines: { lastPrice: true }, labels: { lastPrice: true } } });
    ctx.reset();
    chart.batch(() => {
      chart.series.createPriceLine({ price: 103.37, color: '#111111', title: 'one' });
      chart.series.createPriceLine({ price: 103.37, color: '#222222', title: 'two' });
    });
    const index = (pred: (o: Op) => boolean): number => ctx.ops.findIndex(pred);
    let reference = -1;
    ctx.ops.forEach((o, i) => { if (o.op === 'stroke' && o.dash.length === 2 && o.dash[0] === 4) reference = i; });
    const first = index((o) => o.op === 'stroke' && o.style === '#111111');
    const second = index((o) => o.op === 'stroke' && o.style === '#222222');
    const firstLabel = index((o) => o.op === 'fillRect' && o.style === '#111111');
    const secondLabel = index((o) => o.op === 'fillRect' && o.style === '#222222');
    assert.ok(reference >= 0 && reference < first, 'the last-price reference is underneath');
    assert.ok(first < second && second < firstLabel && firstLabel < secondLabel);
    chart.destroy();
  });

  it('hides labels with axisLabelVisible false and the stroke with lineVisible false', () => {
    const { chart, ctx } = fixture();
    ctx.reset();
    chart.series.createPriceLine({ price: 103.37, color: MARK, title: 'mark', axisLabelVisible: false });
    assert.equal(ctx.strokesOf(MARK).length, 1);
    assert.equal(ctx.ops.filter((o) => o.op === 'fillRect' && o.style === MARK).length, 0);
    assert.equal(ctx.textsOf('mark').length, 0);
    assert.equal(ctx.textsOf('103.37').length, 0);
    ctx.reset();
    chart.series.priceLines()[0]!.applyOptions({ axisLabelVisible: true, lineVisible: false });
    assert.equal(ctx.strokesOf(MARK).length, 0);
    assert.equal(ctx.textsOf('103.37').length, 1);
    assert.equal(ctx.textsOf('mark').length, 1);
    chart.destroy();
  });

  it('skips lines whose price is off the pane or not finite', () => {
    const { chart, ctx } = fixture();
    ctx.reset();
    chart.batch(() => {
      chart.series.createPriceLine({ price: 1e6, color: '#aa0000', title: 'above' });
      chart.series.createPriceLine({ price: -1e6, color: '#bb0000', title: 'below' });
      chart.series.createPriceLine({ price: Number.NaN, color: '#cc0000', title: 'nan', autoscale: true });
    });
    for (const color of ['#aa0000', '#bb0000', '#cc0000']) {
      assert.equal(ctx.ops.filter((o) => o.style === color).length, 0, color);
    }
    assert.equal(ctx.textsOf('above').length + ctx.textsOf('below').length + ctx.textsOf('nan').length, 0);
    assert.ok(Number.isFinite(chart.scale.yToPrice(0)), 'a NaN autoscale line leaves the range finite');
    chart.destroy();
  });

  it('places badges and tags on a left price axis and keeps tags without a visible axis', () => {
    const left = fixture({ priceAxis: { position: 'left' } });
    const axisWidth = 800 - left.chart.plotArea.width;
    left.ctx.reset();
    left.chart.series.createPriceLine({ price: 103.37, color: MARK, title: 'mark' });
    const top = left.chart.scale.priceToY(103.37) - 10;
    assert.ok(left.ctx.calls.some((c) => c[0] === 'translate' && c[1] === axisWidth), 'the plot is translated past the left axis');
    assert.deepEqual(left.ctx.ops.find((o) => o.op === 'fillRect' && o.style === MARK && o.args[0] === -axisWidth)?.args,
      [-axisWidth, top, axisWidth, 20]);
    assert.deepEqual(left.ctx.textsOf('103.37')[0]?.args, ['103.37', -axisWidth + 4, top + 10]);
    assert.deepEqual(left.ctx.textsOf('mark')[0]?.args, ['mark', 4, top + 10], 'the tag sits at the plot edge beside a left axis');
    left.chart.destroy();

    const hidden = fixture({ priceAxis: { visible: false } });
    hidden.ctx.reset();
    hidden.chart.series.createPriceLine({ price: 103.37, color: MARK, title: 'mark' });
    assert.equal(hidden.ctx.textsOf('103.37').length, 0);
    assert.deepEqual(hidden.ctx.textsOf('mark')[0]?.args[1], 800 - 32 + 4);
    hidden.chart.destroy();
  });

  it('repaints live lines on every render and draws nothing without lines or a main pane', () => {
    const { chart, ctx } = fixture();
    chart.series.createPriceLine({ price: 103.37 });
    ctx.reset();
    chart.render();
    const strokes = ctx.strokesOf(DEFAULT_PRICE_LINE_COLOR);
    assert.equal(strokes.length, 1, 'a plain render repaints the line once');
    const y = crisp(chart.scale.priceToY(103.37), 1, 1);
    assert.deepEqual(strokes[0]?.path, [[0, y], [chart.plotArea.width, y]]);
    assert.equal(ctx.textsOf('103.37').length, 1);
    const view = { canvasWidth: 800, canvasHeight: 400, plotWidth: 736, plotHeight: 376, pixelRatio: 1 } as unknown as RenderView;
    const probe = new MockContext2D();
    const state = new PriceLineState(() => {}, LINE_STYLE_DASH);
    state.api.createPriceLine({ price: 1 });
    drawPriceLines(probe, { ...view, panes: [] });
    drawPriceLines(probe, { ...view, panes: [], priceLines: [] });
    drawPriceLines(probe, { ...view, panes: [], priceLines: state.lines });
    assert.equal(probe.calls.length, 0);
    chart.destroy();
  });
});

describe('series price lines: not drawings', () => {
  it('is not hit-testable and survives clearDrawings and hidden drawings', () => {
    const { chart, ctx } = fixture();
    chart.series.createPriceLine({ price: 103.37, color: MARK, title: 'mark' });
    const y = chart.scale.priceToY(103.37);
    assert.equal(chart.drawingAt(100, y), null);
    assert.equal(chart.getConfig().drawings.length, 0);
    chart.addDrawing({ name: 'hline', points: [{ index: 10, price: 90 }] });
    assert.equal(chart.drawingAt(100, y), null, 'only the real drawing is hit-testable');
    assert.notEqual(chart.drawingAt(100, chart.scale.priceToY(90)), null);
    ctx.reset();
    chart.setDrawingsHidden(true);
    assert.equal(ctx.strokesOf(MARK).length, 1);
    chart.setDrawingsHidden(false);
    ctx.reset();
    assert.equal(chart.clearDrawings(), 1);
    assert.equal(ctx.strokesOf(MARK).length, 1);
    assert.equal(chart.series.priceLines().length, 1);
    chart.destroy();
  });
});

describe('series price lines: live updates', () => {
  it('coalesces 1000 applyOptions in a batch into one render without config clones or recomputes', () => {
    let computes = 0;
    const counted: IndicatorDef = {
      name: 'counted', defaultParams: {}, defaultColors: ['#123456'], defaultPane: 'main',
      compute(data, _params, colors) {
        computes++;
        return { pane: 'main', lines: [{ key: 'close', color: colors[0]!, values: data.map((c) => c.close) }] };
      },
    };
    const { chart, ctx } = fixture({}, createIndicatorRegistry(false).register(counted));
    chart.addIndicator({ name: 'counted' });
    const config = chart.getConfig();
    const computed = computes;
    const mark = chart.series.createPriceLine({ price: 100, color: MARK, lineStyle: 'dashed', title: 'mark' });
    ctx.reset();
    chart.batch(() => {
      for (let i = 0; i < 1000; i++) mark.applyOptions({ price: 95 + i / 100 });
    });
    assert.equal(ctx.frames(), 1);
    assert.equal(chart.getConfig(), config, 'the config object is not cloned');
    assert.equal(computes, computed, 'indicators are not recomputed');
    const strokes = ctx.strokesOf(MARK);
    assert.equal(strokes.length, 1);
    assert.equal(strokes[0]?.path[0]?.[1], crisp(chart.scale.priceToY(95 + 999 / 100), 1, 1));
    chart.destroy();
  });

  it('only extends the automatic range for lines with autoscale', () => {
    const { chart } = fixture();
    const high = chart.series.createPriceLine({ price: 200 });
    const low = chart.series.createPriceLine({ price: 10 });
    const { height } = chart.plotArea;
    assert.ok(chart.scale.priceToY(200) < 0, 'off-scale by default');
    assert.ok(chart.scale.priceToY(10) > height);
    high.applyOptions({ autoscale: true });
    assert.ok(chart.scale.yToPrice(0) > 200);
    assert.ok(chart.scale.priceToY(10) > height);
    low.applyOptions({ autoscale: true });
    assert.ok(chart.scale.yToPrice(height) < 10);
    const y = chart.scale.priceToY(200);
    assert.ok(y >= 0 && y <= height);
    // An in-range autoscale line leaves the candle range alone.
    const inside = fixture();
    const before = inside.chart.scale.yToPrice(0);
    inside.chart.series.createPriceLine({ price: 100, autoscale: true });
    assert.equal(inside.chart.scale.yToPrice(0), before);
    inside.chart.destroy();
    chart.destroy();
  });

  it('frames autoscale lines alone while no bars are visible', () => {
    const { chart } = fixture({ data: [] });
    const { height } = chart.plotArea;
    const before = [chart.scale.yToPrice(0), chart.scale.yToPrice(height)];
    chart.series.createPriceLine({ price: 65000 });
    assert.deepEqual([chart.scale.yToPrice(0), chart.scale.yToPrice(height)], before, 'plain lines keep the placeholder range');
    const mark = chart.series.createPriceLine({ price: 65000, autoscale: true });
    near(chart.scale.priceToY(65000), height / 2, 'a lone line is centred, not merged with the 0..1 placeholder');
    assert.ok(chart.scale.yToPrice(height) > 64000 && chart.scale.yToPrice(0) < 66000);
    chart.series.createPriceLine({ price: 64000, autoscale: true });
    assert.ok(chart.scale.yToPrice(height) < 64000 && chart.scale.yToPrice(0) > 65000, 'several lines span their prices');
    assert.ok(chart.scale.yToPrice(height) > 63000, 'still without the placeholder');
    mark.remove();
    chart.destroy();
  });

  it('is inert after destroy: no throws and no renders', () => {
    const { chart, ctx } = fixture();
    const line = chart.series.createPriceLine({ price: 103.37, title: 'mark' });
    chart.series.setMarkers([{ time: 1700000000, position: 'aboveBar', color: '#fff', shape: 'circle' }]);
    chart.destroy();
    ctx.reset();
    line.applyOptions({ price: 105 });
    line.remove();
    const late = chart.series.createPriceLine({ price: 1 });
    late.applyOptions({ price: 2 });
    late.remove();
    chart.series.setMarkers([{ time: 1700000000, position: 'aboveBar', color: '#fff', shape: 'circle' }]);
    assert.equal(chart.series.removePriceLine(line), false);
    assert.equal(ctx.calls.length, 0);
    assert.equal(chart.series.priceLines().length, 0);
    assert.equal(chart.series.markers().length, 0);
    assert.equal(line.options().price, 103.37);
    assert.equal(late.options().price, 1);
  });
});

describe('PriceLineState', () => {
  it('scales dashes and extends autoscale bounds on either side', () => {
    let renders = 0;
    const state = new PriceLineState(() => { renders++; }, { solid: undefined, dashed: [6, 4], dotted: [1, 3] });
    assert.deepEqual(state.dashFor('solid', 3), []);
    assert.deepEqual(state.dashFor('dotted', 2), [2, 6]);
    state.api.createPriceLine({ price: 50, autoscale: true });
    state.api.createPriceLine({ price: 500 });
    assert.equal(renders, 2);
    assert.equal(state.autoscaleBound(100, -1, false), 50);
    assert.equal(state.autoscaleBound(100, 1, false), 100);
    assert.equal(state.autoscaleBound(10, 1, false), 50);
    assert.equal(state.autoscaleBound(10, -1, false), 10);
    // Without visible bars the placeholder bound is replaced, not extended.
    assert.equal(state.autoscaleBound(1, 1, true), 50);
    assert.equal(state.autoscaleBound(0, -1, true), 50);
    const bare = new PriceLineState(() => {}, LINE_STYLE_DASH);
    bare.api.createPriceLine({ price: 70 });
    assert.equal(bare.autoscaleBound(1, 1, true), 1, 'no autoscale line keeps the placeholder');
    assert.equal(bare.autoscaleBound(0, -1, true), 0);
  });
});
