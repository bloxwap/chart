import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import type { HTMLElement, HTMLInputElement, HTMLTextAreaElement } from 'happy-dom';
import { createChart, TOOL_GROUPS, type FrameScheduler } from '../dist/index.js';
import { MockDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import {
  createDrawingToolbar,
  attachScrollableRail,
  DEFAULT_FAVORITES,
  FAVORITES_KEY,
  Flyouts,
  HOVER_CLOSE_MS,
  HOVER_OPEN_MS,
  icon,
  iconButton,
  injectStyles,
  labelButton,
  menuItem,
  requireWindow,
  setButtonIcon,
  setButtonLabel,
  STYLE_MARKER,
  targetWithin,
  ZOOM_TOOL,
  type DrawingToolbarOptions,
  type UIDocument,
  type UIElement,
  type UIEvent,
} from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => {
  for (const w of windows) void w.happyDOM.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function candles(n: number): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 100 + Math.sin(i / 5) * 10;
    return { time: 1700000000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
  });
}

class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

class TestFrames implements FrameScheduler {
  time = 0;
  seq = 0;
  callbacks = new Map<number, (time: number) => void>();
  now = () => this.time;
  request = (callback: (time: number) => void) => { const id = ++this.seq; this.callbacks.set(id, callback); return id; };
  cancel = (id: number) => { this.callbacks.delete(id); };
  tick(ms = 16) {
    this.time += ms;
    for (const [id, callback] of [...this.callbacks]) if (this.callbacks.delete(id)) callback(this.time);
  }
}

type Extra = Partial<Omit<DrawingToolbarOptions, 'chart' | 'document' | 'canvas' | 'rail' | 'overlay'>>;

function mount(extra: Extra = {}, before?: (win: Window) => void, nativeFrames = false) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  before?.(win);
  const doc = win.document;
  const rail = doc.createElement('div');
  const stage = doc.createElement('div');
  const canvas = doc.createElement('div');
  Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 500 } });
  stage.append(canvas);
  doc.body.append(rail, stage);
  const chart = createChart({ document: new MockDocument(), config: { wasm: false, data: candles(200) } });
  const storage = new MemoryStorage();
  const frames = new TestFrames();
  const tb = createDrawingToolbar({
    chart,
    document: doc as unknown as UIDocument,
    canvas: canvas as unknown as UIElement,
    rail: rail as unknown as UIElement,
    overlay: stage as unknown as UIElement,
    storage,
    ...(nativeFrames ? {} : { scheduler: frames }),
    ...extra,
  });
  const q = <T = HTMLElement>(sel: string, root: { querySelector(s: string): unknown } = doc) => root.querySelector(sel) as T;
  const qa = (sel: string) => [...doc.querySelectorAll(sel)] as unknown as HTMLElement[];
  const pointer = (type: string, x: number, y: number, init: Record<string, unknown> = {}) =>
    canvas.dispatchEvent(new win.PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerType: 'mouse', bubbles: true, cancelable: true, ...init }));
  const clickAt = (x: number, y: number) => {
    pointer('pointermove', x, y);
    pointer('pointerdown', x, y);
    pointer('pointerup', x, y);
  };
  const at = (i: number, p: number): [number, number] => [chart.scale.indexToX(i), chart.scale.priceToY(p)];
  const item = (label: string) => qa('.cts-item').find((el) => el.querySelector('.cts-item-label')?.textContent === label)!;
  const key = (k: string, init: Record<string, unknown> = {}) => {
    const e = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    doc.dispatchEvent(e);
    return e;
  };
  return { frames, win, doc, rail, stage, canvas, chart, storage, tb, c: tb.controller, q, qa, pointer, clickAt, at, item, key };
}

describe('toolbar structure', () => {
  it('renders the rail, one flyout per group, and injects styles once', () => {
    const m = mount();
    assert.equal(m.qa('.cts-group').length, 12);
    assert.ok(m.qa('.cts-menu').length >= 12);
    assert.equal(m.qa(`style[${STYLE_MARKER}]`).length, 1);
    injectStyles(m.doc as unknown as UIDocument);
    assert.equal(m.qa(`style[${STYLE_MARKER}]`).length, 1);
    // Every catalog tool is a menu item with a favorite star.
    assert.equal(m.qa('.cts-item .cts-fav').length, TOOL_GROUPS.filter((g) => g.id !== 'icons').flatMap((g) => g.sections.flatMap((s) => s.tools)).length);
    assert.equal(m.q('.cts-overlay').parentElement, m.stage);
  });
  it('switches theme on the UI and the chart', () => {
    const m = mount({ theme: 'light' });
    assert.ok(m.q('.cts-rail').classList.contains('cts-light'));
    assert.equal(m.chart.getConfig().theme.background, '#ffffff');
    m.tb.setTheme('dark');
    assert.ok(!m.q('.cts-rail').classList.contains('cts-light'));
    assert.equal(m.chart.getConfig().theme.background, '#131722');
    // applyChartTheme: false leaves the chart's own colors alone.
    const keep = mount({ applyChartTheme: false });
    const bg = keep.chart.getConfig().theme.background;
    keep.tb.setTheme('dark');
    assert.equal(keep.chart.getConfig().theme.background, bg);
    assert.notEqual(bg, '#131722');
  });
  it('requires a window for timers', () => {
    const doc = { defaultView: null } as unknown as UIDocument;
    assert.throws(() => requireWindow(doc), /no window/);
  });
  it('destroy removes all DOM', () => {
    const m = mount();
    m.tb.destroy();
    assert.equal(m.qa('.cts-rail').length, 0);
    assert.equal(m.qa('.cts-menu').length, 0);
    assert.equal(m.qa('.cts-overlay').length, 0);
  });
});

