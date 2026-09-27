/**
 * An optional TradingView-style header bar: symbol, timeframe switcher (drives
 * a datafeed), chart-type menu, indicators button, price-scale quick toggles
 * and slots for host controls. It is a normal-flow bar the host places above
 * the chart; skip it to keep your own header, since nothing else depends on it.
 *
 * ```ts
 * import { createChartHeader, BLOXWAP_HEADER_THEME } from '@bloxwap/chart/ui';
 *
 * const header = createChartHeader({
 *   chart, document,
 *   container: document.querySelector('#chart-header')!,
 *   symbol: 'BTC', datafeed,           // picking 1h calls datafeed.setSymbol('BTC', 3_600_000)
 *   onIndicators: () => openIndicatorPicker(),
 *   slots: { right: [fullscreenButton] },
 *   tokens: BLOXWAP_HEADER_THEME,      // the bloxwap.pro look on dark
 * });
 * ```
 *
 * @module
 */

import type { Chart } from '../core/chart.js';
import type { SeriesType } from '../config.js';
import type { ThemeName } from '../themes.js';
import type { UIDocument, UIElement, UIEvent } from './host.js';
import { icon } from './icons.js';
import { Flyouts, addCaret, el, menuItem, requireWindow, setButtonIcon } from './menu.js';
import { headerTokensFor, injectHeaderStyles, swapTokens, type HeaderTokens, type ThemedHeaderTokens } from './header-styles.js';
import { createScaleToggleGroup } from './scale-buttons.js';

/** A timeframe choice in the header. */
export interface HeaderTimeframe {
  /** Button text, e.g. `'15m'`. */
  readonly label: string;
  /** Bar interval in ms, passed to the datafeed. */
  readonly intervalMs: number;
}

/** bloxwap.pro's timeframes: 1m 5m 15m 1h 4h 1d 3d 1w 1M (1M spans 30 days). */
export const DEFAULT_TIMEFRAMES: readonly HeaderTimeframe[] = [
  { label: '1m', intervalMs: 60_000 },
  { label: '5m', intervalMs: 300_000 },
  { label: '15m', intervalMs: 900_000 },
  { label: '1h', intervalMs: 3_600_000 },
  { label: '4h', intervalMs: 14_400_000 },
  { label: '1d', intervalMs: 86_400_000 },
  { label: '3d', intervalMs: 259_200_000 },
  { label: '1w', intervalMs: 604_800_000 },
  { label: '1M', intervalMs: 2_592_000_000 },
];

/** Initial header interval: 15 minutes. */
export const DEFAULT_HEADER_INTERVAL_MS = 900_000;

/** Chart types offered by default. */
export const DEFAULT_CHART_TYPES: readonly SeriesType[] = ['candlestick', 'hollow-candlestick', 'heikin-ashi', 'bar', 'line', 'area'];

/** Menu label per series type. */
export const CHART_TYPE_LABELS: Readonly<Record<SeriesType, string>> = {
  candlestick: 'Candles',
  'hollow-candlestick': 'Hollow candles',
  'heikin-ashi': 'Heikin Ashi',
  bar: 'Bars',
  line: 'Line',
  area: 'Area',
  histogram: 'Columns',
};

/**
 * The datafeed surface the header drives; the `@bloxwap/chart/datafeed`
 * datafeed satisfies it. When it reports its own `symbol` / `intervalMs`, the
 * header treats those as the truth: it starts from them, reloads the loaded
 * symbol on a timeframe pick, and (with `subscribeState`) follows switches
 * made elsewhere.
 */
export interface HeaderDatafeed {
  /** Loads `symbol` at `intervalMs` bars. */
  setSymbol(symbol: string, intervalMs: number): unknown;
  /** The loaded symbol, or null before the first load. */
  readonly symbol?: string | null;
  /** The loaded interval in ms, or null before the first load. */
  readonly intervalMs?: number | null;
  /** Calls `listener` with each new state; returns an unsubscribe function. */
  subscribeState?(listener: (state: Pick<HeaderDatafeed, 'symbol' | 'intervalMs'>) => void): () => void;
}

