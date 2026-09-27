import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart, MockCanvas, type Candle } from '../dist/index.js';
import { attachDatafeed } from '../dist/datafeed/index.js';

const T0 = 1_700_000_000;
const MIN = 60;
const bar = (i: number, close = 100 + i): Candle => ({ time: T0 + i * MIN, open: close - 1, high: close + 1, low: close - 2, close, volume: 10 + i });
const bars = (from: number, to: number): Candle[] => Array.from({ length: to - from }, (_, k) => bar(from + k));
const times = (data: readonly Candle[]) => data.map((c) => (c.time - T0) / MIN);

function setup(data: Candle[] = []) {
  return createChart({ container: new MockCanvas(600, 300), config: { wasm: false, data } });
}

describe('Chart.getData', () => {
  it('returns the initial data sorted oldest first, and an empty list without data', () => {
    assert.deepEqual(setup().getData(), []);
    const chart = setup([bar(2), bar(0), bar(1)]);
    assert.deepEqual(times(chart.getData()), [0, 1, 2]);
    assert.equal(chart.getData().length, chart.dataLength);
  });

  it('follows setData, appendData (new bar and in-place update) and prependData', () => {
    const chart = setup(bars(0, 3));
    chart.setData(bars(10, 13));
    assert.deepEqual(times(chart.getData()), [10, 11, 12]);
    chart.appendData(bar(13));
    assert.deepEqual(times(chart.getData()), [10, 11, 12, 13]);
    chart.appendData(bar(13, 500));
    assert.equal(chart.getData().length, 4);
    assert.equal(chart.getData()[3]!.close, 500);
    assert.equal(chart.prependData(bars(7, 11)), 3); // 10 is already loaded
    assert.deepEqual(times(chart.getData()), [7, 8, 9, 10, 11, 12, 13]);
    chart.updateConfig({ data: [bar(1)] });
    assert.deepEqual(times(chart.getData()), [1]);
  });

  it('is not a copy, and holds what a paging datafeed loaded without duplicate or missing buckets', async () => {
    const chart = setup();
    assert.equal(chart.getData(), chart.getData());
    const history = bars(-3000, 1);
    const datafeed = attachDatafeed(chart, {
      fetchBars: async ({ fromMs, toMs }) => history.filter((c) => c.time * 1000 >= fromMs && c.time * 1000 <= toMs),
      now: () => (T0 + 30) * 1000,
      initialBars: 200,
      pageBars: 700,
      lazyLoadThreshold: 0,
    });
    await datafeed.setSymbol('X', MIN * 1000);
    assert.deepEqual(times(chart.getData()).slice(-2), [-1, 0]);
    while (!datafeed.exhausted) await datafeed.loadMore();
    const data = chart.getData();
    assert.equal(data.length, 3001);
    for (let i = 1; i < data.length; i++) assert.equal(data[i]!.time - data[i - 1]!.time, MIN);
    datafeed.destroy();
    chart.destroy();
    assert.deepEqual(chart.getData(), []);
  });
});
