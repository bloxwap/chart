/**
 * Drawing layer: paints resolved drawing primitives (lines, rects, paths,
 * ellipses, béziers, text boxes, images) plus selection handles.
 *
 * Axis-aligned strokes are snapped to the device-pixel grid so 1px lines
 * render as a single crisp row of pixels at any `pixelRatio`.
 *
 * @module
 */

import type { Canvas2DLike } from '../dom.js';
import { contrastingTextColor } from '../color.js';
import type { DrawPrimitive, PrimitiveStyle, TextStyle } from '../drawings/types.js';

/** A resolved drawing with its pixel-space primitives. */
export interface ResolvedDrawing {
  readonly color: string;
  readonly lineWidth: number;
  readonly primitives: readonly DrawPrimitive[];
  /** Base dash pattern for every stroke of this drawing. */
  readonly dash?: readonly number[];
  /** Anchor handles to paint (selected or in-progress drawings). */
  readonly handles?: readonly { readonly x: number; readonly y: number }[];
}

/** Fonts and colors the drawing layer needs from the theme. */
export interface DrawingPaint {
  readonly sansFamily: string;
  readonly monoFamily: string;
  readonly fontSize: number;
  /** Chart background; fills selection handles and backs translucent labels. */
  readonly background: string;
  readonly pixelRatio: number;
}

/**
 * Snaps a coordinate so a stroke of `width` CSS px lands on whole device
 * pixels: odd device widths center on pixel middles, even ones on edges.
 */
export function crisp(v: number, width: number, pixelRatio: number): number {
  const device = Math.max(1, Math.round(width * pixelRatio));
  const scaled = v * pixelRatio;
  const snapped = device % 2 === 1 ? Math.floor(scaled) + 0.5 : Math.round(scaled);
  return snapped / pixelRatio;
}

function applyStroke(ctx: Canvas2DLike, d: ResolvedDrawing, s: PrimitiveStyle): void {
  ctx.strokeStyle = s.color ?? d.color;
  ctx.lineWidth = s.width ?? d.lineWidth;
  const dash = s.dash ?? d.dash;
  ctx.setLineDash(dash !== undefined ? [...dash] : []);
}

/** Fills (if requested) then strokes (unless suppressed) the current path. */
function paint(ctx: Canvas2DLike, d: ResolvedDrawing, s: PrimitiveStyle, canFill: boolean): void {
  const alpha = s.alpha ?? 1;
  if (canFill && s.fill !== undefined) {
    ctx.fillStyle = s.fill === true ? (s.color ?? d.color) : s.fill;
    ctx.globalAlpha = alpha * (s.fillAlpha ?? 0.15);
    ctx.fill();
  }
  if (s.noStroke !== true) {
    applyStroke(ctx, d, s);
    ctx.globalAlpha = alpha;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function roundedRect(ctx: Canvas2DLike, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Multi-line text; `\n` separates lines. With `bg`, the anchor refers to the
 * padded box's edge (per `align`/`baseline`); without, to the text block.
 */
function drawText(
  ctx: Canvas2DLike,
  d: ResolvedDrawing,
  p: { readonly text: string; readonly x: number; readonly y: number } & TextStyle,
  paintCfg: DrawingPaint,
): void {
  const size = p.size ?? paintCfg.fontSize;
  const family = p.font === 'sans' ? paintCfg.sansFamily : paintCfg.monoFamily;
  ctx.font = `${p.bold === true ? '600 ' : ''}${size}px ${family}`;
  const lines = p.text.split('\n');
  const lh = Math.round(size * 1.3);
  const widths = lines.map((l) => ctx.measureText(l).width);
  const pad = p.bg !== undefined ? (p.pad ?? 4) : 0;
  const w = Math.max(...widths) + pad * 2;
  const h = size + (lines.length - 1) * lh + pad * 2;
  const align = p.align ?? 'left';
  const baseline = p.baseline ?? 'middle';
  const left = align === 'left' ? p.x : align === 'center' ? p.x - w / 2 : p.x - w;
  const top = baseline === 'top' ? p.y : baseline === 'middle' ? p.y - h / 2 : p.y - h;
  if (p.bg !== undefined) {
    const x = Math.round(left);
    const y = Math.round(top);
    roundedRect(ctx, x, y, Math.ceil(w), Math.ceil(h), p.radius ?? 3);
    ctx.fillStyle = p.bg === true ? d.color : p.bg;
    ctx.fill();
    if (p.border !== undefined) {
      ctx.setLineDash([]);
      ctx.strokeStyle = p.border;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  ctx.fillStyle = p.color ?? (p.bg !== undefined
    ? contrastingTextColor(p.bg === true ? d.color : p.bg, paintCfg.background)
    : d.color);
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  const tx = align === 'left' ? left + pad : align === 'center' ? left + w / 2 : left + w - pad;
  lines.forEach((line, i) => {
    ctx.fillText(line, Math.round(tx), Math.round(top + pad + size / 2 + i * lh));
  });
}

function drawPrimitive(ctx: Canvas2DLike, d: ResolvedDrawing, p: DrawPrimitive, paintCfg: DrawingPaint): void {
  const pr = paintCfg.pixelRatio;
  switch (p.type) {
    case 'line': {
      const w = p.width ?? d.lineWidth;
      let { x1, y1, x2, y2 } = p;
      if (y1 === y2) y1 = y2 = crisp(y1, w, pr);
      if (x1 === x2) x1 = x2 = crisp(x1, w, pr);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      paint(ctx, d, p, false);
      return;
    }
    case 'rect': {
      const w = p.width ?? d.lineWidth;
      const x = crisp(p.x, w, pr);
      const y = crisp(p.y, w, pr);
      ctx.beginPath();
      ctx.rect(x, y, crisp(p.x + p.w, w, pr) - x, crisp(p.y + p.h, w, pr) - y);
      paint(ctx, d, p, true);
      return;
    }
    case 'path': {
      if (p.points.length < 4) return;
      ctx.beginPath();
      ctx.moveTo(p.points[0]!, p.points[1]!);
      for (let i = 2; i < p.points.length; i += 2) ctx.lineTo(p.points[i]!, p.points[i + 1]!);
      if (p.closed === true) ctx.closePath();
      paint(ctx, d, p, true);
      return;
    }
    case 'ellipse':
      ctx.beginPath();
      ctx.ellipse(p.cx, p.cy, Math.max(0, p.rx), Math.max(0, p.ry), p.rotation ?? 0, p.start ?? 0, p.end ?? Math.PI * 2);
      paint(ctx, d, p, true);
      return;
    case 'bezier':
      ctx.beginPath();
      ctx.moveTo(p.x1, p.y1);
      ctx.bezierCurveTo(p.cx1, p.cy1, p.cx2, p.cy2, p.x2, p.y2);
      paint(ctx, d, p, true);
      return;
    case 'text':
      drawText(ctx, d, p, paintCfg);
      return;
    default:
      ctx.drawImage(p.image, p.x, p.y, p.w, p.h);
  }
}

/** Paints every drawing, then its handles. Caller translates/clips to the pane. */
export function drawDrawings(ctx: Canvas2DLike, drawings: readonly ResolvedDrawing[], paintCfg: DrawingPaint): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const d of drawings) {
    for (const p of d.primitives) drawPrimitive(ctx, d, p, paintCfg);
    if (d.handles !== undefined) {
      ctx.setLineDash([]);
      for (const h of d.handles) {
        ctx.beginPath();
        ctx.ellipse(h.x, h.y, 4.5, 4.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = paintCfg.background;
        ctx.fill();
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}
