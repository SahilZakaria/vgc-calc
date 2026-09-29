import type { DamageContext, FieldState, Modifier, Pokemon, Weather } from '../../types';
import { applyChainMultiplier, MODIFIER_ORDER, TERRAIN_BP_MODIFIER } from '../modifier-pipeline';
import { getDefensiveTypes } from '../type-chart';

/**
 * Field-driven modifiers: weather, terrain, screens and the Ruin abilities.
 *
 * CHAINS
 * ------
 * Only weather and screens are damage-chain modifiers. Terrain modifies base
 * power and the Ruin abilities modify the attacking / defending stat, so their
 * apply() receives that value (base power or stat) as its first argument, not
 * damage. They are exported in separate lists so they cannot be run through
 * the damage chain by accident:
 *
 *   weather   damage chain, MODIFIER_ORDER.weather (200)   WEATHER_MODIFIER
 *   screens   damage chain, MODIFIER_ORDER.screens (800)   SCREENS_MODIFIER
 *   terrain   base-power chain                            TERRAIN_MODIFIER
 *   Sand SpD / Snow Def boost  defense-stat chain         WEATHER_DEFENSE_MODIFIER
 *   Tablets / Vessel of Ruin   attack-stat chain          ATTACK_STAT_FIELD_MODIFIERS
 *   Sword / Beads of Ruin      defense-stat chain         DEFENSE_STAT_FIELD_MODIFIERS
 *
 * Every multiplier is applied with applyChainMultiplier (4096-based, pokeRound).
 * @smogon/calc chains all base-power / stat / final modifiers into one 4096
 * multiplier before rounding (util.js chainMods), so applying one of these on
 * its own matches it exactly only when it is the only modifier in its chain.
 *
 * SOURCE
 * ------
 * All numbers below are from @smogon/calc 0.12.0 (smogon/damage-calc), file
 * dist/mechanics/gen789.js unless noted. The Champions mechanics file
 * (dist/mechanics/champions.js) uses the same values for weather, terrain and
 * screens. The Ruin abilities, primal weathers, Utility Umbrella and Hydro
 * Steam do not appear there because Champions' roster and item tables lack
 * them; the code paths below are inert in Champions as a result.
 */

// ---------------------------------------------------------------------------
// Numeric constants (all /4096)
// ---------------------------------------------------------------------------

/** 1.5x. gen789.js calculateBaseDamageSMSSSV: `baseDamage * 6144` for boosted weather. */
export const WEATHER_BOOST = 6144;
/** 0.5x. gen789.js calculateBaseDamageSMSSSV: `baseDamage * 2048` for weakened weather. */
export const WEATHER_WEAKEN = 2048;
/**
 * 0x. gen789.js calculateSMSSSV: Harsh Sunshine + Water or Heavy Rain + Fire
 * returns the result with damage 0 (the move fails).
 */
export const PRIMAL_NULLIFY = 0;

/** ~1.3x. gen789.js calculateBPModsSMSSSV: `terrainMultiplier = gen.num > 7 ? 5325 : 6144`. */
export const TERRAIN_BOOST = 5325;
/** 0.5x. gen789.js calculateBPModsSMSSSV: Misty + Dragon / Grassy + Earthquake, Bulldoze push 2048. */
export const TERRAIN_WEAKEN = 2048;

/** gen789.js calculateFinalModsSMSSSV: `field.gameType !== 'Singles' ? 2732 : 2048`. */
export const SCREEN_DOUBLES = 2732;
/** gen789.js calculateFinalModsSMSSSV: `field.gameType !== 'Singles' ? 2732 : 2048`. */
export const SCREEN_SINGLES = 2048;

/**
 * 0.75x. gen789.js calculateAtModsSMSSSV (Tablets / Vessel of Ruin) and
 * calculateDfModsSMSSSV (Sword / Beads of Ruin) each push 3072.
 */
export const RUIN_MULTIPLIER = 3072;

const NEUTRAL = 4096;

/**
 * Which game's rules apply. Declared here because the committed src/types.ts
 * has no Game type; it matches the `game` field the tests put on
 * DamageContext.
 */
export type Game = 'champions' | 'gen9';

/**
 * A DamageContext that may say which game it belongs to. Only the Mega Sol
 * exception to the Sand / Snow defense boost depends on it; without `game`
 * the Gen 9 rule (boost applies) is used.
 */
export type GameAwareContext = DamageContext & { readonly game?: Game };

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function hasAbility(pokemon: Pokemon, ability: string): boolean {
  return !pokemon.abilitySuppressed && pokemon.ability === ability;
}

function hasItem(pokemon: Pokemon, item: string): boolean {
  return pokemon.item === item;
}

