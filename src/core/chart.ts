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
  type IndicatorConfig,
} from '../config.js';
import type { ChartCanvas, ChartDocument } from '../dom.js';
import { DataStore, type Candle } from './data.js';
import { PriceScale, TimeScale, seriesMinMax, visibleMinMax, type VisibleRange } from './scale.js';
import { layoutPanes, MAIN_PANE_WEIGHT, type PaneSpec } from './pane.js';
import { Crosshair } from './crosshair.js';
import { renderChart, type PaneRenderInfo, type ResolvedDrawing } from '../render/renderer.js';
import { createIndicatorRegistry, IndicatorRegistry } from '../indicators/registry.js';
import type { IndicatorOutput } from '../indicators/types.js';
import { createDrawingRegistry, DrawingRegistry } from '../drawings/registry.js';
import type { WasmKernels } from '../wasm/loader.js';
import { initWasm } from '../wasm/loader.js';

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
}

/** Input for {@link Chart.addDrawing}. */
export interface AddDrawingInput {
  name: string;
  id?: string;
  points: { index: number; price: number }[];
  color?: string;
  lineWidth?: number;
  visible?: boolean;
}

/** Programmatic scale control and pixel↔data conversion. */
export interface ScaleApi {
  /** Scrolls by `bars` (positive moves toward history). */
  scrollBy(bars: number): void;
  /** Makes bar `index` the rightmost visible bar. */
  scrollTo(index: number): void;
  /** Zooms by `factor`, optionally anchoring at x pixel `anchorX`. */
  zoom(factor: number, anchorX?: number): void;
  /** Current visible bar range. */
  visibleRange(): VisibleRange;
  /** Canvas pixel x → fractional bar index (no rounding; may fall outside the dataset). All coordinates are CSS pixels. */
  xToIndex(x: number): number;
  /** Bar index → CSS-pixel x of its center. */
  indexToX(index: number): number;
  /** CSS-pixel y → price on the main pane (NaN when no main pane is laid out). */
  yToPrice(y: number): number;
  /** Price → CSS-pixel y on the main pane (NaN when no main pane is laid out). */
  priceToY(price: number): number;
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
  private readonly crosshair = new Crosshair();
  private readonly canvas: ChartCanvas;
  private kernels: WasmKernels | null = null;
  private mainPriceScale: PriceScale | null = null;
  private pixelRatio: number;
  private destroyed = false;
  private indicatorSeq = 0;
  private drawingSeq = 0;

  constructor(options: CreateChartOptions) {
    this.config = resolveConfig(options.config);
    this.indicators = options.registries?.indicators ?? createIndicatorRegistry();
    this.drawings = options.registries?.drawings ?? createDrawingRegistry();
    this.pixelRatio = options.pixelRatio ?? 1;
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
    if (this.config.wasm) {
      this.ready = initWasm().then((kernels) => {
        this.kernels = kernels;
        this.render();
        return this;
      });
    } else {
      this.ready = Promise.resolve(this);
    }
    this.render();
  }

  /** The current resolved config. Mutate via {@link updateConfig}. */
  getConfig(): ChartConfig {
    return this.config;
  }

  /** Number of candles in the store. */
  get dataLength(): number {
    return this.store.length;
  }

  /** Replaces all candle data and re-renders. */
  setData(candles: readonly Candle[]): void {
    this.store.setData(candles);
    this.render();
  }

  /** Appends or replaces one candle (by time) and re-renders. */
  appendData(candle: Candle): void {
    this.store.append(candle);
    this.render();
  }

