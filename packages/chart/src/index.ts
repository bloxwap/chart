/**
 * chart-ts — zero-dependency, WASM-accelerated financial charting with an
 * injected DOM.
 *
 * ```ts
 * import { createChart } from '@bloxwap/chart';
 * const chart = createChart({ container: canvasEl, config: { data: candles } });
 * ```
 *
 * @module
 */

/** Library version. */
export const version = '0.3.0';

export { createChart, Chart } from './core/chart.js';
export { DEFAULT_DRAWING_COLOR, LINE_STYLE_DASH, WEAK_MAGNET_PX, DEFAULT_DOCK_WIDTH } from './core/chart.js';
export type {
  CreateChartOptions,
  AddIndicatorInput,
  AddDrawingInput,
  DrawingPatch,
  DrawingDraft,
  MagnetMode,
  ScaleApi,
  CustomPaneOptions,
  CustomPanePlacement,
  CustomPaneAutoscale,
  PaneApi,
  PanePrimitiveHandle,
} from './core/chart.js';
export type { IndicatorHit } from './core/indicator-hit.js';

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
  TimeScaleConfig,
  GridConfig,
  CrosshairConfig,
  CrosshairMode,
  ThemeConfig,
  FormattersConfig,
  InlineBookConfig,
  HeatmapConfig,
} from './config.js';

export type { Candle } from './core/data.js';
export { DataStore } from './core/data.js';
export type { DepthBook, DepthLevel } from './core/depth.js';
export {
  computeInlineBookRows,
  inlineBookRowAt,
  DEFAULT_INLINE_BOOK_MAX_LEVELS,
  DEFAULT_INLINE_BOOK_BID_COLOR,
  DEFAULT_INLINE_BOOK_ASK_COLOR,
  DEFAULT_INLINE_BOOK_WIDTH,
} from './core/inline-book.js';
export type { InlineBookRow, InlineBookSide, InlineBookRows } from './core/inline-book.js';
export {
  DepthHistory,
  heatmapIntensity,
  heatPosition,
  DEFAULT_HEATMAP_BUCKET_MS,
  DEFAULT_HEATMAP_MAX_BUCKETS,
  DEFAULT_HEATMAP_MAX_LEVELS,
  DEFAULT_HEATMAP_COLOR_LOW,
  DEFAULT_HEATMAP_COLOR_HIGH,
  DEFAULT_HEATMAP_OPACITY,
  DEFAULT_HEATMAP_MIN_OPACITY,
  DEFAULT_HEATMAP_GAMMA,
} from './core/heatmap.js';
export type { HeatmapSnapshot, HeatmapStop } from './core/heatmap.js';
export {
  computeVolumeProfile,
  computeTpoProfile,
  volumeProfileRows,
  tpoProfileRows,
  valueArea,
  profileRowAt,
  sessionRanges,
  profileStep,
  gridVolumeRows,
  DEFAULT_SESSION_MS,
  DEFAULT_VALUE_AREA_PERCENT,
} from './core/profile.js';
export type { PriceProfile, VolumeProfile, ValueArea, SessionRange } from './core/profile.js';
export type { Trade, TradeSide } from './core/trade.js';
export {
  footprintBands,
  footprintLod,
  barDelta,
  candleDelta,
  candleDeltas,
  DEFAULT_FOOTPRINT_LOD,
} from './core/footprint.js';
export type {
  FootprintLevelLike,
  FootprintBarLike,
  FootprintSource,
  FootprintDisplay,
  FootprintLod,
  FootprintLodThresholds,
  FootprintBand,
} from './core/footprint.js';

