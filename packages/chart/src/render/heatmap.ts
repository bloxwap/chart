/**
 * Liquidity heatmap (Bookmap-style): resting order-book size over time as a
 * color field behind the candles. A {@link DepthHistory} window retains one
 * trimmed book snapshot per wall-clock bucket; this primitive paints, per
 * visible bucket, a column of cells whose color intensity is the level size
 * over the visible window's largest size, so persistent resting liquidity
 * shows as bright walls and pulled liquidity fades.
 *
 * Cells aggregate per pixel column and pixel row (max intensity wins), so
 * zooming out merges sub-pixel buckets instead of stacking alpha. The depth
 * channel re-renders the chart on every book update, so the draw pass records
 * the current book (deduped by book time inside {@link DepthHistory}) before
 * painting, exactly like the inline book reads `Chart.depth` at draw time.
 *
 * @module
 */

import { parseColor, serializeColor, type ParsedColor } from '../color.js';
import { mergeDeep, type HeatmapConfig } from '../config.js';
import type { Chart, PanePrimitiveHandle } from '../core/chart.js';
import type { DepthBook, DepthLevel } from '../core/depth.js';
import {
  DepthHistory,
  heatmapIntensity,
  heatPosition,
  DEFAULT_HEATMAP_BUCKET_MS,
  DEFAULT_HEATMAP_COLOR_HIGH,
  DEFAULT_HEATMAP_COLOR_LOW,
  DEFAULT_HEATMAP_GAMMA,
  DEFAULT_HEATMAP_MAX_BUCKETS,
  DEFAULT_HEATMAP_MAX_LEVELS,
  DEFAULT_HEATMAP_MIN_OPACITY,
  DEFAULT_HEATMAP_OPACITY,
  type HeatmapSnapshot,
  type HeatmapStop,
} from '../core/heatmap.js';
import type { Canvas2DLike } from '../dom.js';
import type { PanePrimitive, PrimitiveDrawTarget } from './primitive.js';

/** Steps of the precomputed intensity ramp (fillStyle strings). */
export const HEATMAP_RAMP_STEPS = 64;

/** Options for {@link createHeatmapPrimitive} and {@link attachHeatmap}. */
export interface HeatmapOptions {
  /** Wall-clock bucket width in ms. Default {@link DEFAULT_HEATMAP_BUCKET_MS}. */
  bucketMs?: number;
  /** Retained buckets. Default {@link DEFAULT_HEATMAP_MAX_BUCKETS}. */
  maxBuckets?: number;
  /** Levels kept per side per snapshot. Default {@link DEFAULT_HEATMAP_MAX_LEVELS}. */
  maxLevels?: number;
  /** Ramp color at zero intensity. Default {@link DEFAULT_HEATMAP_COLOR_LOW}. */
  colorLow?: string;
  /** Ramp color at full intensity. Default {@link DEFAULT_HEATMAP_COLOR_HIGH}. */
  colorHigh?: string;
  /** A custom gradient replacing `colorLow` → `colorHigh`; see {@link HeatmapRampShape.stops}. */
  stops?: readonly HeatmapStop[];
  /** Peak cell alpha at full intensity, 0-1. Default {@link DEFAULT_HEATMAP_OPACITY}. */
  opacity?: number;
  /** Cell alpha at zero intensity, 0-1. Default {@link DEFAULT_HEATMAP_MIN_OPACITY}. */
  minOpacity?: number;
  /** Intensity curve exponent; below 1 lifts small sizes. Default {@link DEFAULT_HEATMAP_GAMMA}. */
  gamma?: number;
  /** Record into an existing history instead of a fresh one. */
  history?: DepthHistory;
}

/** A pane primitive painting the depth history as a color field; see {@link createHeatmapPrimitive}. */
export interface Heatmap extends PanePrimitive {
  /** The window the primitive records into and paints. */
  readonly history: DepthHistory;
  /** Largest visible level size of the last draw (the intensity normalizer); 0 when nothing was visible. */
  readonly visibleMax: number;
}

/** Handle of a heatmap attached via {@link attachHeatmap}. */
export interface HeatmapApi {
  /** The attached primitive. */
  readonly primitive: Heatmap;
  /** The retained depth history. */
  readonly history: DepthHistory;
  /** Merges new options and re-renders. */
  update(options: HeatmapOptions): void;
  /** Drops the config subscription and detaches the primitive. */
  remove(): void;
}

