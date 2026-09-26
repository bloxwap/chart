/**
 * Building blocks shared by every chart-ts toolbar: icon buttons with the
 * disclosure chevron, flyout menus with hover intent, and menu items. Hosts
 * use these for their own control rails so everything matches the drawing
 * toolbar.
 *
 * @module
 */

import { icon } from './icons.js';
import { targetWithin, type UIDocument, type UIElement, type UIEvent, type UIWindow } from './host.js';

/** Muted disclosure chevron (4×8) shown beside every flyout button. */
export const DISCLOSURE_SVG =
  '<svg width="4" height="8" viewBox="0 0 4 8" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 1 3 4 1 7"/></svg>';

/** Hover-intent delay before a flyout opens (ms). */
export const HOVER_OPEN_MS = 120;
/** Grace period before a flyout closes after the pointer leaves (ms). */
export const HOVER_CLOSE_MS = 260;

/** The injected document's window; the UI needs it for timers. */
export function requireWindow(doc: UIDocument): UIWindow {
  if (doc.defaultView === null) throw new Error('chart-ts: the injected document has no window (defaultView)');
  return doc.defaultView;
}

/** Creates an element with an optional class and inner HTML. */
export function el(doc: UIDocument, tag: string, className = '', html?: string): UIElement {
  const node = doc.createElement(tag);
  if (className !== '') node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/** A 36px icon button. */
export function iconButton(doc: UIDocument, iconName: string, title: string, size = 22): UIElement {
  const btn = el(doc, 'button', 'cts-btn', icon(iconName, size));
  btn.title = title;
  btn.setAttribute('type', 'button');
  return btn;
}

/** A 36px button showing a short mono text label (e.g. a timeframe). */
export function labelButton(doc: UIDocument, label: string, title: string): UIElement {
  const btn = el(doc, 'button', 'cts-btn', '<span class="cts-btn-label"></span>');
  setButtonLabel(btn, label);
  btn.title = title;
  btn.setAttribute('type', 'button');
  return btn;
}

/** Updates a {@link labelButton}'s text. */
export function setButtonLabel(btn: UIElement, label: string): void {
  (btn.querySelector('.cts-btn-label') as UIElement).textContent = label;
}

/** Swaps a button's icon, keeping its disclosure chevron. */
export function setButtonIcon(btn: UIElement, iconName: string, size = 22): void {
  const caret = btn.querySelector('.cts-caret') as UIElement | null;
  btn.innerHTML = icon(iconName, size);
  if (caret !== null) btn.append(caret);
}

/** Appends the disclosure chevron to a button that opens a flyout. */
export function addCaret(doc: UIDocument, btn: UIElement): UIElement {
  const caret = el(doc, 'span', 'cts-caret', DISCLOSURE_SVG);
  btn.append(caret);
  return btn;
}

/** A section label inside a menu. */
export function menuLabel(doc: UIDocument, text: string): UIElement {
  const node = el(doc, 'div', 'cts-menu-label');
  node.textContent = text;
  return node;
}

/** A hairline separator inside a menu. */
export function menuSeparator(doc: UIDocument): UIElement {
  return el(doc, 'div', 'cts-menu-sep');
}

/** Options for {@link menuItem}. */
export interface MenuItemOptions {
  label: string;
  onClick: () => void;
  icon?: string;
  /** Right-aligned secondary text (shortcut, count). */
  meta?: string;
  /** Show a check mark while the item has `cts-active`. */
  tick?: boolean;
}

/** A menu row: optional icon, label, meta text and check mark. */
export function menuItem(doc: UIDocument, options: MenuItemOptions): UIElement {
  const iconHtml = options.icon !== undefined ? icon(options.icon, 20) : '';
  const meta = options.meta !== undefined ? `<span class="cts-item-meta">${options.meta}</span>` : '';
  const tick = options.tick === true ? icon('check', 16).replace('<svg ', '<svg class="cts-tick" ') : '';
  const item = el(doc, 'button', 'cts-item', `${iconHtml}<span class="cts-item-label"></span>${meta}${tick}`);
  (item.querySelector('.cts-item-label') as UIElement).textContent = options.label;
  item.setAttribute('type', 'button');
  item.setAttribute('role', 'menuitem');
  item.addEventListener('click', options.onClick);
  return item;
}

/**
 * Owns a set of flyout menus rendered into a portal element: one open at a
 * time, positioned right of their anchor, with hover intent and outside
 * click dismissal.
 */
export class Flyouts {
  private current: UIElement | null = null;
  /** Buttons that get `cts-open` while their menu shows. */
  private readonly openers = new Set<UIElement>();
  private openTimer: number | undefined;
  private closeTimer: number | undefined;
  private readonly onDocPointerDown: (e: UIEvent) => void;
  private readonly win: UIWindow;

  constructor(
    private readonly doc: UIDocument,
    /** Element the menus are appended to (should carry `cts-theme`). */
    readonly portal: UIElement,
  ) {
    this.win = requireWindow(doc);
    this.onDocPointerDown = (e) => {
      if (this.current !== null && !targetWithin(e, '.cts-menu, .cts-more, .cts-group, .cts-flyout-btn')) this.close();
    };
    doc.addEventListener('pointerdown', this.onDocPointerDown);
  }

  /** The open menu, if any. */
  get open(): UIElement | null {
    return this.current;
  }

  /** Creates an empty menu in the portal. */
  create(extraClass = ''): UIElement {
    const menu = el(this.doc, 'div', `cts-menu ${extraClass}`.trim());
    menu.setAttribute('role', 'menu');
    this.portal.append(menu);
    return menu;
  }

  /** Opens `menu` beside `anchor` (no-op when already open). */
  show(menu: UIElement, anchor: UIElement, opener: UIElement = anchor): void {
    this.cancelTimers();
    if (this.current === menu) return;
    this.close();
    menu.classList.add('cts-open');
    opener.classList.add('cts-open');
    this.current = menu;
    const r = anchor.getBoundingClientRect();
    const viewport = this.win.innerHeight;
    const top = Math.max(8, Math.min(r.top, viewport - menu.offsetHeight - 8));
    menu.style.left = `${r.right + 8}px`;
    menu.style.top = `${top}px`;
  }

  /** Opens `menu`, or closes it when it is already open. */
  toggle(menu: UIElement, anchor: UIElement, opener: UIElement = anchor): void {
    if (this.current === menu) this.close();
    else this.show(menu, anchor, opener);
  }

  /** Closes the open menu. */
  close(): void {
    this.cancelTimers();
    if (this.current === null) return;
    this.current.classList.remove('cts-open');
    this.current = null;
    for (const opener of this.openers) opener.classList.remove('cts-open');
  }

  /**
   * Hover intent: pointing at `owner` opens `menu` after
   * {@link HOVER_OPEN_MS}; leaving both closes it after
   * {@link HOVER_CLOSE_MS}. Mouse only — touch uses clicks.
   */
  hover(owner: UIElement, menu: UIElement, anchor: UIElement = owner, opener: UIElement = anchor): void {
    this.openers.add(opener);
    const leave = (e: UIEvent): void => {
      if (e.pointerType !== 'mouse') return;
      this.win.clearTimeout(this.openTimer);
      this.closeTimer = this.win.setTimeout(() => {
        if (this.current === menu) this.close();
      }, HOVER_CLOSE_MS);
    };
    owner.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      this.cancelTimers();
      this.openTimer = this.win.setTimeout(() => this.show(menu, anchor, opener), HOVER_OPEN_MS);
    });
    owner.addEventListener('pointerleave', leave);
    menu.addEventListener('pointerenter', () => this.cancelTimers());
    menu.addEventListener('pointerleave', leave);
  }

  /** Wires a plain button to open `menu` on click and hover, with the chevron. */
  attach(btn: UIElement, menu: UIElement): void {
    btn.classList.add('cts-flyout-btn');
    addCaret(this.doc, btn);
    this.openers.add(btn);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.show(menu, btn);
    });
    this.hover(btn, menu);
  }

  /** Removes the document listener and pending timers. */
  destroy(): void {
    this.close();
    this.doc.removeEventListener('pointerdown', this.onDocPointerDown);
  }

  private cancelTimers(): void {
    this.win.clearTimeout(this.openTimer);
    this.win.clearTimeout(this.closeTimer);
  }
}
