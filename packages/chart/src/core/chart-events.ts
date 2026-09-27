/**
 * Chart event plumbing: queues data and config changes and diffs the
 * viewport, crosshair and layout against the last emission, then delivers
 * once the chart is consistent. Delivery is re-entrancy safe: a listener that
 * changes what an event in flight describes supersedes it, and the fresh
 * state goes to every listener next.
 *
 * @module
 */

import type { Candle, DataStore } from './data.js';
import type { TimeScale } from './scale.js';
import type { Crosshair } from './crosshair.js';
import type { PaneRenderInfo } from '../render/renderer.js';
import type { ChartConfig } from '../config.js';
import {
  Emitter,
  type ConfigChangeEvent,
  type CrosshairMoveEvent,
  type DataLoadEvent,
  type DataLoadReason,
  type LayoutChangeEvent,
  type Listener,
  type Unsubscribe,
  type VisibleRangeChangeEvent,
} from './events.js';

/**
 * Delivery rounds per flush before a listener feedback loop is cut off and its
 * pending events dropped. A round is one emission; everything queued before it
 * (however large the batch) is a single round, so only listener-caused
 * changes use up the budget.
 */
export const MAX_EVENT_ROUNDS = 100;

/** Chart state read by {@link ChartEvents}. */
export interface ChartEventHost {
  readonly store: DataStore;
  readonly timeScale: TimeScale;
  readonly crosshair: Crosshair;
  /** Canvas x of the plot's left edge. */
  plotLeft(): number;
  /** Panes from the last full render. */
  panes(): readonly Pick<PaneRenderInfo, 'layout' | 'priceScale'>[];
  /** Main-series bars as displayed (e.g. Heikin Ashi), index-aligned with the store; defaults to the store's candles. */
  displayCandles?(): readonly Candle[];
  /** Canvas and main-plot geometry plus the config; without it layout listeners never hear anything. */
  layout?(): LayoutChangeEvent;
}

/** The chart's event streams (data, config, viewport, crosshair, layout) and their pending state. */
export class ChartEvents {
  /** Viewport listeners. */
  readonly visibleRange = new Emitter<VisibleRangeChangeEvent>();
  /** Crosshair listeners. */
  readonly crosshairMove = new Emitter<CrosshairMoveEvent>();
  /** Data listeners. */
  readonly dataLoad = new Emitter<DataLoadEvent>();
  /** Layout listeners. */
  readonly layoutChange = new Emitter<LayoutChangeEvent>();
  /** Config listeners. */
  readonly configChange = new Emitter<ConfigChangeEvent>();

  private loads: DataLoadEvent[] = [];
  /** Config sections written since the last delivery, in first-write order. */
  private configKeys = new Set<keyof ChartConfig>();
  private lastRange: VisibleRangeChangeEvent;
  /**
   * Crosshair payload at the last emission (or subscription). Diffing the
   * whole payload, not just the pointer, re-emits when the bar or price under
   * a still pointer changes (scroll, zoom, rescale, new or replaced data).
   */
  private lastCrosshair: CrosshairMoveEvent;
  /** Layout at the last emission (or subscription); set whenever the host reports one. */
  private lastLayout: LayoutChangeEvent | undefined;
  /** First listener error of the flush in progress, rethrown once it completes. */
  private failure: { readonly error: unknown } | null = null;
  private flushing = false;
  private disposed = false;

  constructor(private readonly host: ChartEventHost) {
    this.lastRange = this.rangeEvent();
    this.lastCrosshair = this.crosshairEvent();
  }

  /** Subscribes to viewport changes, diffed from the state at subscription. */
  subscribeVisibleRangeChange(listener: Listener<VisibleRangeChangeEvent>): Unsubscribe {
    if (this.visibleRange.size === 0) this.lastRange = this.rangeEvent();
    return this.visibleRange.subscribe(listener);
  }

  /** Subscribes to crosshair changes, diffed from the state at subscription. */
  subscribeCrosshairMove(listener: Listener<CrosshairMoveEvent>): Unsubscribe {
    if (this.crosshairMove.size === 0) this.lastCrosshair = this.crosshairEvent();
    return this.crosshairMove.subscribe(listener);
  }

