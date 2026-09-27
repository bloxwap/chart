/**
 * Annotation and icon tools: text, anchored text, note, anchored note,
 * price note, pin, table, callout, comment, price label, signpost, flag
 * mark, image, emoji, sticker, icon.
 *
 * @module
 */

import { defineDrawing } from './define.js';
import type { DrawingMeta, DrawPrimitive } from './types.js';
import { clampIndex, poly, seg, spansPlot, text, type FullView, type Pt } from './geom.js';

/** `meta.text`, or `fallback` when empty. */
function body(meta: DrawingMeta, fallback: string): string {
  return meta.text === '' ? fallback : meta.text;
}

/** Plain text at a data point. */
export const textDrawing = defineDrawing({
  name: 'text',
  minPoints: 1,
  wantsText: true,
  build: ([a], _v, _pts, meta) => [text(body(meta, 'Text'), a!, { font: 'sans', size: 14 })],
});

/** Text pinned to a screen position (survives scrolling/zooming). */
export const anchoredTextDrawing = defineDrawing({
  name: 'anchored-text',
  minPoints: 1,
  anchored: true,
  wantsText: true,
  build: ([a], _v, _pts, meta) => [text(body(meta, 'Text'), a!, { font: 'sans', size: 14 })],
});

/** A marker dot at `at` with a note box above it. */
function noteAt(at: Pt, value: string): DrawPrimitive[] {
  return [
    seg(at, { x: at.x, y: at.y - 14 }),
    { type: 'ellipse', cx: at.x, cy: at.y, rx: 4, ry: 4, fill: true, fillAlpha: 1 },
    text(value, { x: at.x, y: at.y - 14 }, { align: 'center', baseline: 'bottom', bg: true, font: 'sans', pad: 6 }),
  ];
}

/** Note: a marker with a text box, attached to a data point. */
export const noteDrawing = defineDrawing({
  name: 'note',
  minPoints: 1,
  wantsText: true,
  build: ([a], _v, _pts, meta) => noteAt(a!, body(meta, 'Note')),
});

/** Note pinned to a screen position. */
export const anchoredNoteDrawing = defineDrawing({
  name: 'anchored-note',
  minPoints: 1,
  anchored: true,
  wantsText: true,
  build: ([a], _v, _pts, meta) => noteAt(a!, body(meta, 'Note')),
});

/** Price note (2 points): a leader line from the priced point to a label with that price. */
export const priceNoteDrawing = defineDrawing({
  name: 'price-note',
  minPoints: 2,
  build: ([a, b], v, pts) => [
    seg(a!, b!),
    { type: 'ellipse', cx: a!.x, cy: a!.y, rx: 3, ry: 3, fill: true, fillAlpha: 1 },
    text(v.formatPrice(pts[0]!.price), b!, { align: b!.x >= a!.x ? 'left' : 'right', bg: true, inside: spansPlot(a!.x, b!.x, v.width) }),
  ],
});

/** Pin: a map-pin glyph; its text shows beside it. */
export const pinDrawing = defineDrawing({
  name: 'pin',
  minPoints: 1,
  wantsText: true,
  build: ([a], _v, _pts, meta) => [
    poly([a!, { x: a!.x - 7, y: a!.y - 14 }, { x: a!.x + 7, y: a!.y - 14 }], { closed: true, fill: true, fillAlpha: 1 }),
    { type: 'ellipse', cx: a!.x, cy: a!.y - 18, rx: 8, ry: 8, fill: true, fillAlpha: 1 },
    { type: 'ellipse', cx: a!.x, cy: a!.y - 18, rx: 3, ry: 3, fill: '#ffffff', fillAlpha: 1, noStroke: true },
    ...(meta.text === '' ? [] : [text(meta.text, { x: a!.x + 12, y: a!.y - 18 }, { bg: true, font: 'sans' })]),
  ],
});

/** Approximate advance of `s` at `size` px (sans, averaged). */
function textWidth(s: string, size: number): number {
  return s.length * size * 0.6;
}

/** Table: rows split on newlines, cells on `|`; the first row is the header. */
export const tableDrawing = defineDrawing({
  name: 'table',
  minPoints: 1,
  wantsText: true,
  build: ([a], _v, _pts, meta) => {
    const rows = body(meta, 'Metric|Value\nOpen|—\nClose|—').split('\n').map((r) => r.split('|'));
    const cols = Math.max(...rows.map((r) => r.length));
    const size = 12;
    const rowH = size + 10;
    const widths = Array.from({ length: cols }, (_, c) =>
      Math.max(40, ...rows.map((r) => textWidth(r[c] ?? '', size) + 16)),
    );
    const total = widths.reduce((s, w) => s + w, 0);
    const out: DrawPrimitive[] = [
      { type: 'rect', x: a!.x, y: a!.y, w: total, h: rowH * rows.length, fill: true, fillAlpha: 0.06 },
      { type: 'rect', x: a!.x, y: a!.y, w: total, h: rowH, fill: true, fillAlpha: 0.25, noStroke: true },
    ];
    for (let r = 1; r < rows.length; r++) out.push(seg({ x: a!.x, y: a!.y + r * rowH }, { x: a!.x + total, y: a!.y + r * rowH }, { alpha: 0.4 }));
    let x = a!.x;
    widths.forEach((w, c) => {
      if (c > 0) out.push(seg({ x, y: a!.y }, { x, y: a!.y + rowH * rows.length }, { alpha: 0.4 }));
      rows.forEach((row, r) => {
        out.push(text(row[c] ?? '', { x: x + 8, y: a!.y + r * rowH + rowH / 2 }, { font: 'sans', size, bold: r === 0 }));
      });
      x += w;
    });
    return out;
  },
});

