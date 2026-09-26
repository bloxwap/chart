/**
 * Toolbar stylesheet. Everything is prefixed `cts-` and themed through
 * custom properties on `.cts-theme` (dark by default, `.cts-light` for
 * light), so the UI looks identical in every host and never collides with
 * host styles. Injected once per document by {@link injectStyles}.
 *
 * @module
 */

import type { UIDocument, UIElement } from './host.js';

/** Marker attribute on the injected `<style>` element. */
export const STYLE_MARKER = 'data-chart-ts-ui';

/** The complete toolbar stylesheet. */
export const TOOLBAR_CSS = `
.cts-theme {
  box-sizing: border-box;
  --cts-bg: #0a0a0a; --cts-panel: #171717; --cts-panel-raised: #262626; --cts-edge: #262626;
  --cts-idle: #a1a1a1; --cts-muted: #737373; --cts-hover: #fafafa; --cts-accent: #2962ff;
  --cts-accent-soft: rgba(41, 98, 255, 0.18); --cts-on-accent: #ffffff; --cts-favorite: #f7b500;
  --cts-overlay: rgba(23, 23, 23, 0.9); --cts-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  --cts-radius-sm: 4px; --cts-radius-md: 8px; --cts-ease: cubic-bezier(0.2, 0.8, 0.2, 1);
  --cts-font: 'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --cts-mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace;
  font: 13px/1.4 var(--cts-font); color: var(--cts-idle); -webkit-font-smoothing: antialiased;
}
.cts-theme.cts-light {
  --cts-bg: #f5f7fa; --cts-panel: #ffffff; --cts-panel-raised: #f0f3fa; --cts-edge: #d8dee6;
  --cts-idle: #5a6472; --cts-muted: #8a93a3; --cts-hover: #131722;
  --cts-accent-soft: rgba(41, 98, 255, 0.12); --cts-overlay: rgba(255, 255, 255, 0.94);
  --cts-shadow: 0 8px 24px rgba(15, 23, 42, 0.15);
}
.cts-theme *, .cts-theme *::before, .cts-theme *::after { box-sizing: border-box; }
.cts-theme svg { display: block; flex: none; }
.cts-theme button { font: inherit; }

/* ---- unified chart settings ---- */
.cts-settings {
  position: fixed; z-index: 1100; left: 60px; bottom: 12px;
  width: min(470px, calc(100vw - 72px)); max-height: min(820px, calc(100dvh - 24px));
  display: flex; flex-direction: column; overflow: hidden; color: var(--cts-hover);
  background: var(--cts-panel); border: 1px solid var(--cts-edge); border-radius: 12px;
  color-scheme: dark;
  box-shadow: 0 16px 64px rgba(0, 0, 0, .38);
}
.cts-settings.cts-light { color-scheme: light; }
.cts-settings-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 20px 16px; }
.cts-settings h2 { font-size: 18px; font-weight: 500; margin: 0 0 5px; }
.cts-settings-head p { font-size: 12px; color: var(--cts-muted); margin: 0; }
.cts-settings-nav { display: flex; gap: 4px; padding: 0 16px 12px; border-bottom: 1px solid var(--cts-edge); }
.cts-settings-tab { flex: 1; border: 0; border-radius: 6px; padding: 8px 6px; background: var(--cts-panel-raised); color: var(--cts-idle); cursor: pointer; white-space: nowrap; }
.cts-settings-tab:hover, .cts-settings-tab:focus-visible { background: var(--cts-accent-soft); color: var(--cts-hover); }
.cts-settings-body { overflow-y: auto; overscroll-behavior: contain; min-height: 0; padding: 0 20px 20px; scrollbar-width: thin; scrollbar-color: var(--cts-edge) transparent; }
.cts-settings-section { padding-top: 22px; }
.cts-settings-section + .cts-settings-section { margin-top: 20px; border-top: 1px solid var(--cts-edge); }
.cts-settings h3 { margin: 0 0 12px; color: var(--cts-muted); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: .09em; }
.cts-settings h4 { margin: 20px 0 6px; font-size: 12px; color: var(--cts-muted); font-weight: 400; }
.cts-settings-row { display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 6px 0; }
.cts-settings-caption { flex: 1; min-width: 0; }
.cts-settings-caption label { cursor: pointer; }
.cts-settings-caption small { display: block; color: var(--cts-muted); font-size: 11px; line-height: 1.5; margin-top: 3px; }
.cts-settings-check { width: 17px; height: 17px; margin: 0; accent-color: var(--cts-accent); cursor: pointer; flex: none; }
.cts-settings-colors { display: flex; gap: 8px; }
.cts-settings-color { display: block; width: 32px; height: 32px; border: 4px solid var(--cts-panel-raised); outline: 1px solid var(--cts-edge); border-radius: 7px; overflow: hidden; flex: none; }
.cts-settings-color input { width: 100%; height: 100%; padding: 0; opacity: 0; cursor: pointer; }
.cts-settings-color:focus-within { outline: 2px solid var(--cts-accent); }
.cts-settings-color.cts-disabled { opacity: .3; }
.cts-settings-color.cts-disabled input { cursor: default; }
.cts-settings-select, .cts-settings-input { width: 156px; min-width: 0; padding: 8px 10px; border: 1px solid var(--cts-edge); border-radius: 6px; background: var(--cts-bg); color: var(--cts-hover); font: inherit; color-scheme: dark; }
.cts-light .cts-settings-select, .cts-light .cts-settings-input { color-scheme: light; }
.cts-settings-input:disabled { opacity: .4; }
.cts-settings input:focus-visible, .cts-settings select:focus-visible, .cts-settings button:focus-visible { outline: 2px solid var(--cts-accent); outline-offset: 2px; }
.cts-settings-footer { display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--cts-edge); padding: 12px 20px; }
.cts-settings-footer button { padding: 8px 16px; border-radius: 6px; cursor: pointer; }
.cts-settings-reset { color: var(--cts-idle); background: transparent; border: 1px solid var(--cts-edge); }
.cts-settings-done { color: var(--cts-on-accent); background: var(--cts-accent); border: 1px solid var(--cts-accent); }
.cts-price-plus { position: absolute; z-index: 5; pointer-events: auto; width: 24px; height: 24px; border: 1px solid var(--cts-edge); border-radius: 50%; background: var(--cts-panel); color: var(--cts-hover); cursor: pointer; font-size: 18px !important; line-height: 20px; padding: 0; }
@media (max-width: 540px) {
  .cts-settings { left: 8px; bottom: 8px; width: calc(100vw - 16px); max-height: calc(100dvh - 16px); }
  .cts-settings-head { padding: 16px; }
  .cts-settings-body { padding: 0 16px 16px; }
  .cts-settings-select, .cts-settings-input { width: 132px; }
}

/* ---- rails ---- */
.cts-rail {
  width: 52px; height: 100%; flex: none; display: flex; flex-direction: column; align-items: center;
  padding: 8px 0; background: var(--cts-bg); border-right: 1px solid var(--cts-edge);
}
.cts-rail-scroll {
  flex: 1; min-height: 0; width: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px;
  overflow-y: auto; scrollbar-width: none;
}
.cts-rail-scroll::-webkit-scrollbar { display: none; }
.cts-rail-scroll-wrap { position: relative; flex: 1; min-height: 0; width: 100%; }
.cts-rail-scroll-wrap > .cts-rail-scroll { height: 100%; scroll-padding-block: 24px; }
.cts-rail-scroll-wrap::before, .cts-rail-scroll-wrap::after {
  content: ''; position: absolute; left: 0; right: 0; height: 18px; z-index: 2; opacity: 0; pointer-events: none;
}
.cts-rail-scroll-wrap::before { top: 0; background: linear-gradient(var(--cts-bg), transparent); }
.cts-rail-scroll-wrap::after { bottom: 0; background: linear-gradient(transparent, var(--cts-bg)); }
.cts-can-scroll-up::before, .cts-can-scroll-down::after { opacity: 1; }
.cts-rail-scroll-button {
  position: absolute; left: 3px; right: 3px; height: 22px; z-index: 3; padding: 0;
  display: flex; align-items: center; justify-content: center; border: 1px solid var(--cts-edge);
  border-radius: var(--cts-radius-sm); background: var(--cts-overlay); color: var(--cts-idle);
  box-shadow: var(--cts-shadow); opacity: 0; pointer-events: none; cursor: pointer; transition: opacity 120ms var(--cts-ease);
}
.cts-rail-scroll-button.cts-up { top: 0; }
.cts-rail-scroll-button.cts-up svg { transform: rotate(180deg); }
.cts-rail-scroll-button.cts-down { bottom: 0; }
.cts-rail-scroll-wrap:hover .cts-rail-scroll-button, .cts-rail-scroll-wrap:focus-within .cts-rail-scroll-button { opacity: 1; pointer-events: auto; }
.cts-rail-scroll-button:hover { color: var(--cts-hover); border-color: var(--cts-accent); }
.cts-rail-scroll-button:focus-visible { outline: 2px solid var(--cts-accent); outline-offset: -2px; }
@media (hover: none) { .cts-rail-scroll-button { opacity: 1; pointer-events: auto; } }

.cts-rail-divider { width: 24px; height: 1px; flex: none; background: var(--cts-edge); margin: 4px 0; }

/* ---- buttons ---- */
.cts-btn {
  position: relative; display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; padding: 0; flex: none;
  background: transparent; color: var(--cts-idle); border: none; border-radius: var(--cts-radius-md);
  cursor: pointer; transition: background-color 150ms var(--cts-ease), color 150ms var(--cts-ease), transform 120ms var(--cts-ease);
}
.cts-btn:hover { color: var(--cts-hover); background: var(--cts-accent-soft); }
.cts-btn:active { transform: scale(0.94); }
.cts-btn:disabled { opacity: 0.35; cursor: default; background: transparent; color: var(--cts-idle); transform: none; }
.cts-btn.cts-open { background: var(--cts-accent-soft); color: var(--cts-hover); }
.cts-btn.cts-on { color: var(--cts-accent); }
.cts-btn.cts-armed { background: var(--cts-accent); color: var(--cts-on-accent); }
.cts-btn:focus-visible, .cts-item:focus-visible, .cts-more:focus-visible { outline: 2px solid var(--cts-accent); outline-offset: 1px; }
.cts-btn-label { font: 500 12px/1 var(--cts-mono); }

/* Center each 44px row, reserving an 8px gutter for the disclosure. */
.cts-rail > .cts-btn, .cts-rail-scroll > .cts-btn, .cts-rail-footer > .cts-btn { left: -4px; }
.cts-caret, .cts-more { color: var(--cts-muted); opacity: 0.6; transition: opacity 150ms var(--cts-ease), color 150ms var(--cts-ease); }
.cts-caret { position: absolute; left: 100%; top: 50%; transform: translateY(-50%); display: flex; width: 8px; height: 36px; align-items: center; justify-content: center; pointer-events: none; }
.cts-btn:hover .cts-caret, .cts-btn.cts-open .cts-caret { color: var(--cts-idle); opacity: 0.9; }
.cts-group { position: relative; flex: none; width: 44px; height: 36px; }
.cts-more {
  position: absolute; right: 0; top: 0; z-index: 1; display: flex; align-items: center; justify-content: center;
  width: 8px; height: 36px; padding: 0; border: none; background: transparent; cursor: pointer;
}
.cts-group:hover .cts-more, .cts-more.cts-open { color: var(--cts-idle); opacity: 0.9; }

/* ---- flyout menus ---- */
.cts-menu {
  position: fixed; z-index: 1000; min-width: min(232px, calc(100vw - 16px)); max-width: calc(100vw - 16px); max-height: calc(100vh - 16px); overflow-y: auto;
  background: var(--cts-panel); border: 1px solid var(--cts-edge); border-radius: var(--cts-radius-md);
  box-shadow: var(--cts-shadow); padding: 4px; display: none;
  animation: cts-fade-in 140ms var(--cts-ease);
}
.cts-menu.cts-open { display: block; }
@keyframes cts-fade-in { from { opacity: 0; } to { opacity: 1; } }
.cts-menu-label { padding: 8px 12px 4px; font-size: 11px; font-weight: 500; letter-spacing: 0.02em; color: var(--cts-muted); }
.cts-menu-sep { height: 1px; background: var(--cts-edge); margin: 4px 8px; }
.cts-item {
  display: flex; align-items: center; gap: 12px; width: 100%; min-height: 32px; padding: 4px 8px 4px 12px;
  background: transparent; border: none; border-radius: var(--cts-radius-sm); color: var(--cts-idle);
  cursor: pointer; text-align: left; white-space: nowrap;
  transition: background-color 120ms var(--cts-ease), color 120ms var(--cts-ease);
}
.cts-item:hover { background: var(--cts-accent-soft); color: var(--cts-hover); }
.cts-item.cts-active { color: var(--cts-accent); }
.cts-item-label { flex: 1; }
.cts-item-meta { font: 11px/1 var(--cts-mono); color: var(--cts-muted); }
.cts-tick { opacity: 0; color: var(--cts-accent); }
.cts-item.cts-active .cts-tick { opacity: 1; }
.cts-fav {
  display: flex; align-items: center; justify-content: center; width: 24px; height: 24px; margin-right: -4px;
  color: var(--cts-muted); border-radius: var(--cts-radius-sm); opacity: 0;
  transition: opacity 120ms var(--cts-ease), color 120ms var(--cts-ease);
}
.cts-item:hover .cts-fav, .cts-fav.cts-on { opacity: 1; }
.cts-fav:hover { color: var(--cts-hover); }
.cts-fav.cts-on { color: var(--cts-favorite); }

/* ---- icon picker ---- */
.cts-picker { width: 312px; padding: 8px; }
.cts-tabs { display: flex; gap: 4px; padding: 0 0 8px; border-bottom: 1px solid var(--cts-edge); margin-bottom: 8px; }
.cts-tab { flex: 1; height: 28px; border: none; border-radius: var(--cts-radius-sm); background: transparent; color: var(--cts-idle); cursor: pointer; }
.cts-tab:hover { color: var(--cts-hover); background: var(--cts-accent-soft); }
.cts-tab.cts-active { background: var(--cts-panel-raised); color: var(--cts-hover); }
.cts-glyphs { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
.cts-glyph {
  height: 32px; border: none; border-radius: var(--cts-radius-sm); background: transparent; cursor: pointer;
  font-size: 20px; line-height: 1; color: var(--cts-hover);
  transition: background-color 120ms var(--cts-ease), transform 120ms var(--cts-ease);
}
.cts-glyph:hover { background: var(--cts-accent-soft); transform: scale(1.12); }

/* ---- overlay on the chart ---- */
.cts-overlay { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
.cts-overlay > * { pointer-events: auto; }
.cts-panel {
  position: absolute; z-index: 25; display: none; align-items: center; gap: 4px; padding: 4px;
  background: var(--cts-overlay); border: 1px solid var(--cts-edge); border-radius: var(--cts-radius-md);
  box-shadow: var(--cts-shadow); backdrop-filter: blur(8px); animation: cts-fade-in 140ms var(--cts-ease);
}
.cts-panel.cts-visible { display: flex; }
.cts-panel > * { flex: none; }
.cts-panel .cts-btn { width: 32px; height: 32px; }
.cts-panel-sep { width: 1px; height: 20px; background: var(--cts-edge); margin: 0 4px; }
.cts-favorites { top: 12px; left: 50%; transform: translateX(-50%); }
.cts-grip { width: 12px; height: 32px; cursor: grab; display: flex; align-items: center; justify-content: center; color: var(--cts-muted); }
.cts-style-shell { position: absolute; top: 12px; left: 12px; z-index: 25; max-width: calc(100% - 24px); display: none; }
.cts-style-shell.cts-visible { display: block; }
/* Compact until the content overflows; then the bottom padding opens to make room for the scrollbar. */
.cts-style-bar {
  position: relative; max-width: 100%; white-space: nowrap; overflow-x: auto; overflow-y: hidden;
  scrollbar-width: none; overscroll-behavior-x: contain; transition: padding-bottom 200ms var(--cts-ease);
}
.cts-overflow > .cts-style-bar { padding-bottom: 14px; }
.cts-style-bar::-webkit-scrollbar { display: none; }
/* The track sits in the bar's bottom padding; it must stack above the bar (a z-indexed panel) to show. */
.cts-style-scroll-track {
  position: absolute; z-index: 26; left: 6px; right: 6px; bottom: 3px; height: 6px; border-radius: 3px;
  background: var(--cts-accent-soft); opacity: 0; pointer-events: none;
  transition: opacity 180ms var(--cts-ease); touch-action: none;
}
.cts-overflow > .cts-style-scroll-track { opacity: 0.45; pointer-events: auto; }
.cts-overflow:hover > .cts-style-scroll-track, .cts-overflow:focus-within > .cts-style-scroll-track { opacity: 1; }
.cts-style-scroll-thumb { height: 100%; border-radius: inherit; background: var(--cts-muted); }
.cts-style-title { padding: 0 8px; font-weight: 500; color: var(--cts-hover); white-space: nowrap; }
.cts-swatch {
  width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0;
  box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.35); transition: transform 120ms var(--cts-ease);
}
.cts-swatch:hover { transform: scale(1.15); }
.cts-swatch.cts-active { border-color: var(--cts-hover); }
.cts-seg {
  height: 28px; min-width: 28px; padding: 0 8px; border: none; border-radius: var(--cts-radius-sm);
  background: transparent; color: var(--cts-idle); cursor: pointer; font: 500 12px/1 var(--cts-mono);
  display: flex; align-items: center; justify-content: center;
}
.cts-seg:hover { background: var(--cts-accent-soft); color: var(--cts-hover); }
.cts-seg.cts-active { background: var(--cts-panel-raised); color: var(--cts-hover); }
.cts-line-sample { width: 20px; height: 0; border-top: 2px solid currentColor; }
.cts-line-sample.cts-dashed { border-top-style: dashed; }
.cts-line-sample.cts-dotted { border-top-style: dotted; }
.cts-editor {
  position: absolute; z-index: 26; display: none; min-width: 160px; min-height: 36px; padding: 8px 12px;
  font: 14px/1.4 var(--cts-font); color: var(--cts-hover); background: var(--cts-panel);
  border: 1px solid var(--cts-accent); border-radius: var(--cts-radius-md); box-shadow: var(--cts-shadow); resize: both; outline: none;
}
.cts-zoom-box { position: absolute; z-index: 5; display: none; pointer-events: none; border: 1px dashed var(--cts-accent); background: var(--cts-accent-soft); }
.cts-hint {
  position: absolute; bottom: 32px; left: 12px; z-index: 4; pointer-events: none;
  padding: 4px 8px; border-radius: var(--cts-radius-sm); background: var(--cts-overlay);
  color: var(--cts-idle); font-size: 12px; border: 1px solid var(--cts-edge); transition: opacity 400ms var(--cts-ease);
  max-width: calc(100% - 24px);
}
.cts-hint b { color: var(--cts-hover); font-weight: 500; }
.cts-hint.cts-quiet { opacity: 0.55; }
.cts-hint.cts-hint-hidden { opacity: 0; }
.cts-scroll {
  position: absolute; top: 50%; transform: translateY(-50%); z-index: 20;
  width: 32px; height: 32px; padding: 0; display: none; align-items: center; justify-content: center;
  background: var(--cts-overlay); border: 1px solid var(--cts-edge); border-radius: var(--cts-radius-md);
  color: var(--cts-idle); cursor: pointer; box-shadow: var(--cts-shadow);
}
.cts-scroll.cts-visible { display: flex; }
.cts-scroll:hover { color: var(--cts-hover); background: var(--cts-accent-soft); border-color: var(--cts-accent); }
.cts-toast {
  position: absolute; left: 50%; bottom: 64px; transform: translateX(-50%); z-index: 30; pointer-events: none;
  padding: 8px 12px; border-radius: var(--cts-radius-md); background: var(--cts-panel); color: var(--cts-hover);
  border: 1px solid var(--cts-edge); box-shadow: var(--cts-shadow); animation: cts-fade-in 140ms var(--cts-ease);
}

/* ---- canvas cursors per mode ---- */
.cts-cursor-cross, .cts-mode-tool { cursor: crosshair; }
.cts-cursor-dot, .cts-cursor-demonstration { cursor: none; }
.cts-cursor-arrow { cursor: default; }
.cts-cursor-eraser { cursor: cell; }
.cts-over-drawing { cursor: pointer; }
.cts-dragging { cursor: grabbing; }

@media (prefers-reduced-motion: reduce) {
  .cts-menu, .cts-panel, .cts-toast { animation: none; }
  .cts-style-bar, .cts-style-scroll-track, .cts-rail-scroll-button, .cts-hint { transition: none; }
}
`;

/** Injects {@link TOOLBAR_CSS} into `doc` once; returns the `<style>` element. */
export function injectStyles(doc: UIDocument): UIElement {
  const existing = doc.head.querySelector(`style[${STYLE_MARKER}]`) as UIElement | null;
  if (existing !== null) return existing;
  const style = doc.createElement('style');
  style.setAttribute(STYLE_MARKER, '');
  style.textContent = TOOLBAR_CSS;
  doc.head.append(style);
  return style;
}
