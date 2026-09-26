import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILTIN_DRAWINGS,
  DrawingRegistry,
  createDrawingRegistry,
  fibDrawing,
  FIB_LEVELS,
  hlineDrawing,
  rectDrawing,
  trendlineDrawing,
} from '../dist/drawings/index.js';
import type { DrawingView } from '../dist/drawings/index.js';

// Identity pixel view: index → x * 10, price → y = 100 - price.
const view: DrawingView = {
  indexToX: (i) => i * 10,
  priceToY: (p) => 100 - p,
  width: 500,
  height: 300,
};

describe('drawing registry', () => {
  it('pre-loads the four built-ins', () => {
    const registry = createDrawingRegistry();
    assert.deepEqual(registry.names().sort(), ['fib', 'hline', 'rect', 'trendline']);
    assert.equal(BUILTIN_DRAWINGS.length, 4);
  });
  it('supports empty registries, custom models, unregister', () => {
    const registry = createDrawingRegistry(false);
    assert.equal(registry.has('trendline'), false);
    registry.register(trendlineDrawing).register(hlineDrawing);
    assert.equal(registry.get('hline'), hlineDrawing);
    assert.equal(registry.unregister('hline'), true);
    assert.equal(registry.unregister('hline'), false);
    assert.deepEqual(registry.names(), ['trendline']);
  });
});

describe('trendline', () => {
  it('produces a line between two converted points', () => {
    const prims = trendlineDrawing.geometry(
      [
        { index: 1, price: 10 },
        { index: 5, price: 30 },
      ],
      view,
    );
    assert.deepEqual(prims, [{ type: 'line', x1: 10, y1: 90, x2: 50, y2: 70 }]);
  });
  it('needs two points', () => {
    assert.equal(trendlineDrawing.minPoints, 2);
    assert.deepEqual(trendlineDrawing.geometry([], view), []);
    assert.deepEqual(trendlineDrawing.geometry([{ index: 1, price: 10 }], view), []);
  });
});

describe('hline', () => {
  it('spans the full width at the point price', () => {
    const prims = hlineDrawing.geometry([{ index: 3, price: 25 }], view);
    assert.deepEqual(prims, [{ type: 'line', x1: 0, y1: 75, x2: 500, y2: 75 }]);
  });
  it('needs one point', () => {
    assert.equal(hlineDrawing.minPoints, 1);
    assert.deepEqual(hlineDrawing.geometry([], view), []);
  });
});

describe('rect', () => {
  it('normalizes corners in both directions', () => {
    const prims = rectDrawing.geometry(
      [
        { index: 8, price: 10 },
        { index: 2, price: 40 },
      ],
      view,
    );
    assert.deepEqual(prims, [{ type: 'rect', x: 20, y: 60, w: 60, h: 30 }]);
  });
  it('needs two points', () => {
    assert.equal(rectDrawing.minPoints, 2);
    assert.deepEqual(rectDrawing.geometry([{ index: 1, price: 1 }], view), []);
    assert.deepEqual(rectDrawing.geometry([], view), []);
  });
});

describe('fib retracement', () => {
  it('emits a level line and label per level', () => {
    const prims = fibDrawing.geometry(
      [
        { index: 2, price: 100 }, // y = 0
        { index: 6, price: 0 }, // y = 100
      ],
      view,
    );
    assert.equal(prims.length, FIB_LEVELS.length * 2);
    const lines = prims.filter((p) => p.type === 'line');
    const texts = prims.filter((p) => p.type === 'text');
    assert.equal(lines.length, FIB_LEVELS.length);
    assert.equal(texts.length, FIB_LEVELS.length);
    // Level 0 sits at the first point's y; level 1 at the second's.
    assert.deepEqual(lines[0], { type: 'line', x1: 20, y1: 0, x2: 60, y2: 0 });
    assert.deepEqual(lines[FIB_LEVELS.length - 1], { type: 'line', x1: 20, y1: 100, x2: 60, y2: 100 });
    // 0.5 level is the midpoint, label right of the box.
    assert.deepEqual(lines[3], { type: 'line', x1: 20, y1: 50, x2: 60, y2: 50 });
    assert.deepEqual(texts[3], { type: 'text', text: '0.500', x: 64, y: 50 });
  });
  it('handles reversed anchors', () => {
    const prims = fibDrawing.geometry(
      [
        { index: 6, price: 0 },
        { index: 2, price: 100 },
      ],
      view,
    );
    const first = prims[0];
    assert.ok(first?.type === 'line' && first.x1 === 20 && first.x2 === 60);
  });
  it('needs two points', () => {
    assert.equal(fibDrawing.minPoints, 2);
    assert.deepEqual(fibDrawing.geometry([{ index: 1, price: 1 }], view), []);
    assert.deepEqual(fibDrawing.geometry([], view), []);
  });
});
