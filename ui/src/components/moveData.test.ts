import { describe, expect, it } from 'vitest';
import { findMove, moveId, movesFor, searchMoves } from './moveData';

// Expected values are in-game facts from Bulbapedia move pages and, for the
// Champions changes, Serebii's "Updated Attacks" list
// (https://serebii.net/pokemonchampions/updatedattacks.shtml). The 2-5 hit
// default is @smogon/calc's own Move-class behaviour, not a game fact.

describe('findMove (Scarlet/Violet)', () => {
  it('reads Earthquake as a 100 BP physical Ground spread move without contact', () => {
    expect(findMove('gen9', 'Earthquake')).toEqual({
      name: 'Earthquake',
      type: 'Ground',
      basePower: 100,
      variablePower: 'none',
      category: 'Physical',
      target: 'allAdjacent',
      priority: 0,
      hits: 1,
      flags: {
        contact: false, punch: false, sound: false, slicing: false,
        bite: false, bullet: false, wind: false, pulse: false,
      },
    });
  });

  it('reads Fake Out as +3 priority, 40 BP, contact', () => {
    const move = findMove('gen9', 'Fake Out');
    expect(move?.priority).toBe(3);
    expect(move?.basePower).toBe(40);
    expect(move?.flags.contact).toBe(true);
  });

  it('reads Dazzling Gleam as a special Fairy move hitting all adjacent foes', () => {
    const move = findMove('gen9', 'Dazzling Gleam');
    expect(move).toMatchObject({ type: 'Fairy', category: 'Special', basePower: 80, target: 'allAdjacentFoes' });
  });

  it('reads Protect as a +4 priority status move', () => {
    expect(findMove('gen9', 'Protect')).toMatchObject({ category: 'Status', priority: 4, basePower: 0 });
  });

  it('reads move flags', () => {
    expect(findMove('gen9', 'Drain Punch')?.flags).toMatchObject({ punch: true, contact: true });
    expect(findMove('gen9', 'Crunch')?.flags).toMatchObject({ bite: true, contact: true });
    expect(findMove('gen9', 'Hyper Voice')?.flags.sound).toBe(true);
    expect(findMove('gen9', 'Air Slash')?.flags.slicing).toBe(true);
    expect(findMove('gen9', 'Aura Sphere')?.flags).toMatchObject({ pulse: true, bullet: true });
    expect(findMove('gen9', 'Hurricane')?.flags.wind).toBe(true);
  });

  it('reads fixed hit counts', () => {
    expect(findMove('gen9', 'Double Kick')?.hits).toBe(2);
    expect(findMove('gen9', 'Surging Strikes')?.hits).toBe(3);
    expect(findMove('gen9', 'Population Bomb')?.hits).toBe(10);
  });

  it('defaults 2-5 hit moves to 3 hits, as @smogon/calc does', () => {
    expect(findMove('gen9', 'Bullet Seed')?.hits).toBe(3);
  });

  it('tags variable-power moves', () => {
    expect(findMove('gen9', 'Low Kick')?.variablePower).toBe('targetWeight');
    expect(findMove('gen9', 'Eruption')?.variablePower).toBe('userHpRatio');
    expect(findMove('gen9', 'Acrobatics')?.variablePower).toBe('noItem');
    expect(findMove('gen9', 'Earthquake')?.variablePower).toBe('none');
  });

  it('leaves out Z-Moves and Max Moves', () => {
    expect(findMove('gen9', 'Breakneck Blitz')).toBeUndefined();
    expect(findMove('gen9', 'Max Strike')).toBeUndefined();
    expect(findMove('gen9', '(No Move)')).toBeUndefined();
  });

  it('includes Tera Blast', () => {
    expect(findMove('gen9', 'Tera Blast')).toMatchObject({ basePower: 80, category: 'Special' });
  });
});

describe('findMove (Champions)', () => {
  it('uses Champions base power where it differs from Scarlet/Violet', () => {
    // Psyshield Bash: 70 in SV, 90 in Champions. Mountain Gale: 100 -> 120.
    expect(findMove('gen9', 'Psyshield Bash')?.basePower).toBe(70);
    expect(findMove('champions', 'Psyshield Bash')?.basePower).toBe(90);
    expect(findMove('gen9', 'Mountain Gale')?.basePower).toBe(100);
    expect(findMove('champions', 'Mountain Gale')?.basePower).toBe(120);
  });

  it('treats status moves with no category in the data as Status', () => {
    expect(findMove('champions', 'Tailwind')).toMatchObject({ category: 'Status', basePower: 0 });
  });

  it('has no Tera Blast, since Champions has no Terastallization', () => {
    expect(findMove('champions', 'Tera Blast')).toBeUndefined();
  });

  it('skips entries the data leaves incomplete instead of guessing', () => {
    // Metal Claw's Champions entry has no type or base power in @smogon/calc 0.12.0.
    expect(findMove('champions', 'Metal Claw')).toBeUndefined();
  });

  it('offers a smaller roster than Scarlet/Violet', () => {
    expect(movesFor('champions').size).toBeLessThan(movesFor('gen9').size);
  });
});

describe('searchMoves', () => {
  it('ignores case and punctuation', () => {
    expect(searchMoves('gen9', 'uturn', 5).map((m) => m.name)).toContain('U-turn');
  });

  it('puts prefix matches before substring matches', () => {
    const names = searchMoves('gen9', 'fire', 100).map((m) => m.name);
    const prefix = names.indexOf('Fire Punch');
    const substring = names.indexOf('Sacred Fire');
    expect(prefix).toBeGreaterThanOrEqual(0);
    expect(substring).toBeGreaterThan(prefix);
  });

  it('respects the limit', () => {
    expect(searchMoves('champions', '', 10)).toHaveLength(10);
  });

  it('only returns moves in the allowed set of move IDs', () => {
    const allowed = new Set(['fakeout', 'uturn', 'firepunch']);
    expect(searchMoves('gen9', '', 100, allowed).map((m) => m.name)).toEqual(['Fake Out', 'Fire Punch', 'U-turn']);
    expect(searchMoves('gen9', 'fire', 100, allowed).map((m) => m.name)).toEqual(['Fire Punch']);
    expect(searchMoves('gen9', '', 100, new Set())).toEqual([]);
  });
});

describe('moveId', () => {
  // Showdown move IDs, e.g. https://play.pokemonshowdown.com/data/moves.json keys.
  it('matches Showdown IDs', () => {
    expect(moveId('U-turn')).toBe('uturn');
    expect(moveId("King's Shield")).toBe('kingsshield');
    expect(moveId('Fake Out')).toBe('fakeout');
  });
});
