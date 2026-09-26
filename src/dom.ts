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
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: 'left' | 'right' | 'center' | 'start' | 'end';
  textBaseline: 'top' | 'hanging' | 'middle' | 'alphabetic' | 'ideographic' | 'bottom';
  globalAlpha: number;
  save(): void;
  restore(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  stroke(): void;
  fill(): void;
  setLineDash(segments: number[]): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): TextMetricsLike;
  drawImage(image: CanvasImageSourceLike, dx: number, dy: number, dw: number, dh: number): void;
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
  getContext(contextId: '2d'): Canvas2DLike | null;
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
