import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockContext2D } from '../dist/dom.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { resolveConfig, type ChartConfig } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';
import { renderChart, type RenderView } from '../dist/render/renderer.js';
import type { IndicatorOutput } from '../dist/indicators/types.js';

const candles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
  time: 1700000000 + i * 3600,
  open: 100 + i,
  high: 102 + i,
  low: 99 + i,
  close: 101 + i,
  volume: 1000 + i * 10,
}));

function makeScale(min: number, max: number, height: number): PriceScale {
  const ps = new PriceScale();
  ps.height = height;
  ps.setRange(min, max);
  return ps;
}

function makeView(overrides: {
  config?: Partial<Parameters<typeof resolveConfig>[0]>;
  indicators?: IndicatorOutput[];
  subIndicators?: IndicatorOutput[];
  drawings?: RenderView['drawings'];
  crosshair?: { active: boolean; x: number; y: number };
  noPanes?: boolean;
}): RenderView {
  const config: ChartConfig = resolveConfig({
    data: candles,
    width: 800,
    height: 500,
    watermark: { visible: true, text: 'WM' },
    ...overrides.config,
  });
  const timeScale = new TimeScale(10, 800 - config.priceAxis.width);
  const range = timeScale.visibleRange(candles.length);
  const panes = overrides.noPanes === true
    ? []
    : [
        {
          layout: { id: 'main', kind: 'main' as const, weight: 3, y: 0, height: 300 },
          priceScale: makeScale(99, 121, 300),
          indicators: overrides.indicators ?? [],
        },
        {
          layout: { id: 'sub', kind: 'indicator' as const, weight: 1, y: 300, height: 176 },
          priceScale: makeScale(0, 100, 176),
          indicators: overrides.subIndicators ?? [],
        },
      ];
  return {
    canvasWidth: 800,
    canvasHeight: 500,
    plotWidth: 800 - config.priceAxis.width,
    plotHeight: 500 - config.timeAxis.height,
    pixelRatio: 1,
    candles,
    range,
    timeScale,
    panes,
    config,
    drawings: overrides.drawings ?? [],
    crosshair: overrides.crosshair ?? { active: false, x: 0, y: 0 },
  };
}

const lineOutput: IndicatorOutput = {
  pane: 'main',
  lines: [{ key: 'value', values: candles.map((c, i) => (i % 4 === 0 ? null : c.close)), color: '#123456' }],
};

const barOutput: IndicatorOutput = {
  pane: 'sub',
  lines: [],
  bars: {
    values: candles.map((_, i) => (i === 0 ? null : i - 10)),
    up: candles.map((_, i) => i % 2 === 0),
    upColor: '#0f0',
    downColor: '#f00',
  },
};

