/**
 * Stylesheet for the chart header ({@link import('./header.js').createChartHeader})
 * and the on-chart price-scale buttons ({@link import('./scale-buttons.js').createScaleButtons}).
 *
 * Both are themed through `--cts-header-*` custom properties that fall back to
 * the shared toolbar tokens, so they follow `.cts-theme` / `.cts-light` with no
 * extra setup. Set any of them on the header, or on an ancestor, to restyle
 * (the theme classes never set them, so plain CSS works):
 *
 * | Property | Default | Styles |
 * | --- | --- | --- |
 * | `--cts-header-bg` | `--cts-panel` | bar and on-chart button fill |
 * | `--cts-header-text` | `--cts-idle` | idle text and icons |
 * | `--cts-header-text-active` | `--cts-hover` | hovered, selected and symbol text |
 * | `--cts-header-hover-bg` | `--cts-accent-soft` | hover and open-menu fill |
 * | `--cts-header-active-bg` | `--cts-panel-raised` | selected timeframe fill |
 * | `--cts-header-accent` | `--cts-accent` | pressed scale toggles, focus ring |
 * | `--cts-header-on-accent` | `--cts-on-accent` | text on pressed toggles |
 * | `--cts-header-radius` | `--cts-radius-md` | button corners |
 * | `--cts-header-height` | `40px` | bar height |
 *
 * The header's menus use the toolbar tokens (`--cts-panel`, `--cts-edge`, …).
 * `.cts-theme` sets those on the menu portal itself, so a stylesheet has to
 * target the menus (`.cts-theme .cts-header-menu { … }`), or pass `tokens`.
 *
 * @module
 */

import type { ThemeName } from '../themes.js';
import type { UIDocument, UIElement } from './host.js';
import { injectStyles } from './styles.js';

/** Marker attribute on the injected header `<style>` element. */
export const HEADER_STYLE_MARKER = 'data-chart-ts-header';

/**
 * Header and on-chart scale button stylesheet (fill-only, zero-stroke). Fonts
 * use two-class selectors to beat the toolbar's `.cts-theme button { font: inherit }`.
 */
export const HEADER_CSS = `
.cts-header {
  display: flex; align-items: center; gap: 2px; flex: none; width: 100%; min-width: 0;
  height: var(--cts-header-height, 40px); padding: 0 8px; overflow: hidden; white-space: nowrap;
  background: var(--cts-header-bg, var(--cts-panel)); color: var(--cts-header-text, var(--cts-idle));
}
.cts-header-symbol {
  display: flex; align-items: center; flex: none; min-width: 0; padding: 0 8px 0 4px;
  font: 600 13px/1 var(--cts-font); color: var(--cts-header-text-active, var(--cts-hover));
}
.cts-header-group, .cts-header-slot { display: flex; align-items: center; gap: 2px; flex: none; }
.cts-header-group + .cts-header-group, .cts-header-group + .cts-header-btn, .cts-header-btn + .cts-header-group,
.cts-header-btn + .cts-header-slot, .cts-header-group + .cts-header-slot { margin-left: 6px; }
.cts-header-spacer { flex: 1 1 0; min-width: 8px; }
.cts-header-btn {
  display: flex; align-items: center; justify-content: center; gap: 6px; flex: none;
  height: 28px; min-width: 28px; padding: 0 8px; border: none; border-radius: var(--cts-header-radius, var(--cts-radius-md));
  background: transparent; color: var(--cts-header-text, var(--cts-idle)); cursor: pointer;
  transition: background-color 120ms var(--cts-ease), color 120ms var(--cts-ease);
}
.cts-header .cts-header-btn { font: 500 12px/1 var(--cts-mono); }
.cts-header-btn:hover, .cts-header-btn.cts-open {
  background: var(--cts-header-hover-bg, var(--cts-accent-soft)); color: var(--cts-header-text-active, var(--cts-hover));
}
.cts-header-btn.cts-active { background: var(--cts-header-active-bg, var(--cts-panel-raised)); color: var(--cts-header-text-active, var(--cts-hover)); }
.cts-header-btn.cts-on { background: var(--cts-header-accent, var(--cts-accent)); color: var(--cts-header-on-accent, var(--cts-on-accent)); }
.cts-header-btn:focus-visible, .cts-scale-btn:focus-visible { outline: 2px solid var(--cts-header-accent, var(--cts-accent)); outline-offset: 1px; }
.cts-header-btn .cts-caret { position: static; transform: rotate(90deg); width: 8px; height: auto; }
.cts-header-text { font: 500 13px/1 var(--cts-font); }
.cts-header-compact .cts-header-timeframes, .cts-header-compact .cts-header-text,
.cts-header:not(.cts-header-compact) .cts-header-tf-menu { display: none; }
.cts-header-menu { min-width: 168px; }

.cts-scale-buttons {
  position: absolute; z-index: 6; display: flex; align-items: flex-end; justify-content: center; gap: 2px;
  padding-bottom: 6px; pointer-events: none; background: transparent;
}
.cts-scale-btn {
  position: relative; pointer-events: auto; width: 18px; height: 18px; padding: 0; flex: none; border: none;
  border-radius: var(--cts-header-radius, var(--cts-radius-sm)); background: var(--cts-header-bg, var(--cts-panel));
  color: var(--cts-header-text, var(--cts-idle)); text-align: center; cursor: pointer;
  opacity: 0.7; transition: opacity 120ms var(--cts-ease), background-color 120ms var(--cts-ease), color 120ms var(--cts-ease);
}
.cts-scale-buttons .cts-scale-btn { font: 600 10px/18px var(--cts-mono); }
.cts-scale-btn:hover { opacity: 1; background: var(--cts-header-hover-bg, var(--cts-accent-soft)); color: var(--cts-header-text-active, var(--cts-hover)); }
.cts-scale-btn.cts-on { opacity: 1; background: var(--cts-header-accent, var(--cts-accent)); color: var(--cts-header-on-accent, var(--cts-on-accent)); }
/* Fingers: each hit area grows to 24px tall and meets its neighbours (the 64px axis has no room for 24px wide). */
@media (pointer: coarse) { .cts-scale-btn::before { content: ''; position: absolute; inset: -3px -1px; } }

@media (prefers-reduced-motion: reduce) { .cts-header-btn, .cts-scale-btn { transition: none; } }
`;

