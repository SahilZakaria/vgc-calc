import type { DamageContext, Pokemon, TypeName } from '../../types';
import { calculateStats } from '../stats';
import { getMoveEffectiveness } from '../move-effectiveness';
import { getDefensiveTypes } from '../type-chart';

/**
 * Damage-affecting abilities and held items.
 *
 * CHAINS
 * ------
 * @smogon/calc does not round after each of these. It collects every
 * modifier of one kind into a list, folds the list into a single 4096-based
 * multiplier (util.js chainMods: M = (M * mod + 2048) >> 12, then clamped)
 * and applies that once with pokeRound. Folding is order-sensitive, so each
 * modifier here is a ChainModifier (a multiplier, not a value transform) and
 * the exported lists are in the order @smogon/calc pushes them.
 * calculate.ts splices the field modifiers (terrain, Ruin, screens) into the
 * same chains at their positions:
 *
 *   base power    Helping Hand | terrain | Technician | Battery, Power Spot |
 *                 type-boosting item
 *   attack stat   Guts / Huge Power / Pure Power | Steely Spirit | Thick Fat |
 *                 Ruin | Choice Band / Specs
 *   defense stat  Ruin | Assault Vest
 *   final mods    screens | Tinted Lens, Multiscale, Solid Rock / Filter |
 *                 Friend Guard | Expert Belt / Life Orb
 *
 * (Helping Hand, Battery, Power Spot, Steely Spirit and Friend Guard are the
 * ally flags in modifiers/ally.ts.)
 *
 * Immunity abilities and Levitate are not multipliers: the move deals 0.
 * Mold Breaker, Magic Room and Klutz change which abilities and items are
 * active before anything else runs (resolveAbilitiesAndItems).
 *
 * SOURCE
 * ------
 * @smogon/calc 0.12.0, dist/mechanics/gen789.js (Gen 9) and
 * dist/mechanics/champions.js (Champions):
 *   calculateSMSSSV / calculateChampions   Mold Breaker, immunities, Levitate
 *   calculateBPMods*       Technician 6144 (bp <= 60), type item 4915
 *   calculateAtMods*       Guts 6144 (any status, Physical),
 *                          Huge Power / Pure Power 8192 (Physical),
 *                          Thick Fat 2048 (Fire / Ice),
 *                          Choice Band / Specs 6144 (gen789.js only)
 *   calculateDfModsSMSSSV  Assault Vest 6144 (Special; gen789.js only)
 *   calculateFinalMods*    Tinted Lens 8192 (< 1x; gen789.js only),
 *                          Multiscale 2048, Solid Rock / Filter 3072 (> 1x),
 *                          Expert Belt 4915 (> 1x), Life Orb 5324
 *   util.js checkItem      Klutz and Magic Room remove the held item
 *   items.js getItemBoostType   type-boosting item table
 *
 * Choice Band, Choice Specs, Assault Vest, Tinted Lens and Storm Drain are
 * absent from @smogon/calc's Champions item / ability tables and from
 * champions.js. They are Gen 9 behaviour here and inert in Champions only
 * because no Champions Pokemon can have them.
 *
 * ChainModifier is declared here because src/types.ts has no multiplier-only
 * modifier type.
 */

/** A 4096-based multiplier contributed to a chain. 4096 means "no effect". */
export interface ChainModifier {
  name: string;
  multiplier(ctx: DamageContext): number;
}

const NEUTRAL = 4096;

/** 1.2x. calculateBPMods*: type-boosting items push 4915. */
export const TYPE_ITEM_BOOST = 4915;
/** 1.5x. calculateBPMods*: Technician pushes 6144 when base power <= 60. */
export const TECHNICIAN_BOOST = 6144;
export const TECHNICIAN_MAX_BASE_POWER = 60;
/** 1.5x. calculateAtMods*: Guts pushes 6144. */
export const GUTS_BOOST = 6144;
/** 2x. calculateAtMods*: Huge Power / Pure Power push 8192. */
export const HUGE_POWER_BOOST = 8192;
/** 0.5x. calculateAtMods*: Thick Fat pushes 2048 onto the ATTACKER's stat. */
export const THICK_FAT_REDUCTION = 2048;
/** 1.5x. calculateAtModsSMSSSV: Choice Band / Specs push 6144. */
export const CHOICE_BOOST = 6144;
/** 1.5x. calculateDfModsSMSSSV: Assault Vest pushes 6144. */
export const ASSAULT_VEST_BOOST = 6144;
/** 2x. calculateFinalModsSMSSSV: Tinted Lens pushes 8192. */
export const TINTED_LENS_BOOST = 8192;
/** 0.5x. calculateFinalMods*: Multiscale pushes 2048. */
export const MULTISCALE_REDUCTION = 2048;
/** 0.75x. calculateFinalMods*: Solid Rock / Filter push 3072. */
export const SOLID_ROCK_REDUCTION = 3072;
/** 1.2x. calculateFinalMods*: Expert Belt pushes 4915. */
export const EXPERT_BELT_BOOST = 4915;
/** ~1.3x. calculateFinalMods*: Life Orb pushes 5324 (not 5325). */
export const LIFE_ORB_BOOST = 5324;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasAbility(pokemon: Pokemon, ...abilities: string[]): boolean {
  return !pokemon.abilitySuppressed && abilities.includes(pokemon.ability);
}

