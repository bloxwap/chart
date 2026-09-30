/** Fixed, bounded atlas for the footprint's 10px bid×ask labels. */
import type { ChartCanvas, Canvas2DLike } from '../../dom.js';

const GLYPHS = '0123456789.KM×-';
const CELL = 24;

export class GlyphAtlas {
  readonly canvas: ChartCanvas;
  private readonly ctx: Canvas2DLike;
  private widths: number[] = [];
  private ratio = 0;

  private constructor(canvas: ChartCanvas, ctx: Canvas2DLike) {
    this.canvas = canvas;
    this.ctx = ctx;
  }

  static create(canvas: ChartCanvas): GlyphAtlas | null {
    const ctx = canvas.getContext('2d');
    return ctx === null ? null : new GlyphAtlas(canvas, ctx);
  }

  /** Re-rasterizes only when the backing pixel ratio changes. */
  prepare(ratio: number): boolean {
    if (ratio === this.ratio) return false;
    this.ratio = ratio;
    const cell = Math.ceil(CELL * ratio);
    this.canvas.width = cell * GLYPHS.length;
    this.canvas.height = cell;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.font = `${10 * ratio}px sans-serif`;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.textAlign = 'left';
    this.ctx.textBaseline = 'middle';
    this.widths = [];
    for (let i = 0; i < GLYPHS.length; i++) {
      const glyph = GLYPHS[i]!;
      this.widths.push(this.ctx.measureText(glyph).width / ratio);
      this.ctx.fillText(glyph, i * cell + 2 * ratio, cell / 2);
    }
    return true;
  }

  /** Emits centered, middle-aligned glyph quads; unsupported text emits none. */
  draw(text: string, x: number, y: number,
    emit: (x: number, y: number, width: number, height: number, u: number, du: number) => void): boolean {
    const indices = Array.from(text, glyph => GLYPHS.indexOf(glyph));
    if (indices.includes(-1)) return false;
    const cell = this.canvas.height / this.ratio;
    let left = x - indices.reduce((sum, index) => sum + this.widths[index]!, 0) / 2;
    for (const index of indices) {
      emit(left - 2, y - cell / 2, cell, cell, index / GLYPHS.length, 1 / GLYPHS.length);
      left += this.widths[index]!;
    }
    return true;
  }

  dispose(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
