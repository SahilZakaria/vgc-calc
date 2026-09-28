import type { Move, StatName } from '../../types';

/**
 * Moves that calculate damage from a stat other than the one their category
 * implies.
 *
 *   Foul Play                       target's Atk (and the target's Atk stages)
 *   Body Press                      user's Def (and the user's Def stages)
 *   Psyshock, Psystrike, Secret Sword   special, but hit the target's Def
 *
 * SOURCE
 * ------
 * Pokemon Showdown sim/battle-actions.ts getDamage:
 *   attacker   = move.overrideOffensivePokemon === 'target' ? target : source
 *   attackStat = move.overrideOffensiveStat || (isPhysical ? 'atk' : 'spa')
 *   defenseStat = move.overrideDefensiveStat || (isPhysical ? 'def' : 'spd')
 *   atkBoosts  = attacker.boosts[attackStat]; defBoosts = defender.boosts[defenseStat]
 * with overrides from data/moves.ts (Foul Play: overrideOffensivePokemon
 * 'target'; Body Press: overrideOffensiveStat 'def'; Psyshock, Psystrike,
 * Secret Sword: overrideDefensiveStat 'def'). @smogon/calc 0.12.0 carries the
 * same overrides (dist/data/moves.js) and picks the stat by move name in
 * calculateAttackSMSSSV / calculateAttackChampions and by
 * overrideDefensiveStat in calculateDefenseSMSSSV / calculateDefenseChampions.
 *
 * Stat stages follow the stat that was picked, and a critical hit still drops
 * a negative offensive stage / positive defensive stage of that stat, even
 * when it belongs to the target (Foul Play).
 *
 * Only the stat changes. Abilities and field effects that key off the move's
 * category keep doing so: Showdown resets attackStat to the category's stat
 * before the ModifyAtk / ModifySpA event, so Tablets of Ruin still weakens
 * Body Press and Foul Play, and Vessel of Ruin never does. On the defending
 * side the event follows defenseStat, so Sword of Ruin (not Beads) weakens
 * the Def that Psyshock hits.
 *
 * Under Wonder Room, Body Press follows Showdown (calculateStat('def') returns
 * the stored SpD): raw SpD with Def stages. @smogon/calc 0.12.0 disagrees and
 * uses raw Def with SpD stages; see alt-stats.test.ts.
 *
 * Body Press does not flip the move's category, and neither does Psyshock:
 * Reflect / Light Screen still follow the category (Light Screen reduces
 * Psyshock), matching Showdown and @smogon/calc.
 */

export type BoostableStat = Exclude<StatName, 'hp'>;

/** Whose stats the attacking stat is read from. */
export type OffensiveSource = 'attacker' | 'defender';

export interface OffensiveStat {
  source: OffensiveSource;
  stat: BoostableStat;
}

/** Showdown data/moves.ts overrideOffensivePokemon: 'target'. */
const USES_TARGET_ATTACK: ReadonlySet<string> = new Set(['Foul Play']);

/** Showdown data/moves.ts overrideOffensiveStat: 'def'. */
const USES_USER_DEFENSE: ReadonlySet<string> = new Set(['Body Press']);

/** Showdown data/moves.ts overrideDefensiveStat: 'def'. */
const HITS_TARGET_DEFENSE: ReadonlySet<string> = new Set(['Psyshock', 'Psystrike', 'Secret Sword']);

/** The Pokemon and stat the attacking stat (and its stages) come from. */
export function offensiveStat(move: Move): OffensiveStat {
  const stat: BoostableStat = USES_USER_DEFENSE.has(move.name)
    ? 'def'
    : move.category === 'Special'
      ? 'spa'
      : 'atk';
  return { source: USES_TARGET_ATTACK.has(move.name) ? 'defender' : 'attacker', stat };
}

/** True when the move is resolved against the target's Def. */
export function hitsPhysicalDefense(move: Move): boolean {
  return HITS_TARGET_DEFENSE.has(move.name) || move.category === 'Physical';
}

/** The defender's stat (and its stages) the move is resolved against. */
export function defensiveStat(move: Move): BoostableStat {
  return hitsPhysicalDefense(move) ? 'def' : 'spd';
}
