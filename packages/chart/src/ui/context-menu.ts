/**
 * Right-click context menus on the chart canvas, after TradingView. A
 * drawing under the pointer gets Settings…, Clone, Lock/Unlock, Hide and
 * Remove (undoable through the controller's history); an indicator plot
 * gets Settings…, Hide and Remove; anywhere else gets Reset chart view, the
 * Auto / Logarithmic / Percent price scale toggles, Chart settings… and
 * Remove all drawings / indicators. Empty space in an indicator sub-pane
 * swaps the main pane's price scale toggles for that pane's study actions.
 *
 * Mouse and pen only: a finger's long press is the touch crosshair (see
 * `attachTouchGestures`), so touch never opens the menu, whichever listener
 * runs first. A `contextmenu` another listener already cancelled (the
 * toolbar's armed tool, a second menu) is left alone too.
 *
 * ```ts
 * import { createChartContextMenu } from '@bloxwap/chart/ui';
 *
 * const menu = createChartContextMenu({
 *   chart, document, canvas,
 *   onChartSettings: () => settings.open(),
 *   onIndicatorSettings: (id) => openStudyDialog(id),
 * });
 * // later
 * menu.destroy();
 * ```
 *
 * The drawing toolbar builds the same menu with its `contextMenu` option.
 *
 * @module
 */

import type { Chart } from '../core/chart.js';
import type { ThemeName } from '../themes.js';
import { DrawingController } from './controller.js';
import type { UIDocument, UIElement, UIEvent } from './host.js';
import { el, menuItem, menuLabel, menuSeparator, requireWindow, type Flyouts, type MenuItemOptions } from './menu.js';
import { scaleToggleState, toggleScale } from './scale-buttons.js';
import { injectStyles } from './styles.js';

/**
 * What a context menu was opened on; `x`/`y` are canvas CSS pixels. A
 * `'chart'` target in an indicator sub-pane carries `paneId`, the id of the
 * indicator owning it (as in `CrosshairMoveEvent.paneId`). Its study actions
 * (`'indicator-settings'`, `'hide-indicator'`, `'remove-indicator'`) report
 * an `'indicator'` target for that study with an empty `key` (no plot was
 * hit), so indicator actions always come with an indicator target.
 */
export type ContextMenuTarget =
  | { readonly kind: 'drawing'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly kind: 'indicator'; readonly id: string; readonly key: string; readonly x: number; readonly y: number }
  | { readonly kind: 'chart'; readonly x: number; readonly y: number; readonly paneId?: string };

/** Built-in actions, reported to {@link ChartContextMenuHooks.onAction} after they run. */
export type ContextMenuAction =
  | 'drawing-settings' | 'clone' | 'lock' | 'unlock' | 'hide-drawing' | 'remove-drawing'
  | 'indicator-settings' | 'hide-indicator' | 'remove-indicator'
  | 'reset-view' | 'auto-scale' | 'log-scale' | 'percent-scale' | 'chart-settings'
  | 'remove-drawings' | 'remove-indicators';

/**
 * A host row appended by {@link ChartContextMenuHooks.extraItems}: a
 * {@link menuItem} (the menu closes before `onClick` runs), optionally a
 * checkbox row, or `'separator'`.
 */
export type ContextMenuEntry = (MenuItemOptions & { readonly checked?: boolean }) | 'separator';

/** Callbacks and extra rows, shared by {@link createChartContextMenu} and the toolbar's `contextMenu` option. */
export interface ChartContextMenuHooks {
  /** Adds "Chart settings…" to the chart menu. */
  onChartSettings?(): void;
  /** Adds "Settings…" to indicator menus. */
  onIndicatorSettings?(id: string): void;
  /** Adds "Settings…" to drawing menus. */
  onDrawingSettings?(id: string): void;
  /** Rows appended (after a separator) to the menu for `target`. */
  extraItems?(target: ContextMenuTarget): readonly ContextMenuEntry[];
  /** Called after each built-in action runs (e.g. to persist the layout). */
  onAction?(action: ContextMenuAction, target: ContextMenuTarget): void;
}

