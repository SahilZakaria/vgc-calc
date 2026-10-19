// Pure logic behind PokemonInput: game data lookups from @smogon/calc and the
// update rules for each field. Kept out of the .tsx so it can be tested
// without a DOM.
//
// Relative imports (not '@vgc/*') so the root vitest run, which has no alias,
// can load this file.

import { Generations, toID } from '@smogon/calc';
import { calculateStats } from '../../../src/calc/stats';
import {
  CHAMPIONS_IV,
  CHAMPIONS_LEVEL,
  MAX_SP_PER_STAT,
  MAX_SP_TOTAL,
  spToEv,
} from '../../../src/champions/stats';
import type { Game, Pokemon, StatName, StatTable, TypeName } from '../../../src/types';

export type BoostStat = keyof Pokemon['statBoosts'];
export type Status = Pokemon['status'];

export const STAT_NAMES: readonly StatName[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
export const BOOST_STATS: readonly BoostStat[] = ['atk', 'def', 'spa', 'spd', 'spe'];

export const STAT_LABELS: Readonly<Record<StatName, string>> = {
  hp: 'HP',
  atk: 'Atk',
  def: 'Def',
  spa: 'SpA',
  spd: 'SpD',
  spe: 'Spe',
};

// The 18 battle types from src/types.ts. Stellar is a Tera type in Scarlet/
// Violet but TypeName has no slot for it, so it is not offered.
export const TYPE_NAMES: readonly TypeName[] = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
  'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug',
  'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
];

export const STATUS_OPTIONS: readonly { value: Status; label: string }[] = [
  { value: 'none', label: 'Healthy' },
  { value: 'brn', label: 'Burned' },
  { value: 'par', label: 'Paralyzed' },
  { value: 'psn', label: 'Poisoned' },
  { value: 'tox', label: 'Badly poisoned' },
  { value: 'slp', label: 'Asleep' },
  { value: 'frz', label: 'Frozen' },
];

export const MIN_BOOST = -6;
export const MAX_BOOST = 6;

// Scarlet/Violet spread limits.
export const GEN9_MAX_EV_PER_STAT = 252;
export const GEN9_MAX_EV_TOTAL = 510;
export const GEN9_MAX_IV = 31;
export const GEN9_MIN_LEVEL = 1;
export const GEN9_MAX_LEVEL = 100;

export interface NatureOption {
  name: string;
  plus: BoostStat | null;
  minus: BoostStat | null;
}

export interface GameData {
  species: readonly string[];
  abilities: readonly string[];
  items: readonly string[];
  natures: readonly NatureOption[];
}

// @smogon/calc numbers Champions as generation 0 and Scarlet/Violet as 9.
function generation(game: Game) {
  return Generations.get(game === 'champions' ? 0 : 9);
}

const byName = (a: string, b: string): number => a.localeCompare(b);

const gameDataCache = new Map<Game, GameData>();

export function getGameData(game: Game): GameData {
  const cached = gameDataCache.get(game);
  if (cached) return cached;

  const gen = generation(game);
  const natures: NatureOption[] = [];
  for (const nature of gen.natures) {
    // Neutral natures list the same stat as plus and minus.
    const neutral = nature.plus === nature.minus;
    natures.push({
      name: nature.name,
      plus: neutral || nature.plus === undefined || nature.plus === 'hp' ? null : nature.plus,
      minus: neutral || nature.minus === undefined || nature.minus === 'hp' ? null : nature.minus,
    });
  }

  const data: GameData = {
    species: Array.from(gen.species, (s) => s.name).sort(byName),
    abilities: Array.from(gen.abilities, (a) => a.name).sort(byName),
    items: Array.from(gen.items, (i) => i.name).sort(byName),
    natures: natures.sort((a, b) => byName(a.name, b.name)),
  };
  gameDataCache.set(game, data);
  return data;
}

function isTypeName(value: string): value is TypeName {
  return (TYPE_NAMES as readonly string[]).includes(value);
}

