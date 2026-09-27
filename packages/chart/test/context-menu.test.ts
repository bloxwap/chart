import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import type { HTMLElement } from 'happy-dom';
import { createChart, MockDocument, type Chart, type FrameScheduler } from '../dist/index.js';
import type { Candle } from '../dist/core/data.js';
import type { ChartConfig, DeepPartial } from '../dist/config.js';
import {
  attachTouchGestures,
  createChartContextMenu,
  createDrawingToolbar,
  DrawingController,
  Flyouts,
  TOOLBAR_CSS,
  type ChartContextMenu,
  type ChartContextMenuOptions,
  type ContextMenuAction,
  type ContextMenuTarget,
  type DrawingToolbarOptions,
  type UIDocument,
  type UIElement,
} from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => {
  for (const w of windows) void w.happyDOM.close();
});

const N = 200;
function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 5) * 10;
    return { time: 1700000000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
  });
}
const DATA = candles(N);

class TestFrames implements FrameScheduler {
  time = 0;
  seq = 0;
  callbacks = new Map<number, (time: number) => void>();
  now = () => this.time;
  request = (callback: (time: number) => void) => { const id = ++this.seq; this.callbacks.set(id, callback); return id; };
  cancel = (id: number) => { this.callbacks.delete(id); };
}

/**
 * Asserts which element has focus by identity: a failing `assert.equal` on
 * happy-dom nodes would try to diff the whole DOM graph instead of reporting.
 */
function focusedOn(m: { doc: { activeElement: unknown } }, expected: unknown, message = 'focus'): void {
  assert.ok(m.doc.activeElement === expected, message);
}

/** Reads the open target's kind (a getter, so it is re-read after each event). */
const kindOf = (menu: ChartContextMenu): ContextMenuTarget['kind'] | undefined => menu.target?.kind;

type MenuExtra = Partial<Omit<ChartContextMenuOptions, 'chart' | 'document' | 'canvas'>>;

function page(chartConfig: DeepPartial<ChartConfig> = {}) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const doc = win.document;
  const stage = doc.createElement('div');
  const canvas = doc.createElement('div');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 500 } });
  stage.append(canvas);
  doc.body.append(stage);
  const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: DATA, ...chartConfig } });
  const rightClick = (x: number, y: number, init: Record<string, unknown> = {}) => {
    const e = new win.PointerEvent('contextmenu', { clientX: x, clientY: y, button: 2, pointerType: 'mouse', bubbles: true, cancelable: true, ...init });
    canvas.dispatchEvent(e);
    return e;
  };
  /** A press on the canvas; a finger's is what a long press starts with. */
  const press = (pointerType: string) => {
    canvas.dispatchEvent(new win.PointerEvent('pointerdown', { clientX: 300, clientY: 200, pointerId: 1, pointerType, bubbles: true, cancelable: true }));
  };
  /** The `contextmenu` a browser fires after a press, as a plain MouseEvent (no pointer type). */
  const compat = () => {
    const e = new win.MouseEvent('contextmenu', { clientX: 300, clientY: 200, bubbles: true, cancelable: true });
    canvas.dispatchEvent(e);
    return e;
  };
  return { win, doc, stage, canvas, chart, rightClick, press, compat, udoc: doc as unknown as UIDocument, ucanvas: canvas as unknown as UIElement };
}

function mount(extra: MenuExtra = {}, chartConfig: DeepPartial<ChartConfig> = {}) {
  const p = page(chartConfig);
  const menu = createChartContextMenu({ chart: p.chart, document: p.udoc, canvas: p.ucanvas, ...extra });
  const root = menu.element as unknown as HTMLElement;
  const rows = () => [...root.querySelectorAll('.cts-item')] as unknown as HTMLElement[];
  const labels = () => rows().map((row) => row.querySelector('.cts-item-label')!.textContent);
  const item = (label: string) => {
    const found = rows().find((row) => row.querySelector('.cts-item-label')!.textContent === label);
    assert.ok(found, `menu item "${label}" in [${labels().join(', ')}]`);
    return found;
  };
  const isOpen = () => root.classList.contains('cts-open');
  const key = (k: string, target: { dispatchEvent(e: unknown): boolean } = root) => {
    const e = new p.win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    target.dispatchEvent(e);
    return e;
  };
  return { ...p, menu, root, rows, labels, item, isOpen, key };
}

/** A trend line across bars 150–190 whose midpoint (bar 170, price 100) is returned. */
function trendline(chart: Chart): { id: string; x: number; y: number } {
  const id = chart.addDrawing({ name: 'trendline', points: [{ index: 150, price: 95 }, { index: 190, price: 105 }] });
  const x = chart.scale.indexToX(170);
  const y = chart.scale.priceToY(100);
  assert.equal(chart.drawingAt(x, y), id);
  return { id, x, y };
}

/** SMA(1) tracks the closes; returns a point on it at bar 120 (away from {@link trendline}). */
function sma(chart: Chart): { id: string; x: number; y: number } {
  const id = chart.addIndicator({ name: 'sma', params: { period: 1 } });
  const x = chart.scale.indexToX(120);
  const y = chart.scale.priceToY(DATA[120]!.close);
  assert.deepEqual(chart.indicatorAt(x, y), { id, key: 'value' });
  return { id, x, y };
}

