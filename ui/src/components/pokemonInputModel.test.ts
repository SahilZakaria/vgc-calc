import { describe, expect, it } from 'vitest';
import type { Pokemon, StatTable } from '../../../src/types';
import {
  applySpecies,
  evToSp,
  filterOptions,
  finalStats,
  getGameData,
  normalizeForGame,
  setBoost,
  setIv,
  setLevel,
  setSpreadValue,
  spreadLimits,
  spreadValue,
} from './pokemonInputModel';

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp, atk, def, spa, spd, spe,
});

const blank = (overrides: Partial<Pokemon> = {}): Pokemon => ({
  species: '',
  level: 50,
  types: ['Normal'],
  isTerastallized: false,
  baseStats: table(1, 1, 1, 1, 1, 1),
  ivs: table(31, 31, 31, 31, 31, 31),
  evs: table(0, 0, 0, 0, 0, 0),
  nature: 'Hardy',
  ability: '',
  abilitySuppressed: false,
  item: null,
  weightKg: 1,
  currentHp: null,
  statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  status: 'none',
  ...overrides,
});

function species(name: string, game: 'champions' | 'gen9', base: Pokemon = blank()): Pokemon {
  const p = applySpecies(base, name, game);
  if (!p) throw new Error(`${name} missing from ${game} data`);
  return p;
}

describe('applySpecies', () => {
  // Reference: Bulbapedia. Garchomp 108/130/95/80/85/102, Dragon/Ground,
  // 95.0 kg. Incineroar 95/115/90/80/90/60, Fire/Dark, 83.0 kg.
  it.each(['champions', 'gen9'] as const)('fills Garchomp and Incineroar from %s data', (game) => {
    const chomp = species('Garchomp', game);
    expect(chomp.baseStats).toEqual(table(108, 130, 95, 80, 85, 102));
    expect(chomp.types).toEqual(['Dragon', 'Ground']);
    expect(chomp.weightKg).toBe(95);

    const roar = species('Incineroar', game);
    expect(roar.baseStats).toEqual(table(95, 115, 90, 80, 90, 60));
    expect(roar.types).toEqual(['Fire', 'Dark']);
    expect(roar.weightKg).toBe(83);
  });

  it('accepts an id-style name and returns the display name', () => {
    expect(species('garchomp', 'gen9').species).toBe('Garchomp');
  });

  it('resets HP, sets an ability, and defaults Tera to the first type', () => {
    const p = species('Incineroar', 'gen9', blank({ currentHp: 12, ability: 'Old' }));
    expect(p.currentHp).toBeNull();
    expect(p.ability).not.toBe('Old');
    expect(p.teraType).toBe('Fire');
  });

  // Reference: Bulbapedia ability slots. Incineroar: Blaze, hidden
  // Intimidate. Kingambit: Defiant, Supreme Overlord, hidden Pressure.
  it.each(['champions', 'gen9'] as const)('%s: defaults to the first legal ability', (game) => {
    expect(species('Incineroar', game, blank({ ability: 'Gale Wings' })).ability).toBe('Blaze');
    expect(species('Kingambit', game).ability).toBe('Defiant');
  });

  it('keeps an existing Tera type and the rest of the set', () => {
    const p = species('Garchomp', 'gen9', blank({ teraType: 'Steel', nature: 'Jolly', item: 'Life Orb' }));
    expect(p.teraType).toBe('Steel');
    expect(p.nature).toBe('Jolly');
    expect(p.item).toBe('Life Orb');
  });

  it('returns null for an unknown species', () => {
    expect(applySpecies(blank(), 'Not A Pokemon', 'gen9')).toBeNull();
  });
});

describe('getGameData', () => {
  it('lists all 25 natures for both games', () => {
    expect(getGameData('champions').natures).toHaveLength(25);
    expect(getGameData('gen9').natures).toHaveLength(25);
  });

  // Reference: Bulbapedia nature table.
  it('records Adamant as +Atk -SpA and Hardy as neutral', () => {
    const natures = getGameData('gen9').natures;
    expect(natures.find((n) => n.name === 'Adamant')).toEqual({ name: 'Adamant', plus: 'atk', minus: 'spa' });
    expect(natures.find((n) => n.name === 'Hardy')).toEqual({ name: 'Hardy', plus: null, minus: null });
  });

  it('uses each game\'s own item list', () => {
    // Charizardite X is a Mega Stone, and Mega Evolution is Champions'
    // gimmick; Scarlet/Violet has no Mega Stones. Booster Energy was
    // introduced in Scarlet/Violet. Z-Crystals and TRs are in neither.
    expect(getGameData('champions').items).toContain('Charizardite X');
    expect(getGameData('gen9').items).not.toContain('Charizardite X');
    expect(getGameData('gen9').items).toContain('Booster Energy');
    for (const game of ['champions', 'gen9'] as const) {
      expect(getGameData(game).items).not.toContain('Firium Z');
      expect(getGameData(game).items).not.toContain('TR00');
    }
  });
});