describe('rail interactions', () => {
  it('menu items arm tools, update the group button, and close the menu', () => {
    const m = mount();
    const groups = m.qa('.cts-group');
    const lines = groups[1]!;
    (lines.querySelector('.cts-more') as HTMLElement).click();
    assert.ok(m.qa('.cts-menu.cts-open').length === 1);
    m.item('Pitchfork').click();
    assert.equal(m.c.tool, 'pitchfork');
    assert.equal(m.qa('.cts-menu.cts-open').length, 0);
    const main = lines.querySelector('.cts-btn') as HTMLElement;
    assert.ok(main.classList.contains('cts-armed'));
    assert.equal(main.title, 'Pitchfork');
    assert.ok(m.item('Pitchfork').classList.contains('cts-active'));
    main.click(); // re-arming toggles off
    assert.equal(m.c.tool, null);
    main.click();
    assert.equal(m.c.tool, 'pitchfork');
    assert.ok(m.canvas.classList.contains('cts-mode-tool'));
  });
  it('the chevron toggles, right-click opens, outside clicks close', () => {
    const m = mount();
    const group = m.qa('.cts-group')[2]!;
    const more = group.querySelector('.cts-more') as HTMLElement;
    more.click();
    assert.equal(m.qa('.cts-menu.cts-open').length, 1);
    more.click();
    assert.equal(m.qa('.cts-menu.cts-open').length, 0);
    (group.querySelector('.cts-btn') as HTMLElement).dispatchEvent(new m.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    assert.equal(m.qa('.cts-menu.cts-open').length, 1);
    m.doc.body.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true }));
    assert.equal(m.qa('.cts-menu.cts-open').length, 0);
  });
  it('hovering a group opens its menu; leaving closes it; touch is ignored', async () => {
    const m = mount();
    const group = m.qa('.cts-group')[3]!;
    const menuOpen = () => m.qa('.cts-menu.cts-open').length;
    group.dispatchEvent(new m.win.PointerEvent('pointerenter', { pointerType: 'touch' }));
    await sleep(HOVER_OPEN_MS + 40);
    assert.equal(menuOpen(), 0);
    group.dispatchEvent(new m.win.PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await sleep(HOVER_OPEN_MS + 40);
    assert.equal(menuOpen(), 1);
    const menu = m.q('.cts-menu.cts-open');
    group.dispatchEvent(new m.win.PointerEvent('pointerleave', { pointerType: 'mouse' }));
    menu.dispatchEvent(new m.win.PointerEvent('pointerenter', { pointerType: 'mouse' }));
    await sleep(HOVER_CLOSE_MS + 40);
    assert.equal(menuOpen(), 1, 'moving into the menu keeps it open');
    menu.dispatchEvent(new m.win.PointerEvent('pointerleave', { pointerType: 'touch' }));
    menu.dispatchEvent(new m.win.PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await sleep(HOVER_CLOSE_MS + 40);
    assert.equal(menuOpen(), 0);
    group.dispatchEvent(new m.win.PointerEvent('pointerleave', { pointerType: 'mouse' }));
    await sleep(HOVER_CLOSE_MS + 40);
  });
  it('cursor modes, measure, zoom and picker', () => {
    const m = mount();
    m.item('Dot').click();
    assert.equal(m.c.cursor, 'dot');
    assert.ok(m.canvas.classList.contains('cts-cursor-dot'));
    assert.ok(m.item('Dot').classList.contains('cts-active'));
    (m.qa('.cts-group')[0]!.querySelector('.cts-btn') as HTMLElement).click();
    assert.equal(m.c.cursor, 'dot');
    const measure = m.qa('.cts-rail-scroll > .cts-btn').find((b) => b.title.startsWith('Measure'))!;
    measure.click();
    assert.equal(m.c.tool, 'date-price-range');
    assert.ok(measure.classList.contains('cts-armed'));
    m.item('Zoom in (drag a range)').click();
    assert.equal(m.c.tool, ZOOM_TOOL);
    const span = m.chart.scale.visibleRange();
    m.item('Zoom out').click();
    m.frames.tick(600);
    assert.notDeepEqual(m.chart.scale.visibleRange(), span);
    (m.qa('.cts-group')[8]!.querySelector('.cts-btn') as HTMLElement).click();
    assert.equal(m.c.tool, ZOOM_TOOL);
    // Picker: tabs and glyphs.
    const tabs = m.qa('.cts-tab');
    tabs[1]!.click();
    assert.ok(m.qa('.cts-tab')[1]!.classList.contains('cts-active'));
    (m.q('.cts-glyph') as HTMLElement).click();
    assert.equal(m.c.tool, 'sticker');
    assert.equal(m.c.pendingText, '🚀');
    m.c.disarm();
    (m.qa('.cts-group')[7]!.querySelector('.cts-btn') as HTMLElement).click();
    assert.equal(m.c.tool, 'sticker');
  });
  it('magnet, stay, lock, hide and remove controls', () => {
    const m = mount();
    const main = (i: number) => m.qa('.cts-group')[i]!.querySelector('.cts-btn') as HTMLElement;
    main(9).click();
    assert.equal(m.c.magnet, 'weak');
    main(9).click();
    assert.equal(m.c.magnet, 'off');
    m.item('Strong magnet').click();
    assert.equal(m.c.magnet, 'strong');
    m.item('Strong magnet').click();
    assert.equal(m.c.magnet, 'off');
    main(9).click();
    assert.equal(m.c.magnet, 'strong', 'the main button reuses the last mode');
    m.item('Weak magnet').click();
    m.item('Weak magnet').click();
    const btn = (title: string) => m.qa('.cts-rail-scroll > .cts-btn').find((b) => b.title.startsWith(title))!;
    btn('Stay in drawing mode').click();
    assert.equal(m.c.stay, true);
    btn('Lock all drawings').click();
    assert.equal(m.c.locked, true);
    btn('Unlock all drawings').click();
    assert.equal(m.c.locked, false);
    m.chart.addIndicator({ name: 'sma' });
    main(10).click();
    assert.equal(m.c.drawingsHidden, true);
    m.item('Hide indicators').click();
    assert.equal(m.c.indicatorsHidden, true);
    m.item('Hide all').click();
    assert.equal(m.c.drawingsHidden, false);
    m.item('Hide all').click();
    assert.equal(m.c.drawingsHidden && m.c.indicatorsHidden, true);
    m.item('Hide drawings').click();
    assert.equal(m.c.drawingsHidden, false);
    m.chart.addDrawing({ name: 'hline', points: [{ index: 1, price: 100 }] });
    main(11).click();
    assert.equal(m.chart.getConfig().drawings.length, 0);
    m.chart.addDrawing({ name: 'hline', points: [{ index: 1, price: 100 }] });
    m.item('Remove drawings').click();
    m.item('Remove indicators').click();
    assert.equal(m.chart.getConfig().indicators.length, 0);
    m.chart.addDrawing({ name: 'hline', points: [{ index: 1, price: 100 }] });
    m.chart.addIndicator({ name: 'sma' });
    m.item('Remove drawings and indicators').click();
    assert.equal(m.chart.getConfig().drawings.length + m.chart.getConfig().indicators.length, 0);
  });
});

