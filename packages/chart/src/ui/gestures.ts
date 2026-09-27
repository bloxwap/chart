/**
 * Touch gestures for the chart canvas, following TradingView's mobile
 * model: one finger drags to pan (flinging on a fast release), two fingers
 * pinch to zoom around their midpoint and pan with it, and a long press
 * shows the crosshair, which then follows the finger instead of panning.
 * The crosshair stays after release — a drag nudges it, a tap hides it.
 * A double tap on the price axis resets the chart view. With the drawing
 * toolbar, a tap selects the drawing under the finger (or clears the
 * selection), and only the selected drawing is dragged: a drag that starts
 * anywhere else pans, even over filled drawings covering the plot. Holding
 * still, even on the selected drawing, shows the crosshair.
 *
 * {@link GestureRecognizer} is the DOM-free state machine (pointer ids and
 * canvas pixels in, actions out, timers injected). {@link attachTouchGestures}
 * wires it to a chart canvas for hosts without the drawing toolbar;
 * {@link createDrawingToolbar} routes touch through it on its own.
 *
 * ```ts
 * import { attachTouchGestures } from '@bloxwap/chart/ui';
 *
 * const gestures = attachTouchGestures({ chart, canvas, document });
 * // later
 * gestures.destroy();
 * ```
 *
 * @module
 */

import type { Chart } from '../core/chart.js';
import { SmoothScroll } from '../core/scroll.js';
import type { FrameScheduler } from '../core/zoom.js';
import type { DrawingController } from './controller.js';
import { createFrameScheduler } from './frames.js';
import type { UIDocument, UIElement, UIEvent, UITimers, UIWindow } from './host.js';
import { requireWindow } from './menu.js';
import { injectStyles } from './styles.js';

/** Hold still this long (ms) to show the crosshair. */
export const LONG_PRESS_MS = 450;

/** Finger travel (CSS px) that still counts as a tap or a hold. */
export const TAP_SLOP_PX = 8;

/** Two taps within this many ms act as a double click on drawings and tools. */
export const DOUBLE_TAP_MS = 300;

/** Minimum release speed (px/ms) that flings the chart after a pan. */
export const FLING_MIN_VELOCITY = 0.25;

/** Duration (ms) of the ease-out fling after a fast pan. */
export const FLING_DURATION_MS = 700;

/** A pan that rests this long (ms) before release doesn't fling. */
const FLING_IDLE_MS = 100;

/** Two taps farther apart (px) than this are not a double tap. */
const DOUBLE_TAP_SLOP_PX = 3 * TAP_SLOP_PX;

/** While the crosshair is shown, a finger that travels farther (px) is nudging it, not holding to jump it. */
const HOLD_SLOP_PX = 2;

/**
 * Hit reach (CSS px) of a finger on drawings: a fingertip covers far more
 * than a mouse pointer's 6 px.
 */
export const TOUCH_HIT_PX = 16;

/**
 * Hit reach (CSS px) of a finger on the selected drawing's handles: a
 * 48 px target (a mouse gets 8 px), so a thumb grabs a small anchor.
 */
export const TOUCH_HANDLE_HIT_PX = 24;

/** Pointer types handled as fingers by default; a pen behaves like a mouse. */
export const TOUCH_POINTER_TYPES: readonly string[] = ['touch'];

/** Canvas class that hands every touch to the chart (see `TOOLBAR_CSS`). */
const TOUCH_CLASS = 'cts-touch';

/** Actions emitted by a {@link GestureRecognizer}, in canvas CSS pixels. */
export interface GestureHandlers {
  /** Horizontal drag since the last call (positive: the finger moved right). */
  pan(dx: number): void;
  /** Two-finger spread ratio since the last call (> 1: fingers apart) around canvas x `anchorX`. */
  pinch(factor: number, anchorX: number): void;
  /** A long press: show the crosshair at the finger. */
  pressStart(x: number, y: number): void;
  /** The crosshair moved while tracking. */
  pressMove(x: number, y: number): void;
  /** Tracking ended (a tap, a second finger, or a cancel): hide the crosshair. */
  pressEnd(): void;
  /** A quick touch without travel while no crosshair is shown. */
  tap(x: number, y: number): void;
  /** A pan released at `velocity` px/ms (magnitude at least {@link FLING_MIN_VELOCITY}). */
  fling(velocity: number): void;
}

