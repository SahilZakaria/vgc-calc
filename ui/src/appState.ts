// State behind App: the starting doubles field, what happens on a game
// switch, switch-in stage changes, and the damage contexts for every
// attacker/defender pair. Kept out of App.tsx so it can be tested without a
// DOM.
//
// Relative imports (not '@vgc/*') so the root vitest run, which has no alias,
// can load this file.

import { calculate } from '../../src/calc/calculate';
import {
  resolveSwitchInField,
  type FieldAbilityResult,
  type FieldKind,
  type SwitchInEntry,
} from '../../src/calc/field-abilities';
import { applyStageChanges, resolveIntimidate, type StageChanges } from '../../src/calc/intimidate';
import { turnOrder, type TurnOrder, type TurnOrderEntry } from '../../src/calc/turn-order';
import { spToEv } from '../../src/champions/stats';
import type {
  DamageContext,
  DamageResult,
  FieldState,
  Game,
  Move,
  Pokemon,
  SideState,
  StatTable,
  Terrain,
  Weather,
} from '../../src/types';
import { findMove } from './components/moveData';
import { applySpecies, BOOST_STATS, normalizeForGame, type BoostStat } from './components/pokemonInputModel';

// ---------------------------------------------------------------------------
// Field layout
// ---------------------------------------------------------------------------

/** The two sides of the field. FieldInput's "attackerSide" is the left side. */
export type Side = 'left' | 'right';

/** One position on the field: two per side. */
export type Slot = 'left1' | 'left2' | 'right1' | 'right2';

export const SLOTS: readonly Slot[] = ['left1', 'left2', 'right1', 'right2'];

export const SIDE_SLOTS: Readonly<Record<Side, readonly [Slot, Slot]>> = {
  left: ['left1', 'left2'],
  right: ['right1', 'right2'],
};

export const SIDES: readonly Side[] = ['left', 'right'];

export const sideOf = (slot: Slot): Side => (slot === 'left1' || slot === 'left2' ? 'left' : 'right');

export const otherSide = (side: Side): Side => (side === 'left' ? 'right' : 'left');

/**
 * One Pokemon on the field and what it does this turn. Declared here rather
 * than in src/types.ts, which is off limits.
 *
 * `pokemon.statBoosts` holds the stages the user entered. Switch-in effects
 * (Intimidate) are added on top by effectivePokemon, except on the stats in
 * `manualStages`: the user set those by hand, and they are used as entered.
 */
export interface SlotState {
  pokemon: Pokemon;
  move: Move;
  isCritical: boolean;
  manualStages: readonly BoostStat[];
  /**
   * The held item has already been used or lost, so Unburden is active.
   * Battle state the calc cannot know, so the user sets it. Only read for a
   * Pokemon whose ability is Unburden.
   */
  itemConsumed: boolean;
}

/** Everything the calculator screen edits. */
export interface CalcState {
  game: Game;
  field: FieldState;
  /** Trick Room is up. FieldState (src/types.ts) has no flag for it. */
  isTrickRoom: boolean;
  /**
   * The user picked the weather by hand, or chose to ignore it, while a
   * Pokemon's ability sets it: `field.weather` is used instead of the
   * ability's weather. Same for terrain. See switchInField.
   */
  ignoreAbilityWeather: boolean;
  ignoreAbilityTerrain: boolean;
  slots: Record<Slot, SlotState>;
}

/**
 * The slots in play. Doubles uses all four. Singles is one Pokemon a side, so
 * only the first slot on each side takes part; the second slots keep their
 * sets for when doubles is turned back on.
 */
export function activeSlots(state: CalcState): Slot[] {
  return state.field.isDoubles ? [...SLOTS] : ['left1', 'right1'];
}

/** The active Pokemon on the other side from `slot`. */
export function foesOf(state: CalcState, slot: Slot): Slot[] {
  const foeSide = otherSide(sideOf(slot));
  return activeSlots(state).filter((s) => sideOf(s) === foeSide);
}

