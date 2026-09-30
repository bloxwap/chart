/**
 * Session volume profile / TPO as a first-class pane: an auto-updating
 * profile docked beside the plot (composite or split per session) plus POC
 * and value-area high/low lines projected on the main pane. Built on
 * `Chart.addPane` + pane primitives, so it re-renders with every data,
 * range or scale change.
 *
 * @module
 */

import { defaultPriceFormatter } from '../config.js';
import type { Chart, PaneApi, PanePrimitiveHandle } from '../core/chart.js';
import {
  computeTpoProfile,
  computeVolumeProfile,
  DEFAULT_SESSION_MS,
  DEFAULT_VALUE_AREA_PERCENT,
  profileRowAt,
  sessionRanges,
  type PriceProfile,
  type VolumeProfile,
} from '../core/profile.js';
import type { Candle } from '../core/data.js';
import type { Canvas2DLike } from '../dom.js';
import type { PanePrimitive, PrimitiveDrawTarget } from './primitive.js';

/** Options shared by the profile pane and the main-pane level projections. */
export interface SessionProfileOptions {
  /** `'volume'` bins volume-at-price; `'tpo'` builds a market profile of time-at-price counts. Default `'volume'`. */
  mode?: 'volume' | 'tpo';
  /** Price rows per profile. Default 24. */
  rows?: number;
  /** Session length in milliseconds. Default one day ({@link DEFAULT_SESSION_MS}). */
  sessionMs?: number;
  /** Aggregate all visible sessions into one composite profile instead of one column per session. Default false. */
  composite?: boolean;
  /** Fraction of volume/TPO inside the value area. Default {@link DEFAULT_VALUE_AREA_PERCENT}. */
  valueAreaPercent?: number;
  /** Highlight the value-area rows. Default true. */
  showValueArea?: boolean;
  /** Mark the point-of-control row. Default true. */
  showPoc?: boolean;
  /** Rising-bar volume color in `'volume'` mode. Default `'#26a69a'`. */
  upColor?: string;
  /** Falling-bar volume color in `'volume'` mode. Default `'#ef5350'`. */
  downColor?: string;
  /** Letter/block color in `'tpo'` mode. Default `'#2962ff'`. */
  tpoColor?: string;
  /** Point-of-control line color. Default `'#f23645'`. */
  pocColor?: string;
  /** Value-area high/low line color. Default `'#787b86'`. */
  valueAreaColor?: string;
  /** Row opacity outside the value area. Default 0.25. */
  opacity?: number;
  /** Row opacity inside the value area. Default 0.55. */
  valueAreaOpacity?: number;
}

/** Options for the main-pane POC / value-area projections. */
export interface SessionLevelsOptions extends SessionProfileOptions {
  /** How many of the most recent visible sessions project lines. Default 1. */
  sessions?: number;
  /** Draw price labels next to the projected lines. Default true. */
  showLabels?: boolean;
}

/** Input for {@link attachSessionProfile}. */
export interface SessionProfileAttachOptions extends SessionProfileOptions {
  /** Host pane id. Default `'session-profile'`. */
  id?: string;
  /** Canvas edge the profile pane docks to. Default `'right'`. */
  placement?: 'left' | 'right';
  /** Dock strip width in CSS pixels. Default {@link DEFAULT_SESSION_PROFILE_WIDTH}. */
  width?: number;
  /** Project POC and value-area high/low lines onto the main pane. Default true. */
  projectLevels?: boolean;
  /** How many of the most recent visible sessions project lines. Default 1. */
  projectedSessions?: number;
  /** Draw price labels next to the projected lines. Default true. */
  showLabels?: boolean;
}

/** Handle of a session profile attached via {@link attachSessionProfile}. */
export interface SessionProfileApi {
  /** The docked profile pane. */
  readonly pane: PaneApi;
  /** Merges new options (and dock `width`) and re-renders. */
  update(options: SessionProfileAttachOptions): void;
  /** Detaches the projections and removes the pane. */
  remove(): void;
}

