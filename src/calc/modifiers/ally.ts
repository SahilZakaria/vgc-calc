import type { DamageContext } from '../../types';

/**
 * Ally effects carried as SideState flags: Helping Hand, and the partner
 * abilities Battery, Power Spot, Steely Spirit and Friend Guard. Each is a
 * 4096-based multiplier that calculate.ts splices into one of the chains at
 * the position @smogon/calc pushes it (util.js chainMods rounds at every
 * step, so position matters):
 *
 *   base power    Helping Hand | terrain | Technician | Battery, Power Spot | type item
 *   attack stat   Guts, Huge Power | Steely Spirit | Thick Fat | Ruin | Choice
 *   final mods    screens | Tinted Lens, Multiscale, Solid Rock | Friend Guard | Expert Belt / Life Orb
 *
 * The attacker-side flags (Helping Hand, Battery, Power Spot, Steely Spirit)
 * are read from field.attackerSide; Friend Guard from field.defenderSide.
 * The flag means "an ally provides this"; the attacker's own Steely Spirit is
 * a separate base-power effect and is not handled here.
 *
 * SOURCE
 * ------
 * @smogon/calc 0.12.0:
 *   dist/mechanics/gen789.js
 *     calculateBPModsSMSSSV      isHelpingHand 6144 (before terrain),
 *                                isBattery 5325 (Special only),
 *                                isPowerSpot 5325 (after Battery)
 *     calculateAtModsSMSSSV      isSteelySpirit 6144 (Steel moves, after
 *                                Huge Power, before Thick Fat)
 *     calculateFinalModsSMSSSV   isFriendGuard 3072 (after Solid Rock,
 *                                before Expert Belt / Life Orb)
 *   dist/mechanics/champions.js
 *     calculateBPModsChampions     isHelpingHand 6144, same position
 *     calculateFinalModsChampions  isFriendGuard 3072, same position
 *
 * CHAMPIONS
 * ---------
 * champions.js has no code for isBattery, isPowerSpot or isSteelySpirit, so
 * those three are Gen 9 only here. Battery (Vikavolt) and Power Spot
 * (Stonjourner) have no holder in the Champions roster and are absent from
 * its ability table. Steely Spirit IS in @smogon/calc's Champions ability
 * table and Perrserker is on the roster, so an ally Steely Spirit may be
 * possible in Champions; it stays inert to match the oracle until that is
 * confirmed in game.
 *
 * Neither @smogon/calc file checks Mold Breaker against an ally's Friend
 * Guard, so neither does this module.
 */

const NEUTRAL = 4096;

/** 1.5x. calculateBPMods*: `bpMods.push(6144)` for isHelpingHand. */
export const HELPING_HAND_BOOST = 6144;
/** ~1.3x. calculateBPModsSMSSSV: `bpMods.push(5325)` for isBattery. */
export const BATTERY_BOOST = 5325;
/** ~1.3x. calculateBPModsSMSSSV: `bpMods.push(5325)` for isPowerSpot. */
export const POWER_SPOT_BOOST = 5325;
/** 1.5x. calculateAtModsSMSSSV: `atMods.push(6144)` for isSteelySpirit. */
export const STEELY_SPIRIT_BOOST = 6144;
/** 0.75x. calculateFinalMods*: `finalMods.push(3072)` for isFriendGuard. */
export const FRIEND_GUARD_REDUCTION = 3072;

/** Battery, Power Spot and ally Steely Spirit exist only in gen789.js. */
const isGen9 = (ctx: DamageContext): boolean => ctx.game === 'gen9';

/** Base-power chain, first: before terrain. Both games. */
export function helpingHandMultiplier(ctx: DamageContext): number {
  return ctx.field.attackerSide.helpingHand ? HELPING_HAND_BOOST : NEUTRAL;
}

/** Base-power chain, after the ability boosts (Technician). Gen 9, Special moves. */
export function batteryMultiplier(ctx: DamageContext): number {
  return isGen9(ctx) && ctx.field.attackerSide.battery && ctx.move.category === 'Special'
    ? BATTERY_BOOST
    : NEUTRAL;
}

/** Base-power chain, right after Battery. Gen 9, any damaging move. */
export function powerSpotMultiplier(ctx: DamageContext): number {
  return isGen9(ctx) && ctx.field.attackerSide.powerSpot ? POWER_SPOT_BOOST : NEUTRAL;
}

/** Attack-stat chain, after Huge Power and before Thick Fat. Gen 9, Steel moves. */
export function steelySpiritMultiplier(ctx: DamageContext): number {
  return isGen9(ctx) && ctx.field.attackerSide.steelySpirit && ctx.move.type === 'Steel'
    ? STEELY_SPIRIT_BOOST
    : NEUTRAL;
}

/**
 * Final-mod chain, after Solid Rock / Filter and before Expert Belt / Life
 * Orb. Both games. Unlike the screens it is not skipped on a critical hit.
 */
export function friendGuardMultiplier(ctx: DamageContext): number {
  return ctx.field.defenderSide.friendGuard ? FRIEND_GUARD_REDUCTION : NEUTRAL;
}
