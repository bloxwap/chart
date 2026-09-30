import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FOOTPRINT_LOD,
  FOOTPRINT_SERIES_TYPE,
  PriceScale,
  TimeScale,
  barDelta,
  candleDelta,
  candleDeltas,
  createChart,
  createCvdIndicator,
  createDeltaIndicator,
  createFootprintSeries,
  cvdValues,
  footprintBands,
  footprintLod,
  formatFootprintSize,
  type Candle,
  type FootprintBarLike,
  type FootprintLevelLike,
} from '../dist/index.js';
import { DEFAULT_CONFIG, type SeriesConfig } from '../dist/config.js';
import { MockContext2D, MockDocument } from '../dist/dom.js';
import {
  createDatafeedChart,
  createTradeAggregation,
  datafeedFootprintSource,
  type DatafeedChartOptions,
  type Trade,
} from '../dist/datafeed/index.js';

const MIN = 60_000;
const T0 = 1_700_000_040_000; // a 1m boundary

const candle = (tMs: number): Candle => ({ time: tMs / 1000, open: 100, high: 103, low: 99, close: 101, volume: 1 });
const trade = (time: number, price: number, size: number, side: Trade['side'] = 'buy'): Trade => ({ time, price, size, side });

/** A tape with one bar at T0: 2×1 at 100, 5×0 at 101, 0×3 at 102 (buy×sell). */
function makeTape(): ReturnType<typeof createTradeAggregation> {
  const tape = createTradeAggregation({ intervalMs: MIN });
  tape.push(trade(T0 + 1_000, 101, 5));
  tape.push(trade(T0 + 2_000, 100, 2));
  tape.push(trade(T0 + 3_000, 100, 1, 'sell'));
  tape.push(trade(T0 + 4_000, 102, 3, 'sell'));
  return tape;
}

function makeScales(barSpacing: number, min: number, max: number, height = 300): { ts: TimeScale; ps: PriceScale } {
  const ts = new TimeScale(barSpacing, 600);
  const ps = new PriceScale();
  ps.height = height;
  ps.topMargin = 0;
  ps.bottomMargin = 0;
  ps.setRange(min, max);
  return { ts, ps };
}

function cfg(partial: Partial<SeriesConfig> = {}): SeriesConfig {
  return { ...DEFAULT_CONFIG.series, ...partial };
}

async function idle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('footprintBands', () => {
  it('prices each level band by midpoints, extending edge levels half a step', () => {
    const levels: FootprintLevelLike[] = [
      { price: 100, buySize: 2, sellSize: 1 },
      { price: 101, buySize: 5, sellSize: 0 },
      { price: 103, buySize: 0, sellSize: 3 },
    ];
    assert.deepEqual(footprintBands(levels), [
      { price: 100, low: 99.5, high: 100.5 },
      { price: 101, low: 100.5, high: 102 },
      { price: 103, low: 102, high: 104 },
    ]);
  });

  it('falls back to a unit step for a single level and drops non-finite prices', () => {
    assert.deepEqual(footprintBands([{ price: 50, buySize: 1, sellSize: 0 }]), [{ price: 50, low: 49.5, high: 50.5 }]);
    assert.deepEqual(footprintBands([{ price: NaN, buySize: 1, sellSize: 0 }, { price: 50, buySize: 1, sellSize: 0 }]), [
      { price: 50, low: 49.5, high: 50.5 },
    ]);
  });
});

describe('footprintLod', () => {
  it('picks text only for bid-ask display with cells that fit the label', () => {
    assert.equal(footprintLod(60, 14, 'bid-ask'), 'text');
    assert.equal(footprintLod(60, 14, 'delta'), 'bars');
    assert.equal(footprintLod(60, 14, 'profile'), 'bars');
  });

  it('collapses to bars below the text thresholds and to delta coloring below the bar threshold', () => {
    assert.equal(footprintLod(DEFAULT_FOOTPRINT_LOD.textBarWidth - 1, 14, 'bid-ask'), 'bars');
    assert.equal(footprintLod(60, DEFAULT_FOOTPRINT_LOD.textCellHeight - 1, 'bid-ask'), 'bars');
    assert.equal(footprintLod(60, DEFAULT_FOOTPRINT_LOD.barCellHeight - 1, 'bid-ask'), 'delta');
    assert.equal(footprintLod(60, DEFAULT_FOOTPRINT_LOD.barCellHeight - 1, 'delta'), 'delta');
  });

  it('honors threshold overrides', () => {
    assert.equal(footprintLod(20, 14, 'bid-ask', { ...DEFAULT_FOOTPRINT_LOD, textBarWidth: 20 }), 'text');
  });
});

