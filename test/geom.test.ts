import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  arrowHead,
  changeText,
  compact,
  decimalsOf,
  duration,
  pctChange,
  pivotLabel,
  resolveView,
  timeAt,
  volumeBetween,
  BUILTIN_DRAWINGS,
} from '../dist/drawings/index.js';
import type { Candle } from '../dist/core/data.js';

const bars: Candle[] = [
  { time: 1000, open: 1, high: 2, low: 0, close: 1 },
  { time: 1060, open: 1, high: 2, low: 0, close: 1, volume: 5 },
  { time: 1120, open: 1, high: 2, low: 0, close: 1, volume: 7 },
];

describe('geometry helpers', () => {
  it('resolveView inverts affine views and falls back for flat ones', () => {
    const v = resolveView({ indexToX: (i) => 5 + i * 10, priceToY: (p) => 200 - p * 2, width: 1, height: 1 });
    assert.equal(v.xToIndex(25), 2);
    assert.equal(v.yToPrice(100), 50);
    assert.equal(v.formatTime(0), '1970-01-01 00:00');
    const flat = resolveView({ indexToX: () => 3, priceToY: () => 3, width: 1, height: 1 });
    assert.equal(flat.xToIndex(99), 0);
    assert.equal(flat.barSpacing, 0);
  });
  it('arrowHead tolerates coincident points', () => {
    const head = arrowHead({ x: 1, y: 1 }, { x: 1, y: 1 }, 8);
    assert.equal(head.type, 'path');
  });
  it('formats percentages, durations and compact numbers', () => {
    assert.equal(pctChange(0, 5), '0.00%');
    assert.equal(pctChange(10, 5), '-50.00%');
    assert.equal(duration(86400 * 3 + 3600 * 4), '3d 4h');
    assert.equal(duration(86400 * 2), '2d');
    assert.equal(duration(3600 * 5 + 60 * 7), '5h 7m');
    assert.equal(duration(3600 * 5), '5h');
    assert.equal(duration(-120), '2m');
    assert.equal(compact(2.5e9), '2.50B');
    assert.equal(compact(3.25e6), '3.25M');
    assert.equal(compact(4500), '4.5K');
    assert.equal(compact(12.4), '12');
  });
  it('formats deltas at the reference price precision', () => {
    const v = resolveView({ indexToX: (i) => i, priceToY: (p) => p, width: 1, height: 1, formatPrice: (p) => p.toFixed(2) });
    assert.equal(changeText(v, 117.41, 118.09), '+0.68 (+0.58%)');
    assert.equal(changeText(v, 117.41, 117.0), '-0.41 (-0.35%)');
    assert.equal(decimalsOf('42'), 0);
    assert.equal(decimalsOf('1.2345'), 4);
  });
  it('timeAt reads, extrapolates both ways, and handles tiny datasets', () => {
    assert.equal(timeAt([], 1), null);
    assert.equal(timeAt(bars, 1), 1060);
    assert.equal(timeAt(bars, -2), 880);
    assert.equal(timeAt(bars, 4), 1240);
    assert.equal(timeAt(bars.slice(0, 1), 9), 1000);
  });
  it('volumeBetween clamps, orders and treats missing volume as zero', () => {
    assert.equal(volumeBetween(bars, 5, -3), 12);
  });
  it('pivotLabel handles a lone point', () => {
    const t = pivotLabel([{ x: 1, y: 1 }], 0, 'X');
    assert.ok(t.type === 'text' && t.baseline === 'bottom');
  });
  it('arrow-like shapes tolerate zero-length input', () => {
    for (const name of ['arrow-marker', 'rotated-rect']) {
      const def = BUILTIN_DRAWINGS.find((d) => d.name === name)!;
      const same = [{ index: 1, price: 1 }, { index: 1, price: 1 }, { index: 1, price: 1 }];
      assert.ok(def.geometry(same, { indexToX: (i) => i, priceToY: (p) => p, width: 10, height: 10 }).length > 0);
    }
  });
});

