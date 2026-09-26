/**
 * DrawingController — the DOM-free interaction model behind the drawing
 * toolbar. It owns tool/cursor state and turns canvas-relative pointer and
 * key input into chart operations: placing points with a live preview,
 * selecting, dragging anchors, moving, erasing, box zoom, panning, magnet
 * snapping, locking, hiding, and undo/redo.
 *
 * The toolbar UI ({@link createDrawingToolbar}) forwards DOM events here and
 * re-renders on `change`. Hosts with their own UI can drive it directly.
 *
 * @module
 */

import type { CrosshairMode, DrawingConfig, DrawingPoint } from '../config.js';
import { DEFAULT_DRAWING_COLOR, type Chart, type DrawingPatch, type MagnetMode } from '../core/chart.js';
import type { CanvasImageSourceLike } from '../dom.js';
import { findTool, TOOL_GROUPS } from '../drawings/catalog.js';
import type { DrawingDef } from '../drawings/types.js';
import { DrawingHistory } from './history.js';

/** Pointer modes: the crosshair styles plus the eraser. */
export type CursorMode = CrosshairMode | 'eraser';

/** Pseudo-tool name for box zoom. */
export const ZOOM_TOOL = 'zoom';

/** Tools placed from the icon picker; their text is the glyph. */
export const GLYPH_TOOLS: readonly string[] = ['emoji', 'sticker', 'icon'];

/** Pixels of pointer travel before a press becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;

/** Minimum box-zoom width in pixels. */
export const MIN_ZOOM_BOX_PX = 6;

/** Events emitted by {@link DrawingController}. */
export interface ControllerEvents {
  /** Any state change; UIs re-sync. */
  change: undefined;
  /** Selection changed (drawing id or null). */
  select: string | null;
  /** A text-bearing drawing wants its text edited. */
  'edit-text': string;
  /** The image tool needs an image before it can be placed. */
  'request-image': undefined;
  /** A short status message (e.g. "Magnet on"). */
  toast: string;
  /** Scroll or zoom changed. */
  viewport: undefined;
}

type Listener<K extends keyof ControllerEvents> = (payload: ControllerEvents[K]) => void;

/** Contextual guidance for the current mode. */
export interface Hint {
  /** Emphasized lead, e.g. the tool name. */
  readonly title: string;
  /** Instructions. */
  readonly detail: string;
  /** True in the idle state (UIs may de-emphasize it). */
  readonly quiet: boolean;
}

/** Current box-zoom selection in canvas pixels. */
export interface ZoomBox {
  readonly x0: number;
  readonly x1: number;
}

type Drag =
  | { kind: 'pan'; lastX: number }
  | { kind: 'handle'; id: string; index: number }
  | { kind: 'move'; id: string; lastX: number; lastY: number; checkpointed: boolean }
  | { kind: 'zoom'; x0: number; x1: number }
  | { kind: 'erase' }
  | { kind: 'freehand' }
  | { kind: 'place'; x0: number; y0: number; moved: boolean };

/** Options for {@link DrawingController}. */
export interface DrawingControllerOptions {
  /** Wire drag-to-pan, wheel zoom and the crosshair (default true). */
  navigation?: boolean;
}

/** Group id containing tool `name`, if any. */
export function groupOf(name: string): string | undefined {
  return TOOL_GROUPS.find((g) => g.sections.some((s) => s.tools.some((t) => t.name === name)))?.id;
}

/** Interaction state machine for drawing tools on one chart. */
export class DrawingController {
  readonly history: DrawingHistory;
  cursor: CursorMode = 'cross';
  /** Armed drawing tool name, {@link ZOOM_TOOL}, or null. */
  tool: string | null = null;
  /** Points placed so far for the armed tool. */
  points: DrawingPoint[] = [];
  magnet: MagnetMode = 'off';
  /** Keep the tool armed after placing a drawing. */
  stay = false;
  /** Lock all drawings against selection, moves and erasing. */
  locked = false;
  drawingsHidden = false;
  indicatorsHidden = false;
  /** Color for new drawings (follows the last color picked). */
  color = DEFAULT_DRAWING_COLOR;
  /** Text for the next drawing (glyph tools). */
  pendingText = '';
  /** Image for the next image drawing. */
  pendingImage: CanvasImageSourceLike | null = null;

