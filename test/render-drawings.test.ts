import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockContext2D } from '../dist/dom.js';
import { crisp, drawDrawings, type DrawingPaint, type ResolvedDrawing } from '../dist/render/drawings.js';
import { distToSegment, hitTest } from '../dist/drawings/hit.js';

const paint: DrawingPaint = {
  sansFamily: 'Sans',
  monoFamily: 'Mono',
  fontSize: 12,
  background: '#111',
  pixelRatio: 1,
};

function render(d: Partial<ResolvedDrawing> & Pick<ResolvedDrawing, 'primitives'>, p: DrawingPaint = paint): MockContext2D {
  const ctx = new MockContext2D();
  drawDrawings(ctx, [{ color: '#123456', lineWidth: 1, ...d }], p);
  return ctx;
}

describe('crisp', () => {
  it('centers odd device widths on pixel middles and even on edges', () => {
    assert.equal(crisp(10.2, 1, 1), 10.5);
    assert.equal(crisp(10.2, 2, 1), 10);
    assert.equal(crisp(10.2, 1, 2), 10);
    assert.equal(crisp(10.2, 1.5, 2), 10.25);
    assert.equal(crisp(10.2, 0, 1), 10.5); // clamps to one device pixel
  });
});

describe('drawDrawings', () => {
  it('snaps axis-aligned lines, keeps diagonals, applies dash overrides', () => {
    const ctx = render({
      dash: [6, 4],
      primitives: [
        { type: 'line', x1: 0, y1: 10.2, x2: 50, y2: 10.2 },
        { type: 'line', x1: 3.3, y1: 0, x2: 3.3, y2: 40, dash: [1, 2] },
        { type: 'line', x1: 0, y1: 0, x2: 7, y2: 9 },
      ],
    });
    const moves = ctx.callsNamed('moveTo');
    assert.deepEqual(moves[0], ['moveTo', 0, 10.5]);
    assert.deepEqual(moves[1], ['moveTo', 3.5, 0]);
    assert.deepEqual(moves[2], ['moveTo', 0, 0]);
    const dashes = ctx.callsNamed('setLineDash').map((c) => JSON.stringify(c[1]));
    assert.ok(dashes.includes('[6,4]') && dashes.includes('[1,2]'));
    assert.equal(ctx.lineCap, 'round');
  });
  it('fills with the drawing color, a custom color, and custom alpha; skips stroke on noStroke', () => {
    const ctx = render({
      primitives: [
        { type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: true },
        { type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: '#abc', fillAlpha: 0.5, alpha: 0.5, noStroke: true },
      ],
    });
    assert.equal(ctx.countCalls('fill'), 2);
    assert.equal(ctx.countCalls('stroke'), 1);
  });
  it('paints paths (open, closed, degenerate), ellipses, béziers and images', () => {
    const img = { width: 4, height: 4 };
    const ctx = render({
      primitives: [
        { type: 'path', points: [0, 0, 10, 10, 20, 0], closed: true, fill: true },
        { type: 'path', points: [0, 0, 10, 10] },
        { type: 'path', points: [1, 1] },
        { type: 'ellipse', cx: 5, cy: 5, rx: -1, ry: 3 },
        { type: 'ellipse', cx: 5, cy: 5, rx: 2, ry: 3, rotation: 1, start: 0, end: 1 },
        { type: 'bezier', x1: 0, y1: 0, cx1: 1, cy1: 1, cx2: 2, cy2: 2, x2: 3, y2: 3 },
        { type: 'image', image: img, x: 1, y: 2, w: 3, h: 4 },
      ],
    });
    assert.equal(ctx.countCalls('closePath'), 1);
    assert.deepEqual(ctx.callsNamed('ellipse')[0], ['ellipse', 5, 5, 0, 3, 0, 0, Math.PI * 2]);
    assert.equal(ctx.countCalls('bezierCurveTo'), 1);
    assert.deepEqual(ctx.callsNamed('drawImage')[0], ['drawImage', img, 1, 2, 3, 4]);
  });
  it('lays out multi-line text with and without background boxes', () => {
    const ctx = render({
      primitives: [
        { type: 'text', text: 'a\nbb', x: 100, y: 100 },
        { type: 'text', text: 'boxed', x: 100, y: 100, bg: true, align: 'center', baseline: 'top', bold: true, font: 'sans', size: 14 },
        { type: 'text', text: 'right', x: 100, y: 100, bg: '#fff', border: '#000', align: 'right', baseline: 'bottom', color: '#000', pad: 2, radius: 0 },
      ],
    });
    const fonts = ctx.callsNamed('set:font').map((c) => c[1]);
    assert.ok(fonts.includes('12px Mono') && fonts.includes('600 14px Sans'));
    const texts = ctx.callsNamed('fillText');
    assert.equal(texts.length, 4);
    // Two lines stack by the 1.3× line height.
    assert.equal(Number(texts[1]![3]) - Number(texts[0]![3]), 16);
    assert.equal(ctx.countCalls('arcTo'), 8);
  });
  it('paints handles over the background', () => {
    const ctx = render({ primitives: [], handles: [{ x: 1, y: 2 }, { x: 3, y: 4 }] });
    assert.equal(ctx.callsNamed('ellipse').length, 2);
    assert.equal(ctx.countCalls('fill'), 2);
  });
  it('contrasts boxed labels while preserving explicit text colors and unboxed text', () => {
    const ctx = new MockContext2D();
    const colors: unknown[] = [];
    ctx.fillText = () => { colors.push(ctx.fillStyle); };
    drawDrawings(ctx, [{ color: '#00ff00', lineWidth: 1, primitives: [
      { type: 'text', text: 'target', x: 0, y: 0, bg: 'color(display-p3 0 1 0.55)' },
      { type: 'text', text: 'entry', x: 0, y: 0, bg: '#787b86' },
      { type: 'text', text: 'dark', x: 0, y: 0, bg: '#123456' },
      { type: 'text', text: 'inherited', x: 0, y: 0, bg: true },
      { type: 'text', text: 'custom', x: 0, y: 0, bg: '#fff', color: '#123456' },
      { type: 'text', text: 'plain', x: 0, y: 0 },
      { type: 'text', text: 'translucent', x: 0, y: 0, bg: '#ffffff20' },
    ] }], paint);
    assert.deepEqual(colors, ['#000000', '#000000', '#ffffff', '#000000', '#123456', '#00ff00', '#ffffff']);
  });
});