  /** Subscribes to data changes. */
  subscribeDataLoad(listener: Listener<DataLoadEvent>): Unsubscribe {
    return this.dataLoad.subscribe(listener);
  }

  /** Subscribes to geometry and config changes, diffed from the state at subscription. */
  subscribeLayoutChange(listener: Listener<LayoutChangeEvent>): Unsubscribe {
    if (this.layoutChange.size === 0) this.lastLayout = this.layoutNow();
    return this.layoutChange.subscribe(listener);
  }

  /** Subscribes to config changes. */
  subscribeConfigChange(listener: Listener<ConfigChangeEvent>): Unsubscribe {
    return this.configChange.subscribe(listener);
  }

  /**
   * Records changed config sections (call right after mutating the config);
   * delivered together on the next {@link flush}. Free without listeners.
   */
  configChanged(key: keyof ChartConfig): void {
    if (this.configChange.size > 0) this.configKeys.add(key);
  }

  /** Records a data change (call right after mutating the store); delivered on the next {@link flush}. */
  dataLoaded(reason: DataLoadReason, added: number): void {
    if (this.dataLoad.size === 0) return;
    const { store } = this.host;
    this.loads.push({
      reason, length: store.length, added,
      firstTime: store.at(0)?.time ?? null,
      lastTime: store.last()?.time ?? null,
    });
  }

  /**
   * Delivers queued data events, then the changed config sections, then a
   * changed viewport, then a moved crosshair, then a changed layout. Call
   * only when the chart is consistent (after a paint, never inside a batch).
   * Nested calls from listeners return at once; the outer call picks up
   * whatever they changed. A throwing listener neither starves
   * the others nor strands pending events: the first error is rethrown once
   * everything has been delivered.
   */
  flush(): void {
    if (this.flushing || this.disposed) return;
    this.flushing = true;
    try {
      let rounds = 0;
      while (this.step()) {
        if (++rounds < MAX_EVENT_ROUNDS) continue;
        // Listeners keep changing what they observe: drop the backlog so a
        // feedback loop cannot hang the page, and diff from here next time.
        this.loads = [];
        this.configKeys.clear();
        this.lastRange = this.rangeEvent();
        this.lastCrosshair = this.crosshairEvent();
        this.lastLayout = this.layoutNow();
        break;
      }
    } finally {
      this.flushing = false;
    }
    const failure = this.failure;
    this.failure = null;
    if (failure !== null) throw failure.error;
  }

  /** Drops every listener and anything pending; later flushes do nothing. */
  dispose(): void {
    this.disposed = true;
    this.loads = [];
    this.configKeys.clear();
    this.visibleRange.clear();
    this.crosshairMove.clear();
    this.dataLoad.clear();
    this.layoutChange.clear();
    this.configChange.clear();
  }

  /** Runs one delivery round; false when nothing is pending. */
  private step(): boolean {
    if (this.loads.length > 0) {
      // Everything queued so far is history: deliver it all as one round.
      const loads = this.loads;
      this.loads = [];
      for (const load of loads) this.deliver(this.dataLoad, load);
      return true;
    }
    if (this.configKeys.size > 0) {
      // Every section changed so far, once each; changes listeners make go out next round.
      const keys = [...this.configKeys];
      this.configKeys.clear();
      this.deliver(this.configChange, { keys });
      return true;
    }
    if (this.visibleRange.size > 0) {
      const range = this.rangeEvent();
      if (!sameRange(range, this.lastRange)) {
        this.lastRange = range;
        this.deliver(this.visibleRange, range, () => sameRange(this.rangeEvent(), range));
        return true;
      }
    }
    if (this.crosshairMove.size > 0) {
      const event = this.crosshairEvent();
      if (!sameCrosshair(event, this.lastCrosshair)) {
        this.lastCrosshair = event;
        this.deliver(this.crosshairMove, event, () => sameCrosshair(this.crosshairEvent(), event));
        return true;
      }
    }
    if (this.layoutChange.size > 0) {
      const layout = this.layoutNow();
      if (layout !== undefined && !sameLayout(layout, this.lastLayout!)) {
        this.lastLayout = layout;
        this.deliver(this.layoutChange, layout, () => sameLayout(this.layoutNow()!, layout));
        return true;
      }
    }
    return false;
  }

