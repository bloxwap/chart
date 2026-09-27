/**
 * Indicator picker and per-study settings: a searchable catalog of the
 * chart's registered indicators (overlays and oscillators) above the studies
 * already on the chart, and an Inputs / Style / Visibility editor for one
 * instance that applies live and can be cancelled. It reuses the chart
 * settings card's layout (`.cts-settings`) with zero-stroke fills, and like
 * the rest of the UI never touches the global `document`: pass it in.
 *
 * @module
 */

import type { Chart } from '../core/chart.js';
import type { IndicatorConfig } from '../config.js';
import { parseColor, serializeColor, withAlpha } from '../color.js';
import type { ThemeName } from '../themes.js';
import { indicatorStyleLabel } from '../indicators/labels.js';
import type { IndicatorPatch } from '../indicators/style.js';
import {
  indicatorLineKeys,
  indicatorStyleColors,
  resolveIndicatorColors,
  type IndicatorDef,
  type IndicatorInputDef,
} from '../indicators/types.js';
import type { UIDocument, UIElement, UIEvent, UITextInput } from './host.js';
import { el, iconButton, setButtonIcon } from './menu.js';
import { injectStyles } from './styles.js';
import { matchesSettingsSearch } from './settings-search.js';

/** Options for {@link createIndicatorsDialog}. */
export interface IndicatorsDialogOptions {
  chart: Chart;
  document: UIDocument;
  /** UI theme. Default `'dark'`. */
  theme?: ThemeName;
  /** Open a study's settings right after the picker adds it. Default false. */
  settingsOnAdd?: boolean;
  /** Called before the dialog opens, e.g. to close other popovers. */
  onOpen?: () => void;
  /** Called after every change the dialog applies to the chart. */
  onChange?: () => void;
}

/** The dialog created by {@link createIndicatorsDialog}. */
export interface IndicatorsDialog {
  /** The dialog root, appended to the document body. */
  readonly element: UIElement;
  /** The open view, or null while closed. */
  readonly view: 'picker' | 'settings' | null;
  /** Shows the searchable catalog and the studies on the chart. */
  openPicker(): void;
  /** Edits indicator `id`; returns false (changing nothing) when the chart has no such indicator. */
  openSettings(id: string): boolean;
  /** Closes the dialog, keeping settings changes (like OK). */
  close(): void;
  /**
   * Re-reads the chart: the picker relists the studies on the chart, open
   * settings resync their controls, and settings whose study was removed
   * leave (back to the picker they were opened from, else closed). The
   * dialog already does this once any indicator or series change renders
   * (see `Chart.subscribeConfigChange`), whoever made it, and open settings
   * then rewrite their controls only when their study or the candle colors
   * changed, so a value being typed survives edits to other studies. Call
   * it only inside a `chart.batch`, or after editing indicator configs in place.
   */
  refresh(): void;
  /**
   * Restyles the dialog and {@link refresh}es it, so candle-following colors
   * in open settings match the chart. Call it after the chart takes the
   * theme's colors (e.g. after the toolbar's `setTheme`).
   */
  setTheme(theme: ThemeName): void;
  /** Closes the dialog and removes it and its document listeners. */
  destroy(): void;
}

/** The parts of a definition the dialog reads (an unregistered instance gets one derived from its config). */
type StudyDef = Pick<IndicatorDef, 'name' | 'defaultParams' | 'defaultColors' | 'defaultPane' | 'label' | 'shortName' | 'inputs' | 'styles'>;

/**
 * One row of a study's Style section: every style entry sharing a key, so
 * one visibility toggle and one width control drive the plot while each
 * entry keeps its own color (MACD histogram, VOL, Supertrend, Kumo).
 */
export interface IndicatorStyleGroup {
  /** The `hiddenLines` key, or null for definitions without style metadata. */
  readonly key: string | null;
  readonly label: string;
  /** One color control per entry: its label and index into `IndicatorConfig.colors`. */
  readonly colors: readonly { readonly label: string; readonly colorIndex: number }[];
  /** Index into `IndicatorConfig.lineWidths`, or null for plots without a stroke width. */
  readonly widthIndex: number | null;
}

/** Marker attribute on the injected dialog `<style>` element. */
export const INDICATORS_DIALOG_STYLE_MARKER = 'data-chart-ts-ui-indicators';