function hasItem(pokemon: Pokemon, item: string): boolean {
  return pokemon.item === item;
}

function effectiveness(ctx: DamageContext): number {
  return getMoveEffectiveness(ctx);
}

function maxHp(pokemon: Pokemon): number {
  return calculateStats(pokemon.baseStats, pokemon.ivs, pokemon.evs, pokemon.nature, pokemon.level).hp;
}

/** null currentHp means full HP. */
function isAtFullHp(pokemon: Pokemon): boolean {
  return pokemon.currentHp === null || pokemon.currentHp === maxHp(pokemon);
}

function chainModifier(name: string, applies: (ctx: DamageContext) => boolean, value: number): ChainModifier {
  return { name, multiplier: (ctx) => (applies(ctx) ? value : NEUTRAL) };
}

// ---------------------------------------------------------------------------
// Ability / item resolution
// ---------------------------------------------------------------------------

/**
 * Defender abilities an ability-ignoring attacker skips. The union of the
 * gen789.js and champions.js `defenderAbilityIgnored` lists (champions.js adds
 * Aura Guard; gen789.js adds abilities Champions does not have).
 */
const IGNORABLE_ABILITIES: ReadonlySet<string> = new Set([
  'Armor Tail', 'Aroma Veil', 'Aura Break', 'Aura Guard', 'Battle Armor', 'Big Pecks',
  'Bulletproof', 'Clear Body', 'Contrary', 'Damp', 'Dazzling', 'Disguise', 'Dry Skin',
  'Earth Eater', 'Eelevate', 'Filter', 'Flash Fire', 'Flower Gift', 'Flower Veil', 'Fluffy',
  'Friend Guard', 'Fur Coat', 'Good as Gold', 'Grass Pelt', 'Guard Dog', 'Heatproof',
  'Heavy Metal', 'Hyper Cutter', 'Ice Face', 'Ice Scales', 'Illuminate', 'Immunity',
  'Inner Focus', 'Insomnia', 'Keen Eye', 'Leaf Guard', 'Levitate', 'Light Metal',
  'Lightning Rod', 'Limber', 'Magic Bounce', 'Magma Armor', 'Marvel Scale', "Mind's Eye",
  'Mirror Armor', 'Motor Drive', 'Multiscale', 'Oblivious', 'Overcoat', 'Own Tempo',
  'Pastel Veil', 'Punk Rock', 'Purifying Salt', 'Queenly Majesty', 'Sand Veil', 'Sap Sipper',
  'Shell Armor', 'Shield Dust', 'Simple', 'Snow Cloak', 'Solid Rock', 'Soundproof',
  'Sticky Hold', 'Storm Drain', 'Sturdy', 'Suction Cups', 'Sweet Veil', 'Tangled Feet',
  'Telepathy', 'Tera Shell', 'Thermal Exchange', 'Thick Fat', 'Unaware', 'Vital Spirit',
  'Volt Absorb', 'Water Absorb', 'Water Bubble', 'Water Veil', 'Well-Baked Body',
  'White Smoke', 'Wind Rider', 'Wonder Guard', 'Wonder Skin',
]);

/** gen789.js: attacker abilities that ignore the list above (champions.js: Mold Breaker only). */
const ABILITY_IGNORING_ABILITIES = ['Mold Breaker', 'Teravolt', 'Turboblaze'];

