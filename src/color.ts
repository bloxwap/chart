/**
 * Color parsing and serialization with CSS Color 4 support.
 *
 * Accepted formats: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, `rgba(...)`,
 * space-separated `rgb(r g b / a)`, and wide-gamut `color(display-p3 r g b / a)`.
 * Canvas 2D contexts in modern browsers accept all of these strings as-is.
 *
 * @module
 */

/** A parsed color, either in the sRGB or Display-P3 color space. */
export interface ParsedColor {
  /** Color space of the channels. */
  readonly space: 'srgb' | 'display-p3';
  /** Red channel. 0-255 for srgb, 0-1 for display-p3. */
  readonly r: number;
  /** Green channel. 0-255 for srgb, 0-1 for display-p3. */
  readonly g: number;
  /** Blue channel. 0-255 for srgb, 0-1 for display-p3. */
  readonly b: number;
  /** Alpha channel, 0-1. */
  readonly a: number;
}

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_RE = /^rgba?\(\s*([^)]*?)\s*\)$/i;
const P3_RE = /^color\(\s*display-p3\s+([^)]*?)\s*\)$/i;

function parseChannel(token: string): number | null {
  if (token.endsWith('%')) {
    const pct = Number(token.slice(0, -1));
    return Number.isFinite(pct) ? (pct / 100) * 255 : null;
  }
  const v = Number(token);
  return Number.isFinite(v) ? v : null;
}

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  if (token.endsWith('%')) {
    const pct = Number(token.slice(0, -1));
    return Number.isFinite(pct) ? pct / 100 : null;
  }
  const v = Number(token);
  return Number.isFinite(v) ? v : null;
}

/** Splits a CSS function body on commas or whitespace, honoring a `/ alpha` suffix. */
function splitFnArgs(body: string): { channels: string[]; alpha: string | undefined } | null {
  const slashIdx = body.indexOf('/');
  let main = body;
  let alpha: string | undefined;
  if (slashIdx >= 0) {
    main = body.slice(0, slashIdx).trim();
    alpha = body.slice(slashIdx + 1).trim();
    if (alpha === '' || alpha.includes('/')) return null;
  }
  const channels = main.includes(',')
    ? main.split(',').map((s) => s.trim())
    : main.split(/\s+/).filter((s) => s !== '');
  if (channels.some((c) => c === '')) return null;
  return { channels, alpha };
}

function parseHex(hex: string): ParsedColor | null {
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  // After expansion the regex guarantees exactly 6 or 8 digits.
  if (h.length === 6) h += 'ff';
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const a = parseInt(h.slice(6, 8), 16) / 255;
  return { space: 'srgb', r, g, b, a };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Parses a CSS color string into channels.
 *
 * @param input - `#hex`, `rgb()/rgba()`, or `color(display-p3 ...)` string.
 * @returns The parsed color, or `null` when the string is not a supported color.
 */
export function parseColor(input: string): ParsedColor | null {
  const s = input.trim();
  const hexMatch = HEX_RE.exec(s);
  if (hexMatch !== null) return parseHex(s);

  const rgbMatch = RGB_RE.exec(s);
  if (rgbMatch !== null) {
    const args = splitFnArgs(rgbMatch[1] as string);
    if (args === null) return null;
    let alphaTok = args.alpha;
    let channelToks = args.channels;
    // Legacy comma form may carry alpha as a 4th channel.
    if (channelToks.length === 4 && alphaTok === undefined) {
      alphaTok = channelToks[3];
      channelToks = channelToks.slice(0, 3);
    }
    if (channelToks.length !== 3) return null;
    const rgb = channelToks.map(parseChannel);
    if (rgb.some((v) => v === null)) return null;
    const a = parseAlpha(alphaTok);
    if (a === null) return null;
    const [r, g, b] = rgb as [number, number, number];
    return { space: 'srgb', r, g, b, a: clamp01(a) };
  }

  const p3Match = P3_RE.exec(s);
  if (p3Match !== null) {
    const args = splitFnArgs(p3Match[1] as string);
    if (args === null || args.channels.length !== 3) return null;
    const rgb = args.channels.map((t) => {
      const v = Number(t);
      return Number.isFinite(v) ? v : null;
    });
    if (rgb.some((v) => v === null)) return null;
    const a = parseAlpha(args.alpha);
    if (a === null) return null;
    const [r, g, b] = rgb as [number, number, number];
    return { space: 'display-p3', r, g, b, a: clamp01(a) };
  }

  return null;
}

/**
 * Serializes a parsed color back to a CSS string, preserving its color space.
 *
 * @param c - The color to serialize.
 * @returns `rgb()/rgba()` for srgb colors, `color(display-p3 ...)` for p3 colors.
 */
export function serializeColor(c: ParsedColor): string {
  if (c.space === 'display-p3') {
    return `color(display-p3 ${c.r} ${c.g} ${c.b} / ${c.a})`;
  }
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  return c.a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${c.a})`;
}

/**
 * Returns whether a string is a color this library understands.
 *
 * @param input - Candidate CSS color string.
 */
export function isValidColor(input: string): boolean {
  return parseColor(input) !== null;
}

/**
 * Returns a color string identical to the input but with a new alpha value.
 * Unparseable input is returned unchanged so it can flow straight to canvas.
 *
 * @param input - Any supported CSS color string.
 * @param alpha - New alpha, 0-1.
 */
export function withAlpha(input: string, alpha: number): string {
  const parsed = parseColor(input);
  if (parsed === null) return input;
  return serializeColor({ ...parsed, a: clamp01(alpha) });
}
