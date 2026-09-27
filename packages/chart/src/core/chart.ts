/**
 * The Chart facade: owns the data store, scales, registries, and render loop.
 *
 * @module
 */

import {
  mergeDeep,
  resolveConfig,
  type ChartConfig,
  type DeepPartial,
  type DrawingConfig,
  type DrawingPoint,
  type IndicatorConfig,
} from '../config.js';
import type { AutoResizeCanvas, CanvasImageSourceLike, ChartCanvas, ChartDocument, ResizeObserverLike } from '../dom.js';
import { CHART_THEMES, type ThemeName } from '../themes.js';
import { withPreset, type ChartPresetName } from '../presets.js';
import { scaleFont } from '../render/scale-font.js';
import { parseColor } from '../color.js';
import { DataStore, type Candle } from './data.js';
import { PriceScale, TimeScale, seriesMinMax, visibleMinMax, type VisibleRange } from './scale.js';
import type { SlotRange } from './scale.js';
import { layoutPanes, MAIN_PANE_WEIGHT, type PaneSpec } from './pane.js';
import { Crosshair } from './crosshair.js';
import { renderChart, renderOverlay, type RenderView, type PaneRenderInfo, type ResolvedDrawing } from '../render/renderer.js';
import { createIndicatorRegistry, IndicatorRegistry } from '../indicators/registry.js';
import { resolveIndicatorColors, type IndicatorDef, type IndicatorOutput } from '../indicators/types.js';
import { indicatorLineLabels } from '../indicators/labels.js';
import {
  applyIndicatorPatch, normalizeIndicatorConfig, styleIndicatorOutput, type IndicatorPatch, type ResolvedIndicatorConfig,
} from '../indicators/style.js';
import { indicatorMinMax, indicatorRightEdge } from '../render/indicator-draw.js';
import { createDrawingRegistry, DrawingRegistry } from '../drawings/registry.js';
import type { DrawingDef, DrawingView, DrawPrimitive } from '../drawings/types.js';
import { hitTest } from '../drawings/hit.js';
import type { WasmKernels } from '../wasm/loader.js';
import { initWasm } from '../wasm/loader.js';
import type { FrameScheduler } from './zoom.js';
import { Presence } from './presence.js';
import { RangeAnimation } from './range-animation.js';
import { CandleAnimation } from './candle-animation.js';
import { TimeSlotSync } from './time-slots.js';
import { HeikinAshiCache, heikinAshiLive } from '../series/heikin-ashi.js';
import { PriceLineState, type SeriesApi } from './price-lines.js';
import { createSnapshotCanvas, renderSnapshot, snapshotToBlob, snapshotToDataURL, type SnapshotBlob, type SnapshotImageOptions, type SnapshotOptions } from './snapshot.js';
import { ChartEvents } from './chart-events.js';
import { olderCandles, shiftPoints } from './prepend.js';
import type { ConfigChangeEvent, CrosshairMoveEvent, DataLoadEvent, VisibleRangeChangeEvent } from './events.js';
import { hitIndicators, type IndicatorHit, type RenderedIndicator } from './indicator-hit.js';

export type { ConfigChangeEvent, CrosshairMoveEvent, DataLoadEvent, DataLoadReason, VisibleRangeChangeEvent } from './events.js';
import type { LayoutChangeEvent } from './events.js';
export type { LayoutChangeEvent } from './events.js';

/** Options for {@link createChart}. The host injects the DOM. */
export interface CreateChartOptions {
  /** An existing canvas (a real `HTMLCanvasElement` works). */
  container?: ChartCanvas;
  /** A document abstraction used to create the canvas when no container is given. */
  document?: ChartDocument;
  /** The one consolidated config object (all fields optional). */
  config?: DeepPartial<ChartConfig>;
  /**
   * Backing-store pixels per CSS pixel, e.g. `window.devicePixelRatio`.
   * All layout, fonts, and the {@link ScaleApi} conversions are in CSS pixels;
   * the renderer scales the 2D context by this ratio. Default 1.
   */
  pixelRatio?: number;
  /** Cache static pixels during pointer movement on browser canvases. Default true. */
  crosshairCache?: boolean;
  /** Opt-in live candle, indicator, pane and autoscale transitions using the host's frame clock. */
  animation?: { scheduler: FrameScheduler; duration?: number };
  /** A built-in color theme, applied under `config` (fields in `config` win). */
  theme?: ThemeName;
  /** A named brand preset or config partial, applied under `theme` and `config` (both win). */
  preset?: ChartPresetName | DeepPartial<ChartConfig>;
  /**
   * Size the chart to the canvas's parent element and keep it in sync, including the device pixel
   * ratio. The canvas is placed out of flow to fill the parent (`position: absolute; inset: 0`), so it
   * can never feed back into the size being measured; give the parent a height. Needs a `container`
   * canvas attached to a parent in a document with `ResizeObserver`. {@link Chart.destroy} stops it.
   */
  autoResize?: boolean;
  /** Wall clock in ms for the bar-close countdown. Default `() => Date.now()`; inject for tests. */
  now?: () => number;
  /** Custom registries; default ones carry all built-ins. */
  registries?: {
    indicators?: IndicatorRegistry;
    drawings?: DrawingRegistry;
  };
}

/** Input for {@link Chart.addIndicator}. */
export interface AddIndicatorInput {
  name: string;
  id?: string;
  params?: Record<string, number>;
  pane?: 'main' | 'sub';
  colors?: string[];
  visible?: boolean;
  /** Stroke width per output line (see {@link IndicatorConfig.lineWidths}). */
  lineWidths?: number[];
  /** Output keys to hide (see {@link IndicatorConfig.hiddenLines}). */
  hiddenLines?: string[];
}

/** Input for {@link Chart.addDrawing}. */
export interface AddDrawingInput {
  name: string;
  id?: string;
  points: { index: number; price: number }[];
  color?: string;
  lineWidth?: number;
  lineStyle?: DrawingConfig['lineStyle'];
  text?: string;
  image?: CanvasImageSourceLike | null;
  locked?: boolean;
  visible?: boolean;
}

/** Editable fields of an existing drawing (see {@link Chart.updateDrawing}). */
export type DrawingPatch = Partial<Omit<DrawingConfig, 'id' | 'name'>>;

/** An in-progress drawing previewed while the user places points. */
export interface DrawingDraft {
  name: string;
  points: DrawingPoint[];
  color?: string;
  lineWidth?: number;
  lineStyle?: DrawingConfig['lineStyle'];
  text?: string;
}

/** Magnet strength for {@link Chart.snapPoint}: weak snaps only near a price. */
export type MagnetMode = 'off' | 'weak' | 'strong';

/** Default drawing color. */
export const DEFAULT_DRAWING_COLOR = '#2962ff';

/** Dash patterns for {@link DrawingConfig.lineStyle}. */
export const LINE_STYLE_DASH: Readonly<Record<DrawingConfig['lineStyle'], readonly number[] | undefined>> = {
  solid: undefined,
  dashed: [6, 4],
  dotted: [1, 3],
};