describe('favorites', () => {
  it('toggles stars, persists, and arms from the bar', () => {
    const m = mount();
    const bar = m.q('.cts-favorites');
    assert.equal(bar.querySelectorAll('.cts-btn').length, DEFAULT_FAVORITES.length);
    const star = m.item('Ray').querySelector('.cts-fav') as HTMLElement;
    star.click();
    assert.ok(star.classList.contains('cts-on'));
    assert.ok(JSON.parse(m.storage.getItem(FAVORITES_KEY)!).includes('ray'));
    (m.item('Ray').querySelector('.cts-fav') as HTMLElement).click();
    assert.ok(!JSON.parse(m.storage.getItem(FAVORITES_KEY)!).includes('ray'));
    const favBtn = m.qa('.cts-rail-scroll > .cts-btn').find((b) => b.title === 'Show favorite tools')!;
    favBtn.click();
    assert.ok(bar.classList.contains('cts-visible'));
    favBtn.click();
    assert.ok(!bar.classList.contains('cts-visible'));
    (bar.querySelector('.cts-btn') as HTMLElement).click();
    assert.equal(m.c.tool, DEFAULT_FAVORITES[0]);
    assert.ok((bar.querySelector('.cts-btn') as HTMLElement).classList.contains('cts-armed'));
    // Drag the grip.
    const grip = bar.querySelector('.cts-grip') as HTMLElement;
    grip.dispatchEvent(new m.win.PointerEvent('pointerdown', { clientX: 10, clientY: 10, bubbles: true, cancelable: true }));
    m.doc.dispatchEvent(new m.win.PointerEvent('pointermove', { clientX: 60, clientY: 40 }));
    m.doc.dispatchEvent(new m.win.PointerEvent('pointerup', {}));
    assert.equal(bar.style.transform, 'none');
  });
  it('reads stored favorites, tolerating junk', () => {
    const custom = mount({ storage: null, favorites: ['ray'] });
    assert.equal(custom.q('.cts-favorites').querySelectorAll('.cts-btn').length, 1);
    const store = new MemoryStorage();
    store.setItem(FAVORITES_KEY, '["fib", 3, "not-a-tool"]');
    const stored = mount({ storage: store });
    assert.equal(stored.q('.cts-favorites').querySelectorAll('.cts-btn').length, 1);
    store.setItem(FAVORITES_KEY, '{"x":1}');
    assert.equal(mount({ storage: store }).q('.cts-favorites').querySelectorAll('.cts-btn').length, 0);
    store.setItem(FAVORITES_KEY, 'nope{');
    assert.equal(mount({ storage: store }).q('.cts-favorites').querySelectorAll('.cts-btn').length, DEFAULT_FAVORITES.length);
    store.setItem(FAVORITES_KEY, 'nope{');
    assert.equal(mount({ storage: store, favorites: ['ray', 'fib'] }).q('.cts-favorites').querySelectorAll('.cts-btn').length, 2);
  });
});