// ---------------------------------------------------------------------------
// Starting state
// ---------------------------------------------------------------------------

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp,
  atk,
  def,
  spa,
  spd,
  spe,
});

// Placeholder values; applySpecies fills in species, types, base stats and
// weight from the game data.
const BLANK_POKEMON: Pokemon = {
  species: '',
  level: 50,
  types: ['Normal'],
  isTerastallized: false,
  baseStats: table(1, 1, 1, 1, 1, 1),
  ivs: table(31, 31, 31, 31, 31, 31),
  evs: table(0, 0, 0, 0, 0, 0),
  nature: 'Hardy',
  ability: '',
  abilitySuppressed: false,
  item: null,
  weightKg: 0,
  currentHp: null,
  statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  status: 'none',
};

function makePokemon(game: Game, species: string, set: Partial<Pokemon>): Pokemon {
  const base = applySpecies(BLANK_POKEMON, species, game);
  if (!base) throw new Error(`${species} is missing from the ${game} species data`);
  return normalizeForGame({ ...base, ...set }, game);
}

export const EMPTY_SIDE: SideState = {
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  tailwind: false,
  helpingHand: false,
  friendGuard: false,
  battery: false,
  powerSpot: false,
  steelySpirit: false,
  stealthRock: false,
  spikes: 0,
};

export const DEFAULT_FIELD: FieldState = {
  weather: 'none',
  terrain: 'none',
  isDoubles: true,
  isGravity: false,
  isWonderRoom: false,
  isMagicRoom: false,
  isBeadsOfRuin: false,
  isSwordOfRuin: false,
  isTabletsOfRuin: false,
  isVesselOfRuin: false,
  attackerSide: EMPTY_SIDE,
  defenderSide: EMPTY_SIDE,
};

function requireMove(game: Game, name: string): Move {
  const move = findMove(game, name);
  if (!move) throw new Error(`${name} is missing from the ${game} move data`);
  return move;
}

const slotState = (pokemon: Pokemon, move: Move): SlotState => ({
  pokemon,
  move,
  isCritical: false,
  manualStages: [],
  itemConsumed: false,
});

// Starting field, Champions doubles:
//   left:  Adamant 32 Atk SP Garchomp (Earthquake),
//          Timid 32 SpA / 32 Spe SP Charizard (Heat Wave)
//   right: Hardy 32 HP SP Incineroar with Intimidate (Flare Blitz),
//          Modest 32 HP / 32 SpA SP Gardevoir (Dazzling Gleam)
// Three of the four moves are spread moves, so the 0.75x reduction shows.
export function initialState(): CalcState {
  const game: Game = 'champions';
  return {
    game,
    field: DEFAULT_FIELD,
    isTrickRoom: false,
    ignoreAbilityWeather: false,
    ignoreAbilityTerrain: false,
    slots: {
      left1: slotState(
        makePokemon(game, 'Garchomp', {
          nature: 'Adamant',
          ability: 'Rough Skin',
          evs: table(0, spToEv(32), 0, 0, 0, 0),
        }),
        requireMove(game, 'Earthquake'),
      ),
      left2: slotState(
        makePokemon(game, 'Charizard', {
          nature: 'Timid',
          ability: 'Blaze',
          evs: table(0, 0, 0, spToEv(32), 0, spToEv(32)),
        }),
        requireMove(game, 'Heat Wave'),
      ),
      right1: slotState(
        makePokemon(game, 'Incineroar', {
          nature: 'Hardy',
          ability: 'Intimidate',
          evs: table(spToEv(32), 0, 0, 0, 0, 0),
        }),
        requireMove(game, 'Flare Blitz'),
      ),
      right2: slotState(
        makePokemon(game, 'Gardevoir', {
          nature: 'Modest',
          ability: 'Synchronize',
          evs: table(spToEv(32), 0, 0, spToEv(32), 0, 0),
        }),
        requireMove(game, 'Dazzling Gleam'),
      ),
    },
  };
}