/** gen789.js `moveIgnoresAbility`. None of these are in Champions. */
const ABILITY_IGNORING_MOVES: ReadonlySet<string> = new Set([
  'G-Max Drum Solo', 'G-Max Fire Ball', 'G-Max Hydrosnipe', 'Light That Burns the Sky',
  'Menacing Moonraze Maelstrom', 'Moongeist Beam', 'Photon Geyser', 'Searing Sunraze Smash',
  'Sunsteel Strike',
]);

/** util.js EV_ITEMS: Klutz does not suppress these. */
const KLUTZ_EXEMPT_ITEMS: ReadonlySet<string> = new Set([
  'Macho Brace', 'Power Anklet', 'Power Band', 'Power Belt', 'Power Bracer', 'Power Lens', 'Power Weight',
]);

/** util.js checkItem: Magic Room, or Klutz on the holder, removes the item. */
function withItemChecked(pokemon: Pokemon, isMagicRoom: boolean): Pokemon {
  if (pokemon.item === null) return pokemon;
  const klutz = hasAbility(pokemon, 'Klutz') && !KLUTZ_EXEMPT_ITEMS.has(pokemon.item);
  return klutz || isMagicRoom ? { ...pokemon, item: null } : pokemon;
}

/**
 * Returns the context with inactive items removed and ignored defender
 * abilities suppressed, in @smogon/calc's order (checkItem runs first, so an
 * Ability Shield under Magic Room does not protect). Run this before anything
 * else reads abilities or items: it also affects grounding (Levitate), weather
 * and terrain checks in other modules.
 */
export function resolveAbilitiesAndItems(ctx: DamageContext): DamageContext {
  const attacker = withItemChecked(ctx.attacker, ctx.field.isMagicRoom);
  let defender = withItemChecked(ctx.defender, ctx.field.isMagicRoom);

  const ignores =
    hasAbility(attacker, ...ABILITY_IGNORING_ABILITIES) || ABILITY_IGNORING_MOVES.has(ctx.move.name);
  if (
    ignores &&
    !defender.abilitySuppressed &&
    IGNORABLE_ABILITIES.has(defender.ability) &&
    !hasItem(defender, 'Ability Shield')
  ) {
    defender = { ...defender, abilitySuppressed: true };
  }

  if (attacker === ctx.attacker && defender === ctx.defender) return ctx;
  return { ...ctx, attacker, defender };
}

// ---------------------------------------------------------------------------
// Immunities
// ---------------------------------------------------------------------------

const TYPE_IMMUNITY_ABILITIES: Readonly<Partial<Record<TypeName, readonly string[]>>> = {
  Fire: ['Flash Fire'],
  Water: ['Water Absorb', 'Storm Drain'],
  Electric: ['Volt Absorb', 'Lightning Rod'],
  Grass: ['Sap Sipper'],
};

/**
 * calculateSMSSSV / calculateChampions return 0 damage for:
 *   Flash Fire (Fire), Water Absorb / Storm Drain (Water),
 *   Volt Absorb / Lightning Rod (Electric), Sap Sipper (Grass),
 *   Levitate / Eelevate (Ground, unless Gravity, Iron Ball or Thousand
 *   Arrows).
 *
 * Levitate and Eelevate follow gen789.js. champions.js checks only Gravity,
 * so it would still call a Levitate + Iron Ball holder immune; in-game Iron
 * Ball grounds it, which isGrounded in field.ts already assumes.
 */
export function isImmuneByAbility(ctx: DamageContext): boolean {
  const { defender, move } = ctx;
  const abilities = TYPE_IMMUNITY_ABILITIES[move.type];
  if (abilities !== undefined && hasAbility(defender, ...abilities)) return true;
  return (
    move.type === 'Ground' &&
    hasAbility(defender, 'Levitate', 'Eelevate') &&
    !ctx.field.isGravity &&
    !hasItem(defender, 'Iron Ball') &&
    move.name !== 'Thousand Arrows'
  );
}

/**
 * calculateSMSSSV / calculateChampions return 0 damage for a Ground move
 * against an Air Balloon holder unless Gravity is up. gen789.js also exempts
 * Thousand Arrows; champions.js has no such check, but Thousand Arrows is not
 * in Champions. Klutz and Magic Room remove the balloon first
 * (resolveAbilitiesAndItems).
 */
export function isImmuneByItem(ctx: DamageContext): boolean {
  const { defender, move } = ctx;
  return (
    move.type === 'Ground' &&
    hasItem(defender, 'Air Balloon') &&
    !ctx.field.isGravity &&
    move.name !== 'Thousand Arrows'
  );
}

