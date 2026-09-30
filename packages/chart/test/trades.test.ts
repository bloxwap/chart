import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FOOTPRINT_BARS,
  createDatafeedChart,
  createTradeAggregation,
  type Candle,
  type DatafeedChartOptions,
  type Trade,
} from '../dist/datafeed/index.js';
import {
  PriceScale,
  TimeScale,
  createChart,
  createTradePrintsPrimitive,
  type PrimitiveDrawTarget,
} from '../dist/index.js';
import { MockCanvas, MockContext2D } from '../dist/dom.js';

const MIN = 60_000;
const T0 = 1_700_000_040_000; // a 1m boundary

const bar = (tMs: number): Candle => ({ time: tMs / 1000, open: 100, high: 101, low: 99, close: 100, volume: 1 });

const trade = (time: number, price: number, size: number, side: Trade['side'] = 'buy'): Trade => ({ time, price, size, side });

async function idle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

function setupFeed(options: Partial<DatafeedChartOptions> & { noSymbol?: boolean } = {}) {
  const { noSymbol = false, ...overrides } = options;
  const errors: unknown[] = [];
  const canvas = new MockCanvas(800, 400);
  const df = createDatafeedChart({
    container: canvas,
    config: { wasm: false },
    fetchBars: async ({ toMs }) => (toMs >= T0 - MIN ? [bar(T0 - MIN), bar(T0)] : []),
    ...(noSymbol ? {} : { symbol: 'BTC', intervalMs: MIN }),
    onError: (error) => errors.push(error),
    ...overrides,
  });
  return { ...df, errors, canvas };
}

describe('trade aggregation', () => {
  it('folds trades into (bar, price) levels of buy and sell size and count', () => {
    const tape = createTradeAggregation({ intervalMs: MIN });
    tape.push(trade(T0 + 1_000, 101, 5));
    tape.push(trade(T0 + 2_000, 100, 2));
    tape.push(trade(T0 + 3_000, 100, 1, 'sell'));
    const bar0 = tape.bar(T0)!;
    assert.equal(bar0.time, T0);
    assert.deepEqual(bar0.levels, [
      { price: 100, buySize: 2, sellSize: 1, buyCount: 1, sellCount: 1 },
      { price: 101, buySize: 5, sellSize: 0, buyCount: 1, sellCount: 0 },
    ]);
    assert.equal(bar0.buySize, 7);
    assert.equal(bar0.sellSize, 1);
    assert.equal(bar0.buyCount, 2);
    assert.equal(bar0.sellCount, 1);
  });

  it('buckets trades into epoch-aligned bars', () => {
    const tape = createTradeAggregation({ intervalMs: MIN });
    tape.push(trade(T0 + MIN - 1, 100, 1));
    tape.push(trade(T0 + MIN, 100, 1));
    assert.equal(tape.size, 2);
    assert.equal(tape.bar(T0 + MIN - 1)!.time, T0);
    assert.equal(tape.bar(T0 + MIN)!.time, T0 + MIN);
  });

  it('returns null for an empty bucket and filters and sorts barsInRange', () => {
    const tape = createTradeAggregation({ intervalMs: MIN });
    tape.push(trade(T0 + 2 * MIN, 100, 1));
    tape.push(trade(T0, 100, 1));
    tape.push(trade(T0 + 4 * MIN, 100, 1));
    assert.equal(tape.bar(T0 + MIN), null);
    assert.deepEqual(
      tape.barsInRange(T0 - MIN, T0 + 3 * MIN).map((b) => b.time),
      [T0, T0 + 2 * MIN],
    );
    assert.deepEqual(tape.barsInRange(T0 + MIN, T0 + 2 * MIN - 1), []);
  });

  it('ignores invalid trades', () => {
    const tape = createTradeAggregation({ intervalMs: MIN });
    tape.push(trade(Number.NaN, 100, 1));
    tape.push(trade(T0, Number.NaN, 1));
    tape.push(trade(T0, 100, Number.NaN));
    tape.push(trade(T0, 100, 0));
    tape.push(trade(T0, 100, -1));
    tape.push(trade(T0, 100, 1, 'hold' as Trade['side']));
    assert.equal(tape.size, 0);
  });

  it('evicts the oldest bar beyond maxBars', () => {
    const tape = createTradeAggregation({ intervalMs: MIN, maxBars: 2 });
    tape.push(trade(T0, 100, 1));
    tape.push(trade(T0 + MIN, 100, 1));
    tape.push(trade(T0 + 2 * MIN, 100, 1));
    assert.equal(tape.size, 2);
    assert.equal(tape.bar(T0), null);
    assert.notEqual(tape.bar(T0 + 2 * MIN), null);
  });

  it('drops a late trade for an already-evicted bucket', () => {
    const tape = createTradeAggregation({ intervalMs: MIN, maxBars: 1 });
    tape.push(trade(T0, 100, 1));
    tape.push(trade(T0 + MIN, 100, 1));
    tape.push(trade(T0, 100, 9));
    assert.equal(tape.size, 1);
    assert.equal(tape.bar(T0), null, 'the late trade does not resurrect the evicted bar');
    assert.equal(tape.bar(T0 + MIN)!.buySize, 1);
  });

  it('throws on invalid options', () => {
    assert.throws(() => createTradeAggregation({ intervalMs: 0 }), /intervalMs/);
    assert.throws(() => createTradeAggregation({ intervalMs: 1.5 }), /intervalMs/);
    assert.throws(() => createTradeAggregation({ intervalMs: MIN, maxBars: 0 }), /maxBars/);
  });

  it('clear() empties the store', () => {
    const tape = createTradeAggregation({ intervalMs: MIN });
    tape.push(trade(T0, 100, 1));
    tape.clear();
    assert.equal(tape.size, 0);
    assert.equal(tape.bar(T0), null);
    assert.ok(MAX_FOOTPRINT_BARS > 0);
  });
});

