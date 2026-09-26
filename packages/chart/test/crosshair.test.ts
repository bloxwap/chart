import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Crosshair } from '../dist/core/crosshair.js';
import { TimeScale } from '../dist/core/scale.js';

describe('Crosshair', () => {
  it('starts inactive and updates/clears', () => {
    const c = new Crosshair();
    assert.equal(c.active, false);
    c.update(10, 20);
    assert.equal(c.active, true);
    assert.equal(c.x, 10);
    assert.equal(c.y, 20);
    c.clear();
    assert.equal(c.active, false);
  });
  it('snappedIndex returns -1 with no data', () => {
    const c = new Crosshair();
    c.update(50, 50);
    assert.equal(c.snappedIndex(new TimeScale(10, 100), 0), -1);
  });
  it('snappedIndex clamps into the dataset', () => {
    const c = new Crosshair();
    const scale = new TimeScale(10, 100);
    c.update(-500, 0);
    assert.equal(c.snappedIndex(scale, 10), 0);
    c.update(5000, 0);
    assert.equal(c.snappedIndex(scale, 10), 9);
    c.update(scale.indexToX(5, 10), 0);
    assert.equal(c.snappedIndex(scale, 10), 5);
  });
});
