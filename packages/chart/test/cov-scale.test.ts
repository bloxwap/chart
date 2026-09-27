import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PriceScale } from '../dist/core/scale.js';

describe('PriceScale coverage gaps', () => {
  it('yToPrice falls back to the midpoint when the usable height is zero', () => {
    const s = new PriceScale();
    // height defaults to 0, so the usable band is empty.
    assert.equal(s.yToPrice(37), 0.5);
    s.setRange(10, 20);
    assert.equal(s.yToPrice(999), 15);
    s.inverted = true;
    assert.equal(s.yToPrice(999), 15);
  });
});