  private readonly navigation: boolean;
  private freehand: DrawingPoint[] | null = null;
  private drag: Drag | null = null;
  private readonly lastInGroup = new Map<string, string>();
  private readonly listeners = new Map<keyof ControllerEvents, Set<Listener<never>>>();

  constructor(
    readonly chart: Chart,
    options: DrawingControllerOptions = {},
  ) {
    this.navigation = options.navigation ?? true;
    this.history = new DrawingHistory(chart);
    this.history.onChange(() => this.emit('change', undefined));
    for (const g of TOOL_GROUPS) this.lastInGroup.set(g.id, g.sections[0]!.tools[0]!.name);
  }

  // ------------------------------------------------------------------ events

  /** Subscribes to an event; returns an unsubscribe function. */
  on<K extends keyof ControllerEvents>(event: K, fn: Listener<K>): () => void {
    let set = this.listeners.get(event);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(fn as Listener<never>);
    return () => set.delete(fn as Listener<never>);
  }

  private emit<K extends keyof ControllerEvents>(event: K, payload: ControllerEvents[K]): void {
    for (const fn of this.listeners.get(event) ?? []) (fn as Listener<K>)(payload);
  }

  // ------------------------------------------------------------------ queries

  /** Registry definition of a drawing tool. */
  def(name: string): DrawingDef | undefined {
    return this.chart.drawings.get(name);
  }

  /** Human label of a tool. */
  label(name: string): string {
    if (name === ZOOM_TOOL) return 'Zoom in';
    return findTool(name)?.label ?? name;
  }

  /** Last tool used from a toolbar group (the group button's action). */
  lastTool(groupId: string): string | undefined {
    return this.lastInGroup.get(groupId);
  }

  /** Points collected when placing `def` (Infinity for open-ended tools). */
  static placeCount(def: DrawingDef): number {
    return def.maxPoints ?? def.minPoints;
  }

  /** Current box-zoom selection, if one is being dragged. */
  get zoomBox(): ZoomBox | null {
    return this.drag?.kind === 'zoom' ? { x0: this.drag.x0, x1: this.drag.x1 } : null;
  }

  /** Whether a drag (pan, move, handle) is in progress. */
  get dragging(): boolean {
    return this.drag !== null && ['pan', 'move', 'handle'].includes(this.drag.kind);
  }

  /** Guidance for the current mode. */
  hint(): Hint {
    const esc = ' · Esc cancels';
    if (this.tool === ZOOM_TOOL) return { title: 'Zoom in', detail: `drag across the bars to fit${esc}`, quiet: false };
    if (this.tool !== null) {
      const def = this.def(this.tool)!;
      const total = DrawingController.placeCount(def);
      const title = this.label(this.tool);
      if (def.freehand === true) return { title, detail: `press and drag to draw${esc}`, quiet: false };
      if (!Number.isFinite(total)) {
        return { title, detail: `click to add points (${this.points.length} placed) · double-click or Enter finishes${esc}`, quiet: false };
      }
      const detail = total === 1 ? 'click to place' : `click ${total} points (${this.points.length}/${total})`;
      return { title, detail: `${detail}${esc}`, quiet: false };
    }
    if (this.cursor === 'eraser') return { title: 'Eraser', detail: 'click or drag over drawings to remove them', quiet: false };
    return { title: '', detail: 'Drag to scroll · wheel to zoom · click a drawing to edit it', quiet: true };
  }

  // ------------------------------------------------------------------ modes

  /** Switches the pointer mode (and disarms any tool). */
  setCursor(mode: CursorMode): void {
    this.disarm(false);
    this.cursor = mode;
    this.chart.updateConfig({ crosshair: { mode: mode === 'eraser' ? 'arrow' : mode } });
    if (mode === 'eraser') this.select(null);
    this.emit('change', undefined);
  }

  /**
   * Arms a drawing tool (or {@link ZOOM_TOOL}). Re-arming the armed tool
   * disarms it. `text` presets the drawing text (glyph tools).
   */
  arm(name: string, options: { text?: string } = {}): void {
    if (name !== ZOOM_TOOL && this.def(name) === undefined) throw new Error(`chart-ts: unknown drawing "${name}"`);
    if (name === 'image' && this.pendingImage === null) {
      this.emit('request-image', undefined);
      return;
    }
    if (this.tool === name && options.text === undefined && name !== ZOOM_TOOL) {
      this.disarm();
      return;
    }
    this.pendingText = options.text ?? '';
    this.select(null);
    this.tool = name;
    this.points = [];
    this.freehand = null;
    this.chart.setDraft(null);
    const group = groupOf(name);
    if (group !== undefined) this.lastInGroup.set(group, name);
    this.emit('change', undefined);
  }