/** Options for {@link createChartContextMenu}. */
export interface ChartContextMenuOptions extends ChartContextMenuHooks {
  chart: Chart;
  /** Injected document (pass the browser `document`). */
  document: UIDocument;
  /** The chart's canvas element; right-clicks are read from it. */
  canvas: UIElement;
  /**
   * Drawing edits go through its history, so they are undoable, and an armed
   * tool makes a right-click cancel it instead of opening the menu. Default:
   * a private controller (see {@link ChartContextMenu.controller}), disposed by
   * {@link ChartContextMenu.destroy}; a controller passed here stays the caller's.
   */
  controller?: DrawingController;
  /** Render into these flyouts' portal (sharing its theme) and close them when the menu opens. */
  flyouts?: Flyouts;
  /** Initial theme of the menu's own portal (or the flyouts' portal when given). */
  theme?: ThemeName;
  /** Listen for `contextmenu` (and `pointerdown`) on the canvas. Default true; pass false to call {@link ChartContextMenu.open} yourself. */
  listen?: boolean;
}

/** Handle returned by {@link createChartContextMenu}. */
export interface ChartContextMenu {
  /** The menu element (`role="menu"`, class `cts-context-menu`). */
  readonly element: UIElement;
  /** The controller drawing actions go through; its history undoes them. */
  readonly controller: DrawingController;
  /** What the open menu targets, or null while closed. */
  readonly target: ContextMenuTarget | null;
  /**
   * What a right-click at canvas `(x, y)` would target: a drawing, else an
   * indicator plot, else the chart (and its sub-pane). The topmost drawing
   * wins, except after a finger press (`controller.touch`), when the
   * selected one wins under others, as it does for a tap or a drag.
   */
  targetAt(x: number, y: number): ContextMenuTarget;
  /** Opens the menu for canvas point `(x, y)` (CSS px) at that spot, flipped to stay in the viewport. */
  open(x: number, y: number): ContextMenuTarget;
  /** Closes the menu; focus inside it goes back to what had it before opening (else the canvas). */
  close(): void;
  /** Switches the portal between the dark and light UI themes. */
  setTheme(theme: ThemeName): void;
  /** Removes the menu, its portal (when owned) and all listeners, and disposes the controller it created. */
  destroy(): void;
}

/** Minimum gap (CSS px) between the menu and the viewport edges. */
const EDGE_PX = 8;

const MENU_LABELS: Readonly<Record<ContextMenuTarget['kind'], string>> = {
  drawing: 'Drawing actions',
  indicator: 'Indicator actions',
  chart: 'Chart actions',
};

/** Marks a row as a checkbox item showing `checked`. */
function checkable(item: UIElement, checked: boolean): UIElement {
  item.setAttribute('role', 'menuitemcheckbox');
  item.setAttribute('aria-checked', String(checked));
  item.classList.toggle('cts-active', checked);
  return item;
}

/** Attaches right-click context menus to a chart canvas. */
export function createChartContextMenu(options: ChartContextMenuOptions): ChartContextMenu {
  return attachContextMenu(options);
}

