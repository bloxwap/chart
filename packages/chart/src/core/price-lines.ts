/**
 * Series price lines and markers: the state behind {@link SeriesApi}.
 *
 * Price lines are lightweight horizontal references (mark price, last
 * trade, liquidation level) owned by the main series. Unlike drawings they
 * are never selected, hit-tested, recorded in undo history or hidden with
 * the drawings; they live outside the config so a live `applyOptions` costs
 * one coalesced repaint and nothing else.
 *
 * @module
 */

/** Stroke style of a price line. */
export type PriceLineStyle = 'solid' | 'dashed' | 'dotted';

/** Options for {@link SeriesApi.createPriceLine}. */
export interface PriceLineOptions {
  price: number;
  /** Line and label color. Default {@link DEFAULT_PRICE_LINE_COLOR}. */
  color?: string;
  /** Default `'solid'`. Dash lengths scale with `lineWidth`. */
  lineStyle?: PriceLineStyle;
  /** CSS pixels. Default 1. */
  lineWidth?: number;
  /** Tag drawn inside the plot beside the axis badge. Default `''` (none). */
  title?: string;
  /** Price badge on the axis plus the title tag. Default true. */
  axisLabelVisible?: boolean;
  /** Default true; false keeps only the labels. */
  lineVisible?: boolean;
  /** Badge fill; `''` (default) uses `color`. */
  axisLabelColor?: string;
  /** Badge text; `''` (default) picks black or white by contrast. */
  axisLabelTextColor?: string;
  /** Include the price in the main pane's automatic range. Default false. */
  autoscale?: boolean;
  /** Stable id; generated when omitted. */
  id?: string;
}

/** Fully resolved price line options, as returned by {@link PriceLine.options}. */
export interface PriceLineResolvedOptions {
  readonly id: string;
  readonly price: number;
  readonly color: string;
  readonly lineStyle: PriceLineStyle;
  readonly lineWidth: number;
  readonly title: string;
  readonly axisLabelVisible: boolean;
  readonly lineVisible: boolean;
  readonly axisLabelColor: string;
  readonly axisLabelTextColor: string;
  readonly autoscale: boolean;
}

/** One price line as the renderer consumes it (see `RenderView.priceLines`). */
export interface PriceLineRenderItem extends PriceLineResolvedOptions {
  /** Dash pattern already scaled by `lineWidth`; empty for solid lines. Do not mutate. */
  readonly dash: number[];
}

/** Handle returned by {@link SeriesApi.createPriceLine}. */
export interface PriceLine {
  readonly id: string;
  /** A snapshot of the current options. */
  options(): PriceLineResolvedOptions;
  /** Patches options and repaints (coalesced by `chart.batch`); no-op when nothing changes or after removal. */
  applyOptions(patch: Partial<PriceLineOptions>): void;
  /** Removes the line; idempotent. */
  remove(): void;
}

/** Where a marker sits relative to its bar. */
export type SeriesMarkerPosition = 'aboveBar' | 'belowBar' | 'inBar';

/** Marker glyph. */
export type SeriesMarkerShape = 'circle' | 'square' | 'arrowUp' | 'arrowDown';

/** A glyph pinned to a bar, e.g. an order fill or a liquidation. */
export interface SeriesMarker {
  /** UNIX seconds; snaps to the last candle with `time <= marker.time`. */
  time: number;
  position: SeriesMarkerPosition;
  color: string;
  shape: SeriesMarkerShape;
  /** Caption drawn beyond the glyph, away from the bar. */
  text?: string;
  /** Glyph size multiplier. Default 1. */
  size?: number;
  id?: string;
}

/** Price lines and markers of the main series; available as `chart.series`. */
export interface SeriesApi {
  /** Adds a horizontal price line above the built-in price references. */
  createPriceLine(options: PriceLineOptions): PriceLine;
  /** Live price lines in creation (paint) order. */
  priceLines(): readonly PriceLine[];
  /** Removes `line`; returns whether it was live on this series. */
  removePriceLine(line: PriceLine): boolean;
  /**
   * Replaces every marker. Markers are kept sorted by time; those before the
   * first candle (or with a non-finite time) are not drawn.
   */
  setMarkers(markers: readonly SeriesMarker[]): void;
  /** Copies of the current markers, sorted by time. */
  markers(): readonly SeriesMarker[];
}

/** Default price line color. */
export const DEFAULT_PRICE_LINE_COLOR = '#2962ff';

type MutableItem = { -readonly [K in keyof PriceLineRenderItem]: PriceLineRenderItem[K] };
type OptionKey = Exclude<keyof PriceLineResolvedOptions, 'id'>;

const OPTION_KEYS: readonly OptionKey[] = [
  'price', 'color', 'lineStyle', 'lineWidth', 'title', 'axisLabelVisible',
  'lineVisible', 'axisLabelColor', 'axisLabelTextColor', 'autoscale',
];

/** Dash lengths per style at a 1px width (the chart passes `LINE_STYLE_DASH`). */
export type PriceLineDashes = Readonly<Record<PriceLineStyle, readonly number[] | undefined>>;

