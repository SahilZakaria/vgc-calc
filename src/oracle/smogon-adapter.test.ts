import { toID, type State } from '@smogon/calc';
import { describe, expect, it } from 'vitest';
import { calculateStats } from '../calc/stats';
import type { FieldState, Move, Pokemon, SideState, StatTable, TypeName } from '../types';
import {
  evToSp,
  smogonGeneration,
  toSmogonField,
  toSmogonMove,
  toSmogonPokemon,
  type OracleGame,
} from './smogon-adapter';

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp,
  atk,
  def,
  spa,
  spd,
  spe,
});

const ZERO = table(0, 0, 0, 0, 0, 0);
const PERFECT_IVS = table(31, 31, 31, 31, 31, 31);

// Champions spToEv as stated in CLAUDE.md. Duplicated here because
// src/champions does not exist yet.
const spToEv = (sp: number): number => (sp === 0 ? 0 : 8 * sp - 4);

// Builds one of our Pokemon from @smogon/calc's own dex entry, so both sides
// start from identical base stats.
function makePokemon(
  game: OracleGame,
  species: string,
  nature: string,
  evs: StatTable,
  ivs: StatTable = PERFECT_IVS,
  level = 50,
): Pokemon {
  const dex = smogonGeneration(game).species.get(toID(species));
  if (!dex) throw new Error(`${species} missing from @smogon/calc ${game} dex`);
  return {
    species: dex.name,
    level,
    types: [...dex.types] as TypeName[],
    isTerastallized: false,
    baseStats: { ...dex.baseStats },
    ivs,
    evs,
    nature,
    ability: dex.abilities?.[0] ?? '',
    abilitySuppressed: false,
    item: null,
    weightKg: dex.weightkg,
    currentHp: null,
    statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    status: 'none',
  };
}

const ourStats = (p: Pokemon): StatTable => calculateStats(p.baseStats, p.ivs, p.evs, p.nature, p.level);

