// The @pkmn/dex instances behind legalData.ts. This is the only module that
// imports @pkmn/dex or @pkmn/mods, and legalData.ts loads it with a dynamic
// import, so that data (about 2.8 MB before compression) goes into its own
// chunk and downloads after first paint instead of blocking it.
//
// Champions uses Showdown's `champions` mod from @pkmn/mods. That mod brings
// its own learnsets, items and legality flags. It has no species table, so
// species ability lists come from Showdown's shared Gen 9 pokedex, which is
// also what Showdown validates Champions teams against.

import { Dex, type ID, type ModData, type ModdedDex } from '@pkmn/dex';
import { Abilities, FormatsData, Items, Learnsets, Moves } from '@pkmn/mods/champions';
import type { Game } from '../../../src/types';

// Only the mod's data tables are imported. Its Scripts, Rulesets and Formats
// pull in a bundled copy of the whole Showdown simulator (about 9 MB), which
// legality lookups do not need. In the Vite build, ui/championsDataPlugin.ts
// also strips that simulator code from the module, because Rollup cannot
// tree-shake it. `gen: 9` makes Gen 9 the parent data, as in the full mod.
// The package README says mod data must be cast to ModData. The exports map
// has no types entry, so ui/tsconfig.json maps the path to the .d.ts for type
// checking.
const championsData = { Abilities, FormatsData, Items, Learnsets, Moves, Scripts: { gen: 9 } };

export const DEXES: Readonly<Record<Game, ModdedDex>> = {
  champions: Dex.mod('champions' as ID, championsData as unknown as ModData),
  gen9: Dex.forGen(9),
};