describe('datafeed trades channel', () => {
  it('delivers pushed trades to subscribeTrades and folds them into the footprint', async () => {
    const t = setupFeed();
    await idle();
    const trades: Trade[] = [];
    t.datafeed.subscribeTrades('BTC', (trade) => trades.push(trade));
    t.datafeed.pushTrade(trade(T0 + 1_000, 100, 2));
    t.datafeed.pushTrade(trade(T0 + 2_000, 101, 3, 'sell'));
    assert.deepEqual(trades, [trade(T0 + 1_000, 100, 2), trade(T0 + 2_000, 101, 3, 'sell')]);
    const bar0 = t.datafeed.footprintBar(T0)!;
    assert.deepEqual(bar0.levels, [
      { price: 100, buySize: 2, sellSize: 0, buyCount: 1, sellCount: 0 },
      { price: 101, buySize: 0, sellSize: 3, buyCount: 0, sellCount: 1 },
    ]);
    assert.deepEqual(t.datafeed.footprintBars(T0 - MIN, T0).map((b) => b.time), [T0]);
    assert.equal(t.datafeed.footprintBar(T0 + MIN), null);
    assert.deepEqual(t.errors, []);
    t.destroy();
  });

  it('ignores trades tagged with another symbol', async () => {
    const t = setupFeed();
    await idle();
    const trades: Trade[] = [];
    t.datafeed.subscribeTrades('BTC', (trade) => trades.push(trade));
    t.datafeed.pushTrade(trade(T0, 100, 1), 'ETH');
    assert.deepEqual(trades, []);
    assert.equal(t.datafeed.footprintBar(T0), null);
    t.destroy();
  });

  it('passes the tape through as received, even a trade the footprint drops', async () => {
    const t = setupFeed();
    await idle();
    const trades: Trade[] = [];
    t.datafeed.subscribeTrades('BTC', (trade) => trades.push(trade));
    t.datafeed.pushTrade(trade(T0, 100, 0));
    assert.deepEqual(trades, [trade(T0, 100, 0)]);
    assert.equal(t.datafeed.footprintBar(T0), null);
    t.destroy();
  });

  it("a trade listener's error goes to onError and pushTrade does not throw", async () => {
    const t = setupFeed();
    await idle();
    const trades: Trade[] = [];
    t.datafeed.subscribeTrades('BTC', () => {
      throw new Error('boom');
    });
    t.datafeed.subscribeTrades('BTC', (trade) => trades.push(trade));
    t.datafeed.pushTrade(trade(T0, 100, 1));
    assert.deepEqual(trades, [trade(T0, 100, 1)], 'a throwing listener does not starve the rest');
    assert.deepEqual(t.errors.length, 1);
    assert.notEqual(t.datafeed.footprintBar(T0), null, 'the trade still folded into the footprint');
    t.destroy();
  });

  it('unsubscribe stops delivery but not the footprint', async () => {
    const t = setupFeed();
    await idle();
    const trades: Trade[] = [];
    const off = t.datafeed.subscribeTrades('BTC', (trade) => trades.push(trade));
    off();
    t.datafeed.pushTrade(trade(T0, 100, 1));
    assert.deepEqual(trades, []);
    assert.notEqual(t.datafeed.footprintBar(T0), null);
    t.destroy();
  });

  it('a symbol switch starts a fresh footprint and silences the old symbol', async () => {
    const t = setupFeed();
    await idle();
    const btc: Trade[] = [];
    const eth: Trade[] = [];
    t.datafeed.subscribeTrades('BTC', (trade) => btc.push(trade));
    t.datafeed.subscribeTrades('ETH', (trade) => eth.push(trade));
    t.datafeed.pushTrade(trade(T0, 100, 1));
    await t.datafeed.setSymbol('ETH', MIN);
    assert.equal(t.datafeed.footprintBar(T0), null, 'the new session has its own footprint');
    t.datafeed.pushTrade(trade(T0, 200, 2), 'BTC');
    t.datafeed.pushTrade(trade(T0, 200, 2));
    assert.deepEqual(btc, [trade(T0, 100, 1)], "the old symbol's listener hears nothing more");
    assert.deepEqual(eth, [trade(T0, 200, 2)]);
    assert.equal(t.datafeed.footprintBar(T0)!.buySize, 2);
    t.destroy();
  });

  it('before the first setSymbol, pushTrade is ignored and footprint queries are empty', () => {
    const t = setupFeed({ noSymbol: true });
    const trades: Trade[] = [];
    t.datafeed.subscribeTrades('BTC', (trade) => trades.push(trade));
    t.datafeed.pushTrade(trade(T0, 100, 1));
    assert.deepEqual(trades, []);
    assert.equal(t.datafeed.footprintBar(T0), null);
    assert.deepEqual(t.datafeed.footprintBars(0, Number.MAX_SAFE_INTEGER), []);
    t.destroy();
  });

  it('destroy stops the trades channel', async () => {
    const t = setupFeed();
    await idle();
    const trades: Trade[] = [];
    t.datafeed.subscribeTrades('BTC', (trade) => trades.push(trade));
    t.datafeed.destroy();
    t.datafeed.pushTrade(trade(T0, 100, 1));
    assert.deepEqual(trades, []);
    assert.equal(t.datafeed.footprintBar(T0), null);
    t.chart.destroy();
  });
});