describe('Stat Points (Champions)', () => {
  // Reference: CLAUDE.md, spToEv(0) = 0, spToEv(n) = 8n - 4.
  it('inverts spToEv', () => {
    expect(evToSp(0)).toBe(0);
    expect(evToSp(4)).toBe(1);
    expect(evToSp(252)).toBe(32);
    for (let n = 1; n <= 32; n++) expect(evToSp(8 * n - 4)).toBe(n);
  });

  it('stores SP on the Pokemon as EVs', () => {
    const p = setSpreadValue(blank(), 'champions', 'atk', 32);
    expect(p.evs.atk).toBe(252);
    expect(spreadValue(p, 'champions', 'atk')).toBe(32);
  });

  it('caps a stat at 32 SP', () => {
    expect(spreadValue(setSpreadValue(blank(), 'champions', 'spe', 40), 'champions', 'spe')).toBe(32);
  });

  it('caps the total at 66 SP', () => {
    let p = setSpreadValue(blank(), 'champions', 'atk', 32);
    p = setSpreadValue(p, 'champions', 'spe', 32);
    p = setSpreadValue(p, 'champions', 'hp', 32);
    expect(spreadValue(p, 'champions', 'hp')).toBe(2);
    expect(spreadLimits(p, 'champions')).toMatchObject({ used: 66, total: 66, perStat: 32, unit: 'SP' });
  });

  it('normalizes to level 50, 31 IVs, no Tera, and SP-exact EVs', () => {
    const p = normalizeForGame(
      blank({ level: 78, ivs: table(0, 0, 0, 0, 0, 0), evs: table(100, 0, 0, 0, 0, 0), isTerastallized: true }),
      'champions',
    );
    expect(p.level).toBe(50);
    expect(p.ivs).toEqual(table(31, 31, 31, 31, 31, 31));
    expect(p.isTerastallized).toBe(false);
    expect(p.evs.hp).toBe(100); // 100 = 8 * 13 - 4, already exact
  });

  it('leaves Gen 9 Pokemon untouched', () => {
    const p = blank({ level: 78, isTerastallized: true });
    expect(normalizeForGame(p, 'gen9')).toBe(p);
  });
});

describe('EVs and IVs (Gen 9)', () => {
  it('caps a stat at 252 EVs and the total at 510', () => {
    let p = setSpreadValue(blank(), 'gen9', 'atk', 300);
    expect(p.evs.atk).toBe(252);
    p = setSpreadValue(p, 'gen9', 'spe', 252);
    p = setSpreadValue(p, 'gen9', 'hp', 252);
    expect(p.evs.hp).toBe(6);
  });

  it('clamps IVs to 0-31 and level to 1-100', () => {
    expect(setIv(blank(), 'atk', 40).ivs.atk).toBe(31);
    expect(setIv(blank(), 'atk', -1).ivs.atk).toBe(0);
    expect(setLevel(blank(), 0).level).toBe(1);
    expect(setLevel(blank(), 101).level).toBe(100);
  });
});

describe('setBoost', () => {
  it('clamps to -6..+6', () => {
    expect(setBoost(blank(), 'atk', 9).statBoosts.atk).toBe(6);
    expect(setBoost(blank(), 'spe', -9).statBoosts.spe).toBe(-6);
    expect(setBoost(blank(), 'def', 2).statBoosts.def).toBe(2);
  });
});

describe('finalStats', () => {
  // Reference: Showdown damage calculator values already used in
  // src/champions/stats.test.ts. Level 50, 31 IVs: Jolly 4 HP / 252 Atk /
  // 252 Spe Garchomp = 184 HP, 182 Atk, 169 Spe; Adamant 252 Atk = 200 Atk.
  it('matches the Champions Garchomp benchmarks', () => {
    let p = species('Garchomp', 'champions', blank({ nature: 'Jolly' }));
    p = setSpreadValue(p, 'champions', 'hp', 1);
    p = setSpreadValue(p, 'champions', 'atk', 32);
    p = setSpreadValue(p, 'champions', 'spe', 32);
    const stats = finalStats(p, 'champions');
    expect(stats?.hp).toBe(184);
    expect(stats?.atk).toBe(182);
    expect(stats?.spe).toBe(169);

    expect(finalStats({ ...p, nature: 'Adamant' }, 'champions')?.atk).toBe(200);
  });

  it('ignores a stray level and IVs in Champions', () => {
    const p = species('Garchomp', 'champions', blank({ nature: 'Adamant', level: 100, ivs: table(0, 0, 0, 0, 0, 0) }));
    expect(finalStats(setSpreadValue(p, 'champions', 'atk', 32), 'champions')?.atk).toBe(200);
  });

  // Reference: Bulbapedia's level 78 Adamant Garchomp worked example.
  it('matches the Bulbapedia level 78 Garchomp in Gen 9', () => {
    const p = species('Garchomp', 'gen9', blank({
      nature: 'Adamant',
      level: 78,
      evs: table(74, 190, 91, 48, 84, 23),
      ivs: table(24, 12, 30, 16, 23, 5),
    }));
    expect(finalStats(p, 'gen9')).toEqual(table(289, 278, 193, 135, 171, 171));
  });

  it('returns null for an unknown nature', () => {
    expect(finalStats(blank({ nature: '' }), 'gen9')).toBeNull();
  });
});

describe('filterOptions', () => {
  const options = ['Garchomp', 'Gardevoir', 'Mega Garchomp Fan', 'Mr. Mime', 'Tapu Koko'];

  it('puts prefix matches before substring matches', () => {
    expect(filterOptions(options, 'garch', 10)).toEqual(['Garchomp', 'Mega Garchomp Fan']);
  });

  it('ignores case and punctuation', () => {
    expect(filterOptions(options, 'mr mime', 10)).toEqual(['Mr. Mime']);
    expect(filterOptions(options, 'TAPUKOKO', 10)).toEqual(['Tapu Koko']);
  });

  it('returns the first options for an empty query and respects the limit', () => {
    expect(filterOptions(options, '', 2)).toEqual(['Garchomp', 'Gardevoir']);
    expect(filterOptions(options, 'a', 1)).toHaveLength(1);
  });
});