describe('context menu contents per target', () => {
  it('opens the chart menu on empty space with the scale toggles', () => {
    const m = mount();
    const e = m.rightClick(400, 20);
    assert.equal(e.defaultPrevented, true);
    assert.ok(m.isOpen());
    assert.deepEqual(m.menu.target, { kind: 'chart', x: 400, y: 20 } satisfies ContextMenuTarget);
    assert.equal(m.root.getAttribute('role'), 'menu');
    assert.equal(m.root.getAttribute('aria-label'), 'Chart actions');
    assert.deepEqual(m.labels(), ['Reset chart view', 'Auto (fits data to screen)', 'Logarithmic', 'Percent']);
    const auto = m.item('Auto (fits data to screen)');
    assert.equal(auto.getAttribute('role'), 'menuitemcheckbox');
    assert.equal(auto.getAttribute('aria-checked'), 'true');
    assert.ok(auto.classList.contains('cts-active'));
    assert.equal(m.item('Logarithmic').getAttribute('aria-checked'), 'false');
    assert.equal(m.item('Reset chart view').getAttribute('role'), 'menuitem');
    assert.equal(m.root.querySelector('.cts-menu-label')!.textContent, 'Price scale');
    // Fill-only surface in the shared theme portal.
    assert.ok(m.root.classList.contains('cts-menu') && m.root.classList.contains('cts-context-menu'));
    assert.ok((m.root.parentElement as HTMLElement).classList.contains('cts-theme'));
  });

  it('adds chart settings and remove-all rows with counts when they apply', () => {
    const m = mount({ onChartSettings: () => {} });
    trendline(m.chart);
    m.chart.addDrawing({ name: 'hline', points: [{ index: 0, price: 90 }] });
    m.chart.addIndicator({ name: 'rsi' });
    m.rightClick(400, 20);
    assert.deepEqual(m.labels(), [
      'Reset chart view', 'Auto (fits data to screen)', 'Logarithmic', 'Percent',
      'Chart settings…', 'Remove all drawings', 'Remove all indicators',
    ]);
    assert.equal(m.item('Remove all drawings').querySelector('.cts-item-meta')!.textContent, '2');
    assert.equal(m.item('Remove all indicators').querySelector('.cts-item-meta')!.textContent, '1');
    assert.equal(m.root.querySelectorAll('.cts-menu-sep').length, 3);
  });

  it('opens the drawing menu on a drawing and selects it', () => {
    const m = mount({ onDrawingSettings: () => {} });
    const d = trendline(m.chart);
    m.rightClick(d.x, d.y);
    assert.deepEqual(m.menu.target, { kind: 'drawing', id: d.id, x: d.x, y: d.y });
    assert.equal(m.root.getAttribute('aria-label'), 'Drawing actions');
    assert.equal(m.root.querySelector('.cts-menu-label')!.textContent, 'Trend line');
    assert.deepEqual(m.labels(), ['Settings…', 'Clone', 'Lock', 'Hide', 'Remove']);
    assert.equal(m.chart.selectedDrawing, d.id);
  });

  it('opens the indicator menu on an indicator plot; drawings win over indicators', () => {
    const m = mount();
    const s = sma(m.chart);
    m.rightClick(s.x, s.y);
    assert.deepEqual(m.menu.target, { kind: 'indicator', id: s.id, key: 'value', x: s.x, y: s.y });
    assert.equal(m.root.getAttribute('aria-label'), 'Indicator actions');
    assert.equal(m.root.querySelector('.cts-menu-label')!.textContent, 'SMA');
    assert.deepEqual(m.labels(), ['Hide', 'Remove']);
    // A drawing on top of the line takes the click.
    const over = m.chart.addDrawing({ name: 'hline', points: [{ index: 0, price: DATA[120]!.close }] });
    assert.deepEqual(m.menu.targetAt(s.x, s.y), { kind: 'drawing', id: over, x: s.x, y: s.y });
  });

  it('titles custom indicators by name without a short name, and offers settings with the hook', () => {
    const m = mount({ onIndicatorSettings: () => {} });
    m.chart.indicators.register({
      name: 'mine', defaultParams: {}, defaultColors: [], defaultPane: 'sub',
      compute: (c) => ({ pane: 'sub', lines: [{ key: 'k', values: c.map(() => 5), color: '#fff' }] }),
    });
    const id = m.chart.addIndicator({ name: 'mine' });
    const y = Math.floor(476 * 3 / 4) + (476 - Math.floor(476 * 3 / 4)) / 2;
    const target = m.menu.open(300, y);
    assert.deepEqual(target, { kind: 'indicator', id, key: 'k', x: 300, y });
    assert.equal(m.root.querySelector('.cts-menu-label')!.textContent, 'mine');
    assert.deepEqual(m.labels(), ['Settings…', 'Hide', 'Remove']);
  });

  it('appends host rows: items, separators and checkbox rows', () => {
    const clicked: string[] = [];
    const seen: ContextMenuTarget[] = [];
    const m = mount({
      extraItems: (target) => {
        seen.push(target);
        return target.kind === 'chart'
          ? [
            { label: 'Add alert', meta: '⌥A', onClick: () => clicked.push('alert') },
            'separator',
            { label: 'Magnet', checked: true, onClick: () => clicked.push('magnet') },
            { label: 'Grid', checked: false, onClick: () => clicked.push('grid') },
            { label: 'Starred', tick: true, onClick: () => clicked.push('star') },
          ]
          : [];
      },
    });
    m.rightClick(400, 20);
    assert.deepEqual(seen, [{ kind: 'chart', x: 400, y: 20 }]);
    assert.deepEqual(m.labels().slice(-4), ['Add alert', 'Magnet', 'Grid', 'Starred']);
    assert.equal(m.root.querySelectorAll('.cts-menu-sep').length, 3);
    assert.equal(m.item('Magnet').getAttribute('aria-checked'), 'true');
    assert.ok(m.item('Magnet').classList.contains('cts-active'));
    assert.ok(m.item('Magnet').querySelector('.cts-tick'));
    assert.equal(m.item('Grid').getAttribute('aria-checked'), 'false');
    assert.equal(m.item('Starred').getAttribute('role'), 'menuitem');
    assert.ok(m.item('Starred').querySelector('.cts-tick'));
    assert.equal(m.item('Add alert').querySelector('.cts-tick'), null);
    m.item('Add alert').click();
    assert.deepEqual(clicked, ['alert']);
    assert.ok(!m.isOpen());
    // No host rows: no trailing separator.
    const d = trendline(m.chart);
    m.rightClick(d.x, d.y);
    assert.equal(m.root.querySelectorAll('.cts-menu-sep').length, 1);
  });
});