/** Injected timers and clock for a {@link GestureRecognizer}. */
export interface GestureRecognizerOptions {
  /** Long-press timer; pass the window. */
  timers: Pick<UITimers, 'setTimeout' | 'clearTimeout'>;
  /** Monotonic clock in ms (e.g. `() => performance.now()`), for fling velocity. */
  now: () => number;
}

interface Finger {
  x: number;
  y: number;
}

type Phase = 'idle' | 'pending' | 'pan' | 'press' | 'track' | 'pinch';

const noop = (): void => {};

const NO_HANDLERS: GestureHandlers = { pan: noop, pinch: noop, pressStart: noop, pressMove: noop, pressEnd: noop, tap: noop, fling: noop };

/**
 * DOM-free touch gesture state machine. Feed it pointer downs, moves, ups
 * and cancels (pointer ids, canvas CSS px); it emits {@link GestureHandlers}
 * actions. Two pointers are tracked; further ones are ignored.
 *
 * - One finger: travel past {@link TAP_SLOP_PX} pans; a release without
 *   travel taps; holding {@link LONG_PRESS_MS} shows the crosshair, which
 *   then follows the finger.
 * - After that release the crosshair stays (tracking): a drag moves it by
 *   the finger's offset (however slow or small), holding still for
 *   {@link LONG_PRESS_MS} jumps it to the finger, and a tap hides it.
 * - A second finger cancels the one-finger action (hiding the crosshair):
 *   spread changes pinch around the midpoint and midpoint moves pan. Lifting
 *   one finger continues as a pan with the other.
 */
export class GestureRecognizer {
  private readonly handlers: GestureHandlers;
  private readonly fingers = new Map<number, Finger>();
  private phase: Phase = 'idle';
  private timer: number | undefined;
  private tracked = false;
  /** The press is no longer a tap. */
  private moved = false;
  /** While tracking: the finger left {@link HOLD_SLOP_PX}, so it nudges instead of jumping. */
  private nudged = false;
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastTime = 0;
  private velocity = 0;
  private crossX = 0;
  private crossY = 0;
  private originX = 0;
  private originY = 0;
  private mid = 0;
  private spread = 0;

  constructor(
    handlers: Partial<GestureHandlers>,
    private readonly options: GestureRecognizerOptions,
  ) {
    this.handlers = { ...NO_HANDLERS, ...handlers };
  }

  /** Whether any tracked pointer is down. */
  get active(): boolean {
    return this.fingers.size > 0;
  }

  /** Whether the crosshair is shown (from a long press until the next tap). */
  get tracking(): boolean {
    return this.tracked;
  }

  /** Whether pointer `id` is tracked. */
  has(id: number): boolean {
    return this.fingers.has(id);
  }

  /** Pointer `id` went down at canvas `(x, y)`. */
  down(id: number, x: number, y: number): void {
    if (this.fingers.size === 2 || this.fingers.has(id)) return;
    this.fingers.set(id, { x, y });
    this.clearTimer();
    if (this.fingers.size === 2) {
      this.endTracking();
      this.phase = 'pinch';
      this.measure();
      return;
    }
    this.phase = this.tracked ? 'track' : 'pending';
    this.moved = false;
    this.nudged = false;
    this.startX = x;
    this.startY = y;
    this.lastX = x;
    this.originX = this.crossX;
    this.originY = this.crossY;
    this.velocity = 0;
    this.lastTime = this.options.now();
    this.timer = this.options.timers.setTimeout(this.longPress, LONG_PRESS_MS);
  }

  /** Pointer `id` moved to canvas `(x, y)`. */
  move(id: number, x: number, y: number): void {
    const finger = this.fingers.get(id);
    if (finger === undefined || (finger.x === x && finger.y === y)) return;
    finger.x = x;
    finger.y = y;
    switch (this.phase) {
      case 'pinch':
        this.pinchMove();
        return;
      case 'pan':
        this.pan(x);
        return;
      case 'press':
        this.cross(x, y);
        return;
      case 'track':
        this.cross(this.originX + x - this.startX, this.originY + y - this.startY);
        if (this.beyond(x, y, HOLD_SLOP_PX)) this.nudged = true;
        if (this.beyond(x, y, TAP_SLOP_PX)) {
          this.moved = true;
          this.clearTimer();
        }
        return;
      default:
        if (!this.beyond(x, y, TAP_SLOP_PX)) return;
        this.clearTimer();
        this.phase = 'pan';
        this.pan(x);
    }
  }