describe('calculateStats agrees with @smogon/calc', () => {
  // Stat Point spreads (all legal: at most 32 per stat, at most 66 total).
  const championsSpreads: Array<[string, string, StatTable]> = [
    ['Garchomp', 'Jolly', table(2, 32, 0, 0, 0, 32)],
    ['Incineroar', 'Careful', table(32, 2, 0, 0, 32, 0)],
    ['Kingambit', 'Adamant', table(32, 32, 0, 0, 0, 2)],
    ['Gholdengo', 'Modest', table(20, 0, 10, 32, 0, 4)],
    ['Dragapult', 'Timid', table(2, 0, 0, 32, 0, 32)],
    ['Farigiraf', 'Quiet', table(32, 0, 17, 17, 0, 0)],
    ['Kangaskhan-Mega', 'Adamant', table(0, 32, 2, 0, 0, 32)],
    ['Glimmora', 'Bold', table(32, 0, 32, 0, 2, 0)],
    ['Hatterene', 'Hardy', ZERO],
    ['Metagross-Mega', 'Brave', table(32, 32, 0, 0, 2, 0)],
    ['Palafin-Hero', 'Sassy', table(11, 11, 11, 11, 11, 11)],
    ['Basculegion-F', 'Naive', table(1, 1, 1, 1, 1, 1)],
  ];

  describe.each(championsSpreads)('Champions %s (%s)', (species, nature, sp) => {
    const pokemon = makePokemon('champions', species, nature, {
      hp: spToEv(sp.hp),
      atk: spToEv(sp.atk),
      def: spToEv(sp.def),
      spa: spToEv(sp.spa),
      spd: spToEv(sp.spd),
      spe: spToEv(sp.spe),
    });
    const theirs = toSmogonPokemon('champions', pokemon);

    it('passes Stat Points, not EVs, to @smogon/calc', () => {
      expect(theirs.evs).toEqual(sp);
    });

    it('produces identical final stats', () => {
      expect(ourStats(pokemon)).toEqual(theirs.rawStats);
    });
  });

  const gen9Spreads: Array<[string, string, StatTable, StatTable, number]> = [
    ['Flutter Mane', 'Timid', table(4, 0, 0, 252, 0, 252), PERFECT_IVS, 50],
    ['Iron Hands', 'Brave', table(252, 252, 4, 0, 0, 0), table(31, 31, 31, 31, 31, 0), 50],
    ['Shedinja', 'Adamant', table(252, 252, 0, 0, 0, 4), PERFECT_IVS, 50],
    ['Chansey', 'Bold', table(252, 0, 252, 0, 4, 0), PERFECT_IVS, 100],
    ['Urshifu-Rapid-Strike', 'Jolly', table(6, 250, 1, 0, 3, 250), PERFECT_IVS, 50],
    ['Amoonguss', 'Relaxed', table(252, 0, 156, 0, 100, 0), table(31, 0, 31, 31, 31, 0), 50],
    ['Garchomp', 'Adamant', table(74, 190, 91, 48, 84, 23), table(24, 12, 30, 16, 23, 5), 78],
    ['Pikachu', 'Hardy', ZERO, ZERO, 1],
    ['Blissey', 'Calm', table(252, 0, 4, 0, 252, 0), PERFECT_IVS, 100],
    ['Torkoal', 'Quiet', table(252, 0, 4, 252, 0, 0), table(31, 31, 31, 31, 31, 0), 50],
  ];

  it.each(gen9Spreads)('Gen 9 %s (%s) produces identical final stats', (species, nature, evs, ivs, level) => {
    const pokemon = makePokemon('gen9', species, nature, evs, ivs, level);
    expect(ourStats(pokemon)).toEqual(toSmogonPokemon('gen9', pokemon).rawStats);
  });

  // Anchors that do not depend on @smogon/calc: Bulbapedia's level 78 Garchomp
  // worked example, and the well-known 182 Atk / 169 Spe of a max Jolly
  // Garchomp at level 50.
  it('matches Bulbapedia on the level 78 Garchomp example', () => {
    const pokemon = makePokemon(
      'gen9', 'Garchomp', 'Adamant', table(74, 190, 91, 48, 84, 23), table(24, 12, 30, 16, 23, 5), 78,
    );
    expect(toSmogonPokemon('gen9', pokemon).rawStats).toEqual(table(289, 278, 193, 135, 171, 171));
  });

  it('gives a 32 Atk / 32 Spe Jolly Champions Garchomp 182 Atk and 169 Spe', () => {
    const pokemon = makePokemon('champions', 'Garchomp', 'Jolly', table(0, 252, 0, 0, 0, 252));
    const { rawStats } = toSmogonPokemon('champions', pokemon);
    expect(rawStats.atk).toBe(182);
    expect(rawStats.spe).toBe(169);
  });
});

describe('evToSp', () => {
  it('inverts spToEv across the full Stat Point range', () => {
    for (let sp = 0; sp <= 32; sp++) expect(evToSp(spToEv(sp))).toBe(sp);
  });

  it.each([8, 2, 256, 260, -4])('rejects %i EVs, which no Stat Point count produces', (ev) => {
    expect(() => evToSp(ev)).toThrow();
  });
});