/** Pixel radius within which a weak magnet snaps to an OHLC price. */
export const WEAK_MAGNET_PX = 14;

interface CachedIndicator {
  def: IndicatorDef;
  compute: IndicatorDef['compute'];
  update: IndicatorDef['update'];
  dirtyFrom: number;
  params: Record<string, number>;
  colors: string[];
  output: IndicatorOutput;
}

function matchesIndicator(cached: CachedIndicator, cfg: IndicatorConfig, def: IndicatorDef, colors: readonly string[]): boolean {
  const keys = Object.keys(cfg.params);
  return cached.def === def && cached.compute === def.compute && cached.update === def.update &&
    keys.length === Object.keys(cached.params).length &&
    keys.every((key) => Object.hasOwn(cached.params, key) && Object.is(cached.params[key], cfg.params[key])) &&
    cached.colors.length === colors.length && cached.colors.every((color, i) => color === colors[i]);
}

/** Programmatic scale control and pixel↔data conversion. */
export interface ScaleApi {
  /** Scrolls by `bars` (time slots with `timeScale.continuous`; positive moves toward history). */
  scrollBy(bars: number): void;
  /** Makes bar `index` the rightmost visible bar. */
  scrollTo(index: number): void;
  /** Zooms by `factor`, optionally anchoring at x pixel `anchorX`. */
  zoom(factor: number, anchorX?: number): void;
  /** Current visible bar range (candle indices, also with `timeScale.continuous`; see {@link TimeScale.visibleRange}). */
  visibleRange(): VisibleRange;
  /** Fits bars `[from, to]` (fractional allowed, any order) into the viewport. */
  zoomToRange(from: number, to: number): void;
  /** Canvas pixel x → fractional bar index (no rounding; may fall outside the dataset). All coordinates are CSS pixels. */
  xToIndex(x: number): number;
  /** Bar index → CSS-pixel x of its center. */
  indexToX(index: number): number;
  /** CSS-pixel y → price on the main pane (NaN when no main pane is laid out). */
  yToPrice(y: number): number;
  /** Price → CSS-pixel y on the main pane (NaN when no main pane is laid out). */
  priceToY(price: number): number;
  /** Current scale units per horizontal bar (per time slot with `timeScale.continuous`). */
  priceToBarRatio(): number;
  /**
   * Pixels per bar (per time slot with `timeScale.continuous`), the unit of {@link scrollBy}.
   * Prefer it over `indexToX(1) - indexToX(0)`, which spans any gap between those candles.
   */
  barSpacing(): number;
  /**
   * The viewport in {@link scrollBy} units counted from the first candle, clamped to the
   * data's extent; equals {@link visibleRange} plus `length: dataLength` when bar-indexed.
   */
  visibleSlots(): SlotRange;
}

/**
 * A chart instance. Create via {@link createChart}.
 */
export class Chart {
  /** Indicator registry; register custom indicators here. */
  readonly indicators: IndicatorRegistry;
  /** Drawing registry; register custom drawing models here. */
  readonly drawings: DrawingRegistry;
  /** Resolves once WASM kernels are initialized (or JS fallback chosen). */
  readonly ready: Promise<Chart>;

  private config: ChartConfig;
  private readonly store = new DataStore();
  private readonly timeScale = new TimeScale();
  private readonly timeSlots = new TimeSlotSync(this.timeScale);
  private readonly crosshair = new Crosshair();
  private readonly events = new ChartEvents({
    store: this.store,
    timeScale: this.timeScale,
    crosshair: this.crosshair,
    plotLeft: () => this.plotLeft,
    panes: () => this.lastView?.panes ?? [],
    displayCandles: () => this.displayCandles(),
    layout: () => ({
      width: this.canvas.width / this.pixelRatio, height: this.canvas.height / this.pixelRatio,
      plotLeft: this.plotLeft, plotWidth: this.plotWidth, plotHeight: this.mainHeight, config: this.config,
    }),
  });
  private readonly canvas: ChartCanvas;
  private readonly snapshotDocument: ChartDocument | undefined;
  private readonly clock: () => number;
  private kernels: WasmKernels | null = null;
  private mainPriceScale: PriceScale | null = null;
  private pixelRatio: number;
  private destroyed = false;
  private readonly useCrosshairCache: boolean;
  private crosshairCanvas: ChartCanvas | null = null;
  private crosshairView: RenderView | null = null;
  private readonly invalidateCrosshair = (): void => { this.crosshairView = null; };
  private resizeObserver: ResizeObserverLike | null = null;
  private indicatorSeq = 0;
  private drawingSeq = 0;
  private plotWidth = 0;
  private mainHeight = 0;
  private draft: DrawingDraft | null = null;
  private selectedId: string | null = null;
  private hidden = false;
  private indicatorCache = new Map<string, CachedIndicator>();
  /** Heikin Ashi bars of the store, built lazily for the `'heikin-ashi'` series and released otherwise. */
  private readonly heikinAshi = new HeikinAshiCache();
  private readonly indicatorPresence: Presence<IndicatorConfig> | undefined;
  private readonly rangeAnimation: RangeAnimation | undefined;
  private readonly candleAnimation: CandleAnimation | undefined;
  private lastView: RenderView | null = null;
  private plotLeft = 0;
  private lockedRatio: number | null = null;
  private batchDepth = 0;
  private pendingRender = false;
  private pendingCrosshair = false;
  /** Primitives of each drawing from the last frame, topmost last (hit-testing). */
  private lastGeometry: { id: string; primitives: readonly DrawPrimitive[] }[] = [];
  /** Indicators of the last frame with their styled outputs (hit-testing). */
  private lastIndicators: readonly RenderedIndicator[] = [];
  /** Bar spacing restored by {@link resetScale}. */
  private readonly initialBarSpacing = this.timeScale.barSpacing;

  constructor(options: CreateChartOptions) {
    this.useCrosshairCache = options.crosshairCache !== false;
    this.config = resolveConfig(withPreset(options.preset, options.theme !== undefined ? mergeDeep(CHART_THEMES[options.theme], options.config ?? {}) : options.config));
    if (options.animation !== undefined) {
      this.indicatorPresence = new Presence(options.animation.scheduler, () => this.render(),
        options.animation.duration ?? 240, this.config.indicators.filter((ind) => ind.visible));
      this.rangeAnimation = new RangeAnimation(options.animation.scheduler, () => this.render(), options.animation.duration ?? 240);
      this.candleAnimation = new CandleAnimation(options.animation.scheduler, () => this.render(), options.animation.duration ?? 240);
    }
    this.indicators = options.registries?.indicators ?? createIndicatorRegistry();
    this.drawings = options.registries?.drawings ?? createDrawingRegistry();
    this.pixelRatio = options.pixelRatio ?? 1;
    this.snapshotDocument = options.document;
    this.clock = options.now ?? (() => Date.now());
    if (options.container !== undefined) {
      this.canvas = options.container;
    } else if (options.document !== undefined) {
      this.canvas = options.document.createCanvas(
        Math.round(this.config.width * this.pixelRatio),
        Math.round(this.config.height * this.pixelRatio),
      );
    } else {
      throw new Error('chart-ts: inject a container canvas or a ChartDocument');
    }
    this.store.setData(this.config.data);
    this.timeSlots.sync(this.store.raw(), this.config.timeScale, 'data');
    if (this.config.wasm) {
      this.ready = initWasm().then((kernels) => {
        this.kernels = kernels;
        this.indicatorCache.clear();
        this.render();
        return this;
      });
    } else {
      this.ready = Promise.resolve(this);
    }
    this.render();
    if (options.autoResize === true) this.startAutoResize();
  }

