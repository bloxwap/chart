/**
 * Indicator hit-testing against the last rendered frame: which indicator
 * plot (line, step, dots or histogram bars) lies under a pointer. Only the
 * few bars around the pointer are sampled, so a query is cheap and
 * rendering pays nothing for it.
 *
 * @module
 */

import type { IndicatorConfig } from '../config.js';
import type { IndicatorBars, IndicatorLine, IndicatorOutput } from '../indicators/types.js';
import { distToSegment } from '../drawings/hit.js';
import { lineColorAt, lineValueAt } from '../render/indicator-draw.js';
import type { RenderView } from '../render/renderer.js';
import { MIN_BAR_SPACING, type PriceScale, type TimeScale } from './scale.js';

/** An indicator plot under the pointer (see `Chart.indicatorAt`). */
export interface IndicatorHit {
  /** Indicator instance id. */
  readonly id: string;
  /** Output key of the plot: a line key, or the histogram's key (`'bars'` when it has none). */
  readonly key: string;
}

/** One indicator as last rendered: its config and styled output (hidden plots already dropped). */
export interface RenderedIndicator {
  readonly cfg: IndicatorConfig;
  readonly output: IndicatorOutput;
}

/** Pointer and pane geometry shared by the per-plot distance functions. */
interface Probe {
  /** Pointer in pane coordinates. */
  readonly px: number;
  readonly py: number;
  /** Bar indices to sample, inclusive. */
  readonly from: number;
  readonly to: number;
  readonly length: number;
  readonly timeScale: TimeScale;
  readonly priceScale: PriceScale;
}

const isValue = (v: number | null | undefined): v is number => v != null && !Number.isNaN(v);

/** Distance from the pointer to a line's stroke edge (Infinity when nothing is drawn nearby). */
function lineDistance(line: IndicatorLine, q: Probe): number {
  const width = line.lineWidth ?? 1;
  let best = Infinity;
  let pen = false;
  let prevX = 0, prevY = 0, prevColor = '';
  for (let p = q.from; p <= q.to; p++) {
    const v = lineValueAt(line, p);
    if (!isValue(v)) {
      pen = false;
      continue;
    }
    const x = q.timeScale.indexToX(p, q.length);
    const y = q.priceScale.priceToY(v);
    const color = lineColorAt(line, p);
    let d = Infinity;
    if (line.style === 'dots') d = Math.hypot(q.px - x, q.py - y) - (width + 1);
    // The painter breaks the path wherever the per-bar color changes.
    else if (pen && color === prevColor) {
      d = (line.style === 'step'
        ? Math.min(distToSegment(q.px, q.py, prevX, prevY, x, prevY), distToSegment(q.px, q.py, x, prevY, x, y))
        : distToSegment(q.px, q.py, prevX, prevY, x, y)) - width / 2;
    }
    if (d < best) best = d;
    pen = true;
    prevX = x;
    prevY = y;
    prevColor = color;
  }
  return best;
}

/** Distance from the pointer to the nearest histogram bar rectangle. */
function barsDistance(bars: IndicatorBars, q: Probe): number {
  const half = Math.max(1, Math.floor(q.timeScale.barSpacing * 0.6)) / 2;
  const scale = q.priceScale;
  const zeroY = scale.priceToY(Math.max(scale.minPrice, Math.min(scale.maxPrice, 0)));
  let best = Infinity;
  for (let i = q.from; i <= q.to; i++) {
    const v = bars.values[i];
    if (!isValue(v)) continue;
    const x = q.timeScale.indexToX(i, bars.values.length);
    const y = scale.priceToY(v);
    const top = Math.min(y, zeroY);
    const bottom = top + Math.max(1, Math.abs(zeroY - y));
    best = Math.min(best, Math.hypot(Math.max(0, Math.abs(q.px - x) - half), Math.max(0, top - q.py, q.py - bottom)));
  }
  return best;
}

/**
 * The indicator plot nearest to canvas point `(x, y)` (CSS px) within
 * `tolerance` pixels of its stroke or bar, or `null`. Considers plots of
 * `rendered` indicators still in `current` and visible, in the pane each was
 * drawn in; points left of `plotLeft` or right of the plot (the price axis)
 * never hit. Ties go to the later (topmost) plot.
 */
export function hitIndicators(
  view: Pick<RenderView, 'panes' | 'timeScale' | 'candles' | 'plotWidth'>,
  plotLeft: number,
  rendered: readonly RenderedIndicator[],
  current: readonly IndicatorConfig[],
  x: number,
  y: number,
  tolerance: number,
): IndicatorHit | null {
  const px = x - plotLeft;
  if (!(px >= 0 && px <= view.plotWidth)) return null;
  const { timeScale } = view;
  const length = view.candles.length;
  const center = timeScale.xToFloatIndex(px, length);
  const reach = Math.ceil(Math.max(0, tolerance) / Math.max(MIN_BAR_SPACING, timeScale.barSpacing)) + 1;
  const best: { hit: IndicatorHit | null; distance: number } = { hit: null, distance: tolerance };
  const consider = (id: string, key: string, distance: number): void => {
    if (distance <= best.distance) {
      best.distance = distance;
      best.hit = { id, key };
    }
  };
  for (const { cfg, output } of rendered) {
    // Indicators fading out after removal or hiding are no longer targets.
    if (!cfg.visible || !current.includes(cfg)) continue;
    const pane = cfg.pane === 'main' ? view.panes[0] : view.panes.find((p) => p.layout.id === cfg.id);
    if (pane === undefined || y < pane.layout.y || y > pane.layout.y + pane.layout.height) continue;
    const probe: Probe = {
      px, py: y - pane.layout.y, from: Math.floor(center) - reach, to: Math.ceil(center) + reach,
      length, timeScale, priceScale: pane.priceScale,
    };
    if (output.bars !== undefined) consider(cfg.id, output.bars.key ?? 'bars', barsDistance(output.bars, probe));
    for (const line of output.lines) consider(cfg.id, line.key, lineDistance(line, probe));
  }
  return best.hit;
}
