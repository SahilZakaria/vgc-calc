import { calculate as smogonCalculate, Field as SmogonField, Move as SmogonMove } from '@smogon/calc';
import { describe, expect, it } from 'vitest';
// Test-only use of the oracle adapter; nothing in src/calc imports it.
import { smogonGeneration, toSmogonPokemon, type OracleGame } from '../oracle/smogon-adapter';
import type { Pokemon, StatTable } from '../types';
import {
  applyStageChanges,
  CLEAR_AMULET,
  INTIMIDATE_BLOCKING_ABILITIES,
  resolveIntimidate,
} from './intimidate';

// Reference: Pokemon Showdown's simulator, commit
// 7b02eb39878f4b486f658a752b38c161379bd352 (master on 2026-10-18):
// - data/abilities.ts: intimidate boosts { atk: -1 }. Clear Body, White
//   Smoke and Full Metal Body delete every negative boost from another
//   Pokemon; Hyper Cutter deletes negative atk; Inner Focus, Own Tempo,
//   Oblivious and Scrappy delete atk when the effect is Intimidate. Defiant /
//   Competitive boost { atk: 2 } / { spa: 2 } in onAfterEachBoost. Contrary
//   and Simple multiply the boost by -1 / 2 in onChangeBoost. Guard Dog
//   (onTryBoostPriority 2) swaps Intimidate's atk drop for { atk: 1 }.
//   Mirror Armor moves the drop onto the source unless its own stat is -6.
// - data/items.ts: Clear Amulet (onTryBoostPriority 1) deletes negative boosts.
// - sim/battle.ts boost(): ChangeBoost, then capping, then TryBoost in
//   priority order; AfterEachBoost runs only when the stage actually moved.
// The expected stages below are read off those rules, not off this module.

const table = (n: number): StatTable => ({ hp: n, atk: n, def: n, spa: n, spd: n, spe: n });

function mon(ability: string, opts: { item?: string; atk?: number; spa?: number; suppressed?: boolean } = {}): Pokemon {
  return {
    species: 'Incineroar',
    level: 50,
    types: ['Fire', 'Dark'],
    isTerastallized: false,
    baseStats: { hp: 95, atk: 115, def: 90, spa: 80, spd: 90, spe: 60 },
    ivs: table(31),
    evs: table(0),
    nature: 'Hardy',
    ability,
    abilitySuppressed: opts.suppressed ?? false,
    item: opts.item ?? null,
    weightKg: 83,
    currentHp: null,
    statBoosts: { atk: opts.atk ?? 0, def: 0, spa: opts.spa ?? 0, spd: 0, spe: 0 },
    status: 'none',
  };
}

const INTIMIDATOR = mon('Intimidate');

describe('resolveIntimidate: target stages', () => {
  it('does nothing without an active Intimidate', () => {
    expect(resolveIntimidate(mon('Blaze'), mon('Blaze'))).toBeNull();
    expect(resolveIntimidate(mon('Intimidate', { suppressed: true }), mon('Blaze'))).toBeNull();
  });

  it('lowers Attack by one stage', () => {
    expect(resolveIntimidate(INTIMIDATOR, mon('Blaze'))).toEqual({ target: { atk: -1 }, source: {}, cause: null });
    expect(resolveIntimidate(INTIMIDATOR, mon('Blaze', { atk: 2 }))?.target).toEqual({ atk: -1 });
  });

  it('fails at -6', () => {
    expect(resolveIntimidate(INTIMIDATOR, mon('Blaze', { atk: -6 }))?.target).toEqual({});
  });

  it.each(INTIMIDATE_BLOCKING_ABILITIES)('is blocked by %s', (ability) => {
    expect(resolveIntimidate(INTIMIDATOR, mon(ability))).toEqual({ target: {}, source: {}, cause: ability });
  });

  it('lists exactly the eight Gen 8+ blocking abilities', () => {
    expect([...INTIMIDATE_BLOCKING_ABILITIES].sort()).toEqual(
      ['Clear Body', 'Full Metal Body', 'Hyper Cutter', 'Inner Focus', 'Oblivious', 'Own Tempo', 'Scrappy', 'White Smoke'],
    );
  });

  it('is blocked by Clear Amulet', () => {
    expect(resolveIntimidate(INTIMIDATOR, mon('Blaze', { item: CLEAR_AMULET }))).toEqual({
      target: {},
      source: {},
      cause: CLEAR_AMULET,
    });
  });

  it('a blocking ability that is suppressed does not block', () => {
    expect(resolveIntimidate(INTIMIDATOR, mon('Clear Body', { suppressed: true }))?.target).toEqual({ atk: -1 });
  });

  it('Defiant: -1 then +2 Attack, a net +1', () => {
    expect(resolveIntimidate(INTIMIDATOR, mon('Defiant'))).toEqual({ target: { atk: 1 }, source: {}, cause: 'Defiant' });
    // -1 then +2 from +6: 5 then 6.
    expect(resolveIntimidate(INTIMIDATOR, mon('Defiant', { atk: 6 }))?.target).toEqual({});
    expect(resolveIntimidate(INTIMIDATOR, mon('Defiant', { atk: 5 }))?.target).toEqual({ atk: 1 });
  });

  it('Competitive: -1 Attack and +2 Special Attack', () => {
    expect(resolveIntimidate(INTIMIDATOR, mon('Competitive'))).toEqual({
      target: { atk: -1, spa: 2 },
      source: {},
      cause: 'Competitive',
    });
    expect(resolveIntimidate(INTIMIDATOR, mon('Competitive', { spa: 5 }))?.target).toEqual({ atk: -1, spa: 1 });
  });

  it('Defiant and Competitive do not trigger when the drop fails at -6', () => {
    expect(resolveIntimidate(INTIMIDATOR, mon('Defiant', { atk: -6 }))?.target).toEqual({});
    expect(resolveIntimidate(INTIMIDATOR, mon('Competitive', { atk: -6 }))?.target).toEqual({});
  });

  it('Defiant and Competitive do not trigger when the drop is blocked', () => {
    expect(resolveIntimidate(INTIMIDATOR, mon('Defiant', { item: CLEAR_AMULET }))?.target).toEqual({});
    expect(resolveIntimidate(INTIMIDATOR, mon('Competitive', { item: CLEAR_AMULET }))?.target).toEqual({});
  });

  it('Contrary and Guard Dog raise Attack by one, even through Clear Amulet', () => {
    for (const ability of ['Contrary', 'Guard Dog']) {
      expect(resolveIntimidate(INTIMIDATOR, mon(ability))?.target).toEqual({ atk: 1 });
      expect(resolveIntimidate(INTIMIDATOR, mon(ability, { item: CLEAR_AMULET }))?.target).toEqual({ atk: 1 });
    }
  });

  it('Simple lowers Attack by two', () => {
    expect(resolveIntimidate(INTIMIDATOR, mon('Simple'))?.target).toEqual({ atk: -2 });
    expect(resolveIntimidate(INTIMIDATOR, mon('Simple', { atk: -5 }))?.target).toEqual({ atk: -1 });
  });

  it('Mirror Armor bounces the drop onto the Intimidate user', () => {
    expect(resolveIntimidate(INTIMIDATOR, mon('Mirror Armor'))).toEqual({
      target: {},
      source: { atk: -1 },
      cause: 'Mirror Armor',
    });
    expect(resolveIntimidate(INTIMIDATOR, mon('Mirror Armor', { atk: -6 }))?.source).toEqual({});
    expect(resolveIntimidate(mon('Intimidate', { item: CLEAR_AMULET }), mon('Mirror Armor'))?.source).toEqual({});
  });
});