function mapSlots(state: CalcState, fn: (slot: SlotState) => SlotState): Record<Slot, SlotState> {
  return {
    left1: fn(state.slots.left1),
    left2: fn(state.slots.left2),
    right1: fn(state.slots.right1),
    right2: fn(state.slots.right2),
  };
}

// Switching games keeps the sets and field as entered, with these changes:
// - Champions sets are forced to level 50, 31 IVs, SP-exact EVs and no Tera
//   (normalizeForGame). Going to Gen 9 changes nothing on the Pokemon.
// - Every move is reloaded from the new game's data, since power and flags
//   can differ. A move the new game lacks is kept and MoveInput flags it.
// - Field flags the new game has no use for (Ruin, primal weather) stay in
//   state; the Champions calc ignores them and FieldInput shows a stray
//   primal weather as "not in Champions".
export function switchGame(state: CalcState, game: Game): CalcState {
  if (state.game === game) return state;
  return {
    ...state,
    game,
    slots: mapSlots(state, (s) => ({
      ...s,
      pokemon: normalizeForGame(s.pokemon, game),
      move: findMove(game, s.move.name) ?? s.move,
    })),
  };
}

/** Replaces one slot's move, crit flag or item-consumed flag. */
export function updateSlot(state: CalcState, slot: Slot, patch: Partial<Omit<SlotState, 'pokemon' | 'manualStages'>>): CalcState {
  return { ...state, slots: { ...state.slots, [slot]: { ...state.slots[slot], ...patch } } };
}

// ---------------------------------------------------------------------------
// Switch-in stage changes
// ---------------------------------------------------------------------------

// One automatic stage change on one Pokemon and what caused it, so the UI can
// show why a number moved and let the user turn it off.
export interface StageEffect {
  /** The Pokemon whose stages change. */
  slot: Slot;
  /** What triggered it, e.g. "Incineroar's Intimidate". */
  source: string;
  /** The ability or item that blocked or changed it, e.g. "Defiant". */
  cause: string | null;
  /** The stage changes the effect makes. Empty when it was blocked. */
  changes: StageChanges;
  /** Stats in `changes` the user set by hand; those changes are not applied. */
  overridden: BoostStat[];
}

export const changedStats = (changes: StageChanges): BoostStat[] =>
  BOOST_STATS.filter((stat) => (changes[stat] ?? 0) !== 0);

interface ResolvedStages {
  effects: StageEffect[];
  boosts: Record<Slot, Pokemon['statBoosts']>;
}

// Every Intimidate on the field. Each active Intimidate user hits every
// active foe, so in doubles one Intimidate lowers both opposing Pokemon, and
// two Intimidates on one side stack.
//
// Effects resolve one at a time, each against the stages left by the ones
// before it, so a stat near -6 or +6 clamps the way it would in battle.
// Order is slot order (left1, left2, right1, right2), and each user hits its
// foes in slot order. In battle the order follows Speed; it only changes the
// result when the stage limit is reached part way.
function resolveStages(state: CalcState): ResolvedStages {
  const boosts: Record<Slot, Pokemon['statBoosts']> = {
    left1: state.slots.left1.pokemon.statBoosts,
    left2: state.slots.left2.pokemon.statBoosts,
    right1: state.slots.right1.pokemon.statBoosts,
    right2: state.slots.right2.pokemon.statBoosts,
  };
  const effects: StageEffect[] = [];
  const current = (slot: Slot): Pokemon => ({ ...state.slots[slot].pokemon, statBoosts: boosts[slot] });

  const record = (slot: Slot, source: string, cause: string | null, changes: StageChanges) => {
    const manual = state.slots[slot].manualStages;
    const overridden = changedStats(changes).filter((stat) => manual.includes(stat));
    effects.push({ slot, source, cause, changes, overridden });
    const applied: StageChanges = {};
    for (const stat of changedStats(changes)) {
      if (!overridden.includes(stat)) applied[stat] = changes[stat];
    }
    boosts[slot] = applyStageChanges(boosts[slot], applied);
  };

  for (const user of activeSlots(state)) {
    for (const foe of foesOf(state, user)) {
      const result = resolveIntimidate(current(user), current(foe));
      if (!result) continue;
      const userName = state.slots[user].pokemon.species;
      record(foe, `${userName}'s Intimidate`, result.cause, result.target);
      if (changedStats(result.source).length > 0) {
        record(user, `${state.slots[foe].pokemon.species}'s Mirror Armor`, null, result.source);
      }
    }
  }
  return { effects, boosts };
}

