/**
 * Integration: Wave 2 work against the Wave 1 features on one host page. A
 * chart carries a drawing toolbar and a settings card together, as the
 * playground wires them, on a recording canvas, so each test checks both the
 * config and the frame.
 *
 * - Settings/React/HA polish: `presetChartTheme` is shared by the toolbar
 *   and the settings card over a bloxwapDark chart with Heikin Ashi bars.
 *   Theme toggles keep the series type, the volume overlay, the countdowns
 *   and the continuous axis. The volume columns and the countdown badge
 *   follow the Heikin Ashi direction in the current theme's colors, and Reset
 *   defaults matches the theme on screen.
 * - The settings card's time-continuous toggle drives the chart events and
 *   finger pans (P0.4) together with the touch-aware idle hint.
 * - Reset defaults leaves runtime state alone: price lines, markers (which
 *   re-anchor when the layout flips), indicators and drawings.
 * - 'Scale text size' and the countdown badge redraw through the countdown
 *   ticker.
 * - The volume overlay controls follow Heikin Ashi direction, including a live
 *   appended bar.
 * - P1.6 indicators dialog: it and the settings card close each other, keys
 *   typed in it never reach the toolbar's shortcuts, open settings follow the
 *   theme's candle colors and the toolbar's Hide/Remove indicators (through
 *   `refresh`), the status line names the studies it adds over Heikin Ashi,
 *   and Cancel under live bars leaves the tail exact.
 * - P1.5 header + P1.9 scale toggles, sharing the toolbar's flyouts: the
 *   header's Indicators button opens the picker (one popover at a time, focus
 *   back on close), a sub-pane study and the card's axis controls move the
 *   on-chart A / % / L strip, and the header, the strip, the card and Alt+L
 *   agree on the scale mode. The header's chart type survives theme toggles
 *   and Reset under bloxwapDark with the volume overlay on Heikin Ashi bars; a
 *   timeframe pick reloads a datafeed shaped like `@bloxwap/chart/datafeed`'s,
 *   and the countdown and the continuous axis take the new interval. Keys in
 *   the header menus stay out of the toolbar's shortcuts.
 * - P2.12 context menus through the toolbar's `contextMenu` option, wired as
 *   the playground wires them: opening one closes the header's menus in the
 *   shared flyouts; Settings… reaches the settings card, the study's settings
 *   in the indicators dialog (which drops a study the menu removes) and the
 *   drawing's style bar; a study the menu hid comes back from the header's
 *   picker. The menu's Auto / Logarithmic / Percent rows, the header, the
 *   on-chart strip and the card agree; Reset chart view on the continuous
 *   axis restores the default view (gaps kept, one range change) and keeps a
 *   ratio the card pinned. Indicator targets follow the dialog's plot
 *   toggles, the continuous gaps and the toolbar's Hide indicators.
 * - P0.2 history datafeed (`attachDatafeed`, the real one) on the same page:
 *   the header's timeframes drive it and follow its state, a superseded pick
 *   never lands, the countdown and the continuous axis take each interval,
 *   and the settings card's Reset defaults leaves the datafeed's interval
 *   alone. History paged in under a working page (Heikin Ashi with the
 *   volume overlay, a continuous gap, price lines, markers, a study added
 *   from the header, a selected drawing, a draft and undo history) paints
 *   exactly like a chart loaded with all of it, and the context menu reaches
 *   the study over the new bars. The toolbar's scroll arrows follow pages and
 *   switches, and Reset chart view after paging keeps the continuous gaps.
 * - The playground's host code on `Chart.getData` over the real datafeed,
 *   Heikin Ashi bars and bloxwapDark: its dotted last line (on the real
 *   close, moving to the bar that closed on a live roll), dashed mark line and
 *   Buy / Sell markers keep their prices and bars as history pages in; the
 *   bucket check counts no duplicates and only the missing buckets; an
 *   offline header timeframe pick clears the old symbol's lines and falls
 *   back to another symbol the header then shows; the continuous axis lays
 *   out the hole without adding bars; markers re-placed after a theme toggle
 *   take the new candle colors.
 */
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Window, type HTMLButtonElement, type HTMLElement, type HTMLInputElement, type HTMLSelectElement } from 'happy-dom';
import {
  CHART_THEMES,
  barCountdownMs,
  createChart,
  formatCountdown,
  heikinAshi,
  presetChartTheme,
  scaleFont,
  type ChartConfig,
  type ChartPresetName,
  type DeepPartial,
  type FrameScheduler,
  type PriceLine,
  type SeriesType,
  type VisibleRangeChangeEvent,
} from '../dist/index.js';
import { MockCanvas, MockContext2D, type ChartCanvas, type ChartDocument } from '../dist/dom.js';
import type { Candle } from '../dist/core/data.js';
import { attachDatafeed, type Datafeed, type FetchBarsRequest } from '../dist/datafeed/index.js';
import {
  CHART_TYPE_LABELS,
  createChartHeader,
  createChartSettings,
  createDrawingToolbar,
  createIndicatorsDialog,
  createScaleButtons,
  startCountdownTicker,
  type ChartHeaderOptions,
  type ContextMenuAction,
  type HeaderDatafeed,
  type ThemeName,
  type UIDocument,
  type UIElement,
} from '../dist/ui/index.js';

const windows: Window[] = [];
after(() => {
  for (const win of windows) void win.happyDOM.close();
});

const T0 = 1_700_000_040; // a 1m boundary, in seconds
const N = 150;
/** Bars from here on sit {@link GAP_MIN} minutes later. */
const GAP_AT = 90;
const GAP_MIN = 30;
const WIDTH = 800;
const HEIGHT = 500;
const MOUSE_HINT = 'Drag to scroll · wheel to zoom · click a drawing to edit it';
const TOUCH_HINT = 'Drag to scroll · pinch to zoom · long-press for crosshair';

/** A wavy 1m bar, so Heikin Ashi directions differ from the real ones. */
function bar(i: number): Candle {
  const base = 100 + Math.sin(i / 4) * 8;
  return { time: T0 + (i < GAP_AT ? i : i + GAP_MIN) * 60, open: base, high: base + 3, low: base - 2, close: base + Math.cos(i) * 1.5, volume: 10 + i };
}

const DATA: Candle[] = Array.from({ length: N }, (_, i) => bar(i));
/** 20s into the last bar: its countdown reads 00:40. */
const NOW = (DATA.at(-1)!.time + 20) * 1000;

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

