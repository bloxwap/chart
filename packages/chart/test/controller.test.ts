import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createChart } from '../dist/index.js';
import { MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import { DrawingController, DrawingHistory, HISTORY_LIMIT, ZOOM_TOOL, groupOf } from '../dist/ui/index.js';

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 5) * 10;
    return { time: 1700000000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
  });
}

function setup(options: { navigation?: boolean; n?: number } = {}) {
  const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(options.n ?? 200) } });
  const c = new DrawingController(chart, options.navigation === undefined ? {} : { navigation: options.navigation });
  const events: string[] = [];
  for (const e of ['change', 'select', 'edit-text', 'request-image', 'toast', 'viewport'] as const) {
    c.on(e, (p) => events.push(p === undefined ? e : `${e}:${String(p)}`));
  }
  const at = (index: number, price: number): [number, number] => [chart.scale.indexToX(index), chart.scale.priceToY(price)];
  const click = (x: number, y: number) => {
    c.pointerMove(x, y);
    c.pointerDown(x, y);
    c.pointerUp(x, y);
  };
  return { chart, c, events, at, click };
}

describe('DrawingController basics', () => {
  it('groups, labels, last tools and hints', () => {
    const { c } = setup();
    assert.equal(groupOf('pitchfork'), 'lines');
    assert.equal(groupOf('nope'), undefined);
    assert.equal(c.label('fib'), 'Fib retracement');
    assert.equal(c.label(ZOOM_TOOL), 'Zoom in');
    assert.equal(c.label('custom'), 'custom');
    assert.equal(c.lastTool('fib'), 'fib');
    assert.deepEqual(c.hint(), { title: '', detail: 'Drag to scroll · wheel to zoom · click a drawing to edit it', quiet: true });
    c.arm('pitchfork');
    assert.equal(c.lastTool('lines'), 'pitchfork');
    assert.match(c.hint().detail, /click 3 points \(0\/3\)/);
    c.arm('hline');
    assert.match(c.hint().detail, /^click to place/);
    c.arm('brush');
    assert.match(c.hint().detail, /press and drag/);
    c.arm('path');
    assert.match(c.hint().detail, /double-click or Enter/);
    c.arm(ZOOM_TOOL);
    assert.equal(c.hint().title, 'Zoom in');
    c.setCursor('eraser');
    assert.equal(c.hint().title, 'Eraser');
  });
  it('arming validates names, toggles off, and requests images', () => {
    const { c, events } = setup();
    assert.throws(() => c.arm('bogus'), /unknown drawing/);
    c.arm('trendline');
    c.arm('trendline');
    assert.equal(c.tool, null);
    c.arm('image');
    assert.ok(events.includes('request-image'));
    assert.equal(c.tool, null);
    c.placeImage({ width: 10, height: 10 });
    assert.equal(c.tool, 'image');
    c.arm(ZOOM_TOOL);
    c.arm(ZOOM_TOOL); // zoom re-arms rather than toggling
    assert.equal(c.tool, ZOOM_TOOL);
  });
  it('mode setters emit toasts and apply to the chart', () => {
    const { c, chart, events } = setup();
    c.setCursor('dot');
    assert.equal(chart.getConfig().crosshair.mode, 'dot');
    c.setCursor('eraser');
    assert.equal(chart.getConfig().crosshair.mode, 'arrow');
    c.setMagnet('weak');
    c.setMagnet('strong');
    c.setMagnet('off');
    c.setStay(true);
    c.setStay(false);
    c.setLocked(true);
    c.setLocked(false);
    for (const t of ['Weak magnet on', 'Strong magnet on', 'Magnet off', 'Stay in drawing mode on', 'Stay in drawing mode off', 'All drawings locked', 'Drawings unlocked']) {
      assert.ok(events.includes(`toast:${t}`), t);
    }
  });
  it('hides and removes drawings and indicators', () => {
    const { c, chart } = setup();
    chart.addIndicator({ name: 'sma' });
    chart.addDrawing({ name: 'hline', points: [{ index: 5, price: 100 }] });
    c.setHidden(true, true);
    assert.equal(chart.drawingsHidden, true);
    assert.equal(chart.getConfig().indicators[0]!.visible, false);
    c.setHidden(false, false);
    assert.equal(chart.getConfig().indicators[0]!.visible, true);
    c.removeIndicators();
    assert.equal(chart.getConfig().indicators.length, 0);
    c.removeDrawings();
    assert.equal(chart.getConfig().drawings.length, 0);
    c.removeDrawings(); // no-op when empty
    assert.equal(c.history.canUndo, true);
  });
});