interface ResolvedHeatmapOptions {
  bucketMs: number;
  maxBuckets: number;
  maxLevels: number;
  gamma: number;
  lut: readonly string[];
  /** The ramp as unit-channel RGBA float quads, parallel to `lut` (WebGL2 backend). */
  lutRGBA: Float32Array;
}

/** Channels 0-1 regardless of the parsed color's space. */
function unitChannels(c: ParsedColor): readonly [number, number, number] {
  const d = c.space === 'srgb' ? 255 : 1;
  return [c.r / d, c.g / d, c.b / d];
}

/** One ramp step: unit RGB channels plus alpha, in the ramp's color space. */
type RampStep = readonly [number, number, number, number];

interface RampSpec {
  readonly p3: boolean;
  readonly steps: RampStep[];
}

/** Shaping beyond the two-color ramp, for {@link heatmapRamp} and {@link heatmapRampRGBA}. */
export interface HeatmapRampShape {
  /**
   * A custom gradient from zero to full intensity. Bare colors spread evenly
   * by index; `{ color, at }` pins a stop to an intensity (clamped to 0-1).
   * Unparseable colors are skipped, and a stop color's alpha scales the ramp
   * alpha there. With no usable stop the ramp stays `colorLow` → `colorHigh`.
   */
  readonly stops?: readonly HeatmapStop[] | undefined;
  /** Cell alpha at zero intensity, 0-1. Default {@link DEFAULT_HEATMAP_MIN_OPACITY}. */
  readonly minOpacity?: number | undefined;
}

/** A parsed gradient stop at its intensity. */
interface GradientStop {
  readonly at: number;
  readonly color: ParsedColor;
}

/** The usable stops, sorted by intensity. */
function gradientStops(stops: readonly HeatmapStop[]): GradientStop[] {
  const out: GradientStop[] = [];
  stops.forEach((stop, i) => {
    const spec = typeof stop === 'string' ? { color: stop } : stop;
    const color = parseColor(spec.color);
    if (color === null) return;
    const at = spec.at !== undefined && Number.isFinite(spec.at) ? spec.at : stops.length > 1 ? i / (stops.length - 1) : 0;
    out.push({ at: Math.min(1, Math.max(0, at)), color });
  });
  return out.sort((a, b) => a.at - b.at);
}

/** Unit channels and alpha of the gradient at intensity `t`, held flat past its end stops. */
function sampleGradient(stops: readonly GradientStop[], t: number): RampStep {
  let lo = stops[0]!, hi = lo;
  for (const stop of stops) {
    if (stop.at <= t) lo = stop;
    if (stop.at >= t) { hi = stop; break; }
  }
  if (hi.at < t) hi = lo;
  const span = hi.at - lo.at;
  const f = span > 0 ? (t - lo.at) / span : 0;
  const a = unitChannels(lo.color), b = unitChannels(hi.color);
  const mix = (u: number, v: number) => u + (v - u) * f;
  return [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2]), mix(lo.color.a, hi.color.a)];
}

/** The shared ramp math behind {@link heatmapRamp} and {@link heatmapRampRGBA}. */
function rampSpec(colorLow: string, colorHigh: string, opacity: number, shape: HeatmapRampShape = {}): RampSpec {
  const custom = gradientStops(shape.stops ?? []);
  const stops = custom.length > 0 ? custom : [
    { at: 0, color: parseColor(colorLow) ?? parseColor(DEFAULT_HEATMAP_COLOR_LOW)! },
    { at: 1, color: parseColor(colorHigh) ?? parseColor(DEFAULT_HEATMAP_COLOR_HIGH)! },
  ];
  const p3 = stops.some((stop) => stop.color.space === 'display-p3');
  const unit = (v: number) => Math.min(1, Math.max(0, v));
  const peak = unit(opacity);
  const floor = unit(shape.minOpacity ?? DEFAULT_HEATMAP_MIN_OPACITY);
  const steps: RampStep[] = [];
  for (let i = 0; i < HEATMAP_RAMP_STEPS; i++) {
    const t = i / (HEATMAP_RAMP_STEPS - 1);
    const [r, g, b, a] = sampleGradient(stops, t);
    steps.push([r, g, b, (floor + (peak - floor) * t) * a]);
  }
  return { p3, steps };
}

