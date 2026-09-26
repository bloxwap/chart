/**
 * chart-ts — zero-dependency, WASM-accelerated financial charting with an
 * injected DOM.
 *
 * ```ts
 * import { createChart } from 'chart-ts';
 * const chart = createChart({ container: canvasEl, config: { data: candles } });
 * ```
 *
 * @module
 */

/** Library version. */
export const version = '0.0.1';

export { createChart, Chart } from './core/chart.js';
export { DEFAULT_DRAWING_COLOR, LINE_STYLE_DASH, WEAK_MAGNET_PX } from './core/chart.js';
export type {
  CreateChartOptions,
  AddIndicatorInput,
  AddDrawingInput,
  DrawingPatch,
  DrawingDraft,
  MagnetMode,
  ScaleApi,
} from './core/chart.js';

export {
  defineConfig,
  resolveConfig,
  mergeDeep,
  DEFAULT_CONFIG,
  defaultPriceFormatter,
  defaultTimeFormatter,
} from './config.js';
export type {
  ChartConfig,
  DeepPartial,
  SeriesConfig,
  SeriesType,
  IndicatorConfig,
  DrawingConfig,
  DrawingPoint,
  WatermarkConfig,
  PriceAxisConfig,
  PriceScaleMode,
  StatusLineConfig,
  TimeAxisConfig,
  GridConfig,
  CrosshairConfig,
  CrosshairMode,
  ThemeConfig,
  FormattersConfig,
} from './config.js';

export type { Candle } from './core/data.js';
export { DataStore } from './core/data.js';

export { TimeScale, PriceScale, priceTicks, niceStep, visibleMinMax, seriesMinMax } from './core/scale.js';
export type { VisibleRange } from './core/scale.js';
export { SmoothZoom } from './core/zoom.js';
export type { FrameScheduler, SmoothZoomOptions, ZoomWheelInput } from './core/zoom.js';
export { SmoothScroll } from './core/scroll.js';
export type { SmoothScrollOptions } from './core/scroll.js';
export { layoutPanes, MAIN_PANE_WEIGHT } from './core/pane.js';
export type { PaneSpec, PaneLayout } from './core/pane.js';
export { Crosshair } from './core/crosshair.js';

export type { ChartDocument, ChartCanvas, Canvas2DLike, CanvasImageSourceLike, TextMetricsLike, RecordedCall } from './dom.js';
export { MockDocument, MockCanvas, MockContext2D } from './dom.js';

export { parseColor, serializeColor, isValidColor, withAlpha, relativeLuminance, contrastingTextColor } from './color.js';
export type { ParsedColor } from './color.js';

export { drawWatermark } from './watermark.js';

export { CHART_THEMES } from './themes.js';
export type { ThemeName } from './themes.js';

export { renderChart } from './render/renderer.js';
export type { RenderView, PaneRenderInfo, ResolvedDrawing } from './render/renderer.js';
export { drawDrawings, crisp } from './render/drawings.js';
export type { DrawingPaint } from './render/drawings.js';
export { drawTimeAxis, timeTickIndices } from './render/axis.js';

export { SERIES_RENDERERS, drawHistogramBars } from './series/index.js';
export type { SeriesDrawFn } from './series/index.js';

export {
  IndicatorRegistry,
  createIndicatorRegistry,
  BUILTIN_INDICATORS,
  smaIndicator,
  emaIndicator,
  bollIndicator,
  macdIndicator,
  rsiIndicator,
  kdjIndicator,
  volIndicator,
  UP_COLOR,
  DOWN_COLOR,
  resolveIndicatorColors,
  smaValues,
  emaValues,
  rsiValues,
  kdjValues,
  stddevValues,
} from './indicators/index.js';
export type { IndicatorDef, IndicatorLine, IndicatorBars, IndicatorOutput } from './indicators/index.js';

export * from './drawings/index.js';

export { initWasm, detectSimd, decodeBase64 } from './wasm/loader.js';
export type { WasmKernels, WasmInitOptions } from './wasm/loader.js';