  /** Disarms the current tool and clears any preview. */
  disarm(notify = true): void {
    this.tool = null;
    this.points = [];
    this.freehand = null;
    if (this.drag?.kind === 'zoom' || this.drag?.kind === 'place' || this.drag?.kind === 'freehand') this.drag = null;
    this.chart.setDraft(null);
    if (notify) this.emit('change', undefined);
  }

  /** Sets the image the next image drawing will show, then arms the tool. */
  placeImage(image: CanvasImageSourceLike): void {
    this.pendingImage = image;
    this.arm('image');
  }

  setMagnet(mode: MagnetMode): void {
    this.magnet = mode;
    this.emit('toast', mode === 'off' ? 'Magnet off' : `${mode === 'weak' ? 'Weak' : 'Strong'} magnet on`);
    this.emit('change', undefined);
  }

  setStay(stay: boolean): void {
    this.stay = stay;
    this.emit('toast', stay ? 'Stay in drawing mode on' : 'Stay in drawing mode off');
    this.emit('change', undefined);
  }

  setLocked(locked: boolean): void {
    this.locked = locked;
    if (locked) this.select(null);
    this.emit('toast', locked ? 'All drawings locked' : 'Drawings unlocked');
    this.emit('change', undefined);
  }

  /** Hides drawings and/or indicators without deleting them. */
  setHidden(drawings: boolean, indicators: boolean): void {
    this.drawingsHidden = drawings;
    this.indicatorsHidden = indicators;
    for (const ind of this.chart.getConfig().indicators) ind.visible = !indicators;
    this.chart.setDrawingsHidden(drawings);
    if (drawings) this.select(null);
    this.emit('change', undefined);
  }

  /** Removes every drawing (undoable). */
  removeDrawings(): void {
    if (this.chart.getConfig().drawings.length === 0) return;
    this.history.checkpoint();
    this.chart.clearDrawings();
    this.select(null);
    this.emit('toast', 'Drawings removed');
  }

  /** Removes every indicator. */
  removeIndicators(): void {
    for (const ind of [...this.chart.getConfig().indicators]) this.chart.removeIndicator(ind.id);
    this.emit('toast', 'Indicators removed');
    this.emit('change', undefined);
  }

  // ------------------------------------------------------------------ selection & editing

  /** Selects a drawing (or clears the selection). */
  select(id: string | null): void {
    const before = this.chart.selectedDrawing;
    this.chart.selectDrawing(id);
    if (this.chart.selectedDrawing !== before || id === null) this.emit('select', this.chart.selectedDrawing);
  }

  /** Restyles a drawing (undoable); color also becomes the default for new drawings. */
  restyle(id: string, patch: DrawingPatch): void {
    this.history.checkpoint();
    if (patch.color !== undefined) this.color = patch.color;
    this.chart.updateDrawing(id, patch);
    this.emit('select', id);
  }

  /** Replaces a drawing's text (undoable when it changes). */
  setText(id: string, text: string): void {
    const d = this.chart.getDrawing(id);
    if (d === undefined) return;
    if (d.text !== text) {
      this.history.checkpoint();
      this.chart.updateDrawing(id, { text });
    }
    this.select(id);
  }

  /** Duplicates a drawing a little to the right and selects the copy. */
  clone(id: string): string | null {
    const src = this.chart.getDrawing(id);
    if (src === undefined) return null;
    this.history.checkpoint();
    const anchored = this.def(src.name)!.anchored === true;
    const range = this.chart.scale.visibleRange();
    const shift = Math.max(2, Math.round((range.to - range.from) * 0.02));
    const { id: _id, ...rest } = src;
    const copy = this.chart.addDrawing({
      ...rest,
      points: src.points.map((p) => (anchored ? { index: p.index + 0.02, price: p.price + 0.02 } : { ...p, index: p.index + shift })),
    });
    this.select(copy);
    return copy;
  }

  /** Removes the selected drawing (undoable). */
  removeSelected(): boolean {
    const id = this.chart.selectedDrawing;
    if (id === null) return false;
    this.history.checkpoint();
    this.chart.removeDrawing(id);
    this.select(null);
    return true;
  }