describe('toSmogonPokemon', () => {
  it('rejects a Champions Pokemon that is not level 50', () => {
    const pokemon = { ...makePokemon('champions', 'Garchomp', 'Jolly', ZERO), level: 100 };
    expect(() => toSmogonPokemon('champions', pokemon)).toThrow(/level 50/);
  });

  it('rejects Terastallization in Champions', () => {
    const pokemon: Pokemon = {
      ...makePokemon('champions', 'Garchomp', 'Jolly', ZERO),
      teraType: 'Steel',
      isTerastallized: true,
    };
    expect(() => toSmogonPokemon('champions', pokemon)).toThrow(/Terastallization/);
  });

  it('passes a Gen 9 Tera type only while Terastallized', () => {
    const base: Pokemon = { ...makePokemon('gen9', 'Garchomp', 'Jolly', ZERO), teraType: 'Steel' };
    expect(toSmogonPokemon('gen9', base).teraType).toBeUndefined();
    expect(toSmogonPokemon('gen9', { ...base, isTerastallized: true }).teraType).toBe('Steel');
  });

  it('carries battle state across', () => {
    const pokemon: Pokemon = {
      ...makePokemon('gen9', 'Incineroar', 'Careful', table(252, 4, 0, 0, 252, 0)),
      item: 'Sitrus Berry',
      currentHp: 100,
      status: 'brn',
      statBoosts: { atk: -1, def: 0, spa: 0, spd: 2, spe: 0 },
    };
    const theirs = toSmogonPokemon('gen9', pokemon);
    expect(theirs.item).toBe('Sitrus Berry');
    expect(theirs.curHP()).toBe(100);
    expect(theirs.status).toBe('brn');
    expect(theirs.boosts).toEqual(table(0, -1, 0, 0, 2, 0));
    expect(theirs.ability).toBe('Blaze');
  });

  it('replaces a suppressed ability with one that matches nothing', () => {
    const pokemon = { ...makePokemon('gen9', 'Incineroar', 'Careful', ZERO), abilitySuppressed: true };
    expect(toSmogonPokemon('gen9', pokemon).hasAbility('Blaze')).toBe(false);
  });

  it('uses our base stats, types and weight over their dex', () => {
    const pokemon: Pokemon = {
      ...makePokemon('gen9', 'Garchomp', 'Hardy', ZERO),
      species: 'Not A Real Species',
      types: ['Fire'],
      baseStats: table(100, 100, 100, 100, 100, 100),
      weightKg: 12.5,
    };
    const theirs = toSmogonPokemon('gen9', pokemon);
    expect(theirs.types).toEqual(['Fire']);
    expect(theirs.weightkg).toBe(12.5);
    expect(theirs.rawStats).toEqual(ourStats(pokemon));
  });
});

describe('toSmogonMove', () => {
  const move: Move = {
    name: 'Not A Real Move',
    type: 'Fire',
    basePower: 85,
    variablePower: 'none',
    category: 'Physical',
    target: 'allAdjacentFoes',
    priority: 1,
    hits: 1,
    flags: {
      contact: true,
      punch: true,
      sound: false,
      slicing: false,
      bite: false,
      bullet: false,
      wind: false,
      pulse: false,
    },
  };

  it('uses our move data over their dex', () => {
    const theirs = toSmogonMove('champions', move, { isCrit: true });
    expect(theirs.bp).toBe(85);
    expect(theirs.type).toBe('Fire');
    expect(theirs.category).toBe('Physical');
    expect(theirs.target).toBe('allAdjacentFoes');
    expect(theirs.priority).toBe(1);
    expect(theirs.isCrit).toBe(true);
    expect(theirs.flags).toEqual({
      contact: 1, punch: 1, sound: 0, slicing: 0, bite: 0, bullet: 0, wind: 0, pulse: 0,
    });
  });

  it('clears flags their dex sets but ours does not', () => {
    const theirs = toSmogonMove('gen9', { ...move, name: 'Close Combat', flags: { ...move.flags, contact: false } });
    expect(theirs.flags.contact).toBe(0);
  });

  it('maps a single target to their "normal" target', () => {
    expect(toSmogonMove('gen9', { ...move, target: 'single' }).target).toBe('normal');
  });

  it('keeps a fixed hit count', () => {
    expect(toSmogonMove('gen9', { ...move, hits: 2 }).hits).toBe(2);
  });
});

