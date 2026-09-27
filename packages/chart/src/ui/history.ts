/**
 * Snapshot undo/redo for a chart's drawings. Every mutation the toolbar
 * makes (add, edit, move, restyle, erase, clear) calls {@link checkpoint}
 * first, so one history covers all of them.
 *
 * @module
 */

import type { Chart } from '../core/chart.js';
import type { DrawingConfig } from '../config.js';
import { shiftPoints } from '../core/prepend.js';

/** Maximum number of undo steps kept. */
export const HISTORY_LIMIT = 200;

type Snapshot = DrawingConfig[];

/**
 * @internal Calls `shift(target, added)` after each prepend on `chart` while
 * `target` is alive, and returns the unsubscribe. The chart's listener holds
 * `target` weakly, so an instance discarded without `dispose()` (as hosts
 * written before it existed do) can still be collected; its listener then
 * drops itself at the chart's next data load. `shift` must not capture
 * `target`: pass a static method, not a closure made in its constructor.
 */
export function followPrepends<T extends object>(
  chart: Pick<Chart, 'subscribeDataLoad'>,
  target: T,
  shift: (target: T, added: number) => void,
): () => void {
  const ref = new WeakRef(target);
  const off = chart.subscribeDataLoad((e) => {
    const live = ref.deref();
    if (live === undefined) off();
    else if (e.reason === 'prepend') shift(live, e.added);
  });
  return off;
}

/** Undo/redo stacks of drawing snapshots. */
export class DrawingHistory {
  private readonly undoStack: Snapshot[] = [];
  private readonly redoStack: Snapshot[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly offDataLoad: () => void;

  constructor(private readonly chart: Chart) {
    this.offDataLoad = followPrepends(chart, this, DrawingHistory.followPrepend);
  }

  /** Prepended history moves every bar right: snapshots must follow, as the live drawings did. */
  private static followPrepend(history: DrawingHistory, added: number): void {
    for (const s of [...history.undoStack, ...history.redoStack]) {
      for (const d of s) if (history.chart.drawings.get(d.name)?.anchored !== true) d.points = shiftPoints(d.points, added);
    }
  }

  /**
   * Stops following the chart's data; call when the history is discarded
   * while the chart lives on. A history dropped without it is only held
   * weakly by the chart, and stops following once collected.
   */
  dispose(): void {
    this.offDataLoad();
  }

  /** Whether {@link undo} would do anything. */
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** Whether {@link redo} would do anything. */
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Subscribes to stack changes; returns an unsubscribe function. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Records the current drawings; call before mutating them. Clears redo. */
  checkpoint(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack.length = 0;
    this.emit();
  }

  /** Restores the previous snapshot. Returns whether anything changed. */
  undo(): boolean {
    const s = this.undoStack.pop();
    if (s === undefined) return false;
    this.redoStack.push(this.snapshot());
    this.restore(s);
    return true;
  }

  /** Re-applies the last undone snapshot. Returns whether anything changed. */
  redo(): boolean {
    const s = this.redoStack.pop();
    if (s === undefined) return false;
    this.undoStack.push(this.snapshot());
    this.restore(s);
    return true;
  }

  /** Reverts the last `count` checkpoints and forgets them (an aborted edit); nothing is kept for redo. */
  rollback(count: number): void {
    const [s] = this.undoStack.splice(Math.max(0, this.undoStack.length - count));
    if (s !== undefined) this.restore(s);
  }

  private snapshot(): Snapshot {
    return this.chart.getConfig().drawings.map((d) => ({ ...d, points: d.points.map((p) => ({ ...p })) }));
  }

  /**
   * Puts `s` back in one render, so config listeners hear one `'drawings'`
   * change with the restored set, never the empty or partial ones between
   * (an undo, or a touch tap that rolls back its nudge).
   */
  private restore(s: Snapshot): void {
    const selected = this.chart.selectedDrawing;
    this.chart.batch(() => {
      this.chart.clearDrawings();
      for (const d of s) this.chart.addDrawing({ ...d, points: d.points.map((p) => ({ ...p })) });
      this.chart.selectDrawing(selected);
    });
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
