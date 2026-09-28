import { describe, expect, it } from 'vitest';
import { getFinalDamage, getStabMod } from '@smogon/calc/dist/mechanics/util';
import type { DamageContext, Move, Pokemon, SideState, StatTable, TypeName } from '../../types';
import { toSmogonMove, toSmogonPokemon, type OracleGame } from '../../oracle/smogon-adapter';
import { MODIFIER_ORDER, runPostRoll } from '../modifier-pipeline';
import { getTypeEffectiveness } from '../type-chart';
import {
  burnModifier,
  CORE_MODIFIERS,
  criticalModifier,
  getStabMultiplier4096,
  spreadModifier,
  stabModifier,
  typeEffectivenessModifier,
} from './core';

// References:
// [B]  Bulbapedia, "Damage", Generation V onward formula: Targets 0.75 in
//      multi-target battles when hitting more than one target, Critical 1.5
//      (Gen VI+), STAB 1.5 (2 with Adaptability), Burn 0.5 for physical moves
//      unless the user has Guts (and, Gen VI+, unless the move is Facade).
//      4096-based multipliers round to nearest with .5 rounding down.
// [S]  @smogon/calc 0.12.0 dist: mechanics/gen789.js calculateBaseDamageSMSSSV
//      (spread 3072/4096 pokeRound, crit floor(x * 1.5)), mechanics/util.js
//      getStabMod and getFinalDamage (STAB pokeRound, type floor, burn
//      floor(x / 2)). getStabMod and getFinalDamage are also called directly
//      below as an oracle.

const stats = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const side: SideState = {
  reflect: false, lightScreen: false, auroraVeil: false,
  tailwind: false, helpingHand: false, friendGuard: false, battery: false,
  powerSpot: false, steelySpirit: false, stealthRock: false, spikes: 0,
};

function mon(species: string, types: TypeName[], extra: Partial<Pokemon> = {}): Pokemon {
  return {
    species,
    level: 50,
    types,
    isTerastallized: false,
    baseStats: stats(100),
    ivs: stats(31),
    evs: stats(0),
    nature: 'Hardy',
    ability: 'Pressure',
    abilitySuppressed: false,
    item: null,
    weightKg: 50,
    currentHp: null,
    statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    status: 'none',
    ...extra,
  };
}

function move(extra: Partial<Move> = {}): Move {
  return {
    name: 'Tackle',
    type: 'Normal',
    basePower: 80,
    variablePower: 'none',
    category: 'Physical',
    target: 'single',
    priority: 0,
    hits: 1,
    flags: {
      contact: false, punch: false, sound: false, slicing: false,
      bite: false, bullet: false, wind: false, pulse: false,
    },
    ...extra,
  };
}

function context(extra: {
  attacker?: Pokemon;
  defender?: Pokemon;
  move?: Move;
  isDoubles?: boolean;
  isCritical?: boolean;
} = {}): DamageContext {
  return {
    attacker: extra.attacker ?? mon('Snorlax', ['Normal']),
    defender: extra.defender ?? mon('Blissey', ['Normal']),
    move: extra.move ?? move(),
    field: {
      weather: 'none',
      terrain: 'none',
      isDoubles: extra.isDoubles ?? true,
      isGravity: false,
      isWonderRoom: false,
      isMagicRoom: false,
      isBeadsOfRuin: false,
      isSwordOfRuin: false,
      isTabletsOfRuin: false,
      isVesselOfRuin: false,
      attackerSide: side,
      defenderSide: side,
    },
    isCritical: extra.isCritical ?? false,
  };
}

function smogonStab(game: OracleGame, ctx: DamageContext): number {
  return getStabMod(toSmogonPokemon(game, ctx.attacker), toSmogonMove(game, ctx.move), {
    attackerName: ctx.attacker.species,
    defenderName: ctx.defender.species,
    moveName: ctx.move.name,
  });
}

describe('order', () => {
  it('uses the pipeline slots', () => {
    expect(spreadModifier.order).toBe(MODIFIER_ORDER.spread);
    expect(criticalModifier.order).toBe(MODIFIER_ORDER.critical);
    expect(stabModifier.order).toBe(MODIFIER_ORDER.stab);
    expect(typeEffectivenessModifier.order).toBe(MODIFIER_ORDER.typeEffectiveness);
    expect(burnModifier.order).toBe(MODIFIER_ORDER.burn);
  });
});

describe('spread reduction', () => {
  it('applies to allAdjacentFoes and allAdjacent in doubles only [B][S]', () => {
    expect(spreadModifier.applies(context({ move: move({ target: 'allAdjacentFoes' }) }))).toBe(true);
    expect(spreadModifier.applies(context({ move: move({ target: 'allAdjacent' }) }))).toBe(true);
    expect(spreadModifier.applies(context({ move: move({ target: 'single' }) }))).toBe(false);
    expect(
      spreadModifier.applies(context({ move: move({ target: 'allAdjacentFoes' }), isDoubles: false })),
    ).toBe(false);
  });

  it('is 3072/4096 = 0.75x with pokeRound [S]', () => {
    const ctx = context({ move: move({ target: 'allAdjacentFoes' }) });
    expect(spreadModifier.apply(100, ctx)).toBe(75);
    // 10 * 0.75 = 7.5: an exact half rounds down [B].
    expect(spreadModifier.apply(10, ctx)).toBe(7);
    // 13 * 0.75 = 9.75 rounds up to 10, unlike floor.
    expect(spreadModifier.apply(13, ctx)).toBe(10);
  });
});

