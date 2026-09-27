/**
 * Regressions from the whole-diff UI audit:
 *
 * - A context menu that builds its own controller releases every chart
 *   `subscribeDataLoad` listener on destroy (the fix landed with the
 *   requirements audit; this counts listeners through the public API).
 * - Flyout, header and context menus stack above the settings card and the
 *   indicators dialog, which stay open under them.
 * - A header-owned dropdown closes on Escape from anywhere, not only from its
 *   focused button: Safari never focuses a clicked or tapped button.
 * - The indicators dialog never focuses a field after a finger press (the
 *   iOS keyboard would cover it): it focuses itself, and Tab wraps from there.
 * - Touch reaches "Reset chart view": the toolbar's Zoom menu has it, and a
 *   double tap on the price axis resets the view.
 * - Translucent study colors show opaque chips; the pane select fits its text.
 * - Menu labels and separators carry roles valid inside `role="menu"`; the
 *   on-chart A / % / L hit areas grow under a coarse pointer.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type HTMLElement, type HTMLInputElement } from 'happy-dom';
import { createChart, MockContext2D, MockDocument, type Candle, type Chart, type ChartCanvas, type FrameScheduler } from '../dist/index.js';
import { parseColor, withAlpha } from '../dist/color.js';
import { ichimokuIndicator } from '../dist/indicators/index.js';
import {
  attachTouchGestures,
  createChartContextMenu,
  createChartHeader,
  createDrawingToolbar,
  createIndicatorsDialog,
  DOUBLE_TAP_MS,
  HEADER_CSS,
  INDICATORS_DIALOG_CSS,
  menuLabel,
  menuSeparator,
  TOOLBAR_CSS,
  type UIDocument,
  type UIElement,
} from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => { for (const win of windows) void win.happyDOM.close(); });

const data: Candle[] = Array.from({ length: 400 }, (_, i) => {
  const base = 100 + Math.sin(i / 5) * 10;
  return { time: 1_700_000_000 + i * 3600, open: base, high: base + 2, low: base - 2, close: base + 1, volume: 1000 + i };
});

/** Identity check: a failing `assert.equal` on happy-dom nodes would diff the whole DOM. */
function focusedOn(doc: { activeElement: unknown }, expected: unknown, message: string): void {
  assert.ok(doc.activeElement === expected, message);
}

function page() {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const doc = win.document;
  const press = (node: { dispatchEvent(e: unknown): boolean }, pointerType: string) =>
    node.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType }));
  const key = (node: { dispatchEvent(e: unknown): boolean }, k: string, init: Record<string, unknown> = {}) => {
    const event = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    node.dispatchEvent(event);
    return event;
  };
  return { win, doc, udoc: doc as unknown as UIDocument, press, key };
}

class TestFrames implements FrameScheduler {
  time = 0;
  now = () => this.time;
  request = () => 1;
  cancel = () => {};
}

describe('audit (ui): a context menu leaves no chart subscriptions behind', () => {
  it('create/destroy cycles release every subscribeDataLoad listener', () => {
    const p = page();
    const canvas = p.doc.createElement('div');
    p.doc.body.append(canvas);
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data } });
    let active = 0;
    const subscribe = chart.subscribeDataLoad.bind(chart);
    Object.assign(chart, {
      subscribeDataLoad: (listener: Parameters<Chart['subscribeDataLoad']>[0]) => {
        active++;
        const off = subscribe(listener);
        return () => {
          active--;
          off();
        };
      },
    });
    for (let i = 0; i < 5; i++) {
      createChartContextMenu({ chart, document: p.udoc, canvas: canvas as unknown as UIElement }).destroy();
    }
    assert.equal(active, 0);
  });
});

describe('audit (ui): menus stack above the dialogs', () => {
  it('flyout, header and context menus sit above the settings card and indicators dialog', () => {
    const layer = (selector: string) => Number(new RegExp(`\\n${selector.replace('.', '\\.')} \\{[^}]*z-index: (\\d+)`).exec(TOOLBAR_CSS)![1]);
    assert.ok(layer('.cts-menu') > layer('.cts-settings'), `${layer('.cts-menu')} > ${layer('.cts-settings')}`);
    assert.doesNotMatch(INDICATORS_DIALOG_CSS, /z-index/, 'the dialog keeps the settings card layer');
  });
});

