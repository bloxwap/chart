/**
 * Keyboard-driven dropdown buttons and radio entries, shared by the chart
 * header and the control rail so their menus behave identically.
 *
 * @module
 */

import type { UIDocument, UIElement, UIEvent } from './host.js';
import { Flyouts, addCaret, menuItem } from './menu.js';

/** Builders returned by {@link menuControls}. */
export interface MenuControls {
  /** Click toggles `menu` beside `btn`; arrows, Home/End, Escape and Tab drive it from the keyboard. */
  dropdown(btn: UIElement, menu: UIElement, items: readonly UIElement[]): void;
  /** A checkable entry; picking it closes `menu` and, when focus was inside, returns it to `owner`. */
  radioItem(menu: UIElement, owner: UIElement, label: string, iconName: string | undefined, onPick: () => void): UIElement;
}

/** No-op `menuItem` handler; clicks are wired here so `cleanups` can remove them. */
const ignore = (): void => undefined;

/** Dropdown builders on `flyouts`; every listener they add pushes its removal onto `cleanups`. */
export function menuControls(doc: UIDocument, flyouts: Flyouts, cleanups: (() => void)[]): MenuControls {
  const listen = (target: UIElement | UIDocument, type: string, fn: (e: UIEvent) => void): void => {
    target.addEventListener(type, fn);
    cleanups.push(() => target.removeEventListener(type, fn));
  };
  return {
    dropdown(btn, menu, items): void {
      btn.classList.add('cts-flyout-btn');
      btn.setAttribute('aria-haspopup', 'menu');
      flyouts.trackExpanded(btn);
      addCaret(doc, btn);
      listen(btn, 'click', (e) => {
        e.stopPropagation();
        flyouts.toggle(menu, btn);
        // Keyboard activation (detail 0) moves focus into the menu, onto the checked entry.
        if (flyouts.open === menu && e.detail === 0) (items.find((item) => item.classList.contains('cts-active')) ?? items[0]).focus();
      });
      const keys = (e: UIEvent): void => {
        if (flyouts.open !== menu) return;
        if (e.key === 'Tab') {
          // Close, and let Tab carry on from the button rather than from the detached menu.
          flyouts.close();
          if (menu.contains(e.target)) btn.focus();
          return;
        }
        if (e.key === 'Escape') {
          flyouts.close();
          btn.focus();
        } else {
          const at = items.indexOf(e.target as UIElement);
          const next = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? (at < 0 ? items.length : at) - 1
            : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
          if (next === null) return;
          items[(next + items.length) % items.length].focus();
        }
        e.preventDefault();
        e.stopPropagation();
      };
      listen(btn, 'keydown', keys);
      listen(menu, 'keydown', keys);
      // Escape anywhere closes it too: a menu opened by a pointer may hold no focus (Safari never focuses a clicked button).
      listen(doc, 'keydown', (e) => {
        if (e.key !== 'Escape' || flyouts.open !== menu) return;
        flyouts.close();
        btn.focus();
      });
    },
    radioItem(menu, owner, label, iconName, onPick): UIElement {
      const item = menuItem(doc, { label, tick: true, onClick: ignore, ...(iconName !== undefined ? { icon: iconName } : {}) });
      item.setAttribute('role', 'menuitemradio');
      listen(item, 'click', () => {
        const refocus = menu.contains(doc.activeElement);
        flyouts.close();
        onPick();
        if (refocus) owner.focus();
      });
      menu.append(item);
      return item;
    },
  };
}
