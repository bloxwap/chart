/**
 * An optional vertical control rail: the header's controls stacked in a 52px
 * column beside the drawing toolbar, so the plot starts at the top of the
 * card. It holds a timeframe menu (drives a datafeed), a chart-type menu, an
 * Indicators button, the Auto / % / Log price-scale toggles, and slots for
 * host controls: `top` follows the built-in controls and scrolls with them,
 * `bottom` stays pinned at the rail's foot.
 *
 * ```ts
 * import { createControlRail } from '@bloxwap/chart/ui';
 *
 * const rail = createControlRail({
 *   chart, document,
 *   container: document.querySelector('#controls')!,
 *   datafeed,                          // picking 1h reloads the loaded symbol at 3_600_000
 *   flyouts: toolbar.flyouts,          // one menu open at a time with the drawing rail
 *   onIndicators: () => indicators.openPicker(),
 *   slots: { bottom: [settingsButton] },
 * });
 * ```
 *
 * @module
 */

import type { Chart } from '../core/chart.js';
import type { SeriesType } from '../config.js';
import type { ThemeName } from '../themes.js';
import type { UIDocument, UIElement } from './host.js';
import { ICONS } from './icons.js';
import { Flyouts, el, iconButton, labelButton, menuLabel, setButtonIcon, setButtonLabel } from './menu.js';
import { menuControls } from './menu-controls.js';
import { injectStyles } from './styles.js';
import { attachScrollableRail } from './rail-scroll.js';
import { createScaleToggleGroup } from './scale-buttons.js';
import {
  CHART_TYPE_LABELS, DEFAULT_CHART_TYPES, DEFAULT_HEADER_INTERVAL_MS, DEFAULT_TIMEFRAMES, intervalLabel,
  type HeaderDatafeed, type HeaderTimeframe,
} from './header.js';

/** Options for {@link createControlRail}. */
export interface ControlRailOptions {
  chart: Chart;
  /** Injected document (pass the browser `document`). */
  document: UIDocument;
  /** Element the rail is appended to; give it the rail's height, beside the drawing toolbar's rail. */
  container: UIElement;
  /** Symbol passed to the datafeed on a timeframe pick. A datafeed reporting its own `symbol` wins. */
  symbol?: string;
  /** Timeframe menu entries, in order. Default {@link DEFAULT_TIMEFRAMES}; `[]` hides the menu. */
  timeframes?: readonly HeaderTimeframe[];
  /** Initially selected interval in ms. Default {@link DEFAULT_HEADER_INTERVAL_MS}; a datafeed reporting its own `intervalMs` wins. */
  intervalMs?: number;
  /** Picking a timeframe calls `datafeed.setSymbol(symbol, intervalMs)` (when a symbol is known). */
  datafeed?: HeaderDatafeed;
  /** Called after the user picks a different timeframe. */
  onTimeframeChange?(timeframe: HeaderTimeframe): void;
  /** Chart-type menu entries. Default {@link DEFAULT_CHART_TYPES}; `[]` hides the menu. */
  chartTypes?: readonly SeriesType[];
  /** Called after the user picks a different chart type (already applied to `series.type`). */
  onChartTypeChange?(type: SeriesType): void;
  /** Shows the Indicators button, which calls this. */
  onIndicators?(): void;
  /** Auto / % / Log price-scale toggles. Default true. */
  scaleButtons?: boolean;
  /** Host controls: `top` follows the built-in controls (after a divider), `bottom` is pinned at the foot. */
  slots?: { top?: readonly UIElement[]; bottom?: readonly UIElement[] };
  /** Share the drawing toolbar's flyouts; by default the rail owns a set. */
  flyouts?: Flyouts;
  /** Default `'dark'`. */
  theme?: ThemeName;
}

/** Handle returned by {@link createControlRail}. */
export interface ControlRail {
  /** The rail. */
  readonly element: UIElement;
  /** The slot containers; append host controls to them, or move controls in and out (e.g. into a header on narrow screens). */
  readonly slots: { readonly top: UIElement; readonly bottom: UIElement };
  /** Symbol passed to the datafeed. */
  readonly symbol: string | undefined;
  /** Selected interval in ms. */
  readonly intervalMs: number;
  /** Sets the symbol for later timeframe picks, unless the datafeed reports its own. Does not call the datafeed. */
  setSymbol(symbol: string): void;
  /** Marks `intervalMs` as selected. Does not call the datafeed or `onTimeframeChange`. */
  setInterval(intervalMs: number): void;
  /** Applies `type` to `series.type` and updates the menu. Does not call `onChartTypeChange`. */
  setChartType(type: SeriesType): void;
  /** Switches between the dark and light UI tokens. */
  setTheme(theme: ThemeName): void;
  /**
   * Re-reads the chart config and the datafeed's symbol / interval. Config
   * changes already show once they render; this is for a datafeed without `subscribeState`.
   */
  refresh(): void;
  /** Removes the rail, its menus and every listener. */
  destroy(): void;
}