  /** Fills the canvas's parent and follows its size; see {@link CreateChartOptions.autoResize}. */
  private startAutoResize(): void {
    const canvas = this.canvas as AutoResizeCanvas;
    const view = canvas.ownerDocument?.defaultView ?? null;
    const parent = canvas.parentElement ?? null;
    if (view?.ResizeObserver === undefined || parent === null || canvas.style === undefined) {
      throw new Error('chart-ts: autoResize needs a container canvas attached to a parent element in a document with ResizeObserver');
    }
    Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' });
    if (view.getComputedStyle(parent as never).position === 'static') parent.style.position = 'relative';
    const fit = (): void => this.resize(parent.clientWidth, parent.clientHeight, view.devicePixelRatio || 1);
    this.resizeObserver = new view.ResizeObserver(fit);
    this.resizeObserver.observe(parent);
    fit();
  }

  /** The current resolved config. Mutate via {@link updateConfig}. */
  getConfig(): ChartConfig {
    return this.config;
  }

  /** Number of candles in the store. */
  get dataLength(): number {
    return this.store.length;
  }

  /**
   * The loaded candles, oldest first, as the chart holds them (after
   * `setData`, `appendData`, `prependData` and datafeed loads). Not a copy:
   * never mutate it, and call again after a data change rather than keeping it.
   */
  getData(): readonly Candle[] {
    return this.store.raw();
  }

  /** Main pane bounds in canvas CSS pixels, including a left-hand scale. */
  get plotArea(): { left: number; width: number; height: number } {
    return { left: this.plotLeft, width: this.plotWidth, height: this.mainHeight };
  }

  /** Replaces all candle data and re-renders. */
  setData(candles: readonly Candle[]): void {
    this.rangeAnimation?.clear();
    this.candleAnimation?.clear();
    this.store.setData(candles);
    this.timeSlots.sync(this.store.raw(), this.config.timeScale, 'data');
    this.events.dataLoaded('set', this.store.length);
    this.indicatorCache.clear();
    this.render();
  }

  /**
   * Appends or replaces one candle (by time) and re-renders. A candle older
   * than the first one goes in front like {@link prependData} (reported as
   * `'prepend'`, with index-based drawings moving along); one between
   * existing bars is inserted in place and reported as `'append'`.
   */
  appendData(candle: Candle): void {
    const length = this.store.length;
    if (length > 0 && candle.time < this.store.at(0)!.time) {
      this.insertHistory([candle]);
      return;
    }
    const last = this.store.last();
    const tail = last === undefined || candle.time > last.time ||
      (candle.time === last.time && this.store.at(length - 2)?.time !== candle.time);
    this.store.append(candle);
    this.timeSlots.sync(this.store.raw(), this.config.timeScale, tail ? 'append' : 'data');
    this.events.dataLoaded(this.store.length > length ? 'append' : 'update', this.store.length - length);
    if (tail) {
      const from = this.store.length > length ? length : length - 1;
      for (const cached of this.indicatorCache.values()) cached.dirtyFrom = Math.min(cached.dirtyFrom, from);
    } else this.indicatorCache.clear();
    this.heikinAshi.invalidate(tail ? length - 1 : 0);
    this.render();
  }

  /**
   * Inserts older history in front of the data and re-renders. Rows at or
   * after the first candle's time, or with a non-finite time or price, are
   * ignored; the rest are deduped by time (last wins) and sorted. The viewport
   * stays on the same candles at the same pixels, index-based drawing points
   * (and the draft) move with their bars, and indicators recompute. Returns
   * the number of candles added.
   */
  prependData(candles: readonly Candle[]): number {
    const older = olderCandles(candles, this.store.at(0)?.time);
    if (older.length > 0) this.insertHistory(older);
    return older.length;
  }

  /** Puts `older` (sorted, all before the first candle) in front of the data; see {@link prependData}. */
  private insertHistory(older: readonly Candle[]): void {
    const added = older.length;
    const ts = this.timeScale;
    // A continuous axis re-derives every slot from the new first candle: re-pin the right edge.
    const anchor = ts.slots === null ? null : ts.xToFloatIndex(ts.width - ts.barSpacing / 2, this.store.length);
    this.store.prepend(older);
    this.timeSlots.sync(this.store.raw(), this.config.timeScale, 'data');
    if (anchor !== null) ts.scrollTo(anchor + added, this.store.length);
    const indexed = (name: string): boolean => this.drawings.get(name)?.anchored !== true;
    for (const cfg of this.config.drawings) {
      if (!indexed(cfg.name)) continue;
      cfg.points = shiftPoints(cfg.points, added);
      this.events.configChanged('drawings');
    }
    if (this.draft !== null && indexed(this.draft.name)) this.draft = { ...this.draft, points: shiftPoints(this.draft.points, added) };
    this.events.dataLoaded('prepend', added);
    this.indicatorCache.clear();
    this.heikinAshi.invalidate(0);
    this.render();
  }

  /** Deep-merges a partial over the current config and re-renders. */
  updateConfig(partial: DeepPartial<ChartConfig>): void {
    if (partial.priceAxis?.lockPriceToBarRatio === true && !this.config.priceAxis.lockPriceToBarRatio) {
      this.lockedRatio = this.scale.priceToBarRatio();
    }
    if (partial.priceAxis?.lockPriceToBarRatio === false || partial.priceAxis?.mode !== undefined) this.lockedRatio = null;
    // Clone only changed top-level sections. A cursor/theme/drawing edit must
    // not recursively copy the entire price history or unrelated indicators.
    const next = { ...this.config };
    for (const key of Object.keys(partial) as (keyof ChartConfig)[]) {
      if (partial[key] !== undefined) {
        Object.assign(next, { [key]: mergeDeep(this.config[key], partial[key]) });
        this.events.configChanged(key);
      }
    }
    this.config = next;
    if (partial.data !== undefined) {
      this.rangeAnimation?.clear();
      this.candleAnimation?.clear();
      this.store.setData(this.config.data);
      this.events.dataLoaded('set', this.store.length);
      this.indicatorCache.clear();
    }
    if (partial.data !== undefined || partial.timeScale !== undefined) {
      this.timeSlots.sync(this.store.raw(), this.config.timeScale, partial.data !== undefined ? 'data' : 'config');
    }
    this.render();
  }