  /** Pointer `id` lifted at canvas `(x, y)`. */
  up(id: number, x: number, y: number): void {
    if (!this.fingers.has(id)) return;
    this.move(id, x, y);
    this.fingers.delete(id);
    if (this.phase === 'pinch') {
      const [rest] = this.fingers.values() as unknown as [Finger];
      this.phase = 'pan';
      this.lastX = rest.x;
      this.velocity = 0;
      this.lastTime = this.options.now();
      return;
    }
    this.clearTimer();
    const phase = this.phase;
    this.phase = 'idle';
    if (phase === 'pending') this.handlers.tap(x, y);
    else if (phase === 'track' && !this.moved) this.endTracking();
    else if (phase === 'pan' && this.options.now() - this.lastTime <= FLING_IDLE_MS && Math.abs(this.velocity) >= FLING_MIN_VELOCITY) {
      this.handlers.fling(this.velocity);
    }
    // After a long press the crosshair stays until the next tap.
  }

  /**
   * Pointer `id`, already held still at `(x, y)` for {@link LONG_PRESS_MS}
   * by a host that now gives it up, goes down and shows the crosshair at once.
   */
  hold(id: number, x: number, y: number): void {
    this.down(id, x, y);
    this.options.timers.clearTimeout(this.timer);
    this.longPress();
  }

  /** Aborts everything (pointercancel, lost capture, teardown): no tap or fling, and the crosshair hides. */
  cancel(): void {
    this.clearTimer();
    this.fingers.clear();
    this.phase = 'idle';
    this.endTracking();
  }

  private readonly longPress = (): void => {
    // Hosts flush queued moves before timers fire; one of them may have started a pan.
    if (this.timer === undefined) return;
    this.timer = undefined;
    if (this.nudged) {
      // A slow nudge of the shown crosshair: no jump, and too long to be the tap that hides it.
      this.moved = true;
      return;
    }
    const [finger] = this.fingers.values() as unknown as [Finger];
    this.phase = 'press';
    this.tracked = true;
    this.crossX = finger.x;
    this.crossY = finger.y;
    this.handlers.pressStart(finger.x, finger.y);
  };

  private beyond(x: number, y: number, slop: number): boolean {
    return Math.hypot(x - this.startX, y - this.startY) > slop;
  }