describe('audit (ui): header dropdowns close on Escape from anywhere', () => {
  function header() {
    const p = page();
    const canvas: ChartCanvas = { width: 640, height: 400, getContext: () => new MockContext2D() };
    const chart = createChart({ container: canvas, config: { wasm: false, data } });
    const host = p.doc.createElement('div');
    p.doc.body.append(host);
    const h = createChartHeader({ chart, document: p.udoc, container: host as unknown as UIElement, compact: false });
    const typeButton = p.doc.querySelector('.cts-header-type') as unknown as HTMLElement;
    const isOpen = () => typeButton.getAttribute('aria-expanded') === 'true';
    return { ...p, h, typeButton, isOpen };
  }

  it('a pointer-opened menu (no focus) closes on a document Escape and hands focus to its button', () => {
    const m = header();
    m.typeButton.dispatchEvent(new m.win.MouseEvent('click', { bubbles: true, detail: 1 }));
    assert.equal(m.isOpen(), true);
    focusedOn(m.doc, m.doc.body, 'a click leaves focus on the body, as in Safari');
    m.key(m.doc.body, 'a');
    assert.equal(m.isOpen(), true, 'other keys leave it open');
    const escape = m.key(m.doc.body, 'Escape');
    assert.equal(m.isOpen(), false);
    assert.equal(escape.defaultPrevented, false, 'the page still sees its Escape');
    focusedOn(m.doc, m.typeButton, 'focus returns to the button');

    // Closed: Escape does nothing; after destroy nothing listens.
    (m.doc.body as unknown as { focus(): void }).focus();
    m.key(m.doc.body, 'Escape');
    focusedOn(m.doc, m.doc.body, 'no menu open: focus stays');
    m.typeButton.dispatchEvent(new m.win.MouseEvent('click', { bubbles: true, detail: 1 }));
    m.h.destroy();
    m.key(m.doc.body, 'Escape');
    focusedOn(m.doc, m.doc.body, 'destroyed: no listener');
  });

  it('closes only its own menu', () => {
    const m = header();
    const tf = m.doc.querySelector('.cts-header-tf-menu') as unknown as HTMLElement;
    tf.dispatchEvent(new m.win.MouseEvent('click', { bubbles: true, detail: 1 }));
    assert.equal(tf.getAttribute('aria-expanded'), 'true');
    m.key(m.doc.body, 'Escape');
    assert.equal(tf.getAttribute('aria-expanded'), 'false');
    focusedOn(m.doc, tf, 'the timeframe button, not the chart-type one');
    m.h.destroy();
  });
});

describe('audit (ui): the indicators dialog keeps the on-screen keyboard down after a finger press', () => {
  function dialog() {
    const p = page();
    const canvas: ChartCanvas = { width: 900, height: 600, getContext: () => new MockContext2D() };
    const chart = createChart({ container: canvas, config: { wasm: false, data } });
    const d = createIndicatorsDialog({ chart, document: p.udoc });
    const root = d.element as unknown as HTMLElement;
    const search = root.querySelector('[type="search"]') as unknown as HTMLElement;
    const button = (text: string) => Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text && b.closest('[hidden]') === null) as unknown as HTMLElement;
    /** A finger (or mouse) press on `node`, then its click. */
    const tap = (node: HTMLElement, pointerType = 'touch') => {
      p.press(node, pointerType);
      node.click();
    };
    return { ...p, chart, d, root, search, button, tap };
  }

  it('a finger open focuses the dialog, not the search or the first input; keys and mice focus fields again', () => {
    const m = dialog();
    const rsi = m.chart.addIndicator({ name: 'rsi' });
    assert.equal(m.root.getAttribute('tabindex'), '-1');
    assert.match(INDICATORS_DIALOG_CSS, /\.cts-settings\.cts-ind-dialog:focus \{ outline: none; \}/);

    // The host's Indicators button, tapped.
    const opener = m.doc.createElement('button');
    m.doc.body.append(opener);
    m.press(opener, 'touch');
    m.d.openPicker();
    focusedOn(m.doc, m.root, 'picker: the dialog, not the search field');

    // A study's Settings button, tapped: the dialog again, not the first input.
    m.tap(m.root.querySelector(`[data-id="${rsi}"] .cts-ind-settings`) as unknown as HTMLElement);
    assert.equal(m.d.view, 'settings');
    focusedOn(m.doc, m.root, 'settings: the dialog');
    // The section tabs scroll without focusing a field.
    m.tap(m.button('Style'));
    focusedOn(m.doc, m.root, 'a tapped tab leaves the fields alone');

    // Tab and Shift+Tab from the dialog itself stay inside it.
    const tab = m.key(m.root, 'Tab');
    assert.equal(tab.defaultPrevented, true);
    assert.ok(m.root.contains(m.doc.activeElement) && m.doc.activeElement !== m.root, 'Tab lands on the first control');
    m.root.focus();
    assert.equal(m.key(m.root, 'Tab', { shiftKey: true }).defaultPrevented, true);
    assert.equal((m.doc.activeElement as HTMLElement).textContent, 'OK', 'Shift+Tab wraps to the last control');

    // Any key means a keyboard: the tabs focus their first field again.
    m.button('Inputs').click();
    focusedOn(m.doc, m.root.querySelector('[name="input-period"]'), 'after a key the Inputs tab focuses its field');

    // A mouse press (settings stay open on outside presses) keeps fields focusable.
    m.press(m.doc.body, 'mouse');
    assert.equal(m.d.view, 'settings');
    m.button('Visibility').click();
    focusedOn(m.doc, m.root.querySelector('[name="pane"]'), 'mouse: the Visibility tab focuses the pane select');
    m.d.close();

    // Picker by mouse: the search field, as before.
    m.press(opener, 'mouse');
    m.d.openPicker();
    focusedOn(m.doc, m.search, 'mouse: the search field');
    m.d.close();
    m.d.destroy();
  });

  it('removing a study by finger focuses the dialog; a document key switches back to the search', () => {
    const m = dialog();
    m.chart.addIndicator({ name: 'rsi' });
    m.chart.addIndicator({ name: 'sma' });
    m.press(m.doc.body, 'touch');
    m.d.openPicker();
    m.tap(m.root.querySelector('.cts-ind-remove') as unknown as HTMLElement);
    assert.equal(m.chart.getConfig().indicators.length, 1);
    focusedOn(m.doc, m.root, 'no field after a tapped remove');

    // A key anywhere in the document (a hardware keyboard) is a keyboard again.
    m.key(m.doc.body, 'Shift');
    assert.equal(m.d.view, 'picker');
    m.tap(m.root.querySelector('.cts-ind-remove') as unknown as HTMLElement, 'mouse');
    assert.equal(m.chart.getConfig().indicators.length, 0);
    focusedOn(m.doc, m.search, 'a mouse remove returns to the search');
    m.d.destroy();
  });

  it('keyboard opens still focus the search and the first input', () => {
    const m = dialog();
    const rsi = m.chart.addIndicator({ name: 'rsi' });
    m.press(m.doc.body, 'touch');
    m.key(m.doc.body, 'i');
    m.d.openSettings(rsi);
    focusedOn(m.doc, m.root.querySelector('[name="input-period"]'), 'a key after the tap: the first input');
    m.d.destroy();
  });
});

