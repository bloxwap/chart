/**
 * Snapshot export: renders a chart frame into a fresh canvas created through
 * the injected document, with snapshot-only overrides, and encodes it.
 *
 * @module
 */

import type { WatermarkConfig } from '../config.js';
import type { ChartCanvas, ChartDocument } from '../dom.js';
import { renderChart, type RenderView } from '../render/renderer.js';

/** Options for {@link import('./chart.js').Chart.takeScreenshot}. */
export interface SnapshotOptions {
  /** Watermark fields merged over the chart's for the snapshot only; the live chart is untouched. */
  watermark?: Partial<WatermarkConfig>;
  /** Backing-store pixels per CSS pixel. Default: the chart's current ratio. */
  pixelRatio?: number;
  /** Include the crosshair (and the hovered bar in the status line). Default false. */
  crosshair?: boolean;
  /** Background color override, e.g. `'transparent'`. */
  background?: string;
}

/** Options for {@link import('./chart.js').Chart.toBlob} and `toDataURL`. */
export interface SnapshotImageOptions extends SnapshotOptions {
  /** Image MIME type, e.g. `'image/png'` (the canvas default) or `'image/jpeg'`. */
  type?: string;
  /** Lossy encoder quality in 0-1. */
  quality?: number;
}

/**
 * What a snapshot encodes to: the host's `Blob` type where its typings declare
 * one (DOM or Node), so the result goes straight to `URL.createObjectURL` or a
 * `ClipboardItem`; `unknown` otherwise. The library compiles against ES2022
 * only. A {@link import('../dom.js').MockCanvas} yields a `MockBlob` instead.
 */
export type SnapshotBlob = typeof globalThis extends { Blob: { prototype: infer B } } ? B : unknown;

const NO_CROSSHAIR = { active: false, x: 0, y: 0 } as const;

/**
 * Creates a canvas of `width`×`height` backing pixels: through the injected
 * {@link ChartDocument} when one was given, else the container's
 * `ownerDocument.createElement('canvas')`.
 *
 * @throws When neither exists.
 */
export function createSnapshotCanvas(container: ChartCanvas, document: ChartDocument | undefined, width: number, height: number): ChartCanvas {
  if (document !== undefined) return document.createCanvas(width, height);
  const owner = container.ownerDocument;
  if (owner?.createElement === undefined) {
    throw new Error('chart-ts: snapshots need a ChartDocument or a container canvas with an ownerDocument');
  }
  const canvas = owner.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * Renders `view` into a new canvas from `create` at the same CSS size, scaled
 * by the snapshot ratio, applying {@link SnapshotOptions} overrides. The
 * context keeps only the color space of `attributes` (e.g. the live context's
 * `getContextAttributes()`): `alpha: false` would make a transparent
 * background export opaque.
 *
 * @throws For a non-positive ratio or when the new canvas has no 2D context.
 */
export function renderSnapshot(
  view: RenderView,
  create: (width: number, height: number) => ChartCanvas,
  options: SnapshotOptions,
  attributes?: { colorSpace?: 'srgb' | 'display-p3' },
): ChartCanvas {
  const ratio = options.pixelRatio ?? view.pixelRatio;
  if (!(ratio > 0 && Number.isFinite(ratio))) throw new Error(`chart-ts: invalid snapshot pixelRatio ${ratio}`);
  const canvas = create(Math.round(view.canvasWidth * ratio), Math.round(view.canvasHeight * ratio));
  const colorSpace = attributes?.colorSpace;
  const ctx = canvas.getContext('2d', colorSpace === undefined ? undefined : { colorSpace });
  if (ctx === null) throw new Error('chart-ts: the snapshot canvas has no 2D context');
  const { config } = view;
  renderChart(ctx, {
    ...view,
    pixelRatio: ratio,
    config: {
      ...config,
      watermark: { ...config.watermark, ...options.watermark },
      theme: { ...config.theme, background: options.background ?? config.theme.background },
    },
    crosshair: options.crosshair === true ? view.crosshair : NO_CROSSHAIR,
  });
  return canvas;
}

/**
 * Promise wrapper over `canvas.toBlob`.
 *
 * @throws (rejects) When the canvas cannot encode or yields `null`.
 */
export function canvasToBlob(canvas: ChartCanvas, type?: string, quality?: number): Promise<SnapshotBlob> {
  return new Promise((resolve, reject) => {
    if (canvas.toBlob === undefined) throw new Error('chart-ts: this canvas does not support toBlob');
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error('chart-ts: the canvas produced no image'));
      else resolve(blob as SnapshotBlob);
    }, type, quality);
  });
}

/**
 * Wrapper over `canvas.toDataURL`.
 *
 * @throws When the canvas cannot encode.
 */
export function canvasToDataURL(canvas: ChartCanvas, type?: string, quality?: number): string {
  if (canvas.toDataURL === undefined) throw new Error('chart-ts: this canvas does not support toDataURL');
  return canvas.toDataURL(type, quality);
}

/** Encodes a snapshot canvas via {@link canvasToBlob}, then releases its backing store. */
export async function snapshotToBlob(canvas: ChartCanvas, options: SnapshotImageOptions): Promise<SnapshotBlob> {
  try {
    return await canvasToBlob(canvas, options.type, options.quality);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

/** Encodes a snapshot canvas via {@link canvasToDataURL}, then releases its backing store. */
export function snapshotToDataURL(canvas: ChartCanvas, options: SnapshotImageOptions): string {
  try {
    return canvasToDataURL(canvas, options.type, options.quality);
  } finally {
    canvas.width = canvas.height = 0;
  }
}