describe('toSmogonField', () => {
  const noScreens: SideState = {
    reflect: false, lightScreen: false, auroraVeil: false,
    tailwind: false, helpingHand: false, friendGuard: false, battery: false,
    powerSpot: false, steelySpirit: false, stealthRock: false, spikes: 0,
  };
  const field: FieldState = {
    weather: 'snow',
    terrain: 'psychic',
    isDoubles: true,
    isGravity: true,
    isWonderRoom: false,
    isMagicRoom: false,
    isBeadsOfRuin: false,
    isSwordOfRuin: false,
    isTabletsOfRuin: false,
    isVesselOfRuin: false,
    attackerSide: noScreens,
    defenderSide: { ...noScreens, reflect: true, auroraVeil: true },
  };

  it('maps weather, terrain, format and screens', () => {
    const theirs = toSmogonField(field);
    expect(theirs.gameType).toBe('Doubles');
    expect(theirs.weather).toBe('Snow');
    expect(theirs.terrain).toBe('Psychic');
    expect(theirs.isGravity).toBe(true);
    expect(theirs.isWonderRoom).toBe(false);
    expect(theirs.defenderSide.isReflect).toBe(true);
    expect(theirs.defenderSide.isAuroraVeil).toBe(true);
    expect(theirs.attackerSide.isReflect).toBe(false);
  });

  it('leaves weather and terrain unset when there is none', () => {
    const theirs = toSmogonField({ ...field, weather: 'none', terrain: 'none', isDoubles: false });
    expect(theirs.gameType).toBe('Singles');
    expect(theirs.weather).toBeUndefined();
    expect(theirs.terrain).toBeUndefined();
  });

  type BooleanSideFlag = { [K in keyof SideState]: SideState[K] extends boolean ? K : never }[keyof SideState];
  type TheirBooleanSideFlag = Exclude<keyof State.Side, 'spikes' | 'isSwitching'>;
  const sideFlags: Array<[BooleanSideFlag, TheirBooleanSideFlag]> = [
    ['reflect', 'isReflect'],
    ['lightScreen', 'isLightScreen'],
    ['auroraVeil', 'isAuroraVeil'],
    ['tailwind', 'isTailwind'],
    ['helpingHand', 'isHelpingHand'],
    ['friendGuard', 'isFriendGuard'],
    ['battery', 'isBattery'],
    ['powerSpot', 'isPowerSpot'],
    ['steelySpirit', 'isSteelySpirit'],
    ['stealthRock', 'isSR'],
  ];
  const theirSideFlags = sideFlags.map(([, theirs]) => theirs);

  describe.each(sideFlags)('side flag %s', (ours, theirs) => {
    it.each(['attackerSide', 'defenderSide'] as const)(`arrives as ${theirs} on the %s only`, (sideKey) => {
      const otherKey = sideKey === 'attackerSide' ? 'defenderSide' : 'attackerSide';
      const result = toSmogonField({
        ...field,
        attackerSide: noScreens,
        defenderSide: noScreens,
        [sideKey]: { ...noScreens, [ours]: true },
      });
      for (const flag of theirSideFlags) {
        expect(result[sideKey][flag], `${sideKey}.${flag}`).toBe(flag === theirs);
        expect(result[otherKey][flag], `${otherKey}.${flag}`).toBe(false);
      }
    });
  });

  it.each([1, 2, 3])('forwards %i layers of Spikes to the right side', (layers) => {
    const onDefender = toSmogonField({ ...field, defenderSide: { ...noScreens, spikes: layers } });
    expect(onDefender.defenderSide.spikes).toBe(layers);
    expect(onDefender.attackerSide.spikes).toBe(0);
    const onAttacker = toSmogonField({ ...field, attackerSide: { ...noScreens, spikes: layers } });
    expect(onAttacker.attackerSide.spikes).toBe(layers);
    expect(onAttacker.defenderSide.spikes).toBe(0);
  });

  type FieldFlag = 'isMagicRoom' | 'isBeadsOfRuin' | 'isSwordOfRuin' | 'isTabletsOfRuin' | 'isVesselOfRuin';
  const fieldFlags: FieldFlag[] = ['isMagicRoom', 'isBeadsOfRuin', 'isSwordOfRuin', 'isTabletsOfRuin', 'isVesselOfRuin'];

  it.each(fieldFlags)('forwards %s without setting the other field flags', (flag) => {
    const result = toSmogonField({ ...field, [flag]: true });
    for (const other of fieldFlags) expect(result[other], other).toBe(other === flag);
    // Unrelated flags set in the base fixture are left alone.
    expect(result.isGravity).toBe(true);
    expect(result.isWonderRoom).toBe(false);
  });
});
