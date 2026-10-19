// Static-render tests. The repo has no DOM test environment (jsdom or
// happy-dom), so these check what each game mode renders. The update rules
// behind the event handlers are tested in pokemonInputModel.test.ts.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Game, Pokemon, StatTable } from '../../../src/types';
import { PokemonInput } from './PokemonInput';

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp, atk, def, spa, spd, spe,
});

const GARCHOMP: Pokemon = {
  species: 'Garchomp',
  level: 50,
  types: ['Dragon', 'Ground'],
  teraType: 'Steel',
  isTerastallized: false,
  baseStats: table(108, 130, 95, 80, 85, 102),
  ivs: table(31, 31, 31, 31, 31, 31),
  evs: table(0, 252, 0, 0, 0, 0),
  nature: 'Adamant',
  ability: 'Rough Skin',
  abilitySuppressed: false,
  item: 'Life Orb',
  weightKg: 95,
  currentHp: null,
  statBoosts: { atk: 1, def: 0, spa: 0, spd: 0, spe: -2 },
  status: 'none',
};

const render = (game: Game, pokemon: Pokemon = GARCHOMP): string =>
  renderToStaticMarkup(<PokemonInput game={game} pokemon={pokemon} onChange={() => {}} label="Attacker" />);

const finalStat = (html: string, stat: string): string | undefined =>
  new RegExp(`data-stat="${stat}">([^<]*)<`).exec(html)?.[1];

describe('PokemonInput in Champions mode', () => {
  const html = render('champions');

  it('uses Stat Point inputs capped at 32 and shows the 66 total', () => {
    expect(html).toContain('aria-label="Atk SP"');
    expect(html).toMatch(/aria-label="Atk SP" min="0" max="32" value="32"/);
    expect(html).toContain('32 / 66 SP');
  });

  it('has no IV, level, or Tera inputs', () => {
    expect(html).not.toContain('IVs');
    expect(html).not.toContain('aria-label="Level"');
    expect(html).toContain('Level 50 (fixed in Champions)');
    expect(html).not.toContain('Tera type');
    expect(html).not.toContain('Terastallized');
  });

  // Reference: Adamant 252 Atk Garchomp at level 50 has 200 Atk (Showdown calc).
  it('shows the level 50 final stat', () => {
    expect(finalStat(html, 'atk')).toBe('200');
  });

  it('shows the level 50 stat even if the Pokemon arrives with another level', () => {
    expect(finalStat(render('champions', { ...GARCHOMP, level: 100 }), 'atk')).toBe('200');
  });
});

describe('PokemonInput in Gen 9 mode', () => {
  const html = render('gen9');

  it('uses EV inputs capped at 252 and IV inputs capped at 31', () => {
    expect(html).toMatch(/aria-label="Atk EVs" min="0" max="252" value="252"/);
    expect(html).toMatch(/aria-label="Atk IVs" min="0" max="31" value="31"/);
    expect(html).toContain('252 / 510 EVs');
  });

  it('has a level input and Tera controls', () => {
    expect(html).toMatch(/aria-label="Level" min="1" max="100" value="50"/);
    expect(html).toContain('Tera type');
    expect(html).toMatch(/<option value="Steel" selected="">Steel<\/option>/);
    expect(html).toContain('Terastallized');
  });

  // Reference: Bulbapedia's level 78 Adamant Garchomp worked example.
  it('shows final stats for the given level, EVs and IVs', () => {
    const html78 = render('gen9', {
      ...GARCHOMP,
      level: 78,
      evs: table(74, 190, 91, 48, 84, 23),
      ivs: table(24, 12, 30, 16, 23, 5),
    });
    expect(finalStat(html78, 'hp')).toBe('289');
    expect(finalStat(html78, 'atk')).toBe('278');
    expect(finalStat(html78, 'spe')).toBe('171');
  });
});

describe('PokemonInput in both modes', () => {
  it.each(['champions', 'gen9'] as const)('%s: shows species, item, types, weight and boosts', (game) => {
    const html = render(game);
    expect(html).toContain('value="Garchomp"');
    expect(html).toContain('value="Life Orb"');
    expect(html).toContain('>Dragon<');
    expect(html).toContain('>Ground<');
    expect(html).toContain('95 kg');
    expect(html).toMatch(/aria-label="Atk boost"[^>]*>(<option[^>]*>[^<]*<\/option>)*?<option value="1" selected="">\+1<\/option>/);
    expect(html).toMatch(/<option value="-2" selected="">-2<\/option>/);
    // 13 boost options per stat, five stats
    expect(html.match(/<option value="-6"/g)).toHaveLength(5);
    // HP has no boost select
    expect(html).not.toContain('aria-label="HP boost"');
  });

  it('marks the nature-raised and lowered stats', () => {
    const html = render('gen9');
    expect(html).toContain('class="pki-nature-plus"><th scope="row">Atk');
    expect(html).toContain('class="pki-nature-minus"><th scope="row">SpA');
  });

  it('lists all seven statuses', () => {
    const html = render('gen9', { ...GARCHOMP, status: 'brn' });
    expect(html).toMatch(/<option value="brn" selected="">Burned<\/option>/);
    for (const s of ['none', 'brn', 'par', 'psn', 'tox', 'slp', 'frz']) {
      expect(html).toContain(`<option value="${s}"`);
    }
  });
});