  private clearTimer(): void {
    this.options.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private endTracking(): void {
    if (!this.tracked) return;
    this.tracked = false;
    this.handlers.pressEnd();
  }

  private cross(x: number, y: number): void {
    this.crossX = x;
    this.crossY = y;
    this.handlers.pressMove(x, y);
  }

  private pan(x: number): void {
    const dx = x - this.lastX;
    if (dx === 0) return;
    const now = this.options.now();
    const dt = now - this.lastTime;
    if (dt > 0) this.velocity = 0.8 * (dx / dt) + 0.2 * this.velocity;
    this.lastX = x;
    this.lastTime = now;
    this.handlers.pan(dx);
  }

  private measure(): void {
    const [a, b] = this.fingers.values() as unknown as [Finger, Finger];
    this.mid = (a.x + b.x) / 2;
    this.spread = Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** Pans with the midpoint, then zooms around it (so content stays under the fingers). */
  private pinchMove(): void {
    const mid = this.mid;
    const spread = this.spread;
    this.measure();
    if (this.mid !== mid) this.handlers.pan(this.mid - mid);
    if (this.spread !== spread && this.spread > 0 && spread > 0) this.handlers.pinch(this.spread / spread, this.mid);
  }
}

/**
 * @internal How a host takes a first finger: `'tool'` keeps it through
 * extra fingers (an armed tool placing points), `'drawing'` yields to a
 * second finger, which turns it into a pinch (the eraser), `'selected'`
 * yields to a second finger too and is a gesture unless it travels (the
 * selected drawing: a release without travel undoes the press and taps,
 * and holding still for {@link LONG_PRESS_MS} undoes it and shows the
 * crosshair), and `null` leaves it to the gestures.
 */
export type TouchClaim = 'tool' | 'drawing' | 'selected' | null;

/**
 * @internal The drawing toolbar's {@link TouchClaim}, following TradingView
 * mobile: an armed tool keeps the finger; the eraser takes it; otherwise
 * only the selected, unlocked drawing does (`'selected'`) — a handle within
 * {@link TOUCH_HANDLE_HIT_PX}, or its body within {@link TOUCH_HIT_PX}, even
 * where another drawing lies on top. Every other touch is left to the
 * gestures, so a one-finger drag pans even across filled drawings (fib
 * bands, position boxes); a tap selects the drawing under it first. Mirrors
 * `DrawingController.pointerDown` with the toolbar's touch reach.
 */
export function claimTouch(controller: DrawingController, x: number, y: number): TouchClaim {
  if (controller.tool !== null) return 'tool';
  if (controller.cursor === 'eraser') return 'drawing';
  const chart = controller.chart;
  const selected = chart.selectedDrawing;
  if (controller.locked || selected === null || chart.getDrawing(selected)!.locked) return null;
  if (chart.handleAt(x, y, TOUCH_HANDLE_HIT_PX) >= 0) return 'selected';
  return chart.drawingAt(x, y, TOUCH_HIT_PX, selected) === selected ? 'selected' : null;
}

/** @internal Host hooks for {@link createTouchRouter} (the drawing toolbar plugs its controller in here). */
export interface TouchRouterOptions {
  chart: Chart;
  canvas: UIElement;
  win: UIWindow;
  frames: FrameScheduler;
  /** Pointer types handled as fingers; everything else passes straight through. */
  pointerTypes: readonly string[];
  /** Any pointer went down on the canvas; `finger` when it is routed as touch. */
  press(finger: boolean): void;
  /** Whether the host takes a first finger at `(x, y)` itself (see {@link TouchClaim}). */
  claim(x: number, y: number): TouchClaim;
  /** A touch sequence is starting: stop motion, commit editors, close menus. */
  start(): void;
  /** A gesture tap while no crosshair is shown, or a `'selected'` claim released without travel (after `abort`). */
  tap(x: number, y: number): void;
  /** Two quick taps (the touch double click). */
  doubleTap(x: number, y: number): void;
  /** A host-claimed touch lifted at `(x, y)` (or moved, then yielded to a pinch): commit it. */
  release(x: number, y: number): void;
  /**
   * A host-claimed touch was cancelled, yielded to a pinch before it went
   * anywhere, or (`'selected'`) turned out to be a tap or a long press: undo it.
   */
  abort(): void;
  /** The long-press crosshair is shown at `(x, y)`. */
  crosshair(x: number, y: number): void;
  /** The long-press crosshair hid. */
  crosshairEnd(): void;
  /** Pan, pinch or fling moved the viewport. */
  viewport(): void;
}

/** @internal Pointer entry points; each returns true when it consumed the event. */
export interface TouchRouter {
  down(event: UIEvent): boolean;
  move(event: UIEvent): boolean;
  up(event: UIEvent): boolean;
  /** `pointercancel` and `lostpointercapture`. */
  cancel(event: UIEvent): boolean;
  leave(event: UIEvent): boolean;
  /** Swallows the compat `dblclick`/`contextmenu` that follows a finger press. */
  suppress(event: UIEvent): boolean;
  /** Stops a running fling. */
  cancelFling(): void;
  destroy(): void;
}

interface Claim {
  readonly id: number;
  readonly x0: number;
  readonly y0: number;
  /** How the host took it; `'tool'` ignores extra fingers instead of starting a pinch. */
  readonly kind: Exclude<TouchClaim, null>;
  x: number;
  y: number;
  moved: boolean;
  /** A `'selected'` claim's long-press timer, until the finger travels. */
  hold: number | undefined;
}

/**
 * @internal Routes finger pointers: the first finger goes to the host when
 * it claims the spot, otherwise to a {@link GestureRecognizer} driving the
 * chart's scale and crosshair. A second finger takes a yielding claim over
 * as a pinch. Moves are coalesced per frame and flushed before downs, ups
 * and the long-press timer. Finger `pointerdown`s are default-prevented, so
 * browsers skip the compat mouse events (whose `mousedown` would blur an
 * editor a tap just opened).
 */
export function createTouchRouter(o: TouchRouterOptions): TouchRouter {
  const { chart, canvas, win, frames } = o;
  const reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  const flingScroll = new SmoothScroll(chart, frames, { duration: FLING_DURATION_MS, onFrame: o.viewport });
  // Pixels per scroll unit: a time slot on a continuous axis, where bars 0 and 1 may straddle a gap.
  const spacing = (): number => Math.max(0.5, chart.scale.barSpacing());
  const crosshair = (x: number, y: number): void => {
    chart.setCrosshair(x, y);
    o.crosshair(x, y);
  };
  const gesture = new GestureRecognizer(
    {
      pan: (dx) => {
        chart.scale.scrollBy(dx / spacing());
        o.viewport();
      },
      pinch: (factor, anchorX) => {
        const plot = chart.plotArea;
        chart.scale.zoom(factor, Math.max(plot.left, Math.min(plot.left + plot.width, anchorX)));
        o.viewport();
      },
      pressStart: crosshair,
      pressMove: crosshair,
      pressEnd: () => {
        chart.clearCrosshair();
        o.crosshairEnd();
      },
      tap: (x, y) => {
        o.tap(x, y);
        if (!doubled(x, y)) return;
        // A double tap on the price axis resets the view (touch has no context menu); elsewhere it is a double click.
        const plot = chart.plotArea;
        if (x >= plot.left && x < plot.left + plot.width) o.doubleTap(x, y);
        else {
          chart.resetScale();
          o.viewport();
        }
      },
      // An ease-out cubic starts at 3x its mean speed: this distance continues the finger's speed.
      fling: (velocity) => {
        if (!reducedMotion) flingScroll.scrollBy((velocity * FLING_DURATION_MS) / 3 / spacing());
      },
    },
    {
      timers: {
        setTimeout: (handler, timeout) => win.setTimeout(() => { flush(); handler(); }, timeout),
        clearTimeout: (id) => win.clearTimeout(id),
      },
      now: () => frames.now(),
    },
  );
  const queued = new Map<number, [number, number]>();
  let frame: number | null = null;
  let claimed: Claim | null = null;
  let lastTap: { x: number; y: number; time: number } | null = null;
  let fingerPress = false;

  function flush(): void {
    if (frame !== null) frames.cancel(frame);
    frame = null;
    chart.batch(() => { for (const [id, [x, y]] of queued) gesture.move(id, x, y); });
    queued.clear();
  }
  const isFinger = (e: UIEvent): boolean => o.pointerTypes.includes(e.pointerType!);
  const local = (e: UIEvent): [number, number] => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX! - r.left, e.clientY! - r.top];
  };
  const travel = (c: Claim, x: number, y: number): void => {
    c.x = x;
    c.y = y;
    if (Math.hypot(x - c.x0, y - c.y0) <= TAP_SLOP_PX) return;
    c.moved = true;
    win.clearTimeout(c.hold);
  };
  /** Records a tap; true when it completes a double tap. */
  function doubled(x: number, y: number): boolean {
    const time = frames.now();
    const double = lastTap !== null && time - lastTap.time <= DOUBLE_TAP_MS && Math.hypot(x - lastTap.x, y - lastTap.y) <= DOUBLE_TAP_SLOP_PX;
    lastTap = double ? null : { x, y, time };
    return double;
  }
  /** Ends the current claim, stopping its long-press timer. */
  const unclaim = (): Claim => {
    const c = claimed!;
    win.clearTimeout(c.hold);
    claimed = null;
    return c;
  };
  const release = (x: number, y: number, tapped: boolean): void => {
    if (unclaim().kind === 'selected' && tapped) {
      // A tap on the selected drawing edits nothing: undo what the press nudged, then select as any tap does.
      o.abort();
      o.tap(x, y);
    } else o.release(x, y);
    if (!tapped) lastTap = null;
    else if (doubled(x, y)) o.doubleTap(x, y);
  };
  const abort = (): void => {
    unclaim();
    lastTap = null;
    o.abort();
  };
  /** A `'selected'` claim held still: the press is undone and the finger shows the crosshair, as anywhere else. */
  const hold = (c: Claim): void => {
    abort();
    gesture.hold(c.id, c.x, c.y);
  };