export { TimeScale, PriceScale, priceTicks, niceStep, visibleMinMax, seriesMinMax } from './core/scale.js';
export type { VisibleRange } from './core/scale.js';
export { computeTimeSlots, inferIntervalMs } from './core/time-slots.js';
export type { SlotRange } from './core/scale.js';
export { SmoothZoom } from './core/zoom.js';
export type { FrameScheduler, SmoothZoomOptions, ZoomWheelInput } from './core/zoom.js';
export { SmoothScroll } from './core/scroll.js';
export type { SmoothScrollOptions } from './core/scroll.js';
export { layoutPanes, MAIN_PANE_WEIGHT } from './core/pane.js';
export type { PaneSpec, PaneLayout } from './core/pane.js';
export { Crosshair } from './core/crosshair.js';
export { createSnapshotCanvas, renderSnapshot, canvasToBlob, canvasToDataURL, snapshotToBlob, snapshotToDataURL } from './core/snapshot.js';
export type { SnapshotBlob, SnapshotOptions, SnapshotImageOptions } from './core/snapshot.js';
export { Emitter } from './core/events.js';
export type {
  VisibleRangeChangeEvent,
  CrosshairMoveEvent,
  DataLoadEvent,
  DataLoadReason,
} from './core/events.js';
export type { LayoutChangeEvent } from './core/events.js';
export type { ConfigChangeEvent } from './core/events.js';

export type {
  ChartDocument,
  ChartCanvas,
  Canvas2DLike,
  CanvasImageSourceLike,
  TextMetricsLike,
  RecordedCall,
  WebGL2Like,
  WebGLContextOptionsLike,
} from './dom.js';
export { MockDocument, MockCanvas, MockContext2D, MockContextWebGL2, MockGLCanvas, MockGLDocument } from './dom.js';
export type { MockBlob, MockGLDocumentOptions } from './dom.js';

export { parseColor, serializeColor, isValidColor, withAlpha, relativeLuminance, contrastingTextColor } from './color.js';
export type { ParsedColor } from './color.js';

export { drawWatermark } from './watermark.js';

export { CHART_THEMES } from './themes.js';
export type { ThemeName } from './themes.js';

export { CHART_PRESETS, bloxwapDark, withPreset } from './presets.js';
export type { ChartPresetName } from './presets.js';
export { presetChartTheme } from './preset-theme.js';
export type { VolumeConfig } from './config.js';
export { drawVolumeOverlay } from './render/volume-overlay.js';
export { scaleFont, scaleFontSize } from './render/scale-font.js';

export { renderChart } from './render/renderer.js';
export type { RenderView, PaneRenderInfo, DockedPaneRenderInfo, ResolvedDrawing } from './render/renderer.js';
export { splitPrimitives } from './render/primitive.js';
export type { PanePrimitive, PanePrimitives, PrimitiveDrawTarget } from './render/primitive.js';
export {
  attachSessionProfile,
  createSessionProfilePrimitive,
  createSessionLevelsPrimitive,
  DEFAULT_SESSION_PROFILE_WIDTH,
} from './render/session-profile.js';
export type {
  SessionProfileOptions,
  SessionLevelsOptions,
  SessionProfileAttachOptions,
  SessionProfileApi,
} from './render/session-profile.js';
export { attachRangeProfile, createRangeProfilePrimitive, formatProfileVolume, TEXT_COLOR, SIDE_COLOR } from './render/range-profile.js';
export type { RangeProfileOptions, RangeProfileAttachOptions, RangeProfileApi } from './render/range-profile.js';
export { attachInlineBook, createInlineBookPrimitive, formatBookSize } from './render/inline-book.js';
export type {
  InlineBook,
  InlineBookOptions,
  InlineBookAttachOptions,
  InlineBookApi,
} from './render/inline-book.js';
export { attachHeatmap, createHeatmapPrimitive, heatmapRamp, heatmapRampRGBA, HEATMAP_RAMP_STEPS } from './render/heatmap.js';
export type { Heatmap, HeatmapOptions, HeatmapApi, HeatmapRampShape } from './render/heatmap.js';
export { GLBackend } from './render/gl/backend.js';
export type { GLFrame, GLQuadSink, RenderBackend } from './render/gl/backend.js';
export { packCandleQuads } from './render/gl/candles.js';
export { drawDrawings, crisp } from './render/drawings.js';
export type { DrawingPaint } from './render/drawings.js';
export { drawTimeAxis, timeTickIndices } from './render/axis.js';
export { formatCountdown, barIntervalMs, barCloseMs, barCountdownMs, countdownText, drawCountdownLabel } from './render/countdown.js';

