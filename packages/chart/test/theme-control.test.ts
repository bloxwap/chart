import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { createThemeControl, Flyouts, type UIDocument, type UIElement, type ThemeMode } from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => { for (const win of windows) void win.happyDOM.close(); });
function fixture(lockedTheme?: 'dark' | 'light', theme?: ThemeMode, persist = true) {
  const win = new Window(); windows.push(win);
  let matches = true;
  const listeners = new Set<() => void>();
  const query = { get matches() { return matches; },
    addEventListener: (_: string, fn: () => void) => { listeners.add(fn); },
    removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn); } };
  win.matchMedia = (() => query) as unknown as typeof win.matchMedia;
  const doc = win.document as unknown as UIDocument;
  const flyouts = new Flyouts(doc, doc.body);
  const changes: string[] = [], selections: string[] = [];
  const control = createThemeControl({ document: doc, flyouts,
    ...(lockedTheme ? { lockedTheme } : {}), ...(theme ? { theme } : {}),
    onChange: value => changes.push(value), ...(persist ? { onSelect: (value: ThemeMode) => selections.push(value) } : {}),
  });
  if (control.element) doc.body.append(control.element);
  return { win, doc, flyouts, control, changes, selections, listeners,
    system(dark: boolean) { matches = dark; for (const listener of listeners) listener(); },
    click(value: string) { const item = [...win.document.querySelectorAll('.cts-item')].find(el => el.textContent.includes(value)); item!.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); },
  };
}

describe('theme control', () => {
  it('follows system changes, persists user selection and accepts host updates', () => {
    const m = fixture();
    assert.deepEqual(m.changes, ['dark']);
    assert.equal(m.control.element!.title, 'Theme: System');
    m.system(false); assert.equal(m.changes.at(-1), 'light');
    m.click('Dark'); assert.deepEqual(m.selections, ['dark']);
    assert.equal(m.control.element!.title, 'Theme: Dark');
    const count = m.changes.length;
    m.system(true); assert.equal(m.changes.length, count);
    m.control.setTheme('light'); assert.equal(m.changes.at(-1), 'light');
    m.click('System'); assert.equal(m.changes.at(-1), 'dark');
    m.flyouts.show(m.doc.body.querySelector('.cts-menu') as UIElement, m.control.element!);
    m.control.destroy(); assert.equal(m.listeners.size, 0);
    assert.equal(m.flyouts.open, null);
    assert.equal(m.win.document.querySelectorAll('[role="menuitemradio"]').length, 0);
    m.flyouts.destroy();
  });

  it('removes every theme choice and system listener when locked; the host can still change it', () => {
    for (const theme of ['dark', 'light'] as const) {
      const m = fixture(theme, 'system');
      assert.equal(m.control.element, null);
      assert.equal(m.win.document.querySelectorAll('[role="menuitemradio"]').length, 0);
      assert.equal(m.listeners.size, 0);
      m.system(theme !== 'dark'); m.control.setTheme('system');
      assert.deepEqual(m.changes, [theme]);
      m.control.setTheme(theme === 'dark' ? 'light' : 'dark');
      assert.equal(m.changes.length, 2);
      assert.deepEqual(m.selections, []);
      m.control.destroy(); m.flyouts.destroy();
    }
  });

  it('supports explicit modes, optional persistence and documents without media queries', () => {
    const m = fixture(undefined, 'light', false);
    assert.equal(m.changes[0], 'light'); m.click('Dark');
    assert.deepEqual(m.selections, []); m.control.destroy(); m.flyouts.destroy();
    const doc = { defaultView: null } as UIDocument;
    // A locked control needs no DOM allocation or browser window.
    const locked = createThemeControl({ document: doc, flyouts: {} as Flyouts, lockedTheme: 'dark', onChange: value => assert.equal(value, 'dark') });
    locked.destroy();
    for (const defaultView of [null, {}, { matchMedia: () => ({ matches: false }) }]) {
      const changes: string[] = [];
      const control = createThemeControl({ document: { defaultView, createElement: (tag: string) => m.doc.createElement(tag) } as UIDocument,
        flyouts: new Flyouts(m.doc, m.doc.body as UIElement), onChange: value => changes.push(value) });
      assert.deepEqual(changes, ['light']); control.destroy();
    }
  });
});