describe('context menu actions', () => {
  it('clones, locks, hides and removes drawings, each undoable', () => {
    const actions: [ContextMenuAction, ContextMenuTarget['kind']][] = [];
    const m = mount({ onAction: (action, target) => actions.push([action, target.kind]) });
    const d = trendline(m.chart);
    const undo = () => m.menu.controller.undo();
    const drawings = () => m.chart.getConfig().drawings;

    m.rightClick(d.x, d.y);
    m.item('Clone').click();
    assert.ok(!m.isOpen());
    assert.equal(drawings().length, 2);
    assert.equal(m.chart.selectedDrawing, drawings()[1]!.id);
    undo();
    assert.equal(drawings().length, 1);

    m.rightClick(d.x, d.y);
    m.item('Lock').click();
    assert.equal(m.chart.getDrawing(d.id)!.locked, true);
    m.rightClick(d.x, d.y);
    assert.deepEqual(m.labels().slice(1, 3), ['Unlock', 'Hide']);
    m.item('Unlock').click();
    assert.equal(m.chart.getDrawing(d.id)!.locked, false);
    undo();
    assert.equal(m.chart.getDrawing(d.id)!.locked, true);
    undo();
    assert.equal(m.chart.getDrawing(d.id)!.locked, false);

    m.rightClick(d.x, d.y);
    m.item('Hide').click();
    assert.equal(m.chart.getDrawing(d.id)!.visible, false);
    assert.equal(m.chart.selectedDrawing, null);
    assert.equal(m.chart.drawingAt(d.x, d.y), null);
    undo();
    assert.equal(m.chart.getDrawing(d.id)!.visible, true);

    m.rightClick(d.x, d.y);
    m.item('Remove').click();
    assert.equal(m.chart.getDrawing(d.id), undefined);
    assert.equal(m.chart.selectedDrawing, null);
    undo();
    assert.ok(m.chart.getDrawing(d.id));
    assert.deepEqual(actions, [
      ['clone', 'drawing'], ['lock', 'drawing'], ['unlock', 'drawing'], ['hide-drawing', 'drawing'], ['remove-drawing', 'drawing'],
    ]);
  });

  it('routes drawing and indicator settings to the host', () => {
    const calls: string[] = [];
    const m = mount({
      onDrawingSettings: (id) => calls.push(`drawing:${id}`),
      onIndicatorSettings: (id) => calls.push(`indicator:${id}`),
      onChartSettings: () => calls.push('chart'),
    });
    const d = trendline(m.chart);
    const s = sma(m.chart);
    m.rightClick(d.x, d.y);
    m.item('Settings…').click();
    m.rightClick(s.x, s.y);
    m.item('Settings…').click();
    m.rightClick(400, 20);
    m.item('Chart settings…').click();
    assert.deepEqual(calls, [`drawing:${d.id}`, `indicator:${s.id}`, 'chart']);
    assert.ok(!m.isOpen());
  });

  it('hides and removes indicators', () => {
    const actions: ContextMenuAction[] = [];
    const m = mount({ onAction: (action) => actions.push(action) });
    const s = sma(m.chart);
    m.rightClick(s.x, s.y);
    m.item('Hide').click();
    assert.equal(m.chart.getIndicator(s.id)!.visible, false);
    assert.equal(m.chart.indicatorAt(s.x, s.y), null);
    m.chart.updateIndicator(s.id, { visible: true });
    m.rightClick(s.x, s.y);
    m.item('Remove').click();
    assert.equal(m.chart.getIndicator(s.id), undefined);
    assert.deepEqual(actions, ['hide-indicator', 'remove-indicator']);
  });

  it('resets the chart view', () => {
    const m = mount();
    m.chart.scale.zoom(2.5);
    m.chart.scale.scrollBy(60);
    m.chart.updateConfig({ priceAxis: { autoScale: false } });
    m.rightClick(400, 20);
    m.item('Reset chart view').click();
    assert.equal(m.chart.scale.barSpacing(), 6);
    assert.equal(m.chart.scale.visibleRange().to, N);
    assert.equal(m.chart.getConfig().priceAxis.autoScale, true);
  });

  it('toggles auto, logarithmic and percent scales', () => {
    const actions: ContextMenuAction[] = [];
    const m = mount({ onAction: (action) => actions.push(action) });
    const axis = () => m.chart.getConfig().priceAxis;
    const choose = (label: string) => {
      m.rightClick(400, 20);
      m.item(label).click();
    };
    choose('Auto (fits data to screen)');
    assert.equal(axis().autoScale, false);
    m.rightClick(400, 20);
    assert.equal(m.item('Auto (fits data to screen)').getAttribute('aria-checked'), 'false');
    m.menu.close();
    choose('Auto (fits data to screen)');
    assert.equal(axis().autoScale, true);
    choose('Logarithmic');
    assert.equal(axis().mode, 'logarithmic');
    m.rightClick(400, 20);
    assert.equal(m.item('Logarithmic').getAttribute('aria-checked'), 'true');
    m.item('Percent').click();
    assert.equal(axis().mode, 'percent');
    choose('Percent');
    assert.equal(axis().mode, 'regular');
    choose('Logarithmic');
    choose('Logarithmic');
    assert.equal(axis().mode, 'regular');
    assert.deepEqual(actions, ['auto-scale', 'auto-scale', 'log-scale', 'percent-scale', 'percent-scale', 'log-scale', 'log-scale']);
  });

  it('removes all drawings (undoable) and all indicators', () => {
    const m = mount();
    trendline(m.chart);
    m.chart.addDrawing({ name: 'hline', points: [{ index: 0, price: 90 }] });
    m.chart.addIndicator({ name: 'rsi' });
    m.chart.addIndicator({ name: 'ema' });
    m.rightClick(400, 20);
    m.item('Remove all drawings').click();
    assert.equal(m.chart.getConfig().drawings.length, 0);
    m.menu.controller.undo();
    assert.equal(m.chart.getConfig().drawings.length, 2);
    m.rightClick(400, 20);
    m.item('Remove all indicators').click();
    assert.equal(m.chart.getConfig().indicators.length, 0);
  });

  it('does nothing when the target vanished while the menu was open', () => {
    const actions: ContextMenuAction[] = [];
    const m = mount({ onAction: (action) => actions.push(action) });
    const d = trendline(m.chart);
    const s = sma(m.chart);
    m.rightClick(d.x, d.y);
    m.chart.removeDrawing(d.id);
    m.item('Clone').click();
    assert.equal(m.chart.getConfig().drawings.length, 0);
    assert.ok(!m.isOpen());
    m.rightClick(s.x, s.y);
    m.chart.removeIndicator(s.id);
    m.item('Hide').click();
    assert.equal(m.chart.getConfig().indicators.length, 0);
    assert.deepEqual(actions, []);
  });

  it('opens on drawings without selecting them while all drawings are locked', () => {
    const m = mount();
    const shared = new DrawingController(m.chart);
    const locked = createChartContextMenu({ chart: m.chart, document: m.udoc, canvas: m.ucanvas, controller: shared, listen: false });
    assert.equal(locked.controller, shared);
    // Without one, each menu gets a private controller of its own.
    assert.ok(m.menu.controller instanceof DrawingController);
    assert.notEqual(m.menu.controller, shared);
    const d = trendline(m.chart);
    shared.setLocked(true);
    assert.equal(locked.open(d.x, d.y).kind, 'drawing');
    assert.equal(m.chart.selectedDrawing, null);
    locked.destroy();
  });
});

