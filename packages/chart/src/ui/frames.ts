import type { FrameScheduler } from '../core/zoom.js';
import type { UIWindow } from './host.js';

/** Coalesces independent animations and pointer work into one chart batch per frame. */
export function createFrameScheduler(win: UIWindow, batch: (update: () => void) => void): FrameScheduler {
  const tasks = new Map<number, (time: number) => void>();
  let sequence = 0;
  let frame: number | null = null;
  return {
    now: () => win.performance.now(),
    request(callback) {
      const id = ++sequence;
      tasks.set(id, callback);
      if (frame === null) frame = win.requestAnimationFrame((time) => {
        frame = null;
        batch(() => {
          for (const [key, task] of [...tasks]) if (tasks.delete(key)) task(time);
        });
      });
      return id;
    },
    cancel(id) {
      tasks.delete(id);
      if (tasks.size === 0 && frame !== null) {
        win.cancelAnimationFrame(frame);
        frame = null;
      }
    },
  };
}