/**
 * The intensity ramp as `HEATMAP_RAMP_STEPS` fillStyle strings, lerping
 * `colorLow` → `colorHigh` (or `shape.stops`) with alpha `shape.minOpacity`
 * (default 0, so step 0 is fully transparent) → `opacity`, scaled by each
 * color's own alpha. Unparseable endpoints fall back to the defaults; any
 * Display-P3 color makes the whole ramp Display-P3.
 */
export function heatmapRamp(colorLow: string, colorHigh: string, opacity: number, shape: HeatmapRampShape = {}): string[] {
  const { p3, steps } = rampSpec(colorLow, colorHigh, opacity, shape);
  const scale = p3 ? 1 : 255;
  return steps.map(([r, g, b, a]) => serializeColor({
    space: p3 ? 'display-p3' : 'srgb',
    r: r * scale,
    g: g * scale,
    b: b * scale,
    a,
  }));
}

/**
 * The same ramp as `HEATMAP_RAMP_STEPS × 4` floats (unit channels, straight
 * alpha) for the WebGL2 backend's quad colors. Display-P3 endpoints keep their
 * P3 channel values; the GL canvas composites them in its default sRGB space.
 */
export function heatmapRampRGBA(colorLow: string, colorHigh: string, opacity: number, shape: HeatmapRampShape = {}): Float32Array {
  const { steps } = rampSpec(colorLow, colorHigh, opacity, shape);
  const lut = new Float32Array(HEATMAP_RAMP_STEPS * 4);
  for (let i = 0; i < HEATMAP_RAMP_STEPS; i++) {
    lut.set(steps[i]!, i * 4);
  }
  return lut;
}

function resolveHeatmapOptions(o: HeatmapOptions): ResolvedHeatmapOptions {
  const colorLow = o.colorLow ?? DEFAULT_HEATMAP_COLOR_LOW;
  const colorHigh = o.colorHigh ?? DEFAULT_HEATMAP_COLOR_HIGH;
  const opacity = o.opacity ?? DEFAULT_HEATMAP_OPACITY;
  const shape: HeatmapRampShape = { stops: o.stops, minOpacity: o.minOpacity };
  return {
    bucketMs: Math.max(1, Math.floor(o.bucketMs ?? DEFAULT_HEATMAP_BUCKET_MS)),
    maxBuckets: Math.max(1, Math.floor(o.maxBuckets ?? DEFAULT_HEATMAP_MAX_BUCKETS)),
    maxLevels: Math.max(1, Math.floor(o.maxLevels ?? DEFAULT_HEATMAP_MAX_LEVELS)),
    gamma: Math.max(0.05, o.gamma ?? DEFAULT_HEATMAP_GAMMA),
    lut: heatmapRamp(colorLow, colorHigh, opacity, shape),
    lutRGBA: heatmapRampRGBA(colorLow, colorHigh, opacity, shape),
  };
}

/** Smallest positive gap between adjacent levels of both sides; the fallback step for ragged books. */
function minGap(snapshot: HeatmapSnapshot): number {
  let gap = Infinity;
  for (const side of [snapshot.bids, snapshot.asks]) {
    for (let i = 1; i < side.length; i++) {
      const d = Math.abs(side[i]![0] - side[i - 1]![0]);
      if (d > 0 && d < gap) gap = d;
    }
  }
  return gap === Infinity ? 1 : gap;
}

/**
 * Visits every level band of one side with `(size, yTop, yBottom)` in pane
 * pixels. Bands reach the midpoint toward each neighbor, like the inline
 * book's rows; edge rows extend half their own step.
 */
function eachSideBand(levels: readonly DepthLevel[], outward: 1 | -1, fallback: number, target: PrimitiveDrawTarget, visit: (size: number, yTop: number, yBottom: number) => void): void {
  for (let i = 0; i < levels.length; i++) {
    const [price, size] = levels[i]!;
    const next = i + 1 < levels.length ? (levels[i + 1]![0] - price) * outward : NaN;
    const prev = i > 0 ? (price - levels[i - 1]![0]) * outward : NaN;
    const step = Number.isFinite(next) && next > 0 ? next : Number.isFinite(prev) && prev > 0 ? prev : fallback;
    const outer = price + (outward * step) / 2;
    const inner = i === 0 ? price - (outward * step) / 2 : (levels[i - 1]![0] + price) / 2;
    const yA = target.priceScale.priceToY(Math.max(inner, outer));
    const yB = target.priceScale.priceToY(Math.min(inner, outer));
    visit(size, Math.min(yA, yB), Math.max(yA, yB));
  }
}