describe('context menu input precedence', () => {
  it('cancels an armed tool instead of opening (standalone)', () => {
    const p = page();
    const controller = new DrawingController(p.chart);
    const menu = createChartContextMenu({ chart: p.chart, document: p.udoc, canvas: p.ucanvas, controller });
    controller.arm('trendline');
    const e = p.rightClick(400, 20);
    assert.equal(e.defaultPrevented, true);
    assert.equal(controller.tool, null);
    assert.equal(menu.target, null);
    p.rightClick(400, 20);
    assert.equal(kindOf(menu), 'chart');
  });

  it('leaves events another handler took and finger presses alone', () => {
    const p = page();
    p.canvas.addEventListener('contextmenu', (e) => { if ((e as unknown as { clientX: number }).clientX === 1) e.preventDefault(); });
    const menu = createChartContextMenu({ chart: p.chart, document: p.udoc, canvas: p.ucanvas });
    p.rightClick(1, 20);
    assert.equal(menu.target, null);
    const touch = p.rightClick(400, 20, { pointerType: 'touch' });
    assert.equal(touch.defaultPrevented, false);
    assert.equal(menu.target, null);
    // A pen's barrel button right-clicks like a mouse.
    p.rightClick(400, 20, { pointerType: 'pen' });
    assert.equal(kindOf(menu), 'chart');
  });

  it('stays out of touch: the gestures swallow the compat contextmenu after a finger press', () => {
    const p = page();
    const gestures = attachTouchGestures({ chart: p.chart, canvas: p.ucanvas, document: p.udoc, scheduler: new TestFrames() });
    const menu = createChartContextMenu({ chart: p.chart, document: p.udoc, canvas: p.ucanvas });
    p.canvas.dispatchEvent(new p.win.PointerEvent('pointerdown', { clientX: 300, clientY: 200, pointerId: 1, pointerType: 'touch', bubbles: true, cancelable: true }));
    const compat = new p.win.MouseEvent('contextmenu', { clientX: 300, clientY: 200, bubbles: true, cancelable: true });
    p.canvas.dispatchEvent(compat);
    assert.equal(compat.defaultPrevented, true);
    assert.equal(menu.target, null);
    gestures.destroy();
  });

  it('reads a compat contextmenu by the press before it, whichever listener runs first', () => {
    const p = page();
    // Created before the gestures, so it sees the compat event before they swallow it.
    const menu = createChartContextMenu({ chart: p.chart, document: p.udoc, canvas: p.ucanvas });
    const gestures = attachTouchGestures({ chart: p.chart, canvas: p.ucanvas, document: p.udoc, scheduler: new TestFrames() });
    p.press('touch');
    assert.equal(p.compat().defaultPrevented, true, 'the gestures still swallow it');
    assert.equal(menu.target, null);
    gestures.destroy();
    // No gestures at all: still no menu after a finger press, and the browser keeps the event.
    p.press('touch');
    assert.equal(p.compat().defaultPrevented, false);
    assert.equal(menu.target, null);
    // A mouse press, or none at all, right-clicks as usual.
    p.press('mouse');
    assert.equal(p.compat().defaultPrevented, true);
    assert.deepEqual(menu.target, { kind: 'chart', x: 300, y: 200 });
    menu.close();
    const fresh = page();
    const other = createChartContextMenu({ chart: fresh.chart, document: fresh.udoc, canvas: fresh.ucanvas });
    fresh.compat();
    assert.equal(kindOf(other), 'chart');
  });

  it('with listen: false only opens on demand', () => {
    const m = mount({ listen: false });
    const e = m.rightClick(400, 20);
    assert.equal(e.defaultPrevented, false);
    assert.ok(!m.isOpen());
    assert.equal(m.menu.open(400, 20).kind, 'chart');
    assert.ok(m.isOpen());
    m.menu.destroy();
  });
});