describe('audit (ui): translucent swatches and the pane select', () => {
  it('paints translucent study colors opaque, keeping the alpha in the title and the stored color', () => {
    const p = page();
    const canvas: ChartCanvas = { width: 900, height: 600, getContext: () => new MockContext2D() };
    const chart = createChart({ container: canvas, config: { wasm: false, data } });
    const d = createIndicatorsDialog({ chart, document: p.udoc });
    const id = chart.addIndicator({ name: 'ichimoku' });
    d.openSettings(id);
    const root = d.element as unknown as HTMLElement;
    const input = root.querySelector('[name="color-5"]') as unknown as HTMLInputElement;
    const chip = input.previousElementSibling as unknown as HTMLElement;
    const kumo = ichimokuIndicator.defaultColors[5]!;
    assert.ok(parseColor(kumo)!.a < 1, 'Kumo is translucent');
    assert.equal((input.closest('label') as unknown as HTMLElement).title, `Kumo bullish: ${kumo}`, 'the title keeps the alpha');
    assert.equal(chip.style.background, withAlpha(kumo, 1), 'the chip reads at full opacity');
    assert.equal(chip.style.background, 'rgb(67, 160, 71)');

    const pane = root.querySelector('[name="pane"]') as unknown as HTMLElement;
    assert.ok(pane.classList.contains('cts-ind-pane'));
    assert.match(INDICATORS_DIALOG_CSS, /\.cts-ind-dialog \.cts-ind-pane \{ width: auto; max-width: 100%; \}/, '"Main chart (overlay)" is not cut off');
    d.destroy();
  });
});