/** Icon size for rail buttons, matching the drawing rail's flyout buttons. */
const ICON_PX = 20;

/** Builds the control rail into `options.container`. */
export function createControlRail(options: ControlRailOptions): ControlRail {
  const { chart, document: doc } = options;
  injectStyles(doc);
  const cleanups: (() => void)[] = [];

  const root = el(doc, 'nav', 'cts-theme cts-rail cts-control-rail');
  root.setAttribute('aria-label', 'Chart controls');
  const scroll = el(doc, 'div', 'cts-rail-scroll');
  const footer = el(doc, 'div', 'cts-rail-footer');
  const portal = options.flyouts === undefined ? el(doc, 'div', 'cts-theme') : null;
  if (portal !== null) doc.body.append(portal);
  const flyouts = options.flyouts ?? new Flyouts(doc, portal!);
  const themed = portal === null ? [root] : [root, portal];
  const { dropdown, radioItem } = menuControls(doc, flyouts, cleanups);
  const menus: UIElement[] = [];
  /** A menu opening right of its button, headed by `label`, with hover intent like the drawing rail's. */
  const railMenu = (btn: UIElement, label: string): UIElement => {
    const menu = flyouts.create('cts-control-rail-menu');
    menu.append(menuLabel(doc, label));
    menus.push(menu);
    cleanups.push(flyouts.hover(btn, menu));
    return menu;
  };
  const divider = (): UIElement => el(doc, 'div', 'cts-rail-divider');

  // ------------------------------------------------------------ timeframe

  const datafeed = options.datafeed;
  let symbol = options.symbol ?? datafeed?.symbol ?? undefined;
  const timeframes = options.timeframes ?? DEFAULT_TIMEFRAMES;
  let interval = options.intervalMs ?? datafeed?.intervalMs ?? DEFAULT_HEADER_INTERVAL_MS;
  const tfBtn = labelButton(doc, '', 'Timeframe');
  const tfMenu = railMenu(tfBtn, 'Timeframe');
  const tfItems = timeframes.map((tf) => radioItem(tfMenu, tfBtn, tf.label, undefined, () => pickTimeframe(tf)));
  dropdown(tfBtn, tfMenu, tfItems);

  function syncTimeframes(): void {
    timeframes.forEach((tf, i) => {
      const on = tf.intervalMs === interval;
      tfItems[i].classList.toggle('cts-active', on);
      tfItems[i].setAttribute('aria-checked', String(on));
    });
    const label = timeframes.find((tf) => tf.intervalMs === interval)?.label ?? intervalLabel(interval);
    setButtonLabel(tfBtn, label);
    tfBtn.title = `Timeframe: ${label}`;
    tfBtn.setAttribute('aria-label', tfBtn.title);
  }
  function pickTimeframe(tf: HeaderTimeframe): void {
    // The datafeed's own symbol and interval win: they are what the chart shows.
    if (tf.intervalMs === interval && tf.intervalMs === (datafeed?.intervalMs ?? interval)) return;
    interval = tf.intervalMs;
    syncTimeframes();
    const loaded = datafeed?.symbol ?? symbol;
    if (loaded !== undefined) datafeed?.setSymbol(loaded, interval);
    options.onTimeframeChange?.(tf);
  }
  /** Adopts the symbol and interval a datafeed reports. */
  function follow(state: Pick<HeaderDatafeed, 'symbol' | 'intervalMs'>): void {
    if (typeof state.symbol === 'string') symbol = state.symbol;
    if (typeof state.intervalMs === 'number' && state.intervalMs !== interval) {
      interval = state.intervalMs;
      syncTimeframes();
    }
  }

  // ------------------------------------------------------------ chart type

  const chartTypes = options.chartTypes ?? DEFAULT_CHART_TYPES;
  const typeBtn = iconButton(doc, 'chart-candlestick', 'Chart type', ICON_PX);
  const typeMenu = railMenu(typeBtn, 'Chart type');
  const typeItems = chartTypes.map((type) => radioItem(typeMenu, typeBtn, CHART_TYPE_LABELS[type], `chart-${type}`, () => pickType(type)));
  dropdown(typeBtn, typeMenu, typeItems);
  let shownType: string | null = null;

  function syncType(): void {
    const type = chart.getConfig().series.type;
    if (type === shownType) return;
    shownType = type;
    // A custom series (e.g. a footprint) has no glyph of its own: keep the candlestick.
    setButtonIcon(typeBtn, ICONS[`chart-${type}`] !== undefined ? `chart-${type}` : 'chart-candlestick', ICON_PX);
    typeBtn.title = `Chart type: ${CHART_TYPE_LABELS[type as SeriesType] ?? type}`;
    typeBtn.setAttribute('aria-label', typeBtn.title);
    chartTypes.forEach((t, i) => {
      typeItems[i].classList.toggle('cts-active', t === type);
      typeItems[i].setAttribute('aria-checked', String(t === type));
    });
  }
  function applyType(type: SeriesType): boolean {
    const changed = chart.getConfig().series.type !== type;
    if (changed) chart.updateConfig({ series: { type } });
    syncType();
    return changed;
  }
  function pickType(type: SeriesType): void {
    if (applyType(type)) options.onChartTypeChange?.(type);
  }

  // ------------------------------------------------------------ indicators, scale, slots

  const controls: UIElement[] = [];
  if (timeframes.length > 0) controls.push(tfBtn);
  if (chartTypes.length > 0) controls.push(typeBtn);
  const onIndicators = options.onIndicators;
  if (onIndicators !== undefined) {
    const b = iconButton(doc, 'function-square', 'Indicators', ICON_PX);
    b.setAttribute('aria-label', 'Indicators');
    b.setAttribute('aria-haspopup', 'dialog');
    b.addEventListener('click', onIndicators);
    cleanups.push(() => b.removeEventListener('click', onIndicators));
    controls.push(b);
  }
  const scale = options.scaleButtons === false ? null : createScaleToggleGroup(doc, chart, 'cts-btn cts-rail-scale', false);
  if (scale !== null) {
    const group = el(doc, 'div', 'cts-control-rail-group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Price scale');
    group.append(...scale.buttons);
    if (controls.length > 0) controls.push(divider());
    controls.push(group);
    cleanups.push(scale.destroy);
  }
  const top = el(doc, 'div', 'cts-control-rail-slot');
  top.append(...(options.slots?.top ?? []));
  if (controls.length > 0) controls.push(divider());
  scroll.append(...controls, top);
  footer.append(...(options.slots?.bottom ?? []));
  root.append(scroll, footer);
  cleanups.push(chart.subscribeConfigChange(({ keys }) => { if (keys.includes('series')) syncType(); }));

  // ------------------------------------------------------------ boot

  const setTheme = (theme: ThemeName): void => {
    for (const node of themed) node.classList.toggle('cts-light', theme === 'light');
  };
  function refresh(): void {
    if (datafeed !== undefined) follow(datafeed);
    syncType();
    if (scale !== null) scale.sync();
    syncTimeframes();
  }
  setTheme(options.theme ?? 'dark');
  options.container.append(root);
  // Paging arrows and edge fades once the controls outgrow the rail; needs the scroll column in the DOM.
  cleanups.push(attachScrollableRail(doc, scroll));
  refresh();
  const unfollow = datafeed?.subscribeState?.(follow);
  if (unfollow !== undefined) cleanups.push(unfollow);

  return {
    element: root,
    slots: { top, bottom: footer },
    get symbol() { return symbol; },
    get intervalMs() { return interval; },
    setSymbol(next): void {
      symbol = next;
    },
    setInterval(intervalMs): void {
      interval = intervalMs;
      syncTimeframes();
    },
    setChartType(type): void {
      applyType(type);
    },
    setTheme,
    refresh,
    destroy(): void {
      for (const cleanup of cleanups) cleanup();
      if (menus.includes(flyouts.open as UIElement)) flyouts.close();
      for (const menu of menus) menu.remove();
      root.remove();
      if (portal !== null) {
        flyouts.destroy();
        portal.remove();
      }
    },
  };
}