/** Dialog styles layered over the settings card's: zero-stroke fills, hover shifts the fill. */
export const INDICATORS_DIALOG_CSS = `
.cts-settings.cts-ind-dialog { border: 0; }
.cts-settings.cts-ind-dialog:focus { outline: none; }
.cts-ind-dialog .cts-settings-head { justify-content: flex-start; gap: 8px; }
.cts-ind-heading { flex: 1; min-width: 0; }
.cts-ind-heading h2 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cts-ind-dialog .cts-settings-head .cts-btn { width: 32px; height: 32px; }
.cts-ind-dialog .cts-settings-search { border: 0; background: var(--cts-panel-raised); transition: background-color 120ms var(--cts-ease); }
.cts-ind-dialog .cts-settings-search:hover, .cts-ind-dialog .cts-settings-search:focus-within { background: var(--cts-accent-soft); }
.cts-ind-dialog .cts-settings-nav, .cts-ind-dialog .cts-settings-footer { border: 0; }
.cts-ind-dialog .cts-settings-section + .cts-settings-section { border-top: 0; margin-top: 4px; }
.cts-ind-dialog .cts-settings-select, .cts-ind-dialog .cts-settings-input { border: 0; background: var(--cts-panel-raised); transition: background-color 120ms var(--cts-ease); }
.cts-ind-dialog .cts-settings-select:hover, .cts-ind-dialog .cts-settings-input:hover, .cts-ind-dialog .cts-settings-input:focus { background: var(--cts-accent-soft); }
.cts-ind-dialog .cts-settings-select:disabled { opacity: .4; }
.cts-ind-width { flex: none; width: 72px; }
.cts-ind-dialog .cts-ind-pane { width: auto; max-width: 100%; }
.cts-ind-color { position: relative; display: block; flex: none; width: 32px; height: 32px; padding: 5px; border-radius: 7px; background: var(--cts-panel-raised); cursor: pointer; transition: background-color 120ms var(--cts-ease); }
.cts-ind-color:hover { background: var(--cts-accent-soft); }
.cts-ind-color:focus-within { outline: 2px solid var(--cts-accent); outline-offset: 2px; }
.cts-ind-chip { display: block; width: 100%; height: 100%; border-radius: 4px; }
.cts-ind-color input { position: absolute; inset: 0; width: 100%; height: 100%; padding: 0; border: 0; opacity: 0; cursor: pointer; }
.cts-ind-color.cts-disabled { opacity: .3; }
.cts-ind-color.cts-disabled input { cursor: default; }
.cts-ind-option { min-height: 40px; color: var(--cts-hover); }
.cts-ind-active { display: flex; align-items: center; gap: 2px; min-height: 44px; margin-bottom: 6px; padding: 4px 4px 4px 12px; border-radius: 8px; background: var(--cts-panel-raised); transition: background-color 120ms var(--cts-ease); }
.cts-ind-active:hover { background: var(--cts-accent-soft); }
.cts-ind-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--cts-hover); font: 12px/1.4 var(--cts-mono); }
.cts-ind-off .cts-ind-name { opacity: .45; }
.cts-ind-tag { flex: none; margin-right: 4px; padding: 3px 6px; border-radius: 4px; background: var(--cts-panel); color: var(--cts-muted); font-size: 11px; }
.cts-ind-active .cts-btn { width: 32px; height: 32px; }
.cts-ind-actions { display: flex; gap: 8px; margin-left: auto; }
.cts-ind-dialog .cts-settings-reset { border: 0; background: var(--cts-panel-raised); transition: background-color 120ms var(--cts-ease), color 120ms var(--cts-ease); }
.cts-ind-dialog .cts-settings-reset:hover { background: var(--cts-accent-soft); color: var(--cts-hover); }
.cts-ind-dialog .cts-settings-done { border: 0; transition: filter 120ms var(--cts-ease); }
.cts-ind-dialog .cts-settings-done:hover { filter: brightness(1.12); }
`;

/** Line width choices, in CSS pixels. */
const WIDTHS: readonly number[] = [1, 2, 3, 4];

interface Control extends UITextInput { checked: boolean; disabled: boolean }
/** A focusable control as returned by `querySelectorAll`. */
interface Item extends UIElement { disabled?: boolean; click(): void; closest(selectors: string): unknown }
interface DialogRoot extends UIElement { querySelectorAll(selectors: string): ArrayLike<Item> }
interface SearchGroup { element: UIElement; rows: { element: UIElement; fields: string[] }[] }