describe('context menu placement', () => {
  function sized(width: number, height: number, extra: MenuExtra = {}) {
    const m = mount(extra);
    Object.defineProperties(m.root, { offsetWidth: { value: width }, offsetHeight: { value: height } });
    (m.canvas as unknown as { getBoundingClientRect(): unknown }).getBoundingClientRect = () =>
      ({ left: 100, top: 50, right: 900, bottom: 550, width: 800, height: 500 });
    return m;
  }

  it('opens at the pointer in viewport coordinates', () => {
    const m = sized(200, 300);
    m.rightClick(150, 110); // canvas-local (50, 60)
    assert.deepEqual(m.menu.target, { kind: 'chart', x: 50, y: 60 });
    assert.equal(m.root.style.left, '150px');
    assert.equal(m.root.style.top, '110px');
  });

  it('flips left and up at the viewport edges and clamps oversized menus', () => {
    const m = sized(200, 300);
    m.menu.open(700, 450); // viewport (800, 500): room right, not below
    assert.equal(m.root.style.left, '800px');
    assert.equal(m.root.style.top, '200px');
    m.menu.open(950, 100); // viewport (1050, 150): flips left
    assert.equal(m.root.style.left, '850px');
    assert.equal(m.root.style.top, '150px');
    const tall = sized(200, 900);
    tall.menu.open(10, 10);
    assert.equal(tall.root.style.top, '8px');
    const wide = sized(1300, 100);
    wide.menu.open(10, 10);
    assert.equal(wide.root.style.left, '8px');
  });

  it('only flips vertically when the window has no width', () => {
    const m = sized(200, 300);
    Object.defineProperty(m.win, 'innerWidth', { value: undefined, configurable: true });
    m.menu.open(1050, 700);
    assert.equal(m.root.style.left, '1150px');
    assert.equal(m.root.style.top, '450px');
  });
});

