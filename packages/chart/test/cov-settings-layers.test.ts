import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockContext2D } from '../dist/dom.js';
import { PriceScale, TimeScale } from '../dist/core/scale.js';
import { resolveConfig, type ChartConfig } from '../dist/config.js';
import type { Candle } from '../dist/core/data.js';
import type { RenderView } from '../dist/render/renderer.js';
import { drawPriceReferences, drawStatusLine } from '../dist/render/settings-layers.js';
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
  data?: Candle[];
  liveCandle?: Candle;
  indicators?: IndicatorOutput[];
  crosshair?: { active: boolean; x: number; y: number };
  noPanes?: boolean;
} = {}): RenderView {
  const data = overrides.data ?? candles;
  const config: ChartConfig = resolveConfig({ data, width: 800, height: 500, ...overrides.config });
  const timeScale = new TimeScale(10, 800 - config.priceAxis.width);
  const range = timeScale.visibleRange(data.length);
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
          indicators: [],
        },
      ];
  return {
    canvasWidth: 800,
    canvasHeight: 500,
    plotWidth: 800 - config.priceAxis.width,
    plotHeight: 500 - config.timeAxis.height,
    pixelRatio: 1,
    candles: data,
    range,
    timeScale,
    panes,
    config,
    drawings: [],
    crosshair: overrides.crosshair ?? { active: false, x: 0, y: 0 },
    ...(overrides.liveCandle ? { liveCandle: overrides.liveCandle } : {}),
  };
}

const textsOf = (ctx: MockContext2D): unknown[] => ctx.callsNamed('fillText').map((c) => c[1]);

describe('drawPriceReferences coverage', () => {
  it('returns early without a pane or without candles', () => {
    const noPanes = new MockContext2D();
    drawPriceReferences(noPanes, makeView({ noPanes: true }));
    assert.equal(noPanes.calls.length, 0);

    const empty = new MockContext2D();
    const view = makeView({});
    drawPriceReferences(empty, { ...view, candles: [], range: { from: 0, to: 0 } });
    assert.equal(empty.calls.length, 0);
  });

  it('draws last-price, previous-close and high/low lines with labels', () => {
    const ctx = new MockContext2D();
    const view = makeView({
      config: {
        priceAxis: {
          labels: { lastPrice: true, highLow: true },
          lines: { lastPrice: true, previousClose: true, highLow: true },
        },
      },
    });
    drawPriceReferences(ctx, view);
    const texts = textsOf(ctx).map(String);
    assert.ok(texts.some((t) => t.startsWith('H ')));
    assert.ok(texts.some((t) => t.startsWith('L ')));
    assert.ok(texts.includes(view.panes[0]!.priceScale.format(120, view.config.formatters.price, null)));
    assert.ok(ctx.countCalls('stroke') >= 4); // last price + previous close + high + low
  });

  it('draws high/low labels without lines on a left-positioned axis', () => {
    const ctx = new MockContext2D();
    const view = makeView({
      config: {
        priceAxis: { position: 'left', labels: { highLow: true }, lines: { highLow: false } },
      },
    });
    drawPriceReferences(ctx, view);
    const texts = textsOf(ctx).map(String);
    assert.ok(texts.some((t) => t.startsWith('H ')) && texts.some((t) => t.startsWith('L ')));
    // Labels are boxes on the left edge; no reference lines are stroked.
    assert.ok(ctx.callsNamed('fillRect').some((c) => c[1] === -(800 - view.plotWidth)));
    assert.equal(ctx.countCalls('stroke'), 0);
  });

  it('suppresses labels when the axis is hidden but still strokes lines', () => {
    const ctx = new MockContext2D();
    drawPriceReferences(ctx, makeView({
      config: { priceAxis: { visible: false, labels: { lastPrice: true }, lines: { lastPrice: true } } },
    }));
    assert.equal(ctx.countCalls('fillText'), 0);
    assert.equal(ctx.countCalls('fillRect'), 0);
    assert.equal(ctx.countCalls('stroke'), 1);
  });

  it('tolerates a single candle when previous close is enabled', () => {
    const ctx = new MockContext2D();
    drawPriceReferences(ctx, makeView({
      data: candles.slice(0, 1),
      config: { priceAxis: { lines: { previousClose: true, lastPrice: true } } },
    }));
    assert.equal(ctx.countCalls('stroke'), 1); // only the last-price line
  });

  it('labels indicator values, skipping nulls and off-screen or non-finite entries', () => {
    const values = (last: number | null): (number | null)[] => [...candles.map(() => null).slice(0, -1), last];
    const output: IndicatorOutput = {
      pane: 'main',
      lines: [
        { key: 'in', values: values(105), color: '#123456' },
        { key: 'nil', values: values(null), color: '#ffffff' },
        { key: 'high', values: values(100000), color: '#00ff00' },
        { key: 'low', values: values(-100000), color: '#ff0000' },
        { key: 'nan', values: values(NaN), color: '#0000ff' },
      ],
    };
    const ctx = new MockContext2D();
    const view = makeView({ config: { priceAxis: { labels: { indicator: true } } }, indicators: [output] });
    drawPriceReferences(ctx, view);
    const texts = textsOf(ctx).map(String);
    assert.deepEqual(texts, [view.panes[0]!.priceScale.format(105, view.config.formatters.price, null)]);
  });

  it('uses the live candle for the last-price color and value', () => {
    const ctx = new MockContext2D();
    const liveCandle: Candle = { time: candles[19]!.time + 3600, open: 120, high: 121, low: 99, close: 100 };
    const view = makeView({ liveCandle, config: { priceAxis: { labels: { lastPrice: true } } } });
    drawPriceReferences(ctx, view);
    assert.ok(textsOf(ctx).map(String).includes(view.panes[0]!.priceScale.format(100, view.config.formatters.price, null)));
  });
});

