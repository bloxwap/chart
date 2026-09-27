/**
 * Injected-DOM abstraction ("ABI document injection").
 *
 * The library never touches the global `document` or `window`. The host injects
 * a {@link ChartDocument} (or an existing {@link ChartCanvas}) so the same code
 * runs in browsers, workers, SSR, and tests. A real `HTMLCanvasElement`
 * satisfies {@link ChartCanvas} structurally.
 *
 * @module
 */

/** Minimal text metrics required by axis layout. */
export interface TextMetricsLike {
  readonly width: number;
}

/** Anything drawable by `drawImage` (kept structural; mocks use plain objects). */
export interface CanvasImageSourceLike {
  readonly width: number;
  readonly height: number;
}

/**
 * Minimal subset of `CanvasRenderingContext2D` used by the renderer.
 * A real `CanvasRenderingContext2D` is structurally assignable to this type.
 */
export interface Canvas2DLike {
  isContextLost?(): boolean;
  getContextAttributes?(): { colorSpace?: 'srgb' | 'display-p3' };
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  font: string;
  textAlign: 'left' | 'right' | 'center' | 'start' | 'end';
  textBaseline: 'top' | 'hanging' | 'middle' | 'alphabetic' | 'ideographic' | 'bottom';
  globalAlpha: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'bevel' | 'round' | 'miter';
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void;
  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
  ): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  clip(): void;
  stroke(): void;
  fill(): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): TextMetricsLike;
  drawImage(image: unknown, dx: number, dy: number, dw: number, dh: number): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
}

/**
 * A canvas the renderer can draw into. `HTMLCanvasElement` satisfies this
 * interface because its `getContext('2d')` returns a superset of
 * {@link Canvas2DLike}.
 */
export interface ChartCanvas {
  width: number;
  height: number;
  getContext(contextId: '2d', options?: { colorSpace?: 'srgb' | 'display-p3' }): Canvas2DLike | null;
  addEventListener?(type: 'contextrestored', listener: () => void): void;
  removeEventListener?(type: 'contextrestored', listener: () => void): void;
  /** Optional browser document used to lazily allocate the crosshair's raster cache. */
  readonly ownerDocument?: { createElement?(tag: 'canvas'): ChartCanvas; readonly defaultView?: unknown } | null;
  /** Encodes the bitmap (e.g. a `Blob`); the callback receives `null` when encoding fails. Used by snapshots. */
  toBlob?(callback: (blob: unknown) => void, type?: string, quality?: number): void;
  /** Encodes the bitmap as a data URL. Used by snapshots. */
  toDataURL?(type?: string, quality?: number): string;
}

/** A `ResizeObserver` as the canvas's own window provides it. */
export interface ResizeObserverLike {
  observe(target: unknown): void;
  disconnect(): void;
}

/** The window members `autoResize` reads, taken from the canvas's `ownerDocument`, never from globals. */
export interface AutoResizeWindow {
  readonly ResizeObserver?: new (callback: () => void) => ResizeObserverLike;
  readonly devicePixelRatio?: number;
  getComputedStyle(element: never): { readonly position: string };
}

/** The canvas parent that `autoResize` fills and observes. */
export interface AutoResizeParent {
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly style: { position: string };
}

/**
 * The extra canvas surface `autoResize` uses. A real `HTMLCanvasElement` attached to the page satisfies
 * it; the core reads it structurally so it still never touches the global `document` or `window`.
 */
export interface AutoResizeCanvas extends ChartCanvas {
  readonly ownerDocument?: { createElement?(tag: 'canvas'): ChartCanvas; readonly defaultView: AutoResizeWindow | null } | null;
  readonly parentElement?: AutoResizeParent | null;
  readonly style?: { position: string; inset: string; width: string; height: string; display: string };
}

/** Factory abstraction over a host `Document`. */
export interface ChartDocument {
  createCanvas(width: number, height: number): ChartCanvas;
}

/** A recorded 2D call: `[methodOrProp, ...args]`. */
export type RecordedCall = readonly [string, ...unknown[]];

/** Records every call and property assignment for assertions in tests/SSR. */
export class MockContext2D implements Canvas2DLike {
  fillStyle = '#000000';
  strokeStyle = '#000000';
  lineWidth = 1;
  textAlign: Canvas2DLike['textAlign'] = 'start';
  textBaseline: Canvas2DLike['textBaseline'] = 'alphabetic';
  globalAlpha = 1;
  lineCap: Canvas2DLike['lineCap'] = 'butt';
  lineJoin: Canvas2DLike['lineJoin'] = 'miter';

