// State behind App: the starting matchup, what happens on a game switch, and
// running the calc. Kept out of App.tsx so it can be tested without a DOM.
//
// Relative imports (not '@vgc/*') so the root vitest run, which has no alias,
// can load this file.

import { calculate } from '../../src/calc/calculate';
import { spToEv } from '../../src/champions/stats';
import type { DamageContext, DamageResult, FieldState, Game, Move, Pokemon, SideState, StatTable } from '../../src/types';
import { findMove } from './components/moveData';
import { applySpecies, normalizeForGame } from './components/pokemonInputModel';

// Everything the calculator screen edits. The DamageContext fields are the
// forward hit (attacker's move into defender). The reverse hit (defender's
// move into attacker) shares the Pokemon and field and adds its own move and
// crit flag. Declared here rather than in src/types.ts, which is off limits.
export interface CalcState extends DamageContext {
  reverseMove: Move;
  reverseIsCritical: boolean;
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

// The attacker's move into the defender.
export function forwardContext(state: CalcState): DamageContext {
  const { game, attacker, defender, move, field, isCritical } = state;
  return { game, attacker, defender, move, field, isCritical };
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
    attacker: state.defender,
    defender: state.attacker,
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