describe('canvas input and the style bar', () => {
  it('places, selects and restyles through pointer events', () => {
    const m = mount();
    m.item('Trend line').click();
    m.clickAt(...m.at(150, 100));
    m.clickAt(...m.at(180, 104));
    const id = m.chart.selectedDrawing!;
    assert.ok(id !== null);
    const bar = m.q('.cts-style-bar');
    assert.ok(bar.classList.contains('cts-visible'));
    assert.equal(m.q('.cts-style-title', bar).textContent, 'Trend line');
    (bar.querySelectorAll('.cts-swatch')[2] as HTMLElement).click();
    assert.equal(m.chart.getDrawing(id)!.color, '#f23645');
    ([...bar.querySelectorAll('.cts-seg')].find((b) => b.textContent === '3px') as HTMLElement).click();
    assert.equal(m.chart.getDrawing(id)!.lineWidth, 3);
    ([...bar.querySelectorAll('.cts-seg')].find((b) => (b as HTMLElement).title === 'Dotted line') as HTMLElement).click();
    assert.equal(m.chart.getDrawing(id)!.lineStyle, 'dotted');
    const barBtn = (title: string) => [...m.q('.cts-style-bar').querySelectorAll('.cts-btn')].find((b) => (b as HTMLElement).title === title) as HTMLElement;
    barBtn('Lock drawing').click();
    assert.equal(m.chart.getDrawing(id)!.locked, true);
    barBtn('Unlock drawing').click();
    barBtn('Clone').click();
    assert.equal(m.chart.getConfig().drawings.length, 2);
    barBtn('Remove (Delete)').click();
    assert.equal(m.chart.getConfig().drawings.length, 1);
    assert.ok(!bar.classList.contains('cts-visible'));
  });
  it('animates the style bar width between drawings (and not under reduced motion)', () => {
    for (const reduce of [false, true]) {
      const m = mount({}, (win) => {
        (win as unknown as { matchMedia: (q: string) => { matches: boolean } }).matchMedia = () => ({ matches: reduce });
      });
      const bar = m.q('.cts-style-bar');
      Object.defineProperty(bar, 'offsetWidth', { get: () => bar.style.width !== '' ? parseFloat(bar.style.width) : bar.querySelector('.cts-style-title')?.textContent === 'Long position' ? 680 : 700 });
      const a = m.chart.addDrawing({ name: 'fib', points: [{ index: 150, price: 95 }, { index: 190, price: 105 }] });
      const b = m.chart.addDrawing({ name: 'long-position', points: [{ index: 160, price: 100 }, { index: 190, price: 104 }] });
      m.c.select(a);
      m.c.select(b);
      assert.equal(bar.style.width, reduce ? '' : '680px');
      m.c.select(b); // same width: no animation
    }
  });
  it('waits for the width animation to hand sizing back to CSS', async () => {
    const m = mount();
    const bar = m.q('.cts-style-bar');
    Object.defineProperty(bar, 'offsetWidth', { get: () => bar.style.width !== '' ? parseFloat(bar.style.width) : bar.querySelector('.cts-style-title')?.textContent === 'Horizontal line' ? 650 : 700 });
    const a = m.chart.addDrawing({ name: 'fib', points: [{ index: 150, price: 95 }, { index: 190, price: 105 }] });
    const b = m.chart.addDrawing({ name: 'hline', points: [{ index: 160, price: 100 }] });
    m.c.select(a);
    m.c.select(b);
    await sleep(300);
    assert.equal(bar.style.width, '');
  });
  it('drag, hover, wheel, double-click, leave and context menu', () => {
    const m = mount();
    const id = m.chart.addDrawing({ name: 'hline', points: [{ index: 150, price: 100 }] });
    const [x, y] = m.at(160, 100);
    m.pointer('pointermove', x, y);
    m.frames.tick();
    assert.ok(m.canvas.classList.contains('cts-over-drawing'));
    m.pointer('pointerdown', x, y);
    m.pointer('pointermove', x, y + 20);
    m.frames.tick();
    assert.ok(m.canvas.classList.contains('cts-dragging'));
    m.pointer('pointerup', x, y + 20);
    assert.ok(!m.canvas.classList.contains('cts-dragging'));
    assert.notEqual(m.chart.getDrawing(id)!.points[0]!.price, 100);
    m.pointer('pointerdown', x, y, { button: 2 }); // ignored
    m.canvas.dispatchEvent(Object.assign(new m.win.WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }), { clientX: 300 }));
    m.canvas.dispatchEvent(new m.win.MouseEvent('dblclick', { clientX: 1, clientY: 1, bubbles: true }));
    m.pointer('pointerleave', 1, 1);
    m.item('Trend line').click();
    const menuEvent = new m.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    m.canvas.dispatchEvent(menuEvent);
    assert.equal(menuEvent.defaultPrevented, true);
    const idle = new m.win.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    m.canvas.dispatchEvent(idle);
    assert.equal(idle.defaultPrevented, false);
    // Eraser mode skips the hover affordance.
    m.item('Eraser').click();
    m.pointer('pointermove', x, y);
  });
  it('box zoom shows the selection rectangle', () => {
    const m = mount();
    m.item('Zoom in (drag a range)').click();
    m.pointer('pointerdown', 100, 100);
    m.pointer('pointermove', 300, 100);
    m.frames.tick();
    assert.equal(m.q('.cts-zoom-box').style.display, 'block');
    m.pointer('pointerup', 300, 100);
    assert.equal(m.q('.cts-zoom-box').style.display, 'none');
  });
  it('keyboard shortcuts, and keyboard: false', () => {
    const m = mount();
    const id = m.chart.addDrawing({ name: 'hline', points: [{ index: 150, price: 100 }] });
    m.c.select(id);
    assert.equal(m.key('Delete').defaultPrevented, true);
    assert.equal(m.chart.getConfig().drawings.length, 0);
    assert.equal(m.key('q').defaultPrevented, false);
    m.key('z', { ctrlKey: true });
    assert.equal(m.chart.getConfig().drawings.length, 1);
    (m.qa('.cts-group')[1]!.querySelector('.cts-more') as HTMLElement).click();
    m.key('Escape');
    assert.equal(m.qa('.cts-menu.cts-open').length, 0);
    const quiet = mount({ keyboard: false });
    const qid = quiet.chart.addDrawing({ name: 'hline', points: [{ index: 150, price: 100 }] });
    quiet.c.select(qid);
    quiet.key('Delete');
    assert.equal(quiet.chart.getConfig().drawings.length, 1);
  });
});

