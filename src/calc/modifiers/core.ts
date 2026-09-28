import type { DamageContext, Modifier, Pokemon } from '../../types';
import { applyChainMultiplier, MODIFIER_ORDER } from '../modifier-pipeline';
import { getDefensiveTypes, getTypeEffectiveness } from '../type-chart';

/**
 * Core damage-chain modifiers: spread, critical hit, STAB, type
 * effectiveness and burn. Each one owns its rounding, as the pipeline
 * requires (see the ORDER table in modifier-pipeline.ts).
 *
 * SOURCE
 * ------
 * smogon/damage-calc 0.12.0 (the @smogon/calc dev dependency):
 *   - mechanics/gen789.ts calculateBaseDamageSMSSSV:
 *       spread   pokeRound(damage * 3072 / 4096), doubles + allAdjacent(Foes)
 *       crit     floor(damage * 1.5)
 *   - mechanics/util.ts getStabMod: 6144 / 8192, Tera and Adaptability rules
 *   - mechanics/util.ts getFinalDamage:
 *       STAB     pokeRound(damage * stabMod / 4096)
 *       type     floor(damage * effectiveness)
 *       burn     floor(damage / 2)
 *   - mechanics/gen789.ts calculateDamageSMSSSV: burn skipped for Guts
 *       and for Facade
 * Bulbapedia "Damage" (Gen V+ formula) gives the same multipliers.
 *
 * Not handled here: Protean / Libero STAB, Stellar Tera, Sniper, and spread
 * reduction only when more than one target is actually hit. The spread
 * condition follows @smogon/calc, which assumes every target is present.
 */

const STAB_4096 = 6144; // 1.5x
const ADAPTABILITY_4096 = 8192; // 2x
const SPREAD_4096 = 3072; // 0.75x
const CRITICAL_MULTIPLIER = 1.5;

function hasActiveAbility(pokemon: Pokemon, ability: string): boolean {
  return !pokemon.abilitySuppressed && pokemon.ability === ability;
}

/**
 * STAB as a 4096-based multiplier: 4096 (none), 6144 (1.5x), 8192 (2x) or
 * 9216 (2.25x, Adaptability Terastallized into one of its original types).
 *
 * Mirrors @smogon/calc getStabMod. Tera only counts when the Pokemon is
 * Terastallized, so this is inert in Champions.
 */
export function getStabMultiplier4096(ctx: DamageContext): number {
  const { attacker, move } = ctx;
  const teraType = attacker.isTerastallized ? attacker.teraType : undefined;
  const hasOriginalType = attacker.types.includes(move.type);
  // Current type: a Terastallized Pokemon is only its Tera type.
  const hasCurrentType = teraType !== undefined ? teraType === move.type : hasOriginalType;

  let stab = 4096;
  if (hasOriginalType) stab += STAB_4096 - 4096;
  if (teraType !== undefined && teraType === move.type) stab += STAB_4096 - 4096;
  if (hasActiveAbility(attacker, 'Adaptability') && hasCurrentType) {
    // Adaptability lifts 1.5x to 2x, but 2x Tera STAB only to 2.25x.
    stab += teraType !== undefined && attacker.types.includes(teraType)
      ? 1024
      : ADAPTABILITY_4096 - STAB_4096;
  }
  return stab;
}

export const spreadModifier: Modifier = {
  name: 'spread',
  order: MODIFIER_ORDER.spread,
  applies: (ctx) =>
    ctx.field.isDoubles &&
    (ctx.move.target === 'allAdjacentFoes' || ctx.move.target === 'allAdjacent'),
  apply: (damage) => applyChainMultiplier(damage, SPREAD_4096),
};

export const criticalModifier: Modifier = {
  name: 'critical',
  order: MODIFIER_ORDER.critical,
  applies: (ctx) => ctx.isCritical,
  apply: (damage) => Math.floor(damage * CRITICAL_MULTIPLIER),
};

export const stabModifier: Modifier = {
  name: 'stab',
  order: MODIFIER_ORDER.stab,
  applies: (ctx) => getStabMultiplier4096(ctx) !== 4096,
  apply: (damage, ctx) => applyChainMultiplier(damage, getStabMultiplier4096(ctx)),
};

export const typeEffectivenessModifier: Modifier = {
  name: 'typeEffectiveness',
  order: MODIFIER_ORDER.typeEffectiveness,
  applies: () => true,
  apply: (damage, ctx) =>
    Math.floor(
      damage * getTypeEffectiveness(ctx.move.type, getDefensiveTypes(ctx.defender)),
    ),
};

export const burnModifier: Modifier = {
  name: 'burn',
  order: MODIFIER_ORDER.burn,
  applies: (ctx) =>
    ctx.attacker.status === 'brn' &&
    ctx.move.category === 'Physical' &&
    !hasActiveAbility(ctx.attacker, 'Guts') &&
    ctx.move.name !== 'Facade',
  apply: (damage) => Math.floor(damage / 2),
};

export const CORE_MODIFIERS: readonly Modifier[] = [
  spreadModifier,
  criticalModifier,
  stabModifier,
  typeEffectivenessModifier,
  burnModifier,
];