class PriceLineHandle implements PriceLine {
  detached = false;

  constructor(
    private readonly owner: PriceLineState,
    private readonly item: MutableItem,
  ) {}

  get id(): string {
    return this.item.id;
  }

  options(): PriceLineResolvedOptions {
    const { dash: _dash, ...options } = this.item;
    return options;
  }

  applyOptions(patch: Partial<PriceLineOptions>): void {
    if (this.detached) return;
    const item = this.item as unknown as Record<OptionKey, unknown>;
    let changed = false;
    let restyle = false;
    for (const key of OPTION_KEYS) {
      const value = patch[key];
      if (value === undefined || Object.is(value, item[key])) continue;
      item[key] = value;
      changed = true;
      if (key === 'lineStyle' || key === 'lineWidth') restyle = true;
    }
    if (!changed) return;
    if (restyle) this.item.dash = this.owner.dashFor(this.item.lineStyle, this.item.lineWidth);
    this.owner.invalidate();
  }

  remove(): void {
    this.owner.remove(this);
  }
}

/**
 * Chart-owned price line and marker state. `lines` and `markers` are handed
 * to the renderer by reference, so steady frames allocate nothing.
 */
export class PriceLineState {
  /** Live lines in creation order. */
  readonly lines: PriceLineRenderItem[] = [];
  /** Markers sorted by time. */
  markers: readonly SeriesMarker[] = [];
  /** The public face, exposed as `chart.series`. */
  readonly api: SeriesApi;
  private readonly handles: PriceLineHandle[] = [];
  private seq = 0;
  private destroyed = false;

  /**
   * @param invalidate - Requests a repaint (the chart's batched `render`).
   * @param dashes - Base dash pattern per style.
   */
  constructor(readonly invalidate: () => void, private readonly dashes: PriceLineDashes) {
    this.api = {
      createPriceLine: (options) => this.create(options),
      priceLines: () => this.handles.slice(),
      removePriceLine: (line) => this.remove(line),
      setMarkers: (markers) => this.setMarkers(markers),
      // Element copies: the stored order backs the renderer's binary search.
      markers: () => this.markers.map((marker) => ({ ...marker })),
    };
  }

  /** Dash pattern for `style` scaled to `width`. */
  dashFor(style: PriceLineStyle, width: number): number[] {
    return (this.dashes[style] ?? []).map((length) => length * width);
  }

  private create(options: PriceLineOptions): PriceLine {
    const lineStyle = options.lineStyle ?? 'solid';
    const lineWidth = options.lineWidth ?? 1;
    const item: MutableItem = {
      id: options.id ?? `pl-${++this.seq}`,
      price: options.price,
      color: options.color ?? DEFAULT_PRICE_LINE_COLOR,
      lineStyle,
      lineWidth,
      title: options.title ?? '',
      axisLabelVisible: options.axisLabelVisible ?? true,
      lineVisible: options.lineVisible ?? true,
      axisLabelColor: options.axisLabelColor ?? '',
      axisLabelTextColor: options.axisLabelTextColor ?? '',
      autoscale: options.autoscale ?? false,
      dash: this.dashFor(lineStyle, lineWidth),
    };
    const handle = new PriceLineHandle(this, item);
    if (this.destroyed) {
      handle.detached = true;
      return handle;
    }
    this.handles.push(handle);
    this.lines.push(item);
    this.invalidate();
    return handle;
  }

  /** Detaches `line`; returns whether it was live here. */
  remove(line: PriceLine): boolean {
    const index = this.handles.indexOf(line as PriceLineHandle);
    if (index < 0) return false;
    this.handles[index]!.detached = true;
    this.handles.splice(index, 1);
    this.lines.splice(index, 1);
    this.invalidate();
    return true;
  }

  private setMarkers(markers: readonly SeriesMarker[]): void {
    if (this.destroyed) return;
    this.markers = markers
      .filter((marker) => Number.isFinite(marker.time))
      .map((marker) => ({ ...marker }))
      .sort((a, b) => a.time - b.time);
    this.invalidate();
  }

  /**
   * Extends an autoscale bound to lines with `autoscale: true`: the lowest
   * price for `side` -1, the highest for +1. With `empty` (no visible bars,
   * so `bound` is only a placeholder) those lines alone set the bound; with
   * no such line `bound` is returned unchanged.
   */
  autoscaleBound(bound: number, side: -1 | 1, empty: boolean): number {
    let out = empty ? -side * Infinity : bound;
    for (const line of this.lines) {
      if (line.autoscale && Number.isFinite(line.price) && (line.price - out) * side > 0) out = line.price;
    }
    return Number.isFinite(out) ? out : bound;
  }

  /** Detaches every handle; later calls are inert and never repaint. */
  destroy(): void {
    this.destroyed = true;
    for (const handle of this.handles) handle.detached = true;
    this.handles.length = 0;
    this.lines.length = 0;
    this.markers = [];
  }
}
