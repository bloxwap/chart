/**
 * Visible-range volume profile floating over the plot's right edge: one row
 * per round price step (sized so rows stay about `rowHeight` pixels tall)
 * across the visible price range, down volume growing left and up volume
 * right from a central column of size labels. Each row is shaded by its share
 * of the busiest row, and the point of control (POC) is outlined. It is
 * rebuilt from the candles in view on every render, so it follows zoom, pan
 * and live bars; candles draw over it.
 *
 * Colors default to theme tokens (`'up'` / `'down'` follow the series colors,
 * `'text'` the theme text color), resolved on every draw so the profile
 * tracks theme switches. With a frame scheduler, bar widths and shading tween
 * to each new value; a row that appears after a re-bucket starts from the
 * previous frame's shape at its price, so a zoom morphs rather than flickers.
 *
 * @module
 */

import { DEFAULT_CONFIG, type ChartConfig } from '../config.js';
import type { Chart, PanePrimitiveHandle } from '../core/chart.js';
import { gridVolumeRows, profileStep } from '../core/profile.js';
import type { FrameScheduler } from '../core/zoom.js';
import type { Canvas2DLike } from '../dom.js';
import { DOWN_COLOR, UP_COLOR } from '../indicators/types.js';
import type { PanePrimitive, PrimitiveDrawTarget } from './primitive.js';

/** Color token resolving to the chart theme's text color. */
export const TEXT_COLOR = 'text';

/** Label color token: each size takes its own side's bar color (down left, up right). */
export const SIDE_COLOR = 'side';

/** Options for {@link createRangeProfilePrimitive} and {@link attachRangeProfile}. */
export interface RangeProfileOptions {
  /** Profile width in CSS pixels. Default 200. */
  width?: number;
  /** Gap in CSS pixels between the profile and the price axis. Default 48. */
  inset?: number;
  /** Target row height in CSS pixels; the price step rounds to 1/2/2.5/5 × 10ⁿ. Default 14. */
  rowHeight?: number;
  /** Gap in CSS pixels between rows. Default 1. */
  rowGap?: number;
  /** Up-volume (buy) bar color, growing right; `'up'` follows `series.upColor`. Default `'up'`. */
  upColor?: string;
  /** Down-volume (sell) bar color, growing left; `'down'` follows `series.downColor`. Default `'down'`. */
  downColor?: string;
  /** Opacity of the busiest row's bars; low values tint the rows behind vivid labels. Default 0.35. */
  opacity?: number;
  /** Opacity of the quietest row as a fraction of `opacity`. Default 0.3. */
  minOpacity?: number;
  /** Down/up size labels beside the center line when rows are tall enough. Default true. */
  showLabels?: boolean;
  /**
   * Label color; `'side'` colors each size like its side's bars, `'text'` follows
   * the theme text color. The POC row's sizes are bold. Default `'side'`.
   */
  labelColor?: string;
  /** Label size in CSS pixels, in the theme's mono family at medium weight. Default 11. */
  fontSize?: number;
  /** Outline the point of control (the busiest row). Default true. */
  showPoc?: boolean;
  /** POC outline color; `'text'` follows the theme text color. Default `'text'`. */
  pocColor?: string;
  /** Transition length in ms when a scheduler drives the profile; 0 applies changes at once. Default 180. */
  duration?: number;
  /** Transition timing. Default `'linear'`. */
  easing?: 'linear' | 'ease-out';
}

/** Input for {@link attachRangeProfile}. */
export interface RangeProfileAttachOptions extends RangeProfileOptions {
  /** Drives the transitions (e.g. `createFrameScheduler`); without one, changes apply at once. */
  scheduler?: FrameScheduler;
}

/** Handle of a profile attached via {@link attachRangeProfile}. */
export interface RangeProfileApi {
  /** Merges new options and re-renders. */
  update(options: RangeProfileOptions): void;
  /** Detaches the profile and cancels a pending transition frame. */
  remove(): void;
}

type ResolvedRangeProfileOptions = Required<RangeProfileOptions>;

/** Colors the tokens resolve to. */
interface ProfileTheme {
  readonly up: string;
  readonly down: string;
  readonly text: string;
  readonly font: string;
}

/** Clock and frame request of an animated profile. */
interface ProfileClock {
  now(): number;
  frame(): void;
}

/** A row's displayed geometry: bar widths in pixels and its 0–1 shading. */
interface Shape {
  readonly down: number;
  readonly up: number;
  readonly shade: number;
}

interface Tween {
  readonly from: Shape;
  readonly to: Shape;
  readonly start: number;
}

/** A row as last drawn, by price bounds, for re-bucket starts. */
interface DrawnRow {
  readonly lo: number;
  readonly hi: number;
  readonly shape: Shape;
}

