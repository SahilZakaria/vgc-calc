import type { DamageContext, Modifier } from '../types';

/**
 * Modifier pipeline for the Gen 9 final-damage chain (shared with Champions).
 *
 * ORDER
 * -----
 * Damage computed by the base formula passes through these stages, in this
 * order. Stages marked * are handled in this file only as a position marker;
 * the others are Modifier stubs.
 *
 *   100  spread reduction   0.75x (3072/4096)            pokeRound
 *   200  weather            1.5x / 0.5x (6144, 2048)     pokeRound
 *   300  critical hit       1.5x                         floor
 *   400* random roll        (85..100)/100                floor
 *   500  STAB               1.5x / 2x (6144, 8192)       pokeRound
 *   600  type effectiveness 0, 0.25 .. 4                 floor
 *   700  burn               0.5x                         floor
 *   800  screens            final-mod chain (2048/2732)  pokeRound
 *
 * Terrain is NOT in this chain. In Gen 8+ terrain boosts base power by
 * 5325/4096 (and Misty / Grassy halve specific moves' base power); it is
 * applied before the base damage formula runs. It is exported separately as
 * a base-power-stage modifier (TERRAIN_BP_MODIFIER) so it cannot be run in
 * the damage chain by accident.
 *
 * SOURCE
 * ------
 * smogon/damage-calc, commit 130f0f2365dbb8d67d64598d279e16b1465bac83:
 *   - calc/src/mechanics/gen789.ts, calculateBaseDamageSMSSSV:
 *       spread -> Parental Bond -> weather -> critical hit
 *   - calc/src/mechanics/util.ts, getFinalDamage:
 *       random roll -> STAB -> type effectiveness -> burn -> final mods
 *   - calc/src/mechanics/gen789.ts, calculateFinalModsSMSSSV:
 *       Reflect / Light Screen / Aurora Veil are final mods
 *   - calc/src/mechanics/gen789.ts, calculateBPModsSMSSSV:
 *       terrain is a base-power mod (5325 in Gen 8+)
 *   - calc/src/mechanics/util.ts, pokeRound
 * This matches the Bulbapedia "Damage" article's Gen V+ formula, where
 * Targets, Weather, Critical, random, STAB, Type, Burn and "other" (screens)
 * appear in that order.
 *
 * ROUNDING
 * --------
 * The runner does no rounding of its own. Each stage rounds differently
 * (see the table above), so every Modifier owns its rounding inside apply().
 * applyChainMultiplier() is the helper for the pokeRound stages.
 */

/** Order slot of the random roll. Not a Modifier; see runPreRoll/runPostRoll. */
export const RANDOM_ROLL_ORDER = 400;

export const MODIFIER_ORDER = {
  spread: 100,
  weather: 200,
  critical: 300,
  stab: 500,
  typeEffectiveness: 600,
  burn: 700,
  screens: 800,
} as const;

/**
 * Game Freak's rounding for 4096-based multipliers: round to nearest, with
 * an exact .5 rounding DOWN. Mirrors smogon/damage-calc util.ts pokeRound.
 */
export function pokeRound(num: number): number {
  return num % 1 > 0.5 ? Math.ceil(num) : Math.floor(num);
}

/** Apply a 4096-based multiplier (e.g. 6144 = 1.5x) and pokeRound the result. */
export function applyChainMultiplier(damage: number, multiplier4096: number): number {
  return pokeRound((damage * multiplier4096) / 4096);
}

function inertStub(name: string, order: number): Modifier {
  return {
    name,
    order,
    applies: () => false,
    apply: (damage) => damage,
  };
}

// Inert stubs. Real implementations replace these; they only fix the order.
export const SPREAD_MODIFIER = inertStub('spread', MODIFIER_ORDER.spread);
export const WEATHER_MODIFIER = inertStub('weather', MODIFIER_ORDER.weather);
export const CRITICAL_MODIFIER = inertStub('critical', MODIFIER_ORDER.critical);
export const STAB_MODIFIER = inertStub('stab', MODIFIER_ORDER.stab);
export const TYPE_EFFECTIVENESS_MODIFIER = inertStub(
  'typeEffectiveness',
  MODIFIER_ORDER.typeEffectiveness,
);
export const BURN_MODIFIER = inertStub('burn', MODIFIER_ORDER.burn);
export const SCREENS_MODIFIER = inertStub('screens', MODIFIER_ORDER.screens);

/** Base-power stage, not part of DAMAGE_MODIFIERS. Order 0 = its own chain. */
export const TERRAIN_BP_MODIFIER = inertStub('terrain', 0);

export const DAMAGE_MODIFIERS: readonly Modifier[] = [
  SPREAD_MODIFIER,
  WEATHER_MODIFIER,
  CRITICAL_MODIFIER,
  STAB_MODIFIER,
  TYPE_EFFECTIVENESS_MODIFIER,
  BURN_MODIFIER,
  SCREENS_MODIFIER,
];

/** Returns the modifiers sorted by `order`. Throws on duplicate or roll-slot orders. */
export function sortModifiers(modifiers: readonly Modifier[]): Modifier[] {
  const seen = new Map<number, string>();
  for (const m of modifiers) {
    if (m.order === RANDOM_ROLL_ORDER) {
      throw new Error(`Modifier "${m.name}" uses the reserved random-roll order ${RANDOM_ROLL_ORDER}`);
    }
    const other = seen.get(m.order);
    if (other !== undefined) {
      throw new Error(`Modifiers "${other}" and "${m.name}" share order ${m.order}`);
    }
    seen.set(m.order, m.name);
  }
  return [...modifiers].sort((a, b) => a.order - b.order);
}

/**
 * Runs damage through every applicable modifier in ascending `order`.
 * Each modifier receives the previous modifier's output unchanged.
 */
export function runPipeline(
  damage: number,
  ctx: DamageContext,
  modifiers: readonly Modifier[] = DAMAGE_MODIFIERS,
): number {
  let result = damage;
  for (const m of sortModifiers(modifiers)) {
    if (m.applies(ctx)) result = m.apply(result, ctx);
  }
  return result;
}

/** Stages before the random roll (spread, weather, crit). */
export function runPreRoll(
  damage: number,
  ctx: DamageContext,
  modifiers: readonly Modifier[] = DAMAGE_MODIFIERS,
): number {
  return runPipeline(damage, ctx, modifiers.filter((m) => m.order < RANDOM_ROLL_ORDER));
}

/** Stages after the random roll (STAB, type, burn, screens). */
export function runPostRoll(
  damage: number,
  ctx: DamageContext,
  modifiers: readonly Modifier[] = DAMAGE_MODIFIERS,
): number {
  return runPipeline(damage, ctx, modifiers.filter((m) => m.order > RANDOM_ROLL_ORDER));
}
