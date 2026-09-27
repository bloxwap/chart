/** A single, live chart-settings card, opened by a host's settings button. */
import type { Chart } from '../core/chart.js';
import { mergeDeep, type ChartConfig, type DeepPartial, type PriceScaleMode } from '../config.js';
import { parseColor } from '../color.js';
import { CHART_THEMES, type ThemeName } from '../themes.js';
import type { UIDocument, UIElement, UIEvent, UITextInput } from './host.js';
import { el, iconButton } from './menu.js';
import { injectStyles } from './styles.js';
import { matchesSettingsSearch } from './settings-search.js';

interface Control extends UITextInput { checked: boolean; disabled: boolean }
interface SearchRow { element: UIElement; fields: string[] }
interface SearchGroup { element: UIElement; fields: string[]; rows: SearchRow[]; groups: SearchGroup[] }

export interface ChartSettingsOptions {
  chart: Chart;
  document: UIDocument;
  trigger: UIElement;
  theme?: ThemeName;
  /** Optional host controls, appended inside the same card. */
  extraContent?: UIElement;
  onOpen?: () => void;
  onChange?: () => void;
}

export interface ChartSettings {
  readonly element: UIElement;
  open(): void;
  close(): void;
  toggle(): void;
  setTheme(theme: ThemeName): void;
  destroy(): void;
}

let sequence = 0;

