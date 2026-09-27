import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { Flyouts, iconButton } from '../dist/ui/menu.js';
import type { UIDocument, UIElement } from '../dist/ui/host.js';

const windows: Window[] = [];
after(() => {
  for (const w of windows) void w.happyDOM.close();
});

function host(before?: (win: Window) => void) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  before?.(win);
  const doc = win.document;
  const portal = doc.createElement('div');
  doc.body.append(portal);
  return { win, doc: doc as unknown as UIDocument, portal: portal as unknown as UIElement };
}

describe('menu.ts coverage gaps', () => {
  it('positions the menu right of the anchor when the window has no innerWidth', () => {
    const h = host((win) => Object.defineProperty(win, 'innerWidth', { value: undefined }));
    const f = new Flyouts(h.doc, h.portal);
    const menu = f.create();
    const anchor = iconButton(h.doc, 'sun', 'Anchor');
    Object.defineProperty(anchor, 'getBoundingClientRect', { value: () => ({ right: 100, top: 20 }) });
    f.show(menu, anchor);
    assert.equal(menu.style.left, '108px');
    assert.equal(menu.style.top, '20px');
    f.destroy();
  });

  it('clamps to a small viewport when innerWidth is defined', () => {
    const h = host((win) => Object.defineProperty(win, 'innerWidth', { value: 120 }));
    const f = new Flyouts(h.doc, h.portal);
    const menu = f.create();
    Object.defineProperty(menu, 'offsetWidth', { value: 200 });
    const anchor = iconButton(h.doc, 'sun', 'Anchor');
    Object.defineProperty(anchor, 'getBoundingClientRect', { value: () => ({ right: 100, top: 20 }) });
    f.show(menu, anchor);
    assert.equal(menu.style.left, '8px');
    f.destroy();
  });
});
