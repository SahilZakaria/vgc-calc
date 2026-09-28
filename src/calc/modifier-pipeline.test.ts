import { describe, expect, it } from 'vitest';
import type { DamageContext, Modifier, Pokemon, SideState, StatTable } from '../types';
import {
  applyChainMultiplier,
  DAMAGE_MODIFIERS,
  MODIFIER_ORDER,
  pokeRound,
  RANDOM_ROLL_ORDER,
  runPipeline,
  runPostRoll,
  runPreRoll,
  sortModifiers,
  TERRAIN_BP_MODIFIER,
} from './modifier-pipeline';

const stats = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });
const noScreens: SideState = { reflect: false, lightScreen: false, auroraVeil: false };

function mon(species: string): Pokemon {
  return {
    species,
    level: 50,
    types: ['Normal'],
    isTerastallized: false,
    baseStats: stats(100),
    ivs: stats(31),
    evs: stats(0),
    nature: 'Hardy',
    ability: '',
    abilitySuppressed: false,
    item: null,
    weightKg: 1,
    currentHp: null,
    statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    status: 'none',
  };
}

const ctx: DamageContext = {
  attacker: mon('Attacker'),
  defender: mon('Defender'),
  move: {
    name: 'Test',
    type: 'Normal',
    basePower: 90,
    variablePower: 'none',
    category: 'Special',
    target: 'allAdjacentFoes',
    priority: 0,
    hits: 1,
    flags: {
      contact: false, punch: false, sound: false, slicing: false,
      bite: false, bullet: false, wind: false, pulse: false,
    },
  },
  field: {
    weather: 'none',
    terrain: 'none',
    isDoubles: true,
    isGravity: false,
    isWonderRoom: false,
    attackerSide: noScreens,
    defenderSide: noScreens,
    attackerAlly: null,
    defenderAlly: null,
  },
  isCritical: false,
};

/** Test double: records its name when applied and applies `fn`. */
function probe(name: string, order: number, log: string[], fn = (d: number) => d, on = true): Modifier {
  return {
    name,
    order,
    applies: () => on,
    apply: (d) => {
      log.push(name);
      return fn(d);
    },
  };
}

const chain = (name: string, order: number, mult: number): Modifier => ({
  name,
  order,
  applies: () => true,
  apply: (d) => applyChainMultiplier(d, mult),
});

describe('pokeRound', () => {
  // Definition from smogon/damage-calc calc/src/mechanics/util.ts:
  //   num % 1 > 0.5 ? Math.ceil(num) : Math.floor(num)
  // i.e. exact halves round DOWN, unlike Math.round.
  it('rounds exact .5 down', () => {
    expect(pokeRound(76.5)).toBe(76);
    expect(pokeRound(0.5)).toBe(0);
  });

  it('rounds above .5 up and below .5 down', () => {
    expect(pokeRound(76.5001)).toBe(77);
    expect(pokeRound(76.4999)).toBe(76);
  });

  it('leaves integers unchanged', () => {
    expect(pokeRound(85)).toBe(85);
    expect(pokeRound(0)).toBe(0);
  });
});

describe('applyChainMultiplier', () => {
  it('Smogon: singles STAB on 51 base gives 76 (76.5 rounds down), not 77', () => {
    // @smogon/calc 0.12.0, Gen 9 Singles, Lv50 252+ SpA Pelipper (Keen Eye)
    // Surf vs 252 HP / 0 SpD Snorlax: max roll 76. Base damage is 51
    // (SpA 161, SpD 130, BP 90), 100% roll = 51, STAB 6144/4096 -> 76.5 -> 76.
    expect(applyChainMultiplier(51, 6144)).toBe(76);
  });
});

