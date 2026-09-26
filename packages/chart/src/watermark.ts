/**
 * Watermark layer: centered text and/or image rendered under the series.
 *
 * @module
 */

import type { WatermarkConfig } from './config.js';
import type { Canvas2DLike } from './dom.js';
import { withAlpha } from './color.js';

/**
 * Draws the watermark into the plot area. The image (when present) is scaled
 * to at most half the plot size and centered; text sits at the center, shifted
 * down below the image when both are present.
 *
 * `fallbackFamily` (the theme sans family) is used when
 * `config.fontFamily` is empty; an explicit watermark font family always wins.
 */
export function drawWatermark(
  ctx: Canvas2DLike,
  config: WatermarkConfig,
  width: number,
  height: number,
  fallbackFamily: string,
): void {
  if (!config.visible) return;
  if (config.text === '' && config.image === null) return;
  ctx.save();
  ctx.globalAlpha = 1;
  const cx = width / 2;
  const cy = height / 2;
  const hasText = config.text !== '';
  const hasImage = config.image !== null;
  const family = config.fontFamily !== '' ? config.fontFamily : fallbackFamily;

  if (hasImage && config.image !== null) {
    const img = config.image;
    const scale = Math.min(1, (width * 0.5) / img.width, (height * 0.5) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const iy = cy - h / 2 - (hasText ? config.fontSize * 0.6 : 0);
    ctx.globalAlpha = config.opacity;
    ctx.drawImage(img, cx - w / 2, iy, w, h);
  }

  if (hasText) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = withAlpha(config.color, config.opacity);
    ctx.font = `${config.fontSize}px ${family}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const imageH =
      hasImage && config.image !== null
        ? config.image.height *
          Math.min(1, (width * 0.5) / config.image.width, (height * 0.5) / config.image.height)
        : 0;
    ctx.fillText(config.text, cx, cy + imageH / 2 + (hasImage ? config.fontSize * 0.2 : 0));
  }
  ctx.restore();
}