  /** The host's current layout, if it reports one. */
  private layoutNow(): LayoutChangeEvent | undefined {
    return this.host.layout?.();
  }

  /** Emits `event`, keeping the flush alive when a listener throws. */
  private deliver<T>(emitter: Emitter<T>, event: T, current?: () => boolean): void {
    try {
      emitter.emit(event, current);
    } catch (error) {
      this.failure ??= { error };
    }
  }

  private rangeEvent(): VisibleRangeChangeEvent {
    const { store, timeScale } = this.host;
    const length = store.length;
    const { from, to } = timeScale.visibleRange(length);
    // Slot i spans indexToX(i) ± barSpacing / 2; the last bar's slot ends at
    // the right edge when scrollOffset is 0. A continuous time axis measures
    // scrollOffset in time slots, so its edges map back to (fractional) candle
    // indices through the scale, interpolating inside gaps.
    const { width, barSpacing, scrollOffset } = timeScale;
    const continuous = timeScale.slots !== null;
    const logicalTo = continuous ? timeScale.xToFloatIndex(width - barSpacing / 2, length) : length - 1 - scrollOffset;
    const logicalFrom = continuous ? timeScale.xToFloatIndex(barSpacing / 2, length) : length - scrollOffset - width / barSpacing;
    const empty = to <= from;
    return {
      from, to, logicalFrom, logicalTo,
      barsBefore: logicalFrom,
      barsAfter: length - 1 - logicalTo,
      fromTime: empty ? null : store.at(from)!.time,
      toTime: empty ? null : store.at(to - 1)!.time,
      length,
    };
  }

  private crosshairEvent(): CrosshairMoveEvent {
    const { crosshair, store, timeScale } = this.host;
    if (!crosshair.active) {
      return { active: false, x: NaN, y: NaN, index: null, time: null, candle: null, displayCandle: null, price: null, paneId: null };
    }
    const { x, y } = crosshair;
    const length = store.length;
    const nearest = Math.round(timeScale.xToFloatIndex(x - this.host.plotLeft(), length));
    const index = length === 0 || Number.isNaN(nearest) ? null : Math.min(length - 1, Math.max(0, nearest));
    const candle = index === null ? null : store.at(index)!;
    const displayCandle = index === null ? null : (this.host.displayCandles?.() ?? store.raw())[index]!;
    const pane = this.host.panes().find((p) => y >= p.layout.y && y <= p.layout.y + p.layout.height);
    return {
      active: true, x, y, index,
      time: candle === null ? null : candle.time,
      candle,
      displayCandle,
      price: pane === undefined ? null : pane.priceScale.yToPrice(y - pane.layout.y),
      paneId: pane === undefined ? null : pane.layout.id,
    };
  }
}

/** Whether two range payloads are identical (`barsBefore`/`barsAfter` follow from the rest). */
function sameRange(a: VisibleRangeChangeEvent, b: VisibleRangeChangeEvent): boolean {
  return a.from === b.from && a.to === b.to && a.length === b.length &&
    a.fromTime === b.fromTime && a.toTime === b.toTime &&
    Object.is(a.logicalFrom, b.logicalFrom) && Object.is(a.logicalTo, b.logicalTo);
}

/** Whether two layout payloads are identical (the config by identity). */
function sameLayout(a: LayoutChangeEvent, b: LayoutChangeEvent): boolean {
  return a.config === b.config && a.width === b.width && a.height === b.height &&
    a.plotLeft === b.plotLeft && a.plotWidth === b.plotWidth && a.plotHeight === b.plotHeight;
}

/** Whether two crosshair payloads are identical (`time` follows from `candle`). */
function sameCrosshair(a: CrosshairMoveEvent, b: CrosshairMoveEvent): boolean {
  return a.active === b.active && Object.is(a.x, b.x) && Object.is(a.y, b.y) && a.index === b.index &&
    a.candle === b.candle && a.displayCandle === b.displayCandle && Object.is(a.price, b.price) && a.paneId === b.paneId;
}