/**
 * dist/mechanics/util.js isGrounded: Gravity or Iron Ball grounds anything;
 * otherwise Flying type, Levitate / Eelevate and Air Balloon unground.
 * Their hasType checks the Tera type while Terastallized, which is what
 * getDefensiveTypes returns.
 */
export function isGrounded(pokemon: Pokemon, field: FieldState): boolean {
  if (field.isGravity || hasItem(pokemon, 'Iron Ball')) return true;
  return (
    !getDefensiveTypes(pokemon).includes('Flying') &&
    !hasAbility(pokemon, 'Levitate') &&
    !hasAbility(pokemon, 'Eelevate') &&
    !hasItem(pokemon, 'Air Balloon')
  );
}

/**
 * dist/mechanics/util.js checkAirLock: an attacker or defender with Air Lock
 * or Cloud Nine clears the weather for the calculation.
 */
export function effectiveWeather(ctx: DamageContext): Weather {
  for (const mon of [ctx.attacker, ctx.defender]) {
    if (hasAbility(mon, 'Air Lock') || hasAbility(mon, 'Cloud Nine')) return 'none';
  }
  return ctx.field.weather;
}

function modifier(
  name: string,
  order: number,
  multiplier: (ctx: DamageContext) => number,
  floorAtOne: boolean,
): Modifier {
  return {
    name,
    order,
    applies: (ctx) => multiplier(ctx) !== NEUTRAL,
    apply: (value, ctx) => {
      const m = multiplier(ctx);
      if (m === 0) return 0;
      const out = applyChainMultiplier(value, m);
      return floorAtOne ? Math.max(1, out) : out;
    },
  };
}

// ---------------------------------------------------------------------------
// Weather (damage chain)
// ---------------------------------------------------------------------------

/**
 * gen789.js calculateSMSSSV (primal nullification) and
 * calculateBaseDamageSMSSSV (boost / weaken):
 *   - Harsh Sunshine + Water, Heavy Rain + Fire: damage 0, checked before
 *     anything else and not affected by Utility Umbrella.
 *   - Sun + Hydro Steam: 1.5x unless the ATTACKER holds Utility Umbrella.
 *   - Otherwise, a DEFENDER holding Utility Umbrella ignores the weather.
 *   - Sun or Harsh Sunshine + Fire, Rain or Heavy Rain + Water: 1.5x.
 *   - Sun + Water, Rain + Fire: 0.5x (primal weathers never weaken; the
 *     opposing type is nullified instead).
 *
 * Mega Sol: the holder's own moves act as if in Sun whatever the weather
 * (`isMegaSol` in gen789.js calculateBaseDamageSMSSSV and champions.js
 * calculateBaseDamageChampions): Fire and Hydro Steam 1.5x, Water 0.5x, and
 * Rain / Heavy Rain no longer boost its Water moves. It affects only moves
 * the holder uses, so only the attacker is checked. Air Lock / Cloud Nine
 * clear the field weather but not Mega Sol. Primal nullification is checked
 * on the field weather alone, so Mega Sol does not change it.
 */
export function weatherMultiplier(ctx: DamageContext): number {
  const weather = effectiveWeather(ctx);
  const type = ctx.move.type;
  const megaSol = hasAbility(ctx.attacker, 'Mega Sol');

  if ((weather === 'harshSun' && type === 'Water') || (weather === 'heavyRain' && type === 'Fire')) {
    return PRIMAL_NULLIFY;
  }
  if (
    (weather === 'sun' || megaSol) &&
    ctx.move.name === 'Hydro Steam' &&
    !hasItem(ctx.attacker, 'Utility Umbrella')
  ) {
    return WEATHER_BOOST;
  }
  if (hasItem(ctx.defender, 'Utility Umbrella')) return NEUTRAL;

  const sunny = weather === 'sun' || weather === 'harshSun' || megaSol;
  const rainy = (weather === 'rain' || weather === 'heavyRain') && !megaSol;
  if ((sunny && type === 'Fire') || (rainy && type === 'Water')) return WEATHER_BOOST;
  if (((weather === 'sun' || megaSol) && type === 'Water') || (weather === 'rain' && type === 'Fire')) {
    return WEATHER_WEAKEN;
  }
  return NEUTRAL;
}

/**
 * Returns 0 for primal-nullified moves. The damage chain must keep that 0:
 * @smogon/calc returns early there, so its final `Math.max(1, ...)` clamp
 * (util.js getFinalDamage) never sees it.
 */
export const WEATHER_MODIFIER: Modifier = modifier(
  'weather',
  MODIFIER_ORDER.weather,
  weatherMultiplier,
  false,
);

// ---------------------------------------------------------------------------
// Terrain (base-power chain)
// ---------------------------------------------------------------------------

