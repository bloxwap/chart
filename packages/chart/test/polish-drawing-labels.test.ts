import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../dist/index.js';
import { MockContext2D, MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import type { DrawingPoint } from '../dist/config.js';
import { drawDrawings, type DrawingPaint } from '../dist/render/drawings.js';
import {
  anchoredVwapDrawing,
  dateRangeDrawing,
  datePriceRangeDrawing,
  fibChannelDrawing,
  fibDrawing,
  fibExtensionDrawing,
  fibSpeedFanDrawing,
  fibTimeDrawing,
  fibTimeZoneDrawing,
  forecastDrawing,
  gannBoxDrawing,
  gannFanDrawing,
  gannSquareDrawing,
  gannSquareFixedDrawing,
  pitchfanDrawing,
  trendAngleDrawing,
  hitTest,
  infoLineDrawing,
  longPositionDrawing,
  priceNoteDrawing,
  priceRangeDrawing,
  projectionDrawing,
  shortPositionDrawing,
  slideInside,
  spansPlot,
  verticalLineDrawing,
  volumeProfileDrawing,
  type DrawingDef,
  type DrawingView,
  type DrawPrimitive,
} from '../dist/drawings/index.js';

// Labels of drawings that reach the plot's right (or left) edge slide back inside it instead of clipping under the
// price axis. MockContext2D measures 6 px per character.

const WIDTH = 400;
const HEIGHT = 300;

const candles: Candle[] = Array.from({ length: 45 }, (_, i) => ({
  time: 1_700_000_000 + i * 3600,
  open: 150 + (i % 5),
  high: 160 + (i % 5),
  low: 140 + (i % 5),
  close: 152 + (i % 5),
  volume: 100 + i,
}));

/** 10 px per bar; price = pixels up from the bottom. */
const view: DrawingView = {
  indexToX: (i) => i * 10,
  priceToY: (p) => HEIGHT - p,
  width: WIDTH,
  height: HEIGHT,
  candles,
  barSpacing: 10,
};

const paint: DrawingPaint = { sansFamily: 'Sans', monoFamily: 'Mono', fontSize: 12, background: '#111', pixelRatio: 1, width: WIDTH };

function render(def: DrawingDef, points: DrawingPoint[], p: DrawingPaint = paint): { ctx: MockContext2D; prims: DrawPrimitive[]; boxes: Box[] } {
  const prims = def.geometry(points, view);
  const ctx = new MockContext2D();
  drawDrawings(ctx, [{ color: '#2962ff', lineWidth: 1, primitives: prims }], p);
  return { ctx, prims, boxes: drawnBoxes(ctx, labels(prims)) };
}

type TextPrimitive = Extract<DrawPrimitive, { type: 'text' }>;

const labels = (prims: DrawPrimitive[]) => prims.filter((p): p is TextPrimitive => p.type === 'text');

interface Box {
  text: string;
  left: number;
  right: number;
}

/**
 * Horizontal extent of each label as drawn, in order: boxed labels from their rounded rect, bare ones from their
 * first line's `fillText` x and the primitive's alignment.
 */
function drawnBoxes(ctx: MockContext2D, texts: TextPrimitive[]): Box[] {
  const out: Box[] = [];
  let arcs: number[] = [];
  let k = 0;
  let line = 0;
  for (const call of ctx.calls) {
    if (call[0] === 'beginPath') arcs = [];
    if (call[0] === 'arcTo') arcs.push(call[1] as number, call[3] as number);
    if (call[0] !== 'fillText') continue;
    const prim = texts[k]!;
    const lines = prim.text.split('\n');
    if (line++ === 0) {
      const w = Math.max(...lines.map((l) => l.length * 6));
      const x = call[2] as number;
      const left = prim.align === 'right' ? x - w : prim.align === 'center' ? x - w / 2 : x;
      out.push(prim.bg !== undefined ? { text: prim.text, left: Math.min(...arcs), right: Math.max(...arcs) } : { text: prim.text, left, right: left + w });
    }
    if (line === lines.length) {
      k++;
      line = 0;
    }
  }
  assert.equal(k, texts.length, 'every label was drawn');
  return out;
}

const inside = (boxes: { left: number; right: number; text: string }[]) => {
  for (const b of boxes) assert.ok(b.left >= 0 && b.right <= WIDTH, `${b.text}: ${b.left}–${b.right} outside 0–${WIDTH}`);
};

describe('slideInside / spansPlot', () => {
  it('slides a box just far enough, pinning an oversized one to the left edge', () => {
    assert.equal(slideInside(10, 50, 400), 10);
    assert.equal(slideInside(380, 50, 400), 350);
    assert.equal(slideInside(-20, 50, 400), 0);
    assert.equal(slideInside(100, 500, 400), 0);
  });

  it('tests a horizontal span in either order against the plot', () => {
    assert.equal(spansPlot(300, 420, 400), true);
    assert.equal(spansPlot(420, 300, 400), true);
    assert.equal(spansPlot(-50, 10, 400), true);
    assert.equal(spansPlot(401, 500, 400), false);
    assert.equal(spansPlot(-80, -1, 400), false);
  });
});

describe('position labels at the price axis', () => {
  for (const [def, target] of [[longPositionDrawing, 200], [shortPositionDrawing, 100]] as const) {
    it(`${def.name}: a box touching the right edge keeps its stop, target, R/R and P&L labels whole`, () => {
      // Entry at x 300, target at x 400 = the plot's right edge.
      const { prims, boxes } = render(def, [{ index: 30, price: 150 }, { index: 40, price: target }]);
      const texts = labels(prims);
      assert.deepEqual(texts.map((t) => t.text.split(' ')[0]), ['Target:', 'Stop:', def.name === 'long-position' ? 'Long' : 'Short', 'P&L']);
      assert.ok(texts.every((t) => t.inside === true));
      assert.equal(boxes.length, 4);
      inside(boxes);
      // The wide stop/target labels (centered on x 350) would have crossed the edge: they now end on it.
      const stop = boxes.find((b) => b.text.startsWith('Stop:'))!;
      assert.equal(stop.right, WIDTH);
      assert.match(stop.text, /^Stop: \d+\.\d+ \([+-]\d+\.\d+%\)$/);
    });
  }

  it('draws labels where placed without a plot width, and lets them leave with a box scrolled out of view', () => {
    const { boxes } = render(longPositionDrawing, [{ index: 30, price: 150 }, { index: 40, price: 200 }], { ...paint, width: undefined } as unknown as DrawingPaint);
    assert.ok(boxes.some((b) => b.right > WIDTH), 'no width: unchanged');

    const gone = render(longPositionDrawing, [{ index: 50, price: 150 }, { index: 60, price: 200 }]);
    assert.ok(labels(gone.prims).every((t) => t.inside === false));
    assert.ok(gone.boxes.every((b) => b.left > WIDTH), 'labels stay with the off-screen box');
  });
});

describe('other edge labels', () => {
  const cases: [string, DrawingDef, DrawingPoint[]][] = [
    ['price range', priceRangeDrawing, [{ index: 38, price: 100 }, { index: 40, price: 200 }]],
    ['date range', dateRangeDrawing, [{ index: 38, price: 100 }, { index: 40, price: 200 }]],
    ['date and price range', datePriceRangeDrawing, [{ index: 38, price: 100 }, { index: 40, price: 200 }]],
    ['forecast', forecastDrawing, [{ index: 30, price: 100 }, { index: 39, price: 200 }]],
    ['projection', projectionDrawing, [{ index: 34, price: 100 }, { index: 37, price: 200 }, { index: 40, price: 150 }]],
    ['anchored VWAP', anchoredVwapDrawing, [{ index: 35, price: 150 }]],
    ['volume profile', volumeProfileDrawing, [{ index: 30, price: 100 }, { index: 40, price: 200 }]],
    ['info line', infoLineDrawing, [{ index: 30, price: 100 }, { index: 39, price: 200 }]],
    ['price note', priceNoteDrawing, [{ index: 30, price: 100 }, { index: 39, price: 200 }]],
    ['fib speed fan', fibSpeedFanDrawing, [{ index: 30, price: 100 }, { index: 39, price: 200 }]],
    ['vertical line time tag', verticalLineDrawing, [{ index: 40, price: 150 }]],
  ];
  for (const [name, def, points] of cases) {
    it(`${name}: labels at the right edge stay inside the plot`, () => {
      const { prims, boxes } = render(def, points);
      assert.ok(labels(prims).length > 0);
      assert.ok(labels(prims).every((t) => t.inside === true), 'on screen, so the labels slide');
      inside(boxes);
      assert.ok(boxes.some((b) => b.right === WIDTH), 'at least one label was slid against the edge');
    });
  }

  it('fib retracement and extension labels (left of the levels) slide in at the left edge', () => {
    for (const [def, points] of [
      [fibDrawing, [{ index: 0.2, price: 100 }, { index: 20, price: 200 }]],
      [fibExtensionDrawing, [{ index: 0, price: 100 }, { index: 5, price: 150 }, { index: 0.2, price: 120 }]],
    ] as const) {
      const { prims, boxes } = render(def, [...points]);
      const texts = labels(prims);
      assert.ok(texts.length >= 7 && texts.every((t) => t.inside === true && t.align === 'right'));
      inside(boxes);
      assert.ok(boxes.every((b) => b.left === 0), 'pinned to the left edge');
    }
    // Scrolled fully off the left edge, they go with the levels.
    const gone = render(fibDrawing, [{ index: -30, price: 100 }, { index: -10, price: 200 }]);
    assert.ok(labels(gone.prims).every((t) => t.inside === false));
    assert.ok(gone.boxes.every((b) => b.right < 0));
  });
});

describe('hit testing slid labels', () => {
  it('hits an inside label where it is drawn once given the plot width', () => {
    const label: DrawPrimitive = { type: 'text', text: 'label', x: 395, y: 50, bg: true, inside: true };
    // Estimated box: 5 × 7.2 + 8 = 44 px wide, from 395 → slid to 356–400.
    assert.equal(hitTest(label, 360, 50, 0), false, 'without the width, where it was placed');
    assert.equal(hitTest(label, 360, 50, 0, WIDTH), true);
    assert.equal(hitTest({ ...label, inside: false }, 360, 50, 0, WIDTH), false, 'labels that may clip do not slide');
  });

  it('chart.drawingAt finds a price range by its label slid in from the price axis', () => {
    const data: Candle[] = Array.from({ length: 300 }, (_, i) => ({ time: 1_700_000_000 + i * 60, open: 100, high: 110, low: 90, close: 105 }));
    const doc = new MockDocument();
    const chart = createChart({ document: doc, config: { wasm: false, data } });
    const { width } = chart.plotArea;
    const { scale } = chart;
    const id = chart.addDrawing({
      name: 'price-range',
      points: [{ index: scale.xToIndex(width - 20), price: scale.yToPrice(260) }, { index: scale.xToIndex(width), price: scale.yToPrice(160) }],
    });
    const geometry = (chart as unknown as { lastGeometry: { id: string; primitives: DrawPrimitive[] }[] }).lastGeometry;
    const prim = labels(geometry.find((g) => g.id === id)!.primitives)[0]!;
    assert.equal(prim.inside, true);
    // The label sits above the box (y 160 − 6), centered on x width − 10: its slid left part is not the box's.
    const size = 12;
    const w = prim.text.length * size * 0.6 + 8;
    const x = width - w + 4;
    const y = 160 - 6 - 10;
    assert.ok(x < width - 10 - w / 2 - 6, 'outside the label as placed');
    assert.equal(chart.drawingAt(x, y), id);
    // Its drawn box ends at the plot's right edge too.
    const ctx = doc.created[0]!.context;
    const arcs = ctx.callsNamed('arcTo').flatMap((c) => [c[1] as number, c[3] as number]);
    assert.ok(arcs.length > 0 && Math.max(...arcs) <= width);
    chart.destroy();
  });
});

describe('fan, channel, Gann and time labels at the plot edges (review)', () => {
  /** Every label whose line or point is on screen slides in, at least one against an edge; the rest stay off screen. */
  function check(def: DrawingDef, points: DrawingPoint[], expectOff = 0): void {
    const { prims, boxes } = render(def, points);
    const texts = labels(prims);
    const slid = boxes.filter((_, i) => texts[i]!.inside === true);
    const off = boxes.filter((_, i) => texts[i]!.inside !== true);
    assert.equal(off.length, expectOff, `${def.name}: labels left to clip`);
    assert.ok(slid.length > 0);
    inside(slid);
    assert.ok(slid.some((b) => b.right === WIDTH || b.left === 0), `${def.name}: a label was slid against an edge`);
    for (const b of off) assert.ok(b.left > WIDTH || b.right < 0, `${def.name}: ${b.text} belongs to a line off screen`);
  }

  it('gann fan and pitchfan labels at the price axis', () => {
    // a (300, 200), b (390, 100): the 1×n points sit on y 100 up to x 390, the n×1 ones at x 390.
    check(gannFanDrawing, [{ index: 30, price: 100 }, { index: 39, price: 200 }]);
    // b–c vertical at x 390: every label starts at 394.
    check(pitchfanDrawing, [{ index: 30, price: 150 }, { index: 39, price: 200 }, { index: 39, price: 100 }]);
  });

  it('gann fan labels of points beyond the price axis stay with them instead of piling up at the edge', () => {
    // b at x 500: the 1×1, 1×2 … points lie beyond the plot, the 8×1 … 2×1 ones on the y-100 row inside it.
    const { prims } = render(gannFanDrawing, [{ index: 30, price: 100 }, { index: 50, price: 200 }]);
    const texts = labels(prims);
    assert.deepEqual(texts.filter((t) => t.inside === true).map((t) => t.text), ['8/1', '4/1', '3/1', '2/1']);
  });

  it('fib channel labels (left of the levels) slide in at the left edge', () => {
    const { prims, boxes } = render(fibChannelDrawing, [{ index: 0.2, price: 100 }, { index: 20, price: 150 }, { index: 5, price: 120 }]);
    assert.equal(labels(prims).length, 7);
    assert.ok(labels(prims).every((t) => t.inside === true));
    inside(boxes);
    assert.ok(boxes.every((b) => b.left === 0));
    // Levels scrolled off the right: nothing slides in.
    const gone = render(fibChannelDrawing, [{ index: 50, price: 100 }, { index: 60, price: 150 }, { index: 55, price: 120 }]);
    assert.ok(labels(gone.prims).every((t) => t.inside === false));
  });

  it('gann box and square labels at either edge', () => {
    for (const def of [gannBoxDrawing, gannSquareDrawing, gannSquareFixedDrawing]) {
      check(def, [{ index: 30, price: 100 }, { index: 40, price: 200 }]);
      check(def, [{ index: 0.2, price: 100 }, { index: 20, price: 200 }]);
    }
    // A box running past the price axis: only its on-screen columns keep a label.
    const { prims } = render(gannBoxDrawing, [{ index: 30, price: 100 }, { index: 50, price: 200 }]);
    const top = labels(prims).filter((t) => t.align === 'center');
    assert.deepEqual(top.map((t) => t.inside), top.map((t) => t.x <= WIDTH));
    assert.ok(top.some((t) => t.inside === false));
  });

  it('trend angle label beside an arc near the price axis', () => {
    check(trendAngleDrawing, [{ index: 34, price: 100 }, { index: 39, price: 150 }]);
    const gone = render(trendAngleDrawing, [{ index: 45, price: 100 }, { index: 50, price: 150 }]);
    assert.equal(labels(gone.prims)[0]!.inside, false);
  });

  it('fib time zone and trend-based fib time labels of on-screen verticals', () => {
    // Verticals at x 260 … 390 (the 13 label crosses the axis), then 470 and beyond.
    check(fibTimeZoneDrawing, [{ index: 26, price: 100 }, { index: 27, price: 100 }], 5);
    // Verticals at 300, 338.2, 350, 361.8, 400 (the 1 label crosses it), then beyond.
    check(fibTimeDrawing, [{ index: 10, price: 100 }, { index: 20, price: 100 }, { index: 30, price: 100 }], 8);
  });
});