export function stageEffects(state: CalcState): StageEffect[] {
  return resolveStages(state).effects;
}

// The Pokemon as the calc sees it: the entered stages plus every automatic
// change on a stat the user has not set by hand.
export function effectivePokemon(state: CalcState, slot: Slot): Pokemon {
  return { ...state.slots[slot].pokemon, statBoosts: resolveStages(state).boosts[slot] };
}

/** All four Pokemon as the calc sees them, resolved once. */
export function effectiveField(state: CalcState): Record<Slot, Pokemon> {
  const { boosts } = resolveStages(state);
  const shown = (slot: Slot): Pokemon => ({ ...state.slots[slot].pokemon, statBoosts: boosts[slot] });
  return { left1: shown('left1'), left2: shown('left2'), right1: shown('right1'), right2: shown('right2') };
}

// Applies an edit from PokemonInput, which shows and emits the effective
// Pokemon. A stage that differs from what was shown was picked by the user:
// it is stored as picked and marked as set by hand. Every other stage keeps
// its entered value, so an automatic change is never stored.
export function editPokemon(state: CalcState, slot: Slot, next: Pokemon): CalcState {
  const shown = effectivePokemon(state, slot);
  const entry = state.slots[slot];
  const manual = new Set(entry.manualStages);
  const statBoosts = { ...next.statBoosts };
  for (const stat of BOOST_STATS) {
    if (next.statBoosts[stat] !== shown.statBoosts[stat]) manual.add(stat);
    else statBoosts[stat] = entry.pokemon.statBoosts[stat];
  }
  return {
    ...state,
    slots: {
      ...state.slots,
      [slot]: {
        ...entry,
        pokemon: { ...next, statBoosts },
        manualStages: BOOST_STATS.filter((stat) => manual.has(stat)),
      },
    },
  };
}

// manual true: automatic changes stop applying to these stats and the entered
// stage is used as is. manual false: automatic changes are added on top of
// the entered stage again.
export function setManualStages(state: CalcState, slot: Slot, stats: readonly BoostStat[], manual: boolean): CalcState {
  const entry = state.slots[slot];
  const current = new Set(entry.manualStages);
  for (const stat of stats) {
    if (manual) current.add(stat);
    else current.delete(stat);
  }
  return {
    ...state,
    slots: { ...state.slots, [slot]: { ...entry, manualStages: BOOST_STATS.filter((stat) => current.has(stat)) } },
  };
}

// ---------------------------------------------------------------------------
// Switch-in weather and terrain
// ---------------------------------------------------------------------------

/** The weather or terrain the calc uses, and where it came from. */
export interface FieldEffect<T extends string> {
  /** What the calc uses. */
  value: T;
  /**
   * 'ability': set by the winning switch-in ability.
   * 'manual': the dropdown value, because no ability sets it or the user
   * chose to ignore the ability (`ignored`).
   */
  source: 'ability' | 'manual';
  /** An ability would set it, but the user picked by hand or ignored it. */
  ignored: boolean;
  /** Every setter on the field and which one won. */
  abilities: FieldAbilityResult<T>;
}

export interface SwitchInField {
  weather: FieldEffect<Weather>;
  terrain: FieldEffect<Terrain>;
  /** state.field with the weather and terrain in effect. */
  field: FieldState;
}

const sideStateOf = (state: CalcState, slot: Slot): SideState =>
  sideOf(slot) === 'left' ? state.field.attackerSide : state.field.defenderSide;