const id = { indexToX: (i: number) => i * 10, priceToY: (p: number) => 100 - p, width: 500, height: 300 };
const tool = (name: string) => BUILTIN_DRAWINGS.find((d) => d.name === name)!;

describe('branch edges', () => {
  it('resolveView passes through a supplied inverse', () => {
    assert.equal(resolveView({ ...id, yToPrice: (y) => y * 2 }).yToPrice(3), 6);
  });
  it('parallel channel handles a vertical base line', () => {
    const prims = tool('parallel-channel').geometry([{ index: 5, price: 10 }, { index: 5, price: 50 }, { index: 9, price: 30 }], id);
    assert.ok(prims.length === 4);
  });
  it('sweep wraps both directions', async () => {
    const { sweep } = await import('../dist/drawings/fibonacci.js');
    assert.ok(Math.abs(sweep(0, 4) - (4 - Math.PI * 2)) < 1e-9);
    assert.ok(Math.abs(sweep(0, -4) - (Math.PI * 2 - 4)) < 1e-9);
    assert.equal(sweep(1, 1.5), 0.5);
  });
  it('fib wedge sweeps from whichever ray comes first', () => {
    const cw = tool('fib-wedge').geometry([{ index: 5, price: 50 }, { index: 15, price: 60 }, { index: 15, price: 40 }], id);
    const ccw = tool('fib-wedge').geometry([{ index: 5, price: 50 }, { index: 15, price: 40 }, { index: 15, price: 60 }], id);
    const s = (p: typeof cw) => p.find((x) => x.type === 'ellipse');
    const a = s(cw);
    const b = s(ccw);
    assert.ok(a?.type === 'ellipse' && b?.type === 'ellipse' && Math.abs(a.start! - b.start!) < 1e-9);
  });
  it('gann square arcs open toward every quadrant', () => {
    const starts = new Set<number>();
    for (const [di, dp] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const prims = tool('gann-square').geometry([{ index: 20, price: 50 }, { index: 20 + di * 5, price: 50 + dp * 20 }], id);
      const arc = prims.find((p) => p.type === 'ellipse');
      assert.ok(arc?.type === 'ellipse');
      starts.add(arc.start!);
    }
    assert.equal(starts.size, 4);
  });
  it('VWAP weights volume-less bars equally; profile handles flat prices', () => {
    const noVol = [
      { time: 1, open: 10, high: 12, low: 8, close: 11 },
      { time: 2, open: 11, high: 13, low: 9, close: 12 },
    ];
    const vwap = tool('anchored-vwap').geometry([{ index: 0, price: 1 }], { ...id, candles: noVol });
    assert.ok(vwap.some((p) => p.type === 'text' && p.text === 'VWAP 10.83'));
    const flat = Array.from({ length: 4 }, (_, i) => ({ time: i, open: 5, high: 5, low: 5, close: 5, volume: 10 }));
    const prof = tool('volume-profile').geometry([{ index: 0, price: 9 }, { index: 3, price: 1 }], { ...id, candles: flat });
    assert.ok(prof.some((p) => p.type === 'text' && p.text.startsWith('POC')));
  });
  it('value area grows downward when the lower row is heavier', () => {
    // Heavy volume low, POC in the middle: the value area must expand below first.
    const skew = [
      { time: 1, open: 10, high: 10.4, low: 10, close: 10.2, volume: 50 },
      { time: 2, open: 12, high: 12.4, low: 12, close: 12.2, volume: 100 },
      { time: 3, open: 11, high: 11.4, low: 11, close: 11.2, volume: 80 },
      { time: 4, open: 20, high: 20.4, low: 20, close: 20.2, volume: 1 },
    ];
    const prims = tool('volume-profile').geometry([{ index: 0, price: 25 }, { index: 3, price: 5 }], { ...id, candles: skew });
    assert.ok(prims.length > 3);
  });
});