/** Builds controls from the chart's resolved config; every change redraws immediately. */
export function createChartSettings(options: ChartSettingsOptions): ChartSettings {
  const { chart, document: doc, trigger } = options;
  injectStyles(doc);
  const id = `cts-settings-${++sequence}`;
  const root = el(doc, 'section', 'cts-theme cts-settings');
  root.setAttribute('id', id);
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Chart settings');
  root.setAttribute('hidden', '');
  root.style.display = 'none';
  trigger.setAttribute('aria-label', 'Chart settings');
  trigger.setAttribute('aria-haspopup', 'dialog');
  trigger.setAttribute('aria-controls', id);
  trigger.setAttribute('aria-expanded', 'false');
  const initial = chart.getConfig();
  const defaults: DeepPartial<ChartConfig> = mergeDeep({
    series: {
      colorByPreviousClose: initial.series.colorByPreviousClose,
      bodyVisible: initial.series.bodyVisible, borderVisible: initial.series.borderVisible, wickVisible: initial.series.wickVisible,
      upColor: initial.series.upColor, downColor: initial.series.downColor,
      borderUpColor: initial.series.borderUpColor, borderDownColor: initial.series.borderDownColor,
      wickUpColor: initial.series.wickUpColor, wickDownColor: initial.series.wickDownColor,
    },
    statusLine: initial.statusLine, priceAxis: initial.priceAxis,
    timeAxis: initial.timeAxis, theme: initial.theme, grid: initial.grid,
    crosshair: { visible: initial.crosshair.visible, dashed: initial.crosshair.dashed, color: initial.crosshair.color },
    watermark: { visible: initial.watermark.visible, text: initial.watermark.text },
  }, {});
  const head = el(doc, 'header', 'cts-settings-head');
  const heading = el(doc, 'div');
  heading.append(el(doc, 'h2', '', 'Chart settings'), el(doc, 'p', '', 'Make this chart your own. Changes apply live.'));
  const closeButton = iconButton(doc, 'x', 'Close settings', 20);
  closeButton.setAttribute('aria-label', 'Close settings');
  head.append(heading, closeButton);
  const searchBar = el(doc, 'div', 'cts-settings-search');
  const search = el(doc, 'input', 'cts-settings-search-input') as UITextInput;
  search.setAttribute('type', 'search');
  search.setAttribute('aria-label', 'Search chart settings');
  search.setAttribute('autocomplete', 'off');
  search.setAttribute('autocapitalize', 'off');
  search.setAttribute('spellcheck', 'false');
  search.setAttribute('maxlength', '100');
  search.setAttribute('aria-controls', `${id}-body`);
  search.placeholder = 'Search settings…';
  const clearSearchButton = iconButton(doc, 'x', 'Clear settings search', 16);
  clearSearchButton.setAttribute('aria-label', 'Clear settings search');
  clearSearchButton.setAttribute('hidden', '');
  searchBar.append(search, clearSearchButton);
  const searchStatus = el(doc, 'span', 'cts-settings-search-status');
  searchStatus.setAttribute('role', 'status');
  searchStatus.setAttribute('aria-live', 'polite');
  searchStatus.setAttribute('aria-atomic', 'true');
  const nav = el(doc, 'nav', 'cts-settings-nav');
  nav.setAttribute('aria-label', 'Settings sections');
  const body = el(doc, 'div', 'cts-settings-body');
  body.setAttribute('id', `${id}-body`);
  const noResults = el(doc, 'div', 'cts-settings-empty');
  noResults.append(el(doc, 'p', '', 'No settings found'), el(doc, 'small', '', 'Try “grid”, “wick”, or “log scale”.'));
  const footer = el(doc, 'footer', 'cts-settings-footer');
  const reset = el(doc, 'button', 'cts-settings-reset', 'Reset defaults');
  const done = el(doc, 'button', 'cts-settings-done', 'Done');
  for (const button of [reset, done]) button.setAttribute('type', 'button');
  footer.append(reset, done);
  root.append(head, searchBar, searchStatus, nav, body, footer);
  doc.body.append(root);
  let opened = false;
  let currentTheme = options.theme ?? 'dark';
  let syncers: (() => void)[] = [];
  let searchGroups: SearchGroup[] = [];
  const groupIndex = new Map<UIElement, SearchGroup>();
  const rowIndex = new Map<UIElement, SearchRow>();
  const get = (): ChartConfig => chart.getConfig();
  const change = (patch: DeepPartial<ChartConfig>): void => {
    chart.updateConfig(patch);
    for (const sync of syncers) sync();
    options.onChange?.();
  };

  function show(element: UIElement, visible: boolean): void {
    if (visible) element.removeAttribute('hidden');
    else element.setAttribute('hidden', '');
  }

  function filterSettings(): void {
    const query = search.value.trim();
    const filterGroup = (group: SearchGroup, ancestors: string[] = []): boolean => {
      const context = [...ancestors, ...group.fields];
      let visible = false;
      for (const item of group.rows) {
        const match = matchesSettingsSearch(query, [...context, ...item.fields]);
        show(item.element, match);
        visible = visible || match;
      }
      for (const child of group.groups) visible = filterGroup(child, context) || visible;
      show(group.element, visible);
      return visible;
    };
    let count = 0;
    for (const group of searchGroups) {
      const visible = filterGroup(group);
      group.element.classList.toggle('cts-settings-first', visible && count === 0);
      if (visible) count++;
    }
    show(noResults, count === 0);
    show(clearSearchButton, search.value.length > 0);
    searchStatus.textContent = query ? count ? `Matches in ${count} settings section${count === 1 ? '' : 's'}.` : 'No settings found.' : '';
    body.scrollTop = 0;
  }

  function clearSearch(): void { search.value = ''; filterSettings(); }

  function indexGroup(element: UIElement, fields: string[], parent?: UIElement): void {
    const group: SearchGroup = { element, fields, rows: [], groups: [] };
    groupIndex.set(element, group);
    if (parent) groupIndex.get(parent)!.groups.push(group);
    else searchGroups.push(group);
  }

  function section(title: string, name?: string): UIElement {
    const block = el(doc, 'section', 'cts-settings-section');
    block.setAttribute('aria-label', title);
    const h = el(doc, 'h3'); h.textContent = title;
    block.append(h); body.append(block);
    indexGroup(block, [title, name ?? '']);
    if (name) {
      const jump = el(doc, 'button', 'cts-settings-tab');
      jump.textContent = name;
      jump.setAttribute('type', 'button');
      jump.addEventListener('click', () => {
        clearSearch();
        body.scrollTop += block.getBoundingClientRect().top - body.getBoundingClientRect().top - 16;
        const first = block.querySelector('input, select, button') as UIElement | null;
        first?.focus();
      });
      nav.append(jump);
    }
    return block;
  }

  function row(parent: UIElement, label: string, hint?: string): { row: UIElement; label: UIElement } {
    const wrapper = el(doc, 'div', 'cts-settings-row');
    const text = el(doc, 'div', 'cts-settings-caption');
    const labelEl = el(doc, 'label'); labelEl.textContent = label;
    text.append(labelEl);
    if (hint) { const help = el(doc, 'small'); help.textContent = hint; text.append(help); }
    wrapper.append(text); parent.append(wrapper);
    const record = { element: wrapper, fields: [label, hint ?? ''] };
    groupIndex.get(parent)!.rows.push(record);
    rowIndex.set(wrapper, record);
    return { row: wrapper, label: labelEl };
  }

  function checkbox(parent: UIElement, key: string, label: string, read: () => boolean, write: (value: boolean) => void, hint?: string): UIElement {
    const line = row(parent, label, hint);
    rowIndex.get(line.row)!.fields.push(key);
    const input = el(doc, 'input', 'cts-settings-check') as Control;
    input.setAttribute('id', `${id}-${key}`); input.setAttribute('type', 'checkbox'); input.setAttribute('name', key);
    line.label.setAttribute('for', `${id}-${key}`);
    line.row.append(input);
    syncers.push(() => { input.checked = read(); });
    input.addEventListener('change', () => write(input.checked));
    return line.row;
  }

  function select(parent: UIElement, key: string, label: string, items: [string, string][], read: () => string, write: (value: string) => void): void {
    const line = row(parent, label);
    rowIndex.get(line.row)!.fields.push(key, ...items.flat());
    const input = el(doc, 'select', 'cts-settings-select') as Control;
    input.setAttribute('id', `${id}-${key}`); input.setAttribute('name', key);
    line.label.setAttribute('for', `${id}-${key}`);
    for (const [value, caption] of items) { const option = el(doc, 'option'); option.setAttribute('value', value); option.textContent = caption; input.append(option); }
    syncers.push(() => { input.value = read(); });
    input.addEventListener('change', () => write(input.value));
    line.row.append(input);
  }

  function textInput(parent: UIElement, key: string, label: string, read: () => string, write: (value: string) => void, numeric?: { min: number; max: number }, enabled = (): boolean => true): void {
    const line = row(parent, label);
    rowIndex.get(line.row)!.fields.push(key);
    const input = el(doc, 'input', 'cts-settings-input') as Control;
    input.setAttribute('id', `${id}-${key}`); input.setAttribute('name', key);
    input.setAttribute('type', numeric ? 'number' : 'text');
    if (numeric) { input.setAttribute('min', String(numeric.min)); input.setAttribute('max', String(numeric.max)); input.setAttribute('step', 'any'); }
    line.label.setAttribute('for', `${id}-${key}`);
    syncers.push(() => { input.value = read(); input.disabled = !enabled(); });
    input.addEventListener('change', () => {
      if (numeric && (input.value.trim() === '' || !Number.isFinite(Number(input.value)) || Number(input.value) < numeric.min || Number(input.value) > numeric.max)) {
        input.value = read(); return;
      }
      write(input.value);
    });
    line.row.append(input);
  }

  function color(parent: UIElement, key: string, label: string, read: () => string, write: (value: string) => void, enabled = (): boolean => true): void {
    rowIndex.get(parent)!.fields.push(key, label, 'color');
    const swatch = el(doc, 'label', 'cts-settings-color');
    const input = el(doc, 'input') as Control;
    input.setAttribute('type', 'color'); input.setAttribute('name', key); input.setAttribute('aria-label', label);
    syncers.push(() => {
      const value = read(); const parsed = parseColor(value);
      const channels = parsed ? [parsed.r, parsed.g, parsed.b].map((c) => parsed.space === 'display-p3' ? c * 255 : c) : [0, 0, 0];
      input.value = '#' + channels.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('');
      swatch.style.background = value;
      swatch.title = `${label}: ${value}`;
      input.disabled = !enabled();
      swatch.classList.toggle('cts-disabled', input.disabled);
    });
    input.addEventListener('input', () => write(input.value));
    swatch.append(input); parent.append(swatch);
  }

  function build(): void {
    body.replaceChildren(); nav.replaceChildren(); syncers = [];
    searchGroups = []; groupIndex.clear(); rowIndex.clear();
    const candles = section('Candles', 'Symbol');
    checkbox(candles, 'previous-close', 'Color bars based on previous close', () => get().series.colorByPreviousClose, (v) => change({ series: { colorByPreviousClose: v } }));
    for (const [label, visible, up, down] of [
      ['Body', 'bodyVisible', 'upColor', 'downColor'],
      ['Borders', 'borderVisible', 'borderUpColor', 'borderDownColor'],
      ['Wick', 'wickVisible', 'wickUpColor', 'wickDownColor'],
    ] as const) {
      const line = checkbox(candles, visible, label, () => get().series[visible], (v) => change({ series: { [visible]: v } }));
      const pair = el(doc, 'div', 'cts-settings-colors');
      rowIndex.set(pair, rowIndex.get(line)!);
      color(pair, up, `${label} up color`, () => get().series[up] || get().series.upColor, (v) => change({ series: { [up]: v } }), () => get().series[visible]);
      color(pair, down, `${label} down color`, () => get().series[down] || get().series.downColor, (v) => change({ series: { [down]: v } }), () => get().series[visible]);
      line.append(pair);
    }
    select(candles, 'precision', 'Precision', [['default', 'Default'], ...Array.from({ length: 13 }, (_, i): [string, string] => [String(i), `${i} decimal${i === 1 ? '' : 's'}`])],
      () => get().priceAxis.precision === null ? 'default' : String(get().priceAxis.precision), (v) => change({ priceAxis: { precision: v === 'default' ? null : Number(v) } }));

    const status = section('Status line', 'Status line');
    checkbox(status, 'status-visible', 'Show status line', () => get().statusLine.visible, (v) => change({ statusLine: { visible: v } }));
    textInput(status, 'symbol', 'Symbol name', () => get().statusLine.symbol, (v) => change({ statusLine: { symbol: v } }));
    for (const [key, label] of [['symbolVisible', 'Symbol'], ['ohlc', 'OHLC values'], ['change', 'Bar change'], ['volume', 'Volume'], ['indicators', 'Indicator values']] as const) {
      checkbox(status, `status-${key}`, label, () => get().statusLine[key], (v) => change({ statusLine: { [key]: v } }));
    }

    const scales = section('Scales and lines', 'Scales');
    checkbox(scales, 'autoScale', 'Auto (fits data to screen)', () => get().priceAxis.autoScale, (v) => change({ priceAxis: { autoScale: v } }));
    checkbox(scales, 'lockPriceToBarRatio', 'Lock price to bar ratio', () => get().priceAxis.lockPriceToBarRatio, (v) => change({ priceAxis: { lockPriceToBarRatio: v, priceToBarRatio: v ? chart.scale.priceToBarRatio() : null } }));
    textInput(scales, 'priceToBarRatio', 'Price to bar ratio', () => String(Number((get().priceAxis.priceToBarRatio ?? chart.scale.priceToBarRatio()).toPrecision(6))),
      (v) => change({ priceAxis: { priceToBarRatio: Number(v) } }), { min: 0.000000000001, max: 1e12 }, () => get().priceAxis.lockPriceToBarRatio);
    checkbox(scales, 'scaleSeriesOnly', 'Scale price chart only', () => get().priceAxis.scaleSeriesOnly, (v) => change({ priceAxis: { scaleSeriesOnly: v } }), 'Exclude overlay indicators from the automatic range.');
    checkbox(scales, 'inverted', 'Invert scale', () => get().priceAxis.inverted, (v) => change({ priceAxis: { inverted: v } }));
    select(scales, 'scale-mode', 'Scale mode', [['regular', 'Regular'], ['percent', 'Percent'], ['indexed', 'Indexed to 100'], ['logarithmic', 'Logarithmic']],
      () => get().priceAxis.mode, (v) => change({ priceAxis: { mode: v as PriceScaleMode, priceToBarRatio: null } }));
    select(scales, 'scale-position', 'Scale position', [['right', 'Right'], ['left', 'Left']], () => get().priceAxis.position, (v) => change({ priceAxis: { position: v as 'left' | 'right' } }));
    checkbox(scales, 'price-axis', 'Price scale', () => get().priceAxis.visible, (v) => change({ priceAxis: { visible: v } }));
    checkbox(scales, 'time-axis', 'Time scale', () => get().timeAxis.visible, (v) => change({ timeAxis: { visible: v } }));
    for (const [group, title, fields] of [
      ['labels', 'Labels', [['lastPrice', 'Last price label'], ['highLow', 'High and low labels'], ['indicator', 'Indicator labels']]],
      ['lines', 'Lines', [['lastPrice', 'Last price line'], ['previousClose', 'Previous close line'], ['highLow', 'High and low lines']]],
    ] as const) {
      const subgroup = el(doc, 'div', 'cts-settings-group');
      const sub = el(doc, 'h4'); sub.textContent = title; subgroup.append(sub); scales.append(subgroup);
      indexGroup(subgroup, [title], scales);
      for (const [key, label] of fields) checkbox(subgroup, `${group}-${key}`, label,
        () => Boolean((get().priceAxis[group] as unknown as Record<string, boolean>)[key]), (v) => change({ priceAxis: { [group]: { [key]: v } } }));
    }
    checkbox(scales, 'plusButton', 'Plus button', () => get().priceAxis.plusButton, (v) => change({ priceAxis: { plusButton: v } }), 'Add a horizontal price line from the scale.');

    const canvas = section('Canvas', 'Canvas');
    for (const [key, label] of [['background', 'Background'], ['textColor', 'Text'], ['borderColor', 'Pane borders']] as const) {
      const line = row(canvas, label);
      color(line.row, key, `${label} color`, () => get().theme[key], (v) => change({ theme: { [key]: v } }));
    }
    textInput(canvas, 'font-size', 'Text size', () => String(get().theme.fontSize), (v) => change({ theme: { fontSize: Number(v) } }), { min: 8, max: 24 });
    for (const [key, label] of [['visible', 'Grid'], ['horizontal', 'Horizontal grid lines'], ['vertical', 'Vertical grid lines']] as const) {
      checkbox(canvas, `grid-${key}`, label, () => get().grid[key], (v) => change({ grid: { [key]: v } }));
    }
    const gridColor = row(canvas, 'Grid color'); color(gridColor.row, 'grid-color', 'Grid color', () => get().grid.color, (v) => change({ grid: { color: v } }));
    checkbox(canvas, 'crosshair-visible', 'Crosshair', () => get().crosshair.visible, (v) => change({ crosshair: { visible: v } }));
    checkbox(canvas, 'crosshair-dashed', 'Dashed crosshair', () => get().crosshair.dashed, (v) => change({ crosshair: { dashed: v } }));
    const crossColor = row(canvas, 'Crosshair color'); color(crossColor.row, 'crosshair-color', 'Crosshair color', () => get().crosshair.color, (v) => change({ crosshair: { color: v } }));
    checkbox(canvas, 'watermark', 'Watermark', () => get().watermark.visible, (v) => change({ watermark: { visible: v } }));
    textInput(canvas, 'watermark-text', 'Watermark text', () => get().watermark.text, (v) => change({ watermark: { text: v } }));
    if (options.extraContent) {
      const extra = section('Playback and data'); extra.append(options.extraContent);
      groupIndex.get(extra)!.rows.push({ element: options.extraContent, fields: [options.extraContent.textContent ?? ''] });
    }
    body.append(noResults);
    for (const sync of syncers) sync();
    filterSettings();
  }

  function close(): void {
    if (!opened) return;
    opened = false;
    root.style.display = 'none';
    root.setAttribute('hidden', '');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.classList.remove('cts-open');
    trigger.focus();
  }
  function open(): void {
    if (opened) return;
    options.onOpen?.();
    search.value = '';
    build();
    opened = true;
    root.style.display = 'flex';
    root.removeAttribute('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    trigger.classList.add('cts-open');
    body.scrollTop = 0;
    closeButton.focus();
  }
  const toggle = (): void => { if (opened) close(); else open(); };
  const outside = (event: UIEvent): void => { if (opened && !root.contains(event.target) && !trigger.contains(event.target)) close(); };
  const keyboard = (event: UIEvent): void => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (search.value) { clearSearch(); search.focus(); }
      else close();
    }
  };
  const escape = (event: UIEvent): void => { if (opened && event.key === 'Escape') { event.preventDefault(); close(); } };
  const setTheme = (theme: ThemeName): void => {
    root.classList.toggle('cts-light', theme === 'light');
    if (theme !== currentTheme) {
      const preset = CHART_THEMES[theme];
      defaults.theme = mergeDeep(initial.theme, preset.theme);
      defaults.grid = mergeDeep(initial.grid, preset.grid);
      defaults.crosshair = mergeDeep(defaults.crosshair!, preset.crosshair);
    }
    currentTheme = theme;
  };
  trigger.addEventListener('click', toggle);
  closeButton.addEventListener('click', close);
  done.addEventListener('click', close);
  reset.addEventListener('click', () => { change(defaults); build(); });
  search.addEventListener('input', filterSettings);
  clearSearchButton.addEventListener('click', () => { clearSearch(); search.focus(); });
  root.addEventListener('keydown', keyboard);
  doc.addEventListener('pointerdown', outside);
  doc.addEventListener('keydown', escape);
  setTheme(options.theme ?? 'dark');
  return { element: root, open, close, toggle, setTheme, destroy(): void {
    close(); trigger.removeEventListener('click', toggle); doc.removeEventListener('pointerdown', outside); doc.removeEventListener('keydown', escape); root.remove();
  } };
}