  undo(): void {
    this.history.undo();
    this.emit('select', this.chart.selectedDrawing);
  }

  redo(): void {
    this.history.redo();
    this.emit('select', this.chart.selectedDrawing);
  }

  // ------------------------------------------------------------------ pointer input (canvas CSS px)

  /** Pointer → drawing point: anchored tools use screen fractions; others snap to bars (and OHLC with the magnet). */
  pointAt(x: number, y: number, name: string): DrawingPoint {
    const def = this.def(name);
    if (def?.anchored === true) return this.chart.pointFromPixel(x, y, name);
    const p = this.chart.snapPoint(x, y, this.magnet);
    return def?.freehand === true ? p : { index: Math.round(p.index), price: p.price };
  }

  private updateDraft(x: number, y: number): void {
    if (this.tool === null || this.tool === ZOOM_TOOL) return;
    const pts = this.freehand ?? [...this.points, this.pointAt(x, y, this.tool)];
    this.chart.setDraft({ name: this.tool, points: pts, color: this.color, text: this.pendingText });
  }

  /** Whether the drawing under `(x, y)` may be edited. */
  private editableAt(x: number, y: number): string | null {
    if (this.locked) return null;
    return this.chart.drawingAt(x, y);
  }

  pointerDown(x: number, y: number): void {
    if (this.tool === ZOOM_TOOL) {
      this.drag = { kind: 'zoom', x0: x, x1: x };
      return;
    }
    if (this.tool !== null) {
      if (this.def(this.tool)!.freehand === true) {
        this.freehand = [this.pointAt(x, y, this.tool)];
        this.drag = { kind: 'freehand' };
        this.updateDraft(x, y);
        return;
      }
      this.drag = { kind: 'place', x0: x, y0: y, moved: false };
      return;
    }
    if (this.cursor === 'eraser') {
      this.drag = { kind: 'erase' };
      this.eraseAt(x, y);
      return;
    }
    const selected = this.chart.selectedDrawing;
    if (selected !== null && !this.locked && !this.chart.getDrawing(selected)!.locked) {
      const h = this.chart.handleAt(x, y);
      if (h >= 0) {
        this.history.checkpoint();
        this.drag = { kind: 'handle', id: selected, index: h };
        this.emit('change', undefined);
        return;
      }
    }
    const hit = this.editableAt(x, y);
    if (hit !== null) {
      this.select(hit);
      this.drag = this.chart.getDrawing(hit)!.locked ? null : { kind: 'move', id: hit, lastX: x, lastY: y, checkpointed: false };
      return;
    }
    this.select(null);
    this.drag = this.navigation ? { kind: 'pan', lastX: x } : null;
  }

  pointerMove(x: number, y: number): void {
    if (this.navigation) this.chart.setCrosshair(x, y);
    const d = this.drag;
    if (d === null) {
      this.updateDraft(x, y);
      return;
    }
    switch (d.kind) {
      case 'pan': {
        const spacing = Math.max(0.5, this.chart.scale.indexToX(1) - this.chart.scale.indexToX(0));
        this.chart.scale.scrollBy((x - d.lastX) / spacing);
        d.lastX = x;
        this.emit('viewport', undefined);
        break;
      }
      case 'handle':
        this.chart.moveDrawingPoint(d.id, d.index, this.pointAt(x, y, this.chart.getDrawing(d.id)!.name));
        break;
      case 'move':
        if (!d.checkpointed) {
          this.history.checkpoint();
          d.checkpointed = true;
        }
        this.chart.translateDrawing(d.id, x - d.lastX, y - d.lastY);
        d.lastX = x;
        d.lastY = y;
        break;
      case 'zoom':
        d.x1 = x;
        this.emit('change', undefined);
        break;
      case 'erase':
        this.eraseAt(x, y);
        break;
      case 'freehand':
        this.freehand!.push(this.pointAt(x, y, this.tool!));
        this.updateDraft(x, y);
        break;
      default:
        if (Math.hypot(x - d.x0, y - d.y0) > DRAG_THRESHOLD_PX) d.moved = true;
        this.updateDraft(x, y);
    }
  }