/** Callout (2 points): a text box at b with a pointer to a. */
export const calloutDrawing = defineDrawing({
  name: 'callout',
  minPoints: 2,
  wantsText: true,
  build: ([a, b], _v, _pts, meta) => [
    poly([a!, { x: b!.x - 6, y: b!.y }, { x: b!.x + 6, y: b!.y }], { closed: true, fill: true, fillAlpha: 1 }),
    text(body(meta, 'Callout'), b!, { align: 'center', bg: true, font: 'sans', pad: 8 }),
  ],
});

/** Comment: a speech bubble above the point with a tail down to it. */
export const commentDrawing = defineDrawing({
  name: 'comment',
  minPoints: 1,
  wantsText: true,
  build: ([a], _v, _pts, meta) => [
    poly([a!, { x: a!.x, y: a!.y - 16 }, { x: a!.x + 10, y: a!.y - 16 }], { closed: true, fill: true, fillAlpha: 1 }),
    text(body(meta, 'Comment'), { x: a!.x - 6, y: a!.y - 14 }, { baseline: 'bottom', bg: true, font: 'sans', pad: 8, radius: 10 }),
  ],
});

/** Price label: the point's price in a bubble pointing at it. */
export const priceLabelDrawing = defineDrawing({
  name: 'price-label',
  minPoints: 1,
  build: ([a], v, pts) => [
    poly([a!, { x: a!.x - 5, y: a!.y - 10 }, { x: a!.x + 5, y: a!.y - 10 }], { closed: true, fill: true, fillAlpha: 1 }),
    text(v.formatPrice(pts[0]!.price), { x: a!.x, y: a!.y - 9 }, { align: 'center', baseline: 'bottom', bg: true }),
  ],
});

/** Top of the bar at a data point (candle high when data exists, else the point). */
function barTop(v: FullView, index: number, fallback: number): number {
  const i = clampIndex(v.candles, index);
  return i < 0 ? fallback : Math.min(fallback, v.priceToY(v.candles[i]!.high));
}

/** Signpost: a pole rising from the bar with a rounded label on top. */
export const signpostDrawing = defineDrawing({
  name: 'signpost',
  minPoints: 1,
  wantsText: true,
  build: ([a], v, pts, meta) => {
    const top = barTop(v, pts[0]!.index, a!.y) - 6;
    return [
      seg({ x: a!.x, y: top }, { x: a!.x, y: top - 36 }, { width: 2 }),
      text(body(meta, 'Signpost'), { x: a!.x, y: top - 36 }, { align: 'center', baseline: 'bottom', bg: true, font: 'sans', radius: 10, pad: 6 }),
    ];
  },
});

/** Flag mark: a pole with a filled flag at the point. */
export const flagMarkDrawing = defineDrawing({
  name: 'flag-mark',
  minPoints: 1,
  build: ([a]) => [
    seg(a!, { x: a!.x, y: a!.y - 24 }, { width: 2 }),
    poly(
      [
        { x: a!.x, y: a!.y - 24 },
        { x: a!.x + 16, y: a!.y - 20 },
        { x: a!.x, y: a!.y - 14 },
      ],
      { closed: true, fill: true, fillAlpha: 1 },
    ),
  ],
});

/** Image (2 points): the drawing's image fitted into the a–b box (a dashed placeholder until set). */
export const imageDrawing = defineDrawing({
  name: 'image',
  minPoints: 2,
  build: ([a, b], _v, _pts, meta) => {
    const x = Math.min(a!.x, b!.x);
    const y = Math.min(a!.y, b!.y);
    const w = Math.abs(b!.x - a!.x);
    const h = Math.abs(b!.y - a!.y);
    if (meta.image === null) {
      return [
        { type: 'rect', x, y, w, h, dash: [4, 4], fill: true, fillAlpha: 0.05 },
        text('Image', { x: x + w / 2, y: y + h / 2 }, { align: 'center', font: 'sans' }),
      ];
    }
    return [{ type: 'image', image: meta.image, x, y, w, h }];
  },
});

/** Emoji: a glyph centered on the point. */
export const emojiDrawing = defineDrawing({
  name: 'emoji',
  minPoints: 1,
  wantsText: true,
  build: ([a], _v, _pts, meta) => [text(body(meta, '😀'), a!, { align: 'center', font: 'sans', size: 28 })],
});

/** Sticker: a large glyph on a soft round badge. */
export const stickerDrawing = defineDrawing({
  name: 'sticker',
  minPoints: 1,
  wantsText: true,
  build: ([a], _v, _pts, meta) => [
    { type: 'ellipse', cx: a!.x, cy: a!.y, rx: 32, ry: 32, fill: true, fillAlpha: 0.18, noStroke: true },
    text(body(meta, '🚀'), a!, { align: 'center', font: 'sans', size: 40 }),
  ],
});

/** Icon: a monochrome symbol in the drawing color. */
export const iconDrawing = defineDrawing({
  name: 'icon',
  minPoints: 1,
  wantsText: true,
  build: ([a], _v, _pts, meta) => [text(body(meta, '★'), a!, { align: 'center', font: 'sans', size: 24 })],
});

/** All annotation and icon tools, in toolbar order. */
export const ANNOTATION_DRAWINGS = [
  textDrawing,
  anchoredTextDrawing,
  noteDrawing,
  anchoredNoteDrawing,
  priceNoteDrawing,
  pinDrawing,
  tableDrawing,
  calloutDrawing,
  commentDrawing,
  priceLabelDrawing,
  signpostDrawing,
  flagMarkDrawing,
  imageDrawing,
  emojiDrawing,
  stickerDrawing,
  iconDrawing,
] as const;