describe('text editor and images', () => {
  it('opens after placing a note; Enter commits, Shift+Enter does not', () => {
    const m = mount();
    m.item('Note').click();
    m.clickAt(...m.at(150, 100));
    const editor = m.q<HTMLTextAreaElement>('.cts-editor');
    assert.equal(editor.style.display, 'block');
    editor.value = 'Breakout';
    // Document shortcuts are suspended while editing.
    const id = m.chart.getConfig().drawings.at(-1)!.id;
    m.key('Delete');
    assert.ok(m.chart.getDrawing(id) !== undefined);
    editor.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    assert.equal(editor.style.display, 'block');
    editor.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(editor.style.display, 'none');
    assert.equal(m.chart.getDrawing(id)!.text, 'Breakout');
    // Escape abandons an edit; blur commits one.
    const barBtn = [...m.q('.cts-style-bar').querySelectorAll('.cts-btn')].find((b) => (b as HTMLElement).title === 'Edit text') as HTMLElement;
    barBtn.click();
    editor.value = 'ignored';
    editor.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(m.chart.getDrawing(id)!.text, 'Breakout');
    barBtn.click();
    editor.value = 'Blurred';
    editor.dispatchEvent(new m.win.FocusEvent('blur'));
    assert.equal(m.chart.getDrawing(id)!.text, 'Blurred');
    editor.dispatchEvent(new m.win.FocusEvent('blur')); // nothing pending
    editor.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  });
  it('positions the editor for anchored notes, callouts and tables; pointerdown commits', () => {
    const m = mount();
    const editor = m.q<HTMLTextAreaElement>('.cts-editor');
    for (const [name, points] of [
      ['anchored-note', [{ index: 0.5, price: 0.5 }]],
      ['callout', [{ index: 150, price: 100 }, { index: 160, price: 104 }]],
      ['table', [{ index: 150, price: 100 }]],
    ] as const) {
      m.item(name === 'anchored-note' ? 'Anchored note' : name === 'callout' ? 'Callout' : 'Table').click();
      for (const p of points) {
        const xy = name === 'anchored-note' ? ([368, 238] as const) : m.at(p.index, p.price);
        m.clickAt(xy[0], xy[1]);
      }
      assert.equal(editor.style.display, 'block', name);
      editor.value = `${name} text`;
      m.pointer('pointerdown', 1, 1);
      m.pointer('pointerup', 1, 1);
      assert.equal(editor.style.display, 'none', name);
    }
    assert.equal(editor.placeholder, 'Header|Header\nCell|Cell');
  });
  it('picks an image file, or reports a failed decode', async () => {
    const img = { width: 8, height: 8 };
    const ok = mount({ loadImage: () => Promise.resolve(img) });
    const input = ok.q<HTMLInputElement>('input[type="file"]');
    let clicked = 0;
    input.click = () => void clicked++;
    ok.item('Image').click();
    assert.equal(clicked, 1);
    input.dispatchEvent(new ok.win.Event('change')); // no files: ignored
    Object.defineProperty(input, 'files', { configurable: true, value: { length: 1, item: () => ({}) } });
    input.dispatchEvent(new ok.win.Event('change'));
    await sleep(0);
    assert.equal(ok.c.tool, 'image');
    const bad = mount({ loadImage: () => Promise.reject(new Error('nope')) });
    const badInput = bad.q<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(badInput, 'files', { value: { length: 1, item: () => ({}) } });
    badInput.dispatchEvent(new bad.win.Event('change'));
    await sleep(0);
    assert.equal(bad.q('.cts-toast').textContent, 'Could not load that image');
    // Default decoder: missing, then present.
    const none = mount({}, (win) => {
      (win as unknown as { createImageBitmap?: unknown }).createImageBitmap = undefined;
    });
    const noneInput = none.q<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(noneInput, 'files', { value: { length: 1, item: () => ({}) } });
    noneInput.dispatchEvent(new none.win.Event('change'));
    await sleep(0);
    assert.equal(none.q('.cts-toast').textContent, 'Could not load that image');
    const native = mount({}, (win) => {
      (win as unknown as { createImageBitmap: () => Promise<unknown> }).createImageBitmap = () => Promise.resolve(img);
    });
    const nativeInput = native.q<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(nativeInput, 'files', { value: { length: 1, item: () => ({}) } });
    nativeInput.dispatchEvent(new native.win.Event('change'));
    await sleep(0);
    assert.equal(native.c.tool, 'image');
  });
});