/** Most rows one profile draws; a guard against a degenerate price scale. */
const MAX_ROWS = 2_000;

/** Rows shorter than this skip their labels. */
const LABEL_MIN_ROW_PX = 9;

const EMPTY: Shape = { down: 0, up: 0, shade: 0 };

function resolve(o: RangeProfileOptions): ResolvedRangeProfileOptions {
  return {
    width: o.width ?? 200,
    inset: o.inset ?? 48,
    rowHeight: Math.max(2, o.rowHeight ?? 14),
    rowGap: Math.max(0, o.rowGap ?? 1),
    upColor: o.upColor ?? UP_COLOR,
    downColor: o.downColor ?? DOWN_COLOR,
    opacity: Math.min(1, Math.max(0, o.opacity ?? 0.35)),
    minOpacity: Math.min(1, Math.max(0, o.minOpacity ?? 0.3)),
    showLabels: o.showLabels ?? true,
    labelColor: o.labelColor ?? SIDE_COLOR,
    fontSize: o.fontSize ?? 11,
    showPoc: o.showPoc ?? true,
    pocColor: o.pocColor ?? TEXT_COLOR,
    duration: Math.max(0, o.duration ?? 180),
    easing: o.easing ?? 'linear',
  };
}

function themeOf(config: ChartConfig): ProfileTheme {
  return { up: config.series.upColor, down: config.series.downColor, text: config.theme.textColor, font: config.theme.monoFamily };
}

function color(value: string, theme: ProfileTheme): string {
  return value === UP_COLOR ? theme.up : value === DOWN_COLOR ? theme.down : value === TEXT_COLOR ? theme.text : value;
}

