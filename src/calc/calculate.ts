import type { DamageContext, DamageResult, Modifier, Pokemon, StatName, StatTable } from '../types';
import { baseDamage, RANDOM_ROLL_CEILING, RANDOM_ROLL_FLOOR } from './damage';
import { runPipeline, runPostRoll, runPreRoll, sortModifiers } from './modifier-pipeline';
import { defensiveStat, hitsPhysicalDefense, offensiveStat } from './modifiers/alt-stats';
import { CORE_MODIFIERS } from './modifiers/core';
import {
  ATTACK_STAT_FIELD_MODIFIERS,
  DEFENSE_STAT_FIELD_MODIFIERS,
  FIELD_DAMAGE_MODIFIERS,
  PRIMAL_NULLIFY,
  TERRAIN_MODIFIER,
  weatherMultiplier,
} from './modifiers/field';
import { calculateStats } from './stats';
import { getDefensiveTypes, getTypeEffectiveness } from './type-chart';

/**
 * Full damage calculation: stats -> attacking / defending stat -> base damage
 * -> damage chain, for all 16 random rolls.
 *
 * FLOW (mirrors @smogon/calc 0.12.0 mechanics/gen789.js calculateSMSSSV and
 * mechanics/champions.js calculateChampions, which agree on every step here)
 * ----
 *   1. Status moves, zero base power, type immunity and primal-weather
 *      nullification deal 0 on every roll (they return early there).
 *   2. Base power runs through the terrain base-power modifier.
 *   3. Raw stats from calculateStats. Wonder Room swaps raw Def and SpD
 *      (util.js checkRawStatChanges); stat stages still follow the stat name,
 *      so a Def boost applies to the swapped-in SpD value.
 *   4. modifiers/alt-stats.ts picks the attacking / defending stat (Foul
 *      Play, Body Press, Psyshock, Psystrike and Secret Sword override the
 *      category). Stat stages (util.js getModifiedStat) follow the picked
 *      stat. A critical hit ignores a negative offensive stage and a positive
 *      defensive stage.
 *   5. Ruin abilities on the attacking / defending stat.
 *   6. Base damage from damage.ts, then the damage chain in MODIFIER_ORDER:
 *      spread, weather, crit | random roll | STAB, type, burn, screens.
 *   7. Every roll is clamped to at least 1 (util.js getFinalDamage).
 *
 * WHY THE ROLL IS APPLIED HERE
 * ----------------------------
 * calculateBaseDamage applies the random roll to the unmodified base damage,
 * but the roll sits between crit and STAB in the chain (RANDOM_ROLL_ORDER).
 * Rolling first and then applying spread / weather / crit rounds differently
 * and gives wrong rolls, so the unrolled baseDamage is used instead and the
 * roll is applied after runPreRoll.
 *
 * NOT HANDLED: abilities and items that change stats, power or damage
 * (Unaware, Hustle, Choice items, Life Orb, ...), Sand's SpD boost for Rock
 * types and Snow's Def boost for Ice types, other stat-swapping moves (Shell
 * Side Arm, Photon Geyser, Tera Blast), variable-power moves (basePower is used as given), and
 * multi-hit moves (rolls are for a single hit).
 */

export { RANDOM_ROLL_FLOOR };

/** The damage-chain modifiers, sorted into their documented order. */
export const DAMAGE_CHAIN: readonly Modifier[] = sortModifiers([
  ...CORE_MODIFIERS,
  ...FIELD_DAMAGE_MODIFIERS,
]);

/** util.js getModifiedStat (Gen 3+): floor(stat * max(2, 2 + s) / max(2, 2 - s)). */
function applyStage(stat: number, stage: number): number {
  const clamped = Math.max(-6, Math.min(6, stage));
  return Math.floor((stat * Math.max(2, 2 + clamped)) / Math.max(2, 2 - clamped));
}

function rawStats(pokemon: Pokemon, isWonderRoom: boolean): StatTable {
  const stats = calculateStats(pokemon.baseStats, pokemon.ivs, pokemon.evs, pokemon.nature, pokemon.level);
  return isWonderRoom ? { ...stats, def: stats.spd, spd: stats.def } : stats;
}

/**
 * Foul Play reads the defender's Atk and Atk stages; Body Press reads the
 * attacker's Def and Def stages (modifiers/alt-stats.ts). The Ruin chain
 * still keys off the move's category, as Showdown and @smogon/calc do.
 */
function attackingStat(ctx: DamageContext): number {
  const { source, stat } = offensiveStat(ctx.move);
  const pokemon = source === 'defender' ? ctx.defender : ctx.attacker;
  const raw = rawStats(pokemon, ctx.field.isWonderRoom)[stat];
  const stage = pokemon.statBoosts[stat];
  const boosted = ctx.isCritical && stage < 0 ? raw : applyStage(raw, stage);
  return Math.max(1, runPipeline(boosted, ctx, ATTACK_STAT_FIELD_MODIFIERS));
}

/**
 * Psyshock, Psystrike and Secret Sword hit Def. The defense-stat Ruin chain
 * in field.ts picks Sword vs Beads of Ruin from the move's category, so it is
 * handed a view of the move as Physical whenever Def is the stat hit,
 * matching gen789.js calculateDfModsSMSSSV's `hitsPhysical`. Everything
 * else (screens included) still sees the real category.
 */
function defendingStat(ctx: DamageContext): number {
  const stat = defensiveStat(ctx.move);
  const raw = rawStats(ctx.defender, ctx.field.isWonderRoom)[stat];
  const stage = ctx.defender.statBoosts[stat];
  const boosted = ctx.isCritical && stage > 0 ? raw : applyStage(raw, stage);
  const chainCtx: DamageContext =
    hitsPhysicalDefense(ctx.move) && ctx.move.category !== 'Physical'
      ? { ...ctx, move: { ...ctx.move, category: 'Physical' } }
      : ctx;
  return Math.max(1, runPipeline(boosted, chainCtx, DEFENSE_STAT_FIELD_MODIFIERS));
}

function dealsNoDamage(ctx: DamageContext): boolean {
  return (
    ctx.move.category === 'Status' ||
    ctx.move.basePower <= 0 ||
    getTypeEffectiveness(ctx.move.type, getDefensiveTypes(ctx.defender)) === 0 ||
    weatherMultiplier(ctx) === PRIMAL_NULLIFY
  );
}

function computeRolls(ctx: DamageContext): number[] {
  const basePower = runPipeline(ctx.move.basePower, ctx, [TERRAIN_MODIFIER]);
  const base = baseDamage(ctx.attacker.level, attackingStat(ctx), defendingStat(ctx), basePower);
  const preRoll = runPreRoll(base, ctx, DAMAGE_CHAIN);

  const rolls: number[] = [];
  for (let r = RANDOM_ROLL_FLOOR; r <= RANDOM_ROLL_CEILING; r++) {
    const rolled = Math.floor((preRoll * r) / 100);
    rolls.push(Math.max(1, runPostRoll(rolled, ctx, DAMAGE_CHAIN)));
  }
  return rolls;
}

export function calculate(ctx: DamageContext): DamageResult {
  const defenderMaxHp = rawStats(ctx.defender, false).hp;
  const rolls = dealsNoDamage(ctx)
    ? new Array<number>(RANDOM_ROLL_CEILING - RANDOM_ROLL_FLOOR + 1).fill(0)
    : computeRolls(ctx);

  const percent = (damage: number): number => (damage / defenderMaxHp) * 100;
  return {
    rolls,
    defenderMaxHp,
    minPercent: percent(Math.min(...rolls)),
    maxPercent: percent(Math.max(...rolls)),
  };
}
