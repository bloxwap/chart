import { bench, candles, load } from './harness.mjs';
const { bollIndicator, kdjIndicator } = await load('indicators/index.js');
const { DataStore } = await load('core/data.js');
const data = candles(100_000);
console.log('\nRolling indicators and data (100k candles):');
for (const period of [20, 500]) {
  bench(`BOLL(${period})`, () => bollIndicator.compute(data, { period }, [], null));
  bench(`KDJ(${period})`, () => kdjIndicator.compute(data, { period }, [], null));
}
const store = new DataStore();
bench('setData: already sorted', () => store.setData(data));
