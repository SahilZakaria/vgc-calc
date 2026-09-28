import type { DamageContext, DamageResult, Modifier, Pokemon, StatName, StatTable } from '../types';
import { baseDamage, RANDOM_ROLL_CEILING, RANDOM_ROLL_FLOOR } from './damage';
import { runPipeline, runPostRoll, runPreRoll, sortModifiers } from './modifier-pipeline';
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
 *   4. Stat stages (util.js getModifiedStat). A critical hit ignores the
 *      attacker's negative stage and the defender's positive stage.
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
 * types and Snow's Def boost for Ice types, Foul Play / Body Press / Psyshock
 * stat overrides, variable-power moves (basePower is used as given), and
 * multi-hit moves (rolls are for a single hit).
 */

export { RANDOM_ROLL_FLOOR };

/** The damage-chain modifiers, sorted into their documented order. */
export const DAMAGE_CHAIN: readonly Modifier[] = sortModifiers([
  ...CORE_MODIFIERS,
  ...FIELD_DAMAGE_MODIFIERS,
]);

type BoostableStat = Exclude<StatName, 'hp'>;

/** util.js getModifiedStat (Gen 3+): floor(stat * max(2, 2 + s) / max(2, 2 - s)). */
function applyStage(stat: number, stage: number): number {
  const clamped = Math.max(-6, Math.min(6, stage));
  return Math.floor((stat * Math.max(2, 2 + clamped)) / Math.max(2, 2 - clamped));
}

function rawStats(pokemon: Pokemon, isWonderRoom: boolean): StatTable {
  const stats = calculateStats(pokemon.baseStats, pokemon.ivs, pokemon.evs, pokemon.nature, pokemon.level);
  return isWonderRoom ? { ...stats, def: stats.spd, spd: stats.def } : stats;
}

function attackingStat(ctx: DamageContext): number {
  const stat: BoostableStat = ctx.move.category === 'Special' ? 'spa' : 'atk';
  const raw = rawStats(ctx.attacker, ctx.field.isWonderRoom)[stat];
  const stage = ctx.attacker.statBoosts[stat];
  const boosted = ctx.isCritical && stage < 0 ? raw : applyStage(raw, stage);
  return Math.max(1, runPipeline(boosted, ctx, ATTACK_STAT_FIELD_MODIFIERS));
}

function defendingStat(ctx: DamageContext): number {
  const stat: BoostableStat = ctx.move.category === 'Special' ? 'spd' : 'def';
  const raw = rawStats(ctx.defender, ctx.field.isWonderRoom)[stat];
  const stage = ctx.defender.statBoosts[stat];
  const boosted = ctx.isCritical && stage > 0 ? raw : applyStage(raw, stage);
  return Math.max(1, runPipeline(boosted, ctx, DEFENSE_STAT_FIELD_MODIFIERS));
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
