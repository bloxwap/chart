import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { drawTimeAxis, timeTickIndices } from '../dist/render/axis.js';
import { MockContext2D } from '../dist/dom.js';
import { TimeScale } from '../dist/core/scale.js';
import type { Candle } from '../dist/core/data.js';

describe('timeTickIndices', () => {
  it('returns empty for empty ranges or non-positive count', () => {
    assert.deepEqual(timeTickIndices({ from: 0, to: 0 }, 5), []);
    assert.deepEqual(timeTickIndices({ from: 0, to: 10 }, 0), []);
  });
  it('spaces indices evenly including the first', () => {
    const idx = timeTickIndices({ from: 0, to: 100 }, 10);
    assert.equal(idx[0], 0);
    assert.ok(idx.length >= 10);
    assert.ok(idx.every((i) => i >= 0 && i < 100));
  });
  it('handles small ranges', () => {
    assert.deepEqual(timeTickIndices({ from: 2, to: 4 }, 5), [2, 3]);
  });
});

describe('drawTimeAxis', () => {
  const candles: Candle[] = [0, 1, 2].map((t) => ({ time: t * 3600, open: 1, high: 1, low: 1, close: 1 }));
  it('draws formatted labels at tick positions with the given mono font', () => {
    const ctx = new MockContext2D();
    const ts = new TimeScale(10, 300);
    drawTimeAxis(ctx, candles, [0, 2], ts, 200, (t) => `T${t}`, '#111111', '12px "Test Mono"');
    const texts = ctx.callsNamed('fillText');
    assert.equal(texts.length, 2);
    assert.equal(texts[0]?.[1], 'T0');
    assert.equal(texts[1]?.[1], 'T7200');
    assert.equal(ctx.font, '12px "Test Mono"');
    assert.equal(ctx.fillStyle, '#111111');
  });
  it('skips indices without candles', () => {
    const ctx = new MockContext2D();
    drawTimeAxis(ctx, candles, [0, 99], new TimeScale(10, 300), 200, (t) => `${t}`, '#000', '12px monospace');
    assert.equal(ctx.countCalls('fillText'), 1);
  });
});
