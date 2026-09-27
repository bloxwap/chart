/**
 * The chart-ts drawing toolbar: a TradingView-style tool rail with flyout
 * submenus for every built-in drawing tool, plus the on-chart UI that goes
 * with it — live placement preview, selection style bar, inline text
 * editor, favorites bar, icon picker, box zoom, hints and toasts.
 *
 * ```ts
 * import { createChart } from '@bloxwap/chart';
 * import { createDrawingToolbar } from '@bloxwap/chart/ui';
 *
 * const chart = createChart({ container: canvas, config });
 * const toolbar = createDrawingToolbar({
 *   chart, document, canvas,
 *   rail: document.querySelector('#tools')!,     // rail renders here
 *   overlay: document.querySelector('#stage')!,  // position: relative; wraps the canvas
 *   storage: localStorage,                       // remembers favorites
 * });
 * toolbar.setTheme('light');
 * ```
 *
 * @module
 */

import type { Chart } from '../core/chart.js';
import type { ChartConfig, DeepPartial } from '../config.js';
import { CURSOR_MODES, TOOL_GROUPS } from '../drawings/catalog.js';
import type { CanvasImageSourceLike } from '../dom.js';
import { CHART_THEMES, type ThemeName } from '../themes.js';
import { DrawingController, ZOOM_TOOL, type CursorMode } from './controller.js';
import { targetWithin, type UIDocument, type UIElement, type UIEvent, type UIFileInput, type UIStorage, type UITextInput } from './host.js';
import { icon } from './icons.js';
import { DISCLOSURE_SVG, Flyouts, el, iconButton, menuItem, menuLabel, menuSeparator, requireWindow, setButtonIcon } from './menu.js';
import { injectStyles } from './styles.js';
import { SmoothScroll } from '../core/scroll.js';
import { SmoothZoom, type FrameScheduler } from '../core/zoom.js';
import { createFrameScheduler } from './frames.js';
import { attachScrollableRail } from './rail-scroll.js';
import { claimTouch, createTouchRouter, TOUCH_HANDLE_HIT_PX, TOUCH_HIT_PX, TOUCH_POINTER_TYPES } from './gestures.js';
import { toolbarContextMenu, type ChartContextMenu, type ChartContextMenuHooks } from './context-menu.js';

/** Options for {@link createDrawingToolbar}. */
export interface DrawingToolbarOptions {
  chart: Chart;
  /** Injected document (pass the browser `document`). */
  document: UIDocument;
  /** The chart's canvas element; pointer input is read from it. */
  canvas: UIElement;
  /** Container the tool rail renders into (give it the rail's height). */
  rail: UIElement;
  /** Positioned element wrapping the canvas; on-chart UI renders inside it. */
  overlay: UIElement;
  /** Initial theme; also applied to the chart unless `applyChartTheme` is false. Default `'dark'`. */
  theme?: ThemeName;
  /**
   * Apply {@link CHART_THEMES} (or {@link DrawingToolbarOptions.chartTheme}) to the chart on mount and on every
   * {@link DrawingToolbar.setTheme}. Default true. The theme layers over the chart's config, so it
   * replaces a preset's colors; pass false to leave them alone.
   */
  applyChartTheme?: boolean;
  /**
   * The config applied for each theme instead of {@link CHART_THEMES}; keep a brand preset's
   * colors with `presetChartTheme('bloxwapDark')`. Return colors only: the result is re-applied on
   * every theme change, so anything else in it (a whole preset, say) overrides the chart's config
   * and the user's settings. Ignored when `applyChartTheme` is false.
   */
  chartTheme?: (theme: ThemeName) => DeepPartial<ChartConfig>;
  /** Persists favorites (e.g. `localStorage`). */
  storage?: UIStorage | null;
  /** Default favorite tools when storage has none. */
  favorites?: readonly string[];
  /** Drag-to-pan, wheel zoom, crosshair and scroll arrows. Default true. */
  navigation?: boolean;
  /**
   * Finger pan, pinch, fling and long-press crosshair (see `attachTouchGestures`). They give
   * the canvas the `cts-touch` class (`touch-action: none`), so a finger dragging over the
   * chart no longer scrolls the page. Default true; false leaves fingers to the mouse paths
   * and the page's own scrolling while keeping mouse and wheel navigation. Needs `navigation`.
   */
  touchGestures?: boolean;
  /** Show paging arrows when zoomed out. Default true. */
  scrollArrows?: boolean;
  /** Share a frame clock with chart indicator animations and host input. */
  scheduler?: FrameScheduler;
  /** Listen for keyboard shortcuts on the document. Default true. */
  keyboard?: boolean;
  /** Decodes a picked image file. Defaults to `window.createImageBitmap`. */
  loadImage?: (file: unknown) => Promise<CanvasImageSourceLike>;
  /**
   * Right-click menus on drawings, indicators and the chart (see
   * `createChartContextMenu`); pass hooks to add Settings… rows. A drawing's
   * Settings… opens its style bar unless `onDrawingSettings` replaces it. An
   * armed tool still takes the right-click to cancel; mouse and pen only (a
   * finger's long press stays the touch crosshair). Default false:
   * right-clicks only cancel an armed tool.
   */
  contextMenu?: boolean | ChartContextMenuHooks;
}

/** Handle returned by {@link createDrawingToolbar}. */
export interface DrawingToolbar {
  /** The interaction model; drive it directly for custom UI. */
  readonly controller: DrawingController;
  /** Flyout manager; use it for host control rails so menus behave identically. */
  readonly flyouts: Flyouts;
  /** The right-click menu when the `contextMenu` option is on, else null. */
  readonly contextMenu: ChartContextMenu | null;
  /** Switches the UI (and, by default, the chart) theme. */
  setTheme(theme: ThemeName): void;
  /** Re-evaluates the scroll arrows after the host scrolls or zooms. */
  refreshViewport(): void;
  /** Show/hide paging arrows independently of drag and wheel navigation. */
  setScrollArrows(visible: boolean): void;
  /** Cancel pending scroll/zoom motion before host data or viewport changes. */
  cancelNavigation(): void;
  /** Removes all toolbar DOM and listeners. */
  destroy(): void;
}

/** Favorites storage key. */
export const FAVORITES_KEY = 'chart-ts:favorites';

