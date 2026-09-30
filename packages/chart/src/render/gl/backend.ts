/**
 * WebGL2 geometry backend. The dense layers (candle bodies/wicks, heatmap
 * cells) are packed into instanced axis-aligned quads — one base quad per
 * instance, corners derived from `gl_VertexID`, so each dense pass is one buffer
 * upload and one instanced draw — then composited into the host canvas with
 * `drawImage`, letting the Canvas2D pass paint text, axes and overlays on top
 * and the footprint glyph atlas paints dense bid×ask labels in GL.
 *
 * The GL canvas is allocated by the caller through the injected DOM (the host
 * canvas's `ownerDocument` or the injected `ChartDocument`) and is never
 * attached to a document; it exists only as a `drawImage` source.
 *
 * @module
 */

import { GlyphAtlas } from './glyph-atlas.js';
import { parseColor } from '../../color.js';
import type { Canvas2DLike, ChartCanvas, WebGL2Like } from '../../dom.js';

/** Render backend identifiers; see `CreateChartOptions.renderer`. */
export type RenderBackend = 'canvas2d' | 'webgl2';

/** Receives axis-aligned quads in pane-local CSS pixels with straight-alpha RGBA channels (0-1). */
export interface GLQuadSink {
  quad(x: number, y: number, width: number, height: number, r: number, g: number, b: number, a: number): void;
}

/**
 * One frame of GL work on the main pane. Quads accumulate in submission order
 * (heatmap cells below candles); {@link GLFrame.composite} flushes and draws
 * the GL canvas at the 2D context's current transform, so it must be called
 * from the pane-translated, pane-clipped series layer exactly once per frame.
 */
export interface GLFrame extends GLQuadSink {
  /** Flushes pending quads and composites the GL canvas; a no-op when no quads were submitted. */
  composite(ctx: Canvas2DLike): void;
  /** Centered 10px footprint label via the glyph atlas; false keeps the Canvas2D fallback. */
  text?(text: string, x: number, y: number, color: string, alpha: number): boolean;
}

const FLOATS_PER_QUAD = 12;
const QUAD_STRIDE_BYTES = FLOATS_PER_QUAD * 4;

const VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec4 aRect;
layout(location = 1) in vec4 aColor;
layout(location = 2) in vec4 aUv;
uniform vec2 uResolution;
out vec4 vColor;
out vec2 vUv;
void main() {
  vec2 corner = vec2(
    float(gl_VertexID == 1 || gl_VertexID == 4 || gl_VertexID == 5),
    float(gl_VertexID == 2 || gl_VertexID == 3 || gl_VertexID == 5));
  vec2 position = aRect.xy + corner * aRect.zw;
  vec2 clip = position / uResolution * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
  vColor = aColor;
  vUv = aUv.xy + corner * aUv.zw;
}`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision mediump float;
in vec4 vColor;
in vec2 vUv;
uniform sampler2D uAtlas;
out vec4 fragColor;
void main() {
  fragColor = vec4(vColor.rgb, vColor.a * (vUv.x < 0.0 ? 1.0 : texture(uAtlas, vUv).a));
}`;