function effectOf<T extends string>(abilities: FieldAbilityResult<T>, manual: T, ignore: boolean): FieldEffect<T> {
  const winner = abilities.winner;
  if (winner && !ignore) return { value: winner.value, source: 'ability', ignored: false, abilities };
  return { value: manual, source: 'manual', ignored: winner !== null, abilities };
}

// Weather and terrain from the active Pokemon's switch-in abilities (Drought,
// Electric Surge and the rest). The slowest setter activates last and wins,
// by the same effective Speed the turn order uses; see field-abilities.ts.
//
// The weather is one value, so an ability's weather and a manual pick never
// stack: the ability's weather is used unless the user has picked a weather
// by hand or ignored the ability, and then the dropdown's value is used.
export function switchInField(state: CalcState, pokemon: Record<Slot, Pokemon> = effectiveField(state)): SwitchInField {
  const entries: SwitchInEntry[] = activeSlots(state).map((slot) => ({
    id: slot,
    pokemon: pokemon[slot],
    tailwind: sideStateOf(state, slot).tailwind,
    itemConsumed: unburdenActive(state.slots[slot]),
  }));
  const resolved = resolveSwitchInField({
    game: state.game,
    field: state.field,
    isTrickRoom: state.isTrickRoom,
    entries,
  });
  const weather = effectOf(resolved.weather, state.field.weather, state.ignoreAbilityWeather);
  const terrain = effectOf(resolved.terrain, state.field.terrain, state.ignoreAbilityTerrain);
  return { weather, terrain, field: { ...state.field, weather: weather.value, terrain: terrain.value } };
}

// Applies an edit from FieldInput, which shows the weather and terrain in
// effect. Changing either one is a pick by hand: it is stored, and if an
// ability was setting it, that ability is ignored from now on. An unchanged
// weather keeps its stored value, so an ability's weather is never stored.
export function editField(state: CalcState, next: FieldState): CalcState {
  const shown = switchInField(state);
  const weatherPicked = next.weather !== shown.weather.value;
  const terrainPicked = next.terrain !== shown.terrain.value;
  return {
    ...state,
    field: {
      ...next,
      weather: weatherPicked ? next.weather : state.field.weather,
      terrain: terrainPicked ? next.terrain : state.field.terrain,
    },
    ignoreAbilityWeather: state.ignoreAbilityWeather || (weatherPicked && shown.weather.abilities.winner !== null),
    ignoreAbilityTerrain: state.ignoreAbilityTerrain || (terrainPicked && shown.terrain.abilities.winner !== null),
  };
}

// ignored true: use the dropdown's weather (or terrain) over the ability's.
// ignored false: the ability's applies again.
export function setAbilityFieldIgnored(state: CalcState, kind: FieldKind, ignored: boolean): CalcState {
  return kind === 'weather' ? { ...state, ignoreAbilityWeather: ignored } : { ...state, ignoreAbilityTerrain: ignored };
}

// ---------------------------------------------------------------------------
// Damage contexts
// ---------------------------------------------------------------------------

// The field from `side`'s point of view as the attacker. FieldInput's
// "attackerSide" is the left side, so a hit from the right swaps the two:
// the left side's Reflect protects the left Pokemon, and its Helping Hand
// only boosts left attackers. Weather, terrain, rooms and the Ruin flags are
// shared and stay as they are.
export function fieldFor(field: FieldState, attackingSide: Side): FieldState {
  if (attackingSide === 'left') return field;
  return { ...field, attackerSide: field.defenderSide, defenderSide: field.attackerSide };
}

/**
 * `attacker`'s move into `defender`, with switch-in stage changes and the
 * weather and terrain in effect (switchInField) applied.
 * A spread move gets its 0.75x reduction from the calc itself (field in
 * doubles, move target allAdjacent or allAdjacentFoes), the same way against
 * each of the two foes.
 */
export function matchupContext(
  state: CalcState,
  attacker: Slot,
  defender: Slot,
  pokemon: Record<Slot, Pokemon> = effectiveField(state),
  field: FieldState = switchInField(state, pokemon).field,
): DamageContext {
  const entry = state.slots[attacker];
  return {
    game: state.game,
    attacker: pokemon[attacker],
    defender: pokemon[defender],
    move: entry.move,
    field: fieldFor(field, sideOf(attacker)),
    isCritical: entry.isCritical,
  };
}

