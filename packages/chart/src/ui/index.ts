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
export {
  createIndicatorsDialog,
  indicatorInputs,
  indicatorStyleGroups,
  INDICATORS_DIALOG_CSS,
  INDICATORS_DIALOG_STYLE_MARKER,
} from './indicators-dialog.js';
export type { IndicatorsDialog, IndicatorsDialogOptions, IndicatorStyleGroup } from './indicators-dialog.js';
export type { ChartSettings, ChartSettingsOptions } from './settings.js';
export type { DrawingToolbar, DrawingToolbarOptions } from './toolbar.js';
export { createChartContextMenu } from './context-menu.js';
export type {
  ChartContextMenu, ChartContextMenuHooks, ChartContextMenuOptions, ContextMenuAction, ContextMenuEntry, ContextMenuTarget,
} from './context-menu.js';
export { DrawingController, ZOOM_TOOL, GLYPH_TOOLS, DRAG_THRESHOLD_PX, VERTICAL_PAN_PX, MIN_ZOOM_BOX_PX, groupOf } from './controller.js';
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
export { startCountdownTicker } from './countdown.js';
export type { CountdownTicker, CountdownTickerChart, CountdownTickerOptions } from './countdown.js';
export {
  attachTouchGestures,
  GestureRecognizer,
  LONG_PRESS_MS,
  TAP_SLOP_PX,
  TOUCH_HIT_PX,
  TOUCH_HANDLE_HIT_PX,
  DOUBLE_TAP_MS,
  FLING_MIN_VELOCITY,
  FLING_DURATION_MS,
  TOUCH_POINTER_TYPES,
} from './gestures.js';
export type { GestureHandlers, GestureRecognizerOptions, TouchGestures, TouchGesturesOptions } from './gestures.js';
export type { ThemeName } from '../themes.js';
export { createChartHeader, DEFAULT_TIMEFRAMES, DEFAULT_HEADER_INTERVAL_MS, DEFAULT_CHART_TYPES, CHART_TYPE_LABELS } from './header.js';
export type { ChartHeader, ChartHeaderOptions, HeaderTimeframe, HeaderDatafeed } from './header.js';
export { createScaleButtons, toggleScale, scaleToggleState, syncScaleToggles, SCALE_TOGGLES } from './scale-buttons.js';
export type { ScaleButtons, ScaleButtonsOptions, ScaleToggle, ScaleToggleState } from './scale-buttons.js';
export { HEADER_CSS, HEADER_STYLE_MARKER, BLOXWAP_HEADER_TOKENS, BLOXWAP_HEADER_THEME, injectHeaderStyles } from './header-styles.js';
export type { HeaderTokens, ThemedHeaderTokens } from './header-styles.js';
export type { FlyoutPlacement } from './menu.js';