  /** Deep-merges a partial over the current config and re-renders. */
  updateConfig(partial: DeepPartial<ChartConfig>): void {
    this.config = mergeDeep(this.config, partial);
    if (partial.data !== undefined) this.store.setData(this.config.data);
    this.render();
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
    };
    this.config.indicators.push(cfg);
    this.render();
    return cfg.id;
  }

  /** Removes an indicator by id; returns whether it existed. */
  removeIndicator(id: string): boolean {
    const idx = this.config.indicators.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    this.config.indicators.splice(idx, 1);
    this.render();
    return true;
  }

  /**
   * Adds a drawing instance. Returns its id.
   *
   * @throws When `name` is not registered.
   */
  addDrawing(input: AddDrawingInput): string {
    const def = this.drawings.get(input.name);
    if (def === undefined) throw new Error(`chart-ts: unknown drawing "${input.name}"`);
    const cfg: DrawingConfig = {
      id: input.id ?? `drw-${++this.drawingSeq}`,
      name: def.name,
      points: input.points,
      color: input.color ?? '#2962ff',
      lineWidth: input.lineWidth ?? 1,
      visible: input.visible ?? true,
    };
    this.config.drawings.push(cfg);
    this.render();
    return cfg.id;
  }

  /** Removes a drawing by id; returns whether it existed. */
  removeDrawing(id: string): boolean {
    const idx = this.config.drawings.findIndex((c) => c.id === id);
    if (idx < 0) return false;
    this.config.drawings.splice(idx, 1);
    this.render();
    return true;
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
    if (pixelRatio !== undefined) this.pixelRatio = pixelRatio;
    this.canvas.width = Math.round(width * this.pixelRatio);
    this.canvas.height = Math.round(height * this.pixelRatio);
    this.render();
  }

  /** Programmatic zoom/scroll control and pixel↔data conversion. */
  get scale(): ScaleApi {
    return {
      scrollBy: (bars) => {
        this.timeScale.scroll(bars, this.store.length);
        this.render();
      },
      scrollTo: (index) => {
        this.timeScale.scrollTo(index, this.store.length);
        this.render();
      },
      zoom: (factor, anchorX) => {
        this.timeScale.zoom(factor, this.store.length, anchorX);
        this.render();
      },
      visibleRange: () => this.timeScale.visibleRange(this.store.length),
      xToIndex: (x) => this.timeScale.xToFloatIndex(x, this.store.length),
      indexToX: (index) => this.timeScale.indexToX(index, this.store.length),
      yToPrice: (y) => (this.mainPriceScale === null ? NaN : this.mainPriceScale.yToPrice(y)),
      priceToY: (price) => (this.mainPriceScale === null ? NaN : this.mainPriceScale.priceToY(price)),
    };
  }

  /** Moves the crosshair (host wires pointer events to this). */
  setCrosshair(x: number, y: number): void {
    this.crosshair.update(x, y);
    this.render();
  }

  /** Hides the crosshair. */
  clearCrosshair(): void {
    this.crosshair.clear();
    this.render();
  }

  /** Tears down the chart; further renders become no-ops. */
  destroy(): void {
    this.destroyed = true;
    this.store.clear();
  }

  /** Full redraw. No-op after {@link destroy} or when no 2D context exists. */
  render(): void {
    if (this.destroyed) return;
    const ctx = this.canvas.getContext('2d');
    if (ctx === null) return;

    const cfg = this.config;
    const cssWidth = this.canvas.width / this.pixelRatio;
    const cssHeight = this.canvas.height / this.pixelRatio;
    const plotWidth = Math.max(0, cssWidth - (cfg.priceAxis.visible ? cfg.priceAxis.width : 0));
    const plotHeight = Math.max(0, cssHeight - (cfg.timeAxis.visible ? cfg.timeAxis.height : 0));
    this.timeScale.setViewport(plotWidth);

    const candles = this.store.raw();
    const len = candles.length;
    const range = this.timeScale.visibleRange(len);

    // Compute outputs for visible indicators (skipping unknown names).
    const visibleIndicators = cfg.indicators.filter((c) => c.visible);
    const computed: { cfg: IndicatorConfig; output: IndicatorOutput }[] = [];
    for (const indCfg of visibleIndicators) {
      const def = this.indicators.get(indCfg.name);
      if (def === undefined) continue;
      computed.push({ cfg: indCfg, output: def.compute(candles, indCfg.params, indCfg.colors, this.kernels) });
    }

    // Pane specs: main + one sub-pane per sub indicator.
    const specs: PaneSpec[] = [{ id: 'main', kind: 'main', weight: MAIN_PANE_WEIGHT }];
    for (const { cfg: indCfg } of computed) {
      if (indCfg.pane === 'sub') {
        specs.push({ id: indCfg.id, kind: 'indicator', weight: cfg.indicatorPaneWeight });
      }
    }
    const layouts = layoutPanes(specs, plotHeight);

    // Build pane render info with autoscaling.
    const panes: PaneRenderInfo[] = [];
    for (const layout of layouts) {
      const priceScale = new PriceScale();
      priceScale.height = layout.height;
      if (layout.kind === 'main') {
        let { min, max } = visibleMinMax(candles, range.from, range.to, this.kernels);
        const mainOutputs = computed.filter((c) => c.cfg.pane === 'main').map((c) => c.output);
        for (const output of mainOutputs) {
          for (const line of output.lines) {
            const mm = seriesMinMax(line.values, range.from, range.to);
            if (mm !== null) {
              min = Math.min(min, mm.min);
              max = Math.max(max, mm.max);
            }
          }
        }
        priceScale.setRange(min, max);
        panes.push({ layout, priceScale, indicators: mainOutputs });
      } else {
        const subOutputs = computed.filter((c) => c.cfg.id === layout.id).map((c) => c.output);
        let min = Infinity;
        let max = -Infinity;
        let hasBars = false;
        for (const output of subOutputs) {
          for (const line of output.lines) {
            const mm = seriesMinMax(line.values, range.from, range.to);
            if (mm !== null) {
              if (mm.min < min) min = mm.min;
              if (mm.max > max) max = mm.max;
            }
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
        priceScale.setRange(min, max);
        panes.push({ layout, priceScale, indicators: subOutputs });
      }
    }

    // Resolve drawing primitives against the main pane.
    const mainPane = panes[0];
    this.mainPriceScale = mainPane !== undefined ? mainPane.priceScale : null;
    const resolvedDrawings: ResolvedDrawing[] = [];
    if (mainPane !== undefined) {
      const view = {
        indexToX: (index: number): number => this.timeScale.indexToX(index, len),
        priceToY: (price: number): number => mainPane.priceScale.priceToY(price),
        width: plotWidth,
        height: mainPane.layout.height,
      };
      for (const drwCfg of cfg.drawings) {
        if (!drwCfg.visible) continue;
        const def = this.drawings.get(drwCfg.name);
        if (def === undefined || drwCfg.points.length < def.minPoints) continue;
        resolvedDrawings.push({
          color: drwCfg.color,
          lineWidth: drwCfg.lineWidth,
          primitives: def.geometry(drwCfg.points, view),
        });
      }
    }

    renderChart(ctx, {
      canvasWidth: cssWidth,
      canvasHeight: cssHeight,
      plotWidth,
      plotHeight,
      pixelRatio: this.pixelRatio,
      candles,
      range,
      timeScale: this.timeScale,
      panes,
      config: cfg,
      drawings: resolvedDrawings,
      crosshair: { active: this.crosshair.active, x: this.crosshair.x, y: this.crosshair.y },
    });
  }
}

/**
 * Creates a chart. Inject a container canvas, or a `ChartDocument` from which
 * the canvas is created:
 *
 * ```ts
 * import { createChart } from 'chart-ts';
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