// ---------------------------------------------------------------------------
// Base-power chain
// ---------------------------------------------------------------------------

/** items.js getItemBoostType, minus Pink Bow / Polkadot Bow (Gen 2-3 1.1x items). */
const TYPE_BOOST_ITEMS: Readonly<Record<string, TypeName>> = {
  'Draco Plate': 'Dragon', 'Dragon Fang': 'Dragon',
  'Dread Plate': 'Dark', 'Black Glasses': 'Dark',
  'Earth Plate': 'Ground', 'Soft Sand': 'Ground',
  'Fist Plate': 'Fighting', 'Black Belt': 'Fighting',
  'Flame Plate': 'Fire', 'Charcoal': 'Fire',
  'Icicle Plate': 'Ice', 'Never-Melt Ice': 'Ice',
  'Insect Plate': 'Bug', 'Silver Powder': 'Bug',
  'Iron Plate': 'Steel', 'Metal Coat': 'Steel',
  'Meadow Plate': 'Grass', 'Rose Incense': 'Grass', 'Miracle Seed': 'Grass',
  'Mind Plate': 'Psychic', 'Odd Incense': 'Psychic', 'Twisted Spoon': 'Psychic',
  'Fairy Feather': 'Fairy', 'Pixie Plate': 'Fairy',
  'Sky Plate': 'Flying', 'Sharp Beak': 'Flying',
  'Splash Plate': 'Water', 'Sea Incense': 'Water', 'Wave Incense': 'Water', 'Mystic Water': 'Water',
  'Spooky Plate': 'Ghost', 'Spell Tag': 'Ghost',
  'Stone Plate': 'Rock', 'Rock Incense': 'Rock', 'Hard Stone': 'Rock',
  'Toxic Plate': 'Poison', 'Poison Barb': 'Poison',
  'Zap Plate': 'Electric', 'Magnet': 'Electric',
  'Silk Scarf': 'Normal',
};

export function getItemBoostType(item: string | null): TypeName | undefined {
  return item === null ? undefined : TYPE_BOOST_ITEMS[item];
}

/** Compares against the move's base power before any base-power modifier. */
export const TECHNICIAN: ChainModifier = chainModifier(
  'technician',
  (ctx) => hasAbility(ctx.attacker, 'Technician') && ctx.move.basePower <= TECHNICIAN_MAX_BASE_POWER,
  TECHNICIAN_BOOST,
);

export const TYPE_BOOST_ITEM: ChainModifier = chainModifier(
  'typeBoostItem',
  (ctx) => getItemBoostType(ctx.attacker.item) === ctx.move.type,
  TYPE_ITEM_BOOST,
);

/**
 * In chain order; they follow terrain. calculate.ts splices Battery and
 * Power Spot (modifiers/ally.ts) between the ability and item halves.
 */
export const BASE_POWER_ABILITY_MODIFIERS: readonly ChainModifier[] = [TECHNICIAN];
export const BASE_POWER_ITEM_MODIFIERS: readonly ChainModifier[] = [TYPE_BOOST_ITEM];
export const BASE_POWER_MODIFIERS: readonly ChainModifier[] = [
  ...BASE_POWER_ABILITY_MODIFIERS,
  ...BASE_POWER_ITEM_MODIFIERS,
];

// ---------------------------------------------------------------------------
// Attack-stat chain
// ---------------------------------------------------------------------------

/** Guts: any non-volatile status, Physical move. Its burn exemption is in core.ts. */
export const GUTS: ChainModifier = chainModifier(
  'guts',
  (ctx) => hasAbility(ctx.attacker, 'Guts') && ctx.attacker.status !== 'none' && ctx.move.category === 'Physical',
  GUTS_BOOST,
);

export const HUGE_POWER: ChainModifier = chainModifier(
  'hugePower',
  (ctx) => hasAbility(ctx.attacker, 'Huge Power', 'Pure Power') && ctx.move.category === 'Physical',
  HUGE_POWER_BOOST,
);

/** The defender's Thick Fat halves the attacker's stat for Fire and Ice moves. */
export const THICK_FAT: ChainModifier = chainModifier(
  'thickFat',
  (ctx) => hasAbility(ctx.defender, 'Thick Fat') && (ctx.move.type === 'Fire' || ctx.move.type === 'Ice'),
  THICK_FAT_REDUCTION,
);

