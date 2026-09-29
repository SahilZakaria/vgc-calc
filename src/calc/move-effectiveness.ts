import type { DamageContext, TypeName } from '../types';
import { effectiveWeather } from './modifiers/field';
import { getDefensiveTypes, getTypeEffectiveness } from './type-chart';

/**
 * Type effectiveness of an actual hit: the pure 18x18 chart from
 * type-chart.ts plus the move effects and field effects that override it.
 * type-chart.ts stays a plain type-vs-type table; anything that depends on
 * which move is used or on the field lives here.
 *
 * SOURCE
 * ------
 * smogon/damage-calc 0.12.0 (the @smogon/calc dev dependency):
 *   - mechanics/util.js getMoveEffectiveness, called per defending type by
 *     both mechanics/gen789.js and mechanics/champions.js:
 *       Freeze-Dry   2x against Water, replacing Ice's 0.5x
 *       Flying Press chart[Fighting][type] * chart[Flying][type]
 *   - mechanics/gen789.js calculateSMSSSV only (champions.js has no
 *     equivalent):
 *       Strong Winds halves the total when the defender is Flying and the
 *       move's type is super effective against Flying, after the immunity
 *       check. Air Lock / Cloud Nine clear it (util.js checkAirLock).
 *
 * Freeze-Dry and Flying Press are move effects, not game data: @smogon/calc
 * applies them identically in both games through the shared util.js, so they
 * are keyed by move name here the same way calculate.ts keys Body Press or
 * Foul Play. Strong Winds is gated to Gen 9 because only Delta Stream sets it
 * and Champions has no Delta Stream user; @smogon/calc's Champions mechanics
 * ignore the weather entirely.
 */

/** Freeze-Dry's fixed multiplier against Water, per util.js getMoveEffectiveness. */
const FREEZE_DRY_VS_WATER = 2;

/** Effectiveness against one defending type, with per-move overrides. */
function againstType(moveName: string, moveType: TypeName, defenderType: TypeName): number {
  if (moveName === 'Freeze-Dry' && defenderType === 'Water') return FREEZE_DRY_VS_WATER;
  const base = getTypeEffectiveness(moveType, [defenderType]);
  if (moveName === 'Flying Press') return base * getTypeEffectiveness('Flying', [defenderType]);
  return base;
}

/**
 * Strong Winds weakens super-effective hits on Flying types. The check reads
 * only the move's own type against Flying (not Flying Press's second type),
 * matching gen789.js.
 */
function strongWindsApplies(ctx: DamageContext, defenderTypes: TypeName[]): boolean {
  return (
    ctx.game === 'gen9' &&
    effectiveWeather(ctx) === 'strongWinds' &&
    defenderTypes.includes('Flying') &&
    getTypeEffectiveness(ctx.move.type, ['Flying']) > 1
  );
}

/**
 * Combined effectiveness multiplier for `ctx.move` hitting `ctx.defender`
 * (e.g. 4 for a double weakness, 0 for an immunity).
 */
export function getMoveEffectiveness(ctx: DamageContext): number {
  const defenderTypes = getDefensiveTypes(ctx.defender);
  const total = defenderTypes.reduce(
    (multiplier, type) => multiplier * againstType(ctx.move.name, ctx.move.type, type),
    1,
  );
  return strongWindsApplies(ctx, defenderTypes) ? total / 2 : total;
}