describe('audit (ui): touch reaches Reset chart view', () => {
  function toolbar(priceAxis: 'left' | 'right' = 'right') {
    const p = page();
    Object.assign(p.win, { setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} });
    const rail = p.doc.createElement('div');
    const stage = p.doc.createElement('div');
    const canvas = p.doc.createElement('div');
    Object.defineProperties(canvas, { clientWidth: { value: 800 }, clientHeight: { value: 500 } });
    stage.append(canvas);
    p.doc.body.append(rail, stage);
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data, priceAxis: { position: priceAxis } } });
    const frames = new TestFrames();
    const tb = createDrawingToolbar({
      chart, document: p.udoc, canvas: canvas as unknown as UIElement, rail: rail as unknown as UIElement,
      overlay: stage as unknown as UIElement, scheduler: frames,
    });
    const finger = (type: string, x: number, y: number) =>
      canvas.dispatchEvent(new p.win.PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, button: 0, pointerType: 'touch', bubbles: true, cancelable: true }));
    const tap = (x: number, y: number) => {
      finger('pointerdown', x, y);
      finger('pointerup', x, y);
    };
    const initial = chart.scale.barSpacing();
    /** Zooms, scrolls and pins the price range away from the defaults. */
    const disturb = () => {
      chart.scale.zoom(0.5, 200);
      chart.scale.scrollBy(40);
      chart.updateConfig({ priceAxis: { autoScale: false } });
      assert.notEqual(chart.scale.barSpacing(), initial);
    };
    const isReset = () => chart.scale.barSpacing() === initial && chart.getConfig().priceAxis.autoScale;
    return { ...p, chart, frames, tb, tap, disturb, isReset };
  }

  it('the Zoom menu resets the view', () => {
    const m = toolbar();
    m.disturb();
    const label = Array.from(m.doc.querySelectorAll('.cts-item-label')).find((node) => node.textContent === 'Reset chart view');
    assert.ok(label);
    const item = label.closest('.cts-item') as unknown as HTMLElement;
    (m.doc.querySelector('.cts-more[title="More: zoom in"]') as unknown as HTMLElement).click();
    assert.ok(item.closest('.cts-menu')!.classList.contains('cts-open'));
    item.click();
    assert.equal(m.isReset(), true);
    assert.equal(m.tb.flyouts.open, null, 'the menu closes');
    m.tb.destroy();
  });

  it('a double tap on the price axis resets the view; one on the plot stays a double click', () => {
    const m = toolbar();
    const plot = m.chart.plotArea;
    m.disturb();
    m.tap(plot.left + plot.width / 2, 100);
    m.frames.time += 50;
    m.tap(plot.left + plot.width / 2, 100);
    assert.equal(m.isReset(), false, 'the plot keeps its double click');
    m.tap(plot.left + plot.width + 20, 100);
    m.frames.time += DOUBLE_TAP_MS + 1;
    m.tap(plot.left + plot.width + 20, 100);
    assert.equal(m.isReset(), false, 'two slow taps are no double tap');
    m.frames.time += 50;
    m.tap(plot.left + plot.width + 20, 100);
    assert.equal(m.isReset(), true);
    m.tb.destroy();
  });

  it('works on a left price axis and without the toolbar', () => {
    const m = toolbar('left');
    m.disturb();
    m.tap(10, 100);
    m.frames.time += 50;
    m.tap(10, 100);
    assert.equal(m.isReset(), true);
    m.tb.destroy();

    const p = page();
    Object.assign(p.win, { setTimeout: () => 0, clearTimeout: () => {} });
    const canvas = p.doc.createElement('div');
    p.doc.body.append(canvas);
    const chart = createChart({ document: new MockDocument(), config: { wasm: false, data } });
    const frames = new TestFrames();
    const gestures = attachTouchGestures({ chart, canvas: canvas as unknown as UIElement, document: p.udoc, scheduler: frames });
    const initial = chart.scale.barSpacing();
    chart.scale.zoom(0.5, 200);
    const x = chart.plotArea.left + chart.plotArea.width + 10;
    for (let i = 0; i < 2; i++) {
      canvas.dispatchEvent(new p.win.PointerEvent('pointerdown', { pointerId: 1, clientX: x, clientY: 50, pointerType: 'touch', bubbles: true, cancelable: true }));
      canvas.dispatchEvent(new p.win.PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: 50, pointerType: 'touch', bubbles: true, cancelable: true }));
    }
    assert.equal(chart.scale.barSpacing(), initial);
    gestures.destroy();
  });
});

describe('audit (ui): menu roles and touch targets', () => {
  it('labels and separators are valid children of role="menu"', () => {
    const p = page();
    assert.equal((menuLabel(p.udoc, 'Price scale') as unknown as HTMLElement).getAttribute('role'), 'presentation');
    assert.equal((menuSeparator(p.udoc) as unknown as HTMLElement).getAttribute('role'), 'separator');
  });

  it('the on-chart scale buttons grow their hit area under a coarse pointer', () => {
    assert.match(HEADER_CSS, /\.cts-scale-btn \{\n {2}position: relative;/);
    assert.match(HEADER_CSS, /@media \(pointer: coarse\) \{ \.cts-scale-btn::before \{ content: ''; position: absolute; inset: -3px -1px; \} \}/);
  });
});