describe('hitTest', () => {
  it('measures segment distance including degenerate segments', () => {
    assert.equal(distToSegment(5, 5, 0, 0, 10, 0), 5);
    assert.equal(distToSegment(3, 4, 0, 0, 0, 0), 5);
  });
  it('hits lines within tolerance plus half width', () => {
    assert.ok(hitTest({ type: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }, 50, 4, 4));
    assert.ok(!hitTest({ type: 'line', x1: 0, y1: 0, x2: 100, y2: 0 }, 50, 10, 4));
    assert.ok(hitTest({ type: 'line', x1: 0, y1: 0, x2: 100, y2: 0, width: 10 }, 50, 8, 4));
  });
  it('hits filled rect interiors, outlined rect edges only', () => {
    assert.ok(hitTest({ type: 'rect', x: 0, y: 0, w: 10, h: 10, fill: true }, 5, 5, 2));
    assert.ok(!hitTest({ type: 'rect', x: 0, y: 0, w: 10, h: 10 }, 5, 5, 2));
    assert.ok(hitTest({ type: 'rect', x: 0, y: 0, w: 10, h: 10 }, 10, 5, 2));
  });
  it('hits closed filled polygons inside and open paths near strokes', () => {
    const tri = { type: 'path' as const, points: [0, 0, 20, 0, 10, 20], closed: true, fill: true as const };
    assert.ok(hitTest(tri, 10, 5, 1));
    assert.ok(!hitTest(tri, 30, 30, 1));
    assert.ok(hitTest({ type: 'path', points: [0, 0, 20, 0, 10, 20], closed: true }, 10, 19, 2));
    assert.ok(!hitTest({ type: 'path', points: [0, 0, 20, 0, 10, 20], closed: true }, 10, 5, 1));
    assert.ok(hitTest({ type: 'path', points: [0, 0, 20, 0], width: 6 }, 10, 3, 1));
  });
  it('hits ellipses by fill or ring', () => {
    assert.ok(hitTest({ type: 'ellipse', cx: 0, cy: 0, rx: 10, ry: 10, fill: true }, 2, 2, 1));
    assert.ok(!hitTest({ type: 'ellipse', cx: 0, cy: 0, rx: 10, ry: 10 }, 2, 2, 1));
    assert.ok(hitTest({ type: 'ellipse', cx: 0, cy: 0, rx: 10, ry: 10 }, 10, 0, 1));
    assert.ok(!hitTest({ type: 'ellipse', cx: 0, cy: 0, rx: 0, ry: 0 }, 50, 50, 1));
  });
  it('hits béziers near the curve or inside when filled', () => {
    const curve = { type: 'bezier' as const, x1: 0, y1: 0, cx1: 0, cy1: 30, cx2: 30, cy2: 30, x2: 30, y2: 0 };
    assert.ok(hitTest(curve, 15, 22.5, 2));
    assert.ok(!hitTest(curve, 15, 10, 2));
    assert.ok(hitTest({ ...curve, fill: true }, 15, 10, 2));
  });
  it('hits text boxes by alignment and baseline', () => {
    for (const [align, baseline, x, y] of [
      ['left', 'middle', 5, 0],
      ['center', 'top', 0, 5],
      ['right', 'bottom', -5, -5],
    ] as const) {
      assert.ok(hitTest({ type: 'text', text: 'hello', x: 0, y: 0, align, baseline }, x, y, 1), `${align}/${baseline}`);
    }
    assert.ok(hitTest({ type: 'text', text: 'x', x: 0, y: 0, size: 20, pad: 0 }, 5, 0, 0));
    assert.ok(!hitTest({ type: 'text', text: 'x', x: 0, y: 0 }, 100, 100, 1));
  });
  it('hits images inside their box', () => {
    const img = { type: 'image' as const, image: { width: 1, height: 1 }, x: 0, y: 0, w: 10, h: 10 };
    assert.ok(hitTest(img, 5, 5, 0));
    assert.ok(!hitTest(img, 15, 5, 0));
  });
});