/** Default favorites. */
export const DEFAULT_FAVORITES: readonly string[] = ['trendline', 'hline', 'fib', 'long-position', 'date-price-range'];

/** Style bar color swatches. */
export const SWATCHES: readonly string[] = ['#2962ff', '#089981', '#f23645', '#ff9800', '#f7b500', '#9c27b0', '#00bcd4', '#787b86'];

/** Icon picker contents. */
export const GLYPH_SETS: readonly { readonly key: string; readonly label: string; readonly tool: string; readonly items: readonly string[] }[] = [
  { key: 'emoji', label: 'Emojis', tool: 'emoji', items: '😀 😂 😍 🤔 😎 😱 😭 😡 🥳 🤯 👀 🙏 👍 👎 👏 💪 🔥 💯 🚀 🌙 ⭐ 💎 💰 💸 📈 📉 🎯 ⚡ 🐂 🐻 🐳 🦄 ⚠️ ✅ ❌ ❓ ❗ 🔔 ⏰ 🏁'.split(' ') },
  { key: 'sticker', label: 'Stickers', tool: 'sticker', items: '🚀 🌕 💎 🐂 🐻 🔥 🎉 🏆 💰 🤑 😤 🙈 🧠 👑 🎯 📣'.split(' ') },
  { key: 'icon', label: 'Icons', tool: 'icon', items: '★ ☆ ✓ ✗ ● ○ ■ □ ▲ ▼ ◆ ◇ ♥ ✦ ✚ ✖ ➜ ⬆ ⬇ ⬅ ☀ ☾ ⚑ ⚐ ⚠ ⚡ ☁ ✉ ⌛ ⚙ ✂ ✎'.split(' ') },
];

const CURSOR_ICONS: Readonly<Record<CursorMode, string>> = {
  cross: 'cursor-cross',
  dot: 'cursor-dot',
  arrow: 'cursor-arrow',
  demonstration: 'cursor-demonstration',
  eraser: 'eraser',
};

const GROUP_ICONS: Readonly<Record<string, string>> = {
  lines: 'trendline',
  fib: 'fib',
  patterns: 'xabcd',
  forecasting: 'long-position',
  shapes: 'brush',
  annotation: 'text',
  icons: 'emoji',
};

/** Bars-per-pixel threshold under which the scroll arrows appear. */
const COMPRESS_SPACING_PX = 4;

/**
 * Builds the drawing toolbar and its on-chart UI. Mounting it (and each
 * {@link DrawingToolbar.setTheme}) applies `CHART_THEMES[theme]` to the chart
 * over any `createChart` preset, unless `applyChartTheme: false`; keep a
 * preset's colors with `chartTheme: presetChartTheme(preset)`.
 */
