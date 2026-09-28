// Thin adapter from our src/types.ts contract to @smogon/calc, used only as a
// test oracle. Nothing in src/calc may import this module.
//
// @smogon/calc facts this adapter relies on (read from its 0.12.0 dist):
// - Generations.get(0) is Pokemon Champions; Generations.get(9) is Scarlet/Violet.
// - In generation 0 the Pokemon constructor forces level 50 and IVs of 31, and
//   its `evs` option holds Stat Points (0-32), not EVs.
// - `overrides` on Pokemon and Move are deep-merged over the dex entry, so our
//   own data wins even for species or moves missing from their dex.

import {
  Field as SmogonField,
  Generations,
  Move as SmogonMove,
  Pokemon as SmogonPokemon,
  type State,
  type StatsTable,
} from '@smogon/calc';
import type { FieldState, Move, Pokemon, SideState, StatName, TypeName } from '../types';

// Local types: src/types.ts has no notion of which game a calculation is for.
export type OracleGame = 'champions' | 'gen9';
export type SmogonGeneration = ReturnType<typeof Generations.get>;

type SmogonMoveData = NonNullable<State.Move['overrides']>;
type SmogonSpecieData = NonNullable<State.Pokemon['overrides']>;
type SmogonTypes = NonNullable<SmogonSpecieData['types']>;
type SmogonMoveTarget = NonNullable<SmogonMoveData['target']>;
type SmogonMoveFlags = NonNullable<SmogonMoveData['flags']>;

const STATS: readonly StatName[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const CHAMPIONS_LEVEL = 50;
const CHAMPIONS_MAX_SP_PER_STAT = 32;

export function smogonGeneration(game: OracleGame): SmogonGeneration {
  return Generations.get(game === 'champions' ? 0 : 9);
}

// Inverse of the Champions mapping spToEv(0) = 0, spToEv(n) = 8n - 4.
// Throws on EV values that no Stat Point count produces.
export function evToSp(ev: number): number {
  if (ev === 0) return 0;
  const sp = (ev + 4) / 8;
  if (!Number.isInteger(sp) || sp < 1 || sp > CHAMPIONS_MAX_SP_PER_STAT) {
    throw new Error(`EV value ${ev} does not correspond to a Champions Stat Point count`);
  }
  return sp;
}

function mapStats(table: Pokemon['evs'], fn: (value: number) => number): StatsTable {
  const out: StatsTable = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  for (const stat of STATS) out[stat] = fn(table[stat]);
  return out;
}

function toSmogonTypes(types: TypeName[]): SmogonTypes {
  const [first, second] = types;
  if (first === undefined || types.length > 2) {
    throw new Error(`Pokemon must have one or two types, got ${types.length}`);
  }
  return second === undefined ? [first] : [first, second];
}

export function toSmogonPokemon(game: OracleGame, pokemon: Pokemon): SmogonPokemon {
  const gen = smogonGeneration(game);
  const isChampions = game === 'champions';

  if (isChampions && pokemon.level !== CHAMPIONS_LEVEL) {
    throw new Error(`Champions Pokemon are always level 50, got ${pokemon.level}`);
  }
  if (isChampions && pokemon.isTerastallized) {
    throw new Error('Terastallization does not exist in Champions');
  }

  const options: ConstructorParameters<typeof SmogonPokemon>[2] = {
    nature: pokemon.nature,
    // @smogon/calc has no suppression flag, and an empty ability falls back to
    // the species' first ability. A name matching no real ability disables all
    // of their ability checks, which is the closest equivalent.
    ability: pokemon.abilitySuppressed ? 'No Ability' : pokemon.ability,
    item: pokemon.item ?? undefined,
    boosts: { ...pokemon.statBoosts },
    status: pokemon.status === 'none' ? '' : pokemon.status,
    overrides: {
      types: toSmogonTypes(pokemon.types),
      baseStats: { ...pokemon.baseStats },
      weightkg: pokemon.weightKg,
    },
  };
  if (pokemon.currentHp !== null) options.curHP = pokemon.currentHp;

  if (isChampions) {
    // Level and IVs are fixed by the game; their constructor ignores both.
    options.evs = mapStats(pokemon.evs, evToSp);
  } else {
    options.level = pokemon.level;
    options.ivs = { ...pokemon.ivs };
    options.evs = { ...pokemon.evs };
    // Their teraType means "currently Terastallized as"; an unused Tera type
    // has no representation there and is dropped.
    if (pokemon.isTerastallized && pokemon.teraType !== undefined) {
      options.teraType = pokemon.teraType;
    }
  }

  return new SmogonPokemon(gen, pokemon.species, options);
}

const TARGETS: Readonly<Record<Move['target'], SmogonMoveTarget>> = {
  single: 'normal',
  allAdjacentFoes: 'allAdjacentFoes',
  allAdjacent: 'allAdjacent',
  self: 'self',
};

function toSmogonFlags(flags: Move['flags']): SmogonMoveFlags {
  const bit = (value: boolean): 1 | 0 => (value ? 1 : 0);
  return {
    contact: bit(flags.contact),
    punch: bit(flags.punch),
    sound: bit(flags.sound),
    slicing: bit(flags.slicing),
    bite: bit(flags.bite),
    bullet: bit(flags.bullet),
    wind: bit(flags.wind),
    pulse: bit(flags.pulse),
  };
}

// `variablePower` has no counterpart: @smogon/calc derives weight-, speed- and
// HP-based power from the move's name, so a variable-power move only matches
// when its name exists in their dex.
export function toSmogonMove(
  game: OracleGame,
  move: Move,
  options: { isCrit?: boolean } = {},
): SmogonMove {
  const overrides: SmogonMoveData = {
    basePower: move.basePower,
    type: move.type,
    category: move.category,
    target: TARGETS[move.target],
    priority: move.priority,
    flags: toSmogonFlags(move.flags),
    // Their Move only honours a hit count when the dex entry is multi-hit.
    ...(move.hits > 1 ? { multihit: move.hits } : {}),
  };

  return new SmogonMove(smogonGeneration(game), move.name, {
    overrides,
    hits: move.hits,
    isCrit: options.isCrit ?? false,
  });
}

const WEATHER: Readonly<Record<FieldState['weather'], State.Field['weather']>> = {
  none: undefined,
  sun: 'Sun',
  rain: 'Rain',
  sand: 'Sand',
  snow: 'Snow',
  harshSun: 'Harsh Sunshine',
  heavyRain: 'Heavy Rain',
  strongWinds: 'Strong Winds',
};

const TERRAIN: Readonly<Record<FieldState['terrain'], State.Field['terrain']>> = {
  none: undefined,
  electric: 'Electric',
  grassy: 'Grassy',
  misty: 'Misty',
  psychic: 'Psychic',
};

function toSmogonSide(side: SideState): State.Side {
  return {
    isReflect: side.reflect,
    isLightScreen: side.lightScreen,
    isAuroraVeil: side.auroraVeil,
  };
}

// Only weather, terrain, format, Gravity, Wonder Room and screens are mapped.
// The newer SideState flags (Tailwind, Helping Hand, hazards, ...) and the
// Magic Room / Ruin field flags are not forwarded yet.
export function toSmogonField(field: FieldState): SmogonField {
  return new SmogonField({
    gameType: field.isDoubles ? 'Doubles' : 'Singles',
    weather: WEATHER[field.weather],
    terrain: TERRAIN[field.terrain],
    isGravity: field.isGravity,
    isWonderRoom: field.isWonderRoom,
    attackerSide: toSmogonSide(field.attackerSide),
    defenderSide: toSmogonSide(field.defenderSide),
  });
}