describe('applyStageChanges', () => {
  it('adds changes and clamps to -6..+6', () => {
    const boosts = { atk: -6, def: 0, spa: 5, spd: 0, spe: 0 };
    expect(applyStageChanges(boosts, { atk: -1, spa: 2 })).toEqual({ atk: -6, def: 0, spa: 6, spd: 0, spe: 0 });
    expect(boosts.atk).toBe(-6);
  });
});

// @smogon/calc 0.12.0 applies Intimidate itself when the Intimidate user has
// abilityOn set (checkIntimidate in dist/mechanics/util.js). Where its rules
// match Showdown's, our stages must match the stages it ends up with.
describe('resolveIntimidate agrees with @smogon/calc where both model the case', () => {
  const GAMES: readonly OracleGame[] = ['champions', 'gen9'];
  const AGREED: readonly { ability: string; item?: string; atk?: number }[] = [
    { ability: 'Blaze' },
    { ability: 'Blaze', atk: 3 },
    ...INTIMIDATE_BLOCKING_ABILITIES.map((ability) => ({ ability })),
    { ability: 'Blaze', item: CLEAR_AMULET },
    { ability: 'Defiant' },
    { ability: 'Competitive' },
    { ability: 'Contrary' },
    { ability: 'Guard Dog' },
    { ability: 'Simple' },
  ];

  function smogonStages(game: OracleGame, target: Pokemon): Pokemon['statBoosts'] {
    const gen = smogonGeneration(game);
    const source = toSmogonPokemon(game, INTIMIDATOR);
    source.abilityOn = true;
    const result = smogonCalculate(
      gen,
      source,
      toSmogonPokemon(game, target),
      new SmogonMove(gen, 'Flare Blitz'),
      new SmogonField({ gameType: 'Doubles' }),
    );
    const { atk, def, spa, spd, spe } = result.defender.boosts;
    return { atk, def, spa, spd, spe };
  }

  for (const game of GAMES) {
    it.each(AGREED)(`${game}: %o`, (opts) => {
      const target = mon(opts.ability, opts);
      const ours = resolveIntimidate(INTIMIDATOR, target);
      if (!ours) throw new Error('Intimidate did not resolve');
      expect(applyStageChanges(target.statBoosts, ours.target)).toEqual(smogonStages(game, target));
    });
  }

  // Recorded disagreements, where @smogon/calc departs from Showdown. Our
  // results follow Showdown; these pin down what the oracle does instead.
  it('@smogon/calc lowers a Mirror Armor target instead of bouncing the drop', () => {
    const target = mon('Mirror Armor');
    expect(smogonStages('champions', target).atk).toBe(-1);
    expect(resolveIntimidate(INTIMIDATOR, target)?.target).toEqual({});
  });

  it('@smogon/calc lets Clear Amulet stop Contrary and Guard Dog', () => {
    for (const ability of ['Contrary', 'Guard Dog']) {
      const target = mon(ability, { item: CLEAR_AMULET });
      expect(smogonStages('champions', target).atk).toBe(0);
      expect(resolveIntimidate(INTIMIDATOR, target)?.target).toEqual({ atk: 1 });
    }
  });

  it('@smogon/calc triggers Defiant even when the drop fails at -6', () => {
    const target = mon('Defiant', { atk: -6 });
    expect(smogonStages('champions', target).atk).toBe(-5);
    expect(resolveIntimidate(INTIMIDATOR, target)?.target).toEqual({});
  });
});
