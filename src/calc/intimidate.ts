// Intimidate: a switch-in ability that changes the opposing Pokemon's stat
// stages. It is not a damage modifier, so calculate() never applies it; the
// caller resolves it here and passes the resulting stages in statBoosts.
//
// Rules are the Gen 8+ ones as Pokemon Showdown implements them (see
// intimidate.test.ts). Gen 8 added Inner Focus, Own Tempo, Oblivious and
// Scrappy as blockers. Champions is assumed to follow the same rules: the
// project notes do not list ability behavior as shared, but @smogon/calc's
// Champions mode runs the same Intimidate check as its Gen 9 mode.

import type { Pokemon } from '../types';

export type StageStat = keyof Pokemon['statBoosts'];
export type StageChanges = Partial<Record<StageStat, number>>;

export const MIN_STAGE = -6;
export const MAX_STAGE = 6;

/** Abilities that stop Intimidate's Attack drop outright. */
export const INTIMIDATE_BLOCKING_ABILITIES: readonly string[] = [
  'Clear Body',
  'White Smoke',
  'Full Metal Body',
  'Hyper Cutter',
  'Inner Focus',
  'Own Tempo',
  'Oblivious',
  'Scrappy',
];

/** Held item that stops every stat drop from another Pokemon. */
export const CLEAR_AMULET = 'Clear Amulet';

export interface IntimidateResult {
  /** Stage changes on the Pokemon facing the Intimidate user. */
  target: StageChanges;
  /** Stage changes on the Intimidate user itself (only Mirror Armor). */
  source: StageChanges;
  /**
   * The target's ability or item that blocked or changed the plain -1 Attack,
   * or null when the drop landed as normal.
   */
  cause: string | null;
}

function activeAbility(pokemon: Pokemon): string | null {
  return pokemon.abilitySuppressed ? null : pokemon.ability;
}

function clampStage(n: number): number {
  return Math.min(MAX_STAGE, Math.max(MIN_STAGE, n));
}

/**
 * Effect of `source`'s Intimidate on `target`, given both Pokemon's current
 * stages. Returns null when `source` has no active Intimidate. Changes are
 * the stage deltas that actually land after clamping to -6..+6, so a stat
 * already at its limit shows no change.
 *
 * A suppressed ability counts as no ability, on either side.
 */
export function resolveIntimidate(source: Pokemon, target: Pokemon): IntimidateResult | null {
  if (activeAbility(source) !== 'Intimidate') return null;

  const ability = activeAbility(target);
  const boosts = target.statBoosts;
  const delta = (stat: StageStat, by: number): number => clampStage(boosts[stat] + by) - boosts[stat];
  const only = (stat: StageStat, by: number): StageChanges => {
    const d = delta(stat, by);
    return d === 0 ? {} : { [stat]: d };
  };

  // Order follows Pokemon Showdown's event order. Contrary flips the drop
  // into a raise before anything checks it, and Guard Dog runs ahead of
  // Clear Amulet, so Clear Amulet does not stop either one's +1.
  if (ability === 'Contrary' || ability === 'Guard Dog') {
    return { target: only('atk', 1), source: {}, cause: ability };
  }
  if (target.item === CLEAR_AMULET) return { target: {}, source: {}, cause: CLEAR_AMULET };
  if (ability !== null && INTIMIDATE_BLOCKING_ABILITIES.includes(ability)) {
    return { target: {}, source: {}, cause: ability };
  }

  if (ability === 'Mirror Armor') {
    // The drop bounces back onto the Intimidate user, unless Mirror Armor's
    // own Attack is already at -6 (then the drop simply fails). The user's
    // ability is Intimidate, so only its Clear Amulet stops the bounce.
    if (boosts.atk === MIN_STAGE || source.item === CLEAR_AMULET) {
      return { target: {}, source: {}, cause: ability };
    }
    const d = clampStage(source.statBoosts.atk - 1) - source.statBoosts.atk;
    return { target: {}, source: d === 0 ? {} : { atk: d }, cause: ability };
  }
  if (ability === 'Simple') return { target: only('atk', -2), source: {}, cause: ability };

  const drop = delta('atk', -1);
  // At -6 the drop fails, and Defiant and Competitive only trigger on a stat
  // that was actually lowered.
  if (drop === 0) return { target: {}, source: {}, cause: null };

  if (ability === 'Defiant') {
    // -1, then Defiant's +2 Attack: a net +1.
    return { target: only('atk', 1), source: {}, cause: ability };
  }
  if (ability === 'Competitive') {
    const changes: StageChanges = { atk: drop };
    const spa = delta('spa', 2);
    if (spa !== 0) changes.spa = spa;
    return { target: changes, source: {}, cause: ability };
  }
  return { target: { atk: drop }, source: {}, cause: null };
}

/** Adds stage changes to a stat-stage table, clamping each stat to -6..+6. */
export function applyStageChanges(
  boosts: Pokemon['statBoosts'],
  changes: StageChanges,
): Pokemon['statBoosts'] {
  const out = { ...boosts };
  for (const [stat, by] of Object.entries(changes) as [StageStat, number][]) {
    out[stat] = clampStage(out[stat] + by);
  }
  return out;
}