export const CHOICE_ITEM: ChainModifier = chainModifier(
  'choiceItem',
  (ctx) =>
    (hasItem(ctx.attacker, 'Choice Band') && ctx.move.category === 'Physical') ||
    (hasItem(ctx.attacker, 'Choice Specs') && ctx.move.category === 'Special'),
  CHOICE_BOOST,
);

/**
 * In chain order; the Ruin abilities go between these and
 * ATTACK_STAT_ITEM_MODIFIERS. calculate.ts splices an ally's Steely Spirit
 * (modifiers/ally.ts) between the attacker and defender halves.
 */
export const ATTACK_STAT_ATTACKER_ABILITY_MODIFIERS: readonly ChainModifier[] = [GUTS, HUGE_POWER];
export const ATTACK_STAT_DEFENDER_ABILITY_MODIFIERS: readonly ChainModifier[] = [THICK_FAT];
export const ATTACK_STAT_ABILITY_MODIFIERS: readonly ChainModifier[] = [
  ...ATTACK_STAT_ATTACKER_ABILITY_MODIFIERS,
  ...ATTACK_STAT_DEFENDER_ABILITY_MODIFIERS,
];
export const ATTACK_STAT_ITEM_MODIFIERS: readonly ChainModifier[] = [CHOICE_ITEM];

// ---------------------------------------------------------------------------
// Defense-stat chain
// ---------------------------------------------------------------------------

/**
 * Keyed off the move's category, like @smogon/calc's `!hitsPhysical`; under
 * Wonder Room it boosts whichever raw stat now sits in the SpD slot.
 */
export const ASSAULT_VEST: ChainModifier = chainModifier(
  'assaultVest',
  (ctx) => hasItem(ctx.defender, 'Assault Vest') && ctx.move.category === 'Special',
  ASSAULT_VEST_BOOST,
);

/** In chain order; they follow the Ruin abilities. */
export const DEFENSE_STAT_ITEM_MODIFIERS: readonly ChainModifier[] = [ASSAULT_VEST];

// ---------------------------------------------------------------------------
// Final-modifier chain
// ---------------------------------------------------------------------------

export const TINTED_LENS: ChainModifier = chainModifier(
  'tintedLens',
  (ctx) => hasAbility(ctx.attacker, 'Tinted Lens') && effectiveness(ctx) < 1,
  TINTED_LENS_BOOST,
);

/**
 * Full HP, and entry hazards would not have chipped it: no Stealth Rock, and
 * no Spikes unless Flying. Heavy-Duty Boots waives the hazard condition
 * (gen789.js only; Champions has no Boots). Multi-hit and Parental Bond
 * follow-up hits are out of scope, so this is always the first hit.
 */
export const MULTISCALE: ChainModifier = chainModifier(
  'multiscale',
  (ctx) => {
    const { defender } = ctx;
    const side = ctx.field.defenderSide;
    const hazardFree =
      (!side.stealthRock && (side.spikes === 0 || getDefensiveTypes(defender).includes('Flying'))) ||
      hasItem(defender, 'Heavy-Duty Boots');
    return hasAbility(defender, 'Multiscale') && isAtFullHp(defender) && hazardFree;
  },
  MULTISCALE_REDUCTION,
);

export const SOLID_ROCK: ChainModifier = chainModifier(
  'solidRock',
  (ctx) => hasAbility(ctx.defender, 'Solid Rock', 'Filter') && effectiveness(ctx) > 1,
  SOLID_ROCK_REDUCTION,
);

/** Expert Belt on a super-effective hit, else Life Orb. */
export const DAMAGE_BOOST_ITEM: ChainModifier = {
  name: 'damageBoostItem',
  multiplier: (ctx) => {
    if (hasItem(ctx.attacker, 'Expert Belt') && effectiveness(ctx) > 1) return EXPERT_BELT_BOOST;
    if (hasItem(ctx.attacker, 'Life Orb')) return LIFE_ORB_BOOST;
    return NEUTRAL;
  },
};

/**
 * In chain order; they follow the screens. calculate.ts splices Friend Guard
 * (modifiers/ally.ts) between the ability and item halves.
 */
export const FINAL_ABILITY_MODIFIERS: readonly ChainModifier[] = [TINTED_LENS, MULTISCALE, SOLID_ROCK];
export const FINAL_ITEM_MODIFIERS: readonly ChainModifier[] = [DAMAGE_BOOST_ITEM];
export const FINAL_MODIFIERS: readonly ChainModifier[] = [...FINAL_ABILITY_MODIFIERS, ...FINAL_ITEM_MODIFIERS];
