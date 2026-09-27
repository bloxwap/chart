/**
 * A small typed listener list plus the chart's public event payloads.
 *
 * @module
 */

import type { Candle } from './data.js';
import type { ChartConfig } from '../config.js';

/** A callback receiving events of type `T`. */
export type Listener<T> = (event: T) => void;

/** Removes a listener. Calling it again is a no-op. */
export type Unsubscribe = () => void;

interface Entry<T> {
  readonly listener: Listener<T>;
  active: boolean;
}

/**
 * Ordered listener list. Emission walks a snapshot: listeners added while
 * emitting wait for the next event, and listeners removed while emitting are
 * skipped immediately.
 */
export class Emitter<T> {
  private entries: readonly Entry<T>[] = [];

  /** Number of subscribed listeners. */
  get size(): number {
    return this.entries.length;
  }

  /** Adds `listener` (again, if already present); returns its idempotent unsubscribe. */
  subscribe(listener: Listener<T>): Unsubscribe {
    const entry: Entry<T> = { listener, active: true };
    this.entries = [...this.entries, entry];
    return () => {
      if (!entry.active) return;
      entry.active = false;
      this.entries = this.entries.filter((e) => e !== entry);
    };
  }

  /**
   * Calls every listener with `event` in subscription order. When `current`
   * is given it runs after each listener; returning false stops delivery
   * because a listener has already superseded `event`. A throwing listener
   * does not starve the rest: the first error is rethrown once delivery ends.
   */
  emit(event: T, current?: () => boolean): void {
    let failure: { readonly error: unknown } | undefined;
    for (const entry of this.entries) {
      if (!entry.active) continue;
      try {
        entry.listener(event);
      } catch (error) {
        failure ??= { error };
      }
      if (current !== undefined && !current()) break;
    }
    if (failure !== undefined) throw failure.error;
  }

  /** Removes every listener, including ones not yet reached by an emission in progress. */
  clear(): void {
    for (const entry of this.entries) entry.active = false;
    this.entries = [];
  }
}

/** Payload of {@link Chart.subscribeVisibleRangeChange}. */
export interface VisibleRangeChangeEvent {
  /** First visible data index (inclusive), as in `scale.visibleRange()`. */
  readonly from: number;
  /** Visible data end index (exclusive), as in `scale.visibleRange()`. */
  readonly to: number;
  /** Fractional index of the bar slot flush with the plot's left edge; below 0 when whitespace shows. */
  readonly logicalFrom: number;
  /** Fractional index of the bar slot flush with the plot's right edge; above `length - 1` when whitespace shows. */
  readonly logicalTo: number;
  /** Data bars hidden past the left edge (`logicalFrom`); negative means leading whitespace. */
  readonly barsBefore: number;
  /** Data bars hidden past the right edge (`length - 1 - logicalTo`); negative means trailing whitespace. */
  readonly barsAfter: number;
  /** Time of candle `from`, or null when nothing is visible. */
  readonly fromTime: number | null;
  /** Time of candle `to - 1`, or null when nothing is visible. */
  readonly toTime: number | null;
  /** Number of candles in the series. */
  readonly length: number;
}

/**
 * Payload of {@link Chart.subscribeCrosshairMove}. A new one is delivered
 * whenever any field differs from the last delivered event, so a still
 * pointer re-emits when the bar or price under it changes.
 */
export interface CrosshairMoveEvent {
  /** False once the crosshair is hidden; the other fields are then NaN or null. */
  readonly active: boolean;
  /** Pointer x in canvas CSS pixels. */
  readonly x: number;
  /** Pointer y in canvas CSS pixels. */
  readonly y: number;
  /** Nearest bar, clamped into the data; null without data or when `x` is NaN. */
  readonly index: number | null;
  /** Time of the hovered bar. */
  readonly time: number | null;
  /** The hovered bar's OHLCV, as loaded into the chart. */
  readonly candle: Candle | null;
  /**
   * The hovered bar as the main series draws it and the status line reports
   * it: the Heikin Ashi bar for `series.type: 'heikin-ashi'`, otherwise the
   * same object as `candle`. Never the eased live-candle animation frame.
   */
  readonly displayCandle: Candle | null;
  /** Price under `y` on the hovered pane; null off the panes. */
  readonly price: number | null;
  /** `'main'`, or the id of the sub-pane's indicator; null off the panes. */
  readonly paneId: string | null;
}

/** What changed the candle series: see {@link DataLoadEvent}. */
export type DataLoadReason = 'set' | 'append' | 'update' | 'prepend';

/** Payload of {@link Chart.subscribeDataLoad}. */
export interface DataLoadEvent {
  /**
   * `'set'` replaced the series, `'append'` grew it by one, `'update'`
   * replaced a candle, `'prepend'` added history (including an `appendData`
   * candle older than the first). An `'append'` that leaves `lastTime`
   * unchanged went in between existing bars and moved the indices after it.
   */
  readonly reason: DataLoadReason;
  /** Number of candles right after the change. */
  readonly length: number;
  /** Candles added: the whole series for `'set'`, 1 for `'append'`, 0 for `'update'`, the bars inserted for `'prepend'`. */
  readonly added: number;
  /** Time of the first candle, or null when empty. */
  readonly firstTime: number | null;
  /** Time of the last candle, or null when empty. */
  readonly lastTime: number | null;
}

/**
 * Payload of {@link Chart.subscribeLayoutChange}: the chart's geometry and
 * config as of the render that changed them.
 */
export interface LayoutChangeEvent {
  /** Canvas width in CSS pixels. */
  readonly width: number;
  /** Canvas height in CSS pixels. */
  readonly height: number;
  /** Canvas x of the main plot's left edge (the price-axis width when it sits on the left). */
  readonly plotLeft: number;
  /** Main plot width in CSS pixels. */
  readonly plotWidth: number;
  /** Main pane height in CSS pixels (shrinks for sub-panes and grows without a time axis). */
  readonly plotHeight: number;
  /** The resolved config; a new object after every `updateConfig`. */
  readonly config: ChartConfig;
}

/**
 * Payload of {@link Chart.subscribeConfigChange}: which top-level sections of
 * the config were written since the last delivery. Values are not compared,
 * so a call that writes a section with the value it already held still names it.
 */
export interface ConfigChangeEvent {
  /**
   * Written sections in first-write order, each once: the keys of an
   * `updateConfig` partial, `'indicators'` after an indicator was added,
   * updated or removed, `'drawings'` after a drawing edit.
   */
  readonly keys: readonly (keyof ChartConfig)[];
}