describe('DrawingController placement', () => {
  it('places multi-point tools click by click with a live preview', () => {
    const { c, chart, at, click, events } = setup();
    c.arm('trendline');
    click(...at(20, 100));
    assert.equal(c.points.length, 1);
    c.pointerMove(...at(40, 105));
    click(...at(40, 105));
    const d = chart.getConfig().drawings.at(-1)!;
    assert.equal(d.name, 'trendline');
    assert.deepEqual(d.points.map((p) => p.index), [20, 40]);
    assert.equal(c.tool, null);
    assert.equal(chart.selectedDrawing, d.id);
    assert.ok(events.includes(`select:${d.id}`));
  });
  it('press-drag-release places both ends of a two-point tool', () => {
    const { c, chart, at } = setup();
    c.arm('rect');
    c.pointerDown(...at(10, 95));
    c.pointerMove(...at(30, 105));
    c.pointerUp(...at(30, 105));
    assert.equal(chart.getConfig().drawings.at(-1)!.points.length, 2);
  });
  it('freehand tools collect a stroke; too-short strokes are dropped', () => {
    const { c, chart, at } = setup();
    c.arm('brush');
    c.pointerDown(...at(10, 100));
    for (let i = 11; i < 20; i++) c.pointerMove(...at(i, 100 + i / 10));
    c.pointerUp(...at(20, 101));
    assert.ok(chart.getConfig().drawings.at(-1)!.points.length >= 10);
    c.arm('highlighter');
    c.pointerDown(...at(10, 100));
    c.pointerUp(...at(10, 100));
    assert.equal(chart.getConfig().drawings.at(-1)!.name, 'brush');
    assert.equal(c.tool, 'highlighter');
  });
  it('highlighter uses its own color', () => {
    const { c, chart, at } = setup();
    c.arm('highlighter');
    c.pointerDown(...at(10, 100));
    c.pointerMove(...at(15, 101));
    c.pointerUp(...at(20, 102));
    assert.equal(chart.getConfig().drawings.at(-1)!.color, '#f7b500');
  });
  it('open-ended tools finish on Enter or double-click', () => {
    const { c, chart, at, click } = setup();
    c.arm('polyline');
    click(...at(10, 100));
    click(...at(20, 105));
    click(...at(30, 98));
    assert.equal(c.keyDown('Enter'), true);
    assert.equal(chart.getConfig().drawings.at(-1)!.points.length, 3);
    c.arm('path');
    click(...at(10, 100));
    click(...at(20, 105));
    click(...at(20, 105));
    c.doubleClick(...at(20, 105));
    assert.equal(chart.getConfig().drawings.at(-1)!.name, 'path');
    assert.equal(chart.getConfig().drawings.at(-1)!.points.length, 2);
  });
  it('text tools ask for text; glyph tools do not', () => {
    const { c, chart, at, click, events } = setup();
    c.arm('note');
    click(...at(10, 100));
    const note = chart.getConfig().drawings.at(-1)!;
    assert.ok(events.includes(`edit-text:${note.id}`));
    c.setText(note.id, 'Hello');
    assert.equal(chart.getDrawing(note.id)!.text, 'Hello');
    c.setText(note.id, 'Hello'); // unchanged: no new history entry
    c.setText('missing', 'x');
    c.arm('emoji', { text: '🚀' });
    click(...at(12, 100));
    assert.equal(chart.getConfig().drawings.at(-1)!.text, '🚀');
    assert.equal(events.filter((e) => e.startsWith('edit-text')).length, 1);
  });
  it('image drawings consume the pending image', () => {
    const { c, chart, at, click } = setup();
    const img = { width: 4, height: 4 };
    c.placeImage(img);
    click(...at(10, 105));
    click(...at(20, 95));
    assert.equal(chart.getConfig().drawings.at(-1)!.image, img);
    assert.equal(c.pendingImage, null);
  });
  it('stay-in-drawing mode keeps the tool armed', () => {
    const { c, chart, at, click } = setup();
    c.setStay(true);
    c.arm('hline');
    click(...at(10, 100));
    click(...at(10, 101));
    assert.equal(chart.getConfig().drawings.length, 2);
    assert.equal(c.tool, 'hline');
  });
  it('anchored tools place screen fractions', () => {
    const { c, chart, click } = setup();
    c.arm('anchored-text', { text: 'A' });
    click(368, 238);
    assert.deepEqual(chart.getConfig().drawings.at(-1)!.points[0], { index: 0.5, price: 0.5 });
  });
  it('the magnet snaps placed points to OHLC', () => {
    const { c, chart, at, click } = setup();
    c.setMagnet('strong');
    c.arm('hline');
    const bar = candles(200)[30]!;
    click(chart.scale.indexToX(30.2), chart.scale.priceToY(bar.high) + 2);
    assert.equal(chart.getConfig().drawings.at(-1)!.points[0]!.price, bar.high);
    void at;
  });
  it('right-click and Escape cancel; Escape with no tool deselects', () => {
    const { c, chart, at, click } = setup();
    assert.equal(c.contextMenu(), false);
    c.arm('trendline');
    click(...at(10, 100));
    assert.equal(c.contextMenu(), true);
    assert.equal(c.tool, null);
    c.arm('trendline');
    assert.equal(c.keyDown('Escape'), true);
    const id = chart.addDrawing({ name: 'hline', points: [{ index: 1, price: 100 }] });
    c.select(id);
    c.keyDown('Escape');
    assert.equal(chart.selectedDrawing, null);
    assert.equal(c.keyDown('x'), false);
    assert.equal(c.keyDown('Enter'), false);
  });
});