  if (o.pointerTypes.length > 0) canvas.classList.add(TOUCH_CLASS);

  return {
    down: (e) => {
      fingerPress = isFinger(e);
      o.press(fingerPress);
      if (!fingerPress) return false;
      e.preventDefault();
      const [x, y] = local(e);
      if (claimed !== null) {
        if (claimed.kind === 'tool') return true; // no pinch while placing
        // A second finger turns a drawing drag or eraser touch into a pinch; a drag that went somewhere is kept.
        const first = claimed;
        if (first.moved) release(first.x, first.y, false);
        else abort();
        gesture.down(first.id, first.x, first.y);
        gesture.down(e.pointerId!, x, y);
        return true;
      }
      if (!gesture.active) {
        o.start();
        flingScroll.cancel();
        const claim = o.claim(x, y);
        if (claim !== null) {
          gesture.cancel();
          const c: Claim = { id: e.pointerId!, x0: x, y0: y, kind: claim, x, y, moved: false, hold: undefined };
          if (claim === 'selected') c.hold = win.setTimeout(() => hold(c), LONG_PRESS_MS);
          claimed = c;
          return false;
        }
      }
      flush();
      gesture.down(e.pointerId!, x, y);
      return true;
    },
    move: (e) => {
      if (!isFinger(e)) return false;
      const [x, y] = local(e);
      if (claimed !== null && claimed.id === e.pointerId) {
        travel(claimed, x, y);
        return false;
      }
      queued.set(e.pointerId!, [x, y]);
      if (frame === null) frame = frames.request(flush);
      return true;
    },
    up: (e) => {
      if (!isFinger(e)) return false;
      const [x, y] = local(e);
      if (claimed !== null && claimed.id === e.pointerId) {
        travel(claimed, x, y);
        release(x, y, !claimed.moved);
        return true;
      }
      flush();
      gesture.up(e.pointerId!, x, y);
      return true;
    },
    cancel: (e) => {
      if (!isFinger(e)) return false;
      if (claimed !== null && claimed.id === e.pointerId) abort();
      else if (gesture.has(e.pointerId!)) {
        flush();
        gesture.cancel();
      }
      return true;
    },
    leave: (e) => isFinger(e),
    suppress: (e) => {
      if (!fingerPress) return false;
      e.preventDefault();
      return true;
    },
    cancelFling: () => flingScroll.cancel(),
    destroy: () => {
      if (frame !== null) frames.cancel(frame);
      frame = null;
      if (claimed !== null) unclaim();
      queued.clear();
      gesture.cancel();
      flingScroll.destroy();
      canvas.classList.remove(TOUCH_CLASS);
    },
  };
}