describe('critical hit', () => {
  it('applies only when ctx.isCritical', () => {
    expect(criticalModifier.applies(context({ isCritical: true }))).toBe(true);
    expect(criticalModifier.applies(context())).toBe(false);
  });

  it('is 1.5x, floored [B][S]', () => {
    const ctx = context({ isCritical: true });
    expect(criticalModifier.apply(100, ctx)).toBe(150);
    // 101 * 1.5 = 151.5 floors to 151.
    expect(criticalModifier.apply(101, ctx)).toBe(151);
  });
});

describe('STAB', () => {
  const cases: { label: string; game: OracleGame; ctx: DamageContext; expected: number }[] = [
    {
      label: 'no STAB',
      game: 'champions',
      ctx: context({ attacker: mon('Snorlax', ['Normal']), move: move({ type: 'Fire' }) }),
      expected: 4096,
    },
    {
      label: 'STAB 1.5x',
      game: 'champions',
      ctx: context({ attacker: mon('Snorlax', ['Normal']) }),
      expected: 6144,
    },
    {
      label: 'STAB on second type',
      game: 'champions',
      ctx: context({ attacker: mon('Garchomp', ['Dragon', 'Ground']), move: move({ type: 'Ground' }) }),
      expected: 6144,
    },
    {
      label: 'Adaptability 2x',
      game: 'champions',
      ctx: context({ attacker: mon('Porygon-Z', ['Normal'], { ability: 'Adaptability' }) }),
      expected: 8192,
    },
    {
      label: 'Adaptability without a type match',
      game: 'champions',
      ctx: context({
        attacker: mon('Porygon-Z', ['Normal'], { ability: 'Adaptability' }),
        move: move({ type: 'Ice' }),
      }),
      expected: 4096,
    },
    {
      label: 'suppressed Adaptability',
      game: 'champions',
      ctx: context({
        attacker: mon('Porygon-Z', ['Normal'], { ability: 'Adaptability', abilitySuppressed: true }),
      }),
      expected: 6144,
    },
    {
      label: 'Tera into a new type: Tera-type move',
      game: 'gen9',
      ctx: context({
        attacker: mon('Snorlax', ['Normal'], { teraType: 'Ghost', isTerastallized: true }),
        move: move({ type: 'Ghost' }),
      }),
      expected: 6144,
    },
    {
      label: 'Tera into a new type: original-type move keeps 1.5x',
      game: 'gen9',
      ctx: context({ attacker: mon('Snorlax', ['Normal'], { teraType: 'Ghost', isTerastallized: true }) }),
      expected: 6144,
    },
    {
      label: 'Tera into an original type: 2x',
      game: 'gen9',
      ctx: context({ attacker: mon('Snorlax', ['Normal'], { teraType: 'Normal', isTerastallized: true }) }),
      expected: 8192,
    },
    {
      label: 'unused Tera type is inert',
      game: 'gen9',
      ctx: context({
        attacker: mon('Snorlax', ['Normal'], { teraType: 'Ghost' }),
        move: move({ type: 'Ghost' }),
      }),
      expected: 4096,
    },
    {
      label: 'Adaptability + Tera into an original type: 2.25x',
      game: 'gen9',
      ctx: context({
        attacker: mon('Porygon-Z', ['Normal'], {
          ability: 'Adaptability', teraType: 'Normal', isTerastallized: true,
        }),
      }),
      expected: 9216,
    },
    {
      label: 'Adaptability + Tera into a new type: Tera-type move 2x',
      game: 'gen9',
      ctx: context({
        attacker: mon('Porygon-Z', ['Normal'], {
          ability: 'Adaptability', teraType: 'Ghost', isTerastallized: true,
        }),
        move: move({ type: 'Ghost' }),
      }),
      expected: 8192,
    },
    {
      label: 'Adaptability + Tera into a new type: original-type move only 1.5x',
      game: 'gen9',
      ctx: context({
        attacker: mon('Porygon-Z', ['Normal'], {
          ability: 'Adaptability', teraType: 'Ghost', isTerastallized: true,
        }),
      }),
      expected: 6144,
    },
  ];

  it.each(cases)('$label: $expected/4096, matching @smogon/calc getStabMod [S]', ({ game, ctx, expected }) => {
    expect(getStabMultiplier4096(ctx)).toBe(expected);
    expect(smogonStab(game, ctx)).toBe(expected);
  });

  it('does not apply without a type match', () => {
    expect(stabModifier.applies(context({ move: move({ type: 'Fire' }) }))).toBe(false);
    expect(stabModifier.applies(context())).toBe(true);
  });

  it('rounds with pokeRound [B][S]', () => {
    const ctx = context();
    expect(stabModifier.apply(100, ctx)).toBe(150);
    // 1 * 1.5 = 1.5: an exact half rounds down.
    expect(stabModifier.apply(1, ctx)).toBe(1);
    // 3 * 1.5 = 4.5 -> 4; 5 * 1.5 = 7.5 -> 7.
    expect(stabModifier.apply(3, ctx)).toBe(4);
    expect(stabModifier.apply(5, ctx)).toBe(7);
    const adaptability = context({ attacker: mon('Porygon-Z', ['Normal'], { ability: 'Adaptability' }) });
    expect(stabModifier.apply(77, adaptability)).toBe(154);
  });
});

