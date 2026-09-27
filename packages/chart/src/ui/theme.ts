import type { ThemeName } from '../themes.js';
import type { UIDocument, UIElement } from './host.js';
import { Flyouts, iconButton, menuItem, menuLabel, setButtonIcon } from './menu.js';

export type ThemeMode = ThemeName | 'system';

export interface ThemeControlOptions {
  document: UIDocument;
  flyouts: Flyouts;
  /** Initial user selection. Default 'system'. */
  theme?: ThemeMode;
  /** Host-controlled theme. Omits the day/night/system control and ignores system changes. */
  lockedTheme?: ThemeName;
  /** Applies the resolved theme to the chart and host UI, including on creation. */
  onChange(theme: ThemeName): void;
  /** Optional persistence hook; only called for user selections. */
  onSelect?(mode: ThemeMode): void;
}

export interface ThemeControl {
  /** Append to the host toolbar when non-null. Locked controls have no button or menu. */
  readonly element: UIElement | null;
  /** Host updates are allowed while locked; 'system' is ignored when locked. */
  setTheme(theme: ThemeMode): void;
  destroy(): void;
}

const MODES = [['light', 'Light', 'sun'], ['dark', 'Dark', 'moon'], ['system', 'System', 'monitor']] as const;

/** A theme picker that can be removed entirely for an embedded, host-themed chart. */
export function createThemeControl(options: ThemeControlOptions): ThemeControl {
  const { document: doc, flyouts } = options;
  const locked = options.lockedTheme !== undefined;
  let mode: ThemeMode = options.lockedTheme ?? options.theme ?? 'system';
  const query = locked ? undefined : doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)');
  const button = locked ? null : iconButton(doc, 'monitor', 'Theme', 20);
  const menu = locked ? null : flyouts.create();
  const items: UIElement[] = [];
  let detach: (() => void) | undefined;
  const apply = (): void => {
    options.onChange(mode === 'system' ? (query?.matches ? 'dark' : 'light') : mode);
    if (button !== null) MODES.forEach(([value, label, icon], i) => {
      items[i].classList.toggle('cts-active', value === mode);
      items[i].setAttribute('aria-checked', String(value === mode));
      if (value === mode) {
        setButtonIcon(button, icon, 20);
        button.title = `Theme: ${label}`;
        button.setAttribute('aria-label', button.title);
      }
    });
  };
  if (menu !== null && button !== null) {
    menu.append(menuLabel(doc, 'Theme'));
    for (const [value, label, icon] of MODES) {
      const item = menuItem(doc, { icon, label, tick: true, onClick: () => {
        mode = value;
        options.onSelect?.(mode);
        apply();
        flyouts.close();
      } });
      item.setAttribute('role', 'menuitemradio');
      items.push(item); menu.append(item);
    }
    detach = flyouts.attach(button, menu);
  }
  const systemChanged = (): void => { if (mode === 'system') apply(); };
  query?.addEventListener?.('change', systemChanged);
  apply();
  return {
    element: button,
    setTheme(theme) {
      if (locked && theme === 'system') return;
      mode = theme; apply();
    },
    destroy() {
      query?.removeEventListener?.('change', systemChanged);
      detach?.();
      button?.remove(); menu?.remove();
    },
  };
}