/** Options for {@link createChartHeader}. */
export interface ChartHeaderOptions {
  chart: Chart;
  /** Injected document (pass the browser `document`). */
  document: UIDocument;
  /** Element the bar is appended to; place it above the chart canvas. */
  container: UIElement;
  /** Symbol passed to the datafeed; also the label unless `symbolLabel` is set. A datafeed reporting its own `symbol` wins. */
  symbol?: string;
  /** Displayed symbol text or element. No symbol and no label hides it. */
  symbolLabel?: string | UIElement;
  /** Timeframe buttons, in order. Default {@link DEFAULT_TIMEFRAMES}; `[]` hides the switcher. */
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
  /** Host controls: `left` follows the built-in controls, `right` ends the bar. */
  slots?: { left?: readonly UIElement[]; right?: readonly UIElement[] };
  /** Share the drawing toolbar's flyouts; by default the header owns a set. */
  flyouts?: Flyouts;
  /** Default `'dark'`. */
  theme?: ThemeName;
  /**
   * Collapse the timeframes into a dropdown (and the Indicators label into its
   * icon): `'auto'` (default) whenever the bar overflows, or always / never.
   */
  compact?: boolean | 'auto';
  /**
   * Custom-property overrides set inline on the bar and its menus (shared
   * flyouts included): one set for both themes, e.g.
   * {@link import('./header-styles.js').BLOXWAP_HEADER_TOKENS}, or one per
   * theme, e.g. {@link import('./header-styles.js').BLOXWAP_HEADER_THEME},
   * swapped by {@link ChartHeader.setTheme}.
   */
  tokens?: HeaderTokens | ThemedHeaderTokens;
}

/** Handle returned by {@link createChartHeader}. */
export interface ChartHeader {
  /** The header bar. */
  readonly element: UIElement;
  /** Symbol passed to the datafeed. */
  readonly symbol: string | undefined;
  /** Selected interval in ms. */
  readonly intervalMs: number;
  /** Whether the bar is currently compacted. */
  readonly compact: boolean;
  /**
   * Sets the symbol (for later timeframe picks, unless the datafeed reports
   * its own) and its label (default: the symbol). Does not call the datafeed.
   */
  setSymbol(symbol: string, label?: string | UIElement): void;
  /** Marks `intervalMs` as selected. Does not call the datafeed or `onTimeframeChange`. */
  setInterval(intervalMs: number): void;
  /** Applies `type` to `series.type` and updates the menu. Does not call `onChartTypeChange`. */
  setChartType(type: SeriesType): void;
  /** Switches between the dark and light UI tokens, and to that theme's `tokens` set. */
  setTheme(theme: ThemeName): void;
  /**
   * Re-reads the chart config and the datafeed's symbol / interval, and re-fits
   * the bar. Config changes already show once they render (see
   * {@link Chart.subscribeConfigChange}); this is for a datafeed without `subscribeState`.
   */
  refresh(): void;
  /** Removes the bar, its menus and every listener. */
  destroy(): void;
}

const UNITS: readonly (readonly [number, string])[] = [
  [2_592_000_000, 'M'], [604_800_000, 'w'], [86_400_000, 'd'], [3_600_000, 'h'], [60_000, 'm'], [1000, 's'],
];

/** Short label for an interval outside the timeframe list, e.g. `2h`. */
function intervalLabel(ms: number): string {
  for (const [size, unit] of UNITS) if (ms >= size && ms % size === 0) return `${ms / size}${unit}`;
  return `${ms}ms`;
}

/** No-op `menuItem` handler; the header wires clicks itself so destroy can remove them. */
const ignore = (): void => undefined;

