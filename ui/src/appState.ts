// State behind App: the starting matchup, what happens on a game switch, and
// running the calc. Kept out of App.tsx so it can be tested without a DOM.
//
// Relative imports (not '@vgc/*') so the root vitest run, which has no alias,
// can load this file.

import { calculate } from '../../src/calc/calculate';
import { applyStageChanges, resolveIntimidate, type StageChanges } from '../../src/calc/intimidate';
import { spToEv } from '../../src/champions/stats';
import type { DamageContext, DamageResult, FieldState, Game, Move, Pokemon, SideState, StatTable } from '../../src/types';
import { findMove } from './components/moveData';
import { applySpecies, BOOST_STATS, normalizeForGame, type BoostStat } from './components/pokemonInputModel';

export type Slot = 'attacker' | 'defender';

// Everything the calculator screen edits. The DamageContext fields are the
// forward hit (attacker's move into defender). The reverse hit (defender's
// move into attacker) shares the Pokemon and field and adds its own move and
// crit flag. Declared here rather than in src/types.ts, which is off limits.
//
// `attacker.statBoosts` and `defender.statBoosts` hold the stages the user
// entered. Switch-in effects (Intimidate) are added on top by
// effectivePokemon, except on the stats listed in `manualStages`: the user
// set those by hand, and they are used exactly as entered.
export interface CalcState extends DamageContext {
  reverseMove: Move;
  reverseIsCritical: boolean;
  manualStages: Record<Slot, readonly BoostStat[]>;
}

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

// Starting matchup: Adamant 32 Atk SP Garchomp's Earthquake into 32 HP SP
// Incineroar, and Incineroar's Flare Blitz back, Champions doubles.
export function initialState(): CalcState {
  const game: Game = 'champions';
  return {
    game,
    attacker: makePokemon(game, 'Garchomp', {
      nature: 'Adamant',
      ability: 'Rough Skin',
      evs: table(0, spToEv(32), 0, 0, 0, 0),
    }),
    defender: makePokemon(game, 'Incineroar', {
      nature: 'Hardy',
      ability: 'Intimidate',
      evs: table(spToEv(32), 0, 0, 0, 0, 0),
    }),
    move: requireMove(game, 'Earthquake'),
    field: DEFAULT_FIELD,
    isCritical: false,
    reverseMove: requireMove(game, 'Flare Blitz'),
    reverseIsCritical: false,
    manualStages: { attacker: [], defender: [] },
  };
}

