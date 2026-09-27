/**
 * Drives the bar-close countdown: repaints the chart overlay on every
 * wall-clock second using the injected window's timers (never globals),
 * optionally through a frame scheduler.
 *
 * @module
 */

import type { FrameScheduler } from '../core/zoom.js';
import type { UITimers } from './host.js';

/** The chart surface the ticker needs; a `Chart` satisfies it. */
export interface CountdownTickerChart {
  /** Wall clock in ms (the chart's injected clock). */
  now(): number;
  /** Cheap overlay-only repaint. */
  refreshOverlay(): void;
  /** True once the chart is torn down; the ticker then stops on its own. */
  isDestroyed(): boolean;
}

/** Options for {@link startCountdownTicker}. */
export interface CountdownTickerOptions {
  chart: CountdownTickerChart;
  /** Timer source, e.g. the page's `window`. */
  window: Pick<UITimers, 'setTimeout' | 'clearTimeout'>;
  /**
   * Requests each repaint on the next frame instead of painting in the timer
   * callback, coalesced with the other work sharing it (e.g. the
   * `createFrameScheduler` behind the toolbar and the datafeed). Default:
   * paints in the timer callback.
   */
  scheduler?: Pick<FrameScheduler, 'request' | 'cancel'>;
}

/** A running ticker. */
export interface CountdownTicker {
  /** Cancels the pending tick; idempotent. */
  stop(): void;
}

/**
 * Repaints the overlay just after each whole second of the chart's clock, so
 * the countdown flips on the second. Each tick re-aligns, so timer drift
 * never accumulates. With a `scheduler`, a tick requests the repaint on the
 * next frame (at most one pending). Stops by itself once the chart is
 * destroyed, so a host without a cleanup hook never leaks the timer or the chart.
 */
export function startCountdownTicker(options: CountdownTickerOptions): CountdownTicker {
  const { chart, window: win, scheduler } = options;
  let timer: number | undefined;
  let running = true;
  let framePending = false;
  let frame = 0;
  const paint = (): void => {
    framePending = false;
    if (!chart.isDestroyed()) chart.refreshOverlay();
  };
  const repaint = (): void => {
    if (scheduler === undefined) chart.refreshOverlay();
    else if (!framePending) {
      framePending = true;
      frame = scheduler.request(paint);
    }
  };
  const cancelFrame = (): void => {
    if (!framePending) return;
    framePending = false;
    scheduler!.cancel(frame);
  };
  const tick = (): void => {
    if (chart.isDestroyed()) {
      cancelFrame();
      return;
    }
    try {
      repaint();
    } finally {
      // A catch-up render runs chart event listeners: one that throws must not
      // freeze the countdown, and one that stops the ticker or destroys the
      // chart must not leave a timer behind.
      if (running && !chart.isDestroyed()) schedule();
    }
  };
  const schedule = (): void => {
    const phase = chart.now() % 1000;
    // A non-finite clock (e.g. before a server-time sync) waits a full second, never 0 ms.
    timer = win.setTimeout(tick, Number.isFinite(phase) ? 1000 - ((phase + 1000) % 1000) : 1000);
  };
  schedule();
  return {
    stop() {
      running = false;
      win.clearTimeout(timer);
      cancelFrame();
    },
  };
}