/** Default width in CSS pixels of the docked session profile pane. */
export const DEFAULT_SESSION_PROFILE_WIDTH = 120;

/** Letter cycle for TPO brackets, one per bar inside a session. */
const TPO_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface ResolvedSessionProfileOptions {
  mode: 'volume' | 'tpo';
  rows: number;
  sessionMs: number;
  composite: boolean;
  valueAreaPercent: number;
  showValueArea: boolean;
  showPoc: boolean;
  upColor: string;
  downColor: string;
  tpoColor: string;
  pocColor: string;
  valueAreaColor: string;
  opacity: number;
  valueAreaOpacity: number;
}

interface ResolvedSessionLevelsOptions extends ResolvedSessionProfileOptions {
  enabled: boolean;
  sessions: number;
  showLabels: boolean;
}

function resolveProfileOptions(o: SessionProfileOptions): ResolvedSessionProfileOptions {
  return {
    mode: o.mode ?? 'volume',
    rows: Math.max(1, Math.floor(o.rows ?? 24)),
    sessionMs: o.sessionMs ?? DEFAULT_SESSION_MS,
    composite: o.composite ?? false,
    valueAreaPercent: o.valueAreaPercent ?? DEFAULT_VALUE_AREA_PERCENT,
    showValueArea: o.showValueArea ?? true,
    showPoc: o.showPoc ?? true,
    upColor: o.upColor ?? '#26a69a',
    downColor: o.downColor ?? '#ef5350',
    tpoColor: o.tpoColor ?? '#2962ff',
    pocColor: o.pocColor ?? '#f23645',
    valueAreaColor: o.valueAreaColor ?? '#787b86',
    opacity: o.opacity ?? 0.25,
    valueAreaOpacity: o.valueAreaOpacity ?? 0.55,
  };
}

/** Inclusive bar range the pane draws, clamped to the data; `null` when empty. */
function visibleBars(target: PrimitiveDrawTarget): { from: number; to: number } | null {
  const last = target.candles.length - 1;
  if (last < 0) return null;
  const from = Math.max(0, Math.floor(target.range.from));
  const to = Math.min(last, Math.ceil(target.range.to) - 1);
  return to >= from ? { from, to } : null;
}

function buildProfile(
  candles: readonly Candle[],
  from: number,
  to: number,
  o: ResolvedSessionProfileOptions,
): PriceProfile | null {
  return o.mode === 'tpo'
    ? computeTpoProfile(candles, from, to, o.rows, o.valueAreaPercent)
    : computeVolumeProfile(candles, from, to, o.rows, o.valueAreaPercent);
}

/** Y pixels of row `r`'s top and bottom edges. */
function rowY(target: PrimitiveDrawTarget, profile: PriceProfile, r: number): { y0: number; y1: number } {
  return {
    y0: target.priceScale.priceToY(profile.lo + profile.step * (r + 1)),
    y1: target.priceScale.priceToY(profile.lo + profile.step * r),
  };
}

function rowAlpha(ctx: Canvas2DLike, base: number, profile: PriceProfile, r: number, o: ResolvedSessionProfileOptions): void {
  const inVa = o.showValueArea && r >= profile.valueAreaLow && r <= profile.valueAreaHigh;
  ctx.globalAlpha = base * (inVa ? o.valueAreaOpacity : o.opacity);
}