export { DEFAULT_PRICE_LINE_COLOR } from './core/price-lines.js';
export type {
  SeriesApi,
  PriceLine,
  PriceLineOptions,
  PriceLineResolvedOptions,
  PriceLineRenderItem,
  PriceLineStyle,
  SeriesMarker,
  SeriesMarkerPosition,
  SeriesMarkerShape,
} from './core/price-lines.js';
export { drawPriceLines } from './render/price-lines.js';
export { drawMarkers, firstMarkerAtOrAfter, MARKER_MIN_SIZE, MARKER_MAX_SIZE } from './render/markers.js';
export {
  createTradePrintsPrimitive,
  MAX_TRADE_PRINTS,
  TRADE_PRINT_MIN_RADIUS,
  TRADE_PRINT_MAX_RADIUS,
  TRADE_PRINT_BUY_COLOR,
  TRADE_PRINT_SELL_COLOR,
} from './render/trade-prints.js';
export type { TradePrints, TradePrintsOptions } from './render/trade-prints.js';

export { SERIES_RENDERERS, SeriesRegistry, createSeriesRegistry, drawHistogramBars } from './series/index.js';
export { createFootprintSeries, formatFootprintSize, FOOTPRINT_SERIES_TYPE } from './series/index.js';
export type { FootprintSeriesOptions, FootprintSeriesSource } from './series/index.js';
export type { SeriesDrawFn } from './series/index.js';
export { heikinAshi, heikinAshiBar, updateHeikinAshi } from './series/heikin-ashi.js';

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
export {
  vwapIndicator,
  vwapMeta,
  vwapValues,
  adxIndicator,
  adxMeta,
  adxValues,
  cciIndicator,
  cciMeta,
  cciValues,
  mfiIndicator,
  mfiMeta,
  mfiValues,
  obvIndicator,
  obvMeta,
  obvValues,
  maRibbonIndicator,
  maRibbonMeta,
} from './indicators/index.js';
export type { StudyMeta, StudyInputMeta, StudyInputOption, StudyStyleMeta } from './indicators/index.js';
export {
  atrIndicator,
  supertrendIndicator,
  ichimokuIndicator,
  donchianIndicator,
  stochIndicator,
  stochRsiIndicator,
  psarIndicator,
  createDeltaIndicator,
  createCvdIndicator,
  cvdValues,
  atrValues,
  trueRangeValues,
  rmaValues,
  supertrendValues,
  ichimokuValues,
  donchianValues,
  stochValues,
  stochRsiValues,
  psarValues,
  rollingMaxValues,
  rollingMinValues,
  smaSparseValues,
  indicatorLineKeys,
  indicatorStyleColors,
  indicatorLineLabels,
  indicatorStyleLabel,
  normalizeIndicatorConfig,
  applyIndicatorPatch,
  styleIndicatorOutput,
} from './indicators/index.js';
export type {
  IndicatorFill,
  IndicatorLevel,
  IndicatorInputDef,
  IndicatorStyleDef,
  IchimokuValues,
  ResolvedIndicatorConfig,
  IndicatorPatch,
} from './indicators/index.js';
export { drawIndicator, indicatorMinMax, indicatorRightEdge, lineValueAt, lineColorAt, LEVEL_DASH } from './render/indicator-draw.js';

export * from './drawings/index.js';

export { initWasm, detectSimd, decodeBase64 } from './wasm/loader.js';
export type { WasmKernels, WasmInitOptions } from './wasm/loader.js';
