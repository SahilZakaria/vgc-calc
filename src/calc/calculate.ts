import type { DamageContext, DamageResult, Modifier, Pokemon, StatName, StatTable } from '../types';
import { calculateBaseDamage } from './damage';
import { MODIFIER_ORDER, pokeRound, runPostRoll, runPreRoll, sortModifiers } from './modifier-pipeline';
import {
  ATTACK_STAT_ABILITY_MODIFIERS,
  ATTACK_STAT_ITEM_MODIFIERS,
  BASE_POWER_MODIFIERS,
  DEFENSE_STAT_ITEM_MODIFIERS,
  FINAL_MODIFIERS,
  isImmuneByAbility,
  resolveAbilitiesAndItems,
  type ChainModifier,
} from './modifiers/abilities-items';
import { CORE_MODIFIERS } from './modifiers/core';
import {
  ATTACK_STAT_FIELD_MODIFIERS,
  DEFENSE_STAT_FIELD_MODIFIERS,
  PRIMAL_NULLIFY,
  screensMultiplier,
  terrainMultiplier,
  WEATHER_MODIFIER,
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
 *   0. Items disabled by Magic Room / Klutz are removed and defender abilities
 *      ignored by Mold Breaker are suppressed (resolveAbilitiesAndItems).
 *   1. Status moves, zero base power, type immunity, immunity abilities
 *      (Flash Fire, Levitate, ...) and primal-weather nullification deal 0
 *      on every roll (they return early there).
 *   2. Base power runs through the base-power chain.
 *   3. Raw stats from calculateStats. Wonder Room swaps raw Def and SpD
 *      (util.js checkRawStatChanges); stat stages still follow the stat name,
 *      so a Def boost applies to the swapped-in SpD value.
 *   4. Stat stages (util.js getModifiedStat). A critical hit ignores the
 *      attacker's negative stage and the defender's positive stage.
 *   5. The attack-stat and defense-stat chains.
 *   6. Base damage from damage.ts, then the damage chain in MODIFIER_ORDER:
 *      spread, weather, crit | random roll | STAB, type, burn, final mods.
 *   7. Every roll is clamped to at least 1 (util.js getFinalDamage).
 *
 * CHAINS
 * ------
 * @smogon/calc folds all modifiers of one kind into a single 4096-based
 * multiplier (util.js chainMods) and rounds once, so stacking modifiers must
 * not be applied one by one. Each chain lists its modifiers in the order
 * @smogon/calc pushes them:
 *   base power    terrain, Technician, type-boosting item      [41, 2097152]
 *   attack stat   Guts / Huge Power, Thick Fat, Ruin, Choice    [410, 131072]
 *   defense stat  Ruin, Assault Vest                           [410, 131072]
 *   final mods    screens, Tinted Lens, Multiscale,            [41, 131072]
 *                 Solid Rock / Filter, Expert Belt / Life Orb
 *
 * WHY THE ROLL IS APPLIED HERE
 * ----------------------------
 * calculateBaseDamage applies the random roll to the unmodified base damage,
 * but the roll sits between crit and STAB in the chain (RANDOM_ROLL_ORDER).
 * Rolling first and then applying spread / weather / crit rounds differently
 * and gives wrong rolls, so only its 100% roll (which equals the base damage
 * exactly) is used, and the roll is applied after runPreRoll.
 *
 * NOT HANDLED: abilities and items outside modifiers/abilities-items.ts
 * (Unaware, Hustle, Sniper, Helping Hand, Friend Guard, resist berries, ...),
 * Sand's SpD boost for Rock types and Snow's Def boost for Ice types, Foul
 * Play / Body Press / Psyshock stat overrides, variable-power moves
 * (basePower is used as given), and multi-hit moves (rolls are for a single
 * hit).
 */

/**
 * Lowest random roll, in percent. The damage formula uses 85..100. Kept as a
 * named constant because Champions briefly shipped without the 85% floor.
 */
export const RANDOM_ROLL_FLOOR = 85;
const RANDOM_ROLL_CEILING = 100;

const NEUTRAL = 4096;

/** util.js chainMods: fold 4096-based multipliers, rounding each step, then clamp. */
export function chainMultipliers(multipliers: readonly number[], lowerBound: number, upperBound: number): number {
  let chained = NEUTRAL;
  for (const m of multipliers) {
    if (m !== NEUTRAL) chained = (chained * m + 2048) >> 12;
  }
  return Math.max(Math.min(chained, upperBound), lowerBound);
}

function applyChain(value: number, multipliers: readonly number[], lowerBound: number, upperBound: number): number {
  return pokeRound((value * chainMultipliers(multipliers, lowerBound, upperBound)) / NEUTRAL);
}

const multipliersOf = (ctx: DamageContext, mods: readonly ChainModifier[]): number[] =>
  mods.map((m) => m.multiplier(ctx));

/**
 * The Ruin modifiers in field.ts are value transforms that pokeRound
 * value * multiplier / 4096; run on 4096 they return the multiplier itself.
 */
const fieldMultipliersOf = (ctx: DamageContext, mods: readonly Modifier[]): number[] =>
  mods.map((m) => (m.applies(ctx) ? m.apply(NEUTRAL, ctx) : NEUTRAL));

function finalModsMultiplier(ctx: DamageContext): number {
  return chainMultipliers([screensMultiplier(ctx), ...multipliersOf(ctx, FINAL_MODIFIERS)], 41, 131072);
}

/**
 * The final-modifier chain as one damage-chain stage in the screens slot.
 * util.js getFinalDamage: pokeRound(max(1, damage * finalMod / 4096)).
 */
export const FINAL_MODS_MODIFIER: Modifier = {
  name: 'finalMods',
  order: MODIFIER_ORDER.screens,
  applies: (ctx) => finalModsMultiplier(ctx) !== NEUTRAL,
  apply: (damage, ctx) => pokeRound(Math.max(1, (damage * finalModsMultiplier(ctx)) / NEUTRAL)),
};

/** The damage-chain modifiers, sorted into their documented order. */
export const DAMAGE_CHAIN: readonly Modifier[] = sortModifiers([
  ...CORE_MODIFIERS,
  WEATHER_MODIFIER,
  FINAL_MODS_MODIFIER,
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

function basePower(ctx: DamageContext): number {
  const mods = [terrainMultiplier(ctx), ...multipliersOf(ctx, BASE_POWER_MODIFIERS)];
  return Math.max(1, applyChain(ctx.move.basePower, mods, 41, 2097152));
}

function attackingStat(ctx: DamageContext): number {
  const stat: BoostableStat = ctx.move.category === 'Special' ? 'spa' : 'atk';
  const raw = rawStats(ctx.attacker, ctx.field.isWonderRoom)[stat];
  const stage = ctx.attacker.statBoosts[stat];
  const boosted = ctx.isCritical && stage < 0 ? raw : applyStage(raw, stage);
  const mods = [
    ...multipliersOf(ctx, ATTACK_STAT_ABILITY_MODIFIERS),
    ...fieldMultipliersOf(ctx, ATTACK_STAT_FIELD_MODIFIERS),
    ...multipliersOf(ctx, ATTACK_STAT_ITEM_MODIFIERS),
  ];
  return Math.max(1, applyChain(boosted, mods, 410, 131072));
}

function defendingStat(ctx: DamageContext): number {
  const stat: BoostableStat = ctx.move.category === 'Special' ? 'spd' : 'def';
  const raw = rawStats(ctx.defender, ctx.field.isWonderRoom)[stat];
  const stage = ctx.defender.statBoosts[stat];
  const boosted = ctx.isCritical && stage > 0 ? raw : applyStage(raw, stage);
  const mods = [
    ...fieldMultipliersOf(ctx, DEFENSE_STAT_FIELD_MODIFIERS),
    ...multipliersOf(ctx, DEFENSE_STAT_ITEM_MODIFIERS),
  ];
  return Math.max(1, applyChain(boosted, mods, 410, 131072));
}

function dealsNoDamage(ctx: DamageContext): boolean {
  return (
    ctx.move.category === 'Status' ||
    ctx.move.basePower <= 0 ||
    getTypeEffectiveness(ctx.move.type, getDefensiveTypes(ctx.defender)) === 0 ||
    isImmuneByAbility(ctx) ||
    weatherMultiplier(ctx) === PRIMAL_NULLIFY
  );
}

function computeRolls(ctx: DamageContext): number[] {
  const unrolled = calculateBaseDamage(
    ctx.attacker.level,
    attackingStat(ctx),
    defendingStat(ctx),
    basePower(ctx),
  );
  // Index 15 is the 100% roll, i.e. the base damage itself.
  const baseDamage = unrolled[unrolled.length - 1] ?? 0;
  const preRoll = runPreRoll(baseDamage, ctx, DAMAGE_CHAIN);

  const rolls: number[] = [];
  for (let r = RANDOM_ROLL_FLOOR; r <= RANDOM_ROLL_CEILING; r++) {
    const rolled = Math.floor((preRoll * r) / 100);
    rolls.push(Math.max(1, runPostRoll(rolled, ctx, DAMAGE_CHAIN)));
  }
  return rolls;
}

export function calculate(input: DamageContext): DamageResult {
  const ctx = resolveAbilitiesAndItems(input);
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
