import type { DamageContext, DamageResult, Modifier, Pokemon, StatName, StatTable } from '../types';
import { baseDamage, RANDOM_ROLL_CEILING, RANDOM_ROLL_FLOOR } from './damage';
import { MODIFIER_ORDER, pokeRound, runPipeline, runPostRoll, runPreRoll, sortModifiers } from './modifier-pipeline';
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
import { defensiveStat, hitsPhysicalDefense, ignoresDefensiveStages, offensiveStat } from './modifiers/alt-stats';
import { CORE_MODIFIERS } from './modifiers/core';
import {
  ATTACK_STAT_FIELD_MODIFIERS,
  DEFENSE_STAT_FIELD_MODIFIERS,
  PRIMAL_NULLIFY,
  screensMultiplier,
  terrainMultiplier,
  WEATHER_DEFENSE_MODIFIER,
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
 *   4. modifiers/alt-stats.ts picks the attacking / defending stat (Foul
 *      Play, Body Press, Psyshock, Psystrike and Secret Sword override the
 *      category). Stat stages (util.js getModifiedStat) follow the picked
 *      stat. A critical hit ignores a negative offensive stage and a positive
 *      defensive stage; Chip Away, Darkest Lariat, Sacred Sword and Nihil
 *      Light ignore every defensive stage (move.ignoreDefensive).
 *   5. Sand's SpD / Snow's Def boost (its own pokeRound, before the chain),
 *      then the attack-stat and defense-stat chains.
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
 *                 (both see the move as Physical when it hits Def, e.g.
 *                 Psyshock, like gen789.js's `hitsPhysical`)
 *   final mods    screens, Tinted Lens, Multiscale,            [41, 131072]
 *                 Solid Rock / Filter, Expert Belt / Life Orb
 *
 * WHY THE ROLL IS APPLIED HERE
 * ----------------------------
 * calculateBaseDamage applies the random roll to the unmodified base damage,
 * but the roll sits between crit and STAB in the chain (RANDOM_ROLL_ORDER).
 * Rolling first and then applying spread / weather / crit rounds differently
 * and gives wrong rolls, so the unrolled baseDamage is used instead and the
 * roll is applied after runPreRoll.
 *
 * NOT HANDLED: abilities and items outside modifiers/abilities-items.ts
 * (Unaware, Hustle, Sniper, Helping Hand, Friend Guard, resist berries, ...),
 * other stat-swapping moves (Shell Side Arm, Photon Geyser, Tera Blast),
 * variable-power moves (basePower is used as given), and multi-hit moves
 * (rolls are for a single hit).
 */

export { RANDOM_ROLL_FLOOR };

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

/** The Ruin half of the defense-stat field modifiers; see defendingStat. */
const DEFENSE_STAT_CHAIN_FIELD_MODIFIERS = DEFENSE_STAT_FIELD_MODIFIERS.filter(
  (m) => m !== WEATHER_DEFENSE_MODIFIER,
);

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

/**
 * Foul Play reads the defender's Atk and Atk stages; Body Press reads the
 * attacker's Def and Def stages (modifiers/alt-stats.ts). The attack-stat
 * chain (the attacker's abilities and items, Ruin) still keys off the move's
 * category, as Showdown and @smogon/calc do.
 */
function attackingStat(ctx: DamageContext): number {
  const { source, stat } = offensiveStat(ctx.move);
  const pokemon = source === 'defender' ? ctx.defender : ctx.attacker;
  const raw = rawStats(pokemon, ctx.field.isWonderRoom)[stat];
  const stage = pokemon.statBoosts[stat];
  const boosted = ctx.isCritical && stage < 0 ? raw : applyStage(raw, stage);
  const mods = [
    ...multipliersOf(ctx, ATTACK_STAT_ABILITY_MODIFIERS),
    ...fieldMultipliersOf(ctx, ATTACK_STAT_FIELD_MODIFIERS),
    ...multipliersOf(ctx, ATTACK_STAT_ITEM_MODIFIERS),
  ];
  return Math.max(1, applyChain(boosted, mods, 410, 131072));
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
  const ignoreStage = ignoresDefensiveStages(ctx.move) || (ctx.isCritical && stage > 0);
  const boosted = ignoreStage ? raw : applyStage(raw, stage);
  const chainCtx: DamageContext =
    hitsPhysicalDefense(ctx.move) && ctx.move.category !== 'Physical'
      ? { ...ctx, move: { ...ctx.move, category: 'Physical' } }
      : ctx;
  // gen789.js calculateDefenseSMSSSV rounds the Sand / Snow boost on its own
  // before building the dfMods chain, so it stays out of the chain.
  const weathered = runPipeline(boosted, chainCtx, [WEATHER_DEFENSE_MODIFIER]);
  const mods = [
    ...fieldMultipliersOf(chainCtx, DEFENSE_STAT_CHAIN_FIELD_MODIFIERS),
    ...multipliersOf(chainCtx, DEFENSE_STAT_ITEM_MODIFIERS),
  ];
  return Math.max(1, applyChain(weathered, mods, 410, 131072));
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
  const base = baseDamage(ctx.attacker.level, attackingStat(ctx), defendingStat(ctx), basePower(ctx));
  const preRoll = runPreRoll(base, ctx, DAMAGE_CHAIN);

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