// Switching games keeps the sets and field as entered, with these changes:
// - Champions sets are forced to level 50, 31 IVs, SP-exact EVs and no Tera
//   (normalizeForGame). Going to Gen 9 changes nothing on the Pokemon.
// - Both moves are reloaded from the new game's data, since power and flags
//   can differ. A move the new game lacks is kept and MoveInput flags it.
// - Field flags the new game has no use for (Ruin, primal weather) stay in
//   state; the Champions calc ignores them and FieldInput shows a stray
//   primal weather as "not in Champions".
export function switchGame(state: CalcState, game: Game): CalcState {
  if (state.game === game) return state;
  return {
    ...state,
    game,
    attacker: normalizeForGame(state.attacker, game),
    defender: normalizeForGame(state.defender, game),
    move: findMove(game, state.move.name) ?? state.move,
    reverseMove: findMove(game, state.reverseMove.name) ?? state.reverseMove,
  };
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

const OTHER: Record<Slot, Slot> = { attacker: 'defender', defender: 'attacker' };

export const changedStats = (changes: StageChanges): BoostStat[] =>
  BOOST_STATS.filter((stat) => (changes[stat] ?? 0) !== 0);

// Every Intimidate on the field, in both directions, as it lands on each
// Pokemon. Resolved against the stages the user entered.
export function stageEffects(state: CalcState): StageEffect[] {
  const effect = (slot: Slot, source: string, cause: string | null, changes: StageChanges): StageEffect => ({
    slot,
    source,
    cause,
    changes,
    overridden: changedStats(changes).filter((stat) => state.manualStages[slot].includes(stat)),
  });
  const effects: StageEffect[] = [];
  for (const user of ['attacker', 'defender'] as const) {
    const foe = OTHER[user];
    const result = resolveIntimidate(state[user], state[foe]);
    if (!result) continue;
    effects.push(effect(foe, `${state[user].species}'s Intimidate`, result.cause, result.target));
    if (changedStats(result.source).length > 0) {
      effects.push(effect(user, `${state[foe].species}'s Mirror Armor`, null, result.source));
    }
  }
  return effects;
}

// The Pokemon as the calc sees it: the entered stages plus every automatic
// change on a stat the user has not set by hand.
export function effectivePokemon(state: CalcState, slot: Slot): Pokemon {
  const pokemon = state[slot];
  let boosts = pokemon.statBoosts;
  for (const effect of stageEffects(state)) {
    if (effect.slot !== slot) continue;
    const applied: StageChanges = {};
    for (const stat of changedStats(effect.changes)) {
      if (!effect.overridden.includes(stat)) applied[stat] = effect.changes[stat];
    }
    boosts = applyStageChanges(boosts, applied);
  }
  return { ...pokemon, statBoosts: boosts };
}

// Applies an edit from PokemonInput, which shows and emits the effective
// Pokemon. A stage that differs from what was shown was picked by the user:
// it is stored as picked and marked as set by hand. Every other stage keeps
// its entered value, so an automatic change is never stored.
export function editPokemon(state: CalcState, slot: Slot, next: Pokemon): CalcState {
  const shown = effectivePokemon(state, slot);
  const manual = new Set(state.manualStages[slot]);
  const statBoosts = { ...next.statBoosts };
  for (const stat of BOOST_STATS) {
    if (next.statBoosts[stat] !== shown.statBoosts[stat]) manual.add(stat);
    else statBoosts[stat] = state[slot].statBoosts[stat];
  }
  return {
    ...state,
    [slot]: { ...next, statBoosts },
    manualStages: { ...state.manualStages, [slot]: BOOST_STATS.filter((stat) => manual.has(stat)) },
  };
}

// manual true: automatic changes stop applying to these stats and the entered
// stage is used as is. manual false: automatic changes are added on top of
// the entered stage again.
export function setManualStages(state: CalcState, slot: Slot, stats: readonly BoostStat[], manual: boolean): CalcState {
  const current = new Set(state.manualStages[slot]);
  for (const stat of stats) {
    if (manual) current.add(stat);
    else current.delete(stat);
  }
  return {
    ...state,
    manualStages: { ...state.manualStages, [slot]: BOOST_STATS.filter((stat) => current.has(stat)) },
  };
}

// ---------------------------------------------------------------------------
// Damage contexts
// ---------------------------------------------------------------------------

// The attacker's move into the defender, with switch-in stage changes applied.
export function forwardContext(state: CalcState): DamageContext {
  const { game, move, field, isCritical } = state;
  return {
    game,
    attacker: effectivePokemon(state, 'attacker'),
    defender: effectivePokemon(state, 'defender'),
    move,
    field,
    isCritical,
  };
}

// The defender's move into the attacker. The two Pokemon trade roles, and so
// do their sides of the field: FieldInput's "Attacker side" is the left
// Pokemon's side in both directions, so its Reflect protects the left Pokemon
// from the reverse hit and its Helping Hand only boosts the forward hit.
// Weather, terrain, rooms and the Ruin flags are shared and stay as they are.
export function reverseContext(state: CalcState): DamageContext {
  const { field } = state;
  return {
    game: state.game,
    attacker: effectivePokemon(state, 'defender'),
    defender: effectivePokemon(state, 'attacker'),
    move: state.reverseMove,
    field: { ...field, attackerSide: field.defenderSide, defenderSide: field.attackerSide },
    isCritical: state.reverseIsCritical,
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

// One-line description of the matchup, e.g. "Garchomp Earthquake vs. Incineroar".
// Takes one direction's context, so the reverse hit reads "Incineroar Flare
// Blitz vs. Garchomp".
export function matchupLabel(ctx: DamageContext): string {
  const parts = [ctx.attacker.species || 'Attacker', ctx.move.name || 'move', 'vs.', ctx.defender.species || 'defender'];
  return parts.join(' ');
}

// True when the move hits more than one target, so spread reduction applies.
export function isSpread(ctx: DamageContext): boolean {
  const { target } = ctx.move;
  return ctx.field.isDoubles && (target === 'allAdjacent' || target === 'allAdjacentFoes');
}
