/**
 * Price-scale quick toggles (Auto, Percent, Log), shared by the chart header
 * and the TradingView-style buttons at the foot of the price axis. They edit
 * the existing `priceAxis.autoScale` / `priceAxis.mode` config and follow it
 * through {@link Chart.subscribeConfigChange}, so a change from anywhere (the
 * Alt+P / Alt+L shortcuts, the settings panel, `updateConfig`) shows at once.
 *
 * ```ts
 * import { createScaleButtons } from '@bloxwap/chart/ui';
 *
 * const buttons = createScaleButtons({ chart, document, overlay: stage });
 * chart.updateConfig({ priceAxis: { mode: 'logarithmic' } }); // the L button lights up
 * ```
 *
 * @module
 */

import type { Chart, LayoutChangeEvent } from '../core/chart.js';
import type { PriceAxisConfig } from '../config.js';
import type { ThemeName } from '../themes.js';
import type { UIDocument, UIElement } from './host.js';
import { el, requireWindow } from './menu.js';
import { headerTokensFor, injectHeaderStyles, swapTokens, type HeaderTokens, type ThemedHeaderTokens } from './header-styles.js';

/** A price-scale quick toggle. */
export type ScaleToggle = 'auto' | 'percent' | 'log';

/** Which quick toggles show as pressed. */
export interface ScaleToggleState {
  readonly auto: boolean;
  readonly percent: boolean;
  readonly log: boolean;
}

/** Quick toggles in display order, with header labels, on-chart letters and titles. */
export const SCALE_TOGGLES: readonly { readonly key: ScaleToggle; readonly label: string; readonly short: string; readonly title: string }[] = [
  { key: 'auto', label: 'Auto', short: 'A', title: 'Auto (fits data to screen)' },
  { key: 'percent', label: '%', short: '%', title: 'Percent scale' },
  { key: 'log', label: 'Log', short: 'L', title: 'Logarithmic scale' },
];

/** Pressed state for a price axis; `'indexed'` presses neither % nor Log. */
export function scaleToggleState(axis: Pick<PriceAxisConfig, 'autoScale' | 'mode'>): ScaleToggleState {
  return { auto: axis.autoScale, percent: axis.mode === 'percent', log: axis.mode === 'logarithmic' };
}

/** Toggle groups per chart, for {@link syncScaleToggles}. */
const groups = new WeakMap<Chart, Set<() => void>>();

/**
 * Re-syncs every quick-toggle group bound to `chart` right away. Groups already
 * follow each rendered price-axis change; call this only to update them inside
 * a {@link Chart.batch} or after the chart is destroyed.
 */
export function syncScaleToggles(chart: Chart): void {
  for (const sync of groups.get(chart) ?? []) sync();
}

/**
 * Flips one quick toggle: Auto toggles `priceAxis.autoScale`; % and Log switch
 * `priceAxis.mode` to percent / logarithmic or back to regular (so they are
 * mutually exclusive) and release the price-to-bar ratio like Alt+P / Alt+L.
 */
export function toggleScale(chart: Chart, toggle: ScaleToggle): void {
  const axis = chart.getConfig().priceAxis;
  if (toggle === 'auto') chart.updateConfig({ priceAxis: { autoScale: !axis.autoScale } });
  else {
    const mode = toggle === 'percent' ? 'percent' : 'logarithmic';
    chart.updateConfig({ priceAxis: { mode: axis.mode === mode ? 'regular' : mode, priceToBarRatio: null } });
  }
  syncScaleToggles(chart);
}

/** Buttons for the three toggles, kept in sync with the chart. */
export interface ScaleToggleGroup {
  /** Auto, %, Log buttons in order. */
  readonly buttons: readonly UIElement[];
  /** Reflects the chart's current scale config (the group also does this after every price-axis change). */
  sync(): void;
  /** Removes listeners and stops syncing (the buttons stay where the caller put them). */
  destroy(): void;
}

/** Builds toggle buttons with class `className`, labelled with full labels or on-chart letters (`short`). */
export function createScaleToggleGroup(doc: UIDocument, chart: Chart, className: string, short: boolean): ScaleToggleGroup {
  const cleanups: (() => void)[] = [];
  const buttons = SCALE_TOGGLES.map(({ key, label, short: letter, title }) => {
    const button = el(doc, 'button', className);
    button.textContent = short ? letter : label;
    button.title = title;
    button.setAttribute('type', 'button');
    button.setAttribute('aria-label', title);
    button.setAttribute('data-scale', key);
    const click = (): void => toggleScale(chart, key);
    button.addEventListener('click', click);
    cleanups.push(() => button.removeEventListener('click', click));
    return button;
  });
  let shown = '';
  const sync = (): void => {
    const state = scaleToggleState(chart.getConfig().priceAxis);
    const key = SCALE_TOGGLES.map((t) => Number(state[t.key])).join('');
    if (key === shown) return;
    shown = key;
    buttons.forEach((button, i) => {
      const on = state[SCALE_TOGGLES[i].key];
      button.classList.toggle('cts-on', on);
      button.setAttribute('aria-pressed', String(on));
    });
  };
  let set = groups.get(chart);
  if (set === undefined) groups.set(chart, set = new Set());
  const members = set;
  members.add(sync);
  cleanups.push(chart.subscribeConfigChange(({ keys }) => { if (keys.includes('priceAxis')) sync(); }));
  sync();
  return {
    buttons,
    sync,
    destroy(): void {
      members.delete(sync);
      for (const cleanup of cleanups) cleanup();
    },
  };
}