function drawVolumeColumn(
  ctx: Canvas2DLike,
  target: PrimitiveDrawTarget,
  profile: VolumeProfile,
  x0: number,
  barW: number,
  o: ResolvedSessionProfileOptions,
): void {
  const max = Math.max(...profile.totals) || 1;
  const alpha = ctx.globalAlpha;
  for (let r = 0; r < profile.rows; r++) {
    if (profile.totals[r]! <= 0) continue;
    const { y0, y1 } = rowY(target, profile, r);
    if (y0 >= target.height || y1 <= 0) continue;
    const h = Math.max(1, y1 - y0 - 0.5);
    rowAlpha(ctx, alpha, profile, r, o);
    const uw = (profile.up[r]! / max) * barW;
    const dw = (profile.down[r]! / max) * barW;
    if (uw > 0) {
      ctx.fillStyle = o.upColor;
      ctx.fillRect(x0, y0, uw, h);
    }
    if (dw > 0) {
      ctx.fillStyle = o.downColor;
      ctx.fillRect(x0 + uw, y0, dw, h);
    }
  }
  ctx.globalAlpha = alpha;
}

function drawTpoColumn(
  ctx: Canvas2DLike,
  target: PrimitiveDrawTarget,
  profile: PriceProfile,
  from: number,
  to: number,
  x0: number,
  barW: number,
  o: ResolvedSessionProfileOptions,
): void {
  const max = Math.max(...profile.totals) || 1;
  const advance = barW / max;
  const letters = advance >= 5;
  const alpha = ctx.globalAlpha;
  if (letters) {
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  }
  ctx.fillStyle = o.tpoColor;
  const slots = new Array<number>(profile.rows).fill(0);
  for (let i = from; i <= to; i++) {
    const c = target.candles[i]!;
    const letter = TPO_LETTERS[(i - from) % TPO_LETTERS.length]!;
    const r0 = profileRowAt(profile.lo, profile.step, profile.rows, c.low);
    const r1 = profileRowAt(profile.lo, profile.step, profile.rows, c.high);
    for (let r = r0; r <= r1; r++) {
      const slot = slots[r]!++;
      const { y0, y1 } = rowY(target, profile, r);
      if (y0 >= target.height || y1 <= 0) continue;
      rowAlpha(ctx, alpha, profile, r, o);
      const x = x0 + slot * advance;
      if (letters) ctx.fillText(letter, x, y0);
      else ctx.fillRect(x, y0, Math.max(1, advance - 0.5), Math.max(1, y1 - y0 - 0.5));
    }
  }
  ctx.globalAlpha = alpha;
}

function drawSessionProfile(ctx: Canvas2DLike, target: PrimitiveDrawTarget, o: ResolvedSessionProfileOptions): void {
  const bars = visibleBars(target);
  if (!bars) return;
  const sessions = o.composite
    ? [bars]
    : sessionRanges(target.candles, bars.from, bars.to, o.sessionMs).map(({ from, to }) => ({ from, to }));
  const colW = target.width / sessions.length;
  const barW = colW * 0.95;
  const alpha = ctx.globalAlpha;
  sessions.forEach((s, k) => {
    // Sessions are nonempty ranges inside the data, so a profile always exists.
    const profile = buildProfile(target.candles, s.from, s.to, o)!;
    const x0 = k * colW;
    if (o.mode === 'tpo') drawTpoColumn(ctx, target, profile, s.from, s.to, x0, barW, o);
    else drawVolumeColumn(ctx, target, profile as VolumeProfile, x0, barW, o);
    if (o.showPoc) {
      const { y0, y1 } = rowY(target, profile, profile.poc);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = o.pocColor;
      ctx.fillRect(x0, (y0 + y1) / 2 - 0.5, barW, 1);
    }
  });
  ctx.globalAlpha = alpha;
}

function levelLine(
  ctx: Canvas2DLike,
  target: PrimitiveDrawTarget,
  price: number,
  color: string,
  dash: number[],
  label: string | null,
): void {
  const y = Math.round(target.priceScale.priceToY(price)) + 0.5;
  if (y < 0 || y > target.height) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(target.width, y);
  ctx.stroke();
  ctx.setLineDash([]);
  if (label) {
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = color;
    ctx.fillText(label, target.width - 4, y - 1);
  }
}