describe('type effectiveness', () => {
  it('delegates to the type chart and floors [S]', () => {
    // Water vs Fire/Rock is 2 x 2 = 4x.
    const quad = context({ move: move({ type: 'Water' }), defender: mon('Coalossal', ['Rock', 'Fire']) });
    expect(typeEffectivenessModifier.apply(33, quad)).toBe(132);
    // Grass vs Fire/Dragon is 0.5 x 0.5 = 0.25x: 99 * 0.25 = 24.75 floors to 24.
    const quarter = context({ move: move({ type: 'Grass' }), defender: mon('Reshiram', ['Dragon', 'Fire']) });
    expect(typeEffectivenessModifier.apply(99, quarter)).toBe(24);
    // Normal vs Ghost is 0x.
    const immune = context({ defender: mon('Gengar', ['Ghost', 'Poison']) });
    expect(typeEffectivenessModifier.apply(99, immune)).toBe(0);
  });

  it('uses the Tera type when the defender is Terastallized', () => {
    // Tera Fairy Dragonite takes 0x from Dragon.
    const ctx = context({
      move: move({ type: 'Dragon' }),
      defender: mon('Dragonite', ['Dragon', 'Flying'], { teraType: 'Fairy', isTerastallized: true }),
    });
    expect(typeEffectivenessModifier.apply(100, ctx)).toBe(0);
  });
});

describe('burn', () => {
  const burned = (extra: Partial<Pokemon> = {}) => mon('Snorlax', ['Normal'], { status: 'brn', ...extra });

  it('halves physical damage, floored [B][S]', () => {
    const ctx = context({ attacker: burned() });
    expect(burnModifier.applies(ctx)).toBe(true);
    expect(burnModifier.apply(100, ctx)).toBe(50);
    expect(burnModifier.apply(99, ctx)).toBe(49);
  });

  it('does not apply to special moves, unburned users, Guts or Facade [B][S]', () => {
    expect(burnModifier.applies(context({ attacker: burned(), move: move({ category: 'Special' }) }))).toBe(false);
    expect(burnModifier.applies(context())).toBe(false);
    expect(burnModifier.applies(context({ attacker: burned({ ability: 'Guts' }) }))).toBe(false);
    expect(burnModifier.applies(context({ attacker: burned(), move: move({ name: 'Facade' }) }))).toBe(false);
  });

  it('applies when Guts is suppressed', () => {
    expect(burnModifier.applies(context({ attacker: burned({ ability: 'Guts', abilitySuppressed: true }) }))).toBe(true);
  });
});

describe('post-roll chain against @smogon/calc getFinalDamage', () => {
  // getFinalDamage(base, 15, ...) applies the 100% roll (a no-op), then STAB,
  // type and burn, then a final mod of 4096 (1x) and a minimum of 1. The
  // minimum-1 clamp belongs to the final-mod stage, not to these modifiers,
  // so it is applied to our result here. With no screens, the two must match.
  const cases: { label: string; ctx: DamageContext }[] = [
    { label: 'STAB neutral', ctx: context() },
    {
      label: 'STAB + 0.5x + burn',
      ctx: context({ attacker: mon('Snorlax', ['Normal'], { status: 'brn' }), move: move({ type: 'Normal', category: 'Physical' }), defender: mon('Lucario', ['Fighting', 'Steel']) }),
    },
    {
      label: 'Adaptability + 0.25x',
      ctx: context({
        attacker: mon('Porygon-Z', ['Normal'], { ability: 'Adaptability' }),
        move: move({ category: 'Special' }),
        defender: mon('Aggron', ['Steel', 'Rock']),
      }),
    },
    {
      label: 'no STAB + 4x + burn',
      ctx: context({
        attacker: mon('Snorlax', ['Normal'], { status: 'brn' }),
        move: move({ type: 'Water' }),
        defender: mon('Coalossal', ['Rock', 'Fire']),
      }),
    },
  ];

  it.each(cases)('$label', ({ ctx }) => {
    const stab = smogonStab('champions', ctx);
    const eff = getTypeEffectiveness(ctx.move.type, ctx.defender.types);
    // None of these cases has Guts or Facade, so burn is just status + category.
    const burn = ctx.attacker.status === 'brn' && ctx.move.category === 'Physical';
    for (const base of [1, 7, 33, 57, 101, 250, 999]) {
      expect(Math.max(1, runPostRoll(base, ctx, CORE_MODIFIERS))).toBe(getFinalDamage(base, 15, eff, burn, stab, 4096));
    }
  });
});