export function createDrawingToolbar(options: DrawingToolbarOptions): DrawingToolbar {
  const { chart, document: doc, canvas } = options;
  const win = requireWindow(doc);
  const navigation = options.navigation ?? true;
  const touchGestures = navigation && (options.touchGestures ?? true);
  const applyChartTheme = options.applyChartTheme ?? true;
  const storage = options.storage ?? null;
  const controller = new DrawingController(chart, { navigation });
  const frames = options.scheduler ?? createFrameScheduler(win, (update) => chart.batch(update));
  const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  // Phones and tablets open with the touch idle hint; each press keeps it current.
  controller.touch = touchGestures && win.matchMedia?.('(pointer: coarse)').matches === true;
  const zoom = new SmoothZoom(chart.scale, frames, { timeConstant: reducedMotion ? 0 : 55, onFrame: () => refreshViewport() });
  const scroll = new SmoothScroll(chart, frames, { duration: reducedMotion ? 0 : 240, onFrame: () => refreshViewport() });
  let scrollArrows = options.scrollArrows ?? true;
  const holdStops: (() => void)[] = [];
  function cancelNavigation(): void {
    zoom.cancel();
    scroll.cancel();
    for (const stop of holdStops) stop();
  }
  const cleanups: (() => void)[] = [];
  const listen = (target: UIElement | UIDocument, type: string, fn: (e: UIEvent) => void, opts?: { passive?: boolean }): void => {
    (target as UIElement).addEventListener(type, fn, opts);
    cleanups.push(() => target.removeEventListener(type, fn));
  };

  injectStyles(doc);
  const railRoot = el(doc, 'nav', 'cts-theme cts-rail');
  railRoot.setAttribute('aria-label', 'Drawing tools');
  const railScroll = el(doc, 'div', 'cts-rail-scroll');
  railRoot.append(railScroll);
  options.rail.append(railRoot);
  const portal = el(doc, 'div', 'cts-theme');
  doc.body.append(portal);
  const overlayRoot = el(doc, 'div', 'cts-theme cts-overlay');
  options.overlay.append(overlayRoot);
  const flyouts = new Flyouts(doc, portal);
  const contextMenu = toolbarContextMenu(
    options.contextMenu,
    { chart, document: doc, canvas, controller, flyouts },
    () => refreshViewport(),
    () => { flushPointer(); cancelNavigation(); commitEditor(); },
    {
      // A drawing's Settings… is its style bar: select it (even under Lock all) and hand the bar the keyboard.
      onDrawingSettings: (id) => {
        controller.select(id);
        styleBar.focus();
      },
    },
  );
  const themed = [railRoot, portal, overlayRoot];
  const pricePlus = el(doc, 'button', 'cts-price-plus', '+');
  pricePlus.setAttribute('type', 'button');
  pricePlus.style.display = 'none';
  overlayRoot.append(pricePlus);
  let plusPrice: number | null = null;
  pricePlus.addEventListener('click', () => {
    if (plusPrice === null || !chart.getConfig().priceAxis.plusButton) return;
    controller.history.checkpoint();
    const id = chart.addDrawing({ name: 'hline', points: [{ index: 0, price: plusPrice }] });
    controller.select(id);
  });
  listen(options.overlay, 'pointerleave', (e) => { if (!touch.leave(e)) pricePlus.style.display = 'none'; });

  // ------------------------------------------------------------ rail

  const groupButtons = new Map<string, UIElement>();
  const toolItems = new Map<string, UIElement[]>();
  const divider = (): void => railScroll.append(el(doc, 'div', 'cts-rail-divider'));

  /** Main button (runs `onMain`) + gutter chevron (opens `menu`); hover opens too. */
  const railGroup = (id: string, title: string, iconName: string, menu: UIElement, onMain: () => void): UIElement => {
    const group = el(doc, 'div', 'cts-group');
    const main = iconButton(doc, iconName, title);
    const more = el(doc, 'button', 'cts-more', DISCLOSURE_SVG);
    more.title = `More: ${title.toLowerCase()}`;
    more.setAttribute('type', 'button');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', (e) => {
      e.stopPropagation();
      flyouts.toggle(menu, group, more);
    });
    main.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      flyouts.toggle(menu, group, more);
    });
    main.addEventListener('click', () => {
      flyouts.close();
      onMain();
    });
    flyouts.hover(group, menu, group, more);
    group.append(main, more);
    railScroll.append(group);
    groupButtons.set(id, main);
    return main;
  };
  const railButton = (iconName: string, title: string, onClick: () => void): UIElement => {
    const btn = iconButton(doc, iconName, title);
    btn.addEventListener('click', onClick);
    railScroll.append(btn);
    return btn;
  };

  // Cursors.
  const cursorMenu = flyouts.create();
  cursorMenu.append(menuLabel(doc, 'Cursors'));
  const cursorItems = new Map<string, UIElement>();
  for (const c of CURSOR_MODES) {
    const item = menuItem(doc, {
      icon: CURSOR_ICONS[c.name as CursorMode],
      label: c.label,
      tick: true,
      onClick: () => {
        controller.setCursor(c.name as CursorMode);
        flyouts.close();
      },
    });
    cursorItems.set(c.name, item);
    cursorMenu.append(item);
  }
  railGroup('cursors', 'Cursor', 'cursor-cross', cursorMenu, () => controller.setCursor(controller.cursor));

  // Drawing tool groups, straight from the catalog.
  const favorites = new Set<string>(readFavorites());
  const toolItem = (name: string): UIElement => {
    const item = menuItem(doc, {
      icon: name,
      label: controller.label(name),
      onClick: () => {
        controller.arm(name);
        flyouts.close();
      },
    });
    const fav = el(doc, 'span', 'cts-fav');
    fav.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleFavorite(name);
    });
    item.append(fav);
    toolItems.set(name, [...(toolItems.get(name) ?? []), item]);
    return item;
  };
  for (const group of TOOL_GROUPS) {
    if (group.id === 'icons') continue;
    const menu = flyouts.create();
    group.sections.forEach((section, i) => {
      if (i > 0) menu.append(menuSeparator(doc));
      menu.append(menuLabel(doc, section.title));
      for (const tool of section.tools) menu.append(toolItem(tool.name));
    });
    railGroup(group.id, group.label, GROUP_ICONS[group.id]!, menu, () => controller.arm(controller.lastTool(group.id)!));
  }

  // Icons: emoji / sticker / icon picker.
  const picker = flyouts.create('cts-picker');
  const tabs = el(doc, 'div', 'cts-tabs');
  const grid = el(doc, 'div', 'cts-glyphs');
  picker.append(tabs, grid);
  let pickerTab = GLYPH_SETS[0]!;
  let lastGlyph = { tool: 'emoji', text: '😀' };
  const renderPicker = (): void => {
    tabs.replaceChildren(
      ...GLYPH_SETS.map((set) => {
        const tab = el(doc, 'button', `cts-tab${set === pickerTab ? ' cts-active' : ''}`);
        tab.textContent = set.label;
        tab.addEventListener('click', () => {
          pickerTab = set;
          renderPicker();
        });
        return tab;
      }),
    );
    grid.replaceChildren(
      ...pickerTab.items.map((ch) => {
        const b = el(doc, 'button', 'cts-glyph');
        b.textContent = ch;
        b.title = `Place ${ch}`;
        b.addEventListener('click', () => {
          lastGlyph = { tool: pickerTab.tool, text: ch };
          controller.arm(pickerTab.tool, { text: ch });
          flyouts.close();
        });
        return b;
      }),
    );
  };
  renderPicker();
  railGroup('icons', 'Icons', 'emoji', picker, () => controller.arm(lastGlyph.tool, { text: lastGlyph.text }));

  divider();

  const measureBtn = railButton('ruler', 'Measure (date and price range)', () => controller.arm('date-price-range'));
  const zoomMenu = flyouts.create();
  zoomMenu.append(
    menuLabel(doc, 'Zoom'),
    menuItem(doc, { icon: 'zoom-in', label: 'Zoom in (drag a range)', onClick: () => { controller.arm(ZOOM_TOOL); flyouts.close(); } }),
    menuItem(doc, {
      icon: 'zoom-out',
      label: 'Zoom out',
      onClick: () => {
        cancelNavigation();
        zoom.zoomBy(1 / 1.5, canvas.clientWidth / 2);
        flyouts.close();
      },
    }),
    // The context menu's reset, reachable by touch and the keyboard too.
    menuItem(doc, {
      icon: 'undo',
      label: 'Reset chart view',
      onClick: () => {
        cancelNavigation();
        chart.resetScale();
        refreshViewport();
        flyouts.close();
      },
    }),
  );
  railGroup('zoom', 'Zoom in', 'zoom-in', zoomMenu, () => controller.arm(ZOOM_TOOL));

  divider();

  // Magnet / stay / lock / hide.
  const magnetMenu = flyouts.create();
  const weakItem = menuItem(doc, { icon: 'magnet', label: 'Weak magnet', tick: true, onClick: () => { controller.setMagnet(controller.magnet === 'weak' ? 'off' : 'weak'); flyouts.close(); } });
  const strongItem = menuItem(doc, { icon: 'magnet-strong', label: 'Strong magnet', tick: true, onClick: () => { controller.setMagnet(controller.magnet === 'strong' ? 'off' : 'strong'); flyouts.close(); } });
  magnetMenu.append(menuLabel(doc, 'Snap points to bar OHLC'), weakItem, strongItem);
  let lastMagnet: 'weak' | 'strong' = 'weak';
  const magnetBtn = railGroup('magnet', 'Magnet mode', 'magnet', magnetMenu, () =>
    controller.setMagnet(controller.magnet === 'off' ? lastMagnet : 'off'),
  );
  const stayBtn = railButton('pencil-lock', 'Stay in drawing mode', () => controller.setStay(!controller.stay));
  const lockBtn = railButton('unlock', 'Lock all drawings', () => controller.setLocked(!controller.locked));
  const hideMenu = flyouts.create();
  const hideDrawings = menuItem(doc, { icon: 'eye-off', label: 'Hide drawings', tick: true, onClick: () => { controller.setHidden(!controller.drawingsHidden, controller.indicatorsHidden); flyouts.close(); } });
  const hideIndicators = menuItem(doc, { icon: 'eye-off', label: 'Hide indicators', tick: true, onClick: () => { controller.setHidden(controller.drawingsHidden, !controller.indicatorsHidden); flyouts.close(); } });
  const hideAll = menuItem(doc, {
    icon: 'eye-off',
    label: 'Hide all',
    tick: true,
    onClick: () => {
      const all = !(controller.drawingsHidden && controller.indicatorsHidden);
      controller.setHidden(all, all);
      flyouts.close();
    },
  });
  hideMenu.append(menuLabel(doc, 'Visibility'), hideDrawings, hideIndicators, hideAll);
  const hideBtn = railGroup('hide', 'Hide all drawings', 'eye', hideMenu, () => controller.setHidden(!controller.drawingsHidden, controller.indicatorsHidden));

  divider();

  const removeMenu = flyouts.create();
  removeMenu.append(
    menuLabel(doc, 'Remove'),
    menuItem(doc, { icon: 'trash', label: 'Remove drawings', onClick: () => { controller.removeDrawings(); flyouts.close(); } }),
    menuItem(doc, { icon: 'trash', label: 'Remove indicators', onClick: () => { controller.removeIndicators(); flyouts.close(); } }),
    menuItem(doc, {
      icon: 'trash',
      label: 'Remove drawings and indicators',
      onClick: () => {
        controller.removeDrawings();
        controller.removeIndicators();
        flyouts.close();
      },
    }),
  );
  railGroup('remove', 'Remove drawings', 'trash', removeMenu, () => controller.removeDrawings());

  divider();
  const favBtn = railButton('star', 'Show favorite tools', () => {
    favBar.classList.toggle('cts-visible');
    syncFavoritesButton();
  });

  // ------------------------------------------------------------ overlay

  const zoomBox = el(doc, 'div', 'cts-zoom-box');
  const favBar = el(doc, 'div', 'cts-panel cts-favorites');
  const styleShell = el(doc, 'div', 'cts-style-shell');
  const styleBar = el(doc, 'div', 'cts-panel cts-style-bar');
  styleBar.setAttribute('tabindex', '0');
  styleBar.setAttribute('role', 'toolbar');
  styleBar.setAttribute('aria-label', 'Drawing style');
  const styleTrack = el(doc, 'div', 'cts-style-scroll-track');
  const styleThumb = el(doc, 'div', 'cts-style-scroll-thumb');
  styleTrack.setAttribute('aria-hidden', 'true');
  styleTrack.append(styleThumb);
  styleShell.append(styleBar, styleTrack);
  function refreshStyleScroll(): void {
    const max = styleBar.scrollWidth - styleBar.clientWidth;
    const overflow = max > 1;
    if (overflow && !styleShell.classList.contains('cts-overflow')) void styleTrack.offsetWidth;
    styleShell.classList.toggle('cts-overflow', overflow);
    const width = styleTrack.clientWidth;
    const thumb = overflow ? Math.min(width, Math.max(24, width * styleBar.clientWidth / styleBar.scrollWidth)) : width;
    styleThumb.style.width = `${thumb}px`;
    styleThumb.style.transform = `translateX(${overflow ? Math.max(0, Math.min(1, styleBar.scrollLeft / max)) * (width - thumb) : 0}px)`;
  }
  listen(styleBar, 'scroll', refreshStyleScroll, { passive: true });
  const styleObserver = win.ResizeObserver ? new win.ResizeObserver(refreshStyleScroll) : null;
  styleObserver?.observe(styleBar);
  cleanups.push(() => styleObserver?.disconnect());
  let scrollGrip: number | null = null;
  const dragStyleScroll = (event: UIEvent): void => {
    if (scrollGrip === null) return;
    const track = styleTrack.getBoundingClientRect();
    const travel = track.width - styleThumb.getBoundingClientRect().width;
    if (travel <= 0) return;
    styleBar.scrollLeft = Math.max(0, Math.min(1, (event.clientX! - track.left - scrollGrip) / travel)) * (styleBar.scrollWidth - styleBar.clientWidth);
    refreshStyleScroll();
  };
  listen(styleTrack, 'pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const thumb = styleThumb.getBoundingClientRect();
    scrollGrip = event.target === styleThumb ? event.clientX! - thumb.left : thumb.width / 2;
    styleBar.focus();
    dragStyleScroll(event);
  });
  listen(doc, 'pointermove', dragStyleScroll);
  listen(doc, 'pointerup', () => { scrollGrip = null; });
  listen(doc, 'pointercancel', () => { scrollGrip = null; });
  listen(styleBar, 'wheel', (event) => {
    if (event.ctrlKey || styleBar.scrollWidth <= styleBar.clientWidth) return;
    if (Math.abs(event.deltaX ?? 0) > Math.abs(event.deltaY ?? 0)) return;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? styleBar.clientWidth : 1;
    if (event.deltaY) { event.preventDefault(); styleBar.scrollLeft += event.deltaY * unit; }
    refreshStyleScroll();
  }, { passive: false });
  const editor = el(doc, 'textarea', 'cts-editor') as UITextInput;
  editor.setAttribute('rows', '1');
  editor.setAttribute('spellcheck', 'false');
  editor.setAttribute('aria-label', 'Drawing text');
  const hint = el(doc, 'div', 'cts-hint');
  let hintTimer: number | undefined;
  /** The idle hint text on show (null while instructions show): a new text shows again. */
  let hintIdle: string | null = null;
  const scrollLeft = el(doc, 'button', 'cts-scroll', icon('chevron-left', 18));
  scrollLeft.title = 'Scroll back (older bars)';
  scrollLeft.style.left = '8px';
  const scrollRight = el(doc, 'button', 'cts-scroll', icon('chevron-right', 18));
  scrollRight.title = 'Scroll forward (newer bars)';
  scrollRight.style.left = 'auto';
  const fileInput = el(doc, 'input') as UIFileInput;
  fileInput.type = 'file';
  fileInput.accept = 'image/*';
  fileInput.style.display = 'none';
  overlayRoot.append(zoomBox, favBar, styleShell, editor, hint, ...(navigation ? [scrollLeft, scrollRight] : []), fileInput);

  // ------------------------------------------------------------ favorites

  const favButtons = new Map<string, UIElement>();

  function readFavorites(): readonly string[] {
    const raw = storage?.getItem(FAVORITES_KEY) ?? null;
    if (raw === null) return options.favorites ?? DEFAULT_FAVORITES;
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
    } catch {
      return options.favorites ?? DEFAULT_FAVORITES;
    }
  }
  function toggleFavorite(name: string): void {
    if (favorites.has(name)) favorites.delete(name);
    else favorites.add(name);
    storage?.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
    renderFavorites();
  }
  function syncFavoritesButton(): void {
    const on = favBar.classList.contains('cts-visible');
    favBtn.classList.toggle('cts-on', on);
    setButtonIcon(favBtn, on ? 'star-filled' : 'star');
    favBtn.title = on ? 'Hide favorite tools' : 'Show favorite tools';
  }
  function renderFavorites(): void {
    const grip = el(
      doc,
      'div',
      'cts-grip',
      '<svg width="6" height="14" viewBox="0 0 6 14" fill="currentColor" aria-hidden="true"><circle cx="1.5" cy="2" r="1"/><circle cx="4.5" cy="2" r="1"/><circle cx="1.5" cy="7" r="1"/><circle cx="4.5" cy="7" r="1"/><circle cx="1.5" cy="12" r="1"/><circle cx="4.5" cy="12" r="1"/></svg>',
    );
    grip.addEventListener('pointerdown', startFavoritesDrag);
    favButtons.clear();
    const buttons = [...favorites].filter((n) => controller.def(n) !== undefined).map((name) => {
      const b = iconButton(doc, name, controller.label(name), 20);
      b.addEventListener('click', () => controller.arm(name));
      favButtons.set(name, b);
      return b;
    });
    favBar.replaceChildren(grip, ...buttons);
    for (const [name, items] of toolItems) {
      for (const item of items) {
        const fav = item.querySelector('.cts-fav') as UIElement;
        const on = favorites.has(name);
        fav.classList.toggle('cts-on', on);
        fav.innerHTML = icon(on ? 'star-filled' : 'star', 16);
        fav.title = on ? 'Remove from favorites' : 'Add to favorites';
      }
    }
    sync();
  }
  function startFavoritesDrag(e: UIEvent): void {
    e.preventDefault();
    const bar = favBar.getBoundingClientRect();
    const host = overlayRoot.getBoundingClientRect();
    const dx = e.clientX! - bar.left;
    const dy = e.clientY! - bar.top;
    const move = (ev: UIEvent): void => {
      favBar.style.transform = 'none';
      favBar.style.left = `${Math.max(0, Math.min(host.width - bar.width, ev.clientX! - host.left - dx))}px`;
      favBar.style.top = `${Math.max(0, Math.min(host.height - bar.height, ev.clientY! - host.top - dy))}px`;
    };
    const up = (): void => {
      doc.removeEventListener('pointermove', move);
      doc.removeEventListener('pointerup', up);
    };
    doc.addEventListener('pointermove', move);
    doc.addEventListener('pointerup', up);
  }

  // ------------------------------------------------------------ style bar

  const reduceMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)') ?? { matches: false };
  let widthTimer: number | undefined;
  const sep = (): UIElement => el(doc, 'div', 'cts-panel-sep');
  const seg = (html: string, title: string, active: boolean, onClick: () => void): UIElement => {
    const b = el(doc, 'button', `cts-seg${active ? ' cts-active' : ''}`, html);
    b.title = title;
    b.addEventListener('click', onClick);
    return b;
  };
  const barButton = (iconName: string, title: string, onClick: () => void, on = false): UIElement => {
    const b = iconButton(doc, iconName, title, 18);
    b.classList.toggle('cts-on', on);
    b.addEventListener('click', onClick);
    return b;
  };

  /** Animates the style bar from `from` px to its natural width, then returns sizing to CSS. */
  function animateWidth(from: number): void {
    win.clearTimeout(widthTimer);
    styleBar.style.transition = 'none';
    styleBar.style.width = '';
    const to = styleBar.offsetWidth;
    if (reduceMotion.matches || Math.abs(to - from) < 0.5) return;
    styleBar.style.width = `${from}px`;
    void styleBar.offsetWidth; // commit the start width before transitioning
    // Inline transitions replace the stylesheet's, so keep the scrollbar-room animation alongside the width.
    styleBar.style.transition = 'width 220ms var(--cts-ease), padding-bottom 200ms var(--cts-ease)';
    styleBar.style.width = `${to}px`;
    widthTimer = win.setTimeout(() => {
      styleBar.style.transition = '';
      styleBar.style.width = '';
    }, 240);
  }

  function renderStyleBar(id: string | null): void {
    const d = id === null ? undefined : chart.getDrawing(id);
    if (d === undefined) {
      styleBar.classList.remove('cts-visible');
      styleShell.classList.remove('cts-visible', 'cts-overflow');
      scrollGrip = null;
      return;
    }
    const def = controller.def(d.name)!;
    const title = el(doc, 'span', 'cts-style-title');
    title.textContent = controller.label(d.name);
    const nodes: UIElement[] = [title, sep()];
    for (const c of SWATCHES) {
      const s = el(doc, 'button', `cts-swatch${d.color === c ? ' cts-active' : ''}`);
      s.style.background = c;
      s.title = c;
      s.addEventListener('click', () => controller.restyle(d.id, { color: c }));
      nodes.push(s);
    }
    nodes.push(sep());
    for (const w of [1, 2, 3, 4]) nodes.push(seg(`${w}px`, `Line width ${w}px`, d.lineWidth === w, () => controller.restyle(d.id, { lineWidth: w })));
    nodes.push(sep());
    for (const style of ['solid', 'dashed', 'dotted'] as const) {
      nodes.push(
        seg(`<span class="cts-line-sample cts-${style}"></span>`, `${style[0]!.toUpperCase()}${style.slice(1)} line`, d.lineStyle === style, () =>
          controller.restyle(d.id, { lineStyle: style }),
        ),
      );
    }
    nodes.push(sep());
    if (def.wantsText === true) nodes.push(barButton('text', 'Edit text', () => openEditor(d.id)));
    nodes.push(barButton('copy', 'Clone', () => controller.clone(d.id)));
    nodes.push(barButton(d.locked ? 'lock' : 'unlock', d.locked ? 'Unlock drawing' : 'Lock drawing', () => controller.restyle(d.id, { locked: !d.locked }), d.locked));
    nodes.push(barButton('trash', 'Remove (Delete)', () => controller.removeSelected()));
    const wasVisible = styleBar.classList.contains('cts-visible');
    const scrollLeft = styleBar.scrollLeft;
    const from = styleBar.offsetWidth; // layout width: ignores the pop-in scale, tracks a running transition
    styleBar.replaceChildren(...nodes);
    styleBar.classList.add('cts-visible');
    styleShell.classList.add('cts-visible');
    if (wasVisible) animateWidth(from);
    styleBar.scrollLeft = scrollLeft;
    refreshStyleScroll();
  }

  // ------------------------------------------------------------ text editor & image picking

  let editingId: string | null = null;
  const offset = (): { x: number; y: number } => {
    const c = canvas.getBoundingClientRect();
    const o = overlayRoot.getBoundingClientRect();
    return { x: c.left - o.left, y: c.top - o.top };
  };
  function openEditor(id: string): void {
    const d = chart.getDrawing(id)!;
    editingId = id;
    const def = controller.def(d.name)!;
    const p = d.points[d.name === 'callout' ? 1 : 0]!;
    const anchored = def.anchored === true;
    const x = anchored ? p.index * canvas.clientWidth : chart.scale.indexToX(p.index);
    const y = anchored ? p.price * canvas.clientHeight : chart.scale.priceToY(p.price);
    const o = offset();
    editor.value = d.text;
    editor.placeholder = d.name === 'table' ? 'Header|Header\nCell|Cell' : 'Enter text';
    editor.style.left = `${Math.max(8, Math.min(overlayRoot.clientWidth - 240, o.x + x + 12))}px`;
    editor.style.top = `${Math.max(8, Math.min(overlayRoot.clientHeight - 80, o.y + y - 18))}px`;
    editor.style.display = 'block';
    editor.focus();
    editor.select();
  }
  function commitEditor(): void {
    if (editingId === null) return;
    const id = editingId;
    editingId = null;
    editor.style.display = 'none';
    controller.setText(id, editor.value);
  }
  listen(editor, 'keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && e.shiftKey !== true) {
      e.preventDefault();
      commitEditor();
    } else if (e.key === 'Escape') {
      editingId = null;
      editor.style.display = 'none';
    }
  });
  listen(editor, 'blur', commitEditor);

  const loadImage =
    options.loadImage ??
    ((file: unknown): Promise<CanvasImageSourceLike> => {
      const create = win.createImageBitmap;
      if (create === undefined) return Promise.reject(new Error('chart-ts: no image decoder; pass loadImage'));
      return create.call(win, file as never);
    });
  listen(fileInput, 'change', () => {
    const file = fileInput.files?.item(0);
    fileInput.value = '';
    if (file === undefined || file === null) return;
    void loadImage(file).then((img) => controller.placeImage(img), () => toast('Could not load that image'));
  });

  // ------------------------------------------------------------ toast, hint, scroll arrows

  let toastEl: UIElement | null = null;
  let toastTimer: number | undefined;
  function toast(text: string): void {
    toastEl?.remove();
    win.clearTimeout(toastTimer);
    const t = el(doc, 'div', 'cts-toast');
    t.textContent = text;
    overlayRoot.append(t);
    toastEl = t;
    toastTimer = win.setTimeout(() => {
      t.remove();
      toastEl = null;
    }, 1400);
  }

  function refreshViewport(): void {
    if (!chart.getConfig().priceAxis.plusButton || !chart.getConfig().priceAxis.visible) pricePlus.style.display = 'none';
    if (!navigation) return;
    const range = chart.scale.visibleSlots();
    const count = range.to - range.from;
    const compressed = scrollArrows && count > 0 && chart.scale.barSpacing() < COMPRESS_SPACING_PX;
    scrollLeft.classList.toggle('cts-visible', compressed && range.from > 0);
    scrollRight.classList.toggle('cts-visible', compressed && range.to < range.length);
    scrollRight.style.left = `${canvas.clientWidth - 72}px`;
  }
  function setScrollArrows(visible: boolean): void {
    scrollArrows = visible;
    if (!visible) cancelNavigation();
    refreshViewport();
  }
  const wireHoldRepeat = (btn: UIElement, direction: 1 | -1): void => {
    let delay: number | undefined;
    let repeat: number | undefined;
    const page = (): void => {
      zoom.cancel();
      if (scrollArrows) scroll.page(direction);
    };
    const stop = (): void => {
      win.clearTimeout(delay);
      win.clearInterval(repeat);
    };
    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      for (const stopHold of holdStops) stopHold();
      page();
      delay = win.setTimeout(() => {
        repeat = win.setInterval(page, 200);
      }, 400);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(type, stop);
    btn.addEventListener('click', (e) => { if (e.detail === 0) page(); });
    listen(doc, 'pointerup', stop);
    listen(doc, 'pointercancel', stop);
    holdStops.push(stop);
    cleanups.push(stop);
  };
  wireHoldRepeat(scrollLeft, 1);
  wireHoldRepeat(scrollRight, -1);

  // ------------------------------------------------------------ state → UI

  function sync(): void {
    const tool = controller.tool;
    const armedGroup = tool === null ? null : tool === ZOOM_TOOL ? 'zoom' : TOOL_GROUPS.find((g) => g.sections.some((s) => s.tools.some((t) => t.name === tool)))?.id;
    const measuring = tool === 'date-price-range';
    for (const [id, btn] of groupButtons) {
      if (id === 'magnet' || id === 'hide' || id === 'remove') continue;
      const armed = id === 'cursors' ? tool === null : id === armedGroup && !measuring;
      btn.classList.toggle('cts-armed', armed);
    }
    for (const g of TOOL_GROUPS) {
      if (g.id === 'icons') continue;
      const name = controller.lastTool(g.id)!;
      const btn = groupButtons.get(g.id)!;
      setButtonIcon(btn, name);
      btn.title = controller.label(name);
    }
    const cursorBtn = groupButtons.get('cursors')!;
    setButtonIcon(cursorBtn, CURSOR_ICONS[controller.cursor]);
    cursorBtn.title = `Cursor: ${CURSOR_MODES.find((c) => c.name === controller.cursor)!.label}`;
    for (const [name, item] of cursorItems) item.classList.toggle('cts-active', name === controller.cursor);
    measureBtn.classList.toggle('cts-armed', measuring);
    for (const [name, items] of toolItems) for (const item of items) item.classList.toggle('cts-active', name === tool);
    for (const [name, b] of favButtons) b.classList.toggle('cts-armed', name === tool);

    if (controller.magnet !== 'off') lastMagnet = controller.magnet;
    magnetBtn.classList.toggle('cts-on', controller.magnet !== 'off');
    setButtonIcon(magnetBtn, lastMagnet === 'strong' ? 'magnet-strong' : 'magnet');
    magnetBtn.title = controller.magnet === 'off' ? 'Magnet mode: off' : `Magnet mode: ${controller.magnet}`;
    weakItem.classList.toggle('cts-active', controller.magnet === 'weak');
    strongItem.classList.toggle('cts-active', controller.magnet === 'strong');
    stayBtn.classList.toggle('cts-on', controller.stay);
    lockBtn.classList.toggle('cts-on', controller.locked);
    setButtonIcon(lockBtn, controller.locked ? 'lock' : 'unlock');
    lockBtn.title = controller.locked ? 'Unlock all drawings' : 'Lock all drawings';
    const anyHidden = controller.drawingsHidden || controller.indicatorsHidden;
    hideBtn.classList.toggle('cts-on', anyHidden);
    setButtonIcon(hideBtn, anyHidden ? 'eye-off' : 'eye');
    hideDrawings.classList.toggle('cts-active', controller.drawingsHidden);
    hideIndicators.classList.toggle('cts-active', controller.indicatorsHidden);
    hideAll.classList.toggle('cts-active', controller.drawingsHidden && controller.indicatorsHidden);

    const h = controller.hint();
    hint.innerHTML = `${h.title !== '' ? `<b>${h.title}</b> — ` : ''}${h.detail}`;
    hint.classList.toggle('cts-quiet', h.quiet);
    if (hintIdle !== (h.quiet ? h.detail : null)) {
      win.clearTimeout(hintTimer);
      hint.classList.remove('cts-hint-hidden');
      hint.setAttribute('aria-hidden', 'false');
      hintIdle = h.quiet ? h.detail : null;
      if (h.quiet) hintTimer = win.setTimeout(() => {
        hint.classList.add('cts-hint-hidden');
        hint.setAttribute('aria-hidden', 'true');
      }, 3_000);
    }

    const box = controller.zoomBox;
    zoomBox.style.display = box === null ? 'none' : 'block';
    if (box !== null) {
      const o = offset();
      zoomBox.style.left = `${o.x + Math.min(box.x0, box.x1)}px`;
      zoomBox.style.width = `${Math.abs(box.x1 - box.x0)}px`;
      zoomBox.style.top = `${o.y}px`;
      zoomBox.style.height = `${canvas.clientHeight}px`;
    }

    for (const mode of Object.keys(CURSOR_ICONS)) canvas.classList.remove(`cts-cursor-${mode}`);
    canvas.classList.toggle('cts-mode-tool', tool !== null);
    if (tool === null) canvas.classList.add(`cts-cursor-${controller.cursor}`);
    canvas.classList.toggle('cts-dragging', controller.dragging);
  }

  cleanups.push(
    controller.on('change', sync),
    controller.on('select', renderStyleBar),
    controller.on('edit-text', openEditor),
    controller.on('request-image', () => fileInput.click()),
    controller.on('toast', toast),
    controller.on('viewport', refreshViewport),
    // Loads the host never sees (a datafeed paging history in or switching symbols) move the viewport too;
    // live bars (every tick) leave the arrows as they are.
    chart.subscribeDataLoad((e) => { if (e.reason === 'set' || e.reason === 'prepend') refreshViewport(); }),
  );

  // ------------------------------------------------------------ input

  const local = (e: UIEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX! - r.left, e.clientY! - r.top];
  };
  // Fingers pan, pinch and long-press through the gesture router; mouse and pen take the paths below.
  const touch = createTouchRouter({
    chart,
    canvas,
    win,
    frames,
    pointerTypes: touchGestures ? TOUCH_POINTER_TYPES : [],
    press: (finger) => {
      controller.hitTolerance = finger ? TOUCH_HIT_PX : undefined;
      controller.handleTolerance = finger ? TOUCH_HANDLE_HIT_PX : undefined;
      controller.setTouch(finger);
    },
    claim: (x, y) => claimTouch(controller, x, y),
    start: () => { flushPointer(); cancelNavigation(); commitEditor(); flyouts.close(); },
    // The selected drawing wins where another lies on top, as it does for a drag (see claimTouch).
    tap: (x, y) => controller.select(controller.locked ? null : chart.drawingAt(x, y, TOUCH_HIT_PX, chart.selectedDrawing)),
    doubleTap: (x, y) => controller.doubleClick(x, y),
    release: (x, y) => {
      flushPointer();
      controller.pointerUp(x, y);
      canvas.classList.remove('cts-dragging');
      controller.pointerLeave();
    },
    abort: () => {
      flushPointer();
      controller.cancelDrag();
      canvas.classList.remove('cts-dragging');
      controller.pointerLeave();
    },
    crosshair: (_x, y) => placePlus(null, y),
    crosshairEnd: () => { pricePlus.style.display = 'none'; },
    viewport: refreshViewport,
  });
  holdStops.push(touch.cancelFling);
  cleanups.push(touch.destroy);
  listen(canvas, 'pointercancel', touch.cancel);
  listen(canvas, 'lostpointercapture', touch.cancel);
  listen(canvas, 'pointerdown', (e) => {
    if (touch.down(e)) return;
    if (e.button !== 0) return;
    flushPointer();
    cancelNavigation();
    commitEditor();
    flyouts.close();
    canvas.setPointerCapture?.(e.pointerId!);
    controller.pointerDown(...local(e));
  });
  const movePointer = (e: UIEvent): void => {
    const [x, y] = local(e);
    controller.pointerMove(x, y);
    placePlus(x, y);
    if (controller.tool === null && controller.cursor !== 'eraser' && !controller.dragging) {
      canvas.classList.toggle('cts-over-drawing', !controller.locked && (chart.drawingAt(x, y) !== null || chart.handleAt(x, y) >= 0));
    }
    if (controller.dragging) canvas.classList.add('cts-dragging');
  };
  /** Shows the price-axis "+" at canvas `y` while the pointer is over the axis at `x`, or beside a touch crosshair (`x` null). */
  function placePlus(x: number | null, y: number): void {
    const axis = chart.getConfig().priceAxis;
    const plot = chart.plotArea;
    const onAxis = axis.visible && (x === null || (axis.position === 'left' ? x <= plot.left : x >= plot.width));
    const showPlus = axis.plusButton && onAxis && y >= 12 && y < plot.height - 12;
    pricePlus.style.display = showPlus ? 'block' : 'none';
    if (showPlus) {
      plusPrice = chart.scale.yToPrice(y);
      const o = offset();
      pricePlus.style.left = `${o.x + (axis.position === 'left' ? plot.left - 26 : plot.width + 2)}px`;
      pricePlus.style.top = `${o.y + y - 12}px`;
      pricePlus.title = `Add price line at ${chart.getConfig().formatters.price(plusPrice)}`;
      pricePlus.setAttribute('aria-label', pricePlus.title);
    }
  }
  let pointerFrame: number | null = null;
  let pointerQueue: UIEvent[] = [];
  function flushPointer(): void {
    if (pointerFrame !== null) frames.cancel(pointerFrame);
    pointerFrame = null;
    const queue = pointerQueue;
    pointerQueue = [];
    chart.batch(() => { for (const event of queue) movePointer(event); });
  }
  listen(canvas, 'pointermove', (e) => {
    if (touch.move(e)) return;
    if (controller.cursor === 'eraser' || (controller.tool !== null && controller.def(controller.tool)?.freehand)) pointerQueue.push(e);
    else pointerQueue = [e];
    if (pointerFrame === null) pointerFrame = frames.request(flushPointer);
  });
  listen(canvas, 'pointerup', (e) => {
    if (touch.up(e)) return;
    flushPointer();
    controller.pointerUp(...local(e));
    canvas.classList.remove('cts-dragging');
  });
  listen(canvas, 'dblclick', (e) => { if (!touch.suppress(e)) controller.doubleClick(...local(e)); });
  listen(canvas, 'pointerleave', (e) => { if (touch.leave(e)) return; flushPointer(); controller.pointerLeave(); });
  listen(canvas, 'contextmenu', (e) => {
    if (touch.suppress(e)) return;
    if (controller.contextMenu()) e.preventDefault();
  });
  if (navigation) {
    listen(
      canvas,
      'wheel',
      (e) => {
        e.preventDefault();
        if (controller.dragging) return;
        scroll.cancel();
        for (const stop of holdStops) stop();
        const width = chart.plotArea.width;
        zoom.wheel({ deltaY: e.deltaY!, deltaMode: e.deltaMode ?? 0, ctrlKey: e.ctrlKey === true },
          Math.max(chart.plotArea.left, Math.min(chart.plotArea.left + width, local(e)[0])), canvas.clientHeight);
      },
      { passive: false },
    );
  }
  if (options.keyboard ?? true) {
    listen(doc, 'keydown', (e) => {
      if (editingId !== null || targetWithin(e, 'input, select, textarea, [contenteditable="true"], .cts-settings')) return;
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const key = e.code ?? `Key${e.key?.toUpperCase()}`;
        const axis = chart.getConfig().priceAxis;
        if (key === 'KeyI' || key === 'KeyP' || key === 'KeyL') {
          e.preventDefault();
          cancelNavigation();
          if (key === 'KeyI') chart.updateConfig({ priceAxis: { inverted: !axis.inverted } });
          else {
            const mode = key === 'KeyP' ? 'percent' : 'logarithmic';
            chart.updateConfig({ priceAxis: { mode: axis.mode === mode ? 'regular' : mode, priceToBarRatio: null } });
          }
          return;
        }
      }
      const handled = controller.keyDown(e.key!, { meta: e.metaKey === true || e.ctrlKey === true, shift: e.shiftKey === true });
      if (e.key === 'Escape') { cancelNavigation(); flyouts.close(); }
      if (handled) e.preventDefault();
    });
  }
  listen(doc, 'visibilitychange', () => { if (doc.hidden) { cancelNavigation(); flushPointer(); } });

  // ------------------------------------------------------------ theme & boot

  function setTheme(theme: ThemeName): void {
    for (const node of themed) node.classList.toggle('cts-light', theme === 'light');
    if (applyChartTheme) chart.updateConfig(options.chartTheme?.(theme) ?? CHART_THEMES[theme]);
  }

  setTheme(options.theme ?? 'dark');
  renderFavorites();
  cleanups.push(attachScrollableRail(doc, railScroll));
  refreshViewport();

  return {
    controller,
    flyouts,
    contextMenu,
    setTheme,
    refreshViewport,
    setScrollArrows,
    cancelNavigation,
    destroy(): void {
      cancelNavigation();
      zoom.destroy();
      scroll.destroy();
      if (pointerFrame !== null) frames.cancel(pointerFrame);
      pointerQueue = [];
      for (const fn of cleanups) fn();
      win.clearTimeout(toastTimer);
      win.clearTimeout(hintTimer);
      win.clearTimeout(widthTimer);
      contextMenu?.destroy();
      flyouts.destroy();
      controller.disarm(false);
      controller.dispose();
      railRoot.remove();
      portal.remove();
      overlayRoot.remove();
    },
  };
}
