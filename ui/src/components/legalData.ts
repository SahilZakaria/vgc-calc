// Legal abilities, learnsets and items per game, read from @pkmn/dex (Pokemon
// Showdown's data). @smogon/calc stays the source of species stats and move
// data for the damage calc, but it stores only one ability per species and has
// no learnsets, so legality checks come from here.
//
// Champions uses Showdown's `champions` mod from @pkmn/mods. That mod brings
// its own learnsets, items and legality flags. It has no species table, so
// species ability lists come from Showdown's shared Gen 9 pokedex, which is
// also what Showdown validates Champions teams against.

import { Dex, toID, type ID, type ModData, type ModdedDex, type Species } from '@pkmn/dex';
import { Abilities, FormatsData, Items, Learnsets, Moves } from '@pkmn/mods/champions';
import type { Game } from '../../../src/types';

// Only the mod's data tables are imported. Its Scripts, Rulesets and Formats
// pull in a bundled copy of the whole Showdown simulator (about 9 MB), which
// legality lookups do not need. `gen: 9` makes Gen 9 the parent data, as in
// the full mod. The package README says mod data must be cast to ModData.
// The exports map has no types entry, so ui/tsconfig.json maps the path to
// the .d.ts for type checking.
const championsData = { Abilities, FormatsData, Items, Learnsets, Moves, Scripts: { gen: 9 } };

const DEXES: Readonly<Record<Game, ModdedDex>> = {
  champions: Dex.mod('champions' as ID, championsData as unknown as ModData),
  gen9: Dex.forGen(9),
};

// Learnset sources look like "9M", "9L27", "8E": the leading digit is the
// generation. Only Gen 9 sources count in both games (Champions entries are
// all "9M").
const GEN9_SOURCE = /^9/;

export interface AbilityOption {
  name: string;
  hidden: boolean;
}

// The species if it exists and is obtainable in this game, else undefined.
function legalSpecies(game: Game, name: string): Species | undefined {
  const species = DEXES[game].species.get(name);
  return species.exists && !species.isNonstandard ? species : undefined;
}

export function isSpeciesInGame(game: Game, name: string): boolean {
  return legalSpecies(game, name) !== undefined;
}

// The species' abilities in slot order (0, 1, Hidden, Special). Empty when
// the species is unknown or not obtainable in this game.
export function legalAbilities(game: Game, speciesName: string): AbilityOption[] {
  const species = legalSpecies(game, speciesName);
  if (!species) return [];
  const { abilities } = species;
  const options: AbilityOption[] = [];
  for (const [name, hidden] of [
    [abilities[0], false],
    [abilities[1], false],
    [abilities.H, true],
    [abilities.S, false],
  ] as const) {
    if (name && !options.some((o) => o.name === name)) options.push({ name, hidden });
  }
  return options;
}

const itemCache = new Map<Game, readonly string[]>();

// Items obtainable in this game, sorted by name. Showdown marks items the
// game does not have (Mega Stones, Z-Crystals and TRs in Scarlet/Violet;
// anything outside the Champions item list) as nonstandard.
export function legalItems(game: Game): readonly string[] {
  const cached = itemCache.get(game);
  if (cached) return cached;
  const items = DEXES[game].items
    .all()
    .filter((item) => !item.isNonstandard)
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));
  itemCache.set(game, items);
  return items;
}

// Where a species' learnset continues. Battle-only and cosmetic formes
// (Megas, Rotom appliances, Ogerpon masks) also learn their base forme's
// moves. In Gen 9 an evolved Pokemon also learns its pre-evolution's moves
// (Incineroar gets Fake Out and Parting Shot only as Litten egg moves).
// Champions has no breeding or evolution: each roster entry carries its full
// list, and the mod falls back to Scarlet/Violet learnsets for species it
// does not cover, so pre-evolutions are not followed there.
function learnsetParent(game: Game, species: Species, hasOwn: boolean): string | undefined {
  if (species.changesFrom) return species.changesFrom;
  if (!hasOwn && species.baseSpecies !== species.name) return species.baseSpecies;
  return game === 'gen9' ? species.prevo || undefined : undefined;
}

const learnsetCache = new Map<string, Promise<ReadonlySet<string> | null>>();
const learnsetResults = new Map<string, ReadonlySet<string> | null>();
const cacheKey = (game: Game, speciesName: string) => `${game}:${toID(speciesName)}`;

async function buildLearnset(game: Game, speciesName: string): Promise<ReadonlySet<string> | null> {
  const start = legalSpecies(game, speciesName);
  if (!start) return null;
  const dex = DEXES[game];
  const moves = new Set<string>();
  const seen = new Set<string>();
  let current: Species | undefined = start;
  while (current && current.exists && !seen.has(current.id)) {
    seen.add(current.id);
    const entry = (await dex.learnsets.get(current.id)).learnset ?? {};
    const ids = Object.keys(entry);
    for (const id of ids) {
      if (entry[id]?.some((source) => GEN9_SOURCE.test(source))) moves.add(id);
    }
    const parent = learnsetParent(game, current, ids.length > 0);
    current = parent ? dex.species.get(parent) : undefined;
  }
  return moves;
}

// Move IDs the species can learn in this game, or null when @pkmn/dex has no
// learnset for it there (unknown species, or not obtainable in this game).
// Gen 9 learnsets are loaded on demand, so this is async; results are cached.
export function loadLearnset(game: Game, speciesName: string): Promise<ReadonlySet<string> | null> {
  const key = cacheKey(game, speciesName);
  let pending = learnsetCache.get(key);
  if (!pending) {
    pending = buildLearnset(game, speciesName).then((result) => {
      learnsetResults.set(key, result);
      return result;
    });
    learnsetCache.set(key, pending);
  }
  return pending;
}

// The learnset if loadLearnset has already finished for this species:
// a set, null for "no data", or undefined when not loaded yet.
export function cachedLearnset(game: Game, speciesName: string): ReadonlySet<string> | null | undefined {
  return learnsetResults.get(cacheKey(game, speciesName));
}