type Op =
  | { readonly kind: 'rect'; readonly color: string; readonly alpha: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  | { readonly kind: 'text'; readonly color: string; readonly font: string; readonly text: string; readonly x: number; readonly y: number }
  | { readonly kind: 'paint'; readonly color: string };
type Rect = Extract<Op, { kind: 'rect' }>;
type Text = Extract<Op, { kind: 'text' }>;

/** A MockContext2D that records paint ops with the style in effect, in canvas CSS coordinates. */
class Rec extends MockContext2D {
  readonly ops: Op[] = [];
  private tx = 0;
  private ty = 0;
  private readonly stack: { tx: number; ty: number; fill: string | object; stroke: string | object; alpha: number }[] = [];

  override save(): void {
    super.save();
    this.stack.push({ tx: this.tx, ty: this.ty, fill: this.fillStyle, stroke: this.strokeStyle, alpha: this.globalAlpha });
  }
  override restore(): void {
    super.restore();
    const state = this.stack.pop();
    if (state === undefined) return;
    ({ tx: this.tx, ty: this.ty, alpha: this.globalAlpha } = state);
    this.fillStyle = state.fill as string;
    this.strokeStyle = state.stroke as string;
  }
  override translate(x: number, y: number): void {
    super.translate(x, y);
    this.tx += x;
    this.ty += y;
  }
  override stroke(): void {
    super.stroke();
    this.ops.push({ kind: 'paint', color: String(this.strokeStyle) });
  }
  override fill(): void {
    super.fill();
    this.ops.push({ kind: 'paint', color: String(this.fillStyle) });
  }
  override fillRect(x: number, y: number, w: number, h: number): void {
    super.fillRect(x, y, w, h);
    this.ops.push({ kind: 'rect', color: String(this.fillStyle), alpha: this.globalAlpha, x: x + this.tx, y: y + this.ty, w, h });
  }
  override fillText(text: string, x: number, y: number): void {
    super.fillText(text, x, y);
    this.ops.push({ kind: 'text', color: String(this.fillStyle), font: this.font, text, x: x + this.tx, y: y + this.ty });
  }
  reset(): void {
    this.calls.length = 0;
    this.ops.length = 0;
  }
  texts(): Text[] {
    return this.ops.filter((o): o is Text => o.kind === 'text');
  }
  rects(): Rect[] {
    return this.ops.filter((o): o is Rect => o.kind === 'rect');
  }
  /** Every fill and stroke color used. */
  colors(): Set<string> {
    return new Set(this.ops.filter((o) => o.kind !== 'text').map((o) => o.color));
  }
}

class RecCanvas extends MockCanvas {
  override readonly context: Rec = new Rec();
}

class RecDocument implements ChartDocument {
  readonly created: RecCanvas[] = [];
  createCanvas(width: number, height: number): ChartCanvas {
    const canvas = new RecCanvas(width, height);
    this.created.push(canvas);
    return canvas;
  }
}

/** Window timers that fire only on `tick`. */
class FakeTimers {
  time = 0;
  private seq = 0;
  private readonly queue = new Map<number, { at: number; fn: () => void }>();
  setTimeout = (fn: () => void, ms = 0): number => {
    const id = ++this.seq;
    this.queue.set(id, { at: this.time + ms, fn });
    return id;
  };
  clearTimeout = (id: number | undefined): void => {
    this.queue.delete(id!);
  };
  setInterval = (): number => 0;
  clearInterval = (): void => {};
  tick(ms: number): void {
    this.time += ms;
    for (const [id, t] of [...this.queue]) if (t.at <= this.time && this.queue.delete(id)) t.fn();
  }
}

class TestFrames implements FrameScheduler {
  time = 0;
  seq = 0;
  callbacks = new Map<number, (time: number) => void>();
  now = () => this.time;
  request = (callback: (time: number) => void) => {
    const id = ++this.seq;
    this.callbacks.set(id, callback);
    return id;
  };
  cancel = (id: number) => {
    this.callbacks.delete(id);
  };
  tick(ms = 16) {
    this.time += ms;
    for (const [id, callback] of [...this.callbacks]) if (this.callbacks.delete(id)) callback(this.time);
  }
}

interface MountOptions {
  preset?: ChartPresetName;
  config?: DeepPartial<ChartConfig>;
  chartTheme?: (theme: ThemeName) => DeepPartial<ChartConfig>;
  /** The toolbar's right-click menus, with Settings… rows wired to the card and the dialog as the playground does. */
  contextMenu?: boolean;
}

/** A chart with a drawing toolbar and a settings card on one page, wired like the playground. */
function mount(options: MountOptions = {}) {
  const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
  windows.push(win);
  const timers = new FakeTimers();
  Object.assign(win, { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, setInterval: timers.setInterval, clearInterval: timers.clearInterval });
  const doc = win.document;
  const rail = doc.createElement('div');
  const stage = doc.createElement('div');
  const surface = doc.createElement('div');
  Object.defineProperties(surface, { clientWidth: { value: WIDTH }, clientHeight: { value: HEIGHT } });
  const trigger = doc.createElement('button');
  stage.append(surface);
  doc.body.append(rail, stage, trigger);
  const clock = { now: NOW };
  const recorder = new RecDocument();
  const chart = createChart({
    document: recorder,
    now: () => clock.now,
    ...(options.preset !== undefined ? { preset: options.preset } : {}),
    config: { wasm: false, width: WIDTH, height: HEIGHT, data: DATA, ...options.config },
  });
  const ctx = recorder.created[0]!.context;
  const frames = new TestFrames();
  const theme = options.chartTheme !== undefined ? { chartTheme: options.chartTheme } : {};
  /** Actions the context menu ran, in order. */
  const actions: ContextMenuAction[] = [];
  const contextMenu = options.contextMenu !== true ? {} : {
    contextMenu: {
      onChartSettings: () => settings.open(),
      onIndicatorSettings: (id: string) => {
        dialog.openSettings(id);
      },
      // What the menu hid or removed drops out of the dialog.
      onAction: (action: ContextMenuAction) => {
        actions.push(action);
        dialog.refresh();
      },
    },
  };
  const tb = createDrawingToolbar({
    chart,
    document: doc as unknown as UIDocument,
    canvas: surface as unknown as UIElement,
    rail: rail as unknown as UIElement,
    overlay: stage as unknown as UIElement,
    scheduler: frames,
    ...theme,
    ...contextMenu,
  });
  // One popover at a time, as the playground wires them: each dialog closes the other as it opens.
  const settings = createChartSettings({
    chart,
    document: doc as unknown as UIDocument,
    trigger: trigger as unknown as UIElement,
    ...theme,
    onOpen: () => dialog.close(),
    onChange: () => {
      tb.cancelNavigation();
      tb.refreshViewport();
    },
  });
  const dialog = createIndicatorsDialog({
    chart,
    document: doc as unknown as UIDocument,
    onOpen: () => {
      tb.cancelNavigation();
      tb.flyouts.close();
      settings.close();
    },
    onChange: () => {
      tb.cancelNavigation();
      tb.refreshViewport();
    },
  });
  tb.controller.on('change', () => dialog.refresh());
  const card = settings.element as unknown as HTMLElement;
  const input = (name: string) => card.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const check = (name: string) => input(name).click();
  const color = (name: string, value: string) => {
    const node = input(name);
    node.value = value;
    node.dispatchEvent(new win.Event('input'));
  };
  const select = (name: string, value: string) => {
    const node = card.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
    node.value = value;
    node.dispatchEvent(new win.Event('change'));
  };
  const reset = () => card.querySelector<HTMLButtonElement>('.cts-settings-reset')!.click();
  const setTheme = (name: ThemeName) => {
    tb.setTheme(name);
    settings.setTheme(name);
    dialog.setTheme(name);
  };
  const pointer = (type: string, id: number, x: number, y: number, pointerType: string) =>
    surface.dispatchEvent(new win.PointerEvent(type, { pointerId: id, clientX: x, clientY: y, button: 0, pointerType, bubbles: true, cancelable: true }));
  const finger = (type: string, id: number, x: number, y: number) => pointer(type, id, x, y, 'touch');
  const press = (pointerType: string, x = 300, y = 200) => {
    pointer('pointerdown', 1, x, y, pointerType);
    pointer('pointerup', 1, x, y, pointerType);
  };
  const hint = doc.querySelector('.cts-hint') as unknown as HTMLElement;
  /** Clears the recording and paints one full frame. */
  const frame = () => {
    ctx.reset();
    chart.render();
    return ctx;
  };
  const destroy = () => {
    dialog.destroy();
    settings.destroy();
    tb.destroy();
    chart.destroy();
  };
  return { win, doc, stage, surface, timers, frames, clock, chart, ctx, tb, settings, dialog, card, input, check, color, select, reset, setTheme, finger, press, hint, frame, destroy, actions };
}

type Mounted = ReturnType<typeof mount>;

/**
 * Volume columns (the overlay's alpha) sit under their bars in the Heikin
 * Ashi direction, in `up`/`down`. Returns how many columns were checked.
 */
function volumeFollowsHeikinAshi(m: Mounted, alpha: number, up: string, down: string): number {
  const ha = heikinAshi(DATA);
  const columns = m.ctx.rects().filter((r) => r.alpha === alpha);
  const { from, to } = m.chart.scale.visibleRange();
  assert.equal(columns.length, to - from, 'one column per visible bar');
  for (const [k, column] of columns.entries()) {
    const i = from + k;
    assert.equal(column.x + Math.floor(column.w / 2), Math.round(m.chart.scale.indexToX(i)), `column ${i} x`);
    assert.equal(column.color, ha[i]!.close >= ha[i]!.open ? up : down, `column ${i} color`);
  }
  const raw = (i: number) => DATA[i]!.close >= DATA[i]!.open;
  const haUp = (i: number) => ha[i]!.close >= ha[i]!.open;
  assert.ok(columns.some((_, k) => raw(from + k) !== haUp(from + k)), 'some visible bar has a Heikin Ashi direction unlike its real one');
  return columns.length;
}

/** The countdown badge on the price axis (the status line copy sits inside the plot). */
function badge(m: Mounted, text: string): Text | undefined {
  return m.ctx.texts().find((t) => t.text === text && t.x > m.chart.plotArea.width);
}

describe('integration: presetChartTheme on a toolbar and a settings card together', () => {
  it('theme toggles keep Heikin Ashi, the volume overlay, the countdowns and the continuous axis; Reset matches the theme on screen', () => {
    const m = mount({ preset: 'bloxwapDark', config: { series: { type: 'heikin-ashi' } }, chartTheme: presetChartTheme('bloxwapDark') });
    const presetVolume = m.chart.getConfig().volume;
    m.settings.open();
    m.check('status-countdown');
    m.check('labels-countdown');
    m.check('time-continuous');
    const toggles = () => {
      const c = m.chart.getConfig();
      return [c.series.type, c.volume.overlay, c.statusLine.countdown, c.priceAxis.labels.countdown, c.timeScale.continuous, c.theme.scaleFontSize];
    };
    assert.deepEqual(toggles(), ['heikin-ashi', true, true, true, true, 11]);

    const bloxwap = ['#00ff3f', '#ff479c'];
    const light = [CHART_THEMES.light.series!.upColor!, CHART_THEMES.light.series!.downColor!];
    for (const [theme, [up, down], stale] of [['light', light, bloxwap], ['dark', bloxwap, light], ['light', light, bloxwap]] as const) {
      m.setTheme(theme);
      assert.deepEqual(toggles(), ['heikin-ashi', true, true, true, true, 11], `${theme}: only colors change`);
      const ctx = m.frame();
      for (const color of stale) assert.ok(!ctx.colors().has(color), `${theme}: no ${color} left on screen`);
      assert.ok(volumeFollowsHeikinAshi(m, presetVolume.opacity, up, down) > 0);
      const config = m.chart.getConfig();
      const countdown = badge(m, '00:40');
      assert.ok(countdown !== undefined, `${theme}: the countdown badge shows`);
      assert.equal(countdown.font, scaleFont(config.theme), 'in the scale font');
      const fill = ctx.ops[ctx.ops.indexOf(countdown) - 1] as Rect;
      const last = heikinAshi(DATA).at(-1)!;
      assert.equal(fill.color, last.close >= last.open ? up : down, 'colored like the last Heikin Ashi bar');
      assert.ok(ctx.texts().some((t) => t.text === '00:40' && t.x < m.chart.plotArea.width), 'the status line counts down too');
    }

    // Reset on light: the light candles (no bloxwap wicks or borders), the card's own toggles, the preset's volume and scale size.
    m.color('upColor', '#010101');
    m.color('background', '#020202');
    m.reset();
    let config = m.chart.getConfig();
    assert.deepEqual(
      [config.series.upColor, config.series.downColor, config.series.wickUpColor, config.series.borderDownColor, config.theme.background],
      [...light, '', '', CHART_THEMES.light.theme!.background],
    );
    assert.deepEqual(toggles(), ['heikin-ashi', true, false, false, false, 11]);
    assert.deepEqual(config.volume, presetVolume);

    m.setTheme('dark');
    m.color('upColor', '#010101');
    m.reset();
    config = m.chart.getConfig();
    assert.deepEqual([config.series.upColor, config.series.wickUpColor, config.series.borderDownColor, config.theme.background], ['#00ff3f', '#00ff3f', '#ff479c', '#171717']);
    m.destroy();
  });
});

describe('integration: the settings time-continuous toggle under touch', () => {
  it('reports one range change each way, keeps finger pans pixel-exact and the touch hint current', () => {
    const m = mount();
    const spacing = m.chart.scale.barSpacing();
    m.timers.tick(3_000);
    m.press('touch');
    assert.equal(m.hint.textContent, TOUCH_HINT);
    const ranges: VisibleRangeChangeEvent[] = [];
    m.chart.subscribeVisibleRangeChange((e) => ranges.push(e));

    m.settings.open();
    m.check('time-continuous');
    assert.equal(ranges.length, 1, 'the toggle reports the moved range once');
    close(m.chart.scale.indexToX(GAP_AT) - m.chart.scale.indexToX(GAP_AT - 1), (GAP_MIN + 1) * spacing);
    m.settings.close();

    const pan = (dx: number) => {
      const x0 = m.chart.scale.indexToX(120);
      m.finger('pointerdown', 1, 300, 200);
      m.finger('pointermove', 1, 300 + dx / 2, 200);
      m.finger('pointermove', 1, 300 + dx, 200);
      m.frames.tick();
      close(m.chart.scale.indexToX(120), x0 + dx);
      m.frames.time += 200; // rest before lifting: no fling
      m.finger('pointerup', 1, 300 + dx, 200);
      m.finger('pointerleave', 1, 300 + dx, 200);
      assert.equal(m.frames.callbacks.size, 0);
      const e = ranges.at(-1)!;
      const { from, to } = m.chart.scale.visibleRange();
      assert.deepEqual([e.from, e.to], [from, to], 'the last range event is current');
    };
    pan(-60);
    assert.equal(m.hint.textContent, TOUCH_HINT, 'a pan keeps the touch hint');
    m.press('mouse');
    assert.equal(m.hint.textContent, MOUSE_HINT);

    m.settings.open();
    const before = ranges.length;
    m.reset();
    assert.equal(m.chart.getConfig().timeScale.continuous, false);
    assert.equal(ranges.length, before + 1, 'Reset reports the range once');
    close(m.chart.scale.indexToX(GAP_AT) - m.chart.scale.indexToX(GAP_AT - 1), spacing);
    m.settings.close();
    pan(40);
    assert.equal(m.hint.textContent, TOUCH_HINT, 'the finger brings the touch hint back');
    m.destroy();
  });
});

describe('integration: Reset defaults keeps the runtime state', () => {
  it('leaves price lines, markers, indicators and drawings alone; markers re-anchor as the layout flips', () => {
    const m = mount({ config: { series: { type: 'heikin-ashi' } } });
    const ha = heikinAshi(DATA);
    const line = m.chart.series.createPriceLine({ price: DATA[130]!.close, color: '#35b5ff', title: 'mark' });
    // 'G' is timed inside the gap: it belongs to the bar before it.
    m.chart.series.setMarkers([
      { time: DATA[120]!.time, position: 'aboveBar', color: '#ffb300', shape: 'arrowDown', text: 'S' },
      { time: DATA[GAP_AT - 1]!.time + 10 * 60, position: 'belowBar', color: '#e91e63', shape: 'arrowUp', text: 'G' },
    ]);
    const studies = [m.chart.addIndicator({ name: 'supertrend' }), m.chart.addIndicator({ name: 'vwap' })];
    const drawing = m.chart.addDrawing({ name: 'trendline', points: [{ index: 100, price: 100 }, { index: 140, price: 105 }] });
    const scroll = () => {
      // Show the gap and the markers after a layout change.
      m.chart.scale.scrollTo(N - 1);
    };
    const anchored = (label: string) => {
      const ctx = m.frame();
      const caption = (text: string) => ctx.texts().find((t) => t.text === text);
      assert.equal(caption('S')?.x, m.chart.scale.indexToX(120), `${label}: S on its bar`);
      assert.ok(caption('S')!.y < m.chart.scale.priceToY(ha[120]!.high), `${label}: above the Heikin Ashi high`);
      assert.equal(caption('G')?.x, m.chart.scale.indexToX(GAP_AT - 1), `${label}: G on the bar before the gap`);
      assert.ok(caption('mark') !== undefined, `${label}: the price line title shows`);
      assert.ok(ctx.colors().has('#35b5ff'), `${label}: the price line draws`);
    };
    scroll();
    anchored('bar-indexed');

    m.settings.open();
    m.check('time-continuous');
    m.color('upColor', '#010101');
    m.select('precision', '3');
    scroll();
    anchored('continuous');

    m.reset();
    scroll();
    assert.equal(m.chart.getConfig().timeScale.continuous, false);
    assert.equal(m.chart.getConfig().priceAxis.precision, null);
    assert.deepEqual(m.chart.series.priceLines(), [line]);
    assert.deepEqual(m.chart.series.markers().map((k) => k.text), ['G', 'S'], 'in time order');
    assert.deepEqual(m.chart.getConfig().indicators.map((k) => k.id), studies);
    assert.deepEqual(m.chart.getConfig().drawings.map((d) => [d.id, d.points]), [[drawing, [{ index: 100, price: 100 }, { index: 140, price: 105 }]]]);
    assert.equal(m.chart.getConfig().series.type, 'heikin-ashi');
    anchored('reset');
    m.destroy();
  });
});

describe('integration: settings scale text size x the countdown ticker', () => {
  it('redraws the countdown badge each second in the scale size the card picks', () => {
    const m = mount({ config: { statusLine: { visible: true } } });
    const ticker = startCountdownTicker({ chart: m.chart, window: m.timers });
    const second = () => {
      m.ctx.reset();
      m.clock.now += 1000;
      m.timers.tick(1000);
    };
    m.settings.open();
    m.check('labels-countdown');
    m.select('scale-font-size', '16');
    assert.ok(scaleFont(m.chart.getConfig().theme).startsWith('16px'));

    second();
    assert.equal(badge(m, '00:39')?.font, scaleFont(m.chart.getConfig().theme), 'the ticker paints the badge at 16px');
    m.select('scale-font-size', 'default');
    second();
    assert.equal(badge(m, '00:38')?.font, scaleFont(m.chart.getConfig().theme), 'and at Text size once back on Default');
    assert.ok(badge(m, '00:38')!.font.startsWith('12px'));

    m.check('labels-countdown');
    m.check('status-countdown');
    second();
    assert.equal(badge(m, '00:37'), undefined, 'no badge once the label is off');
    assert.ok(m.ctx.texts().some((t) => t.text === '00:37'), 'the status line counts down instead');
    ticker.stop();
    m.destroy();
  });
});

describe('integration: settings volume controls x Heikin Ashi', () => {
  it('colors the overlay by the Heikin Ashi direction with a picked up color, including an appended bar', () => {
    const m = mount({ config: { series: { type: 'heikin-ashi' } } });
    m.settings.open();
    m.check('volume-overlay');
    m.color('volume-upColor', '#abcdef');
    const { volume, series } = m.chart.getConfig();
    assert.equal(volume.upColor, '#abcdef');
    m.frame();
    volumeFollowsHeikinAshi(m, volume.opacity, '#abcdef', series.downColor);

    // A new bar whose Heikin Ashi direction is down while its real one is up.
    const prev = heikinAshi(DATA).at(-1)!;
    const next: Candle = { time: DATA.at(-1)!.time + 60, open: prev.open - 5, high: prev.open - 3, low: prev.open - 7, close: prev.open - 4.9, volume: 99 };
    assert.ok(next.close >= next.open);
    const data = [...DATA, next];
    const ha = heikinAshi(data);
    assert.ok(ha.at(-1)!.close < ha.at(-1)!.open);
    m.chart.appendData(next);
    m.chart.scale.scrollTo(data.length - 1);
    const ctx = m.frame();
    const x = Math.round(m.chart.scale.indexToX(data.length - 1));
    const column = ctx.rects().find((r) => r.alpha === volume.opacity && r.x + Math.floor(r.w / 2) === x);
    assert.equal(column?.color, series.downColor, 'the appended bar follows its Heikin Ashi direction');

    m.check('volume-overlay');
    assert.equal(m.frame().rects().filter((r) => r.alpha === volume.opacity).length, 0, 'the overlay goes with the toggle');
    m.destroy();
  });
});

/** The indicators dialog of a {@link mount}ed page, driven like a user. */
function dialogOf(m: Mounted) {
  const root = m.dialog.element as unknown as HTMLElement;
  const field = (name: string) => root.querySelector(`[name="${name}"]`) as unknown as HTMLInputElement;
  const change = (name: string, value: string) => {
    const node = field(name);
    node.value = value;
    node.dispatchEvent(new m.win.Event('change', { bubbles: true }));
  };
  const key = (target: unknown, name: string, init: Record<string, unknown> = {}) => {
    const event = new m.win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
    (target as HTMLElement).dispatchEvent(event);
    return event;
  };
  const search = root.querySelector('[type="search"]') as unknown as HTMLInputElement;
  /** Types `query` into the picker's search and presses Enter to add the first match. */
  const add = (query: string) => {
    search.value = query;
    search.dispatchEvent(new m.win.Event('input', { bubbles: true }));
    key(search, 'Enter');
  };
  const press = (text: string) => {
    const button = Array.from(root.querySelectorAll('button')).find((b) => b.textContent === text && b.closest('[hidden]') === null);
    assert.ok(button, `button ${text}`);
    (button as unknown as HTMLElement).click();
  };
  const rows = () => Array.from(root.querySelectorAll('.cts-ind-active')) as unknown as HTMLElement[];
  return { root, field, change, key, add, press, rows };
}

/** A toolbar menu item by its label (a click without a pointer press, like the keyboard). */
function toolbarItem(m: Mounted, label: string): HTMLElement {
  const text = Array.from(m.doc.querySelectorAll('.cts-item-label')).find((node) => node.textContent === label);
  assert.ok(text, `menu item ${label}`);
  return text.closest('.cts-item') as unknown as HTMLElement;
}

describe('integration: the indicators dialog beside the toolbar and the settings card', () => {
  it('opens one popover at a time, keeps keys typed in it from the toolbar, and restyles open settings with the theme', () => {
    const m = mount({ preset: 'bloxwapDark', config: { series: { type: 'heikin-ashi' } }, chartTheme: presetChartTheme('bloxwapDark') });
    const d = dialogOf(m);
    m.settings.open();
    m.dialog.openPicker();
    assert.equal(m.dialog.view, 'picker');
    assert.ok(m.card.hasAttribute('hidden'), 'the picker closes the settings card');
    m.settings.open();
    assert.equal(m.dialog.view, null, 'the settings card closes the picker');
    assert.ok(!m.card.hasAttribute('hidden'));

    m.dialog.openPicker();
    assert.ok(m.card.hasAttribute('hidden'));
    d.add('macd');
    const macd = structuredClone(m.chart.getConfig().indicators[0]!);
    assert.equal(macd.name, 'macd');
    const drawing = m.chart.addDrawing({ name: 'trendline', points: [{ index: 100, price: 100 }, { index: 140, price: 105 }] });
    m.tb.controller.select(drawing);
    assert.equal(m.dialog.openSettings(macd.id), true);
    d.key(d.field('input-fast'), 'Backspace');
    d.key(d.field('input-fast'), 'Delete');
    d.key(d.field('input-fast'), 'i', { altKey: true, code: 'KeyI' });
    assert.ok(m.chart.getDrawing(drawing) !== undefined, 'Backspace and Delete in a field keep the selected drawing');
    assert.equal(m.chart.getConfig().priceAxis.inverted, false, 'Alt+I in a field leaves the scale alone');
    m.tb.controller.arm('trendline');
    d.change('input-fast', '5');
    d.key(d.field('input-fast'), 'Escape');
    assert.equal(m.dialog.view, null, 'Escape cancels the settings');
    assert.equal(m.chart.getIndicator(macd.id)!.params['fast'], 12);
    assert.equal(m.tb.controller.tool, 'trendline', 'but leaves the armed tool alone');
    // Outside the dialog the same keys reach the toolbar.
    d.key(m.doc.body, 'Escape');
    assert.equal(m.tb.controller.tool, null);
    m.tb.controller.select(drawing);
    d.key(m.doc.body, 'Backspace');
    assert.equal(m.chart.getDrawing(drawing), undefined);

    // Candle-following histogram colors track the theme while settings stay open.
    m.dialog.openSettings(macd.id);
    assert.deepEqual([d.field('color-2').value, d.field('color-3').value], ['#00ff3f', '#ff479c']);
    m.setTheme('light');
    const light = CHART_THEMES.light.series!;
    assert.equal(m.dialog.view, 'settings');
    assert.ok(d.root.classList.contains('cts-light'));
    assert.deepEqual([d.field('color-2').value, d.field('color-3').value], [light.upColor!, light.downColor!]);
    m.setTheme('dark');
    assert.deepEqual([d.field('color-2').value, d.field('color-3').value], ['#00ff3f', '#ff479c']);
    assert.deepEqual(m.chart.getIndicator(macd.id)!.colors, macd.colors, 'restyling the dialog changes no study');
    m.destroy();
  });

  it("follows the toolbar's Hide and Remove indicators in an open picker and open settings", () => {
    const m = mount();
    const d = dialogOf(m);
    const ids = [m.chart.addIndicator({ name: 'macd' }), m.chart.addIndicator({ name: 'rsi' })];
    m.dialog.openPicker();
    const off = () => d.rows().map((row) => row.classList.contains('cts-ind-off'));
    assert.deepEqual(off(), [false, false]);
    toolbarItem(m, 'Hide indicators').click();
    assert.equal(m.dialog.view, 'picker');
    assert.deepEqual(off(), [true, true], 'the picker relists the hidden studies');

    (d.rows()[0]!.querySelector('.cts-ind-settings') as unknown as HTMLElement).click();
    assert.equal(m.dialog.view, 'settings');
    assert.equal(d.field('visible').checked, false);
    toolbarItem(m, 'Hide indicators').click();
    assert.equal(d.field('visible').checked, true, 'open settings resync');
    d.change('input-fast', '5');
    d.press('Cancel');
    assert.equal(m.dialog.view, 'picker');
    assert.deepEqual([m.chart.getIndicator(ids[0]!)!.params['fast'], off()], [12, [true, false]], 'Cancel restores the study as its settings opened, hidden included');

    (d.rows()[1]!.querySelector('.cts-ind-settings') as unknown as HTMLElement).click();
    d.change('input-period', '9');
    toolbarItem(m, 'Remove indicators').click();
    assert.deepEqual([m.dialog.view, d.rows().length], ['picker', 0], 'settings of a removed study go back to the picker they came from');
    assert.deepEqual(m.chart.getConfig().indicators, [], 'and bring nothing back');

    m.chart.addIndicator({ name: 'sma' });
    m.dialog.openPicker();
    assert.equal(d.rows().length, 1);
    toolbarItem(m, 'Remove indicators').click();
    assert.deepEqual([m.dialog.view, d.rows().length], ['picker', 0], 'the picker drops removed studies');
    m.destroy();
  });

  it('names the studies the picker adds on the status line over Heikin Ashi; the card and the dialog toggle their rows', () => {
    const m = mount({ preset: 'bloxwapDark', config: { series: { type: 'heikin-ashi' }, timeScale: { continuous: true } } });
    const d = dialogOf(m);
    m.dialog.openPicker();
    d.add('macd');
    d.add('rsi');
    assert.deepEqual(m.chart.getConfig().indicators.map((k) => k.name), ['macd', 'rsi']);
    const labels = () => m.frame().texts().map((t) => t.text.split('  ')[0]!).filter((l) => ['MACD', 'Signal', 'RSI', 'DIF', 'DEA', 'VALUE'].includes(l));
    assert.deepEqual(labels(), ['MACD', 'Signal', 'RSI']);

    (d.rows()[0]!.querySelector('.cts-ind-settings') as unknown as HTMLElement).click();
    d.field('visible-dea').click();
    d.press('OK');
    assert.deepEqual(labels(), ['MACD', 'RSI'], "the dialog's plot toggle drops the signal row");
    d.press('Done');

    m.settings.open();
    m.check('status-indicators');
    assert.deepEqual(labels(), [], "the card's indicator values toggle drops them all");
    m.check('status-indicators');
    assert.deepEqual(labels(), ['MACD', 'RSI']);
    m.destroy();
  });

  it('Cancel under live bars restores the study, and its tail matches a chart built from the same bars', () => {
    const config: DeepPartial<ChartConfig> = {
      series: { type: 'heikin-ashi' }, timeScale: { continuous: true }, statusLine: { visible: true }, priceAxis: { precision: 8 },
    };
    const m = mount({ config });
    const d = dialogOf(m);
    const id = m.chart.addIndicator({ name: 'macd' });
    m.dialog.openSettings(id);
    d.change('input-fast', '5');
    d.change('input-signal', '4');
    m.chart.appendData(bar(N));
    d.press('Cancel');
    assert.deepEqual(m.chart.getIndicator(id)!.params, { fast: 12, slow: 26, signal: 9 });
    m.chart.appendData(bar(N + 1));
    const live: Candle = { ...bar(N + 1), close: bar(N + 1).close + 2.5, high: bar(N + 1).high + 2.5 };
    m.chart.appendData(live);
    const values = (ctx: Rec) => ctx.texts().filter((t) => /^(MACD|Signal) {2}/.test(t.text)).map((t) => t.text);
    const shown = values(m.frame());
    assert.equal(shown.length, 2);

    const recorder = new RecDocument();
    const fresh = createChart({ document: recorder, now: () => NOW, config: { wasm: false, width: WIDTH, height: HEIGHT, data: [...DATA, bar(N), live], ...config } });
    fresh.addIndicator({ name: 'macd' });
    const ctx = recorder.created[0]!.context;
    ctx.reset();
    fresh.render();
    assert.deepEqual(shown, values(ctx));
    fresh.destroy();
    m.destroy();
  });
});

/**
 * The P1.5 chart header and the P1.9 on-chart A / % / L strip on a
 * {@link mount}ed page, wired as a host does: the header shares the toolbar's
 * flyouts and opens the indicators picker; the strip sits in the toolbar's
 * overlay.
 */
function withHeader(m: Mounted, options: Partial<Omit<ChartHeaderOptions, 'chart' | 'document' | 'container'>> = {}) {
  const container = m.doc.createElement('div');
  m.doc.body.prepend(container);
  const header = createChartHeader({
    chart: m.chart,
    document: m.doc as unknown as UIDocument,
    container: container as unknown as UIElement,
    symbol: 'BTC',
    flyouts: m.tb.flyouts,
    onIndicators: () => m.dialog.openPicker(),
    ...options,
  });
  const strip = createScaleButtons({
    chart: m.chart,
    document: m.doc as unknown as UIDocument,
    overlay: m.stage as unknown as UIElement,
    canvas: m.surface as unknown as UIElement,
  });
  const root = header.element as unknown as HTMLElement;
  const stripRoot = strip.element as unknown as HTMLElement;
  const find = (selector: string) => root.querySelector(selector) as unknown as HTMLElement;
  /** A mouse press: pointerdown, then its click. */
  const tap = (node: HTMLElement) => {
    node.dispatchEvent(new m.win.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    node.dispatchEvent(new m.win.MouseEvent('click', { bubbles: true, detail: 1 }));
  };
  const indicators = find('.cts-header-indicators');
  const typeButton = find('.cts-header-type');
  /** A header menu entry by its label (the menus live in the toolbar's portal). */
  const item = (label: string) => {
    const text = Array.from(m.doc.querySelectorAll('.cts-header-menu .cts-item-label')).find((node) => node.textContent === label);
    assert.ok(text, `header menu item ${label}`);
    return text.closest('.cts-item') as unknown as HTMLElement;
  };
  const pickType = (type: SeriesType) => {
    tap(typeButton);
    tap(item(CHART_TYPE_LABELS[type]));
  };
  const pressed = (buttons: Iterable<unknown>) =>
    Array.from(buttons as Iterable<HTMLElement>).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
  /** Pressed quick toggles: [header, on-chart strip]. */
  const modes = () => [pressed(root.querySelectorAll('.cts-header-scale-btn')), pressed(stripRoot.querySelectorAll('.cts-scale-btn'))];
  const scale = (label: string) => Array.from(root.querySelectorAll('.cts-header-scale-btn')).find((b) => b.textContent === label) as unknown as HTMLElement;
  const stripButton = (letter: string) => Array.from(stripRoot.querySelectorAll('.cts-scale-btn')).find((b) => b.textContent === letter) as unknown as HTMLElement;
  /** The strip's box as [left, top, width, height], or null while hidden. */
  const box = () => stripRoot.style.display === 'none' ? null : [stripRoot.style.left, stripRoot.style.top, stripRoot.style.width, stripRoot.style.height];
  const destroy = () => {
    strip.destroy();
    header.destroy();
    m.destroy();
  };
  return { header, strip, root, stripRoot, tap, indicators, typeButton, item, pickType, modes, scale, stripButton, box, destroy };
}

/** `count` bars at `intervalMs`, the last one open at `nowMs`, with a `gap`-bar hole before bar `gapAt`. */
function barsAt(intervalMs: number, nowMs: number, count = 120, gapAt = 60, gap = 5): Candle[] {
  const step = intervalMs / 1000;
  const last = Math.floor(nowMs / intervalMs) * step;
  return Array.from({ length: count }, (_, i) => ({ ...bar(i), time: last + (i - (count - 1) - (i < gapAt ? gap : 0)) * step }));
}

/**
 * A stand-in for `@bloxwap/chart/datafeed`'s history datafeed, doing what its
 * `setSymbol` does to the chart: pin both intervals, swap the bars and scroll
 * to the end in one batch, and report the new state.
 */
function standInDatafeed(chart: Mounted['chart'], nowMs: number) {
  const listeners = new Set<(state: { symbol: string | null; intervalMs: number | null }) => void>();
  const loads: [string, number][] = [];
  const feed = {
    symbol: null as string | null,
    intervalMs: null as number | null,
    /** The bars last loaded. */
    bars: [] as Candle[],
    setSymbol(symbol: string, intervalMs: number): Promise<void> {
      loads.push([symbol, intervalMs]);
      feed.symbol = symbol;
      feed.intervalMs = intervalMs;
      const bars = feed.bars = barsAt(intervalMs, nowMs);
      chart.batch(() => {
        chart.updateConfig({ timeAxis: { intervalMs }, timeScale: { intervalMs } });
        chart.setData(bars);
        chart.scale.scrollTo(bars.length - 1);
      });
      for (const listener of listeners) listener({ symbol, intervalMs });
      return Promise.resolve();
    },
    subscribeState(listener: (state: { symbol: string | null; intervalMs: number | null }) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { feed, loads };
}

describe('integration: the chart header and on-chart scale toggles on the toolbar page', () => {
  it('opens the indicators picker from the header one popover at a time; a sub-pane study moves the on-chart toggles and focus comes back', () => {
    const m = mount({ preset: 'bloxwapDark', config: { series: { type: 'heikin-ashi' }, timeScale: { continuous: true } }, chartTheme: presetChartTheme('bloxwapDark') });
    const h = withHeader(m);
    const d = dialogOf(m);
    const full = m.chart.plotArea;
    assert.equal(full.left, 0);
    assert.deepEqual(h.box(), [`${full.width}px`, '0px', `${WIDTH - full.width}px`, `${full.height}px`], 'the strip sits on the right price axis');

    m.settings.open();
    h.tap(h.typeButton);
    assert.ok(m.card.hasAttribute('hidden'), 'a header press closes the settings card');
    const menu = m.tb.flyouts.open as unknown as HTMLElement;
    assert.ok(menu.classList.contains('cts-header-menu'), "the chart-type menu opens in the toolbar's flyouts");
    assert.equal(h.typeButton.getAttribute('aria-expanded'), 'true');

    h.indicators.focus();
    h.tap(h.indicators);
    assert.equal(m.tb.flyouts.open, null, 'the Indicators press closes the header menu');
    assert.equal(h.typeButton.getAttribute('aria-expanded'), 'false');
    assert.equal(m.dialog.view, 'picker');
    assert.ok(m.card.hasAttribute('hidden'));
    h.tap(h.indicators);
    assert.equal(m.dialog.view, 'picker', 'a second press leaves the picker open');
    assert.equal(m.doc.querySelectorAll('.cts-ind-dialog').length, 1);

    d.add('rsi');
    assert.deepEqual(m.chart.getConfig().indicators.map((k) => [k.name, k.pane]), [['rsi', 'sub']]);
    const main = m.chart.plotArea.height;
    assert.ok(main < full.height);
    assert.deepEqual(h.box(), [`${full.width}px`, '0px', `${WIDTH - full.width}px`, `${main}px`], 'the strip rides the main pane up with no refresh');
    assert.deepEqual(h.modes(), [['Auto'], ['A']]);

    const search = d.root.querySelector('[type="search"]');
    for (let i = 0; i < 2 && m.dialog.view !== null; i++) d.key(search, 'Escape');
    assert.equal(m.dialog.view, null);
    assert.equal(m.doc.activeElement, h.indicators, 'closing the picker hands focus back to the header button');

    toolbarItem(m, 'Remove indicators').click();
    assert.deepEqual(h.box(), [`${full.width}px`, '0px', `${WIDTH - full.width}px`, `${full.height}px`], "the toolbar's Remove indicators gives the pane back");
    h.destroy();
  });

  it('keeps the header, the on-chart strip, the settings card and the toolbar shortcuts on one scale mode', () => {
    const m = mount();
    const h = withHeader(m);
    const mode = () => m.chart.getConfig().priceAxis.mode;
    const cardMode = () => m.card.querySelector<HTMLSelectElement>('select[name="scale-mode"]')!.value;
    assert.deepEqual(h.modes(), [['Auto'], ['A']]);

    h.tap(h.scale('Log'));
    assert.equal(mode(), 'logarithmic');
    assert.deepEqual(h.modes(), [['Auto', 'Log'], ['A', 'L']]);
    m.settings.open();
    assert.equal(cardMode(), 'logarithmic', 'the card opens on the mode the header set');
    m.select('scale-mode', 'percent');
    assert.deepEqual(h.modes(), [['Auto', '%'], ['A', '%']], 'the card drives both toggle groups');
    m.select('scale-mode', 'indexed');
    assert.deepEqual(h.modes(), [['Auto'], ['A']], 'indexed lights neither % nor Log');
    m.check('autoScale');
    assert.deepEqual(h.modes(), [[], []]);
    m.settings.close();

    m.doc.body.dispatchEvent(new m.win.KeyboardEvent('keydown', { key: 'l', code: 'KeyL', altKey: true, bubbles: true, cancelable: true }));
    assert.equal(mode(), 'logarithmic', "the toolbar's Alt+L");
    assert.deepEqual(h.modes(), [['Log'], ['L']]);
    h.tap(h.stripButton('%'));
    assert.equal(mode(), 'percent');
    assert.deepEqual(h.modes(), [['%'], ['%']], 'the strip drives the header too');
    m.settings.open();
    assert.equal(cardMode(), 'percent');

    // A header-picked chart type; the card's axis controls move and hide the strip.
    h.pickType('line');
    assert.ok(m.card.hasAttribute('hidden'));
    m.settings.open();
    m.select('scale-position', 'left');
    let plot = m.chart.plotArea;
    assert.ok(plot.left > 0);
    assert.deepEqual(h.box(), ['0px', '0px', `${plot.left}px`, `${plot.height}px`], 'the strip follows the axis to the left');
    m.check('price-axis');
    assert.equal(h.box(), null, 'and hides with it');
    m.check('price-axis');
    m.check('time-axis');
    plot = m.chart.plotArea;
    assert.equal(plot.height, HEIGHT);
    assert.deepEqual(h.box(), ['0px', '0px', `${plot.left}px`, `${HEIGHT}px`], 'and reaches the bottom without a time axis');

    m.reset();
    plot = m.chart.plotArea;
    assert.deepEqual(h.modes(), [['Auto'], ['A']], 'Reset defaults shows on both groups');
    assert.deepEqual(h.box(), [`${plot.width}px`, '0px', `${WIDTH - plot.width}px`, `${plot.height}px`]);
    assert.equal(m.chart.getConfig().series.type, 'line', 'Reset keeps the chart type picked in the header');
    assert.equal(h.typeButton.title, 'Chart type: Line');
    h.destroy();
  });

  it('switches to Heikin Ashi from the header under bloxwapDark; theme toggles keep it and restyle the header and its menus', () => {
    const m = mount({ preset: 'bloxwapDark', chartTheme: presetChartTheme('bloxwapDark') });
    const picked: SeriesType[] = [];
    const h = withHeader(m, { onChartTypeChange: (type) => picked.push(type) });
    const volume = m.chart.getConfig().volume;
    assert.equal(volume.overlay, true);
    h.pickType('heikin-ashi');
    assert.deepEqual(picked, ['heikin-ashi']);
    assert.equal(h.typeButton.title, 'Chart type: Heikin Ashi');
    m.frame();
    assert.ok(volumeFollowsHeikinAshi(m, volume.opacity, '#00ff3f', '#ff479c') > 0, 'the volume overlay follows the Heikin Ashi bars');

    const light = CHART_THEMES.light.series!;
    const menu = h.item('Heikin Ashi').closest('.cts-header-menu')!;
    for (const theme of ['light', 'dark'] as const) {
      m.setTheme(theme);
      h.header.setTheme(theme);
      h.strip.setTheme(theme);
      assert.equal(m.chart.getConfig().series.type, 'heikin-ashi', `${theme}: the theme keeps the header's chart type`);
      assert.equal(h.typeButton.title, 'Chart type: Heikin Ashi');
      assert.equal(h.item('Heikin Ashi').getAttribute('aria-checked'), 'true');
      for (const node of [h.root, h.stripRoot]) assert.equal(node.classList.contains('cts-light'), theme === 'light');
      assert.equal(menu.closest('.cts-light') !== null, theme === 'light', `${theme}: the header menus follow the toolbar portal`);
      m.frame();
      const [up, down] = theme === 'light' ? [light.upColor!, light.downColor!] : ['#00ff3f', '#ff479c'];
      assert.ok(volumeFollowsHeikinAshi(m, volume.opacity, up, down) > 0);
    }
    m.settings.open();
    m.reset();
    assert.equal(m.chart.getConfig().series.type, 'heikin-ashi', 'Reset keeps it too');
    h.pickType('heikin-ashi');
    assert.deepEqual(picked, ['heikin-ashi'], 're-picking the shown type reports nothing');
    h.pickType('candlestick');
    assert.deepEqual(picked, ['heikin-ashi', 'candlestick']);
    assert.equal(m.chart.getConfig().series.type, 'candlestick');
    h.destroy();
  });

  it('reloads the datafeed on a header timeframe pick; the countdown and the continuous axis take the new interval', () => {
    const m = mount({ config: { series: { type: 'heikin-ashi' }, timeScale: { continuous: true }, priceAxis: { labels: { countdown: true } } } });
    const { feed, loads } = standInDatafeed(m.chart, NOW);
    void feed.setSymbol('BTC', 60_000);
    const picked: string[] = [];
    const h = withHeader(m, {
      symbol: 'SOL',
      datafeed: feed,
      onTimeframeChange: (tf) => {
        m.tb.cancelNavigation();
        picked.push(tf.label);
      },
    });
    const tf = (label: string) => Array.from(h.root.querySelectorAll('.cts-header-tf')).find((b) => b.textContent === label) as unknown as HTMLElement;
    const active = () => Array.from(h.root.querySelectorAll('.cts-header-tf.cts-active')).map((b) => b.textContent);
    assert.deepEqual([h.header.symbol, h.header.intervalMs, active()], ['BTC', 60_000, ['1m']], "the header starts from the datafeed's state, not a stale option");

    const shows = (intervalMs: number) => {
      const bars = feed.bars;
      assert.equal(m.chart.dataLength, 120);
      const text = formatCountdown(barCountdownMs(bars, intervalMs, NOW)!);
      const ctx = m.frame();
      assert.ok(ctx.texts().some((t) => t.text === text && t.x > m.chart.plotArea.width), `the countdown badge reads ${text}`);
      const spacing = m.chart.scale.barSpacing();
      close(m.chart.scale.indexToX(60) - m.chart.scale.indexToX(59), 6 * spacing, 1e-6);
      close(m.chart.scale.indexToX(119) - m.chart.scale.indexToX(118), spacing, 1e-6);
    };
    shows(60_000);
    h.tap(tf('5m'));
    assert.deepEqual(loads, [['BTC', 60_000], ['BTC', 300_000]]);
    assert.deepEqual(picked, ['5m']);
    assert.deepEqual(active(), ['5m']);
    const { timeAxis, timeScale } = m.chart.getConfig();
    assert.deepEqual([timeAxis.intervalMs, timeScale.intervalMs, timeScale.continuous], [300_000, 300_000, true]);
    shows(300_000);
    assert.notEqual(formatCountdown(barCountdownMs(feed.bars, 300_000, NOW)!), formatCountdown(barCountdownMs(feed.bars, 60_000, NOW)!));

    void feed.setSymbol('ETH', 3_600_000);
    assert.deepEqual([h.header.symbol, h.header.intervalMs, active()], ['ETH', 3_600_000, ['1h']], 'the header follows a switch made elsewhere');
    assert.equal(h.root.querySelector('.cts-header-symbol')!.textContent, 'ETH');
    shows(3_600_000);
    h.tap(tf('1h'));
    assert.equal(loads.length, 3, 're-picking the loaded interval does not reload');
    h.destroy();
  });

  it("keeps the header menus' keys from the toolbar shortcuts, while Alt+L on a header button still reaches them", () => {
    const m = mount();
    const h = withHeader(m);
    const key = (target: unknown, name: string, init: Record<string, unknown> = {}) =>
      (target as HTMLElement).dispatchEvent(new m.win.KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
    m.tb.controller.arm('trendline');
    h.typeButton.focus();
    h.typeButton.dispatchEvent(new m.win.MouseEvent('click', { bubbles: true, detail: 0 }));
    assert.ok((m.tb.flyouts.open as unknown as HTMLElement).classList.contains('cts-header-menu'));
    assert.equal(m.doc.activeElement, h.item('Candles'), 'keyboard opening focuses the checked type');
    key(m.doc.activeElement, 'ArrowDown');
    assert.equal(m.doc.activeElement, h.item('Hollow candles'));
    key(m.doc.activeElement, 'Escape');
    assert.equal(m.tb.flyouts.open, null);
    assert.equal(m.doc.activeElement, h.typeButton, 'Escape hands focus back to the button');
    assert.equal(m.tb.controller.tool, 'trendline', "and never reaches the toolbar's Escape");
    key(m.doc.body, 'Escape');
    assert.equal(m.tb.controller.tool, null);

    key(h.typeButton, 'l', { code: 'KeyL', altKey: true });
    assert.equal(m.chart.getConfig().priceAxis.mode, 'logarithmic');
    assert.deepEqual(h.modes(), [['Auto', 'Log'], ['A', 'L']]);
    h.destroy();
  });
});

/** The toolbar's right-click menu on a {@link mount}ed page (`contextMenu: true`), driven by mouse right-clicks. */
function contextMenuOf(m: Mounted) {
  const menu = m.tb.contextMenu!;
  assert.ok(menu, 'mount({ contextMenu: true })');
  const root = menu.element as unknown as HTMLElement;
  const mouse = (type: string, x: number, y: number) => {
    const event = new m.win.PointerEvent(type, { clientX: x, clientY: y, button: 2, pointerId: 1, pointerType: 'mouse', bubbles: true, cancelable: true });
    m.surface.dispatchEvent(event);
    return event;
  };
  /** A mouse right-click at canvas `(x, y)`: press, `contextmenu`, release. */
  const rightClick = (x: number, y: number) => {
    mouse('pointerdown', x, y);
    const event = mouse('contextmenu', x, y);
    mouse('pointerup', x, y);
    return event;
  };
  const rows = () => Array.from(root.querySelectorAll('.cts-item')) as unknown as HTMLElement[];
  const labels = () => rows().map((row) => row.querySelector('.cts-item-label')!.textContent);
  const row = (label: string) => {
    const found = rows().find((node) => node.querySelector('.cts-item-label')!.textContent === label);
    assert.ok(found, `context menu row "${label}" in [${labels().join(', ')}]`);
    return found;
  };
  const click = (label: string) => row(label).click();
  const checked = (label: string) => row(label).getAttribute('aria-checked');
  const isOpen = () => root.classList.contains('cts-open');
  /** A canvas point in column `x` that a right-click would target at indicator plot `key` of `id`, or undefined. */
  const plotPoint = (id: string, key: string, x: number): { x: number; y: number } | undefined => {
    for (let y = 0; y < HEIGHT; y++) {
      const target = menu.targetAt(x, y);
      if (target.kind === 'indicator' && target.id === id && target.key === key) return { x, y };
    }
    return undefined;
  };
  return { menu, root, rightClick, labels, row, click, checked, isOpen, plotPoint };
}

describe('integration: P2.12 context menus on the toolbar page', () => {
  it("routes Settings… to the settings card, the study's settings and the drawing's style bar, one popover at a time", () => {
    const m = mount({ contextMenu: true, config: { series: { type: 'heikin-ashi' }, timeScale: { continuous: true } } });
    const h = withHeader(m);
    const c = contextMenuOf(m);
    const d = dialogOf(m);

    // The menu shares the toolbar's flyouts with the header: opening it closes the header's chart-type menu.
    h.tap(h.typeButton);
    assert.ok(m.tb.flyouts.open !== null);
    c.rightClick(300, 60);
    assert.deepEqual([c.menu.target?.kind, m.tb.flyouts.open, h.typeButton.getAttribute('aria-expanded')], ['chart', null, 'false']);
    assert.deepEqual(c.labels(), ['Reset chart view', 'Auto (fits data to screen)', 'Logarithmic', 'Percent', 'Chart settings…']);
    c.click('Chart settings…');
    assert.equal(c.isOpen(), false);
    assert.ok(!m.card.hasAttribute('hidden'), 'Chart settings… opens the card');

    // An overlay line on the continuous axis, past the gap: its Settings… swaps the card for the study's settings.
    const sma = m.chart.addIndicator({ name: 'sma', params: { period: 1 } });
    const rsi = m.chart.addIndicator({ name: 'rsi' });
    const onSma = () => ({ x: m.chart.scale.indexToX(120), y: m.chart.scale.priceToY(DATA[120]!.close) });
    let at = onSma();
    c.rightClick(at.x, at.y);
    assert.ok(m.card.hasAttribute('hidden'), "the right-click's press closes the card");
    assert.deepEqual(c.menu.target, { kind: 'indicator', id: sma, key: 'value', ...at });
    c.click('Settings…');
    assert.equal(m.dialog.view, 'settings');
    assert.equal(d.field('input-period').value, '1', 'the settings of the study under the pointer');
    d.press('Cancel');
    assert.equal(m.dialog.view, null);

    // A sub-pane study: its menu reaches its own settings.
    const x = m.chart.scale.indexToX(140);
    const onRsi = c.plotPoint(rsi, 'value', x);
    assert.ok(onRsi !== undefined && onRsi.y > m.chart.plotArea.height, 'the RSI line is a target in its pane');
    c.rightClick(onRsi.x, onRsi.y);
    c.click('Settings…');
    assert.deepEqual([m.dialog.view, d.field('input-period').value], ['settings', '14']);
    // Removing the study whose settings are open (the menu opens over the dialog) closes them.
    c.rightClick(onRsi.x, onRsi.y);
    assert.equal(c.menu.target?.kind, 'indicator');
    c.click('Remove');
    assert.equal(m.chart.getIndicator(rsi), undefined);
    assert.equal(m.dialog.view, null, 'the dialog drops settings of the study the menu removed');

    // Hide from the menu (the main pane took the RSI pane's room); the header's Indicators picker shows it off and brings it back.
    at = onSma();
    c.rightClick(at.x, at.y);
    c.click('Hide');
    assert.equal(m.chart.getIndicator(sma)!.visible, false);
    assert.equal(c.menu.targetAt(at.x, at.y).kind, 'chart', 'a hidden study is no target');
    h.tap(h.indicators);
    assert.equal(m.dialog.view, 'picker');
    const row = d.rows()[0]!;
    assert.ok(row.classList.contains('cts-ind-off'));
    (row.querySelector('.cts-ind-visibility') as unknown as HTMLElement).click();
    assert.equal(m.chart.getIndicator(sma)!.visible, true);
    assert.deepEqual(c.menu.targetAt(at.x, at.y), { kind: 'indicator', id: sma, key: 'value', ...at });
    m.dialog.close();
    m.chart.removeIndicator(sma);

    // A drawing: the right-click selects it and shows its style bar; Settings… hands that bar the keyboard.
    const trend = m.chart.addDrawing({ name: 'trendline', points: [{ index: 100, price: 95 }, { index: 140, price: 105 }] });
    const mid = { x: m.chart.scale.indexToX(120), y: m.chart.scale.priceToY(100) };
    const bar = m.doc.querySelector('.cts-style-bar') as unknown as HTMLElement;
    c.rightClick(mid.x, mid.y);
    assert.equal(m.chart.selectedDrawing, trend);
    assert.ok(bar.classList.contains('cts-visible'));
    assert.deepEqual(c.labels().slice(0, 2), ['Settings…', 'Clone']);
    c.click('Settings…');
    assert.ok(m.doc.activeElement === bar, "Settings… focuses the drawing's style bar");
    assert.equal(m.actions.at(-1), 'drawing-settings');
    const lock = () => bar.querySelector('[title="Unlock drawing"]') !== null;
    c.rightClick(mid.x, mid.y);
    c.click('Lock');
    assert.deepEqual([m.chart.getDrawing(trend)!.locked, lock()], [true, true], 'the style bar shows the lock the menu set');
    m.tb.controller.undo();
    assert.deepEqual([m.chart.getDrawing(trend)!.locked, lock()], [false, false], 'and undo takes it back');

    // Under Lock all, the menu leaves the selection alone until Settings… asks for the style bar.
    m.tb.controller.setLocked(true);
    c.rightClick(mid.x, mid.y);
    assert.deepEqual([c.menu.target?.kind, m.chart.selectedDrawing, bar.classList.contains('cts-visible')], ['drawing', null, false]);
    c.click('Settings…');
    assert.deepEqual([m.chart.selectedDrawing, bar.classList.contains('cts-visible')], [trend, true]);
    assert.ok(m.doc.activeElement === bar);
    c.rightClick(mid.x, mid.y);
    c.click('Hide');
    assert.equal(bar.classList.contains('cts-visible'), false, 'hiding it clears the style bar');
    assert.deepEqual(m.actions, ['chart-settings', 'indicator-settings', 'indicator-settings', 'remove-indicator', 'hide-indicator', 'drawing-settings', 'lock', 'drawing-settings', 'hide-drawing']);
    h.destroy();
  });

  it('a host onDrawingSettings replaces the style bar; without the option the menu stays off', () => {
    const opened: string[] = [];
    const m = mount();
    assert.equal(m.tb.contextMenu, null);
    m.destroy();
    const win = new Window({ url: 'http://localhost/', width: 1200, height: 800 });
    windows.push(win);
    const doc = win.document;
    const surface = doc.createElement('div');
    const rail = doc.createElement('div');
    doc.body.append(rail, surface);
    const chart = createChart({ document: new RecDocument(), config: { wasm: false, width: WIDTH, height: HEIGHT, data: DATA } });
    const tb = createDrawingToolbar({
      chart, document: doc as unknown as UIDocument, canvas: surface as unknown as UIElement, rail: rail as unknown as UIElement,
      overlay: surface as unknown as UIElement, scheduler: new TestFrames(), contextMenu: { onDrawingSettings: (id) => opened.push(id) },
    });
    const trend = chart.addDrawing({ name: 'trendline', points: [{ index: 100, price: 95 }, { index: 140, price: 105 }] });
    tb.contextMenu!.open(chart.scale.indexToX(120), chart.scale.priceToY(100));
    const settings = Array.from((tb.contextMenu!.element as unknown as HTMLElement).querySelectorAll('.cts-item')).find((row) => row.textContent === 'Settings…');
    (settings as unknown as HTMLElement).click();
    assert.deepEqual(opened, [trend]);
    assert.ok(doc.activeElement !== doc.querySelector('.cts-style-bar'), 'the host took Settings…');
    tb.destroy();
    chart.destroy();
  });

  it('keeps the menu, the header, the on-chart strip and the settings card on one price scale', () => {
    const m = mount({ contextMenu: true });
    const h = withHeader(m);
    const c = contextMenuOf(m);
    const cardMode = () => m.card.querySelector<HTMLSelectElement>('select[name="scale-mode"]')!.value;
    const toggles = () => {
      c.rightClick(300, 60);
      const state = ['Auto (fits data to screen)', 'Logarithmic', 'Percent'].map(c.checked);
      c.menu.close();
      return state;
    };
    assert.deepEqual(toggles(), ['true', 'false', 'false']);

    c.rightClick(300, 60);
    c.click('Logarithmic');
    assert.deepEqual(h.modes(), [['Auto', 'Log'], ['A', 'L']], 'the header and the strip follow the menu');
    m.settings.open();
    assert.equal(cardMode(), 'logarithmic');
    m.settings.close();
    h.tap(h.scale('%'));
    assert.deepEqual(toggles(), ['true', 'false', 'true'], 'the menu opens on what the header set');
    c.rightClick(300, 60);
    c.click('Percent');
    assert.equal(m.chart.getConfig().priceAxis.mode, 'regular', 'a checked mode toggles back to regular');
    c.rightClick(300, 60);
    c.click('Auto (fits data to screen)');
    assert.deepEqual(h.modes(), [[], []]);
    h.tap(h.stripButton('L'));
    assert.deepEqual(toggles(), ['false', 'true', 'false']);

    // Reset chart view turns autoscale back on and keeps the mode, on every control.
    c.rightClick(300, 60);
    c.click('Reset chart view');
    assert.deepEqual(h.modes(), [['Auto', 'Log'], ['A', 'L']]);
    m.settings.open();
    assert.equal(m.input('autoScale').checked, true);
    assert.equal(cardMode(), 'logarithmic');
    assert.deepEqual(m.actions, ['log-scale', 'percent-scale', 'auto-scale', 'reset-view']);
    h.destroy();
  });

  it('Reset chart view on the continuous axis brings back the default view with its gaps and reports one range change', () => {
    const config: DeepPartial<ChartConfig> = { series: { type: 'heikin-ashi' }, timeScale: { continuous: true }, priceAxis: { mode: 'logarithmic' } };
    const m = mount({ contextMenu: true, config });
    const c = contextMenuOf(m);
    const spacing = m.chart.scale.barSpacing();
    const initial = m.frame().ops.slice();
    const text = (ops: readonly Op[]) => ops.filter((o): o is Text => o.kind === 'text').map((o) => [o.text, Math.round(o.x), Math.round(o.y)]);
    const gap = () => m.chart.scale.indexToX(GAP_AT) - m.chart.scale.indexToX(GAP_AT - 1);
    close(gap(), (GAP_MIN + 1) * spacing);
    const away = () => {
      m.chart.scale.zoom(2.5);
      m.chart.scale.scrollBy(40);
      m.chart.render();
      assert.notEqual(m.chart.scale.barSpacing(), spacing);
    };
    const reset = () => {
      c.rightClick(300, 60);
      c.click('Reset chart view');
    };

    // Zoomed, scrolled into history, with the price range frozen and the ratio locked through the API.
    away();
    m.chart.updateConfig({ priceAxis: { autoScale: false, lockPriceToBarRatio: true } });
    const ranges: VisibleRangeChangeEvent[] = [];
    m.chart.subscribeVisibleRangeChange((e) => ranges.push(e));
    reset();
    assert.equal(ranges.length, 1, 'one range change');
    const { from, to } = m.chart.scale.visibleRange();
    assert.deepEqual([ranges[0]!.from, ranges[0]!.to, to], [from, N, N], 'the latest bar is in view');
    close(ranges[0]!.barsAfter, 0);
    assert.equal(m.chart.scale.barSpacing(), spacing);
    close(m.chart.scale.indexToX(N - 1), m.chart.plotArea.width - spacing / 2);
    close(gap(), (GAP_MIN + 1) * spacing, 1e-6);
    let { priceAxis, timeScale } = m.chart.getConfig();
    assert.deepEqual([priceAxis.autoScale, priceAxis.mode, priceAxis.lockPriceToBarRatio, timeScale.continuous], [true, 'logarithmic', true, true]);
    assert.deepEqual(text(m.frame().ops), text(initial), 'the ratio is re-captured from the reset view: the same labels in the same places');

    // The settings card's lock pins its ratio in the config: a setting, which Reset chart view keeps.
    m.chart.updateConfig({ priceAxis: { lockPriceToBarRatio: false } });
    away();
    m.settings.open();
    m.check('autoScale');
    m.check('lockPriceToBarRatio');
    m.settings.close();
    const pinned = m.chart.getConfig().priceAxis.priceToBarRatio!;
    assert.ok(pinned > 0);
    reset();
    ({ priceAxis } = m.chart.getConfig());
    assert.deepEqual([priceAxis.autoScale, priceAxis.priceToBarRatio, m.chart.scale.barSpacing()], [true, pinned, spacing]);
    close(m.chart.scale.priceToBarRatio(), pinned, 1e-9);
    close(m.chart.scale.indexToX(N - 1), m.chart.plotArea.width - spacing / 2);

    // Unlock it in the card and the frame is exactly the one the chart opened with.
    m.settings.open();
    m.check('lockPriceToBarRatio');
    m.settings.close();
    assert.deepEqual(m.frame().ops, initial);
    m.destroy();
  });

  it("targets indicator plots as drawn: the dialog's plot toggles, the continuous gaps and Heikin Ashi bars", () => {
    const m = mount({ contextMenu: true, config: { series: { type: 'heikin-ashi' }, timeScale: { continuous: true } } });
    const c = contextMenuOf(m);
    const d = dialogOf(m);
    const sma = m.chart.addIndicator({ name: 'sma', params: { period: 1 } });
    const macd = m.chart.addIndicator({ name: 'macd' });

    // The SMA(1) of the real closes joins the bars either side of the gap across the empty slots.
    const [x0, x1] = [m.chart.scale.indexToX(GAP_AT - 1), m.chart.scale.indexToX(GAP_AT)];
    const [y0, y1] = [m.chart.scale.priceToY(DATA[GAP_AT - 1]!.close), m.chart.scale.priceToY(DATA[GAP_AT]!.close)];
    assert.ok(x1 - x0 > 100);
    const across = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    c.rightClick(across.x, across.y);
    assert.deepEqual(c.menu.target, { kind: 'indicator', id: sma, key: 'value', ...across });
    assert.deepEqual(c.labels(), ['Settings…', 'Hide', 'Remove']);
    c.menu.close();

    // A MACD signal point: hiding the signal plot in the dialog takes it out of reach.
    let signal: { x: number; y: number } | undefined;
    for (let i = N - 30; i < N && signal === undefined; i++) signal = c.plotPoint(macd, 'dea', m.chart.scale.indexToX(i));
    assert.ok(signal !== undefined && signal.y > m.chart.plotArea.height);
    m.dialog.openSettings(macd);
    d.field('visible-dea').click();
    d.press('OK');
    const target = c.menu.targetAt(signal.x, signal.y);
    assert.ok(target.kind !== 'indicator' || target.key !== 'dea', 'a hidden plot is no target');
    assert.equal(c.plotPoint(macd, 'dea', signal.x), undefined);
    assert.ok(c.plotPoint(macd, 'dif', signal.x) !== undefined, 'the MACD line still is');

    // The toolbar's Hide indicators takes every study out of reach until it is turned off.
    toolbarItem(m, 'Hide indicators').click();
    assert.equal(c.menu.targetAt(across.x, across.y).kind, 'chart');
    c.rightClick(across.x, across.y);
    assert.ok(!c.labels().includes('Hide'));
    c.click('Remove all indicators');
    assert.deepEqual(m.chart.getConfig().indicators, []);
    m.destroy();
  });
});

/** Price factor per symbol, so each symbol's bars differ. */
const SYMBOL_SCALE: Readonly<Record<string, number>> = { BTC: 1, ETH: 0.5 };

/**
 * A Hyperliquid-like history source for the real datafeed: per symbol and
 * interval, the `keep` latest buckets up to {@link NOW} exist, minus a
 * `gap`-bucket hole ending `gapBack` buckets before the latest bar. A read
 * returns the bars opening within its inclusive window and ignores the abort
 * signal; while `hold` is set, reads wait for `release`.
 */
function historySource(keep = 125, gapBack = 20, gap = 5) {
  const requests: FetchBarsRequest[] = [];
  const parked: (() => void)[] = [];
  /** Every bar the source has, oldest first. */
  const all = (intervalMs: number, symbol = 'BTC'): Candle[] => {
    const latest = Math.floor(NOW / intervalMs);
    const k = SYMBOL_SCALE[symbol]!;
    const out: Candle[] = [];
    for (let i = 0; i < keep; i++) {
      const back = keep - 1 - i;
      if (back > gapBack && back <= gapBack + gap) continue;
      const b = bar(i);
      out.push({ time: ((latest - back) * intervalMs) / 1000, open: b.open * k, high: b.high * k, low: b.low * k, close: b.close * k, volume: b.volume! });
    }
    return out;
  };
  const source = {
    requests,
    hold: false,
    all,
    fetchBars: (request: FetchBarsRequest): Promise<readonly Candle[]> => {
      requests.push(request);
      const rows = all(request.intervalMs, request.symbol).filter((c) => c.time * 1000 >= request.fromMs && c.time * 1000 <= request.toMs);
      if (!source.hold) return Promise.resolve(rows);
      return new Promise((resolve) => parked.push(() => resolve(rows)));
    },
    /** Answers every parked read, oldest first. */
    release: () => {
      for (const answer of parked.splice(0)) answer();
    },
  };
  return source;
}

/** Lets answered reads, and the pages they chain, run to completion. */
async function settle(datafeed: Datafeed): Promise<void> {
  for (let i = 0; i < 100 && (i < 5 || datafeed.loading); i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** The chart's bars as stored. */
const storedBars = (chart: Mounted['chart']): readonly Candle[] => chart.getData();

describe('integration: P0.2 history datafeed on the toolbar page', () => {
  it("the header's timeframes drive the real datafeed and follow it; a superseded pick never lands; the countdown, the continuous axis and Reset defaults keep each interval", async () => {
    // A host that pinned the first interval up front: the settings card is built seeing it.
    const m = mount({ config: { series: { type: 'heikin-ashi' }, timeScale: { continuous: true }, timeAxis: { intervalMs: 60_000 }, priceAxis: { labels: { countdown: true } } } });
    const src = historySource();
    const errors: unknown[] = [];
    const datafeed = attachDatafeed(m.chart, { fetchBars: src.fetchBars, initialBars: 60, onError: (error) => errors.push(error) });
    const feed: HeaderDatafeed = datafeed; // the real datafeed is what the header drives
    await datafeed.setSymbol('BTC', 60_000);
    await settle(datafeed);
    const picked: string[] = [];
    const h = withHeader(m, {
      symbol: 'SOL',
      datafeed: feed,
      onTimeframeChange: (tf) => {
        m.tb.cancelNavigation();
        picked.push(tf.label);
      },
    });
    const tf = (label: string) => Array.from(h.root.querySelectorAll('.cts-header-tf')).find((b) => b.textContent === label) as unknown as HTMLElement;
    const active = () => Array.from(h.root.querySelectorAll('.cts-header-tf.cts-active')).map((b) => b.textContent);
    const header = () => [h.header.symbol, h.header.intervalMs, active(), h.root.querySelector('.cts-header-symbol')!.textContent];
    assert.deepEqual(header(), ['BTC', 60_000, ['1m'], 'BTC'], "the header starts from the datafeed's state, not a stale option");

    /** The chart holds all of `symbol`'s history at `intervalMs`, laid out and counted down at that interval. */
    const shows = (symbol: string, intervalMs: number) => {
      const bars = src.all(intervalMs, symbol);
      assert.deepEqual(storedBars(m.chart), bars, `${symbol} @ ${intervalMs}: every page landed, in order`);
      assert.equal(datafeed.exhausted, true);
      const { timeAxis, timeScale } = m.chart.getConfig();
      assert.deepEqual([timeAxis.intervalMs, timeScale.intervalMs, timeScale.continuous], [intervalMs, intervalMs, true]);
      m.frame();
      const text = formatCountdown(barCountdownMs(bars, intervalMs, NOW)!);
      assert.ok(badge(m, text) !== undefined, `the countdown badge reads ${text}`);
      const after = bars.findIndex((c, i) => i > 0 && c.time - bars[i - 1]!.time > intervalMs / 1000);
      const spacing = m.chart.scale.barSpacing();
      close(m.chart.scale.indexToX(after) - m.chart.scale.indexToX(after - 1), 6 * spacing, 1e-6);
      close(m.chart.scale.indexToX(after + 1) - m.chart.scale.indexToX(after), spacing, 1e-6);
      assert.equal(m.chart.scale.visibleRange().to, bars.length, 'the latest bar is in view');
    };
    shows('BTC', 60_000);

    h.tap(tf('5m'));
    assert.deepEqual([src.requests.at(-1)!.symbol, src.requests.at(-1)!.intervalMs], ['BTC', 300_000], 'the pick reloads the loaded symbol');
    assert.deepEqual([datafeed.loading, picked, active()], [true, ['5m'], ['5m']]);
    await settle(datafeed);
    shows('BTC', 300_000);

    // Two quick picks while the source stalls: only the last reaches the chart, though the source ignores the abort.
    const landed: (number | null)[] = [];
    m.chart.subscribeDataLoad(() => landed.push(m.chart.getConfig().timeScale.intervalMs));
    src.hold = true;
    h.tap(tf('1h'));
    h.tap(tf('15m'));
    assert.deepEqual([datafeed.intervalMs, active(), picked], [900_000, ['15m'], ['5m', '1h', '15m']]);
    src.hold = false;
    src.release();
    await settle(datafeed);
    shows('BTC', 900_000);
    assert.ok(src.requests.some((r) => r.intervalMs === 3_600_000));
    assert.ok(landed.length > 0 && landed.every((ms) => ms === 900_000), 'the superseded 1h read never landed');

    // A switch made elsewhere (a symbol search, say): the header follows it.
    await datafeed.setSymbol('ETH', 3_600_000);
    await settle(datafeed);
    assert.deepEqual(header(), ['ETH', 3_600_000, ['1h'], 'ETH']);
    shows('ETH', 3_600_000);
    const reads = src.requests.length;
    h.tap(tf('1h'));
    assert.equal(src.requests.length, reads, 're-picking the loaded interval does not reload');

    // Reset defaults restores the card's settings, not the 1m interval the card saw when it was built.
    m.settings.open();
    m.check('status-countdown');
    m.reset();
    shows('ETH', 3_600_000);
    assert.deepEqual(errors, []);
    datafeed.destroy();
    h.destroy();
  });

  it('history paged in under a working page paints exactly like a chart loaded with all of it; the selection, drafts, undo and the context menu stay on their bars', async () => {
    const options: MountOptions = {
      preset: 'bloxwapDark',
      chartTheme: presetChartTheme('bloxwapDark'),
      contextMenu: true,
      config: { series: { type: 'heikin-ashi' }, timeScale: { continuous: true }, priceAxis: { labels: { countdown: true } } },
    };
    const src = historySource();
    const all = src.all(60_000);
    const a = mount(options);
    const h = withHeader(a);
    // a: the latest 60 bars land (the hole leaves the first read 5 short, so a second read fetches them); each page they call for waits on the source.
    src.hold = true;
    const datafeed = attachDatafeed(a.chart, { fetchBars: src.fetchBars, symbol: 'BTC', intervalMs: 60_000, initialBars: 60, pageBars: 40 });
    src.release();
    await settle(datafeed);
    assert.deepEqual(src.requests.map((r) => r.countBack), [60, 5], 'a short read does not end the load: the next asks for the bars it lacked');
    src.release();
    await settle(datafeed);
    assert.deepEqual([a.chart.dataLength, datafeed.loading, src.requests.length], [60, true, 3]);
    assert.equal(a.chart.getConfig().volume.overlay, true, "the preset's volume overlay is on");
    // b: all of it at once, as the datafeed shows a symbol.
    const b = mount(options);
    b.chart.batch(() => {
      b.chart.updateConfig({ timeAxis: { intervalMs: 60_000 }, timeScale: { intervalMs: 60_000 } });
      b.chart.setData(all);
      b.chart.scale.scrollTo(all.length - 1);
    });

    /** The same work on either page, at the same pixels, on bars given as indices of `all`. */
    const work = (m: Mounted) => {
      const off = () => m.chart.dataLength - all.length;
      const x = (i: number) => m.chart.scale.indexToX(i + off());
      const y = (price: number) => m.chart.scale.priceToY(price);
      const { controller } = m.tb;
      return {
        x,
        /** Price line, markers (one older than a's bars), a study from the picker, and a selected line with a dragged handle (an undo step). */
        setUp(openPicker: () => void): string {
          m.chart.series.createPriceLine({ price: all[100]!.close, color: '#35b5ff', title: 'entry' });
          m.chart.series.setMarkers([
            { time: all[110]!.time, position: 'aboveBar', color: '#ffb300', shape: 'arrowDown', text: 'S' },
            { time: all[20]!.time, position: 'belowBar', color: '#e91e63', shape: 'arrowUp', text: 'H' },
          ]);
          openPicker();
          dialogOf(m).add('sma');
          m.dialog.close();
          const line = m.chart.addDrawing({ name: 'trendline', points: [{ index: 90 + off(), price: 100 }, { index: 115 + off(), price: 104 }] });
          controller.select(line);
          controller.pointerDown(x(90), y(100));
          controller.pointerMove(x(93), y(97));
          controller.pointerUp(x(93), y(97));
          return line;
        },
        /** Places the first point of another line; the draft follows the pointer. */
        startLine(): void {
          controller.arm('trendline');
          controller.pointerDown(x(100), y(98));
          controller.pointerUp(x(100), y(98));
          controller.pointerMove(x(112), y(103));
        },
        finishLine(): void {
          controller.pointerDown(x(112), y(103));
          controller.pointerUp(x(112), y(103));
        },
      };
    };
    const onA = work(a);
    const onB = work(b);
    const line = onA.setUp(() => h.tap(h.indicators));
    assert.equal(onB.setUp(() => b.dialog.openPicker()), line);
    const styleBar = a.doc.querySelector('.cts-style-bar') as unknown as HTMLElement;
    assert.deepEqual([a.chart.selectedDrawing, styleBar.classList.contains('cts-visible')], [line, true]);
    assert.equal(a.frame().texts().some((t) => t.text === 'H'), false, 'a marker older than the loaded bars is not drawn yet');
    const handleX = onA.x(93);

    // The first page lands under the selection: its handle keeps its column, and the style bar stays.
    src.release();
    await settle(datafeed);
    assert.deepEqual([a.chart.dataLength, datafeed.loading], [100, true]);
    assert.deepEqual([a.chart.selectedDrawing, styleBar.classList.contains('cts-visible')], [line, true]);
    close(a.chart.scale.indexToX(a.chart.getDrawing(line)!.points[0]!.index), handleX);
    assert.equal(a.chart.handleAt(handleX, a.chart.scale.priceToY(a.chart.getDrawing(line)!.points[0]!.price)), 0);

    // The rest lands under a line being placed.
    onA.startLine();
    onB.startLine();
    src.hold = false;
    src.release();
    await settle(datafeed);
    assert.deepEqual(storedBars(a.chart), all);
    assert.equal(datafeed.exhausted, true);
    const drawings = (m: Mounted) => m.chart.getConfig().drawings.map((d) => [d.id, d.points]);
    assert.deepEqual(drawings(a), drawings(b), 'the drawings moved with their bars');
    assert.deepEqual(a.tb.controller.points, b.tb.controller.points, 'and so did the point being placed');
    /** Both frames, without the crosshair: it stays at the pointer's pixel while the new bars rescale the prices. */
    const same = (message: string) => {
      for (const m of [a, b]) {
        m.chart.clearCrosshair();
        m.frame();
      }
      assert.deepEqual(a.frame().ops, b.frame().ops, message);
    };
    same('the same frame as a chart loaded with all of it');
    assert.equal(a.ctx.texts().find((t) => t.text === 'H')?.x, a.chart.scale.indexToX(20), 'the older marker shows on its bar');

    // Finish the line, then undo it and the handle drag: every step lands on the bars it was made on.
    onA.finishLine();
    onB.finishLine();
    assert.equal(a.chart.getConfig().drawings.length, 2);
    assert.deepEqual(drawings(a), drawings(b));
    for (const m of [a, b]) {
      m.tb.controller.undo();
      m.tb.controller.undo();
    }
    assert.deepEqual(drawings(a), [[line, [{ index: 90, price: 100 }, { index: 115, price: 104 }]]]);
    assert.deepEqual(drawings(a), drawings(b));
    same('and after the undo steps');

    // The study over the new bars is a context-menu target whose Settings… open in the dialog.
    const c = contextMenuOf(a);
    const sma = a.chart.getConfig().indicators[0]!.id;
    const at = c.plotPoint(sma, 'value', a.chart.scale.indexToX(30));
    assert.ok(at !== undefined, 'the SMA over paged-in history is a target');
    c.rightClick(at.x, at.y);
    c.click('Settings…');
    assert.equal(a.dialog.view, 'settings');
    datafeed.destroy();
    h.destroy();
    b.destroy();
  });

  it("the toolbar's scroll arrows follow pages and switches; Reset chart view after paging keeps the continuous gaps", async () => {
    const m = mount({ contextMenu: true, config: { timeScale: { continuous: true } } });
    const c = contextMenuOf(m);
    const src = historySource(400);
    src.hold = true;
    const datafeed = attachDatafeed(m.chart, { fetchBars: src.fetchBars, symbol: 'BTC', intervalMs: 60_000, initialBars: 200, pageBars: 100 });
    // The hole leaves the first read 5 short; a second read fetches them.
    src.release();
    await settle(datafeed);
    src.release();
    await settle(datafeed);
    assert.deepEqual([m.chart.dataLength, datafeed.loading], [200, true]);
    const spacing = m.chart.scale.barSpacing();
    const arrow = (title: string) => m.doc.querySelector(`[title="${title}"]`) as unknown as HTMLElement;
    const arrows = () => [arrow('Scroll back (older bars)'), arrow('Scroll forward (newer bars)')].map((b) => b.classList.contains('cts-visible'));

    // Zoomed out past the loaded history (the host refreshes the toolbar after its own zoom): no older bars to page to.
    m.chart.scale.zoom(3 / spacing);
    m.tb.refreshViewport();
    assert.equal(m.chart.scale.visibleSlots().from, 0);
    assert.deepEqual(arrows(), [false, false]);

    // History lands: the back arrow shows with no host call.
    src.hold = false;
    src.release();
    await settle(datafeed);
    assert.deepEqual([m.chart.dataLength, datafeed.exhausted], [395, true]);
    assert.ok(m.chart.scale.visibleSlots().from > 0);
    assert.deepEqual(arrows(), [true, false]);

    m.chart.scale.scrollBy(80);
    m.tb.refreshViewport();
    assert.deepEqual(arrows(), [true, true]);
    // A switch lands scrolled to the latest bar: the forward arrow goes with no host call.
    await datafeed.setSymbol('BTC', 300_000);
    await settle(datafeed);
    assert.deepEqual(storedBars(m.chart), src.all(300_000));
    assert.deepEqual(arrows(), [true, false]);

    // Reset chart view from the menu, scrolled into the paged history: the default view with its gap, one range change, no read.
    m.chart.scale.scrollBy(120);
    const ranges: VisibleRangeChangeEvent[] = [];
    m.chart.subscribeVisibleRangeChange((e) => ranges.push(e));
    const reads = src.requests.length;
    c.rightClick(300, 60);
    c.click('Reset chart view');
    const n = m.chart.dataLength;
    assert.equal(ranges.length, 1);
    assert.equal(m.chart.scale.barSpacing(), spacing);
    close(m.chart.scale.indexToX(n - 1), m.chart.plotArea.width - spacing / 2);
    const gapAfter = n - 1 - 20; // the first bar after the 5-bucket hole
    close(m.chart.scale.indexToX(gapAfter) - m.chart.scale.indexToX(gapAfter - 1), 6 * spacing, 1e-6);
    assert.deepEqual(arrows(), [false, false], 'not compressed any more');
    assert.equal(src.requests.length, reads);
    datafeed.destroy();
    m.destroy();
  });
});

/** Waits (a bounded number of macrotasks) until `done()` holds. */
async function until(done: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 200 && !done(); i++) await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(done(), message);
}

describe('integration: the playground host on Chart.getData', () => {
  it('the last and mark lines, the markers and the bucket check follow getData through pages, live bars, a fallback, the continuous axis and theme toggles', async () => {
    // The playground's page: bloxwapDark, its chart theme on the toolbar, Heikin Ashi bars, and host lines in place of the built-in last-price line.
    const m = mount({
      preset: 'bloxwapDark',
      chartTheme: presetChartTheme('bloxwapDark'),
      contextMenu: true,
      config: { series: { type: 'heikin-ashi' }, priceAxis: { lines: { lastPrice: false } } },
    });
    const src = historySource(300);
    let offline = false;
    const errors: unknown[] = [];
    const datafeed = attachDatafeed(m.chart, {
      fetchBars: (request) => (offline && request.symbol === 'BTC' ? Promise.reject(new Error('offline')) : src.fetchBars(request)),
      initialBars: 150,
      pageBars: 100,
      onError: (error) => errors.push(error),
    });

    // ---- the playground's host code, on public API only ----
    let markLine: PriceLine | null = null;
    let lastLine: PriceLine | null = null;
    const setMark = (price: number) => {
      if (markLine) markLine.applyOptions({ price });
      else markLine = m.chart.series.createPriceLine({ price, color: '#35b5ff', lineStyle: 'dashed', title: 'mark' });
    };
    const setLast = (price: number) => {
      if (lastLine) lastLine.applyOptions({ price });
      else lastLine = m.chart.series.createPriceLine({ price, color: 'rgba(255, 255, 255, 0.6)', lineStyle: 'dotted', title: 'last' });
    };
    const clearLines = () => {
      markLine?.remove();
      lastLine?.remove();
      markLine = lastLine = null;
    };
    /** Buy / Sell on the latest swing low and high, in the theme's candle colors. */
    const placeMarkers = (data: readonly Candle[]) => {
      if (data.length < 120) return m.chart.series.setMarkers([]);
      const extreme = (from: number, to: number, pick: (c: Candle) => number) => data.slice(from, to).reduce((a, c) => (pick(c) > pick(a) ? c : a));
      const low = extreme(data.length - 120, data.length - 60, (c) => -c.low);
      const high = extreme(data.length - 60, data.length - 10, (c) => c.high);
      const { upColor, downColor } = m.chart.getConfig().series;
      m.chart.series.setMarkers([
        { time: low.time, position: 'belowBar', shape: 'arrowUp', color: upColor, text: 'Buy' },
        { time: high.time, position: 'aboveBar', shape: 'arrowDown', color: downColor, text: 'Sell' },
      ]);
    };
    const reasons: string[] = [];
    m.chart.subscribeDataLoad((e) => {
      reasons.push(e.reason);
      const data = m.chart.getData();
      // A load shows the latest close; a bucket roll moves the line to the bar that just closed.
      if (e.reason === 'set') {
        if (data.length > 0) setLast(data.at(-1)!.close);
        else clearLines();
        placeMarkers(data);
      } else if (e.reason === 'append' && data.length > 1) setLast(data.at(-2)!.close);
    });
    /** Loads `symbol`; the first symbol falls back to the second when its source is unreachable. */
    const load = async (symbol: string, intervalMs: number): Promise<void> => {
      if (symbol !== datafeed.symbol) clearLines();
      await datafeed.setSymbol(symbol, intervalMs);
      if (datafeed.symbol !== symbol || datafeed.intervalMs !== intervalMs) return; // superseded
      if (symbol === 'BTC' && datafeed.error !== null && m.chart.dataLength === 0) return load('ETH', intervalMs);
    };
    // The header drives the real datafeed through `load`, and follows the datafeed's own state.
    const source: HeaderDatafeed = {
      setSymbol: (symbol, intervalMs) => load(symbol, intervalMs),
      get symbol() {
        return datafeed.symbol;
      },
      get intervalMs() {
        return datafeed.intervalMs;
      },
      subscribeState: (listener) => datafeed.subscribeState(listener),
    };
    const h = withHeader(m, { datafeed: source });
    /** `window.__chartStats`: duplicate and missing buckets in what the chart holds. */
    const stats = () => {
      const data = m.chart.getData();
      const step = datafeed.intervalMs! / 1000;
      let duplicates = 0;
      let missing = 0;
      for (let i = 1; i < data.length; i++) {
        const gap = data[i]!.time - data[i - 1]!.time;
        if (gap <= 0) duplicates++;
        else missing += Math.round(gap / step) - 1;
      }
      return { bars: data.length, duplicates, missing };
    };
    const lines = () => m.chart.series.priceLines().map((line) => [line.options().title, line.options().price]);
    const markerAt = (text: string) => m.frame().texts().find((t) => t.text === text)?.x;
    const indexOf = (time: number) => m.chart.getData().findIndex((c) => c.time === time);

    // The first load lands (two reads: the hole leaves the first 5 short); the first page it calls for waits on the source.
    src.hold = true;
    const first = load('BTC', 60_000);
    src.release();
    await settle(datafeed);
    src.release();
    await first;
    assert.deepEqual([m.chart.dataLength, datafeed.loading], [150, true]);
    assert.deepEqual(m.chart.getData(), src.all(60_000).slice(-150));
    const raw = m.chart.getData().at(-1)!;
    assert.deepEqual(lines(), [['last', raw.close]], 'the last line sits on the real close');
    assert.notEqual(heikinAshi(m.chart.getData()).at(-1)!.close, raw.close, 'which is not the Heikin Ashi close on screen');
    const markers = m.chart.series.markers();
    assert.deepEqual(markers.map((mk) => mk.text), ['Buy', 'Sell']);
    const buyX = markerAt('Buy');
    assert.equal(buyX, m.chart.scale.indexToX(indexOf(markers[0]!.time)));
    assert.deepEqual(stats(), { bars: 150, duplicates: 0, missing: 5 });

    // History pages in (as drags to the left edge would): the markers keep their bars and pixels, the lines their prices, and no bucket repeats or goes missing.
    src.hold = false;
    src.release();
    await settle(datafeed);
    while (!datafeed.exhausted) await datafeed.loadMore();
    assert.deepEqual(m.chart.getData(), src.all(60_000));
    assert.ok(reasons.includes('prepend'));
    assert.deepEqual(m.chart.series.markers(), markers);
    assert.equal(markerAt('Buy'), buyX);
    assert.equal(markerAt('Buy'), m.chart.scale.indexToX(indexOf(markers[0]!.time)));
    assert.deepEqual(lines(), [['last', raw.close]]);
    assert.deepEqual(stats(), { bars: 295, duplicates: 0, missing: 5 });

    // Live mids, a second apart: 'update's fold into the forming bar, then the roll moves the last line to the bar that closed.
    reasons.length = 0;
    const rollAt = (Math.floor(NOW / 60_000) + 1) * 60_000;
    let price = raw.close;
    for (let t = NOW + 1000; t <= rollAt; t += 1000) {
      m.clock.now = t;
      price += 0.25;
      datafeed.pushTick(price, 'BTC');
      datafeed.pushTick(price * 3, 'SOL'); // another coin's mid: ignored
      setMark(price);
    }
    assert.deepEqual([reasons.length, reasons.at(-1), reasons.filter((r) => r !== 'update').length], [40, 'append', 1]);
    const closed = m.chart.getData().at(-2)!;
    assert.equal(closed.close, price - 0.25);
    assert.deepEqual(lines(), [['last', closed.close], ['mark', price]]);
    assert.notEqual(heikinAshi(m.chart.getData()).at(-2)!.close, closed.close, 'the real close, not the Heikin Ashi one');
    assert.deepEqual(m.chart.getData().at(-1), { time: rollAt / 1000, open: closed.close, high: price, low: closed.close, close: price, volume: 0 });
    assert.deepEqual(stats(), { bars: 296, duplicates: 0, missing: 5 });

    // A mid two buckets late: the gap read finds nothing newer, so the tick opens a bar and the missed buckets show in the check.
    m.clock.now = rollAt + 3 * 60_000 + 5000;
    datafeed.pushTick(price + 1, 'BTC');
    await until(() => m.chart.dataLength === 297, 'the late tick opened a bar');
    assert.deepEqual(lines(), [['last', price], ['mark', price]]);
    assert.deepEqual(stats(), { bars: 297, duplicates: 0, missing: 7 });

    // Offline, a header timeframe pick fails, clears BTC's lines and falls back to the second symbol, which the header then shows.
    offline = true;
    m.clock.now = NOW;
    reasons.length = 0;
    const tf = (label: string) => Array.from(h.root.querySelectorAll('.cts-header-tf')).find((b) => b.textContent === label) as unknown as HTMLElement;
    h.tap(tf('5m'));
    await until(() => datafeed.symbol === 'ETH' && m.chart.dataLength > 0 && !datafeed.loading, 'the fallback landed');
    while (!datafeed.exhausted) await datafeed.loadMore();
    assert.equal(reasons[0], 'set', "the failed switch took BTC's bars off");
    assert.equal(errors.length, 1);
    assert.deepEqual([h.header.symbol, h.header.intervalMs, h.root.querySelector('.cts-header-symbol')!.textContent], ['ETH', 300_000, 'ETH']);
    const eth = src.all(300_000, 'ETH');
    assert.deepEqual(m.chart.getData(), eth);
    assert.deepEqual(lines(), [['last', eth.at(-1)!.close]], "no BTC line is left over ETH's prices");
    assert.deepEqual(stats(), { bars: 295, duplicates: 0, missing: 5 });
    const ethMarkers = m.chart.series.markers();
    assert.equal(ethMarkers.length, 2);
    datafeed.pushTick(1, 'BTC');
    assert.deepEqual(m.chart.getData(), eth, "BTC's mids do not reach ETH");

    // The continuous axis lays out the hole without adding bars: getData still holds the loaded candles only.
    m.chart.updateConfig({ timeScale: { continuous: true } });
    assert.deepEqual(m.chart.getData(), eth);
    const hole = eth.findIndex((c, i) => i > 0 && c.time - eth[i - 1]!.time > 300);
    const spacing = m.chart.scale.barSpacing();
    close(m.chart.scale.indexToX(hole) - m.chart.scale.indexToX(hole - 1), 6 * spacing, 1e-6);
    assert.equal(markerAt('Buy'), m.chart.scale.indexToX(indexOf(ethMarkers[0]!.time)));

    // Theme toggles: the toolbar's chart theme recolors the candles first, then the host re-places the markers in them.
    const dark = m.chart.getConfig().series;
    m.setTheme('light');
    placeMarkers(m.chart.getData());
    const light = m.chart.getConfig().series;
    assert.notEqual(light.upColor, dark.upColor);
    assert.equal(light.type, 'heikin-ashi');
    assert.deepEqual(m.chart.series.markers().map((mk) => [mk.time, mk.color]), [[ethMarkers[0]!.time, light.upColor], [ethMarkers[1]!.time, light.downColor]]);
    assert.deepEqual(errors.map(String), ['Error: offline']);
    datafeed.destroy();
    h.destroy();
  });
});