/**
 * gen789.js calculateBPModsSMSSSV:
 *   - grounded attacker: Electric Terrain + Electric, Grassy Terrain + Grass,
 *     Psychic Terrain + Psychic move -> 5325.
 *   - grounded defender: Misty Terrain + Dragon move, Grassy Terrain +
 *     Earthquake or Bulldoze -> 2048.
 * The two groups never overlap (different move types), so at most one applies.
 */
export function terrainMultiplier(ctx: DamageContext): number {
  const { terrain } = ctx.field;
  const type = ctx.move.type;

  if (isGrounded(ctx.attacker, ctx.field)) {
    if (
      (terrain === 'electric' && type === 'Electric') ||
      (terrain === 'grassy' && type === 'Grass') ||
      (terrain === 'psychic' && type === 'Psychic')
    ) {
      return TERRAIN_BOOST;
    }
  }
  if (isGrounded(ctx.defender, ctx.field)) {
    if (
      (terrain === 'misty' && type === 'Dragon') ||
      (terrain === 'grassy' && (ctx.move.name === 'Earthquake' || ctx.move.name === 'Bulldoze'))
    ) {
      return TERRAIN_WEAKEN;
    }
  }
  return NEUTRAL;
}

/**
 * Base-power modifier: apply() takes and returns BASE POWER. Uses the same
 * order slot as the pipeline's TERRAIN_BP_MODIFIER placeholder. The result is
 * floored at 1 like gen789.js calculateBasePowerSMSSSV
 * (`Math.max(1, pokeRound(...))`).
 */
export const TERRAIN_MODIFIER: Modifier = modifier(
  'terrain',
  TERRAIN_BP_MODIFIER.order,
  terrainMultiplier,
  true,
);

// ---------------------------------------------------------------------------
// Screens (damage chain, final modifiers)
// ---------------------------------------------------------------------------

/**
 * gen789.js calculateSMSSSV sets every screen to false for Brick Break,
 * Psychic Fangs and Raging Bull (they shatter screens before hitting).
 */
const SCREEN_BREAKING_MOVES: ReadonlySet<string> = new Set(['Brick Break', 'Psychic Fangs', 'Raging Bull']);

/**
 * gen789.js calculateFinalModsSMSSSV:
 *   - Reflect on Physical, Light Screen on Special, only when Aurora Veil is
 *     not also up (they do not stack with it).
 *   - Aurora Veil on any damaging move.
 *   - 2732 outside Singles, 2048 in Singles.
 *   - Skipped entirely on a critical hit.
 * util.js checkInfiltrator: an Infiltrator attacker ignores all three.
 */
export function screensMultiplier(ctx: DamageContext): number {
  const { move, field } = ctx;
  if (ctx.isCritical) return NEUTRAL;
  if (hasAbility(ctx.attacker, 'Infiltrator')) return NEUTRAL;
  if (SCREEN_BREAKING_MOVES.has(move.name)) return NEUTRAL;

  const side = field.defenderSide;
  const screened =
    (side.auroraVeil && move.category !== 'Status') ||
    (side.reflect && move.category === 'Physical') ||
    (side.lightScreen && move.category === 'Special');
  if (!screened) return NEUTRAL;
  return field.isDoubles ? SCREEN_DOUBLES : SCREEN_SINGLES;
}

export const SCREENS_MODIFIER: Modifier = modifier(
  'screens',
  MODIFIER_ORDER.screens,
  screensMultiplier,
  false,
);

// ---------------------------------------------------------------------------
// Sandstorm / Snow defense boosts (defense-stat chain)
// ---------------------------------------------------------------------------

/**
 * 1.5x. gen789.js calculateDefenseSMSSSV: `defense = pokeRound((defense * 3) / 2)`.
 * Expressed as 6144/4096, which rounds identically.
 */
export const WEATHER_DEFENSE_BOOST = 6144;

/**
 * gen789.js calculateDefenseSMSSSV, and calculateDefenseChampions in
 * champions.js:
 *   - Sand + Rock-type defender + special move: SpD 1.5x.
 *   - Snow + Ice-type defender + physical move: Def 1.5x.
 *   - Applied to the boosted stat directly, BEFORE the dfMods chain (so
 *     before the Ruin abilities), and not skipped on a critical hit.
 *   - Air Lock / Cloud Nine clear it (util.js checkAirLock); Utility Umbrella
 *     does not.
 *   - champions.js only: skipped when the attacker has Mega Sol. gen789.js
 *     has no such check, and Gen 9 data does have a Mega Sol Pokemon
 *     (Meganium-Mega), so in Gen 9 the boost still applies against it.
 * The type check uses the Tera type while Terastallized, like their hasType.
 * Like the Ruin abilities, "physical" keys off the move's category only.
 */