describe('DrawingController editing', () => {
  it('selects on click, drags handles, moves bodies, and undoes each step', () => {
    const { c, chart, at } = setup();
    const id = chart.addDrawing({ name: 'trendline', points: [{ index: 20, price: 100 }, { index: 60, price: 104 }] });
    const [mx, my] = at(40, 102);
    c.pointerDown(mx, my);
    c.pointerUp(mx, my);
    assert.equal(chart.selectedDrawing, id);
    // Drag the second handle.
    const [hx, hy] = at(60, 104);
    c.pointerDown(hx, hy);
    assert.equal(c.dragging, true);
    c.pointerMove(...at(70, 106));
    c.pointerUp(...at(70, 106));
    assert.equal(chart.getDrawing(id)!.points[1]!.index, 70);
    // Move the body.
    const before = chart.getDrawing(id)!.points[0]!.index;
    const [bx, by] = at(45, 103);
    c.pointerDown(bx, by);
    c.pointerMove(bx + chart.scale.indexToX(5) - chart.scale.indexToX(0), by);
    c.pointerMove(bx + chart.scale.indexToX(5) - chart.scale.indexToX(0), by);
    c.pointerUp(bx, by);
    assert.ok(Math.abs(chart.getDrawing(id)!.points[0]!.index - before - 5) < 1e-6);
    c.undo();
    assert.equal(chart.getDrawing(id)!.points[0]!.index, before);
    c.undo();
    assert.equal(chart.getDrawing(id)!.points[1]!.index, 60);
    c.redo();
    assert.equal(chart.getDrawing(id)!.points[1]!.index, 70);
    assert.equal(chart.selectedDrawing, id);
  });
  it('locked drawings select but do not move; lock-all blocks selection', () => {
    const { c, chart, at } = setup();
    const id = chart.addDrawing({ name: 'trendline', points: [{ index: 20, price: 100 }, { index: 60, price: 104 }], locked: true });
    const [mx, my] = at(40, 102);
    c.pointerDown(mx, my);
    c.pointerMove(mx + 50, my);
    c.pointerUp(mx + 50, my);
    assert.equal(chart.selectedDrawing, id);
    assert.equal(chart.getDrawing(id)!.points[0]!.index, 20);
    // Handles of a locked selection are inert too.
    c.pointerDown(...at(60, 104));
    c.pointerUp(...at(60, 104));
    c.setLocked(true);
    assert.equal(chart.selectedDrawing, null);
    c.pointerDown(mx, my);
    c.pointerUp(mx, my);
    assert.equal(chart.selectedDrawing, null);
  });
  it('restyles, clones, deletes and remembers the last color', () => {
    const { c, chart } = setup();
    const id = chart.addDrawing({ name: 'hline', points: [{ index: 5, price: 100 }] });
    c.restyle(id, { color: '#f23645', lineWidth: 3 });
    assert.equal(c.color, '#f23645');
    c.restyle(id, { lineStyle: 'dotted' });
    const copy = c.clone(id)!;
    assert.notEqual(copy, id);
    assert.ok(chart.getDrawing(copy)!.points[0]!.index > 5);
    assert.equal(c.clone('missing'), null);
    const anchored = chart.addDrawing({ name: 'anchored-note', points: [{ index: 0.5, price: 0.5 }] });
    const anchoredCopy = c.clone(anchored)!;
    assert.ok(Math.abs(chart.getDrawing(anchoredCopy)!.points[0]!.index - 0.52) < 1e-9);
    assert.equal(c.keyDown('Delete'), true);
    assert.equal(chart.getDrawing(anchoredCopy), undefined);
    assert.equal(c.removeSelected(), false);
    assert.equal(c.keyDown('Backspace'), false);
  });
  it('double-click edits text-bearing drawings only', () => {
    const { c, chart, at, events } = setup();
    const note = chart.addDrawing({ name: 'text', points: [{ index: 30, price: 100 }], text: 'Hi' });
    c.doubleClick(...at(30, 100));
    assert.ok(events.includes(`edit-text:${note}`));
    const line = chart.addDrawing({ name: 'hline', points: [{ index: 5, price: 90 }] });
    c.doubleClick(...at(5, 90));
    assert.ok(!events.includes(`edit-text:${line}`));
    c.doubleClick(1, 1);
  });
  it('keyboard undo/redo', () => {
    const { c, chart } = setup();
    c.history.checkpoint();
    chart.addDrawing({ name: 'hline', points: [{ index: 5, price: 90 }] });
    assert.equal(c.keyDown('z', { meta: true }), true);
    assert.equal(chart.getConfig().drawings.length, 0);
    assert.equal(c.keyDown('Z', { meta: true, shift: true }), true);
    assert.equal(chart.getConfig().drawings.length, 1);
  });
});

