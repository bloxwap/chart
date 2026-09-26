/**
 * Structural DOM types for the toolbar UI.
 *
 * Like the canvas abstraction in `dom.ts`, the UI never touches the global
 * `document`/`window`: the host injects a {@link UIDocument}. A real browser
 * `document` (and its elements and events) satisfies these interfaces, so
 * callers simply pass `document`.
 *
 * @module
 */

/** `element.style` subset used by the toolbar. */
export interface UIStyle {
  left: string;
  top: string;
  width: string;
  height: string;
  display: string;
  transform: string;
  transition: string;
  background: string;
}

/** `element.classList` subset. */
export interface UIClassList {
  add(...tokens: string[]): void;
  remove(...tokens: string[]): void;
  toggle(token: string, force?: boolean): boolean;
  contains(token: string): boolean;
}

/** Bounding box in viewport CSS pixels. */
export interface UIRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** Event fields the toolbar reads. Pointer/keyboard/wheel fields are optional. */
export interface UIEvent {
  readonly type: string;
  readonly target: unknown;
  readonly clientX?: number;
  readonly clientY?: number;
  readonly button?: number;
  readonly pointerType?: string;
  readonly pointerId?: number;
  readonly key?: string;
  readonly code?: string;
  readonly altKey?: boolean;
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly deltaY?: number;
  readonly deltaX?: number;
  readonly deltaMode?: number;
  readonly detail?: number;
  readonly propertyName?: string;
  preventDefault(): void;
  stopPropagation(): void;
}

/** Listener signature used with {@link UIElement.addEventListener}. */
export type UIListener = (event: UIEvent) => void;

/** The element surface the toolbar uses. */
export interface UIElement {
  className: string;
  innerHTML: string;
  textContent: string | null;
  title: string;
  readonly style: UIStyle;
  readonly classList: UIClassList;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
  readonly scrollWidth: number;
  scrollTop: number;
  scrollLeft: number;
  before(...nodes: unknown[]): void;
  scrollBy(options: { top?: number; left?: number; behavior?: 'auto' | 'smooth' }): void;
  append(...nodes: unknown[]): void;
  replaceChildren(...nodes: unknown[]): void;
  remove(): void;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  querySelector(selectors: string): unknown;
  getBoundingClientRect(): UIRect;
  addEventListener(type: string, listener: UIListener, options?: { passive?: boolean }): void;
  removeEventListener(type: string, listener: UIListener): void;
  focus(): void;
  contains(other: unknown): boolean;
  setPointerCapture?(pointerId: number): void;
}

/** `<textarea>`/`<input>` surface. */
export interface UITextInput extends UIElement {
  value: string;
  placeholder: string;
  select(): void;
}

/** `<input type="file">` surface. */
export interface UIFileInput extends UIElement {
  type: string;
  accept: string;
  value: string;
  readonly files: { readonly length: number; item(index: number): unknown } | null;
  click(): void;
}

/** Timer functions, taken from the injected window (never globals). */
export interface UITimers {
  setTimeout(handler: () => void, timeout?: number): number;
  clearTimeout(id: number | undefined): void;
  setInterval(handler: () => void, timeout?: number): number;
  clearInterval(id: number | undefined): void;
}

/** The window surface the toolbar uses. */
export interface UIWindow extends UITimers {
  readonly innerHeight: number;
  readonly performance: { now(): number };
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  ResizeObserver?: new (callback: () => void) => { observe(target: unknown): void; disconnect(): void };
  matchMedia?(query: string): { readonly matches: boolean };
  createImageBitmap?(source: never): Promise<{ readonly width: number; readonly height: number }>;
}

/** The document surface the toolbar uses. */
export interface UIDocument {
  readonly hidden?: boolean;
  createElement(tagName: string): UIElement;
  readonly head: UIElement;
  readonly body: UIElement;
  readonly defaultView: UIWindow | null;
  addEventListener(type: string, listener: UIListener): void;
  removeEventListener(type: string, listener: UIListener): void;
}

/** Key/value persistence (e.g. `localStorage`) for favorites. */
export interface UIStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Whether an event target sits inside an element matching `selector`. */
export function targetWithin(event: UIEvent, selector: string): boolean {
  const t = event.target as { closest?: (s: string) => unknown } | null;
  return t !== null && typeof t.closest === 'function' && t.closest(selector) !== null;
}
