// The dex data behind legalData.ts loads with a dynamic import after first
// paint. Vitest gives each test file a fresh module, so here it starts out
// not loaded. The tests run in order and share that state.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Pokemon } from '../../../src/types';
import { isLegalDataReady, legalAbilities, legalItems, loadLearnset, loadLegalData } from './legalData';
import { PokemonInput } from './PokemonInput';
import { getGameData } from './pokemonInputModel';

// Garchomp with an ability it cannot have, which the loaded UI flags.
const GARCHOMP_GALE_WINGS: Pokemon = {
  species: 'Garchomp',
  level: 50,
  types: ['Dragon', 'Ground'],
  isTerastallized: false,
  baseStats: { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  nature: 'Jolly',
  ability: 'Gale Wings',
  abilitySuppressed: false,
  item: null,
  status: 'none',
  currentHp: null,
  statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  weightKg: 95,
};

const render = () =>
  renderToStaticMarkup(createElement(PokemonInput, { pokemon: GARCHOMP_GALE_WINGS, onChange: () => {}, game: 'gen9' }));

describe('legalData before and after loading', () => {
  it('returns empty results before the data loads', () => {
    expect(isLegalDataReady()).toBe(false);
    expect(legalAbilities('gen9', 'Garchomp')).toEqual([]);
    expect(legalItems('champions')).toEqual([]);
    expect(getGameData('gen9').items).toEqual([]);
  });

  it('does not flag the ability as illegal while loading', () => {
    const html = render();
    expect(html).not.toContain('not legal');
    expect(html).toContain('<option value="Gale Wings" selected="">Gale Wings</option>');
  });

  // References: Bulbapedia, Garchomp (Sand Veil; Hidden Ability Rough Skin;
  // learns Earthquake by TM in Gen 9).
  it('loads the data for loadLearnset and then fills in the lookups', async () => {
    const moves = await loadLearnset('gen9', 'Garchomp');
    expect(moves?.has('earthquake')).toBe(true);
    expect(isLegalDataReady()).toBe(true);
    expect(legalAbilities('gen9', 'Garchomp').map((a) => a.name)).toEqual(['Sand Veil', 'Rough Skin']);
    expect(getGameData('gen9').items).toContain('Choice Scarf');
    expect(render()).toContain('Gale Wings (not legal)');
  });

  it('shares one load across repeated calls', () => {
    expect(loadLegalData()).toBe(loadLegalData());
  });
});
