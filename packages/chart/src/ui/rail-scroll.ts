import type { UIDocument, UIElement } from './host.js';
import { el, requireWindow } from './menu.js';
import { icon } from './icons.js';

/** Adds overflow hints and hover/focus paging controls to a vertical tool rail. */
export function attachScrollableRail(doc: UIDocument, content: UIElement): () => void {
  const win = requireWindow(doc);
  const host = el(doc, 'div', 'cts-rail-scroll-wrap');
  content.before(host);
  host.append(content);
  const buttons = [-1, 1].map((direction) => {
    const button = el(doc, 'button', `cts-rail-scroll-button ${direction < 0 ? 'cts-up' : 'cts-down'}`, icon('chevron-down', 12));
    button.setAttribute('type', 'button');
    button.setAttribute('aria-label', direction < 0 ? 'Scroll tools up' : 'Scroll tools down');
    host.append(button);
    return button;
  });
  let delay: number | undefined, repeat: number | undefined;
  const stop = (): void => { win.clearTimeout(delay); win.clearInterval(repeat); };
  const available = (direction: number): boolean => direction < 0 ? content.scrollTop > 1 : content.scrollTop + content.clientHeight < content.scrollHeight - 1;
  const update = (): void => {
    for (const [index, direction] of [-1, 1].entries()) {
      const canScroll = available(direction);
      host.classList.toggle(direction < 0 ? 'cts-can-scroll-up' : 'cts-can-scroll-down', canScroll);
      buttons[index].style.display = canScroll ? '' : 'none';
    }
  };
  for (const [index, direction] of [-1, 1].entries()) {
    const button = buttons[index];
    const page = (): void => {
      if (!available(direction)) { stop(); return; }
      content.scrollBy({ top: direction * Math.max(40, content.clientHeight * 0.6),
        behavior: win.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    button.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      stop(); page();
      delay = win.setTimeout(() => { repeat = win.setInterval(page, 160); }, 350);
    });
    button.addEventListener('click', (event) => { if (event.detail === 0) page(); });
    for (const type of ['pointerleave', 'pointerup', 'pointercancel']) button.addEventListener(type, stop);
  }
  const visibility = (): void => { if (doc.hidden) stop(); };
  doc.addEventListener('pointerup', stop);
  doc.addEventListener('pointercancel', stop);
  doc.addEventListener('visibilitychange', visibility);
  content.addEventListener('scroll', update, { passive: true });
  const observer = win.ResizeObserver ? new win.ResizeObserver(update) : null;
  observer?.observe(content);
  update();
  return () => {
    stop(); observer?.disconnect();
    doc.removeEventListener('pointerup', stop);
    doc.removeEventListener('pointercancel', stop);
    doc.removeEventListener('visibilitychange', visibility);
    content.removeEventListener('scroll', update);
    host.before(content); host.remove();
  };
}