describe('ordering', () => {
  it('DAMAGE_MODIFIERS follow the documented source order', () => {
    expect(sortModifiers(DAMAGE_MODIFIERS).map((m) => m.name)).toEqual([
      'spread', 'weather', 'critical', 'stab', 'typeEffectiveness', 'burn', 'screens',
    ]);
  });

  it('places spread, weather and crit before the roll; the rest after', () => {
    const pre = DAMAGE_MODIFIERS.filter((m) => m.order < RANDOM_ROLL_ORDER).map((m) => m.name);
    expect(pre.sort()).toEqual(['critical', 'spread', 'weather']);
  });

  it('keeps terrain out of the damage chain', () => {
    expect(DAMAGE_MODIFIERS).not.toContain(TERRAIN_BP_MODIFIER);
  });

  it('runs by `order`, not by array position', () => {
    const log: string[] = [];
    runPipeline(10, ctx, [
      probe('c', 300, log),
      probe('a', 100, log),
      probe('b', 200, log),
    ]);
    expect(log).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the caller\'s array', () => {
    const mods = [probe('b', 2, []), probe('a', 1, [])];
    runPipeline(1, ctx, mods);
    expect(mods.map((m) => m.name)).toEqual(['b', 'a']);
  });

  it('skips modifiers whose applies() is false', () => {
    const log: string[] = [];
    const out = runPipeline(10, ctx, [
      probe('on', 1, log, (d) => d + 1),
      probe('off', 2, log, (d) => d * 100, false),
    ]);
    expect(log).toEqual(['on']);
    expect(out).toBe(11);
  });

  it('feeds each modifier the previous output', () => {
    // Non-commuting steps: (10 + 1) * 2 = 22, whereas (10 * 2) + 1 = 21.
    const out = runPipeline(10, ctx, [probe('x2', 2, [], (d) => d * 2), probe('+1', 1, [], (d) => d + 1)]);
    expect(out).toBe(22);
  });

  it('rejects duplicate orders', () => {
    expect(() => sortModifiers([probe('a', 5, []), probe('b', 5, [])])).toThrow(/share order 5/);
  });

  it('rejects a modifier in the random-roll slot', () => {
    expect(() => sortModifiers([probe('a', RANDOM_ROLL_ORDER, [])])).toThrow(/reserved/);
  });

  it('runPreRoll / runPostRoll split at the roll', () => {
    const log: string[] = [];
    const mods = [probe('pre', 100, log), probe('post', 500, log)];
    runPreRoll(1, ctx, mods);
    expect(log).toEqual(['pre']);
    runPostRoll(1, ctx, mods);
    expect(log).toEqual(['pre', 'post']);
  });

  it('inert stubs leave damage unchanged', () => {
    expect(runPipeline(123, ctx)).toBe(123);
  });
});

describe('ordering + rounding against Smogon', () => {
  // Reference: @smogon/calc 0.12.0, Gen 9 Doubles, Rain, Lv50 Modest Pelipper
  // (Keen Eye, no item) Surf vs Lv50 Hardy 252 HP / 0 SpD Snorlax (Thick Fat).
  // Modifiers in play: spread 3072, rain 6144, STAB 6144. Base damage (before
  // any modifier) follows from the base formula with BP 90, SpD 130.
  const mods = [
    chain('spread', MODIFIER_ORDER.spread, 3072),
    chain('weather', MODIFIER_ORDER.weather, 6144),
    chain('stab', MODIFIER_ORDER.stab, 6144),
  ];
  const rolls = (base: number): number[] => {
    const pre = runPreRoll(base, ctx, mods);
    return Array.from({ length: 16 }, (_, i) =>
      runPostRoll(Math.floor((pre * (85 + i)) / 100), ctx, mods),
    );
  };

  it('252+ SpA (SpA 161, base 51)', () => {
    expect(rolls(51)).toEqual([72, 73, 73, 75, 75, 76, 76, 78, 79, 79, 81, 81, 82, 82, 84, 85]);
  });

  it('0 SpA (SpA 126, base 40)', () => {
    expect(rolls(40)).toEqual([57, 57, 58, 58, 60, 60, 60, 61, 61, 63, 63, 64, 64, 66, 66, 67]);
  });

  it('a different order gives different numbers (order is load-bearing)', () => {
    // STAB before spread/weather, roll last: does not match Smogon.
    const wrong = [
      chain('stab', 100, 6144),
      chain('spread', 200, 3072),
      chain('weather', 300, 6144),
    ];
    const pre = runPipeline(51, ctx, wrong);
    const out = Array.from({ length: 16 }, (_, i) => Math.floor((pre * (85 + i)) / 100));
    expect(out).not.toEqual([72, 73, 73, 75, 75, 76, 76, 78, 79, 79, 81, 81, 82, 82, 84, 85]);
  });
});