/** {@link createChartContextMenu}, running `prepare` (the toolbar's input flush) before each open. */
function attachContextMenu(options: ChartContextMenuOptions, prepare?: () => void): ChartContextMenu {
  const { chart, document: doc, canvas, flyouts } = options;
  const win = requireWindow(doc);
  // A private controller follows the chart's data loads: destroy() must dispose it.
  const ownsController = options.controller === undefined;
  const controller = options.controller ?? new DrawingController(chart, { navigation: false });
  injectStyles(doc);
  const ownsPortal = flyouts === undefined;
  const portal = ownsPortal ? el(doc, 'div', 'cts-theme') : flyouts.portal;
  if (ownsPortal) doc.body.append(portal);
  const menu = el(doc, 'div', 'cts-menu cts-context-menu');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('tabindex', '-1');
  portal.append(menu);
  let current: ContextMenuTarget | null = null;
  let items: UIElement[] = [];
  let focused = -1;
  /** Where focus returns on close: what had it before the menu opened, else the canvas. */
  let returnFocus: UIElement = canvas;
  /** Pointer type of the last press on the canvas, for a compat `contextmenu` that carries none. */
  let pressType: string | undefined;

  function targetAt(x: number, y: number): ContextMenuTarget {
    // After a finger press the selected drawing wins where another lies on top, as for its taps and drags.
    const drawing = chart.drawingAt(x, y, controller.hitTolerance, controller.touch ? chart.selectedDrawing : null);
    if (drawing !== null) return { kind: 'drawing', id: drawing, x, y };
    const hit = chart.indicatorAt(x, y);
    if (hit !== null) return { kind: 'indicator', id: hit.id, key: hit.key, x, y };
    const pane = chart.paneAt(y);
    return pane === null || pane === 'main' ? { kind: 'chart', x, y } : { kind: 'chart', x, y, paneId: pane };
  }

  /** Runs a built-in action: the menu closes first, and nothing runs once `live` says its drawing or study is gone. */
  function activate(target: ContextMenuTarget, action: ContextMenuAction, run: () => void, live: () => boolean): void {
    close();
    if (!live()) return;
    run();
    options.onAction?.(action, target);
  }

  function build(target: ContextMenuTarget): UIElement[] {
    const item = (label: string, action: ContextMenuAction, run: () => void, live: () => boolean, meta?: string): UIElement =>
      menuItem(doc, { label, ...(meta === undefined ? {} : { meta }), onClick: () => activate(target, action, run, live) });
    const always = (): boolean => true;
    /**
     * The study's name, then Settings… (with the hook), Hide and Remove, which
     * do nothing once it is gone; `onAction` gets the indicator target `study`.
     */
    const studyRows = (study: Extract<ContextMenuTarget, { kind: 'indicator' }>): UIElement[] => {
      const { id } = study;
      const name = chart.getIndicator(id)!.name;
      const live = (): boolean => chart.getIndicator(id) !== undefined;
      const row = (label: string, action: ContextMenuAction, run: () => void): UIElement =>
        menuItem(doc, { label, onClick: () => activate(study, action, run, live) });
      const { onIndicatorSettings } = options;
      const rows = [menuLabel(doc, chart.indicators.get(name)?.shortName ?? name)];
      if (onIndicatorSettings !== undefined) rows.push(row('Settings…', 'indicator-settings', () => onIndicatorSettings(id)));
      rows.push(
        row('Hide', 'hide-indicator', () => chart.updateIndicator(id, { visible: false })),
        menuSeparator(doc),
        row('Remove', 'remove-indicator', () => chart.removeIndicator(id)),
      );
      return rows;
    };
    const rows: UIElement[] = [];
    if (target.kind === 'drawing') {
      const { id } = target;
      const drawing = chart.getDrawing(id)!;
      const live = (): boolean => chart.getDrawing(id) !== undefined;
      const row = (label: string, action: ContextMenuAction, run: () => void): UIElement => item(label, action, run, live);
      const { onDrawingSettings } = options;
      rows.push(menuLabel(doc, controller.label(drawing.name)));
      if (onDrawingSettings !== undefined) rows.push(row('Settings…', 'drawing-settings', () => onDrawingSettings(id)));
      rows.push(
        row('Clone', 'clone', () => controller.clone(id)),
        row(drawing.locked ? 'Unlock' : 'Lock', drawing.locked ? 'unlock' : 'lock', () => controller.restyle(id, { locked: !drawing.locked })),
        row('Hide', 'hide-drawing', () => {
          controller.history.checkpoint();
          chart.updateDrawing(id, { visible: false });
          controller.select(null);
        }),
        menuSeparator(doc),
        row('Remove', 'remove-drawing', () => {
          controller.history.checkpoint();
          chart.removeDrawing(id);
          controller.select(null);
        }),
      );
    } else if (target.kind === 'indicator') {
      rows.push(...studyRows(target));
    } else {
      const { priceAxis, drawings, indicators } = chart.getConfig();
      const { onChartSettings } = options;
      rows.push(item('Reset chart view', 'reset-view', () => chart.resetScale(), always), menuSeparator(doc));
      const paneId = target.paneId;
      if (paneId !== undefined && chart.getIndicator(paneId) !== undefined) {
        // An indicator sub-pane: its study's actions; the main pane's price scale toggles would act elsewhere.
        rows.push(...studyRows({ kind: 'indicator', id: paneId, key: '', x: target.x, y: target.y }));
      } else {
        // The same toggles as the header and on-chart A / % / L buttons, which follow these at once.
        const pressed = scaleToggleState(priceAxis);
        const toggle = (label: string, action: ContextMenuAction, key: 'auto' | 'log' | 'percent'): UIElement =>
          checkable(menuItem(doc, { label, tick: true, onClick: () => activate(target, action, () => toggleScale(chart, key), always) }), pressed[key]);
        rows.push(
          menuLabel(doc, 'Price scale'),
          toggle('Auto (fits data to screen)', 'auto-scale', 'auto'),
          toggle('Logarithmic', 'log-scale', 'log'),
          toggle('Percent', 'percent-scale', 'percent'),
        );
      }
      const row = (label: string, action: ContextMenuAction, run: () => void, meta?: string): UIElement => item(label, action, run, always, meta);
      if (onChartSettings !== undefined) rows.push(menuSeparator(doc), row('Chart settings…', 'chart-settings', () => onChartSettings()));
      if (drawings.length + indicators.length > 0) rows.push(menuSeparator(doc));
      if (drawings.length > 0) rows.push(row('Remove all drawings', 'remove-drawings', () => controller.removeDrawings(), String(drawings.length)));
      if (indicators.length > 0) rows.push(row('Remove all indicators', 'remove-indicators', () => controller.removeIndicators(), String(indicators.length)));
    }
    const extra = options.extraItems?.(target) ?? [];
    if (extra.length > 0) rows.push(menuSeparator(doc));
    for (const entry of extra) {
      if (entry === 'separator') {
        rows.push(menuSeparator(doc));
        continue;
      }
      const item = menuItem(doc, {
        ...entry,
        tick: entry.tick === true || entry.checked !== undefined,
        onClick: () => {
          close();
          entry.onClick();
        },
      });
      rows.push(entry.checked === undefined ? item : checkable(item, entry.checked));
    }
    return rows;
  }

  /** Puts the menu's corner at viewport point `(left, top)`, flipped left/up when it would overflow. */
  function place(left: number, top: number): void {
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;
    const right = win.innerWidth ?? Infinity;
    const bottom = win.innerHeight;
    const x = left + width + EDGE_PX > right ? left - width : left;
    const y = top + height + EDGE_PX > bottom ? top - height : top;
    menu.style.left = `${Math.max(EDGE_PX, Math.min(x, right - width - EDGE_PX))}px`;
    menu.style.top = `${Math.max(EDGE_PX, Math.min(y, bottom - height - EDGE_PX))}px`;
  }

  // Dismissal while open: outside presses, Escape, scrolling, resizing, leaving the window, wheel zoom.
  const onOutside = (e: UIEvent): void => {
    if (!menu.contains(e.target)) close();
  };
  const onDocKey = (e: UIEvent): void => {
    if (e.key === 'Escape') close();
  };
  const onDismiss = (): void => close();
  function watch(on: boolean): void {
    const method = on ? 'addEventListener' : 'removeEventListener';
    doc[method]('pointerdown', onOutside);
    doc[method]('keydown', onDocKey);
    canvas[method]('wheel', onDismiss);
    win[method]?.('scroll', onOutside, true);
    win[method]?.('resize', onDismiss);
    win[method]?.('blur', onDismiss);
  }

  // Keys stay inside the open menu: arrows, Home and End move focus, Escape and Tab close it.
  menu.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'Tab') {
      close();
      return;
    }
    const last = items.length - 1;
    const next: Readonly<Record<string, number>> = {
      ArrowDown: focused < 0 || focused === last ? 0 : focused + 1,
      ArrowUp: focused <= 0 ? last : focused - 1,
      Home: 0,
      End: last,
    };
    const index = next[e.key!];
    if (index === undefined) return;
    e.preventDefault();
    items[index]!.focus();
  });
  menu.addEventListener('contextmenu', (e) => e.preventDefault());

  function open(x: number, y: number): ContextMenuTarget {
    prepare?.();
    const target = targetAt(x, y);
    flyouts?.close();
    if (target.kind === 'drawing' && !controller.locked) controller.select(target.id);
    const rows = build(target);
    items = rows.filter((row) => row.classList.contains('cts-item'));
    items.forEach((item, i) => item.addEventListener('focus', () => { focused = i; }));
    focused = -1;
    menu.replaceChildren(...rows);
    menu.setAttribute('aria-label', MENU_LABELS[target.kind]);
    if (current === null) {
      watch(true);
      const active = doc.activeElement;
      returnFocus = active == null || active === doc.body || menu.contains(active) ? canvas : (active as UIElement);
    }
    current = target;
    menu.classList.add('cts-open');
    const r = canvas.getBoundingClientRect();
    place(r.left + x, r.top + y);
    menu.focus();
    return target;
  }

  function close(): void {
    if (current === null) return;
    current = null;
    menu.classList.remove('cts-open');
    watch(false);
    if (menu.contains(doc.activeElement)) returnFocus.focus();
  }

  function setTheme(theme: ThemeName): void {
    portal.classList.toggle('cts-light', theme === 'light');
  }
  if (options.theme !== undefined) setTheme(options.theme);

  const onPress = (e: UIEvent): void => {
    pressType = e.pointerType;
  };
  const onContextMenu = (e: UIEvent): void => {
    // Handled already (an armed tool, another menu, a touch gesture) or a finger's long press: not ours.
    if (e.defaultPrevented === true || (e.pointerType ?? pressType) === 'touch') return;
    e.preventDefault();
    if (controller.contextMenu()) return; // an armed tool is cancelled instead
    const r = canvas.getBoundingClientRect();
    open(e.clientX! - r.left, e.clientY! - r.top);
  };
  const listen = options.listen !== false;
  if (listen) {
    canvas.addEventListener('pointerdown', onPress);
    canvas.addEventListener('contextmenu', onContextMenu);
  }

  return {
    element: menu,
    controller,
    get target() {
      return current;
    },
    targetAt,
    open,
    close,
    setTheme,
    destroy(): void {
      close();
      if (listen) {
        canvas.removeEventListener('pointerdown', onPress);
        canvas.removeEventListener('contextmenu', onContextMenu);
      }
      menu.remove();
      if (ownsPortal) portal.remove();
      if (ownsController) controller.dispose();
    },
  };
}

/**
 * @internal The drawing toolbar's menu for its `contextMenu` option (null
 * when off). It shares the toolbar's controller, so an armed tool's
 * right-click cancels it instead; `prepare` settles the toolbar's pending
 * input (pointer moves, navigation, the text editor) before each open, and
 * `onViewport` refreshes its viewport UI after every action. `defaults`
 * are the toolbar's own hooks (drawing Settings… opens its style bar); the
 * host's hooks replace them.
 */
export function toolbarContextMenu(
  setting: boolean | ChartContextMenuHooks | undefined,
  base: Pick<ChartContextMenuOptions, 'chart' | 'document' | 'canvas' | 'controller' | 'flyouts'>,
  onViewport: () => void,
  prepare: () => void,
  defaults: Pick<ChartContextMenuHooks, 'onDrawingSettings'> = {},
): ChartContextMenu | null {
  if (setting === undefined || setting === false) return null;
  const hooks: ChartContextMenuHooks = setting === true ? {} : setting;
  return attachContextMenu(
    {
      ...defaults,
      ...hooks,
      ...base,
      onAction: (action, target) => {
        onViewport();
        hooks.onAction?.(action, target);
      },
    },
    prepare,
  );
}
