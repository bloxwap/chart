/**
 * Pointer hit-testing against drawing primitives, used for selecting,
 * dragging and erasing drawings.
 *
 * @module
 */

import type { DrawPrimitive } from './types.js';

/** Distance from `(px, py)` to the segment `(x1, y1)–(x2, y2)`. */
export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Even-odd point-in-polygon over flat `[x0, y0, …]` coordinates. */
function insidePolygon(pts: readonly number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i]!;
    const yi = pts[i + 1]!;
    const xj = pts[j]!;
    const yj = pts[j + 1]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function nearPolyline(pts: readonly number[], closed: boolean, x: number, y: number, tol: number): boolean {
  const n = pts.length / 2;
  const segs = closed ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const i = k * 2;
    const j = ((k + 1) % n) * 2;
    if (distToSegment(x, y, pts[i]!, pts[i + 1]!, pts[j]!, pts[j + 1]!) <= tol) return true;
  }
  return false;
}

/**
 * Whether `(x, y)` hits `prim` within `tol` pixels. Filled shapes hit
 * anywhere inside; outlines hit near the stroke. Text and images hit
 * inside their (estimated) box.
 */
export function hitTest(prim: DrawPrimitive, x: number, y: number, tol: number): boolean {
  switch (prim.type) {
    case 'line':
      return distToSegment(x, y, prim.x1, prim.y1, prim.x2, prim.y2) <= tol + (prim.width ?? 1) / 2;
    case 'rect': {
      const inside = x >= prim.x - tol && x <= prim.x + prim.w + tol && y >= prim.y - tol && y <= prim.y + prim.h + tol;
      if (prim.fill !== undefined) return inside;
      const pts = [prim.x, prim.y, prim.x + prim.w, prim.y, prim.x + prim.w, prim.y + prim.h, prim.x, prim.y + prim.h];
      return nearPolyline(pts, true, x, y, tol);
    }
    case 'path':
      if (prim.closed === true && prim.fill !== undefined && insidePolygon(prim.points, x, y)) return true;
      return nearPolyline(prim.points, prim.closed === true, x, y, tol + (prim.width ?? 1) / 2);
    case 'ellipse': {
      const rx = Math.max(prim.rx, 1e-6);
      const ry = Math.max(prim.ry, 1e-6);
      const nd = Math.hypot((x - prim.cx) / rx, (y - prim.cy) / ry);
      if (prim.fill !== undefined && nd <= 1) return true;
      return Math.abs(nd - 1) * Math.min(rx, ry) <= tol;
    }
    case 'bezier': {
      const pts: number[] = [];
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const u = 1 - t;
        pts.push(
          u * u * u * prim.x1 + 3 * u * u * t * prim.cx1 + 3 * u * t * t * prim.cx2 + t * t * t * prim.x2,
          u * u * u * prim.y1 + 3 * u * u * t * prim.cy1 + 3 * u * t * t * prim.cy2 + t * t * t * prim.y2,
        );
      }
      if (prim.fill !== undefined && insidePolygon(pts, x, y)) return true;
      return nearPolyline(pts, false, x, y, tol);
    }
    case 'text': {
      const size = prim.size ?? 12;
      const lines = prim.text.split('\n');
      const w = Math.max(...lines.map((l) => l.length)) * size * 0.6 + (prim.pad ?? 4) * 2;
      const h = lines.length * size * 1.3 + (prim.pad ?? 4) * 2;
      const align = prim.align ?? 'left';
      const left = align === 'left' ? prim.x : align === 'center' ? prim.x - w / 2 : prim.x - w;
      const baseline = prim.baseline ?? 'middle';
      const top = baseline === 'top' ? prim.y : baseline === 'middle' ? prim.y - h / 2 : prim.y - h;
      return x >= left - tol && x <= left + w + tol && y >= top - tol && y <= top + h + tol;
    }
    default:
      return x >= prim.x && x <= prim.x + prim.w && y >= prim.y && y <= prim.y + prim.h;
  }
}
