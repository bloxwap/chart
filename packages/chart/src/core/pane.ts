/**
 * Pane layout: a main price pane plus indicator sub-panes stacked by weight.
 *
 * @module
 */

/** A pane before pixel layout. */
export interface PaneSpec {
  readonly id: string;
  /** `main` is the price pane, `indicator` a study sub-pane, `custom` a host pane from `Chart.addPane`. */
  readonly kind: 'main' | 'indicator' | 'custom';
  readonly weight: number;
}

/** A pane with its pixel rectangle (x is always 0; width is the plot width). */
export interface PaneLayout extends PaneSpec {
  readonly y: number;
  readonly height: number;
}

/** Default relative height of the main pane. */
export const MAIN_PANE_WEIGHT = 3;

/**
 * Distributes `totalHeight` across pane specs proportionally to their weights.
 * The last pane absorbs rounding remainder. Zero/negative weights are treated
 * as 1; empty input yields an empty layout.
 */
export function layoutPanes(specs: readonly PaneSpec[], totalHeight: number): PaneLayout[] {
  if (specs.length === 0 || totalHeight <= 0) return [];
  const weight = (s: PaneSpec): number => (s.weight > 0 ? s.weight : 1);
  const totalWeight = specs.reduce((sum, s) => sum + weight(s), 0);
  const layouts: PaneLayout[] = [];
  let y = 0;
  specs.forEach((spec, i) => {
    const height =
      i === specs.length - 1 ? totalHeight - y : Math.floor((totalHeight * weight(spec)) / totalWeight);
    layouts.push({ ...spec, y, height });
    y += height;
  });
  return layouts;
}