  /** Groups synchronous updates into one redraw, including nested batches. */
  batch<T>(update: () => T): T {
    this.batchDepth++;
    let updated = false;
    try {
      const result = update();
      updated = true;
      return result;
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0) {
        try {
          if (this.pendingRender) this.render();
          else if (this.pendingCrosshair) this.renderCrosshair();
          this.events.flush();
        } catch (error) {
          if (updated) throw error; // never mask the batch's own error
        }
      }
    }
  }

  /**
   * Calls `listener` after each render that moves the visible bar range:
   * scrolling, zooming, resizing, data growth or a layout-affecting config
   * change. Pointer-only repaints never emit. Returns an unsubscribe function.
   */
  subscribeVisibleRangeChange(listener: (event: VisibleRangeChangeEvent) => void): () => void {
    return this.events.subscribeVisibleRangeChange(listener);
  }

  /**
   * Calls `listener` when {@link setCrosshair}/{@link clearCrosshair} change
   * the crosshair, and when a render changes the bar or price under a still
   * pointer (scrolling, zooming, rescaling, new or replaced candles). Returns
   * an unsubscribe function.
   */
  subscribeCrosshairMove(listener: (event: CrosshairMoveEvent) => void): () => void {
    return this.events.subscribeCrosshairMove(listener);
  }

  /** Calls `listener` after {@link setData}, {@link appendData}, {@link prependData} or new `data` in {@link updateConfig} have rendered. Returns an unsubscribe function. */
  subscribeDataLoad(listener: (event: DataLoadEvent) => void): () => void {
    return this.events.subscribeDataLoad(listener);
  }

  /**
   * Calls `listener` after each render that changed the canvas size, the
   * main plot's bounds (price-axis side, width or visibility, sub-panes, the
   * time axis) or the config (every {@link updateConfig}). Pointer-only
   * repaints never emit. Returns an unsubscribe function.
   */
  subscribeLayoutChange(listener: (event: LayoutChangeEvent) => void): () => void {
    return this.events.subscribeLayoutChange(listener);
  }

  /**
   * Calls `listener` after the render that follows a config change, with the
   * top-level sections written since the last delivery: the keys of an
   * {@link updateConfig} partial, `'indicators'` after {@link addIndicator},
   * {@link updateIndicator} or {@link removeIndicator}, and `'drawings'` after
   * a drawing edit (including index-based points {@link prependData} moves).
   * Values are not compared: a same-value write still names its section, and
   * only calls with nothing to act on (an unknown id) are skipped. A batch
   * delivers one event for all of its changes; nothing is recorded while no
   * one listens. Returns an unsubscribe function.
   */
  subscribeConfigChange(listener: (event: ConfigChangeEvent) => void): () => void {
    return this.events.subscribeConfigChange(listener);
  }

  /** Delivers pending events, unless a batch will deliver them when it flushes. */
  private emitEvents(): void {
    if (this.batchDepth === 0) this.events.flush();
  }

  /**
   * Adds an indicator instance. Returns its id.
   *
   * @throws When `name` is not registered.
   */
  addIndicator(input: AddIndicatorInput): string {
    const def = this.indicators.get(input.name);
    if (def === undefined) throw new Error(`chart-ts: unknown indicator "${input.name}"`);
    const cfg: IndicatorConfig = {
      id: input.id ?? `ind-${++this.indicatorSeq}`,
      name: def.name,
      params: { ...def.defaultParams, ...input.params },
      pane: input.pane ?? def.defaultPane,
      colors: input.colors ?? [...def.defaultColors],
      visible: input.visible ?? true,
      lineWidths: [...(input.lineWidths ?? [])],
      hiddenLines: [...(input.hiddenLines ?? [])],
    };
    this.config.indicators.push(cfg);
    this.events.configChanged('indicators');
    this.render();
    return cfg.id;
  }

  /** The indicator with `id`, if any, with defaulted styling fields filled in. */
  getIndicator(id: string): ResolvedIndicatorConfig | undefined {
    const cfg = this.config.indicators.find((c) => c.id === id);
    return cfg === undefined ? undefined : normalizeIndicatorConfig(cfg);
  }

  /**
   * Applies `patch` to an indicator (params merge per key; arrays replace)
   * and re-renders; returns whether it existed. Only changed params/colors
   * recompute; widths, hidden plots, pane and visibility just repaint.
   */
  updateIndicator(id: string, patch: IndicatorPatch): boolean {
    const cfg = this.getIndicator(id);
    if (cfg === undefined) return false;
    applyIndicatorPatch(cfg, patch);
    this.events.configChanged('indicators');
    this.render();
    return true;
  }

  /** Removes an indicator by id; returns whether it existed. */
  removeIndicator(id: string): boolean {
    const idx = this.config.indicators.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    this.config.indicators.splice(idx, 1);
    this.events.configChanged('indicators');
    this.render();
    return true;
  }

  /**
   * Adds a drawing instance. Returns its id. Points pass through the
   * model's `normalize` hook (e.g. positions gain a default stop).
   *
   * @throws When `name` is not registered.
   */
  addDrawing(input: AddDrawingInput): string {
    const def = this.requireDrawing(input.name);
    const cfg: DrawingConfig = {
      id: input.id ?? `drw-${++this.drawingSeq}`,
      name: def.name,
      points: def.normalize !== undefined ? def.normalize(input.points) : input.points,
      color: input.color ?? DEFAULT_DRAWING_COLOR,
      lineWidth: input.lineWidth ?? 1,
      lineStyle: input.lineStyle ?? 'solid',
      text: input.text ?? '',
      image: input.image ?? null,
      locked: input.locked ?? false,
      visible: input.visible ?? true,
    };
    this.config.drawings.push(cfg);
    this.events.configChanged('drawings');
    this.render();
    return cfg.id;
  }

  /** The drawing with `id`, if any. */
  getDrawing(id: string): DrawingConfig | undefined {
    return this.config.drawings.find((c) => c.id === id);
  }

  /** Applies `patch` to a drawing; returns whether it existed. */
  updateDrawing(id: string, patch: DrawingPatch): boolean {
    const cfg = this.getDrawing(id);
    if (cfg === undefined) return false;
    Object.assign(cfg, patch);
    this.events.configChanged('drawings');
    this.render();
    return true;
  }

  /** Removes a drawing by id; returns whether it existed. */
  removeDrawing(id: string): boolean {
    const idx = this.config.drawings.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    this.config.drawings.splice(idx, 1);
    this.events.configChanged('drawings');
    // Batched eraser samples must stop hitting a removed drawing before the
    // next paint, including when another drawing lies underneath it.
    this.lastGeometry = this.lastGeometry.filter((g) => g.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.render();
    return true;
  }

  /** Removes every drawing; returns how many were removed. */
  clearDrawings(): number {
    const n = this.config.drawings.length;
    this.config.drawings.length = 0;
    if (n > 0) this.events.configChanged('drawings');
    this.lastGeometry = [];
    this.selectedId = null;
    this.render();
    return n;
  }

  /** Hides (or re-shows) all drawings without touching their own `visible` flags. */
  setDrawingsHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.render();
  }

  /** Whether all drawings are hidden via {@link setDrawingsHidden}. */
  get drawingsHidden(): boolean {
    return this.hidden;
  }

  /** Shows an in-progress drawing (with handles), or clears it with `null`. */
  setDraft(draft: DrawingDraft | null): void {
    this.draft = draft;
    this.render();
  }

  /** Selects a drawing (its handles are painted) or clears the selection. */
  selectDrawing(id: string | null): void {
    this.selectedId = id !== null && this.getDrawing(id) !== undefined ? id : null;
    this.render();
  }

  /** Currently selected drawing id. */
  get selectedDrawing(): string | null {
    return this.selectedId;
  }

  /**
   * Topmost visible drawing under `(x, y)` (CSS px), or `null`. The drawing
   * `prefer` names (e.g. the selected one) wins wherever it is hit, even
   * under another.
   */
  drawingAt(x: number, y: number, tolerance = 6, prefer: string | null = null): string | null {
    x -= this.plotLeft;
    // The main pane starts at y = 0, so pointer and pane coordinates coincide.
    const hit = (g: { primitives: readonly DrawPrimitive[] }): boolean => g.primitives.some((p) => hitTest(p, x, y, tolerance, this.plotWidth));
    if (prefer !== null && this.lastGeometry.some((g) => g.id === prefer && hit(g))) return prefer;
    for (let i = this.lastGeometry.length - 1; i >= 0; i--) {
      if (hit(this.lastGeometry[i]!)) return this.lastGeometry[i]!.id;
    }
    return null;
  }

  /**
   * Nearest visible indicator plot within `tolerance` px of `(x, y)` (CSS px)
   * in the last frame (ties go to the topmost) — lines, steps, dots and
   * histogram bars of main-pane overlays and sub-panes — or `null`. Hidden
   * plots and the price axis never hit.
   */
  indicatorAt(x: number, y: number, tolerance = 6): IndicatorHit | null {
    return this.lastView === null ? null : hitIndicators(this.lastView, this.plotLeft, this.lastIndicators, this.config.indicators, x, y, tolerance);
  }

  /**
   * The pane under canvas `y` (CSS px) in the last frame: `'main'`, the id of
   * the indicator owning a sub-pane, or null below the panes (the time axis)
   * and before the first frame. A shared edge belongs to the upper pane.
   */
  paneAt(y: number): string | null {
    return this.lastView?.panes.find((p) => y >= p.layout.y && y <= p.layout.y + p.layout.height)?.layout.id ?? null;
  }

  /**
   * TradingView's "Reset chart view": restores the initial bar spacing,
   * scrolls to the latest bar, turns price autoscale back on and re-captures
   * a locked price-to-bar ratio, then renders (range listeners fire).
   */
  resetScale(): void {
    this.timeScale.barSpacing = this.initialBarSpacing;
    this.timeScale.scrollOffset = 0;
    this.lockedRatio = null;
    this.updateConfig({ priceAxis: { autoScale: true } });
  }

  /** Index of the selected drawing's anchor under `(x, y)`, or -1. */
  handleAt(x: number, y: number, tolerance = 8): number {
    const cfg = this.selectedId === null ? undefined : this.getDrawing(this.selectedId);
    if (cfg === undefined) return -1;
    const anchored = this.requireDrawing(cfg.name).anchored === true;
    return cfg.points.findIndex((p) => {
      const h = this.pointToPixel(p, anchored);
      return Math.hypot(h.x - x, h.y - y) <= tolerance;
    });
  }

  /**
   * Converts a pixel to a drawing point: data coordinates, or screen
   * fractions for anchored models (`name` given and `anchored`).
   */
  pointFromPixel(x: number, y: number, name?: string): DrawingPoint {
    const anchored = name !== undefined && this.drawings.get(name)?.anchored === true;
    if (anchored) {
      return { index: this.plotWidth > 0 ? (x - this.plotLeft) / this.plotWidth : 0, price: this.mainHeight > 0 ? y / this.mainHeight : 0 };
    }
    return { index: this.scale.xToIndex(x), price: this.scale.yToPrice(y) };
  }

  /**
   * Data point for a pointer at `(x, y)` with magnet snapping: the index
   * rounds to the nearest bar and the price snaps to that bar's nearest
   * open/high/low/close as displayed (Heikin Ashi values for `'heikin-ashi'`)
   * — always (`'strong'`) or within {@link WEAK_MAGNET_PX} (`'weak'`).
   */
  snapPoint(x: number, y: number, magnet: MagnetMode): DrawingPoint {
    const raw = this.pointFromPixel(x, y);
    if (magnet === 'off' || this.store.length === 0) return raw;
    const index = Math.min(this.store.length - 1, Math.max(0, Math.round(raw.index)));
    const c = this.displayCandles()[index]!;
    let best = c.close;
    for (const v of [c.open, c.high, c.low]) {
      if (Math.abs(v - raw.price) < Math.abs(best - raw.price)) best = v;
    }
    if (magnet === 'weak' && Math.abs(this.scale.priceToY(best) - y) > WEAK_MAGNET_PX) {
      return { index: Math.round(raw.index), price: raw.price };
    }
    return { index, price: best };
  }

  /** Moves anchor `pointIndex` of a drawing to `point` (see {@link pointFromPixel}/{@link snapPoint}). */
  moveDrawingPoint(id: string, pointIndex: number, point: DrawingPoint): boolean {
    const cfg = this.getDrawing(id);
    if (cfg === undefined || pointIndex < 0 || pointIndex >= cfg.points.length) return false;
    cfg.points = cfg.points.map((p, i) => (i === pointIndex ? point : p));
    this.events.configChanged('drawings');
    this.render();
    return true;
  }

  /** Translates a whole drawing by a pixel delta. */
  translateDrawing(id: string, dx: number, dy: number): boolean {
    const cfg = this.getDrawing(id);
    if (cfg === undefined) return false;
    const anchored = this.requireDrawing(cfg.name).anchored === true;
    cfg.points = cfg.points.map((p) => {
      const at = this.pointToPixel(p, anchored);
      return this.pointFromPixel(at.x + dx, at.y + dy, anchored ? cfg.name : undefined);
    });
    this.events.configChanged('drawings');
    this.render();
    return true;
  }

  private pointToPixel(p: DrawingPoint, anchored: boolean): { x: number; y: number } {
    if (anchored) return { x: this.plotLeft + p.index * this.plotWidth, y: p.price * this.mainHeight };
    return { x: this.scale.indexToX(p.index), y: this.scale.priceToY(p.price) };
  }

  private requireDrawing(name: string): DrawingDef {
    const def = this.drawings.get(name);
    if (def === undefined) throw new Error(`chart-ts: unknown drawing "${name}"`);
    return def;
  }

  /**
   * Resizes the chart and re-renders. `width`/`height` are CSS pixels; the
   * canvas backing store is set to `round(size × pixelRatio)` and all drawing
   * is scaled by `pixelRatio`, so text stays crisp on HiDPI displays.
   *
   * When `pixelRatio` is omitted the currently stored ratio is kept; passing
   * it explicitly (including `1`) updates it.
   */
  resize(width: number, height: number, pixelRatio?: number): void {
    const ratio = pixelRatio ?? this.pixelRatio;
    const backingWidth = Math.round(width * ratio);
    const backingHeight = Math.round(height * ratio);
    if (this.pixelRatio === ratio && this.canvas.width === backingWidth && this.canvas.height === backingHeight) return;
    this.pixelRatio = ratio;
    if (this.canvas.width !== backingWidth) this.canvas.width = backingWidth;
    if (this.canvas.height !== backingHeight) this.canvas.height = backingHeight;
    this.render();
  }

  /** Programmatic zoom/scroll control and pixel↔data conversion. */
  readonly scale: ScaleApi = {
    scrollBy: (bars) => {
      this.timeScale.scroll(bars, this.store.length);
      this.render();
    },
    scrollTo: (index) => {
      this.timeScale.scrollTo(index, this.store.length);
      this.render();
    },
    zoom: (factor, anchorX) => {
      if (this.timeScale.zoom(factor, this.store.length, anchorX === undefined ? undefined : anchorX - this.plotLeft)) this.render();
    },
    visibleRange: () => this.timeScale.visibleRange(this.store.length),
    zoomToRange: (from, to) => {
      this.timeScale.fitRange(from, to, this.store.length);
      this.render();
    },
    xToIndex: (x) => this.timeScale.xToFloatIndex(x - this.plotLeft, this.store.length),
    indexToX: (index) => this.plotLeft + this.timeScale.indexToX(index, this.store.length),
    yToPrice: (y) => (this.mainPriceScale === null ? NaN : this.mainPriceScale.yToPrice(y)),
    priceToY: (price) => (this.mainPriceScale === null ? NaN : this.mainPriceScale.priceToY(price)),
    priceToBarRatio: () => {
      const scale = this.mainPriceScale;
      if (scale === null || scale.height <= 0) return 1;
      return Math.abs(scale.toScale(scale.maxPrice) - scale.toScale(scale.minPrice)) * this.timeScale.barSpacing /
        (scale.height * (1 - scale.topMargin - scale.bottomMargin));
    },
    barSpacing: () => this.timeScale.barSpacing,
    visibleSlots: () => this.timeScale.visibleSlots(this.store.length),
  };

  private readonly priceLineState = new PriceLineState(() => this.render(), LINE_STYLE_DASH);

  /** Main-series bars as displayed (Heikin Ashi bars for `'heikin-ashi'`), index-aligned with the store. */
  private displayCandles(): readonly Candle[] {
    return this.heikinAshi.display(this.store.raw(), this.config.series.type);
  }

  /** Main-series price lines and markers (`createPriceLine`, `setMarkers`); not drawings. */
  readonly series: SeriesApi = this.priceLineState.api;

  /** Moves the crosshair (host wires pointer events to this). */
  setCrosshair(x: number, y: number): void {
    if (this.crosshair.active && this.crosshair.x === x && this.crosshair.y === y) return;
    this.crosshair.update(x, y);
    this.renderCrosshair();
    this.emitEvents();
  }

  /** Hides the crosshair. */
  clearCrosshair(): void {
    if (!this.crosshair.active) return;
    this.crosshair.clear();
    this.renderCrosshair();
    this.emitEvents();
  }

  private renderCrosshair(): void {
    if (this.destroyed) return;
    if (this.batchDepth > 0) {
      this.pendingCrosshair = true;
      return;
    }
    this.pendingCrosshair = false;
    const view = this.lastView;
    if (view === null ||
        view.canvasWidth !== this.canvas.width / this.pixelRatio ||
        view.canvasHeight !== this.canvas.height / this.pixelRatio) {
      this.render();
      return;
    }
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) return;
    const current = { ...view, crosshair: { active: this.crosshair.active, x: this.crosshair.x, y: this.crosshair.y } };
    if (this.useCrosshairCache && this.canvas.ownerDocument?.createElement && parseColor(view.config.theme.background)?.a === 1) {
      if (this.crosshairCanvas === null) {
        this.crosshairCanvas = this.canvas.ownerDocument.createElement('canvas');
        this.crosshairCanvas.addEventListener?.('contextrestored', this.invalidateCrosshair);
      }
      const cache = this.crosshairCanvas;
      if (cache.width !== this.canvas.width) cache.width = this.canvas.width;
      if (cache.height !== this.canvas.height) cache.height = this.canvas.height;
      const cachedContext = cache.getContext('2d', ctx.getContextAttributes?.());
      if (cachedContext !== null && cachedContext.isContextLost?.() !== true) {
        if (this.crosshairView !== view) {
          // A pointer's first frame after an invalidation prepares the static
          // image. Panning and streaming never pay for this extra canvas.
          renderChart(cachedContext, view, false);
          this.crosshairView = view;
        }
        ctx.drawImage(cache, 0, 0, this.canvas.width, this.canvas.height);
        renderOverlay(ctx, current);
        return;
      }
    }
    renderChart(ctx, current);
  }

  /** Current time in ms from the injected {@link CreateChartOptions.now} clock. */
  now(): number {
    return this.clock();
  }

  /** True once {@link destroy} has run. */
  isDestroyed(): boolean {
    return this.destroyed;
  }

  /**
   * Repaints only the overlay (status line, countdown, crosshair) over the
   * cached static layers, without recomputing indicators. Drive it from a
   * timer, e.g. `startCountdownTicker` from `@bloxwap/chart/ui`.
   */
  refreshOverlay(): void {
    this.renderCrosshair();
  }

  /**
   * Renders the current view into a new canvas created through the injected
   * `ChartDocument`, else the container's `ownerDocument`. Overrides apply to
   * the snapshot only; the crosshair is excluded unless requested.
   *
   * @throws When the chart is destroyed, has no 2D context, or has no document.
   */
  takeScreenshot(options: SnapshotOptions = {}): ChartCanvas {
    const cached = this.lastView;
    if (cached === null ||
        cached.canvasWidth !== this.canvas.width / this.pixelRatio ||
        cached.canvasHeight !== this.canvas.height / this.pixelRatio) {
      this.render(); // a no-op once destroyed
    }
    // Checked after the render: its event listeners may have destroyed the chart.
    if (this.destroyed) throw new Error('chart-ts: cannot take a screenshot of a destroyed chart');
    const view = this.lastView;
    if (view === null) throw new Error('chart-ts: cannot take a screenshot without a 2D context');
    return renderSnapshot(
      { ...view, crosshair: { active: this.crosshair.active, x: this.crosshair.x, y: this.crosshair.y } },
      (width, height) => createSnapshotCanvas(this.canvas, this.snapshotDocument, width, height),
      options,
      this.canvas.getContext('2d')!.getContextAttributes?.(),
    );
  }

  /** Encodes a {@link takeScreenshot} via `canvas.toBlob`; rejects when unsupported or empty. */
  async toBlob(options: SnapshotImageOptions = {}): Promise<SnapshotBlob> {
    return snapshotToBlob(this.takeScreenshot(options), options);
  }

  /**
   * Encodes a {@link takeScreenshot} as a data URL.
   *
   * @throws When the canvas cannot encode, or as {@link takeScreenshot}.
   */
  toDataURL(options: SnapshotImageOptions = {}): string {
    return snapshotToDataURL(this.takeScreenshot(options), options);
  }

  /** Tears down the chart; further renders become no-ops. */
  destroy(): void {
    this.destroyed = true;
    this.events.dispose();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.indicatorPresence?.destroy();
    this.rangeAnimation?.clear();
    this.candleAnimation?.clear();
    this.store.clear();
    this.indicatorCache.clear();
    this.heikinAshi.clear();
    this.lastView = null;
    this.crosshairView = null;
    if (this.crosshairCanvas !== null) {
      this.crosshairCanvas.removeEventListener?.('contextrestored', this.invalidateCrosshair);
      this.crosshairCanvas.width = this.crosshairCanvas.height = 0;
      this.crosshairCanvas = null;
    }
    this.lastGeometry = [];
    this.lastIndicators = [];
    this.priceLineState.destroy();
  }

  /** Full redraw. No-op after {@link destroy} or when no 2D context exists. */
  render(): void {
    if (this.destroyed) return;
    if (this.batchDepth > 0) {
      this.pendingRender = true;
      return;
    }
    this.pendingRender = false;
    this.pendingCrosshair = false;
    this.lastView = null;
    this.crosshairView = null;
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) {
      this.events.flush();
      return;
    }

    const cfg = this.config;
    const cssWidth = this.canvas.width / this.pixelRatio;
    const cssHeight = this.canvas.height / this.pixelRatio;
    let axisWidth = cfg.priceAxis.visible ? cfg.priceAxis.width : 0;
    if (cfg.priceAxis.visible && cfg.priceAxis.precision !== null) {
      const magnitude = Math.max(Math.abs(this.store.last()?.high ?? 0), Math.abs(this.mainPriceScale?.minPrice ?? 0), Math.abs(this.mainPriceScale?.maxPrice ?? 0));
      const sample = magnitude.toFixed(Math.max(0, Math.min(12, Math.round(cfg.priceAxis.precision))));
      ctx.save();
      ctx.font = scaleFont(cfg.theme);
      axisWidth = Math.max(axisWidth, Math.ceil(ctx.measureText(`−${sample}%`).width) + 12);
      ctx.restore();
    }
    axisWidth = Math.min(axisWidth, Math.max(0, cssWidth));
    const plotWidth = Math.max(0, cssWidth - axisWidth);
    const plotHeight = Math.max(0, cssHeight - (cfg.timeAxis.visible ? cfg.timeAxis.height : 0));
    this.plotLeft = cfg.priceAxis.visible && cfg.priceAxis.position === 'left' ? axisWidth : 0;
    this.timeScale.setViewport(plotWidth);

    const candles = this.store.raw();
    const len = candles.length;
    const range = this.timeScale.visibleRange(len);
    const liveCandle = this.candleAnimation?.update(this.store.last(),
      cfg.series.type !== 'histogram' && range.to === len && range.to > range.from);
    // Heikin Ashi draws, scales, labels and prices transformed bars; indicators keep the real candles.
    const displayCandles = this.heikinAshi.display(candles, cfg.series.type);
    const displayLive = displayCandles === candles ? liveCandle : heikinAshiLive(liveCandle, displayCandles);

    // Compute outputs for visible indicators (skipping unknown names).
    const nextCache = new Map<string, CachedIndicator>();
    const computed: { cfg: IndicatorConfig; output: IndicatorOutput; opacity: number; labels: ReadonlyMap<string, string> }[] = [];
    const visible = cfg.indicators.filter((ind) => ind.visible);
    const animated = this.indicatorPresence?.update(visible) ?? visible.map((item) => ({ item, opacity: 1 }));
    for (const { item: indCfg, opacity } of animated) {
      const def = this.indicators.get(indCfg.name);
      if (def === undefined) continue;
      // 'up'/'down' tokens follow the series colors, so a candle recolor recomputes bars.
      const colors = resolveIndicatorColors(indCfg.colors, cfg.series.upColor, cfg.series.downColor);
      let cached = this.indicatorCache.get(indCfg.id);
      if (cached === undefined || !matchesIndicator(cached, indCfg, def, colors)) {
        cached = {
          def, compute: def.compute, update: def.update, dirtyFrom: Infinity, params: { ...indCfg.params }, colors,
          output: def.compute(candles, indCfg.params, colors, this.kernels),
        };
      } else if (cached.dirtyFrom !== Infinity) {
        cached.output = def.update?.(cached.output, candles, cached.dirtyFrom, indCfg.params, colors, this.kernels)
          ?? def.compute(candles, indCfg.params, colors, this.kernels);
        cached.dirtyFrom = Infinity;
      }
      nextCache.set(indCfg.id, cached);
      computed.push({ cfg: indCfg, output: styleIndicatorOutput(cached.output, indCfg, def), opacity, labels: indicatorLineLabels(def) });
    }
    this.indicatorCache = nextCache;
    this.lastIndicators = computed;

    // Pane specs: main + one sub-pane per sub indicator.
    const specs: PaneSpec[] = [{ id: 'main', kind: 'main', weight: MAIN_PANE_WEIGHT }];
    for (const { cfg: indCfg, opacity } of computed) {
      if (indCfg.pane === 'sub') {
        specs.push({ id: indCfg.id, kind: 'indicator', weight: (cfg.indicatorPaneWeight > 0 ? cfg.indicatorPaneWeight : 1) * opacity });
      }
    }
    const layouts = layoutPanes(specs, plotHeight);
    const rightEdge = indicatorRightEdge(range, this.timeScale, len);

    // Build pane render info with autoscaling.
    const panes: PaneRenderInfo[] = [];
    for (const layout of layouts) {
      const priceScale = new PriceScale();
      priceScale.height = layout.height;
      if (layout.kind === 'main') {
        priceScale.mode = cfg.priceAxis.mode;
        priceScale.inverted = cfg.priceAxis.inverted;
        const baseIndex = Math.max(0, Math.min(len - 1, Math.ceil(this.timeScale.xToFloatIndex(0, len))));
        priceScale.basePrice = displayCandles[baseIndex]?.close || 1;
        // Object candles are already resident in JS. Marshalling them into
        // f32 memory costs more than this scan and loses price precision.
        let { min, max } = visibleMinMax(displayCandles, range.from, range.to, null);
        if (this.rangeAnimation) ({ min, max } = this.rangeAnimation.update('main', min, max));
        const candleMin = min, candleMax = max;
        const mainIndicators = computed.filter((c) => c.cfg.pane === 'main');
        for (const { output, opacity } of cfg.priceAxis.scaleSeriesOnly ? [] : mainIndicators) {
          const mm = indicatorMinMax(output, range.from, rightEdge);
          if (mm !== null) {
            min = Math.min(min, candleMin + (mm.min - candleMin) * opacity);
            max = Math.max(max, candleMax + (mm.max - candleMax) * opacity);
          }
        }
        min = this.priceLineState.autoscaleBound(min, -1, range.to <= range.from);
        max = this.priceLineState.autoscaleBound(max, 1, range.to <= range.from);
        priceScale.setRange(min, max);
        if (!cfg.priceAxis.autoScale && this.mainPriceScale !== null) {
          priceScale.setRange(this.mainPriceScale.minPrice, this.mainPriceScale.maxPrice);
          priceScale.basePrice = this.mainPriceScale.basePrice;
        }
        if (cfg.priceAxis.lockPriceToBarRatio && layout.height > 0) {
          const configuredRatio = cfg.priceAxis.priceToBarRatio;
          const currentRatio = Math.abs(priceScale.toScale(priceScale.maxPrice) - priceScale.toScale(priceScale.minPrice)) *
            this.timeScale.barSpacing / (layout.height * (1 - priceScale.topMargin - priceScale.bottomMargin));
          const ratio = configuredRatio !== null && Number.isFinite(configuredRatio) && configuredRatio > 0
            ? configuredRatio : this.lockedRatio ?? currentRatio;
          this.lockedRatio = ratio;
          const center = (priceScale.toScale(priceScale.minPrice) + priceScale.toScale(priceScale.maxPrice)) / 2;
          const span = ratio * layout.height * (1 - priceScale.topMargin - priceScale.bottomMargin) / this.timeScale.barSpacing;
          const lo = priceScale.fromScale(center - span / 2), hi = priceScale.fromScale(center + span / 2);
          if (Number.isFinite(lo) && Number.isFinite(hi)) priceScale.setRange(lo, hi);
        }
        panes.push({ layout, priceScale, indicators: mainIndicators.map((c) => c.output),
          indicatorOpacities: mainIndicators.map((c) => c.opacity), indicatorLabels: mainIndicators.map((c) => c.labels) });
      } else {
        const subs = computed.filter((c) => c.cfg.id === layout.id);
        const subOutputs = subs.map((c) => c.output);
        let min = Infinity;
        let max = -Infinity;
        let hasBars = false;
        for (const output of subOutputs) {
          const lines = indicatorMinMax(output, range.from, rightEdge);
          if (lines !== null) {
            if (lines.min < min) min = lines.min;
            if (lines.max > max) max = lines.max;
          }
          if (output.bars !== undefined) {
            hasBars = true;
            const mm = seriesMinMax(output.bars.values, range.from, range.to);
            if (mm !== null) {
              if (mm.min < min) min = mm.min;
              if (mm.max > max) max = mm.max;
            }
          }
        }
        if (min > max) {
          min = 0;
          max = 1;
        }
        if (hasBars) {
          min = Math.min(min, 0);
          max = Math.max(max, 0);
        }
        if (this.rangeAnimation) ({ min, max } = this.rangeAnimation.update(layout.id, min, max));
        priceScale.setRange(min, max);
        panes.push({ layout, priceScale, indicators: subOutputs, indicatorLabels: subs.map((c) => c.labels),
          opacity: computed.find((c) => c.cfg.id === layout.id)!.opacity });
      }
    }

    this.rangeAnimation?.retain(layouts.map((layout) => layout.id));

    // Resolve drawing primitives against the main pane.
    const mainPane = panes[0];
    this.mainPriceScale = mainPane !== undefined ? mainPane.priceScale : null;
    this.plotWidth = plotWidth;
    this.mainHeight = mainPane !== undefined ? mainPane.layout.height : 0;
    const resolvedDrawings: ResolvedDrawing[] = [];
    this.lastGeometry = [];
    if (mainPane !== undefined) {
      const view: DrawingView = {
        indexToX: (index) => this.timeScale.indexToX(index, len),
        priceToY: (price) => mainPane.priceScale.priceToY(price),
        xToIndex: (x) => this.timeScale.xToFloatIndex(x, len),
        yToPrice: (y) => mainPane.priceScale.yToPrice(y),
        width: plotWidth,
        height: mainPane.layout.height,
        candles,
        barSpacing: this.timeScale.barSpacing,
        formatPrice: cfg.priceAxis.precision === null ? cfg.formatters.price
          : (price) => price.toFixed(Math.max(0, Math.min(12, Math.round(cfg.priceAxis.precision!)))),
        formatTime: cfg.formatters.time,
        upColor: cfg.series.upColor,
        downColor: cfg.series.downColor,
      };
      const resolve = (
        d: Pick<DrawingConfig, 'name' | 'points' | 'color' | 'lineWidth' | 'lineStyle' | 'text' | 'image'>,
        withHandles: boolean,
      ): ResolvedDrawing | null => {
        const def = this.drawings.get(d.name);
        if (def === undefined || d.points.length < def.minPoints) return null;
        const primitives = def.geometry(d.points, view, { text: d.text, image: d.image });
        const dash = LINE_STYLE_DASH[d.lineStyle];
        const anchored = def.anchored === true;
        return {
          color: d.color,
          lineWidth: d.lineWidth,
          primitives,
          ...(dash !== undefined ? { dash } : {}),
          ...(withHandles ? { handles: d.points.map((p) => {
            const pixel = this.pointToPixel(p, anchored);
            return { x: pixel.x - this.plotLeft, y: pixel.y };
          }) } : {}),
        };
      };
      if (!this.hidden) {
        for (const drwCfg of cfg.drawings) {
          if (!drwCfg.visible) continue;
          const r = resolve(drwCfg, drwCfg.id === this.selectedId);
          if (r === null) continue;
          resolvedDrawings.push(r);
          this.lastGeometry.push({ id: drwCfg.id, primitives: r.primitives });
        }
      }
      if (this.draft !== null) {
        const d = this.draft;
        const r = resolve(
          {
            name: d.name,
            points: d.points,
            color: d.color ?? DEFAULT_DRAWING_COLOR,
            lineWidth: d.lineWidth ?? 1,
            lineStyle: d.lineStyle ?? 'solid',
            text: d.text ?? '',
            image: null,
          },
          true,
        );
        if (r !== null) resolvedDrawings.push(r);
      }
    }

    const view: RenderView = {
      canvasWidth: cssWidth,
      canvasHeight: cssHeight,
      plotWidth,
      plotHeight,
      plotLeft: this.plotLeft,
      pixelRatio: this.pixelRatio,
      candles,
      ...(displayLive !== undefined ? { liveCandle: displayLive } : {}),
      displayCandles,
      range,
      timeScale: this.timeScale,
      panes,
      config: cfg,
      drawings: resolvedDrawings,
      crosshair: { active: this.crosshair.active, x: this.crosshair.x, y: this.crosshair.y },
      priceLines: this.priceLineState.lines,
      markers: this.priceLineState.markers,
      now: this.clock,
    };
    this.lastView = view;
    renderChart(ctx, view);
    this.events.flush();
  }
}

/**
 * Creates a chart. Inject a container canvas, or a `ChartDocument` from which
 * the canvas is created:
 *
 * ```ts
 * import { createChart } from '@bloxwap/chart';
 *
 * const chart = createChart({
 *   container: document.querySelector('canvas')!,
 *   config: {
 *     data: candles,
 *     indicators: [{ id: 'ma', name: 'sma', params: { period: 20 }, pane: 'main', colors: [], visible: true }],
 *     watermark: { visible: true, text: 'ACME' },
 *   },
 * });
 * await chart.ready; // WASM kernels live (or JS fallback chosen)
 * ```
 */
export function createChart(options: CreateChartOptions): Chart {
  return new Chart(options);
}
