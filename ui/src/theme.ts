// Theme preference: which theme the user picked and where it is saved.
// The colors themselves live in theme.css, keyed on <html data-theme>.
//
// index.html has a small inline copy of loadThemePreference + apply so the
// right theme is set before first paint. Keep THEME_STORAGE_KEY and the
// accepted values in sync with it.

export type ThemePreference = 'dark' | 'light' | 'system';

export const THEME_PREFERENCES: readonly ThemePreference[] = ['dark', 'light', 'system'];
export const DEFAULT_THEME: ThemePreference = 'dark';
export const THEME_STORAGE_KEY = 'vgc-calc:theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value);
}

// Storage access can throw (private windows, blocked site data), and there is
// no window at all in tests, so every read and write is guarded.
export function browserStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadThemePreference(storage: Pick<Storage, 'getItem'> | undefined): ThemePreference {
  try {
    const saved = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(saved) ? saved : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveThemePreference(storage: Pick<Storage, 'setItem'> | undefined, theme: ThemePreference): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not saved; the theme still applies for this visit.
  }
}

// "system" is resolved by the prefers-color-scheme media query in theme.css,
// so it follows OS changes live without a listener here.
export function applyThemePreference(root: { dataset: DOMStringMap }, theme: ThemePreference): void {
  root.dataset.theme = theme;
}