describe('context menu keyboard and dismissal', () => {
  it('moves focus with the arrows, Home and End, and keeps keys from the page', () => {
    const m = mount();
    const docKeys: string[] = [];
    m.doc.addEventListener('keydown', (e) => docKeys.push((e as unknown as { key: string }).key));
    m.rightClick(400, 20);
    assert.equal(m.doc.activeElement, m.root);
    const rows = m.rows();
    const focused = () => rows.indexOf(m.doc.activeElement as unknown as HTMLElement);
    assert.equal(m.key('ArrowUp').defaultPrevented, true);
    assert.equal(focused(), rows.length - 1, 'up from the menu lands on the last row');
    m.key('ArrowDown');
    assert.equal(focused(), 0, 'wraps to the top');
    m.key('ArrowDown', rows[0]!);
    assert.equal(focused(), 1);
    m.key('ArrowUp', rows[1]!);
    assert.equal(focused(), 0);
    m.key('ArrowUp', rows[0]!);
    assert.equal(focused(), rows.length - 1, 'wraps to the bottom');
    m.key('Home', rows[rows.length - 1]!);
    assert.equal(focused(), 0);
    m.key('End');
    assert.equal(focused(), rows.length - 1);
    const other = m.key('x');
    assert.equal(other.defaultPrevented, false);
    assert.deepEqual(docKeys, [], 'keys inside the menu never reach document shortcuts');
    assert.ok(m.isOpen());
    // Reopening starts over from the menu itself.
    m.rightClick(400, 30);
    m.key('ArrowDown');
    assert.equal(m.doc.activeElement, m.rows()[0]);
  });

  it('closes on Escape (focus back to the canvas) and Tab', () => {
    const m = mount();
    m.canvas.setAttribute('tabindex', '0');
    m.rightClick(400, 20);
    assert.equal(m.key('Escape').defaultPrevented, true);
    assert.ok(!m.isOpen());
    assert.equal(m.menu.target, null);
    assert.equal(m.doc.activeElement, m.canvas);
    m.rightClick(400, 20);
    assert.equal(m.key('Tab').defaultPrevented, false);
    assert.ok(!m.isOpen());
  });

  it('closes on outside presses, document Escape, resize, blur, page scroll and wheel', () => {
    const m = mount();
    const reopen = () => {
      m.rightClick(400, 20);
      assert.ok(m.isOpen());
    };
    reopen();
    m.root.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true }));
    assert.ok(m.isOpen(), 'a press inside keeps it open');
    m.root.dispatchEvent(new m.win.Event('scroll'));
    assert.ok(m.isOpen(), 'scrolling the menu itself keeps it open');
    m.doc.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'a' }));
    assert.ok(m.isOpen());
    m.doc.body.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true }));
    assert.ok(!m.isOpen(), 'outside press');
    reopen();
    m.doc.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'Escape' }));
    assert.ok(!m.isOpen(), 'document Escape');
    reopen();
    m.win.dispatchEvent(new m.win.Event('resize'));
    assert.ok(!m.isOpen(), 'resize');
    reopen();
    m.win.dispatchEvent(new m.win.Event('blur'));
    assert.ok(!m.isOpen(), 'blur');
    reopen();
    m.stage.dispatchEvent(new m.win.Event('scroll'));
    assert.ok(!m.isOpen(), 'page scroll');
    reopen();
    m.canvas.dispatchEvent(new m.win.WheelEvent('wheel', { deltaY: 10, bubbles: true }));
    assert.ok(!m.isOpen(), 'wheel');
  });

  it('attaches its dismissal listeners once per open and removes them on close', () => {
    const m = mount();
    const live = new Map<string, number>();
    const doc = m.doc as unknown as { addEventListener: (...a: unknown[]) => void; removeEventListener: (...a: unknown[]) => void };
    const add = doc.addEventListener.bind(doc);
    const remove = doc.removeEventListener.bind(doc);
    doc.addEventListener = (type: unknown, ...rest: unknown[]) => { live.set(type as string, (live.get(type as string) ?? 0) + 1); add(type, ...rest); };
    doc.removeEventListener = (type: unknown, ...rest: unknown[]) => { live.set(type as string, (live.get(type as string) ?? 0) - 1); remove(type, ...rest); };
    m.rightClick(400, 20);
    m.rightClick(420, 40); // re-targets the open menu
    assert.deepEqual(m.menu.target, { kind: 'chart', x: 420, y: 40 });
    assert.equal(live.get('pointerdown'), 1);
    assert.equal(live.get('keydown'), 1);
    m.menu.close();
    m.menu.close();
    assert.equal(live.get('pointerdown'), 0);
    assert.equal(live.get('keydown'), 0);
  });

  it('hands focus back to what had it before opening once an action runs', () => {
    const m = mount();
    const host = m.doc.createElement('button');
    m.doc.body.append(host);
    host.focus();
    m.rightClick(400, 20);
    focusedOn(m, m.root);
    m.key('ArrowDown');
    const row = m.item('Reset chart view');
    focusedOn(m, row);
    row.click();
    assert.ok(!m.isOpen());
    focusedOn(m, host, 'focus leaves the hidden row');
    // Re-targeting an open menu keeps the original return point.
    m.rightClick(400, 20);
    m.rightClick(420, 40);
    m.key('Escape');
    focusedOn(m, host);
  });

  it('falls back to the canvas and never steals focus that moved on', () => {
    const m = mount();
    m.canvas.setAttribute('tabindex', '0');
    const host = m.doc.createElement('button');
    m.doc.body.append(host);
    // No document focus to return to: the canvas takes it.
    Object.defineProperty(m.doc, 'activeElement', { configurable: true, get: () => null });
    m.rightClick(400, 20);
    delete (m.doc as unknown as { activeElement?: unknown }).activeElement;
    m.menu.close();
    focusedOn(m, m.canvas);
    // Focus stranded inside the closed menu is not a return point.
    m.rows()[0]!.focus();
    m.rightClick(400, 20);
    m.key('Escape');
    focusedOn(m, m.canvas);
    // Focus the host moved elsewhere while the menu was open stays there.
    m.rightClick(400, 20);
    host.focus();
    m.doc.body.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true }));
    assert.ok(!m.isOpen());
    focusedOn(m, host);
  });

  it('styles the menu fill-only, with keyboard focus shifting the fill', () => {
    assert.match(TOOLBAR_CSS, /\.cts-context-menu \{ border: 0; \}/);
    assert.match(TOOLBAR_CSS, /\.cts-context-menu \.cts-item:focus-visible \{[^}]*outline: none;[^}]*background: var\(--cts-accent-soft\)/);
  });

  it('suppresses the browser menu on the menu itself', () => {
    const m = mount();
    m.rightClick(400, 20);
    const e = new m.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    m.item('Percent').dispatchEvent(e);
    assert.equal(e.defaultPrevented, true);
  });
});