describe('toasts and scroll arrows', () => {
  it('replaces and expires toasts', async () => {
    const m = mount();
    m.c.setStay(true);
    m.c.setStay(false);
    assert.equal(m.qa('.cts-toast').length, 1);
    await sleep(1500);
    assert.equal(m.qa('.cts-toast').length, 0);
  });
  it('shows paging arrows when compressed and pages on press-and-hold', async () => {
    const m = mount();
    m.chart.setData(candles(2000));
    m.chart.scale.zoom(0.5);
    m.tb.refreshViewport();
    const [left, right] = m.qa('.cts-scroll');
    assert.ok(left!.classList.contains('cts-visible'));
    m.chart.scale.scrollBy(50);
    m.tb.refreshViewport();
    assert.ok(right!.classList.contains('cts-visible'));
    const before = m.chart.scale.visibleRange().from;
    left!.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    m.frames.tick(120);
    await sleep(650);
    m.frames.tick(240);
    left!.dispatchEvent(new m.win.PointerEvent('pointerup', {}));
    assert.ok(m.chart.scale.visibleRange().from < before);
    right!.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    right!.dispatchEvent(new m.win.PointerEvent('pointerleave', {}));
    const off = mount({ navigation: false }, undefined, true);
    assert.equal(off.qa('.cts-scroll').length, 0);
    off.tb.refreshViewport();
  });
});

describe('UI primitives', () => {
  it('buttons, labels, icons and menu items', () => {
    const m = mount();
    const doc = m.doc as unknown as UIDocument;
    const lb = labelButton(doc, '15m', 'Timeframe');
    setButtonLabel(lb, '1h');
    assert.equal((lb.querySelector('.cts-btn-label') as UIElement).textContent, '1h');
    const ib = iconButton(doc, 'sun', 'Theme');
    m.tb.flyouts.attach(ib, m.tb.flyouts.create());
    setButtonIcon(ib, 'moon');
    assert.ok(ib.querySelector('.cts-caret') !== null);
    setButtonIcon(iconButton(doc, 'sun', 'No caret'), 'moon');
    assert.equal(icon('does-not-exist'), '');
    const it2 = menuItem(doc, { label: 'X', meta: '⌘K', onClick: () => {} });
    assert.ok(it2.innerHTML.includes('cts-item-meta'));
    (ib as unknown as HTMLElement).click();
    assert.equal(m.tb.flyouts.open !== null, true);
  });
  it('clamps menus to the viewport and ignores closes with nothing open', () => {
    const m = mount();
    const f = new Flyouts(m.doc as unknown as UIDocument, m.q('.cts-theme') as unknown as UIElement);
    f.close();
    const menu = f.create('extra');
    Object.defineProperty(menu, 'offsetHeight', { value: 5000 });
    const anchor = iconButton(m.doc as unknown as UIDocument, 'sun', 'A');
    f.show(menu, anchor);
    f.show(menu, anchor);
    assert.equal(menu.style.top, '8px');
    f.toggle(menu, anchor);
    assert.equal(f.open, null);
    f.destroy();
  });
  it('targetWithin handles odd targets', () => {
    const ev = (target: unknown) => ({ target }) as unknown as UIEvent;
    assert.equal(targetWithin(ev(null), 'div'), false);
    assert.equal(targetWithin(ev({}), 'div'), false);
    assert.equal(targetWithin(ev({ closest: () => ({}) }), 'div'), true);
  });
  it('keeps drawing flyouts inside a narrow embedded viewport', () => {
    const m = mount({}, (win) => Object.defineProperty(win, 'innerWidth', { value: 320 }));
    const menu = m.tb.flyouts.create();
    Object.defineProperty(menu, 'offsetWidth', { value: 232 });
    const anchor = iconButton(m.doc as unknown as UIDocument, 'trendline', 'Trend line');
    Object.defineProperty(anchor, 'getBoundingClientRect', { value: () => ({ right: 100, top: 20 }) });
    m.tb.flyouts.show(menu, anchor);
    assert.equal(menu.style.left, '80px');
    assert.equal(Number.parseFloat(menu.style.left) + menu.offsetWidth, 312);
    m.tb.destroy();
  });
});