describe('DrawingController eraser, zoom and navigation', () => {
  it('erases on click and while dragging, skipping locked drawings', () => {
    const { c, chart, at } = setup();
    const a = chart.addDrawing({ name: 'hline', points: [{ index: 5, price: 100 }] });
    const b = chart.addDrawing({ name: 'hline', points: [{ index: 5, price: 104 }] });
    const locked = chart.addDrawing({ name: 'hline', points: [{ index: 5, price: 96 }], locked: true });
    c.setCursor('eraser');
    c.pointerDown(...at(150, 100));
    c.pointerMove(...at(150, 104));
    c.pointerMove(...at(150, 96));
    c.pointerUp(...at(150, 96));
    assert.equal(chart.getDrawing(a), undefined);
    assert.equal(chart.getDrawing(b), undefined);
    assert.ok(chart.getDrawing(locked) !== undefined);
    c.setLocked(true);
    const d = chart.addDrawing({ name: 'hline', points: [{ index: 5, price: 110 }] });
    c.pointerDown(...at(150, 110));
    c.pointerUp(...at(150, 110));
    assert.ok(chart.getDrawing(d) !== undefined);
  });
  it('box zoom fits the dragged range; tiny boxes are ignored', () => {
    const { c, chart, events } = setup();
    c.arm(ZOOM_TOOL);
    c.pointerDown(100, 200);
    c.pointerMove(103, 200);
    assert.deepEqual(c.zoomBox, { x0: 100, x1: 103 });
    c.pointerUp(103, 200);
    assert.equal(c.tool, null);
    const before = chart.scale.visibleRange();
    c.setStay(true);
    c.arm(ZOOM_TOOL);
    c.pointerDown(100, 200);
    c.pointerMove(400, 200);
    c.pointerUp(400, 200);
    const after = chart.scale.visibleRange();
    assert.ok(after.to - after.from < before.to - before.from);
    assert.equal(c.tool, ZOOM_TOOL);
    assert.ok(events.includes('viewport'));
    assert.equal(c.zoomBox, null);
  });
  it('pans empty space, zooms on wheel, and tracks the crosshair', () => {
    const { c, chart } = setup();
    chart.scale.zoom(3);
    const before = chart.scale.visibleRange();
    c.pointerDown(400, 200);
    c.pointerMove(500, 200);
    c.pointerUp(500, 200);
    assert.notDeepEqual(chart.scale.visibleRange(), before);
    const span = chart.scale.visibleRange();
    c.wheel(-1, 300);
    c.wheel(1, 300);
    c.wheel(-1, 300);
    assert.ok(chart.scale.visibleRange().to - chart.scale.visibleRange().from < span.to - span.from);
    c.pointerLeave();
    c.pointerUp(1, 1); // stray up with no drag
  });
  it('navigation off leaves the viewport alone', () => {
    const { c, chart } = setup({ navigation: false });
    const before = chart.scale.visibleRange();
    c.pointerDown(400, 200);
    c.pointerMove(500, 200);
    c.pointerUp(500, 200);
    c.wheel(-1, 300);
    c.pointerLeave();
    assert.deepEqual(chart.scale.visibleRange(), before);
  });
  it('disarm mid-placement drops the pending drag', () => {
    const { c, chart, at } = setup();
    c.arm('trendline');
    c.pointerDown(...at(10, 100));
    c.disarm();
    c.pointerUp(...at(12, 100));
    assert.equal(chart.getConfig().drawings.length, 0);
  });
  it('unsubscribes listeners', () => {
    const { chart } = setup();
    const c = new DrawingController(chart);
    let n = 0;
    const off = c.on('toast', () => n++);
    c.setStay(true);
    off();
    c.setStay(false);
    assert.equal(n, 1);
  });
});

