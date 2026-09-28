import { describe, expect, it } from 'vitest';
import type { Pokemon } from '../types';
import { getDefensiveTypes, getTypeEffectiveness } from './type-chart';

function makePokemon(overrides: Partial<Pokemon>): Pokemon {
  return {
    species: 'Test',
    level: 100,
    types: ['Normal'],
    isTerastallized: false,
    baseStats: { hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    nature: 'Hardy',
    ability: 'None',
    abilitySuppressed: false,
    item: null,
    weightKg: 1,
    currentHp: null,
    statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    status: 'none',
    ...overrides,
  };
}

describe('getTypeEffectiveness', () => {
  it('is neutral for a same-type non-matchup (Normal vs Normal)', () => {
    expect(getTypeEffectiveness('Normal', ['Normal'])).toBe(1);
  });

  it('is super effective for Fire vs Grass/Poison (e.g. Bulbasaur)', () => {
    expect(getTypeEffectiveness('Fire', ['Grass', 'Poison'])).toBe(2);
  });

  it('is a quadruple weakness for Ice vs Dragon/Flying (e.g. Dragonite)', () => {
    expect(getTypeEffectiveness('Ice', ['Dragon', 'Flying'])).toBe(4);
  });

  it('is a quadruple weakness for Grass vs Water/Ground (e.g. Swampert)', () => {
    expect(getTypeEffectiveness('Grass', ['Water', 'Ground'])).toBe(4);
  });

  it('is a quadruple weakness for Rock vs Fire/Flying (e.g. Charizard)', () => {
    expect(getTypeEffectiveness('Rock', ['Fire', 'Flying'])).toBe(4);
  });

  it('is an immunity for Electric vs pure Ground (e.g. Diglett)', () => {
    expect(getTypeEffectiveness('Electric', ['Ground'])).toBe(0);
  });

  it('is an immunity for Normal vs pure Ghost (e.g. Gengar line)', () => {
    expect(getTypeEffectiveness('Normal', ['Ghost'])).toBe(0);
  });

  it('is an immunity for Fighting vs Ghost/Poison (e.g. Gengar)', () => {
    expect(getTypeEffectiveness('Fighting', ['Ghost', 'Poison'])).toBe(0);
  });

  it('is an immunity for Psychic vs pure Dark (e.g. Umbreon)', () => {
    expect(getTypeEffectiveness('Psychic', ['Dark'])).toBe(0);
  });

  it('is an immunity for Ground vs pure Flying (e.g. Tornadus)', () => {
    expect(getTypeEffectiveness('Ground', ['Flying'])).toBe(0);
  });

  it('is an immunity for Dragon vs pure Fairy (e.g. Clefable)', () => {
    expect(getTypeEffectiveness('Dragon', ['Fairy'])).toBe(0);
  });

  it('is super effective for Steel vs pure Fairy (e.g. Clefable)', () => {
    expect(getTypeEffectiveness('Steel', ['Fairy'])).toBe(2);
  });

  it('is not very effective for Water vs pure Water', () => {
    expect(getTypeEffectiveness('Water', ['Water'])).toBe(0.5);
  });
});

describe('getDefensiveTypes', () => {
  it('returns the original types when not terastallized', () => {
    const mon = makePokemon({ types: ['Grass', 'Poison'], isTerastallized: false });
    expect(getDefensiveTypes(mon)).toEqual(['Grass', 'Poison']);
  });

  it('returns only the tera type when terastallized', () => {
    const mon = makePokemon({
      types: ['Grass', 'Poison'],
      teraType: 'Fire',
      isTerastallized: true,
    });
    expect(getDefensiveTypes(mon)).toEqual(['Fire']);
  });

  it('changes the resulting matchup when terastallized', () => {
    const original = makePokemon({ types: ['Grass', 'Poison'], isTerastallized: false });
    const terastallized = makePokemon({
      types: ['Grass', 'Poison'],
      teraType: 'Fire',
      isTerastallized: true,
    });

    expect(getTypeEffectiveness('Fire', getDefensiveTypes(original))).toBe(2);
    expect(getTypeEffectiveness('Fire', getDefensiveTypes(terastallized))).toBe(0.5);
  });
});