  private currentFont = '10px sans-serif';

  /** Font assignments are recorded as `['set:font', value]` calls. */
  get font(): string {
    return this.currentFont;
  }
  set font(value: string) {
    this.currentFont = value;
    this.record('set:font', [value]);
  }

  /** Every method call in order. */
  readonly calls: RecordedCall[] = [];

  private record(name: string, args: unknown[]): void {
    this.calls.push([name, ...args]);
  }

  /** Counts how many times a method was called. */
  countCalls(name: string): number {
    return this.calls.filter((c) => c[0] === name).length;
  }

  /** Returns all calls to one method. */
  callsNamed(name: string): RecordedCall[] {
    return this.calls.filter((c) => c[0] === name);
  }

  save(): void {
    this.record('save', []);
  }
  restore(): void {
    this.record('restore', []);
  }
  clearRect(x: number, y: number, w: number, h: number): void {
    this.record('clearRect', [x, y, w, h]);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    this.record('fillRect', [x, y, w, h]);
  }
  beginPath(): void {
    this.record('beginPath', []);
  }
  closePath(): void {
    this.record('closePath', []);
  }
  moveTo(x: number, y: number): void {
    this.record('moveTo', [x, y]);
  }
  lineTo(x: number, y: number): void {
    this.record('lineTo', [x, y]);
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.record('rect', [x, y, w, h]);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    this.record('arcTo', [x1, y1, x2, y2, radius]);
  }
  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number): void {
    this.record('ellipse', [x, y, rx, ry, rotation, start, end]);
  }
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void {
    this.record('bezierCurveTo', [cp1x, cp1y, cp2x, cp2y, x, y]);
  }
  clip(): void {
    this.record('clip', []);
  }
  stroke(): void {
    this.record('stroke', []);
  }
  fill(): void {
    this.record('fill', []);
  }
  setLineDash(segments: number[]): void {
    this.record('setLineDash', [segments]);
  }
  fillText(text: string, x: number, y: number): void {
    this.record('fillText', [text, x, y]);
  }
  measureText(text: string): TextMetricsLike {
    this.record('measureText', [text]);
    return { width: text.length * 6 };
  }
  drawImage(image: CanvasImageSourceLike, dx: number, dy: number, dw: number, dh: number): void {
    this.record('drawImage', [image, dx, dy, dw, dh]);
  }
  translate(x: number, y: number): void {
    this.record('translate', [x, y]);
  }
  rotate(angle: number): void {
    this.record('rotate', [angle]);
  }
  scale(x: number, y: number): void {
    this.record('scale', [x, y]);
  }
}

/** The deterministic stand-in for a `Blob` that {@link MockCanvas.toBlob} produces. */
export interface MockBlob {
  /** Uncompressed RGBA byte count of the encoded bitmap. */
  readonly size: number;
  readonly type: string;
}

/** A {@link ChartCanvas} whose 2D context records all calls. */
export class MockCanvas implements ChartCanvas {
  width: number;
  height: number;
  readonly context = new MockContext2D();

  constructor(width = 0, height = 0) {
    this.width = width;
    this.height = height;
  }

  getContext(contextId: '2d'): Canvas2DLike | null {
    return contextId === '2d' ? this.context : null;
  }

  /** Synchronously yields a {@link MockBlob}, or `null` for an empty bitmap like browsers do. */
  toBlob(callback: (blob: MockBlob | null) => void, type = 'image/png'): void {
    callback(this.width > 0 && this.height > 0 ? { size: this.width * this.height * 4, type } : null);
  }

  /** `data:<type>;mock,<width>x<height>`, or `data:,` for an empty bitmap like browsers do. */
  toDataURL(type = 'image/png'): string {
    return this.width > 0 && this.height > 0 ? `data:${type};mock,${this.width}x${this.height}` : 'data:,';
  }
}

/** A {@link ChartDocument} that creates {@link MockCanvas} instances. */
export class MockDocument implements ChartDocument {
  /** All canvases created through this document. */
  readonly created: MockCanvas[] = [];

  createCanvas(width: number, height: number): ChartCanvas {
    const canvas = new MockCanvas(width, height);
    this.created.push(canvas);
    return canvas;
  }
}