/** Compact volume label: `823`, `3K`, `12K`, `1.2M`. */
export function formatProfileVolume(volume: number): string {
  const abs = Math.abs(volume);
  if (abs >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${Math.round(volume / 1_000)}K`;
  return String(Math.round(volume));
}

function lerp(a: Shape, b: Shape, t: number): Shape {
  return { down: a.down + (b.down - a.down) * t, up: a.up + (b.up - a.up) * t, shade: a.shade + (b.shade - a.shade) * t };
}

const sameShape = (a: Shape, b: Shape): boolean => a.down === b.down && a.up === b.up && a.shade === b.shade;

/** The primitive; `resolved` is read on every draw so `update` restyles in place. */
function rangeProfilePrimitive(resolved: ResolvedRangeProfileOptions, theme: () => ProfileTheme, clock: ProfileClock | null): PanePrimitive {
  let tweens = new Map<number, Tween>();
  let drawn: DrawnRow[] = [];

  /** Progress of `tween` at `now`, eased. */
  const progress = (tween: Tween, now: number): number => {
    const t = Math.min(1, (now - tween.start) / resolved.duration);
    return resolved.easing === 'linear' ? t : 1 - (1 - t) ** 3;
  };
  /** The previous frame's shape at `price`: a re-bucketed row starts where the profile was. */
  const shapeAt = (price: number): Shape => drawn.find((row) => price >= row.lo && price < row.hi)?.shape ?? EMPTY;

  function draw(ctx: Canvas2DLike, target: PrimitiveDrawTarget): void {
    const o = resolved;
    const { priceScale, height } = target;
    const a = priceScale.yToPrice(0), b = priceScale.yToPrice(height);
    const pMin = Math.min(a, b), pMax = Math.max(a, b);
    const step = profileStep(((pMax - pMin) / height) * o.rowHeight);
    const lo = Math.floor(pMin / step) * step;
    const rows = pMax > pMin ? Math.min(MAX_ROWS, Math.ceil((pMax - lo) / step)) : 0; // none in a zero-height pane
    const { up, down } = gridVolumeRows(target.candles, target.range.from, target.range.to - 1, lo, step, rows);
    // Bars scale to the largest single side, so it spans its half; shading and the POC follow row totals.
    let max = 0, poc = -1, sideMax = 0;
    for (let r = 0; r < rows; r++) {
      const total = up[r]! + down[r]!;
      sideMax = Math.max(sideMax, up[r]!, down[r]!);
      if (total > max) {
        max = total;
        poc = r;
      }
    }
    if (max <= 0) {
      tweens = new Map();
      drawn = [];
      return;
    }

    const animate = clock !== null && o.duration > 0;
    const colors = theme();
    const w = Math.min(o.width, target.width);
    const x0 = Math.max(0, target.width - w - o.inset);
    const cx = x0 + w / 2;
    const half = w / 2;
    const alpha = ctx.globalAlpha;
    const now = animate ? clock.now() : 0;
    const nextTweens = new Map<number, Tween>();
    const nextDrawn: DrawnRow[] = [];
    let moving = false;
    const size = `${o.fontSize}px ${colors.font}`;
    const font = `500 ${size}`; // medium weight keeps thin glyphs vivid over the tint
    const downLabel = color(o.labelColor === SIDE_COLOR ? o.downColor : o.labelColor, colors);
    const upLabel = color(o.labelColor === SIDE_COLOR ? o.upColor : o.labelColor, colors);
    ctx.save();
    ctx.font = font;
    ctx.textBaseline = 'middle';
    for (let r = 0; r < rows; r++) {
      const rowLo = lo + r * step;
      const total = up[r]! + down[r]!;
      const goal: Shape = { down: (down[r]! / sideMax) * half, up: (up[r]! / sideMax) * half, shade: total / max };
      let shape = goal;
      if (animate) {
        const key = Number(rowLo.toPrecision(12));
        const prev = tweens.get(key);
        const tween = prev === undefined ? { from: shapeAt(rowLo + step / 2), to: goal, start: now }
          : sameShape(prev.to, goal) ? prev
            : { from: lerp(prev.from, prev.to, progress(prev, now)), to: goal, start: now };
        const t = progress(tween, now);
        shape = lerp(tween.from, tween.to, t);
        if (t < 1) moving = true;
        nextTweens.set(key, tween);
      }
      nextDrawn.push({ lo: rowLo, hi: rowLo + step, shape });
      const visible = shape.down + shape.up > 0;
      if (total <= 0 && !visible) continue; // an empty row, or one done shrinking
      const ya = priceScale.priceToY(rowLo), yb = priceScale.priceToY(rowLo + step);
      const y0 = Math.min(ya, yb), y1 = Math.max(ya, yb);
      const h = Math.max(1, y1 - y0 - o.rowGap);
      if (visible) {
        ctx.globalAlpha = alpha * o.opacity * (o.minOpacity + (1 - o.minOpacity) * shape.shade);
        ctx.fillStyle = color(o.downColor, colors);
        ctx.fillRect(cx - shape.down, y0, shape.down, h);
        ctx.fillStyle = color(o.upColor, colors);
        ctx.fillRect(cx, y0, shape.up, h);
      }
      if (total <= 0) continue; // shrinking out: bars only, no labels
      if (o.showLabels && h >= LABEL_MIN_ROW_PX) {
        ctx.globalAlpha = alpha;
        if (r === poc) ctx.font = `bold ${size}`;
        ctx.fillStyle = downLabel;
        ctx.textAlign = 'right';
        ctx.fillText(formatProfileVolume(down[r]!), cx - 3, y0 + h / 2);
        ctx.fillStyle = upLabel;
        ctx.textAlign = 'left';
        ctx.fillText(formatProfileVolume(up[r]!), cx + 3, y0 + h / 2);
        if (r === poc) ctx.font = font;
      }
      if (o.showPoc && r === poc) {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color(o.pocColor, colors);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(x0 + 0.5, y0 + 0.5, w - 1, Math.max(1, h - 1));
        ctx.stroke();
      }
    }
    ctx.restore();
    tweens = nextTweens;
    drawn = nextDrawn;
    if (moving) clock!.frame();
  }

  return { zOrder: 'behind', draw };
}

/**
 * A main-pane primitive painting the visible-range profile; attach it with
 * `chart.attachPrimitive`. Color tokens resolve against the default theme and
 * changes apply at once; {@link attachRangeProfile} follows the chart's theme
 * and can animate.
 */
export function createRangeProfilePrimitive(options: RangeProfileOptions = {}): PanePrimitive {
  return rangeProfilePrimitive(resolve(options), () => themeOf(DEFAULT_CONFIG), null);
}

/**
 * Attaches a visible-range profile to the main pane. Color tokens follow the
 * chart's live config; with a `scheduler`, changes tween over `duration`.
 * {@link RangeProfileApi.update} restyles it live.
 */
export function attachRangeProfile(chart: Chart, options: RangeProfileAttachOptions = {}): RangeProfileApi {
  const { scheduler, ...style } = options;
  let current: RangeProfileOptions = style;
  const resolved = resolve(current);
  let pending: number | null = null;
  const clock: ProfileClock | null = scheduler === undefined ? null : {
    now: () => scheduler.now(),
    frame: () => {
      pending ??= scheduler.request(() => {
        pending = null;
        handle.requestUpdate();
      });
    },
  };
  const handle: PanePrimitiveHandle = chart.attachPrimitive(rangeProfilePrimitive(resolved, () => themeOf(chart.getConfig()), clock));
  return {
    update(next) {
      current = { ...current, ...next };
      Object.assign(resolved, resolve(current));
      handle.requestUpdate();
    },
    remove() {
      if (pending !== null) scheduler!.cancel(pending);
      pending = null;
      handle.detach();
    },
  };
}