describe('trade prints primitive', () => {
  const candles = [bar(T0), bar(T0 + MIN), bar(T0 + 2 * MIN)];

  function target(): PrimitiveDrawTarget {
    const timeScale = new TimeScale(10, 800);
    const priceScale = new PriceScale();
    priceScale.height = 400;
    priceScale.setRange(99, 101);
    return { width: 800, height: 400, priceScale, timeScale, range: { from: 0, to: 3 }, candles, pixelRatio: 1 };
  }

  it('paints each retained trade at its bar and price, sized by the square root of its size', () => {
    const prints = createTradePrintsPrimitive();
    prints.push(trade(T0 + 30_000, 100, 25));
    prints.push(trade(T0 + MIN + 30_000, 101, 1, 'sell'));
    const ctx = new MockContext2D();
    prints.draw(ctx, target());
    const ellipses = ctx.callsNamed('ellipse');
    assert.deepEqual(ellipses.length, 2);
    const t0 = target();
    assert.deepEqual(ellipses[0], ['ellipse', t0.timeScale.indexToX(0, 3), t0.priceScale.priceToY(100), 5, 5, 0, 0, Math.PI * 2]);
    assert.deepEqual(ellipses[1], ['ellipse', t0.timeScale.indexToX(1, 3), t0.priceScale.priceToY(101), 2, 2, 0, 0, Math.PI * 2]);
  });

  it('clamps the radius to [minRadius, maxRadius]', () => {
    const prints = createTradePrintsPrimitive();
    prints.push(trade(T0, 100, 10_000));
    prints.push(trade(T0, 100, 0.0001));
    const ctx = new MockContext2D();
    prints.draw(ctx, target());
    const radii = ctx.callsNamed('ellipse').map((c) => c[3]);
    assert.deepEqual(radii, [8, 2]);
  });

  it('skips trades before the first bar and invalid trades, and pins a late trade to the last bar', () => {
    const prints = createTradePrintsPrimitive();
    prints.push(trade(T0 - MIN, 100, 1)); // before the first bar
    prints.push(trade(T0 + 10 * MIN, 100, 1)); // past the last bar: the live-tape case
    prints.push(trade(Number.NaN, 100, 1));
    prints.push(trade(T0, 100, -1));
    assert.equal(prints.size, 2, 'only valid trades are retained');
    const ctx = new MockContext2D();
    prints.draw(ctx, target());
    const ellipses = ctx.callsNamed('ellipse');
    assert.deepEqual(ellipses.length, 1);
    assert.equal(ellipses[0]![1], target().timeScale.indexToX(2, 3), 'the late trade pins to the last bar');
    prints.draw(ctx, { ...target(), range: { from: 0, to: 0 } });
    assert.deepEqual(ctx.callsNamed('ellipse').length, 1, 'an empty range paints nothing more');
  });

  it('ignores a trade with an unknown side', () => {
    const prints = createTradePrintsPrimitive();
    prints.push(trade(T0, 100, 1, 'hold' as Trade['side']));
    assert.equal(prints.size, 0);
    const ctx = new MockContext2D();
    prints.draw(ctx, target());
    assert.deepEqual(ctx.calls, []);
  });

  it('bounds the ring by maxTrades, evicting the oldest', () => {
    const prints = createTradePrintsPrimitive({ maxTrades: 2 });
    prints.push(trade(T0, 99, 1));
    prints.push(trade(T0, 100, 1));
    prints.push(trade(T0, 101, 1));
    assert.equal(prints.size, 2);
    const ctx = new MockContext2D();
    prints.draw(ctx, target());
    const prices = ctx.callsNamed('ellipse').map((c) => target().priceScale.yToPrice(c[2] as number));
    assert.deepEqual(prices, [100, 101]);
  });

  it('clear() drops every retained trade', () => {
    const prints = createTradePrintsPrimitive();
    prints.push(trade(T0, 100, 1));
    prints.clear();
    assert.equal(prints.size, 0);
    const ctx = new MockContext2D();
    prints.draw(ctx, target());
    assert.deepEqual(ctx.calls, []);
  });

  it('throws on invalid options', () => {
    assert.throws(() => createTradePrintsPrimitive({ maxTrades: 0 }), /maxTrades/);
    assert.throws(() => createTradePrintsPrimitive({ minRadius: -1 }), /minRadius/);
    assert.throws(() => createTradePrintsPrimitive({ minRadius: 5, maxRadius: 4 }), /minRadius/);
  });

  it('draws through the chart on attachPrimitive and requestUpdate', () => {
    const canvas = new MockCanvas(800, 400);
    const chart = createChart({ container: canvas, config: { wasm: false, data: candles } });
    const prints = createTradePrintsPrimitive();
    const handle = chart.attachPrimitive(prints);
    const before = canvas.context.countCalls('ellipse');
    prints.push(trade(T0 + 30_000, 100, 4));
    prints.push(trade(T0 + MIN + 30_000, 100.5, 4, 'sell'));
    handle.requestUpdate();
    assert.equal(canvas.context.countCalls('ellipse') - before, 2, 'one print per retained trade');
    handle.detach();
    const after = canvas.context.countCalls('ellipse');
    handle.requestUpdate();
    assert.equal(canvas.context.countCalls('ellipse'), after, 'a detached primitive no longer paints');
    chart.destroy();
  });
});
