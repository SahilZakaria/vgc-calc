import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyThemePreference,
  DEFAULT_THEME,
  isThemePreference,
  loadThemePreference,
  saveThemePreference,
  THEME_STORAGE_KEY,
} from './theme';

// Minimal in-memory Storage for the load/save functions.
function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error('SecurityError');
  },
  setItem: (): void => {
    throw new Error('QuotaExceededError');
  },
};

describe('theme preference', () => {
  it('defaults to dark', () => {
    expect(DEFAULT_THEME).toBe('dark');
    expect(loadThemePreference(undefined)).toBe('dark');
    expect(loadThemePreference(memoryStorage())).toBe('dark');
  });

  it('accepts only dark, light and system', () => {
    expect(['dark', 'light', 'system'].every(isThemePreference)).toBe(true);
    expect(isThemePreference('auto')).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });

  it('round-trips a saved choice', () => {
    const storage = memoryStorage();
    saveThemePreference(storage, 'system');
    expect(storage.data.get(THEME_STORAGE_KEY)).toBe('system');
    expect(loadThemePreference(storage)).toBe('system');
  });

  it('falls back to dark on a corrupt saved value', () => {
    expect(loadThemePreference(memoryStorage({ [THEME_STORAGE_KEY]: 'purple' }))).toBe('dark');
  });

  it('survives storage that throws', () => {
    expect(loadThemePreference(throwing)).toBe('dark');
    expect(() => saveThemePreference(throwing, 'light')).not.toThrow();
  });

  it('applies the choice as data-theme', () => {
    const root = { dataset: {} as DOMStringMap };
    applyThemePreference(root, 'light');
    expect(root.dataset.theme).toBe('light');
  });

  it('uses the same storage key and values as the inline script in index.html', () => {
    const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
    expect(html).toContain(`localStorage.getItem('${THEME_STORAGE_KEY}')`);
    for (const value of ['dark', 'light', 'system']) expect(html).toContain(`saved === '${value}'`);
  });
});

// Static checks on the stylesheets: theme.css is the only place a color is
// written, and its two copies of the light palette match.
describe('theme.css', () => {
  const srcDir = fileURLToPath(new URL('.', import.meta.url));
  const css = readFileSync(join(srcDir, 'theme.css'), 'utf8');

  const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;

  const stylesheets = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return stylesheets(path);
      return entry.name.endsWith('.css') ? [path] : [];
    });

  it('is the only stylesheet with color values', () => {
    const others = stylesheets(srcDir).filter((path) => !path.endsWith('theme.css'));
    expect(others.length).toBeGreaterThanOrEqual(5);
    for (const path of others) {
      const withoutComments = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(withoutComments, path).not.toMatch(COLOR_LITERAL);
    }
  });

  it('defines every token a stylesheet uses', () => {
    const defined = new Set([...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    for (const path of stylesheets(srcDir)) {
      const text = readFileSync(path, 'utf8');
      for (const [, name] of text.matchAll(/var\((--(?:color|type)-[\w-]+)/g)) {
        expect(defined.has(name), `${name} in ${path}`).toBe(true);
      }
    }
  });

  it('has identical light palettes for data-theme="light" and system-light', () => {
    const block = (selector: string): string => {
      const start = css.indexOf(selector);
      expect(start, selector).toBeGreaterThanOrEqual(0);
      const open = css.indexOf('{', start);
      return css.slice(open + 1, css.indexOf('}', open)).replace(/\s+/g, ' ').trim();
    };
    expect(block(":root[data-theme='system']")).toBe(block(":root[data-theme='light']"));
  });
});