// Returns the Pokemon with the new species' base stats, types, weight and
// first listed ability, or null if the species is not in this game's data.
// HP is reset to full because max HP changes with the species.
export function applySpecies(pokemon: Pokemon, speciesName: string, game: Game): Pokemon | null {
  const species = generation(game).species.get(toID(speciesName));
  if (!species) return null;

  const types = species.types.filter(isTypeName);
  const ability = species.abilities?.[0] ?? pokemon.ability;
  return {
    ...pokemon,
    species: species.name,
    baseStats: { ...species.baseStats },
    types,
    weightKg: species.weightkg,
    ability,
    teraType: pokemon.teraType ?? types[0],
    currentHp: null,
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function mapStats(fn: (stat: StatName) => number): StatTable {
  return {
    hp: fn('hp'),
    atk: fn('atk'),
    def: fn('def'),
    spa: fn('spa'),
    spd: fn('spd'),
    spe: fn('spe'),
  };
}

// The Stat Point count giving the same level 50 stat as `ev` EVs with 31 IVs:
// 8n - 4 EVs maps back to n, and in-between values round down. Inverse of
// spToEv on every value spToEv produces.
export function evToSp(ev: number): number {
  const evs = clampInt(ev, 0, GEN9_MAX_EV_PER_STAT);
  return Math.min(MAX_SP_PER_STAT, Math.floor((Math.floor(evs / 4) + 1) / 2));
}

export function statPoints(pokemon: Pokemon): StatTable {
  return mapStats((stat) => evToSp(pokemon.evs[stat]));
}

// Champions has no level, IV or Tera inputs. Applied to every change the
// component emits in Champions mode so the parent always receives a Pokemon
// the Champions calc accepts: level 50, 31 IVs, EVs that are exact SP values,
// not Terastallized.
export function normalizeForGame(pokemon: Pokemon, game: Game): Pokemon {
  if (game !== 'champions') return pokemon;
  return {
    ...pokemon,
    level: CHAMPIONS_LEVEL,
    ivs: mapStats(() => CHAMPIONS_IV),
    evs: mapStats((stat) => spToEv(evToSp(pokemon.evs[stat]))),
    isTerastallized: false,
  };
}

export interface SpreadLimits {
  perStat: number;
  total: number;
  used: number;
  unit: 'SP' | 'EVs';
}

export function spreadLimits(pokemon: Pokemon, game: Game): SpreadLimits {
  if (game === 'champions') {
    const sp = statPoints(pokemon);
    const used = STAT_NAMES.reduce((sum, stat) => sum + sp[stat], 0);
    return { perStat: MAX_SP_PER_STAT, total: MAX_SP_TOTAL, used, unit: 'SP' };
  }
  const used = STAT_NAMES.reduce((sum, stat) => sum + pokemon.evs[stat], 0);
  return { perStat: GEN9_MAX_EV_PER_STAT, total: GEN9_MAX_EV_TOTAL, used, unit: 'EVs' };
}

// The value shown in a stat's spread input: SP in Champions, EVs in Gen 9.
export function spreadValue(pokemon: Pokemon, game: Game, stat: StatName): number {
  return game === 'champions' ? evToSp(pokemon.evs[stat]) : pokemon.evs[stat];
}

// Sets one stat's spread from user input, clamped to the per-stat maximum and
// to whatever the total budget has left after the other five stats.
export function setSpreadValue(pokemon: Pokemon, game: Game, stat: StatName, input: number): Pokemon {
  const limits = spreadLimits(pokemon, game);
  const others = limits.used - spreadValue(pokemon, game, stat);
  const value = clampInt(input, 0, Math.min(limits.perStat, limits.total - others));
  const ev = game === 'champions' ? spToEv(value) : value;
  return { ...pokemon, evs: { ...pokemon.evs, [stat]: ev } };
}

export function setIv(pokemon: Pokemon, stat: StatName, input: number): Pokemon {
  return { ...pokemon, ivs: { ...pokemon.ivs, [stat]: clampInt(input, 0, GEN9_MAX_IV) } };
}

export function setLevel(pokemon: Pokemon, input: number): Pokemon {
  return { ...pokemon, level: clampInt(input, GEN9_MIN_LEVEL, GEN9_MAX_LEVEL) };
}

export function setBoost(pokemon: Pokemon, stat: BoostStat, input: number): Pokemon {
  return {
    ...pokemon,
    statBoosts: { ...pokemon.statBoosts, [stat]: clampInt(input, MIN_BOOST, MAX_BOOST) },
  };
}

// Final unboosted stats, or null if the nature is not one the calc knows.
export function finalStats(pokemon: Pokemon, game: Game): StatTable | null {
  const p = normalizeForGame(pokemon, game);
  try {
    return calculateStats(p.baseStats, p.ivs, p.evs, p.nature, p.level);
  } catch {
    return null;
  }
}

// Case- and punctuation-insensitive search: prefix matches first, then
// substring matches, both in the list's own order.
export function filterOptions(options: readonly string[], query: string, limit: number): string[] {
  const needle = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (needle === '') return options.slice(0, limit);
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const option of options) {
    const hay = option.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (hay.startsWith(needle)) prefix.push(option);
    else if (hay.includes(needle)) contains.push(option);
    if (prefix.length >= limit) break;
  }
  return prefix.concat(contains).slice(0, limit);
}
