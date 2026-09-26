import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutPanes } from '../dist/core/pane.js';

describe('layoutPanes', () => {
  it('returns empty for no specs or no height', () => {
    assert.deepEqual(layoutPanes([], 100), []);
    assert.deepEqual(layoutPanes([{ id: 'm', kind: 'main', weight: 3 }], 0), []);
    assert.deepEqual(layoutPanes([{ id: 'm', kind: 'main', weight: 3 }], -10), []);
  });
  it('gives a single pane the full height', () => {
    assert.deepEqual(layoutPanes([{ id: 'm', kind: 'main', weight: 3 }], 300), [
      { id: 'm', kind: 'main', weight: 3, y: 0, height: 300 },
    ]);
  });
  it('splits by weight and gives the remainder to the last pane', () => {
    const panes = layoutPanes(
      [
        { id: 'm', kind: 'main', weight: 3 },
        { id: 'a', kind: 'indicator', weight: 1 },
      ],
      101,
    );
    assert.equal(panes[0]?.y, 0);
    assert.equal(panes[0]?.height, 75);
    assert.equal(panes[1]?.y, 75);
    assert.equal(panes[1]?.height, 26);
    assert.equal((panes[0]?.height ?? 0) + (panes[1]?.height ?? 0), 101);
  });
  it('treats non-positive weights as 1', () => {
    const panes = layoutPanes(
      [
        { id: 'm', kind: 'main', weight: 0 },
        { id: 'a', kind: 'indicator', weight: -2 },
      ],
      100,
    );
    assert.equal(panes[0]?.height, 50);
    assert.equal(panes[1]?.height, 50);
  });
});