export type CalcOutcome = { ok: true; result: DamageResult } | { ok: false; error: string };

// The calc throws on input it cannot use (an unknown nature, for one). The
// UI shows the message instead of crashing while the user is mid-edit.
export function runCalc(ctx: DamageContext): CalcOutcome {
  try {
    return { ok: true, result: calculate(ctx) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface Matchup {
  attacker: Slot;
  defender: Slot;
  ctx: DamageContext;
  outcome: CalcOutcome;
}

/**
 * Every active attacker into every active foe, grouped by the attacking side:
 * in doubles, four hits from the left and four from the right.
 */
export function allMatchups(state: CalcState): Record<Side, Matchup[]> {
  const pokemon = effectiveField(state);
  const { field } = switchInField(state, pokemon);
  const out: Record<Side, Matchup[]> = { left: [], right: [] };
  for (const attacker of activeSlots(state)) {
    for (const defender of foesOf(state, attacker)) {
      const ctx = matchupContext(state, attacker, defender, pokemon, field);
      out[sideOf(attacker)].push({ attacker, defender, ctx, outcome: runCalc(ctx) });
    }
  }
  return out;
}

// One-line description of a hit, e.g. "Garchomp Earthquake vs. Incineroar".
export function matchupLabel(ctx: DamageContext): string {
  const parts = [ctx.attacker.species || 'Attacker', ctx.move.name || 'move', 'vs.', ctx.defender.species || 'defender'];
  return parts.join(' ');
}

// True when the move hits more than one target, so spread reduction applies.
export function isSpread(ctx: DamageContext): boolean {
  const { target } = ctx.move;
  return ctx.field.isDoubles && (target === 'allAdjacent' || target === 'allAdjacentFoes');
}

// ---------------------------------------------------------------------------
// Turn order
// ---------------------------------------------------------------------------

/** Unburden is active for this slot: the toggle only counts for an Unburden holder. */
export function unburdenActive(entry: SlotState): boolean {
  return entry.itemConsumed && entry.pokemon.ability === 'Unburden';
}

/**
 * The order the active Pokemon's moves resolve this turn, under the weather
 * and terrain in effect (so Drought turns on Chlorophyll). Tailwind comes
 * from each Pokemon's own side (FieldInput's attackerSide is the left side).
 * `moveHeals` tells Triage which moves heal; the move data has no such flag.
 */
export function turnOrderFor(
  state: CalcState,
  moveHeals: (game: Game, moveName: string) => boolean = () => false,
  pokemon: Record<Slot, Pokemon> = effectiveField(state),
  field: FieldState = switchInField(state, pokemon).field,
): TurnOrder {
  const entries: TurnOrderEntry[] = activeSlots(state).map((slot) => {
    const entry = state.slots[slot];
    return {
      id: slot,
      pokemon: pokemon[slot],
      move: entry.move,
      tailwind: sideStateOf(state, slot).tailwind,
      itemConsumed: unburdenActive(entry),
      moveHeals: moveHeals(state.game, entry.move.name),
    };
  });
  return turnOrder({ game: state.game, field, isTrickRoom: state.isTrickRoom, entries });
}

/**
 * How each Pokemon is named in the turn order: its species, with the slot
 * added when two Pokemon on the field share a species.
 */
export function turnOrderNames(state: CalcState, slotLabels: Readonly<Record<Slot, string>>): Record<Slot, string> {
  const species = (slot: Slot) => state.slots[slot].pokemon.species || slotLabels[slot];
  const active = activeSlots(state);
  const names = {} as Record<Slot, string>;
  for (const slot of SLOTS) {
    const shared = active.filter((s) => species(s) === species(slot)).length > 1;
    names[slot] = shared ? `${species(slot)} (${slotLabels[slot]})` : species(slot);
  }
  return names;
}
