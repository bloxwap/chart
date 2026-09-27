/**
 * chart-ts/ui — the drawing toolbar and its on-chart UI, plus the pieces it
 * is built from. Like the core, it never touches global `document`/`window`:
 * pass the document in.
 *
 * @module
 */

export { createDrawingToolbar, FAVORITES_KEY, DEFAULT_FAVORITES, SWATCHES, GLYPH_SETS } from './toolbar.js';
export { createChartSettings } from './settings.js';
export { createThemeControl } from './theme.js';
export type { ThemeControl, ThemeControlOptions, ThemeMode } from './theme.js';
export type { ChartSettings, ChartSettingsOptions } from './settings.js';
export type { DrawingToolbar, DrawingToolbarOptions } from './toolbar.js';
export { DrawingController, ZOOM_TOOL, GLYPH_TOOLS, DRAG_THRESHOLD_PX, MIN_ZOOM_BOX_PX, groupOf } from './controller.js';
export type { ControllerEvents, CursorMode, Hint, ZoomBox, DrawingControllerOptions } from './controller.js';
export { DrawingHistory, HISTORY_LIMIT } from './history.js';
export {
  Flyouts,
  DISCLOSURE_SVG,
  HOVER_OPEN_MS,
  HOVER_CLOSE_MS,
  el,
  iconButton,
  labelButton,
  setButtonLabel,
  setButtonIcon,
  addCaret,
  menuItem,
  menuLabel,
  menuSeparator,
  requireWindow,
} from './menu.js';
export type { MenuItemOptions } from './menu.js';
export { ICONS, icon } from './icons.js';
export { TOOLBAR_CSS, STYLE_MARKER, injectStyles } from './styles.js';
export { targetWithin } from './host.js';
export type { UIDocument, UIElement, UIEvent, UIListener, UIStyle, UIClassList, UIRect, UITextInput, UIFileInput, UIWindow, UITimers, UIStorage } from './host.js';
export { CHART_THEMES } from '../themes.js';
export { createFrameScheduler } from './frames.js';
export { attachScrollableRail } from './rail-scroll.js';
export type { ThemeName } from '../themes.js';