/** Builds the header bar into `options.container`. */
export function createChartHeader(options: ChartHeaderOptions): ChartHeader {
  const { chart, document: doc } = options;
  const win = requireWindow(doc);
  injectHeaderStyles(doc);
  const cleanups: (() => void)[] = [];
  const listen = (target: UIElement, type: string, fn: (e: UIEvent) => void): void => {
    target.addEventListener(type, fn);
    cleanups.push(() => target.removeEventListener(type, fn));
  };

  const root = el(doc, 'div', 'cts-theme cts-header');
  // Every control is its own tab stop, so this is a labelled group rather than an arrow-key toolbar.
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Chart header');
  const portal = options.flyouts === undefined ? el(doc, 'div', 'cts-theme') : null;
  if (portal !== null) doc.body.append(portal);
  const flyouts = options.flyouts ?? new Flyouts(doc, portal!);
  /** Nodes carrying the `tokens`: the bar and its menus, which take them so they also reach a shared toolbar portal. */
  const tokenNodes = [root];
  const createMenu = (): UIElement => {
    const menu = flyouts.create('cts-header-menu', 'below');
    tokenNodes.push(menu);
    return menu;
  };
  const themed = portal === null ? [root] : [root, portal];

  const button = (className: string, html: string, title: string): UIElement => {
    const b = el(doc, 'button', `cts-header-btn ${className}`, html);
    b.title = title;
    b.setAttribute('type', 'button');
    return b;
  };
  /** Click toggles `menu` below `btn`; arrows, Home/End, Escape and Tab drive it from the keyboard. */
  const dropdown = (btn: UIElement, menu: UIElement, items: readonly UIElement[]): void => {
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
    const escape = (e: UIEvent): void => {
      if (e.key !== 'Escape' || flyouts.open !== menu) return;
      flyouts.close();
      btn.focus();
    };
    doc.addEventListener('keydown', escape);
    cleanups.push(() => doc.removeEventListener('keydown', escape));
  };
  /** A checkable entry; picking it closes `menu` and, when focus was inside, returns it to `owner`. */
  const radioItem = (menu: UIElement, owner: UIElement, label: string, iconName: string | undefined, onPick: () => void): UIElement => {
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
  };

  // ------------------------------------------------------------ symbol

  const datafeed = options.datafeed;
  let symbol = options.symbol ?? datafeed?.symbol ?? undefined;
  const symbolEl = el(doc, 'div', 'cts-header-symbol');
  const showSymbol = (label: string | UIElement | undefined): void => {
    symbolEl.replaceChildren(...(label === undefined ? [] : [label]));
    symbolEl.style.display = label === undefined || label === '' ? 'none' : '';
  };
  showSymbol(options.symbolLabel ?? symbol);

  // ------------------------------------------------------------ timeframes

  const timeframes = options.timeframes ?? DEFAULT_TIMEFRAMES;
  let interval = options.intervalMs ?? datafeed?.intervalMs ?? DEFAULT_HEADER_INTERVAL_MS;
  const tfGroup = el(doc, 'div', 'cts-header-group cts-header-timeframes');
  tfGroup.setAttribute('role', 'group');
  tfGroup.setAttribute('aria-label', 'Timeframe');
  const tfMenu = createMenu();
  const tfMenuBtn = button('cts-header-tf-menu', '<span class="cts-header-tf-label"></span>', 'Timeframe');
  const tfButtons: UIElement[] = [];
  const tfItems: UIElement[] = [];
  for (const tf of timeframes) {
    const b = button('cts-header-tf', '', `Interval ${tf.label}`);
    b.textContent = tf.label;
    listen(b, 'click', () => pickTimeframe(tf));
    tfGroup.append(b);
    tfButtons.push(b);
    tfItems.push(radioItem(tfMenu, tfMenuBtn, tf.label, undefined, () => pickTimeframe(tf)));
  }
  dropdown(tfMenuBtn, tfMenu, tfItems);

  function syncTimeframes(): void {
    timeframes.forEach((tf, i) => {
      const on = tf.intervalMs === interval;
      tfButtons[i].classList.toggle('cts-active', on);
      tfButtons[i].setAttribute('aria-pressed', String(on));
      tfItems[i].classList.toggle('cts-active', on);
      tfItems[i].setAttribute('aria-checked', String(on));
    });
    const label = timeframes.find((tf) => tf.intervalMs === interval)?.label ?? intervalLabel(interval);
    (tfMenuBtn.querySelector('.cts-header-tf-label') as UIElement).textContent = label;
    tfMenuBtn.title = `Timeframe: ${label}`;
    tfMenuBtn.setAttribute('aria-label', tfMenuBtn.title);
  }
  function pickTimeframe(tf: HeaderTimeframe): void {
    // The datafeed's own symbol and interval win: they are what the chart shows.
    if (tf.intervalMs === interval && tf.intervalMs === (datafeed?.intervalMs ?? interval)) return;
    interval = tf.intervalMs;
    syncTimeframes();
    fit();
    const loaded = datafeed?.symbol ?? symbol;
    if (loaded !== undefined) datafeed?.setSymbol(loaded, interval);
    options.onTimeframeChange?.(tf);
  }
  /** Adopts the symbol and interval a datafeed reports, re-fitting the bar when either changed. */
  function follow(state: Pick<HeaderDatafeed, 'symbol' | 'intervalMs'>): void {
    let changed = false;
    if (typeof state.symbol === 'string' && state.symbol !== symbol) {
      symbol = state.symbol;
      showSymbol(symbol);
      changed = true;
    }
    if (typeof state.intervalMs === 'number' && state.intervalMs !== interval) {
      interval = state.intervalMs;
      syncTimeframes();
      changed = true;
    }
    if (changed) fit();
  }

  // ------------------------------------------------------------ chart type

  const chartTypes = options.chartTypes ?? DEFAULT_CHART_TYPES;
  const typeMenu = createMenu();
  const typeBtn = button('cts-header-type', icon('chart-candlestick', 18), 'Chart type');
  const typeItems = chartTypes.map((type) => radioItem(typeMenu, typeBtn, CHART_TYPE_LABELS[type], `chart-${type}`, () => pickType(type)));
  dropdown(typeBtn, typeMenu, typeItems);
  let shownType: SeriesType | null = null;

  function syncType(): void {
    const type = chart.getConfig().series.type;
    if (type === shownType) return;
    shownType = type;
    setButtonIcon(typeBtn, `chart-${type}`, 18);
    typeBtn.title = `Chart type: ${CHART_TYPE_LABELS[type]}`;
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

  const nodes: UIElement[] = [symbolEl];
  if (timeframes.length > 0) nodes.push(tfGroup, tfMenuBtn);
  if (chartTypes.length > 0) nodes.push(typeBtn);
  const onIndicators = options.onIndicators;
  if (onIndicators !== undefined) {
    const b = button('cts-header-indicators', `${icon('function-square', 18)}<span class="cts-header-text">Indicators</span>`, 'Indicators');
    b.setAttribute('aria-label', 'Indicators');
    b.setAttribute('aria-haspopup', 'dialog');
    listen(b, 'click', () => onIndicators());
    nodes.push(b);
  }
  const leftSlot = el(doc, 'div', 'cts-header-slot cts-header-slot-left');
  leftSlot.append(...(options.slots?.left ?? []));
  nodes.push(leftSlot, el(doc, 'div', 'cts-header-spacer'));
  const scale = options.scaleButtons === false ? null : createScaleToggleGroup(doc, chart, 'cts-header-btn cts-header-scale-btn', false);
  if (scale !== null) {
    const group = el(doc, 'div', 'cts-header-group cts-header-scale');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Price scale');
    group.append(...scale.buttons);
    nodes.push(group);
    cleanups.push(scale.destroy);
  }
  const rightSlot = el(doc, 'div', 'cts-header-slot cts-header-slot-right');
  rightSlot.append(...(options.slots?.right ?? []));
  nodes.push(rightSlot);
  root.append(...nodes);

  // A series change re-syncs the type button once it renders (the scale group follows the price axis
  // on its own), so the toolbar's shortcuts, the settings panel and host code all show at once.
  cleanups.push(chart.subscribeConfigChange(({ keys }) => { if (keys.includes('series')) syncType(); }));

  // ------------------------------------------------------------ responsive compaction

  const compactMode = options.compact ?? 'auto';
  let compact = false;
  const setCompact = (on: boolean): void => {
    compact = on;
    root.classList.toggle('cts-header-compact', on);
  };
  function fit(): void {
    if (compactMode !== 'auto') {
      setCompact(compactMode);
      return;
    }
    // Measure the expanded bar and compact it again within the same frame: nothing flickers,
    // and content that grew or shrank (a longer symbol, a busier slot) is judged afresh.
    setCompact(false);
    if (root.scrollWidth > root.clientWidth) setCompact(true);
  }
  if (win.ResizeObserver !== undefined) {
    // The bar's own width, plus the pieces whose content the host changes.
    const observer = new win.ResizeObserver(fit);
    for (const node of [root, symbolEl, leftSlot, rightSlot]) observer.observe(node);
    cleanups.push(() => observer.disconnect());
  }

  // ------------------------------------------------------------ boot

  let tokens: HeaderTokens = {};
  const setTheme = (theme: ThemeName): void => {
    for (const node of themed) node.classList.toggle('cts-light', theme === 'light');
    const next = headerTokensFor(options.tokens, theme);
    for (const node of tokenNodes) swapTokens(node, tokens, next);
    tokens = next;
  };
  function refresh(): void {
    if (datafeed !== undefined) follow(datafeed);
    syncType();
    if (scale !== null) scale.sync();
    syncTimeframes();
    fit();
  }
  setTheme(options.theme ?? 'dark');
  options.container.append(root);
  refresh();
  const unfollow = datafeed?.subscribeState?.(follow);
  if (unfollow !== undefined) cleanups.push(unfollow);

  return {
    element: root,
    get symbol() { return symbol; },
    get intervalMs() { return interval; },
    get compact() { return compact; },
    setSymbol(next, label = next): void {
      symbol = next;
      showSymbol(label);
      fit();
    },
    setInterval(intervalMs): void {
      interval = intervalMs;
      syncTimeframes();
      fit();
    },
    setChartType(type): void {
      applyType(type);
    },
    setTheme,
    refresh,
    destroy(): void {
      for (const cleanup of cleanups) cleanup();
      if ([tfMenu, typeMenu].includes(flyouts.open as UIElement)) flyouts.close();
      tfMenu.remove();
      typeMenu.remove();
      root.remove();
      if (portal !== null) {
        flyouts.destroy();
        portal.remove();
      }
    },
  };
}