describe('delta math', () => {
  it('computes per-bar and per-candle deltas, counting bars without trades as 0', () => {
    const tape = makeTape();
    assert.equal(barDelta(tape.bar(T0)!), 3);
    assert.equal(candleDelta(candle(T0), tape), 3);
    assert.equal(candleDelta(candle(T0 + MIN), tape), 0);
    assert.deepEqual(candleDeltas([candle(T0), candle(T0 + MIN), candle(T0 + 2 * MIN)], tape), [3, 0, 0]);
  });
});

describe('formatFootprintSize', () => {
  it('formats zero, fractional, unit, K, and M sizes', () => {
    assert.equal(formatFootprintSize(0), '0');
    assert.equal(formatFootprintSize(0.025), '0.0250');
    assert.equal(formatFootprintSize(-0.025), '-0.0250');
    assert.equal(formatFootprintSize(12.4), '12.40');
    assert.equal(formatFootprintSize(1250), '1.25K');
    assert.equal(formatFootprintSize(-2500), '-2.50K');
    assert.equal(formatFootprintSize(3_400_000), '3.40M');
    assert.equal(formatFootprintSize(-2_500_000), '-2.50M');
  });
});

describe('createFootprintSeries', () => {
  it('draws a sell × buy label per level when the cells fit the text', () => {
    const tape = makeTape();
    const draw = createFootprintSeries(tape);
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales(60, 99, 103);
    draw(ctx, [candle(T0)], { from: 0, to: 1 }, ts, ps, cfg());
    const texts = ctx.callsNamed('fillText').map((c) => c[1]);
    assert.deepEqual(texts, ['1.00×2.00', '0×5.00', '3.00×0']);
    // A faint background rect per level on top of the labels.
    assert.equal(ctx.countCalls('fillRect'), 3);
  });

  it('draws split bid×ask level bars when the text no longer fits', () => {
    const tape = makeTape();
    const draw = createFootprintSeries(tape);
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales(60, 99, 159); // 5px rows: bars LOD
    draw(ctx, [candle(T0)], { from: 0, to: 1 }, ts, ps, cfg());
    assert.equal(ctx.countCalls('fillText'), 0);
    // Level 101 has no sell side: 2 + 1 + 1 bars.
    assert.equal(ctx.countCalls('fillRect'), 4);
  });

  it('collapses to one delta-colored column per bar when rows fall below the bar threshold', () => {
    const tape = makeTape();
    tape.push(trade(T0 + MIN + 500, 100, 4));
    const draw = createFootprintSeries(tape);
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales(60, 99, 399); // 1px rows: delta LOD
    draw(ctx, [candle(T0), candle(T0 + MIN)], { from: 0, to: 2 }, ts, ps, cfg());
    assert.equal(ctx.countCalls('fillText'), 0);
    assert.equal(ctx.countCalls('fillRect'), 2);
  });

  it('draws per-level delta bars in delta display', () => {
    const tape = makeTape();
    const draw = createFootprintSeries(tape, { display: 'delta' });
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales(60, 99, 103);
    draw(ctx, [candle(T0)], { from: 0, to: 1 }, ts, ps, cfg());
    assert.equal(ctx.countCalls('fillText'), 0);
    assert.equal(ctx.countCalls('fillRect'), 3);
  });

  it('skips candles without a footprint bar and no-ops on a null source', () => {
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales(60, 99, 103);
    createFootprintSeries(makeTape())(ctx, [candle(T0 + MIN)], { from: 0, to: 1 }, ts, ps, cfg());
    assert.equal(ctx.calls.length, 0);
    createFootprintSeries(() => null)(ctx, [candle(T0)], { from: 0, to: 1 }, ts, ps, cfg());
    assert.equal(ctx.calls.length, 0);
  });

  it('resolves the source lazily, following a swapped store', () => {
    let store: ReturnType<typeof createTradeAggregation> | null = null;
    const draw = createFootprintSeries(() => store);
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales(60, 99, 103);
    draw(ctx, [candle(T0)], { from: 0, to: 1 }, ts, ps, cfg());
    assert.equal(ctx.countCalls('fillText'), 0);
    store = makeTape();
    draw(ctx, [candle(T0)], { from: 0, to: 1 }, ts, ps, cfg());
    assert.equal(ctx.countCalls('fillText'), 3);
  });

  it('honors upColor, downColor, and textColor overrides', () => {
    const tape = makeTape();
    const draw = createFootprintSeries(tape, { upColor: '#up', downColor: '#dn', textColor: '#tx' });
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales(60, 99, 103);
    draw(ctx, [candle(T0)], { from: 0, to: 1 }, ts, ps, cfg());
    assert.equal(ctx.countCalls('fillText'), 3);
    // The label color is the last fillStyle assigned before each fillText.
    assert.equal(ctx.fillStyle, '#tx');
  });

  it('honors lodThresholds overrides', () => {
    const tape = makeTape();
    const draw = createFootprintSeries(tape, { lodThresholds: { textBarWidth: 100 } });
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales(60, 99, 103); // 60px bars fail the 100px text threshold
    draw(ctx, [candle(T0)], { from: 0, to: 1 }, ts, ps, cfg());
    assert.equal(ctx.countCalls('fillText'), 0);
    assert.equal(ctx.countCalls('fillRect'), 4);
  });

  it('draws full-width volume bars in profile display', () => {
    const tape = createTradeAggregation({ intervalMs: MIN });
    tape.push(trade(T0 + 1_000, 100, 1));
    tape.push(trade(T0 + 2_000, 101, 10, 'sell'));
    const draw = createFootprintSeries(tape, { display: 'profile' });
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales(60, 99, 159); // 5px rows: bars LOD
    draw(ctx, [candle(T0)], { from: 0, to: 1 }, ts, ps, cfg());
    assert.equal(ctx.countCalls('fillText'), 0);
    assert.equal(ctx.countCalls('fillRect'), 2);
  });

  it('colors the collapsed delta column with downColor for a negative bar delta', () => {
    const tape = createTradeAggregation({ intervalMs: MIN });
    tape.push(trade(T0 + 500, 100, 4, 'sell'));
    const draw = createFootprintSeries(tape);
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales(60, 99, 399, 300); // 1px rows: delta LOD
    draw(ctx, [candle(T0)], { from: 0, to: 1 }, ts, ps, cfg({ downColor: '#dn' }));
    assert.equal(ctx.countCalls('fillRect'), 1);
    assert.equal(ctx.fillStyle, '#dn');
  });

  it('draws nothing for a bar whose levels have no traded size', () => {
    const empty: FootprintBarLike = { time: T0, levels: [{ price: 100, buySize: 0, sellSize: 0 }], buySize: 0, sellSize: 0 };
    const draw = createFootprintSeries({ bar: () => empty }, { display: 'delta' });
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales(60, 99, 103);
    draw(ctx, [candle(T0)], { from: 0, to: 1 }, ts, ps, cfg());
    assert.equal(ctx.calls.length, 0);
  });

  it('skips a footprint bar with no levels', () => {
    const levelless: FootprintBarLike = { time: T0, levels: [], buySize: 0, sellSize: 0 };
    const draw = createFootprintSeries({ bar: () => levelless });
    const ctx = new MockContext2D();
    const { ts, ps } = makeScales(60, 99, 103);
    draw(ctx, [candle(T0)], { from: 0, to: 1 }, ts, ps, cfg());
    assert.equal(ctx.calls.length, 0);
  });
});