/** `'smoothK'` → `'Smooth K'`, `'my-study'` → `'My study'`. */
function humanize(key: string): string {
  const words = key.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/[-_]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function titleOf(def: StudyDef): string {
  return def.label ?? def.shortName ?? humanize(def.name);
}

function shortOf(def: StudyDef): string {
  return def.shortName ?? def.label ?? humanize(def.name);
}

/** `#rrggbb` for a color input; unparseable colors show black. */
function hexOf(color: string): string {
  const parsed = parseColor(color);
  const channels = parsed === null ? [0, 0, 0] : [parsed.r, parsed.g, parsed.b].map((c) => (parsed.space === 'display-p3' ? c * 255 : c));
  return '#' + channels.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
}

/**
 * A definition's editable inputs: its `inputs` metadata, else one plain
 * number field per `defaultParams` key (custom indicators).
 */
export function indicatorInputs(def: Pick<IndicatorDef, 'inputs' | 'defaultParams'>): readonly IndicatorInputDef[] {
  return def.inputs ?? Object.keys(def.defaultParams).map((key) => ({ key, label: humanize(key) }));
}

/**
 * A definition's Style rows: its `styles` grouped by key in display order,
 * else one "Plot n" row per default color whose width follows the output
 * line order (custom indicators).
 */
export function indicatorStyleGroups(def: Pick<IndicatorDef, 'styles' | 'defaultColors'>): IndicatorStyleGroup[] {
  if (def.styles === undefined) {
    return def.defaultColors.map((_, i) => ({ key: null, label: `Plot ${i + 1}`, colors: [{ label: `Plot ${i + 1}`, colorIndex: i }], widthIndex: i }));
  }
  const lineKeys = indicatorLineKeys(def);
  const keys = [...new Set(def.styles.map((style) => style.key))];
  return keys.map((key) => {
    const styles = def.styles!.filter((style) => style.key === key);
    const width = lineKeys.indexOf(key);
    return {
      key,
      label: indicatorStyleLabel(styles.map((style) => style.label)),
      colors: styles.map((style) => ({ label: style.label, colorIndex: style.colorIndex })),
      widthIndex: width < 0 ? null : width,
    };
  });
}

let sequence = 0;

/**
 * Creates the indicator dialog, hidden until {@link IndicatorsDialog.openPicker}
 * or {@link IndicatorsDialog.openSettings}. Every edit applies live through
 * `chart.updateIndicator`; Cancel or Escape in settings restores the
 * instance as it was when its settings opened and returns to the picker it
 * came from; the close button restores it and closes the dialog.
 */
export function createIndicatorsDialog(options: IndicatorsDialogOptions): IndicatorsDialog {
  const { chart, document: doc } = options;
  injectStyles(doc);
  if (doc.head.querySelector(`style[${INDICATORS_DIALOG_STYLE_MARKER}]`) === null) {
    const style = doc.createElement('style');
    style.setAttribute(INDICATORS_DIALOG_STYLE_MARKER, '');
    style.textContent = INDICATORS_DIALOG_CSS;
    doc.head.append(style);
  }
  const id = `cts-indicators-${++sequence}`;
  const root = el(doc, 'section', 'cts-theme cts-settings cts-ind-dialog') as DialogRoot;
  root.setAttribute('id', id);
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-labelledby', `${id}-title`);
  root.setAttribute('aria-describedby', `${id}-hint`);
  // Focusable itself, so a finger's open can focus the dialog rather than a field (see focusField).
  root.setAttribute('tabindex', '-1');
  root.setAttribute('hidden', '');
  root.style.display = 'none';
  const head = el(doc, 'header', 'cts-settings-head');
  const back = iconButton(doc, 'chevron-left', 'Back to indicators', 20);
  back.setAttribute('aria-label', 'Back to indicators');
  const heading = el(doc, 'div', 'cts-ind-heading');
  const title = el(doc, 'h2');
  title.setAttribute('id', `${id}-title`);
  const hint = el(doc, 'p');
  hint.setAttribute('id', `${id}-hint`);
  heading.append(title, hint);
  const closeButton = iconButton(doc, 'x', 'Close', 20);
  closeButton.setAttribute('aria-label', 'Close');
  head.append(back, heading, closeButton);
  const searchBar = el(doc, 'div', 'cts-settings-search');
  const search = el(doc, 'input', 'cts-settings-search-input') as UITextInput;
  for (const [name, value] of [['type', 'search'], ['aria-label', 'Search indicators'], ['autocomplete', 'off'], ['autocapitalize', 'off'],
    ['spellcheck', 'false'], ['maxlength', '100'], ['aria-controls', `${id}-body`]]) search.setAttribute(name, value);
  search.placeholder = 'Search indicators…';
  const clearSearchButton = iconButton(doc, 'x', 'Clear search', 16);
  clearSearchButton.setAttribute('aria-label', 'Clear search');
  searchBar.append(search, clearSearchButton);
  const status = el(doc, 'span', 'cts-settings-search-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const nav = el(doc, 'nav', 'cts-settings-nav');
  nav.setAttribute('aria-label', 'Indicator settings sections');
  const body = el(doc, 'div', 'cts-settings-body');
  body.setAttribute('id', `${id}-body`);
  const empty = el(doc, 'div', 'cts-settings-empty');
  empty.append(el(doc, 'p', '', 'No indicators found'), el(doc, 'small', '', 'Try “RSI”, “Ichimoku” or “bands”.'));
  const footer = el(doc, 'footer', 'cts-settings-footer');
  root.append(head, searchBar, status, nav, body, footer);
  doc.body.append(root);

  let view: 'picker' | 'settings' | null = null;
  let fromPicker = false;
  let returnFocus: unknown = null;
  let groups: SearchGroup[] = [];
  let active: SearchGroup = { element: el(doc, 'section'), rows: [] };
  let editing = '';
  let snapshot: IndicatorPatch = {};
  /** Resyncs the open settings' controls from the chart. */
  let resync: () => void;
  /** Whether the open settings' study or the candle colors changed since their controls were last synced. */
  let settingsStale: () => boolean;
  /** Whether the last press was a finger (reset by any key). */
  let finger = false;
  /** Each "On chart" row's settings, visibility and remove buttons by study id, to keep focus across rebuilds. */
  let rowControls = new Map<string, readonly UIElement[]>();
  /** What the "On chart" list shows (see {@link activeKey}), so a change elsewhere rebuilds only a stale list. */
  let shownActive = '';

  const notify = (): void => options.onChange?.();
  /**
   * Focuses `field`, or the dialog itself after a finger press: focusing a
   * field from a tap raises the on-screen keyboard over the dialog (iOS).
   */
  const focusField = (field: UIElement): void => (finger ? root : field).focus();
  const show = (element: UIElement, visible: boolean): void => {
    if (visible) element.removeAttribute('hidden');
    else element.setAttribute('hidden', '');
  };
  const shown = (item: Item): boolean => item.closest('[hidden]') === null;
  const visibleOptions = (): Item[] => Array.from(root.querySelectorAll('.cts-ind-option')).filter(shown);
  const studyOf = (cfg: IndicatorConfig): StudyDef => chart.indicators.get(cfg.name)
    ?? { name: cfg.name, defaultParams: { ...cfg.params }, defaultColors: [...cfg.colors], defaultPane: cfg.pane };
  const paramOf = (def: StudyDef, cfg: IndicatorConfig, key: string): number => cfg.params[key] ?? def.defaultParams[key];
  /** "MACD 12 26 9": the short name and each input's value (or option label). */
  const summary = (def: StudyDef, cfg: IndicatorConfig): string => [shortOf(def), ...indicatorInputs(def).map((input) => {
    const value = paramOf(def, cfg, input.key);
    return input.options?.find((option) => option.value === value)?.label ?? String(value);
  })].join(' ');

  function button(text: string, className: string, onClick: () => void): UIElement {
    const node = el(doc, 'button', className);
    node.textContent = text;
    node.setAttribute('type', 'button');
    node.addEventListener('click', onClick);
    return node;
  }

  function section(text: string): UIElement {
    const block = el(doc, 'section', 'cts-settings-section');
    block.setAttribute('aria-label', text);
    block.append(el(doc, 'h3', '', text));
    body.append(block);
    return block;
  }

  function row(parent: UIElement, text: string): { row: UIElement; caption: UIElement; label: UIElement } {
    const wrapper = el(doc, 'div', 'cts-settings-row');
    const caption = el(doc, 'div', 'cts-settings-caption');
    const label = el(doc, 'label');
    label.textContent = text;
    caption.append(label);
    wrapper.append(caption);
    parent.append(wrapper);
    return { row: wrapper, caption, label };
  }

  function reset(heading: string, description: string): void {
    title.textContent = heading;
    hint.textContent = description;
    nav.replaceChildren();
    body.replaceChildren();
    footer.replaceChildren();
    body.scrollTop = 0;
  }

  // ---------------------------------------------------------------- picker

  function filter(): void {
    const query = search.value.trim();
    let found = 0;
    let onChart = 0;
    for (const group of groups) {
      let visible = false;
      for (const item of group.rows) {
        const match = matchesSettingsSearch(query, item.fields);
        show(item.element, match);
        visible ||= match;
        if (!match) continue;
        if (group === active) onChart++;
        else found++;
      }
      show(group.element, visible);
    }
    show(empty, found + onChart === 0);
    show(clearSearchButton, search.value.length > 0);
    const catalog = `${found} ${found === 1 ? 'indicator' : 'indicators'}`;
    status.textContent = query === '' ? '' : onChart > 0 ? `${onChart} on chart, ${catalog} to add.` : `${catalog} found.`;
  }

  function clearSearch(): void {
    search.value = '';
    filter();
  }

  /** The "On chart" list's content: each study's id, summary, title, pane and visibility. */
  function activeKey(): string {
    return chart.getConfig().indicators.map((cfg) => {
      const def = studyOf(cfg);
      return [cfg.id, summary(def, cfg), titleOf(def), cfg.pane, cfg.visible].join('\u0000');
    }).join('\u0001');
  }

  /** Rebuilds the "On chart" list unless it already shows the chart's studies. */
  function relist(): void {
    if (activeKey() !== shownActive) renderActive();
  }

  function renderActive(): void {
    // Focus stays on the same button of the same study; a study removed from under it hands focus to the search.
    const focused = doc.activeElement;
    let keep: { readonly id: string; readonly index: number } | null = null;
    for (const [cfgId, controls] of rowControls) {
      const index = controls.indexOf(focused as UIElement);
      if (index >= 0) keep = { id: cfgId, index };
    }
    shownActive = activeKey();
    rowControls = new Map();
    active.element.replaceChildren(el(doc, 'h3', '', 'On chart'));
    active.rows = [];
    for (const cfg of chart.getConfig().indicators) {
      const def = studyOf(cfg);
      const name = summary(def, cfg);
      const line = el(doc, 'div', 'cts-ind-active');
      line.setAttribute('data-id', cfg.id);
      const label = el(doc, 'span', 'cts-ind-name');
      label.textContent = name;
      label.title = titleOf(def);
      const tag = el(doc, 'span', 'cts-ind-tag', cfg.pane === 'main' ? 'Overlay' : 'Pane');
      const settings = iconButton(doc, 'settings', `Settings: ${name}`, 18);
      settings.classList.add('cts-ind-settings');
      settings.setAttribute('aria-label', settings.title);
      // An instance removed elsewhere just drops out of the list.
      settings.addEventListener('click', () => { if (!edit(cfg.id, true)) relist(); });
      const eye = iconButton(doc, 'eye', '', 18);
      eye.classList.add('cts-ind-visibility');
      const setEye = (visible: boolean): void => {
        setButtonIcon(eye, visible ? 'eye' : 'eye-off', 18);
        eye.title = `${visible ? 'Hide' : 'Show'} ${name}`;
        eye.setAttribute('aria-label', eye.title);
        line.classList.toggle('cts-ind-off', !visible);
      };
      setEye(cfg.visible);
      eye.addEventListener('click', () => {
        // The API may have changed or removed the study since this row was built.
        const current = chart.getIndicator(cfg.id);
        if (current === undefined) {
          relist();
          return;
        }
        const visible = !current.visible;
        chart.updateIndicator(cfg.id, { visible });
        notify();
        setEye(visible);
      });
      const remove = iconButton(doc, 'trash', `Remove ${name}`, 18);
      remove.classList.add('cts-ind-remove');
      remove.setAttribute('aria-label', remove.title);
      remove.addEventListener('click', () => {
        // A study removed elsewhere just drops out of the list.
        const removed = chart.removeIndicator(cfg.id);
        relist();
        if (removed) {
          notify();
          status.textContent = `Removed ${name}.`;
        }
        focusField(search);
      });
      line.append(label, tag, settings, eye, remove);
      active.element.append(line);
      active.rows.push({ element: line, fields: [name, titleOf(def), def.name] });
      rowControls.set(cfg.id, [settings, eye, remove]);
    }
    filter();
    if (keep !== null) {
      const control = rowControls.get(keep.id)?.[keep.index];
      if (control !== undefined) control.focus();
      else focusField(search);
    }
  }

  function add(name: string): void {
    const def = chart.indicators.get(name)!;
    const added = chart.addIndicator({ name });
    notify();
    if (options.settingsOnAdd === true) {
      edit(added, true);
      return;
    }
    relist();
    status.textContent = `Added ${titleOf(def)}.`;
  }

  function buildPicker(): void {
    view = 'picker';
    reset('Indicators', 'Search and add studies. Changes apply live.');
    show(back, false);
    show(searchBar, true);
    show(nav, false);
    active = { element: el(doc, 'section', 'cts-settings-section'), rows: [] };
    active.element.setAttribute('aria-label', 'On chart');
    body.append(active.element);
    groups = [active];
    for (const [pane, heading] of [['main', 'Overlays'], ['sub', 'Oscillators']] as const) {
      const group: SearchGroup = { element: section(heading), rows: [] };
      for (const name of chart.indicators.names()) {
        const def = chart.indicators.get(name)!;
        if (def.defaultPane !== pane) continue;
        const option = el(doc, 'button', 'cts-item cts-ind-option');
        option.setAttribute('type', 'button');
        option.setAttribute('data-indicator', name);
        option.title = `Add ${titleOf(def)}`;
        const short = shortOf(def);
        const label = el(doc, 'span', 'cts-item-label');
        label.textContent = titleOf(def);
        const meta = el(doc, 'span', 'cts-item-meta');
        meta.textContent = short === titleOf(def) ? '' : short;
        option.append(label, meta);
        option.addEventListener('click', () => add(name));
        group.element.append(option);
        group.rows.push({ element: option, fields: [titleOf(def), short, name, heading] });
      }
      groups.push(group);
    }
    body.append(empty);
    const actions = el(doc, 'div', 'cts-ind-actions');
    actions.append(button('Done', 'cts-settings-done', close));
    footer.append(actions);
    renderActive();
  }

  // ---------------------------------------------------------------- settings

  function buildSettings(cfgId: string): void {
    const cfg = chart.getIndicator(cfgId)!;
    const def = studyOf(cfg);
    editing = cfgId;
    // Effective params, so Cancel also reverts keys the config left to the defaults.
    snapshot = {
      params: { ...def.defaultParams, ...cfg.params }, colors: [...cfg.colors], lineWidths: [...cfg.lineWidths],
      hiddenLines: [...cfg.hiddenLines], pane: cfg.pane, visible: cfg.visible,
    };
    view = 'settings';
    reset(titleOf(def), 'Inputs, style and visibility apply live.');
    show(back, fromPicker);
    show(searchBar, false);
    show(nav, true);
    const syncers: (() => void)[] = [];
    const live = () => chart.getIndicator(cfgId)!;
    /** What the controls show: the study's config and the candle colors its up / down plots follow. */
    const shownKey = (): string => {
      const { params, colors, lineWidths, hiddenLines, pane, visible } = live();
      const { upColor, downColor } = chart.getConfig().series;
      return JSON.stringify([params, colors, lineWidths, hiddenLines, pane, visible, upColor, downColor]);
    };
    let shown = '';
    const sync = (): void => {
      shown = shownKey();
      for (const syncer of syncers) syncer();
    };
    resync = sync;
    settingsStale = () => shownKey() !== shown;
    /** Wraps a control handler: a study removed elsewhere while its settings are open leaves them instead. */
    const guard = (handler: () => void) => (): void => {
      if (chart.getIndicator(cfgId) === undefined) leave();
      else handler();
    };
    const apply = (patch: IndicatorPatch): void => {
      chart.updateIndicator(cfgId, patch);
      notify();
      sync();
    };
    const control = (tag: string, className: string, name: string, line?: { label: UIElement }): Control => {
      const node = el(doc, tag, className) as Control;
      node.setAttribute('name', name);
      if (line !== undefined) {
        node.setAttribute('id', `${id}-${name}`);
        line.label.setAttribute('for', `${id}-${name}`);
      }
      return node;
    };
    const tab = (block: UIElement, text: string): void => {
      const jump = button(text, 'cts-settings-tab', () => {
        body.scrollTop += block.getBoundingClientRect().top - body.getBoundingClientRect().top - 16;
        focusField(block.querySelector('input, select') as UIElement);
      });
      nav.append(jump);
    };

    const inputs = indicatorInputs(def);
    if (inputs.length > 0) {
      const block = section('Inputs');
      tab(block, 'Inputs');
      for (const input of inputs) {
        const line = row(block, input.label);
        const read = (): string => String(paramOf(def, live(), input.key));
        if (input.options !== undefined) {
          const select = control('select', 'cts-settings-select', `input-${input.key}`, line);
          for (const option of input.options) {
            const node = el(doc, 'option');
            node.setAttribute('value', String(option.value));
            node.textContent = option.label;
            select.append(node);
          }
          syncers.push(() => { select.value = read(); });
          select.addEventListener('change', guard(() => apply({ params: { [input.key]: Number(select.value) } })));
          line.row.append(select);
          continue;
        }
        const field = control('input', 'cts-settings-input', `input-${input.key}`, line);
        field.setAttribute('type', 'number');
        field.setAttribute('inputmode', input.integer === true ? 'numeric' : 'decimal');
        field.setAttribute('step', input.step !== undefined ? String(input.step) : input.integer === true ? '1' : 'any');
        if (input.min !== undefined) field.setAttribute('min', String(input.min));
        if (input.max !== undefined) field.setAttribute('max', String(input.max));
        syncers.push(() => { field.value = read(); });
        field.addEventListener('change', guard(() => {
          const value = Number(field.value);
          if (field.value.trim() === '' || !Number.isFinite(value)) {
            field.value = read();
            return;
          }
          const whole = input.integer === true ? Math.round(value) : value;
          apply({ params: { [input.key]: Math.min(input.max ?? Infinity, Math.max(input.min ?? -Infinity, whole)) } });
        }));
        line.row.append(field);
      }
    }

    const styleGroups = indicatorStyleGroups(def);
    if (styleGroups.length > 0) {
      const block = section('Style');
      tab(block, 'Style');
      // Rows read [visible] label … colors [width]; plots without a width keep its slot so colors align.
      const widthSlot = styleGroups.some((group) => group.widthIndex !== null);
      for (const group of styleGroups) {
        const line = row(block, group.label);
        const key = group.key;
        const hidden = (): boolean => key !== null && live().hiddenLines.includes(key);
        if (key !== null) {
          const check = control('input', 'cts-settings-check', `visible-${key}`, line);
          check.setAttribute('type', 'checkbox');
          syncers.push(() => { check.checked = !hidden(); });
          check.addEventListener('change', guard(() => {
            const rest = live().hiddenLines.filter((k) => k !== key);
            apply({ hiddenLines: check.checked ? rest : [...rest, key] });
          }));
          line.caption.before(check);
        }
        const swatches = el(doc, 'div', 'cts-settings-colors');
        for (const { label, colorIndex } of group.colors) {
          const swatch = el(doc, 'label', 'cts-ind-color');
          const chip = el(doc, 'span', 'cts-ind-chip');
          const input = control('input', '', `color-${colorIndex}`);
          input.setAttribute('type', 'color');
          input.setAttribute('aria-label', `${label} color`);
          const stored = (): string[] => indicatorStyleColors(def, live().colors);
          const current = (): string => {
            const { upColor, downColor } = chart.getConfig().series;
            return resolveIndicatorColors(stored(), upColor, downColor)[colorIndex] ?? '';
          };
          syncers.push(() => {
            const color = current();
            input.value = hexOf(color);
            // Opaque, so a faint fill (Kumo, band fills) still reads; the title keeps the alpha.
            chip.style.background = withAlpha(color, 1);
            swatch.title = `${label}: ${color}`;
            input.disabled = hidden();
            swatch.classList.toggle('cts-disabled', input.disabled);
          });
          input.addEventListener('input', guard(() => {
            // A color input yields #rrggbb; keep a translucent plot (Kumo, band fills) translucent.
            const picked = parseColor(input.value);
            const previous = parseColor(current());
            const colors = stored();
            colors[colorIndex] = picked !== null && previous !== null && previous.a < 1 ? serializeColor({ ...picked, a: previous.a }) : input.value;
            apply({ colors });
          }));
          swatch.append(chip, input);
          swatches.append(swatch);
        }
        line.row.append(swatches);
        const widthIndex = group.widthIndex;
        if (widthIndex !== null) {
          const select = control('select', 'cts-settings-select cts-ind-width', `width-${widthIndex}`);
          select.setAttribute('aria-label', `${group.label} line width`);
          const width = (): number => {
            const value = live().lineWidths[widthIndex] ?? 0;
            return value > 0 && Number.isFinite(value) ? value : 1;
          };
          syncers.push(() => {
            const value = width();
            select.replaceChildren(...[...new Set([...WIDTHS, value])].sort((a, b) => a - b).map((w) => {
              const option = el(doc, 'option', '', `${w}px`);
              option.setAttribute('value', String(w));
              return option;
            }));
            select.value = String(value);
            select.disabled = hidden();
          });
          select.addEventListener('change', guard(() => {
            const widths = [...live().lineWidths];
            while (widths.length < widthIndex) widths.push(0);
            widths[widthIndex] = Number(select.value);
            apply({ lineWidths: widths });
          }));
          line.row.append(select);
        } else if (widthSlot) line.row.append(el(doc, 'span', 'cts-ind-width'));
      }
    }

    const visibility = section('Visibility');
    tab(visibility, 'Visibility');
    const paneLine = row(visibility, 'Pane');
    const pane = control('select', 'cts-settings-select cts-ind-pane', 'pane', paneLine);
    for (const [value, text] of [['main', 'Main chart (overlay)'], ['sub', 'Separate pane']]) {
      const option = el(doc, 'option', '', text);
      option.setAttribute('value', value);
      pane.append(option);
    }
    syncers.push(() => { pane.value = live().pane; });
    pane.addEventListener('change', guard(() => apply({ pane: pane.value as 'main' | 'sub' })));
    paneLine.row.append(pane);
    const visibleLine = row(visibility, 'Show on chart');
    const visible = control('input', 'cts-settings-check', 'visible', visibleLine);
    visible.setAttribute('type', 'checkbox');
    syncers.push(() => { visible.checked = live().visible; });
    visible.addEventListener('change', guard(() => apply({ visible: visible.checked })));
    visibleLine.row.append(visible);

    const actions = el(doc, 'div', 'cts-ind-actions');
    actions.append(button('Cancel', 'cts-settings-reset', cancel), button('OK', 'cts-settings-done', leave));
    footer.append(button('Defaults', 'cts-settings-reset', guard(() => apply({
      params: { ...def.defaultParams }, colors: [...def.defaultColors], lineWidths: [], hiddenLines: [], pane: def.defaultPane,
    }))), actions);
    sync();
  }

  /** OK: back to the picker when settings were opened from it, else closed. */
  function leave(): void {
    if (fromPicker) openPicker();
    else close();
  }

  /** Puts the edited instance back as it was when its settings opened (unless it was removed meanwhile). */
  function restore(): void {
    if (chart.updateIndicator(editing, snapshot)) notify();
  }

  /** Cancel: restores the instance, then leaves. */
  function cancel(): void {
    restore();
    leave();
  }

  // ---------------------------------------------------------------- open / close

  function open(): void {
    if (view !== null) return;
    options.onOpen?.();
    returnFocus = (doc as { activeElement?: unknown }).activeElement;
    root.style.display = 'flex';
    root.removeAttribute('hidden');
    root.setAttribute('aria-modal', 'true');
  }

  function openPicker(): void {
    open();
    search.value = '';
    buildPicker();
    focusField(search);
  }

  /** Opens the settings of `cfgId`; false when the chart has no such indicator. */
  function edit(cfgId: string, picker: boolean): boolean {
    if (chart.getIndicator(cfgId) === undefined) return false;
    // Already editing it (a second legend click): keep the edits and what Cancel restores.
    if (view !== 'settings' || editing !== cfgId) {
      open();
      fromPicker = picker;
      buildSettings(cfgId);
    }
    focusField(root.querySelector('.cts-settings-body input, .cts-settings-body select') as UIElement);
    return true;
  }

  function close(): void {
    if (view === null) return;
    view = null;
    root.style.display = 'none';
    root.setAttribute('hidden', '');
    root.removeAttribute('aria-modal');
    const target = returnFocus as { focus?: unknown } | null | undefined;
    returnFocus = null;
    if (typeof target?.focus === 'function') (target as { focus(): void }).focus();
  }

  /** Escape: cancels settings, else clears the search, else closes. */
  function dismiss(): void {
    if (view === 'settings') cancel();
    else if (search.value !== '') {
      clearSearch();
      search.focus();
    } else close();
  }

  function keyboard(event: UIEvent): void {
    event.stopPropagation();
    finger = false;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
    } else if (event.key === 'Tab') {
      // Keep focus inside the dialog.
      const items = Array.from(root.querySelectorAll('button, input, select')).filter((item) => item.disabled !== true && shown(item));
      const edge = event.shiftKey === true ? items[0] : items[items.length - 1];
      // The dialog itself (focused after a finger open) wraps too, rather than letting Shift+Tab out.
      if (event.target === edge || event.target === root) {
        event.preventDefault();
        (event.shiftKey === true ? items[items.length - 1] : items[0]).focus();
      }
    } else if (view === 'picker' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const list: UIElement[] = [search, ...visibleOptions()];
      const at = list.indexOf(event.target as UIElement);
      if (at < 0) return;
      event.preventDefault();
      list[Math.max(0, Math.min(list.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))].focus();
    } else if (event.key === 'Enter' && event.target === search && search.value.trim() !== '') {
      const first = visibleOptions()[0];
      if (first === undefined) return;
      event.preventDefault();
      first.click();
    }
  }

  const outside = (event: UIEvent): void => {
    finger = event.pointerType === 'touch';
    if (view === 'picker' && !root.contains(event.target)) close();
  };
  const escape = (event: UIEvent): void => {
    finger = false;
    if (view !== null && event.key === 'Escape') {
      event.preventDefault();
      dismiss();
    }
  };
  function refresh(): void {
    if (view === 'picker') relist();
    else if (view === 'settings') {
      if (chart.getIndicator(editing) === undefined) leave();
      else resync();
    }
  }
  /** A rendered change: like {@link refresh}, but settings still showing their study as it is keep what is being typed. */
  function follow(): void {
    if (view === 'settings' && chart.getIndicator(editing) !== undefined && !settingsStale()) return;
    refresh();
  }

  const setTheme = (theme: ThemeName): void => {
    root.classList.toggle('cts-light', theme === 'light');
    refresh();
  };

  back.addEventListener('click', () => openPicker());
  // Closing settings discards their changes, as in TradingView, and closes the dialog even from the picker.
  closeButton.addEventListener('click', () => {
    if (view === 'settings') restore();
    close();
  });
  clearSearchButton.addEventListener('click', () => {
    clearSearch();
    search.focus();
  });
  search.addEventListener('input', filter);
  root.addEventListener('keydown', keyboard);
  doc.addEventListener('pointerdown', outside);
  doc.addEventListener('keydown', escape);
  // Studies added, changed or removed anywhere (the API, the context menu, the toolbar) show once they
  // render, and a candle recolor reaches the colors that follow the series.
  const unsubscribe = chart.subscribeConfigChange(({ keys }) => {
    if (keys.includes('indicators') || keys.includes('series')) follow();
  });
  setTheme(options.theme ?? 'dark');

  return {
    element: root,
    get view() { return view; },
    openPicker,
    openSettings: (target: string): boolean => edit(target, false),
    close,
    refresh,
    setTheme,
    destroy(): void {
      close();
      unsubscribe();
      doc.removeEventListener('pointerdown', outside);
      doc.removeEventListener('keydown', escape);
      root.remove();
    },
  };
}
