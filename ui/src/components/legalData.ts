// Legal abilities, learnsets and items per game, read from @pkmn/dex (Pokemon
// Showdown's data). @smogon/calc stays the source of species stats and move
// data for the damage calc, but it stores only one ability per species and has
// no learnsets, so legality checks come from here.
//
// The dex data lives in legalDex.ts and is loaded with a dynamic import so it
// stays out of the main bundle. Call loadLegalData() (or use the
// useLegalData hook) before relying on the synchronous lookups: until it
// resolves they return empty results. Only type imports from @pkmn/dex are
// allowed here; a value import would pull the whole dex back into the main
// chunk.

import { useEffect, useSyncExternalStore } from 'react';
import { toID } from '@smogon/calc';
import type { ModdedDex, Species } from '@pkmn/dex';
import type { Game } from '../../../src/types';

type Dexes = Readonly<Record<Game, ModdedDex>>;

let dexes: Dexes | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

// Loads the dex data once. Safe to call repeatedly; later calls share the
// first load. A failed load can be retried.
export function loadLegalData(): Promise<void> {
  if (!loading) {
    loading = import('./legalDex').then(
      (mod) => {
        dexes = mod.DEXES;
        for (const listener of listeners) listener();
      },
      (error: unknown) => {
        loading = null;
        throw error;
      },
    );
  }
  return loading;
}

export function isLegalDataReady(): boolean {
  return dexes !== null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Starts loading the dex data after the first render and re-renders the
// component when it arrives. Returns whether it is ready.
export function useLegalData(): boolean {
  const ready = useSyncExternalStore(subscribe, isLegalDataReady, isLegalDataReady);
  useEffect(() => {
    if (!ready) loadLegalData().catch(() => undefined);
  }, [ready]);
  return ready;
}

// Learnset sources look like "9M", "9L27", "8E": the leading digit is the
// generation. Only Gen 9 sources count in both games (Champions entries are
// all "9M").
const GEN9_SOURCE = /^9/;

export interface AbilityOption {
  name: string;
  hidden: boolean;
}

// The species if it exists and is obtainable in this game, else undefined.
// Also undefined while the dex data is not loaded.
function legalSpecies(game: Game, name: string): Species | undefined {
  const species = dexes?.[game].species.get(name);
  return species && species.exists && !species.isNonstandard ? species : undefined;
}

// False while the dex data is not loaded.
export function isSpeciesInGame(game: Game, name: string): boolean {
  return legalSpecies(game, name) !== undefined;
}

// The species' abilities in slot order (0, 1, Hidden, Special). Empty when
// the species is unknown or not obtainable in this game, or while the dex
// data is not loaded.
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
const NO_ITEMS: readonly string[] = [];

// Items obtainable in this game, sorted by name. Showdown marks items the
// game does not have (Mega Stones, Z-Crystals and TRs in Scarlet/Violet;
// anything outside the Champions item list) as nonstandard. Empty while the
// dex data is not loaded.
export function legalItems(game: Game): readonly string[] {
  if (!dexes) return NO_ITEMS;
  const cached = itemCache.get(game);
  if (cached) return cached;
  const items = dexes[game].items
    .all()
    .filter((item) => !item.isNonstandard)
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));
  itemCache.set(game, items);
  return items;
}

// True when Showdown flags the move as healing its user ("heal"), which
// Triage boosts. The move data from @smogon/calc has no such flag. False
// while the dex data is not loaded.
export function isHealingMove(game: Game, moveName: string): boolean {
  const move = dexes?.[game].moves.get(moveName);
  return move !== undefined && move.exists && move.flags.heal === 1;
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
  await loadLegalData();
  const start = legalSpecies(game, speciesName);
  if (!start || !dexes) return null;
  const dex = dexes[game];
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
// Loads the dex data first if needed, and Gen 9 learnsets load on demand, so
// this is async; results are cached. A failed load is not cached.
export function loadLearnset(game: Game, speciesName: string): Promise<ReadonlySet<string> | null> {
  const key = cacheKey(game, speciesName);
  let pending = learnsetCache.get(key);
  if (!pending) {
    pending = buildLearnset(game, speciesName).then(
      (result) => {
        learnsetResults.set(key, result);
        return result;
      },
      (error: unknown) => {
        learnsetCache.delete(key);
        throw error;
      },
    );
    learnsetCache.set(key, pending);
  }
  return pending;
}

// The learnset if loadLearnset has already finished for this species:
// a set, null for "no data", or undefined when not loaded yet.
export function cachedLearnset(game: Game, speciesName: string): ReadonlySet<string> | null | undefined {
  return learnsetResults.get(cacheKey(game, speciesName));
}