/** Options for {@link attachTouchGestures}. */
export interface TouchGesturesOptions {
  chart: Chart;
  /** The chart's canvas element; touch input is read from it. */
  canvas: UIElement;
  /** Injected document (pass the browser `document`); timers come from its window. */
  document: UIDocument;
  /** Share a frame clock with chart animations and other input. */
  scheduler?: FrameScheduler;
  /** Pointer types handled as fingers. Default `['touch']`; add `'pen'` to treat a stylus like a finger. */
  pointerTypes?: readonly string[];
}

/** Handle returned by {@link attachTouchGestures}. */
export interface TouchGestures {
  /** Removes listeners, timers, motion and the canvas touch class, and hides a long-press crosshair. */
  destroy(): void;
}

/**
 * Pinch-to-zoom, drag-to-pan (with fling), long-press crosshair and a
 * price-axis double tap that resets the view (`chart.resetScale()`) on a
 * chart canvas, for hosts that don't use {@link createDrawingToolbar} (which
 * wires the same gestures itself). Mouse and pen input is left alone.
 * Adds the `cts-touch` class (touch-action: none, no callout or selection)
 * so iOS Safari leaves the gestures to the chart.
 */
export function attachTouchGestures(options: TouchGesturesOptions): TouchGestures {
  const { chart, canvas, document: doc } = options;
  const win = requireWindow(doc);
  injectStyles(doc);
  const router = createTouchRouter({
    chart,
    canvas,
    win,
    frames: options.scheduler ?? createFrameScheduler(win, (update) => chart.batch(update)),
    pointerTypes: options.pointerTypes ?? TOUCH_POINTER_TYPES,
    press: noop,
    claim: () => null,
    start: noop,
    tap: noop,
    doubleTap: noop,
    release: noop,
    abort: noop,
    crosshair: noop,
    crosshairEnd: noop,
    viewport: noop,
  });
  const listeners: [string, (event: UIEvent) => boolean][] = [
    ['pointerdown', router.down],
    ['pointermove', router.move],
    ['pointerup', router.up],
    ['pointercancel', router.cancel],
    ['lostpointercapture', router.cancel],
    ['contextmenu', router.suppress],
  ];
  for (const [type, listener] of listeners) canvas.addEventListener(type, listener);
  return {
    destroy(): void {
      for (const [type, listener] of listeners) canvas.removeEventListener(type, listener);
      router.destroy();
    },
  };
}
