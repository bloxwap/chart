import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DataStore, type Candle } from '../dist/core/data.js';

function candle(time: number, close = time, volume?: number): Candle {
  return volume === undefined
    ? { time, open: close, high: close + 1, low: close - 1, close }
    : { time, open: close, high: close + 1, low: close - 1, close, volume };
}

describe('DataStore', () => {
  it('starts empty', () => {
    const s = new DataStore();
    assert.equal(s.length, 0);
    assert.equal(s.at(0), undefined);
    assert.equal(s.last(), undefined);
    assert.deepEqual(s.all(), []);
  });
  it('setData sorts defensively and copies', () => {
    const s = new DataStore();
    const input = [candle(3), candle(1), candle(2)];
    s.setData(input);
    assert.deepEqual(s.all().map((c) => c.time), [1, 2, 3]);
    input.push(candle(9));
    assert.equal(s.length, 3);
  });
  it('append inserts in order and out of order', () => {
    const s = new DataStore();
    s.append(candle(5));
    s.append(candle(1));
    s.append(candle(3));
    assert.deepEqual(s.all().map((c) => c.time), [1, 3, 5]);
  });
  it('append replaces an existing time', () => {
    const s = new DataStore();
    s.setData([candle(1), candle(2), candle(3)]);
    s.append(candle(2, 99));
    assert.equal(s.length, 3);
    assert.equal(s.at(1)?.close, 99);
  });
  it('append into empty store', () => {
    const s = new DataStore();
    s.append(candle(7));
    assert.equal(s.at(0)?.time, 7);
  });
  it('clear empties the store', () => {
    const s = new DataStore();
    s.setData([candle(1)]);
    s.clear();
    assert.equal(s.length, 0);
  });
  it('lowerBound finds first index with time >= target', () => {
    const s = new DataStore();
    s.setData([candle(10), candle(20), candle(30)]);
    assert.equal(s.lowerBound(0), 0);
    assert.equal(s.lowerBound(10), 0);
    assert.equal(s.lowerBound(15), 1);
    assert.equal(s.lowerBound(30), 2);
    assert.equal(s.lowerBound(31), 3);
  });
  it('indexOfTime finds exact matches only', () => {
    const s = new DataStore();
    s.setData([candle(10), candle(20)]);
    assert.equal(s.indexOfTime(20), 1);
    assert.equal(s.indexOfTime(15), -1);
  });
  it('closes and volumes extract series (volume defaults to 0)', () => {
    const s = new DataStore();
    s.setData([candle(1, 10, 5), candle(2, 20)]);
    assert.deepEqual(s.closes(), [10, 20]);
    assert.deepEqual(s.volumes(), [5, 0]);
  });
  it('raw shares the internal array while all copies', () => {
    const s = new DataStore();
    s.setData([candle(1)]);
    assert.equal(s.raw()[0]?.time, 1);
    assert.notEqual(s.all(), s.raw());
  });
  it('last returns the newest candle', () => {
    const s = new DataStore();
    s.setData([candle(1), candle(2)]);
    assert.equal(s.last()?.time, 2);
  });
});