function compileShader(gl: WebGL2Like, type: number, source: string): unknown {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function linkProgram(gl: WebGL2Like): unknown {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
  if (vertex === null || fragment === null) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * Owns the offscreen GL canvas, the quad program and the instance buffer.
 * Create through {@link GLBackend.create}; any failure (no WebGL2 context,
 * shader compile or link error) yields `null` so the caller falls back to
 * Canvas2D.
 */
export class GLBackend implements GLQuadSink {
  /** The offscreen canvas; sized to the host canvas's backing store. */
  readonly canvas: ChartCanvas;

  private readonly gl: WebGL2Like;
  private readonly program: unknown;
  private readonly buffer: unknown;
  private readonly vao: unknown;
  private readonly resolution: unknown;
  private staging = new Float32Array(FLOATS_PER_QUAD * 1024);
  private count = 0;
  private pixelRatio = 1;
  private atlas: GlyphAtlas | null = null;
  private texture: unknown = null;
  private atlasAttempted = false;
  private makeAtlasCanvas: (() => ChartCanvas | undefined) | undefined;

  private constructor(canvas: ChartCanvas, gl: WebGL2Like, program: unknown, buffer: unknown, vao: unknown, resolution: unknown) {
    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this.buffer = buffer;
    this.vao = vao;
    this.resolution = resolution;
  }

  /** Acquires a WebGL2 context on `canvas` and builds the quad pipeline; `null` on any failure. */
  static create(canvas: ChartCanvas, makeAtlasCanvas?: () => ChartCanvas | undefined): GLBackend | null {
    const gl = canvas.getContext('webgl2', { alpha: true, antialias: false, preserveDrawingBuffer: false }) as WebGL2Like | null;
    if (gl === null || gl === undefined || typeof gl.createShader !== 'function') return null;
    try {
      const program = linkProgram(gl);
      if (program === null) return null;
      const vao = gl.createVertexArray();
      const buffer = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.FLOAT, false, QUAD_STRIDE_BYTES, 0);
      gl.vertexAttribDivisor(0, 1);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, QUAD_STRIDE_BYTES, 16);
      gl.vertexAttribDivisor(1, 1);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, QUAD_STRIDE_BYTES, 32);
      gl.vertexAttribDivisor(2, 1);
      gl.enable(gl.BLEND);
      // Keep alpha linear when the premultiplied drawing buffer is composited into 2D.
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(program);
      const backend = new GLBackend(canvas, gl, program, buffer, vao, gl.getUniformLocation(program, 'uResolution'));
      backend.makeAtlasCanvas = makeAtlasCanvas;
      return backend;
    } catch {
      return null;
    }
  }

  /** Tracks the host canvas's backing store; resizing clears the drawing buffer. */
  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  /**
   * Starts a frame: clears to transparent and scissors to the main pane's
   * plot rect (`width` × `height` CSS pixels from the canvas's top-left,
   * before the 2D pass's plot/pane translations).
   */
  beginFrame(pixelRatio: number, width: number, height: number): GLFrame {
    this.pixelRatio = pixelRatio;
    this.count = 0;
    const gl = this.gl;
    const backingWidth = this.canvas.width;
    const backingHeight = this.canvas.height;
    gl.viewport(0, 0, backingWidth, backingHeight);
    gl.uniform2f(this.resolution, backingWidth, backingHeight);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(
      0,
      Math.max(0, backingHeight - Math.round(height * pixelRatio)),
      Math.round(width * pixelRatio),
      Math.round(height * pixelRatio),
    );
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return {
      quad: (x, y, w, h, r, g, b, a) => this.quad(x, y, w, h, r, g, b, a),
      composite: (ctx) => this.composite(ctx),
      text: (text, x, y, color, alpha) => this.text(text, x, y, color, alpha),
    };
  }

  /** Appends one quad (pane-local CSS pixels, straight-alpha RGBA) to the instance staging buffer. */
  quad(x: number, y: number, width: number, height: number, r: number, g: number, b: number, a: number): void {
    if ((this.count + 1) * FLOATS_PER_QUAD > this.staging.length) {
      const next = new Float32Array(this.staging.length * 2);
      next.set(this.staging);
      this.staging = next;
    }
    const ratio = this.pixelRatio;
    const o = this.count * FLOATS_PER_QUAD;
    this.staging[o] = x * ratio;
    this.staging[o + 1] = y * ratio;
    this.staging[o + 2] = width * ratio;
    this.staging[o + 3] = height * ratio;
    this.staging[o + 4] = r;
    this.staging[o + 5] = g;
    this.staging[o + 6] = b;
    this.staging[o + 7] = a;
    this.staging[o + 8] = -1;
    this.staging[o + 9] = -1;
    this.staging[o + 10] = 0;
    this.staging[o + 11] = 0;
    this.count++;
  }

  private text(text: string, x: number, y: number, color: string, alpha: number): boolean {
    const parsed = parseColor(color);
    if (parsed === null) return false;
    if (!this.atlasAttempted) {
      this.atlasAttempted = true;
      const canvas = this.makeAtlasCanvas?.();
      this.atlas = canvas === undefined ? null : GlyphAtlas.create(canvas);
      if (this.atlas !== null) {
        const gl = this.gl;
        this.texture = gl.createTexture();
        if (this.texture === null) {
          this.atlas.dispose();
          this.atlas = null;
          return false;
        }
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
    }
    if (this.atlas === null) return false;
    if (this.atlas.prepare(this.pixelRatio)) {
      const gl = this.gl;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.canvas);
    }
    const d = parsed.space === 'srgb' ? 255 : 1;
    return this.atlas.draw(text, x, y, (left, top, width, height, u, du) => {
      this.quad(left, top, width, height, parsed.r / d, parsed.g / d, parsed.b / d, parsed.a * alpha);
      const offset = (this.count - 1) * FLOATS_PER_QUAD;
      this.staging[offset + 8] = u;
      this.staging[offset + 9] = 0;
      this.staging[offset + 10] = du;
      this.staging[offset + 11] = 1;
    });
  }

  /** Uploads and draws the staged quads; returns whether anything was drawn. */
  private flush(): boolean {
    if (this.count === 0) return false;
    const gl = this.gl;
    gl.bufferData(gl.ARRAY_BUFFER, this.staging.subarray(0, this.count * FLOATS_PER_QUAD), gl.DYNAMIC_DRAW);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.count);
    this.count = 0;
    return true;
  }

  private composite(ctx: Canvas2DLike): void {
    if (!this.flush()) return;
    ctx.drawImage(this.canvas, 0, 0, this.canvas.width / this.pixelRatio, this.canvas.height / this.pixelRatio);
    // Self-clear so a re-render of the same frame (the crosshair cache paints
    // the view again on a later task) never stacks quads onto a stale image.
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
  }

  /** Releases GL resources and drops the canvas bitmap. */
  dispose(): void {
    const gl = this.gl;
    if (this.texture !== null) gl.deleteTexture(this.texture);
    this.atlas?.dispose();
    gl.deleteBuffer(this.buffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