/** Every level band of both sides of `snapshot`. */
function eachBand(snapshot: HeatmapSnapshot, fallback: number, target: PrimitiveDrawTarget, visit: (size: number, yTop: number, yBottom: number) => void): void {
  eachSideBand(snapshot.bids, -1, fallback, target, visit);
  eachSideBand(snapshot.asks, 1, fallback, target, visit);
}

function drawHeatmap(
  ctx: Canvas2DLike,
  target: PrimitiveDrawTarget,
  book: () => DepthBook | null,
  history: DepthHistory,
  o: ResolvedHeatmapOptions,
  scratch: { rows: Uint8Array; xs: Float64Array },
  state: { visibleMax: number },
): void {
  state.visibleMax = 0;
  history.record(book());
  const count = history.length;
  const candles = target.candles;
  const n = candles.length;
  if (count === 0 || n === 0) return;
  const ts = target.timeScale;
  const rawSlots = ts.slots;
  const slots = rawSlots !== null && rawSlots.length === n ? rawSlots : null;
  const lastUnit = slots !== null ? slots[n - 1]! : n - 1;
  const height = target.height;
  const rows = Math.max(1, Math.ceil(height));
  if (scratch.rows.length < rows) scratch.rows = new Uint8Array(rows);
  const grid = scratch.rows;

  // X pixels of every bucket from the one straddling the range's left edge.
  const from = Math.max(0, Math.min(n - 1, Math.floor(target.range.from)));
  const start = history.firstAtOrAfter(candles[from]!.time * 1000 - history.bucketMs);
  if (scratch.xs.length < count - start) scratch.xs = new Float64Array(count - start);
  const xs = scratch.xs;
  let end = count;
  for (let k = start; k < count; k++) {
    const position = heatPosition(candles, slots, history.at(k)!.time);
    const x = position === null ? NaN : ts.width - (lastUnit - position - ts.scrollOffset) * ts.barSpacing - ts.barSpacing / 2;
    xs[k - start] = x;
    if (x > ts.width) {
      end = k;
      break;
    }
  }
  const intervalMs = n > 1 ? (candles[n - 1]!.time - candles[n - 2]!.time) * 1000 : 0;
  const columnPx = intervalMs > 0 ? Math.max(1, (ts.barSpacing * history.bucketMs) / intervalMs) : Math.max(1, ts.barSpacing);

  // Pass 1: the rolling normalizer — largest level size inside the window.
  let max = 0;
  for (let k = start; k < end; k++) {
    const x = xs[k - start]!;
    if (Number.isNaN(x) || x + columnPx <= 0) continue;
    const snapshot = history.at(k)!;
    const fallback = minGap(snapshot);
    eachBand(snapshot, fallback, target, (size, yTop, yBottom) => {
      if (size > max && yBottom > 0 && yTop < height) max = size;
    });
  }
  if (max <= 0) return;
  state.visibleMax = max;

  // Pass 2: aggregate per pixel column × pixel row (max intensity wins), one fill per run.
  // With a GL frame on the target (WebGL2 backend) runs become quads instead of fillRects.
  const gl = target.gl;
  let column = -1;
  let lo = rows;
  let hi = -1;
  const flush = (nextColumn: number): void => {
    if (column >= 0 && hi >= lo) {
      const w = Math.max(1, nextColumn - column);
      let r = lo;
      while (r <= hi) {
        const step = grid[r]!;
        if (step === 0) {
          r++;
          continue;
        }
        let r1 = r + 1;
        while (r1 <= hi && grid[r1] === step) r1++;
        if (gl !== undefined) {
          const c4 = step * 4;
          gl.quad(column, r, w, r1 - r, o.lutRGBA[c4]!, o.lutRGBA[c4 + 1]!, o.lutRGBA[c4 + 2]!, o.lutRGBA[c4 + 3]!);
        } else {
          ctx.fillStyle = o.lut[step]!;
          ctx.fillRect(column, r, w, r1 - r);
        }
        r = r1;
      }
    }
    if (hi >= lo) grid.fill(0, lo, hi + 1);
    lo = rows;
    hi = -1;
  };
  for (let k = start; k < end; k++) {
    const x = xs[k - start]!;
    if (Number.isNaN(x) || x + columnPx <= 0) continue;
    const c = Math.floor(x);
    if (c !== column) {
      flush(c);
      column = c;
    }
    const snapshot = history.at(k)!;
    const fallback = minGap(snapshot);
    eachBand(snapshot, fallback, target, (size, yTop, yBottom) => {
      if (yBottom <= 0 || yTop >= height) return;
      const step = Math.round(heatmapIntensity(size, max, o.gamma) * (HEATMAP_RAMP_STEPS - 1));
      if (step === 0) return;
      // yTop < height ≤ rows, so r0 is always a valid row; a zero-height band still paints one.
      const r0 = Math.max(0, Math.floor(yTop));
      let r1 = Math.min(rows, Math.ceil(yBottom));
      if (r1 <= r0) r1 = r0 + 1;
      for (let r = r0; r < r1; r++) if (step > grid[r]!) grid[r] = step;
      if (r0 < lo) lo = r0;
      if (r1 - 1 > hi) hi = r1 - 1;
    });
  }
  flush(column + Math.max(1, Math.round(columnPx)));
}

