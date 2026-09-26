/**
 * Snapshot undo/redo for a chart's drawings. Every mutation the toolbar
 * makes (add, edit, move, restyle, erase, clear) calls {@link checkpoint}
 * first, so one history covers all of them.
 *
 * @module
 */

import type { Chart } from '../core/chart.js';
import type { DrawingConfig } from '../config.js';

/** Maximum number of undo steps kept. */
export const HISTORY_LIMIT = 200;

type Snapshot = DrawingConfig[];

/** Undo/redo stacks of drawing snapshots. */
export class DrawingHistory {
  private readonly undoStack: Snapshot[] = [];
  private readonly redoStack: Snapshot[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly chart: Chart) {}

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

  private snapshot(): Snapshot {
    return this.chart.getConfig().drawings.map((d) => ({ ...d, points: d.points.map((p) => ({ ...p })) }));
  }

  private restore(s: Snapshot): void {
    const selected = this.chart.selectedDrawing;
    this.chart.clearDrawings();
    for (const d of s) this.chart.addDrawing({ ...d, points: d.points.map((p) => ({ ...p })) });
    this.chart.selectDrawing(selected);
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
