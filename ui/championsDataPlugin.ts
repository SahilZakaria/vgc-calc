// Vite plugin that trims @pkmn/mods/champions down to its data tables.
//
// The package ships the Champions mod as one 10 MB file: the mod's own tables
// (about 0.5 MB) followed by a bundled copy of the Showdown simulator, which
// the mod's Scripts, Rulesets and Formats need. legalData.ts imports only the
// tables, but the simulator code has top-level side effects (it builds Dex
// objects when the file loads), so Rollup cannot tree-shake it away and it
// ended up in the app bundle.
//
// esbuild emits each source file in order with a "// path" banner, and every
// table legalData.ts uses comes before the first "// ../sim/" banner. This
// plugin keeps only that part and re-exports the tables. If a package update
// changes that layout, the build fails here instead of shipping a broken or
// bloated bundle.

import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/** The tables legalData.ts imports from '@pkmn/mods/champions'. */
export const CHAMPIONS_TABLES = ['Abilities', 'FormatsData', 'Items', 'Learnsets', 'Moves'] as const;

const MODULE_PATH = /[\\/]@pkmn[\\/]mods[\\/]build[\\/]champions[\\/]index\.mjs$/;
const SIM_BANNER = '\n// ../sim/';
// The file opens with an import of esbuild's helpers (__export, __require).
// The tables never call them; dropping the import keeps the shared chunk out.
const HELPER_IMPORT = /^import \{\s*__export,\s*__require\s*\} from "\.\.\/chunk-[A-Z0-9]+\.mjs";\n/;

export function trimChampionsModule(code: string): string {
  const fail = (why: string): never => {
    throw new Error(`championsDataPlugin: @pkmn/mods/champions layout changed (${why}); update ui/championsDataPlugin.ts`);
  };
  const cut = code.indexOf(SIM_BANNER);
  if (cut < 0) fail('no "// ../sim/" banner');
  if (!HELPER_IMPORT.test(code)) fail('unexpected leading import');
  const tables = code.slice(0, cut).replace(HELPER_IMPORT, '');
  if (/\b__(?:require|export)\(/.test(tables)) fail('tables use bundler helpers');
  for (const name of CHAMPIONS_TABLES) {
    if (!new RegExp(`^var ${name} = \\{`, 'm').test(tables)) fail(`table ${name} not found before the simulator`);
  }
  return `${tables}\nexport { ${CHAMPIONS_TABLES.join(', ')} };\n`;
}

export function championsDataPlugin(): Plugin {
  return {
    name: 'vgc-calc:champions-data',
    enforce: 'pre',
    load(id) {
      const file = id.split('?')[0];
      if (!MODULE_PATH.test(file)) return null;
      return { code: trimChampionsModule(readFileSync(file, 'utf8')), map: null };
    },
  };
}
