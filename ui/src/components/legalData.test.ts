import { Dex } from '@pkmn/dex';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  cachedLearnset,
  isSpeciesInGame,
  legalAbilities,
  legalItems,
  loadLearnset,
  loadLegalData,
} from './legalData';

// The dex data loads on demand; the synchronous lookups need it first.
// legalData.loading.test.ts covers the not-yet-loaded state.
beforeAll(() => loadLegalData());

const names = (game: 'champions' | 'gen9', species: string) => legalAbilities(game, species).map((a) => a.name);

describe('legalAbilities', () => {
  // Reference: Bulbapedia species pages (ability rows).
  it.each(['champions', 'gen9'] as const)('%s: lists each species\' abilities in slot order', (game) => {
    expect(legalAbilities(game, 'Garchomp')).toEqual([
      { name: 'Sand Veil', hidden: false },
      { name: 'Rough Skin', hidden: true },
    ]);
    expect(names(game, 'Incineroar')).toEqual(['Blaze', 'Intimidate']);
    expect(names(game, 'Talonflame')).toEqual(['Flame Body', 'Gale Wings']);
    expect(names(game, 'Kingambit')).toEqual(['Defiant', 'Supreme Overlord', 'Pressure']);
  });

  it('does not offer another species\' ability', () => {
    // Gale Wings is Talonflame's hidden ability; Garchomp cannot have it.
    expect(names('champions', 'Garchomp')).not.toContain('Gale Wings');
  });

  // Reference: Bulbapedia, Mega Meganium (Legends: Z-A) has Mega Sol.
  it('knows Champions Megas, which Scarlet/Violet does not have', () => {
    expect(names('champions', 'Meganium-Mega')).toEqual(['Mega Sol']);
    expect(names('gen9', 'Meganium-Mega')).toEqual([]);
  });

  it('accepts id-style names and returns nothing for unknown species', () => {
    expect(names('gen9', 'incineroar')).toEqual(['Blaze', 'Intimidate']);
    expect(legalAbilities('gen9', 'Not A Pokemon')).toEqual([]);
  });
});

describe('legalItems', () => {
  // Reference: Bulbapedia item pages. Booster Energy and Covert Cloak are new
  // in Scarlet/Violet; Mega Stones, Z-Crystals and TRs are absent from it.
  it('keeps Gen 9 to items obtainable in Scarlet/Violet', () => {
    const items = legalItems('gen9');
    expect(items).toEqual(expect.arrayContaining(['Booster Energy', 'Covert Cloak', 'Life Orb', 'Focus Sash']));
    for (const item of ['Charizardite X', 'Firium Z', 'TR00', 'Mail']) expect(items).not.toContain(item);
  });

  // Mega Evolution is Champions' gimmick, so Mega Stones are its items.
  it('includes Mega Stones and common held items in Champions, but no TRs or Z-Crystals', () => {
    const items = legalItems('champions');
    expect(items).toEqual(expect.arrayContaining(['Charizardite X', 'Focus Sash', 'Sitrus Berry', 'Life Orb']));
    for (const item of ['Firium Z', 'TR00']) expect(items).not.toContain(item);
  });

  it('is sorted by name', () => {
    const items = legalItems('champions');
    expect([...items].sort((a, b) => a.localeCompare(b))).toEqual(items);
  });
});

describe('loadLearnset', () => {
  // Reference: Bulbapedia Scarlet/Violet learnsets. Incineroar learns Fake
  // Out and Parting Shot only as egg moves (passed down from Litten), Knock
  // Off by TM. Garchomp learns Earthquake by TM and cannot learn Fake Out or
  // Brave Bird in any game. Talonflame learns Brave Bird by level-up.
  it('builds Gen 9 learnsets, including pre-evolution egg moves', async () => {
    const roar = await loadLearnset('gen9', 'Incineroar');
    expect(roar).not.toBeNull();
    for (const move of ['fakeout', 'partingshot', 'knockoff', 'flareblitz']) expect(roar?.has(move)).toBe(true);

    const chomp = await loadLearnset('gen9', 'Garchomp');
    expect(chomp?.has('earthquake')).toBe(true);
    expect(chomp?.has('fakeout')).toBe(false);
    expect(chomp?.has('bravebird')).toBe(false);

    expect((await loadLearnset('gen9', 'Talonflame'))?.has('bravebird')).toBe(true);
  });

  // Reference: Bulbapedia, Hydro Pump is Wash Rotom's form-specific move, and
  // the forme keeps Rotom's own moves such as Volt Switch.
  it.each(['champions', 'gen9'] as const)('%s: formes inherit the base forme\'s moves', async (game) => {
    const wash = await loadLearnset(game, 'Rotom-Wash');
    expect(wash?.has('hydropump')).toBe(true);
    expect(wash?.has('voltswitch')).toBe(true);
  });

  // Fake Out and Parting Shot on Incineroar, Brave Bird on Talonflame are the
  // standard Champions VGC sets. Mega Evolution does not change moves.
  it('builds Champions learnsets', async () => {
    const roar = await loadLearnset('champions', 'Incineroar');
    expect(roar?.has('fakeout')).toBe(true);
    expect(roar?.has('partingshot')).toBe(true);
    expect((await loadLearnset('champions', 'Talonflame'))?.has('bravebird')).toBe(true);

    const chomp = await loadLearnset('champions', 'Garchomp');
    expect(chomp?.has('fakeout')).toBe(false);
    expect(await loadLearnset('champions', 'Garchomp-Mega')).toEqual(chomp);
  });

  // Library behaviour, not an external fact: species that @pkmn/dex marks as
  // not obtainable in Champions get no learnset, so the Champions mod's
  // fallback to Scarlet/Violet learnsets never leaks through.
  it('returns null for species outside the game', async () => {
    const outside = Dex.forGen(9).species.all().find((s) => !s.isNonstandard && !isSpeciesInGame('champions', s.name));
    expect(outside).toBeDefined();
    if (outside) expect(await loadLearnset('champions', outside.name)).toBeNull();
    expect(await loadLearnset('gen9', 'Not A Pokemon')).toBeNull();
  });

  it('exposes finished results through cachedLearnset', async () => {
    const loaded = await loadLearnset('gen9', 'Garchomp');
    expect(cachedLearnset('gen9', 'Garchomp')).toBe(loaded);
    expect(cachedLearnset('gen9', 'Not Loaded Yet')).toBeUndefined();
  });
});
