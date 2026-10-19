// The reference for the trimmed module is the untrimmed package module: every
// table it exports must match the full @pkmn/mods/champions build exactly.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { CHAMPIONS_TABLES, trimChampionsModule } from './championsDataPlugin';

// The package's exports map hides the .mjs path from require, so start from
// the main entry (build/index.js) and step into build/champions.
const require = createRequire(import.meta.url);
const buildDir = dirname(require.resolve('@pkmn/mods'));
const modulePath = join(buildDir, 'champions', 'index.mjs');
const original = readFileSync(modulePath, 'utf8');

const outDir = mkdtempSync(join(tmpdir(), 'champions-trim-'));
afterAll(() => rmSync(outDir, { recursive: true, force: true }));

// Functions (simulator event handlers) cannot be compared; mark their place.
const comparable = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) => (typeof v === 'function' ? '[function]' : v));

describe('trimChampionsModule', () => {
  const trimmed = trimChampionsModule(original);

  it('drops the bundled simulator', () => {
    expect(trimmed.length).toBeLessThan(original.length / 10);
    expect(trimmed).not.toContain('// ../sim/');
    expect(trimmed).not.toMatch(/^import /m);
  });

  it('exports the same tables as the full module', async () => {
    const file = join(outDir, 'trimmed.mjs');
    writeFileSync(file, trimmed);
    const slim = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
    const full = (await import(pathToFileURL(modulePath).href)) as Record<string, unknown>;
    expect(Object.keys(slim).sort()).toEqual([...CHAMPIONS_TABLES].sort());
    for (const name of CHAMPIONS_TABLES) {
      expect(comparable(slim[name]), name).toBe(comparable(full[name]));
    }
  });

  it('fails loudly if the package layout changes', () => {
    expect(() => trimChampionsModule('var Abilities = {};')).toThrow(/layout changed/);
    const noItems = original.replace(/^var Items = \{/m, 'var ItemsRenamed = {');
    expect(() => trimChampionsModule(noItems)).toThrow(/Items/);
  });
});