describe('renderChart layers', () => {
  it('draws background, watermark, grid, series, indicators, axes', () => {
    const ctx = new MockContext2D();
    renderChart(ctx, makeView({ indicators: [lineOutput], subIndicators: [barOutput] }));
    assert.ok(ctx.countCalls('fillRect') > 10);
    assert.ok(ctx.countCalls('fillText') > 4); // watermark + axis labels
    assert.ok(ctx.countCalls('stroke') > 4); // grid + series + indicator lines
    assert.ok(ctx.countCalls('save') >= 4);
  });
  it('omits the grid when disabled, honoring direction flags', () => {
    const on = new MockContext2D();
    renderChart(on, makeView({}));
    const strokesOn = on.countCalls('stroke');

    const off = new MockContext2D();
    renderChart(off, makeView({ config: { grid: { visible: false } } }));
    assert.ok(off.countCalls('stroke') < strokesOn);

    const vOnly = new MockContext2D();
    renderChart(vOnly, makeView({ config: { grid: { horizontal: false } } }));
    const hOnly = new MockContext2D();
    renderChart(hOnly, makeView({ config: { grid: { vertical: false } } }));
    assert.ok(vOnly.countCalls('stroke') < strokesOn);
    assert.ok(hOnly.countCalls('stroke') < strokesOn);
  });
  it('omits axis labels when axes are hidden', () => {
    const ctx = new MockContext2D();
    renderChart(ctx, makeView({ config: { priceAxis: { visible: false }, timeAxis: { visible: false } } }));
    const texts = ctx.callsNamed('fillText').map((c) => c[1]);
    assert.deepEqual(texts, ['WM']); // only the watermark remains
  });
  it('draws crosshair lines, dashed or solid', () => {    const dashed = new MockContext2D();
    renderChart(dashed, makeView({ crosshair: { active: true, x: 100, y: 50 } }));
    assert.ok(dashed.callsNamed('setLineDash').some((c) => JSON.stringify(c[1]) === '[4,4]'));

    const solid = new MockContext2D();
    renderChart(solid, makeView({
      config: { crosshair: { dashed: false } },
      crosshair: { active: true, x: 100, y: 50 },
    }));
    assert.ok(!solid.callsNamed('setLineDash').some((c) => JSON.stringify(c[1]) === '[4,4]'));

    const hidden = new MockContext2D();
    renderChart(hidden, makeView({ config: { crosshair: { visible: false } }, crosshair: { active: true, x: 1, y: 1 } }));
    assert.equal(hidden.countCalls('setLineDash'), 0);
  });
  it('draws crosshair price/time label boxes in the mono font', () => {
    const ctx = new MockContext2D();
    const view = makeView({
      config: { theme: { monoFamily: '"Test Mono", monospace', fontSize: 13 } },
      crosshair: { active: true, x: 100, y: 50 },
    });
    renderChart(ctx, view);
    // Fonts emitted include the configured mono family and size.
    assert.ok(ctx.callsNamed('set:font').some((c) => c[1] === '13px "Test Mono", monospace'));
    const mainScale = view.panes[0]?.priceScale;
    assert.ok(mainScale !== undefined);
    const priceLabel = view.config.formatters.price(mainScale.yToPrice(50));
    const labels = ctx.callsNamed('fillText').map((c) => c[1]);
    assert.ok(labels.includes(priceLabel), 'price label drawn');
    // Time label for the snapped candle index (clamped into the dataset).
    const idx = Math.min(
      view.candles.length - 1,
      Math.max(0, view.timeScale.xToIndex(100, view.candles.length)),
    );
    const timeLabel = view.config.formatters.time(view.candles[idx]?.time ?? 0);
    assert.ok(labels.includes(timeLabel), 'time label drawn');
    // Label boxes paint with the configured background.
    assert.ok(ctx.countCalls('measureText') >= 2);
  });
  it('skips crosshair labels when axes are hidden, panes are empty, or data is empty', () => {
    const noPriceAxis = new MockContext2D();
    const v1 = makeView({ config: { priceAxis: { visible: false } }, crosshair: { active: true, x: 10, y: 10 } });
    renderChart(noPriceAxis, v1);
    const priceLabel = v1.config.formatters.price(v1.panes[0]?.priceScale.yToPrice(10) ?? 0);
    assert.ok(!noPriceAxis.callsNamed('fillText').some((c) => c[1] === priceLabel));

    const noPanes = new MockContext2D();
    renderChart(noPanes, makeView({ noPanes: true, crosshair: { active: true, x: 10, y: 10 } }));
    assert.ok(noPanes.calls.length > 0);

    const noTimeAxis = new MockContext2D();
    renderChart(noTimeAxis, makeView({ config: { timeAxis: { visible: false } }, crosshair: { active: true, x: 10, y: 10 } }));
    assert.ok(noTimeAxis.countCalls('stroke') > 0);

    const empty = new MockContext2D();
    const v4 = makeView({ crosshair: { active: true, x: 10, y: 10 } });
    renderChart(empty, { ...v4, candles: [], range: { from: 0, to: 0 } });
    assert.ok(empty.countCalls('fillRect') >= 1);
  });
  it('draws drawing primitives: lines, rects, text', () => {
    const ctx = new MockContext2D();
    renderChart(ctx, makeView({
      drawings: [
        {
          color: '#123456',
          lineWidth: 2,
          primitives: [
            { type: 'line', x1: 0, y1: 0, x2: 10, y2: 10 },
            { type: 'rect', x: 5, y: 5, w: 20, h: 10 },
            { type: 'text', text: '0.618', x: 30, y: 30 },
          ],
        },
      ],
    }));
    assert.ok(ctx.countCalls('rect') >= 1);
    assert.ok(ctx.callsNamed('fillText').some((c) => c[1] === '0.618'));
  });
  it('tolerates an empty pane list and empty data', () => {
    const ctx = new MockContext2D();
    const view = makeView({ noPanes: true });
    renderChart(ctx, { ...view, candles: [], range: { from: 0, to: 0 } });
    assert.ok(ctx.countCalls('fillRect') >= 1); // background still paints
  });
  it('scales the 2D context by the pixel ratio around all layers', () => {
    const ctx = new MockContext2D();
    const view = makeView({});
    renderChart(ctx, { ...view, pixelRatio: 2 });
    assert.deepEqual(ctx.calls[0], ['save']);
    assert.deepEqual(ctx.calls[1], ['scale', 2, 2]);
    assert.deepEqual(ctx.calls[ctx.calls.length - 1], ['restore']);
    // Background fills CSS-pixel dims (the scale maps them to the backing store).
    assert.deepEqual(ctx.callsNamed('fillRect')[0], ['fillRect', 0, 0, 800, 500]);
  });
  it('renders each built-in series type through the registry', () => {
    for (const type of ['candlestick', 'line', 'area', 'bar', 'histogram'] as const) {
      const ctx = new MockContext2D();
      renderChart(ctx, makeView({ config: { series: { type } } }));
      assert.ok(ctx.calls.length > 20, type);
    }
  });
  it('skips NaN segments in indicator lines', () => {
    const gapped: IndicatorOutput = {
      pane: 'main',
      lines: [{ key: 'v', values: [null, 1, 2, NaN, 4, null, 6], color: '#fff' }],
    };
    const ctx = new MockContext2D();
    const view = makeView({ indicators: [gapped] });
    renderChart(ctx, { ...view, range: { from: 0, to: 7 } });
    // pen lifts at null/NaN: moveTo called once per segment (3 segments).
    const moves = ctx.countCalls('moveTo');
    assert.ok(moves >= 3);
  });
});