  pointerUp(x: number, y: number): void {
    const d = this.drag;
    this.drag = null;
    if (d === null) return;
    switch (d.kind) {
      case 'zoom':
        if (Math.abs(d.x1 - d.x0) > MIN_ZOOM_BOX_PX) {
          this.chart.scale.zoomToRange(this.chart.scale.xToIndex(d.x0), this.chart.scale.xToIndex(d.x1));
          this.emit('viewport', undefined);
        }
        if (!this.stay) this.disarm();
        else this.emit('change', undefined);
        return;
      case 'freehand':
        this.finish(this.freehand!);
        return;
      case 'place': {
        const total = DrawingController.placeCount(this.def(this.tool!)!);
        // A press-drag-release places both ends of a multi-point tool.
        if (d.moved && this.points.length === 0 && total >= 2) this.points.push(this.pointAt(d.x0, d.y0, this.tool!));
        this.points.push(this.pointAt(x, y, this.tool!));
        if (this.points.length >= total) this.finish(this.points);
        else {
          this.updateDraft(x, y);
          this.emit('change', undefined);
        }
        return;
      }
      case 'move':
      case 'handle':
        this.emit('select', d.id);
        this.emit('change', undefined);
        return;
      default:
        this.emit('change', undefined);
    }
  }

  /** Double-click: finishes open-ended tools, or edits a text drawing. */
  doubleClick(x: number, y: number): void {
    if (this.tool !== null && this.tool !== ZOOM_TOOL && !Number.isFinite(DrawingController.placeCount(this.def(this.tool)!))) {
      // Both clicks of the double-click added a point; drop the duplicate.
      this.finish(this.points.slice(0, -1));
      return;
    }
    const hit = this.editableAt(x, y);
    if (hit !== null && this.def(this.chart.getDrawing(hit)!.name)!.wantsText === true) this.emit('edit-text', hit);
  }

  pointerLeave(): void {
    if (this.drag === null && this.navigation) this.chart.clearCrosshair();
  }

  /** Right-click: cancels an armed tool. Returns whether it was consumed. */
  contextMenu(): boolean {
    if (this.tool === null) return false;
    this.disarm();
    return true;
  }

  /** Wheel zoom around `x`. */
  wheel(deltaY: number, x: number): void {
    if (!this.navigation) return;
    this.chart.scale.zoom(deltaY < 0 ? 1.1 : 0.9, x);
    this.emit('viewport', undefined);
  }

  /**
   * Keyboard: Esc cancels/deselects, Enter finishes open-ended tools,
   * Delete/Backspace removes the selection, ⌘/Ctrl+Z undoes, +Shift redoes.
   * Returns whether the key was handled.
   */
  keyDown(key: string, mods: { meta?: boolean; shift?: boolean } = {}): boolean {
    if (mods.meta === true && key.toLowerCase() === 'z') {
      if (mods.shift === true) this.redo();
      else this.undo();
      return true;
    }
    if (key === 'Escape') {
      if (this.tool !== null) this.disarm();
      else this.select(null);
      return true;
    }
    if (key === 'Enter' && this.tool !== null && this.tool !== ZOOM_TOOL && !Number.isFinite(DrawingController.placeCount(this.def(this.tool)!))) {
      this.finish(this.points);
      return true;
    }
    if ((key === 'Delete' || key === 'Backspace') && this.chart.selectedDrawing !== null) return this.removeSelected();
    return false;
  }

  // ------------------------------------------------------------------ internals

  private eraseAt(x: number, y: number): void {
    const hit = this.editableAt(x, y);
    if (hit === null || this.chart.getDrawing(hit)!.locked) return;
    this.history.checkpoint();
    this.chart.removeDrawing(hit);
  }

  private finish(points: DrawingPoint[]): void {
    const name = this.tool!;
    const def = this.def(name)!;
    this.chart.setDraft(null);
    this.points = [];
    this.freehand = null;
    if (points.length < def.minPoints) {
      this.emit('change', undefined);
      return;
    }
    this.history.checkpoint();
    const input: Omit<DrawingConfig, 'id' | 'name' | 'lineWidth' | 'lineStyle' | 'locked' | 'visible'> = {
      points,
      color: name === 'highlighter' ? '#f7b500' : this.color,
      text: this.pendingText,
      image: name === 'image' ? this.pendingImage : null,
    };
    const id = this.chart.addDrawing({ name, ...input });
    if (name === 'image') this.pendingImage = null;
    if (!this.stay) this.disarm(false);
    this.emit('change', undefined);
    if (def.wantsText === true && this.pendingText === '' && !GLYPH_TOOLS.includes(name)) this.emit('edit-text', id);
    else if (!this.stay) this.select(id);
  }
}