describe('footprint series on a chart', () => {
  it('renders through Chart.registerSeries and the series.type config', () => {
    const tape = createTradeAggregation({ intervalMs: MIN });
    const data = Array.from({ length: 5 }, (_, i) => candle(T0 + i * MIN));
    for (let i = 0; i < 5; i++) {
      tape.push(trade(T0 + i * MIN + 100, 101, 5));
      tape.push(trade(T0 + i * MIN + 200, 100, 2, 'sell'));
    }
    const document = new MockDocument();
    const chart = createChart({
      document,
      config: { wasm: false, data, width: 640, height: 400, series: { type: FOOTPRINT_SERIES_TYPE } },
    });
    chart.registerSeries(FOOTPRINT_SERIES_TYPE, createFootprintSeries(tape));
    assert.ok(chart.seriesRenderers.has(FOOTPRINT_SERIES_TYPE));
    chart.scale.zoom(20); // 120px bars: text LOD
    const ctx = document.created[0]!.context;
    assert.ok(ctx.countCalls('fillText') > 0);
    chart.destroy();
  });
});

describe('delta indicator', () => {
  it('computes a direction-colored histogram from the footprint source', () => {
    const tape = makeTape();
    tape.push(trade(T0 + MIN + 500, 100, 4, 'sell'));
    const def = createDeltaIndicator(tape);
    assert.equal(def.name, 'delta');
    assert.equal(def.defaultPane, 'sub');
    const candles = [candle(T0), candle(T0 + MIN), candle(T0 + 2 * MIN)];
    const out = def.compute(candles, {}, ['#0f0', '#f00'], null);
    assert.equal(out.pane, 'sub');
    assert.deepEqual(out.bars!.values, [3, -4, 0]);
    assert.deepEqual(out.bars!.up, [true, false, true]);
    assert.equal(out.bars!.upColor, '#0f0');
    assert.equal(out.bars!.downColor, '#f00');
  });

  it('tail-updates from the first changed candle', () => {
    const tape = makeTape();
    const def = createDeltaIndicator(tape);
    const candles = [candle(T0), candle(T0 + MIN)];
    const out = def.compute(candles, {}, [], null);
    tape.push(trade(T0 + MIN + 500, 100, 2));
    const next = def.update!(out, candles, 1, {}, [], null)!;
    assert.deepEqual(next.bars!.values, [3, 2]);
  });

  it('registers and renders as a sub-pane on a chart', () => {
    const tape = makeTape();
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: [candle(T0), candle(T0 + MIN)], width: 640, height: 400 },
    });
    chart.indicators.register(createDeltaIndicator(tape));
    const id = chart.addIndicator({ name: 'delta' });
    assert.ok(chart.getIndicator(id) !== undefined);
    // plotHeight 376, weights 3:1 → main 282, delta sub-pane below it.
    assert.equal(chart.paneAt(300), id);
    chart.destroy();
  });
});