/** The shared-resolved primitive; `attachHeatmap` mutates `resolved` to live-update. */
function heatmapPrimitive(book: () => DepthBook | null, resolved: ResolvedHeatmapOptions, history: DepthHistory): Heatmap {
  const scratch = { rows: new Uint8Array(0), xs: new Float64Array(0) };
  const state = { visibleMax: 0 };
  return {
    zOrder: 'behind',
    get history() {
      return history;
    },
    get visibleMax() {
      return state.visibleMax;
    },
    draw(ctx, target) {
      drawHeatmap(ctx, target, book, history, resolved, scratch, state);
    },
  };
}

/**
 * A primitive painting the depth history behind the main pane's series. The
 * book `book` returns (null paints nothing new) is recorded at draw time;
 * options resolve over the defaults. Pixel-column aggregation keeps the fill
 * count proportional to the viewport rather than the bucket count.
 */
export function createHeatmapPrimitive(book: () => DepthBook | null, options: HeatmapOptions = {}): Heatmap {
  const resolved = resolveHeatmapOptions(options);
  return heatmapPrimitive(book, resolved, options.history ?? new DepthHistory(resolved));
}

/** The config section as primitive options; `enabled` is handled by the attach. */
function configOptions(config: HeatmapConfig): HeatmapOptions {
  return {
    bucketMs: config.bucketMs,
    maxBuckets: config.maxBuckets,
    maxLevels: config.maxLevels,
    colorLow: config.colorLow,
    colorHigh: config.colorHigh,
    stops: config.stops,
    opacity: config.opacity,
    minOpacity: config.minOpacity,
    gamma: config.gamma,
  };
}

/**
 * Attaches the liquidity heatmap to the main pane (z-order below the series),
 * recording `chart.depth` on every render. Options resolve over the config's
 * `heatmap` section, and an attached heatmap follows later
 * `updateConfig({ heatmap })` writes (ramp, opacity, gamma, bucket grid).
 */
export function attachHeatmap(chart: Chart, options: HeatmapOptions = {}): HeatmapApi {
  let explicit: HeatmapOptions = options;
  const resolved = resolveHeatmapOptions(mergeDeep(configOptions(chart.getConfig().heatmap), explicit));
  const history = options.history ?? new DepthHistory(resolved);
  const primitive = heatmapPrimitive(() => chart.depth, resolved, history);
  const handle: PanePrimitiveHandle = chart.attachPrimitive(primitive);

  /** Rebuilds the ramp and re-grids future records, keeping the retained window. */
  const apply = (): void => {
    const next = resolveHeatmapOptions(mergeDeep(configOptions(chart.getConfig().heatmap), explicit));
    Object.assign(resolved, next);
    history.configure(next);
    handle.requestUpdate();
  };

  const offConfig = chart.subscribeConfigChange(({ keys }) => {
    if (keys.includes('heatmap')) apply();
  });

  return {
    primitive,
    history,
    update(next) {
      explicit = mergeDeep(explicit, next);
      apply();
    },
    remove() {
      offConfig();
      handle.detach();
    },
  };
}