export function weatherDefenseMultiplier(ctx: GameAwareContext): number {
  if (ctx.game === 'champions' && hasAbility(ctx.attacker, 'Mega Sol')) return NEUTRAL;
  const weather = effectiveWeather(ctx);
  const types = getDefensiveTypes(ctx.defender);
  const { category } = ctx.move;
  if (weather === 'sand' && types.includes('Rock') && category === 'Special') return WEATHER_DEFENSE_BOOST;
  if (weather === 'snow' && types.includes('Ice') && category === 'Physical') return WEATHER_DEFENSE_BOOST;
  return NEUTRAL;
}

/**
 * Defense-stat modifier: apply() takes and returns the defender's Def / SpD.
 * Order 0 puts it ahead of Sword / Beads of Ruin, matching @smogon/calc.
 */
export const WEATHER_DEFENSE_MODIFIER: Modifier = modifier(
  'weatherDefense',
  0,
  weatherDefenseMultiplier,
  true,
);

// ---------------------------------------------------------------------------
// Ruin abilities (stat chains)
// ---------------------------------------------------------------------------

/**
 * Active when the FieldState flag is set or the relevant opposing Pokemon
 * holds the ability, and the Pokemon whose stat is lowered does not hold it
 * itself. Mirrors gen789.js calculateAtModsSMSSSV / calculateDfModsSMSSSV:
 *   isTabletsOfRuinActive = (defender.hasAbility('Tablets of Ruin') ||
 *     field.isTabletsOfRuin) && !attacker.hasAbility('Tablets of Ruin')
 */
function ruinActive(flag: boolean, holder: Pokemon, affected: Pokemon, ability: string): boolean {
  return (flag || hasAbility(holder, ability)) && !hasAbility(affected, ability);
}

function ruinModifier(name: string, order: number, applies: (ctx: DamageContext) => boolean): Modifier {
  return modifier(name, order, (ctx) => (applies(ctx) ? RUIN_MULTIPLIER : NEUTRAL), true);
}

/**
 * Attack-stat modifiers: apply() takes and returns the attacker's Atk / SpA.
 * The stat is floored at 1 like gen789.js calculateAttackSMSSSV.
 */
export const TABLETS_OF_RUIN_MODIFIER: Modifier = ruinModifier(
  'tabletsOfRuin',
  1,
  (ctx) =>
    ctx.move.category === 'Physical' &&
    ruinActive(ctx.field.isTabletsOfRuin, ctx.defender, ctx.attacker, 'Tablets of Ruin'),
);

export const VESSEL_OF_RUIN_MODIFIER: Modifier = ruinModifier(
  'vesselOfRuin',
  2,
  (ctx) =>
    ctx.move.category === 'Special' &&
    ruinActive(ctx.field.isVesselOfRuin, ctx.defender, ctx.attacker, 'Vessel of Ruin'),
);

/**
 * Defense-stat modifiers: apply() takes and returns the defender's Def / SpD.
 * The stat is floored at 1 like gen789.js calculateDefenseSMSSSV.
 *
 * Their check uses `hitsPhysical` (Physical, or a move that targets Def such
 * as Psyshock). Move in src/types.ts has no defensive-stat override, so this
 * keys off the move's category only.
 */
export const SWORD_OF_RUIN_MODIFIER: Modifier = ruinModifier(
  'swordOfRuin',
  1,
  (ctx) =>
    ctx.move.category === 'Physical' &&
    ruinActive(ctx.field.isSwordOfRuin, ctx.attacker, ctx.defender, 'Sword of Ruin'),
);

export const BEADS_OF_RUIN_MODIFIER: Modifier = ruinModifier(
  'beadsOfRuin',
  2,
  (ctx) =>
    ctx.move.category === 'Special' &&
    ruinActive(ctx.field.isBeadsOfRuin, ctx.attacker, ctx.defender, 'Beads of Ruin'),
);

export const ATTACK_STAT_FIELD_MODIFIERS: readonly Modifier[] = [
  TABLETS_OF_RUIN_MODIFIER,
  VESSEL_OF_RUIN_MODIFIER,
];

export const DEFENSE_STAT_FIELD_MODIFIERS: readonly Modifier[] = [
  WEATHER_DEFENSE_MODIFIER,
  SWORD_OF_RUIN_MODIFIER,
  BEADS_OF_RUIN_MODIFIER,
];

/** Damage-chain modifiers from this module, for use with runPipeline. */
export const FIELD_DAMAGE_MODIFIERS: readonly Modifier[] = [WEATHER_MODIFIER, SCREENS_MODIFIER];