describe('cvd indicator', () => {
  it('accumulates per-candle deltas', () => {
    const tape = makeTape();
    tape.push(trade(T0 + MIN + 500, 100, 4, 'sell'));
    tape.push(trade(T0 + 2 * MIN + 500, 100, 1));
    const candles = [candle(T0), candle(T0 + MIN), candle(T0 + 2 * MIN), candle(T0 + 3 * MIN)];
    assert.deepEqual(cvdValues(candles, tape), [3, -1, 0, 0]);
  });

  it('computes a sub-pane line and continues the running total on tail updates', () => {
    const tape = makeTape();
    const def = createCvdIndicator(tape);
    assert.equal(def.name, 'cvd');
    assert.equal(def.defaultPane, 'sub');
    const candles = [candle(T0), candle(T0 + MIN)];
    const out = def.compute(candles, {}, [], null);
    assert.deepEqual(out.lines[0]!.values, [3, 3]);
    tape.push(trade(T0 + MIN + 500, 100, 2));
    const next = def.update!(out, candles, 1, {}, [], null)!;
    assert.deepEqual(next.lines[0]!.values, [3, 5]);
  });

  it('registers and renders as a sub-pane on a chart', () => {
    const tape = makeTape();
    const chart = createChart({
      document: new MockDocument(),
      config: { wasm: false, data: [candle(T0), candle(T0 + MIN)], width: 640, height: 400 },
    });
    chart.indicators.register(createCvdIndicator(tape));
    const id = chart.addIndicator({ name: 'cvd' });
    assert.equal(chart.paneAt(300), id);
    chart.destroy();
  });
});

describe('datafeedFootprintSource', () => {
  function setupFeed(overrides: Partial<DatafeedChartOptions> = {}) {
    const errors: unknown[] = [];
    const df = createDatafeedChart({
      container: new MockDocument().createCanvas(800, 400),
      config: { wasm: false },
      fetchBars: async ({ toMs }) => (toMs >= T0 - MIN ? [candle(T0 - MIN), candle(T0)] : []),
      symbol: 'BTC',
      intervalMs: MIN,
      onError: (error) => errors.push(error),
      ...overrides,
    });
    return { ...df, errors };
  }

  it('reads the current session’s tape and follows a symbol switch', async () => {
    const { datafeed, destroy } = setupFeed();
    await idle();
    const source = datafeedFootprintSource(datafeed);
    datafeed.pushTrade(trade(T0 + 500, 100, 2));
    datafeed.pushTrade(trade(T0 + 600, 100, 1, 'sell'));
    assert.equal(source.bar(T0)!.buySize, 2);
    assert.equal(source.bar(T0)!.sellSize, 1);
    await datafeed.setSymbol('ETH', MIN);
    assert.equal(source.bar(T0), null);
    destroy();
  });
});