function drawSessionLevels(ctx: Canvas2DLike, target: PrimitiveDrawTarget, o: ResolvedSessionLevelsOptions): void {
  if (!o.enabled) return;
  const bars = visibleBars(target);
  if (!bars) return;
  const sessions = sessionRanges(target.candles, bars.from, bars.to, o.sessionMs).slice(-Math.max(1, o.sessions));
  for (const s of sessions) {
    const profile = buildProfile(target.candles, s.from, s.to, o)!;
    if (o.showPoc) {
      levelLine(ctx, target, profile.pocPrice, o.pocColor, [], o.showLabels ? `POC ${defaultPriceFormatter(profile.pocPrice)}` : null);
    }
    if (o.showValueArea) {
      levelLine(ctx, target, profile.valueAreaHighPrice, o.valueAreaColor, [4, 4], o.showLabels ? `VAH ${defaultPriceFormatter(profile.valueAreaHighPrice)}` : null);
      levelLine(ctx, target, profile.valueAreaLowPrice, o.valueAreaColor, [4, 4], o.showLabels ? `VAL ${defaultPriceFormatter(profile.valueAreaLowPrice)}` : null);
    }
  }
}

/**
 * A primitive painting session volume profiles (or a TPO market profile)
 * into a pane that shares the main price scale — one column per visible
 * session, or a single composite column with `composite`.
 */
export function createSessionProfilePrimitive(options: SessionProfileOptions = {}): PanePrimitive {
  const resolved = resolveProfileOptions(options);
  return { draw: (ctx, target) => drawSessionProfile(ctx, target, resolved) };
}

/**
 * A main-pane primitive projecting POC (solid) and value-area high/low
 * (dashed) lines of the most recent visible sessions across the plot.
 */
export function createSessionLevelsPrimitive(options: SessionLevelsOptions = {}): PanePrimitive {
  const resolved: ResolvedSessionLevelsOptions = {
    ...resolveProfileOptions(options),
    enabled: true,
    sessions: Math.max(1, Math.floor(options.sessions ?? 1)),
    showLabels: options.showLabels ?? true,
  };
  return { draw: (ctx, target) => drawSessionLevels(ctx, target, resolved) };
}

/**
 * Adds an auto-updating session volume profile / TPO pane docked at
 * `placement` (sharing the main price scale) and, unless `projectLevels` is
 * false, projects POC and value-area high/low lines of the most recent
 * visible sessions onto the main pane. Both redraw on every data, range and
 * scale change.
 */
export function attachSessionProfile(chart: Chart, options: SessionProfileAttachOptions = {}): SessionProfileApi {
  const profile = resolveProfileOptions(options);
  const levels: ResolvedSessionLevelsOptions = {
    ...profile,
    enabled: options.projectLevels ?? true,
    sessions: Math.max(1, Math.floor(options.projectedSessions ?? 1)),
    showLabels: options.showLabels ?? true,
  };
  const pane = chart.addPane({
    id: options.id ?? 'session-profile',
    placement: options.placement ?? 'right',
    width: options.width ?? DEFAULT_SESSION_PROFILE_WIDTH,
    sharePriceScale: true,
  });
  const profileHandle = pane.attachPrimitive({ draw: (ctx, target) => drawSessionProfile(ctx, target, profile) });
  const levelsHandle = chart.attachPrimitive({ draw: (ctx, target) => drawSessionLevels(ctx, target, levels) });
  return {
    pane,
    update(next) {
      Object.assign(profile, resolveProfileOptions({ ...options, ...next }));
      Object.assign(levels, profile, {
        enabled: next.projectLevels ?? options.projectLevels ?? true,
        sessions: Math.max(1, Math.floor(next.projectedSessions ?? options.projectedSessions ?? 1)),
        showLabels: next.showLabels ?? options.showLabels ?? true,
      });
      if (next.width !== undefined) pane.setWidth(next.width);
      profileHandle.requestUpdate();
    },
    remove() {
      levelsHandle.detach();
      profileHandle.detach();
      pane.remove();
    },
  };
}