describe('animated navigation and overflow controls', () => {
  it('batches pointer and wheel bursts, cancels on direct input, and honors the arrows setting', () => {
    const m = mount({ scrollArrows: false });
    m.chart.setData(candles(2000));
    m.chart.scale.zoom(0.5);
    m.tb.refreshViewport();
    const left = m.q('.cts-scroll');
    assert.ok(!left.classList.contains('cts-visible'));
    left.click();
    assert.equal(m.frames.callbacks.size, 0);
    m.tb.setScrollArrows(true);
    assert.ok(left.classList.contains('cts-visible'));
    const initial = m.chart.scale.indexToX(0);
    left.click();
    assert.equal(m.chart.scale.indexToX(0), initial);
    m.frames.tick(60);
    assert.ok(m.chart.scale.indexToX(0) > initial);
    m.tb.setScrollArrows(false);
    assert.equal(m.frames.callbacks.size, 0);
    m.tb.setScrollArrows(true);
    left.dispatchEvent(new m.win.PointerEvent('pointerdown', { button: 2 }));
    assert.equal(m.frames.callbacks.size, 0);
    let renders = 0;
    const render = m.chart.render.bind(m.chart);
    m.chart.render = () => { renders++; render(); };
    for (let i = 0; i < 20; i++) m.pointer('pointermove', 200 + i, 200);
    assert.equal(renders, 0);
    assert.equal(m.frames.callbacks.size, 1);
    m.frames.tick();
    assert.equal(m.frames.callbacks.size, 0);
    const wheel = (deltaMode: number) => m.canvas.dispatchEvent(Object.assign(new m.win.WheelEvent('wheel', { deltaY: -1, deltaMode, cancelable: true }), { ctrlKey: true, clientX: 300 }));
    wheel(1); m.frames.tick(16);
    assert.ok(m.frames.callbacks.size > 0);
    m.pointer('pointerdown', 100, 10);
    assert.equal(m.frames.callbacks.size, 0);
    wheel(0); // direct drag owns the viewport
    assert.equal(m.frames.callbacks.size, 0);
    m.pointer('pointerup', 100, 10);
    m.chart.updateConfig({ priceAxis: { visible: false } });
    wheel(2); m.frames.tick(500);
    m.doc.dispatchEvent(new m.win.Event('visibilitychange'));
    Object.defineProperty(m.doc, 'hidden', { value: true });
    wheel(0);
    m.doc.dispatchEvent(new m.win.Event('visibilitychange'));
    assert.equal(m.frames.callbacks.size, 0);
    m.pointer('pointermove', 90, 90);
    m.tb.destroy();
    assert.equal(m.frames.callbacks.size, 0);
  });

  it('preserves every freehand sample in a frame and keeps the style bar scroll position', () => {
    const m = mount();
    m.c.arm('brush');
    m.pointer('pointerdown', 200, 200);
    for (let i = 1; i <= 5; i++) m.pointer('pointermove', 200 + i * 10, 200 + i * 4);
    m.frames.tick();
    m.pointer('pointerup', 250, 220);
    assert.ok(m.chart.getConfig().drawings[0].points.length >= 5);
    const bar = m.q('.cts-style-bar');
    Object.defineProperties(bar, { clientWidth: { value: 300 }, scrollWidth: { value: 800 } });
    const wheel = (deltaY: number, deltaMode: number, ctrlKey = false) => {
      const e = Object.assign(new m.win.WheelEvent('wheel', { deltaY, deltaMode, cancelable: true }), { ctrlKey });
      bar.dispatchEvent(e);
      return e;
    };
    wheel(0, 0);
    const emptyWheel = new m.win.Event('wheel', { cancelable: true });
    bar.dispatchEvent(emptyWheel);
    assert.equal(emptyWheel.defaultPrevented, false);
    const horizontal = new m.win.WheelEvent('wheel', { deltaX: 40, deltaY: 2, cancelable: true });
    bar.dispatchEvent(horizontal);
    assert.equal(horizontal.defaultPrevented, false, 'horizontal trackpad scrolling stays native');
    assert.equal(wheel(10, 0, true).defaultPrevented, false);
    assert.equal(wheel(40, 0).defaultPrevented, true);
    assert.equal(bar.scrollLeft, 40);
    wheel(2, 1);
    assert.equal(bar.scrollLeft, 72);
    wheel(1, 2);
    assert.equal(bar.scrollLeft, 372);
    (bar.querySelector('.cts-swatch') as HTMLElement).click();
    assert.equal(bar.scrollLeft, 372);
    m.tb.destroy();
  });

  it('scrolls overflowing rails by click or hold and stops at their ends', async () => {
    const m = mount();
    const content = m.doc.createElement('div');
    m.doc.body.append(content);
    Object.defineProperties(content, { clientHeight: { value: 100 }, scrollHeight: { value: 500 } });
    const behavior: string[] = [];
    content.scrollBy = (options: unknown) => {
      const o = options as { top: number; behavior: string };
      behavior.push(o.behavior);
      content.scrollTop = Math.max(0, Math.min(400, content.scrollTop + o.top));
      content.dispatchEvent(new m.win.Event('scroll'));
    };
    const cleanup = attachScrollableRail(m.doc as unknown as UIDocument, content as unknown as UIElement);
    const host = content.parentElement!;
    const up = host.querySelector('.cts-up') as HTMLElement;
    const down = host.querySelector('.cts-down') as HTMLElement;
    assert.equal(up.style.display, 'none');
    down.click();
    assert.equal(content.scrollTop, 60);
    assert.equal(up.style.display, '');
    up.click();
    assert.equal(content.scrollTop, 0);
    up.click(); // no motion past the start
    down.dispatchEvent(new m.win.PointerEvent('pointerdown', { button: 2 }));
    assert.equal(content.scrollTop, 0);
    down.dispatchEvent(new m.win.PointerEvent('pointerdown', { button: 0 }));
    await sleep(550);
    m.doc.dispatchEvent(new m.win.PointerEvent('pointerup'));
    assert.ok(content.scrollTop >= 120);
    content.scrollTop = 400;
    content.dispatchEvent(new m.win.Event('scroll'));
    assert.equal(down.style.display, 'none');
    down.click();
    (m.win as unknown as { matchMedia: (query: string) => { matches: boolean } }).matchMedia = () => ({ matches: true });
    up.click();
    assert.equal(behavior.at(-1), 'auto');
    m.doc.dispatchEvent(new m.win.Event('visibilitychange'));
    Object.defineProperty(m.doc, 'hidden', { value: true });
    m.doc.dispatchEvent(new m.win.Event('visibilitychange'));
    cleanup();
    assert.equal(content.parentElement, m.doc.body);
    // Hosts without ResizeObserver or matchMedia still get working controls.
    Object.defineProperty(m.win, 'ResizeObserver', { value: undefined });
    Object.defineProperty(m.win, 'matchMedia', { value: undefined });
    const minimal = attachScrollableRail(m.doc as unknown as UIDocument, content as unknown as UIElement);
    (content.parentElement!.querySelector('.cts-up') as HTMLElement).click();
    minimal();
    m.tb.destroy();
  });
});