describe('DrawingHistory', () => {
  it('caps its depth and reports availability', () => {
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(10) } });
    const h = new DrawingHistory(chart);
    let changes = 0;
    const off = h.onChange(() => changes++);
    assert.equal(h.canUndo, false);
    assert.equal(h.undo(), false);
    assert.equal(h.redo(), false);
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h.checkpoint();
    let undos = 0;
    while (h.undo()) undos++;
    assert.equal(undos, HISTORY_LIMIT);
    assert.equal(h.canRedo, true);
    off();
    assert.ok(changes > HISTORY_LIMIT);
  });
});

describe('interrupting active tools', () => {
  it('cancels a freehand gesture and keeps box zoom armed in stay mode', () => {
    const { chart, c } = setup();
    c.arm('brush');
    c.pointerDown(100, 100);
    c.pointerMove(150, 150);
    c.disarm();
    c.pointerUp(150, 150);
    assert.equal(chart.getConfig().drawings.length, 0);
    c.setStay(true);
    c.arm(ZOOM_TOOL);
    c.pointerDown(100, 100);
    c.pointerMove(300, 100);
    c.pointerUp(300, 100);
    assert.equal(c.tool, ZOOM_TOOL);
    assert.equal(c.zoomBox, null);
    c.keyDown('Escape');
    assert.equal(c.tool, null);
    chart.destroy();
  });
});