/** Custom-property values by name, e.g. `{ '--cts-header-bg': '#171717' }`. */
export type HeaderTokens = Readonly<Record<string, string>>;

/**
 * One token set per UI theme for the header and the scale buttons: `setTheme`
 * applies the matching set and clears the other. A theme without a set keeps
 * the default `.cts-theme` / `.cts-light` look.
 */
export interface ThemedHeaderTokens {
  readonly dark?: HeaderTokens;
  readonly light?: HeaderTokens;
}

/**
 * Token overrides reproducing the bloxwap.pro chart chrome: #171717 surface,
 * #a1a1a1 idle / #fafafa active text, #262626 hover fill, #00ff3f accent,
 * pill buttons and borderless menus. Pass as `tokens` to the header or the
 * scale buttons: they are set inline on the bar and on each header menu, so
 * they beat the theme classes, even in a shared toolbar portal, and apply in
 * both themes ({@link BLOXWAP_HEADER_THEME} keeps them to dark). To use CSS
 * instead, put the `--cts-header-*` half on `.cts-header, .cts-scale-buttons`
 * and the rest on `.cts-theme .cts-header-menu`.
 */
export const BLOXWAP_HEADER_TOKENS: HeaderTokens = {
  '--cts-header-bg': '#171717',
  '--cts-header-text': '#a1a1a1',
  '--cts-header-text-active': '#fafafa',
  '--cts-header-hover-bg': '#262626',
  '--cts-header-active-bg': '#262626',
  '--cts-header-accent': '#00ff3f',
  '--cts-header-on-accent': '#0a0a0a',
  '--cts-header-radius': '9999px',
  // Toolbar tokens, for the header's menus.
  '--cts-panel': '#171717',
  '--cts-panel-raised': '#262626',
  '--cts-edge': 'transparent',
  '--cts-idle': '#a1a1a1',
  '--cts-hover': '#fafafa',
  '--cts-accent': '#00ff3f',
  '--cts-accent-soft': '#262626',
  '--cts-on-accent': '#0a0a0a',
};

/** Injects the shared toolbar CSS and then {@link HEADER_CSS} into `doc`, once each. */
export function injectHeaderStyles(doc: UIDocument): UIElement {
  injectStyles(doc);
  const existing = doc.head.querySelector(`style[${HEADER_STYLE_MARKER}]`) as UIElement | null;
  if (existing !== null) return existing;
  const style = doc.createElement('style');
  style.setAttribute(HEADER_STYLE_MARKER, '');
  style.textContent = HEADER_CSS;
  doc.head.append(style);
  return style;
}

/**
 * The bloxwap.pro chrome on dark only: {@link BLOXWAP_HEADER_TOKENS} while
 * the header or scale buttons are dark, the default light tokens while light.
 */
export const BLOXWAP_HEADER_THEME: ThemedHeaderTokens = { dark: BLOXWAP_HEADER_TOKENS };

/** No tokens for a theme: one shared set, so {@link swapTokens} leaves the node alone. */
const NO_TOKENS: HeaderTokens = Object.freeze({});

/** The set `tokens` gives `theme`; a flat set serves both themes. */
export function headerTokensFor(tokens: HeaderTokens | ThemedHeaderTokens | undefined, theme: ThemeName): HeaderTokens {
  if (tokens === undefined) return NO_TOKENS;
  const themed: ThemedHeaderTokens = tokens;
  if (typeof themed.dark !== 'object' && typeof themed.light !== 'object') return themed as HeaderTokens;
  return themed[theme] ?? NO_TOKENS;
}

/**
 * Sets `next` inline on `node` (inline values beat theme classes) and removes
 * the properties only `previous` had, leaving other inline styles alone.
 * Returns true when this DOM has no per-property access and the tokens had to
 * replace the whole inline style, so the caller can write its own styles again.
 */
export function swapTokens(node: UIElement, previous: HeaderTokens, next: HeaderTokens): boolean {
  // The same flat set on a theme switch, or no tokens either side: nothing to touch.
  if (previous === next || Object.keys(previous).length + Object.keys(next).length === 0) return false;
  const { style } = node;
  if (style.setProperty === undefined || style.removeProperty === undefined) {
    node.setAttribute('style', Object.entries(next).map(([name, value]) => `${name}: ${value}`).join('; '));
    return true;
  }
  for (const name of Object.keys(previous)) if (!Object.hasOwn(next, name)) style.removeProperty(name);
  for (const [name, value] of Object.entries(next)) style.setProperty(name, value);
  return false;
}