describe('context menu theme, flyouts and teardown', () => {
  it('owns a dark portal by default and switches themes', () => {
    const m = mount();
    const portal = m.root.parentElement as HTMLElement;
    assert.equal(portal.parentElement, m.doc.body);
    assert.ok(!portal.classList.contains('cts-light'));
    m.menu.setTheme('light');
    assert.ok(portal.classList.contains('cts-light'));
    m.menu.setTheme('dark');
    assert.ok(!portal.classList.contains('cts-light'));
    const light = mount({ theme: 'light' });
    assert.ok((light.root.parentElement as HTMLElement).classList.contains('cts-light'));
  });

  it('shares the flyouts portal and closes an open flyout', () => {
    const p = page();
    const portal = p.doc.createElement('div');
    portal.className = 'cts-theme';
    p.doc.body.append(portal);
    const flyouts = new Flyouts(p.udoc, portal as unknown as UIElement);
    const flyout = flyouts.create();
    flyouts.show(flyout, p.ucanvas);
    assert.equal(flyouts.open, flyout);
    const menu = createChartContextMenu({ chart: p.chart, document: p.udoc, canvas: p.ucanvas, flyouts, theme: 'light' });
    assert.equal((menu.element as unknown as HTMLElement).parentElement, portal);
    assert.ok(portal.classList.contains('cts-light'));
    p.rightClick(400, 20);
    assert.equal(flyouts.open, null);
    menu.destroy();
    assert.equal(portal.parentElement, p.doc.body, 'a shared portal stays');
    assert.equal(portal.querySelector('.cts-context-menu'), null);
  });

  it('destroy removes the menu, its portal and every listener', () => {
    const m = mount();
    m.rightClick(400, 20);
    const portal = m.root.parentElement as HTMLElement;
    m.menu.destroy();
    assert.ok(!m.isOpen());
    assert.equal(portal.parentElement, null);
    assert.equal(m.doc.querySelector('.cts-context-menu'), null);
    const e = m.rightClick(400, 20);
    assert.equal(e.defaultPrevented, false);
    assert.equal(m.menu.target, null);
  });

  it('destroy disposes the controller it created, and only that one', () => {
    const p = page();
    /** Data-load listeners on the chart. */
    const listeners = () => (p.chart as unknown as { events: { dataLoad: { size: number } } }).events.dataLoad.size;
    const base = listeners();
    const menus: ChartContextMenu[] = [];
    for (let i = 0; i < 25; i++) {
      const menu = createChartContextMenu({ chart: p.chart, document: p.udoc, canvas: p.ucanvas });
      menus.push(menu);
      menu.destroy();
    }
    assert.equal(listeners(), base, 'create/destroy cycles leak no chart listeners');
    const discarded = menus[0]!.controller;
    discarded.points = [{ index: 5, price: 100 }];

    // A controller the host passed stays the host's: the menu leaves it following the chart.
    const shared = new DrawingController(p.chart, { navigation: false });
    shared.points = [{ index: 5, price: 100 }];
    const owned = listeners();
    createChartContextMenu({ chart: p.chart, document: p.udoc, canvas: p.ucanvas, controller: shared }).destroy();
    assert.equal(listeners(), owned);
    const older = DATA.slice(0, 20).map((c) => ({ ...c, time: c.time - 20 * 3600 }));
    assert.equal(p.chart.prependData(older), 20);
    assert.deepEqual(shared.points, [{ index: 25, price: 100 }], 'the shared controller still follows prepends');
    assert.deepEqual(discarded.points, [{ index: 5, price: 100 }], 'a destroyed menu\'s controller no longer runs');
    shared.dispose();
    assert.equal(listeners(), base);
  });
});