/** Options for {@link createScaleButtons}. */
export interface ScaleButtonsOptions {
  chart: Chart;
  /** Injected document (pass the browser `document`). */
  document: UIDocument;
  /** Positioned element wrapping the canvas (e.g. the toolbar's `overlay`); the buttons render inside it. */
  overlay: UIElement;
  /** The chart canvas, when it does not sit at the overlay's top-left corner. */
  canvas?: UIElement;
  /** Default `'dark'`. */
  theme?: ThemeName;
  /**
   * Custom-property overrides set inline: one set for both themes, e.g.
   * {@link import('./header-styles.js').BLOXWAP_HEADER_TOKENS}, or one per theme,
   * e.g. {@link import('./header-styles.js').BLOXWAP_HEADER_THEME}, swapped by {@link ScaleButtons.setTheme}.
   */
  tokens?: HeaderTokens | ThemedHeaderTokens;
}

/** Handle returned by {@link createScaleButtons}. */
export interface ScaleButtons {
  /** The positioned button strip. */
  readonly element: UIElement;
  /** Re-reads the scale config and re-measures the canvas inside the overlay (e.g. after it moved without resizing). */
  refresh(): void;
  /** Switches between the dark and light UI tokens, and to that theme's `tokens` set. */
  setTheme(theme: ThemeName): void;
  /** Removes the buttons and every listener. */
  destroy(): void;
}

/**
 * TradingView-style `A` / `%` / `L` toggles at the bottom of the main pane's
 * price axis, just above the time axis. They follow the axis to either side,
 * track chart resizes and sub-panes, and hide while the price axis is hidden,
 * all through {@link Chart.subscribeLayoutChange}; nothing runs on plain
 * scroll or zoom frames.
 */
export function createScaleButtons(options: ScaleButtonsOptions): ScaleButtons {
  const { chart, document: doc, overlay, canvas } = options;
  const win = requireWindow(doc);
  injectHeaderStyles(doc);
  const root = el(doc, 'div', 'cts-theme cts-scale-buttons');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Price scale');
  const group = createScaleToggleGroup(doc, chart, 'cts-scale-btn', true);
  root.append(...group.buttons);
  overlay.append(root);

  // DOM reads happen only when the canvas size changes; styles are written only when the box moves.
  let offsetX = 0;
  let offsetY = 0;
  let hostWidth = 0;
  let canvasSize = '';
  let box = '';
  function measure(): void {
    if (canvas !== undefined) {
      const c = canvas.getBoundingClientRect();
      const o = overlay.getBoundingClientRect();
      offsetX = c.left - o.left;
      offsetY = c.top - o.top;
    }
    hostWidth = (canvas ?? overlay).clientWidth;
  }
  function place(): void {
    const axis = chart.getConfig().priceAxis;
    const plot = chart.plotArea;
    const left = axis.position === 'left' ? 0 : plot.left + plot.width;
    const width = axis.position === 'left' ? plot.left : hostWidth - left;
    const shown = axis.visible && plot.height > 0 && width > 0;
    const next = shown ? `${offsetX + left} ${offsetY} ${width} ${plot.height}` : 'none';
    if (next === box) return;
    box = next;
    root.style.display = shown ? '' : 'none';
    if (!shown) return;
    root.style.left = `${offsetX + left}px`;
    root.style.top = `${offsetY}px`;
    root.style.width = `${width}px`;
    root.style.height = `${plot.height}px`;
  }
  function relayout(event: LayoutChangeEvent): void {
    const size = `${event.width}x${event.height}`;
    if (size !== canvasSize) {
      canvasSize = size;
      measure();
    }
    place();
  }
  function refresh(): void {
    group.sync();
    measure();
    place();
  }

  const cleanups: (() => void)[] = [group.destroy, chart.subscribeLayoutChange(relayout)];
  if (win.ResizeObserver !== undefined) {
    const observer = new win.ResizeObserver(refresh);
    observer.observe(canvas ?? overlay);
    cleanups.push(() => observer.disconnect());
  }
  let tokens: HeaderTokens = {};
  const setTheme = (theme: ThemeName): void => {
    root.classList.toggle('cts-light', theme === 'light');
    const next = headerTokensFor(options.tokens, theme);
    // A DOM without per-property access replaced the whole inline style: write the box again.
    if (swapTokens(root, tokens, next)) {
      box = '';
      place();
    }
    tokens = next;
  };
  setTheme(options.theme ?? 'dark');
  refresh();

  return {
    element: root,
    refresh,
    setTheme,
    destroy(): void {
      for (const cleanup of cleanups) cleanup();
      root.remove();
    },
  };
}