describe('drawStatusLine coverage', () => {
  it('returns early when hidden or when there are no candles', () => {
    const hidden = new MockContext2D();
    drawStatusLine(hidden, makeView({}));
    assert.equal(hidden.calls.length, 0);

    const empty = new MockContext2D();
    const view = makeView({ config: { statusLine: { visible: true } } });
    drawStatusLine(empty, { ...view, candles: [], range: { from: 0, to: 0 } });
    assert.equal(empty.calls.length, 0);
  });

  it('renders symbol, OHLC, change and volume for the latest bar', () => {
    const ctx = new MockContext2D();
    drawStatusLine(ctx, makeView({
      config: { statusLine: { visible: true, symbol: 'TEST', volume: true }, priceAxis: { precision: 3 } },
    }));
    const texts = textsOf(ctx).map(String);
    assert.ok(texts.includes('TEST'));
    assert.ok(texts.includes('O 119.000') && texts.includes('H 121.000') && texts.includes('L 118.000') && texts.includes('C 120.000'));
    assert.ok(texts.includes('+1.000 (+0.84%)'));
    assert.ok(texts.includes('Volume 1190'));
  });

  it('follows the crosshair to a hovered bar instead of the latest', () => {
    const view = makeView({ config: { statusLine: { visible: true } } });
    const x = view.timeScale.indexToX(5, candles.length);
    const ctx = new MockContext2D();
    drawStatusLine(ctx, { ...view, crosshair: { active: true, x, y: 50 } });
    const fmt = view.config.formatters.price;
    const texts = textsOf(ctx).map(String);
    assert.ok(texts.includes(`C ${fmt(106)}`));
    assert.ok(!texts.includes(`C ${fmt(120)}`));
  });

  it('prefers the live candle on the last bar and renders downward moves', () => {
    const liveCandle: Candle = { time: candles[19]!.time + 3600, open: 120, high: 121, low: 99, close: 100, volume: 5 };
    const ctx = new MockContext2D();
    const view = makeView({ liveCandle, config: { statusLine: { visible: true, volume: true } } });
    drawStatusLine(ctx, view);
    const fmt = view.config.formatters.price;
    const texts = textsOf(ctx).map(String);
    assert.ok(texts.includes(`C ${fmt(100)}`));
    const change = texts.find((t) => t.includes('('));
    assert.ok(change !== undefined && change.startsWith('-') && change.includes('-15.97%'));
    assert.ok(texts.includes('Volume 5'));
  });

  it('handles a zero change base, hidden segments and a missing volume', () => {
    const ctx = new MockContext2D();
    drawStatusLine(ctx, makeView({
      data: [{ time: 1, open: 0, high: 1, low: 0, close: 0.5 }],
      config: { statusLine: { visible: true, symbolVisible: false, ohlc: false, change: true, volume: true, indicators: false } },
    }));
    const texts = textsOf(ctx).map(String);
    assert.equal(texts.some((t) => t.startsWith('O ')), false);
    assert.ok(texts.some((t) => t.includes('(—)')));
    assert.ok(texts.includes('Volume 0'));
  });

  it('clips to the plot height when there are no panes', () => {
    const ctx = new MockContext2D();
    const view = makeView({ noPanes: true, config: { statusLine: { visible: true, symbol: 'TEST' } } });
    drawStatusLine(ctx, view);
    assert.ok(textsOf(ctx).map(String).includes('TEST'));
    assert.ok(ctx.callsNamed('rect').some((c) => c[4] === view.plotHeight));
  });

  it('renders indicator values in the status area, skipping nulls', () => {
    const output: IndicatorOutput = {
      pane: 'main',
      lines: [
        { key: 'sma', values: [...candles.map(() => null).slice(0, -1), 105], color: '#123456' },
        { key: 'gap', values: candles.map(() => null), color: '#ffffff' },
      ],
    };
    const ctx = new MockContext2D();
    const view = makeView({ config: { statusLine: { visible: true } }, indicators: [output] });
    drawStatusLine(ctx, view);
    const texts = textsOf(ctx).map(String);
    assert.ok(texts.includes(`SMA  ${view.config.formatters.price(105)}`));
    assert.equal(texts.some((t) => t.startsWith('GAP')), false);
  });
});