describe('drawing toolbar contextMenu option', () => {
  type Extra = Partial<Omit<DrawingToolbarOptions, 'chart' | 'document' | 'canvas' | 'rail' | 'overlay'>>;
  function toolbar(extra: Extra = {}, before: (p: ReturnType<typeof page>) => void = () => {}) {
    const p = page();
    before(p);
    const rail = p.doc.createElement('div');
    p.doc.body.append(rail);
    const tb = createDrawingToolbar({
      chart: p.chart, document: p.udoc, canvas: p.ucanvas, rail: rail as unknown as UIElement,
      overlay: p.stage as unknown as UIElement, scheduler: new TestFrames(), ...extra,
    });
    return { ...p, tb };
  }

  it('is off by default: right-clicks only cancel an armed tool', () => {
    for (const extra of [{}, { contextMenu: false }]) {
      const t = toolbar(extra);
      assert.equal(t.tb.contextMenu, null);
      const idle = t.rightClick(400, 20);
      assert.equal(idle.defaultPrevented, false);
      assert.equal(t.doc.querySelector('.cts-context-menu'), null);
    }
  });

  it('opens after an armed tool had its right-click, in the toolbar portal', () => {
    const t = toolbar({ contextMenu: true });
    const menu = t.tb.contextMenu!;
    assert.equal(menu.controller, t.tb.controller);
    t.tb.controller.arm('trendline');
    const cancel = t.rightClick(400, 20);
    assert.equal(cancel.defaultPrevented, true);
    assert.equal(t.tb.controller.tool, null);
    assert.equal(menu.target, null);
    const open = t.rightClick(400, 20);
    assert.equal(open.defaultPrevented, true);
    assert.equal(kindOf(menu), 'chart');
    // Themed with the toolbar.
    const portal = (menu.element as unknown as HTMLElement).parentElement as HTMLElement;
    assert.equal(portal, t.tb.flyouts.portal as unknown as HTMLElement);
    t.tb.setTheme('light');
    assert.ok(portal.classList.contains('cts-light'));
    // Drawing actions share the toolbar's undo history.
    const d = trendline(t.chart);
    t.rightClick(d.x, d.y);
    assert.equal(t.chart.selectedDrawing, d.id);
    const remove = [...(menu.element as unknown as HTMLElement).querySelectorAll('.cts-item')]
      .find((row) => row.textContent === 'Remove') as unknown as HTMLElement;
    remove.click();
    assert.equal(t.chart.getDrawing(d.id), undefined);
    t.tb.controller.undo();
    assert.ok(t.chart.getDrawing(d.id));
    t.tb.destroy();
    assert.equal(t.doc.querySelector('.cts-context-menu'), null);
  });

  it('passes hooks through and refreshes the viewport after actions', () => {
    const calls: string[] = [];
    const t = toolbar({
      contextMenu: {
        onChartSettings: () => calls.push('settings'),
        onAction: (action) => calls.push(action),
      },
    });
    const menu = t.tb.contextMenu!;
    const click = (label: string) => {
      t.rightClick(400, 20);
      ([...(menu.element as unknown as HTMLElement).querySelectorAll('.cts-item')]
        .find((row) => row.querySelector('.cts-item-label')!.textContent === label) as unknown as HTMLElement).click();
    };
    // Zoomed far out the scroll arrows show; resetting the view hides them again.
    t.chart.scale.zoom(0.25);
    t.tb.refreshViewport();
    t.chart.scale.scrollBy(40);
    t.tb.refreshViewport();
    const arrows = () => [...t.doc.querySelectorAll('.cts-scroll.cts-visible')].length;
    assert.ok(arrows() > 0);
    click('Reset chart view');
    assert.equal(arrows(), 0);
    click('Chart settings…');
    assert.deepEqual(calls, ['reset-view', 'settings', 'chart-settings']);
    // With no hooks the menu still reports nothing and works.
    const bare = toolbar({ contextMenu: true });
    bare.rightClick(400, 20);
    assert.equal(kindOf(bare.tb.contextMenu!), 'chart');
  });

  it('never opens from a finger press', () => {
    const t = toolbar({ contextMenu: true });
    t.canvas.dispatchEvent(new t.win.PointerEvent('pointerdown', { clientX: 300, clientY: 200, pointerId: 1, pointerType: 'touch', bubbles: true, cancelable: true }));
    const compat = new t.win.MouseEvent('contextmenu', { clientX: 300, clientY: 200, bubbles: true, cancelable: true });
    t.canvas.dispatchEvent(compat);
    assert.equal(compat.defaultPrevented, true);
    assert.equal(t.tb.contextMenu!.target, null);
  });

  it('never opens from a finger press with navigation off, with or without host gestures', () => {
    const gestures = (p: ReturnType<typeof page>) =>
      attachTouchGestures({ chart: p.chart, canvas: p.ucanvas, document: p.udoc, scheduler: new TestFrames() });
    // The toolbar's own router ignores fingers here, so only the menu's own check stands in the way.
    const bare = toolbar({ navigation: false, contextMenu: true });
    const menu = bare.tb.contextMenu!;
    assert.equal(bare.rightClick(300, 200, { pointerType: 'touch' }).defaultPrevented, false);
    assert.equal(menu.target, null);
    bare.press('touch');
    assert.equal(bare.rightClick(300, 200, { pointerType: 'touch' }).defaultPrevented, false);
    bare.press('touch');
    assert.equal(bare.compat().defaultPrevented, false);
    assert.equal(menu.target, null);
    // Host gestures attached before or after the toolbar swallow the compat event; no menu either way.
    let late: ReturnType<typeof gestures> | undefined;
    const first = toolbar({ navigation: false, contextMenu: true }, (p) => { late = gestures(p); });
    const second = toolbar({ navigation: false, contextMenu: true });
    const after = gestures(second);
    for (const t of [first, second]) {
      t.press('touch');
      assert.equal(t.compat().defaultPrevented, true);
      assert.equal(t.tb.contextMenu!.target, null);
      t.press('touch');
      assert.equal(t.rightClick(300, 200, { pointerType: 'touch' }).defaultPrevented, true);
      assert.equal(t.tb.contextMenu!.target, null);
      // The mouse still gets its menu.
      t.press('mouse');
      t.rightClick(300, 200);
      assert.equal(kindOf(t.tb.contextMenu!), 'chart');
    }
    late!.destroy();
    after.destroy();
  });

  it('opens one menu when a standalone menu shares the canvas, in either order', () => {
    const openMenus = (t: { doc: { querySelectorAll(s: string): { length: number } } }) =>
      t.doc.querySelectorAll('.cts-context-menu.cts-open').length;
    let standalone: ChartContextMenu | undefined;
    const before = toolbar({ contextMenu: true }, (p) => {
      standalone = createChartContextMenu({ chart: p.chart, document: p.udoc, canvas: p.ucanvas });
    });
    before.rightClick(400, 20);
    assert.equal(openMenus(before), 1);
    assert.equal(kindOf(standalone!), 'chart');
    assert.equal(before.tb.contextMenu!.target, null);
    const t = toolbar({ contextMenu: true });
    const late = createChartContextMenu({ chart: t.chart, document: t.udoc, canvas: t.ucanvas, controller: t.tb.controller });
    t.rightClick(400, 20);
    assert.equal(openMenus(t), 1);
    assert.equal(kindOf(t.tb.contextMenu!), 'chart');
    assert.equal(late.target, null);
    // An armed tool still just cancels, with no menu from either.
    t.tb.contextMenu!.close();
    t.tb.controller.arm('trendline');
    assert.equal(t.rightClick(400, 20).defaultPrevented, true);
    assert.equal(t.tb.controller.tool, null);
    assert.equal(openMenus(t), 0);
  });

  it('commits the text editor before selecting the drawing it opens on', () => {
    const t = toolbar({ contextMenu: true });
    const d = trendline(t.chart);
    const note = t.chart.addDrawing({ name: 'note', points: [{ index: 60, price: 100 }] });
    const nx = t.chart.scale.indexToX(60);
    const ny = t.chart.scale.priceToY(100);
    assert.equal(t.chart.drawingAt(nx, ny), note);
    t.tb.controller.doubleClick(nx, ny);
    const editor = t.doc.querySelector('.cts-editor') as unknown as HTMLTextAreaElementLike;
    assert.equal(editor.style.display, 'block');
    editor.value = 'Breakout';
    t.rightClick(d.x, d.y);
    assert.equal(editor.style.display, 'none');
    assert.equal(t.chart.getDrawing(note)!.text, 'Breakout');
    assert.deepEqual(t.tb.contextMenu!.target, { kind: 'drawing', id: d.id, x: d.x, y: d.y });
    assert.equal(t.chart.selectedDrawing, d.id, 'the menu acts on the drawing it shows as selected');
  });
});

type HTMLTextAreaElementLike = { value: string; style: { display: string } };