describe('style scrollbar', () => {
  it('tracks overflow, supports thumb drag, and cleans up on deselection', () => {
    const m = mount();
    const id = m.chart.addDrawing({ name: 'hline', points: [{ index: 150, price: 100 }] });
    const bar = m.q('.cts-style-bar');
    const shell = m.q('.cts-style-shell');
    const track = m.q('.cts-style-scroll-track');
    const thumb = m.q('.cts-style-scroll-thumb');
    Object.defineProperties(bar, { clientWidth: { value: 300 }, scrollWidth: { value: 600 } });
    Object.defineProperty(track, 'clientWidth', { value: 300 });
    const rect = (width: number) => new m.win.DOMRect(0, 0, width, 6);
    track.getBoundingClientRect = () => rect(300);
    thumb.getBoundingClientRect = () => rect(150);
    m.c.select(id);
    assert.ok(shell.classList.contains('cts-overflow'));
    assert.equal(thumb.style.width, '150px');
    track.dispatchEvent(new m.win.PointerEvent('pointerdown', { button: 2 }));
    assert.equal(bar.scrollLeft, 0);
    track.dispatchEvent(new m.win.PointerEvent('pointerdown', { button: 0, clientX: 150 }));
    assert.equal(bar.scrollLeft, 150);
    m.doc.dispatchEvent(new m.win.PointerEvent('pointerup'));
    thumb.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10 }));
    m.doc.dispatchEvent(new m.win.PointerEvent('pointermove', { clientX: 160 }));
    assert.equal(bar.scrollLeft, 300);
    assert.equal(thumb.style.transform, 'translateX(150px)');
    m.doc.dispatchEvent(new m.win.PointerEvent('pointercancel'));
    thumb.getBoundingClientRect = () => rect(300);
    track.dispatchEvent(new m.win.PointerEvent('pointerdown', { button: 0, clientX: 0 }));
    assert.equal(bar.scrollLeft, 300);
    m.c.select(null);
    assert.ok(!shell.classList.contains('cts-visible'));
    m.tb.destroy();
  });
});

describe('minimal browser host', () => {
  it('runs the native frame clock without media queries or resize observers', async () => {
    const m = mount({}, (win) => {
      Object.defineProperty(win, 'matchMedia', { value: undefined });
      Object.defineProperty(win, 'ResizeObserver', { value: undefined });
    }, true);
    m.chart.addDrawing({ name: 'hline', points: [{ index: 150, price: 100 }] });
    m.pointer('pointermove', ...m.at(160, 100));
    assert.ok(!m.canvas.classList.contains('cts-over-drawing'));
    await sleep(50);
    assert.ok(m.canvas.classList.contains('cts-over-drawing'));
    m.canvas.dispatchEvent(Object.assign(new m.win.Event('wheel', { cancelable: true }), { deltaY: -32, clientX: 300, clientY: 200 }));
    await sleep(50);
    m.tb.destroy();
  });
});

describe('idle hint timeout', () => {
  it('fades after three seconds without restarting on ordinary input and reveals active tool instructions', () => {
    let now = 0;
    const timers = new Map<ReturnType<Window['setTimeout']>, { deadline: number; callback: () => void }>();
    const m = mount({}, (win) => {
      const set = win.setTimeout.bind(win), clear = win.clearTimeout.bind(win);
      win.setTimeout = (callback, delay, ...args) => {
        const id = set(callback, delay, ...args);
        if (delay === 3_000) timers.set(id, { deadline: now + delay, callback: callback as () => void });
        return id;
      };
      win.clearTimeout = (id) => { timers.delete(id); clear(id); };
    });
    const advance = (ms: number) => {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.deadline <= now) { m.win.clearTimeout(id); timer.callback(); }
    };
    const hint = m.q('.cts-hint');
    assert.equal(timers.size, 1);
    advance(2999);
    assert.ok(!hint.classList.contains('cts-hint-hidden'));
    m.pointer('pointermove', 200, 200); m.frames.tick();
    m.c.setMagnet('weak');
    advance(1);
    assert.ok(hint.classList.contains('cts-hint-hidden'));
    assert.equal(hint.getAttribute('aria-hidden'), 'true');
    m.c.setMagnet('off');
    assert.ok(hint.classList.contains('cts-hint-hidden'), 'unrelated state does not bring the idle hint back');
    assert.equal(timers.size, 0);
    m.c.arm('trendline');
    assert.ok(!hint.classList.contains('cts-hint-hidden'));
    assert.match(hint.textContent!, /Trend line/);
    assert.equal(hint.getAttribute('aria-hidden'), 'false');
    advance(20_000);
    assert.ok(!hint.classList.contains('cts-hint-hidden'), 'active placement instructions remain available');
    m.c.disarm();
    assert.equal(timers.size, 1);
    advance(1500);
    m.c.arm('brush');
    assert.equal(timers.size, 0, 'arming a tool cancels the idle timeout');
    m.c.disarm();
    m.tb.destroy();
    assert.equal(timers.size, 0);
  });
});
