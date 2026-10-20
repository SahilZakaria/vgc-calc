import { describe, expect, it } from 'vitest';
import type { FieldState, Game, Move, Pokemon, SideState, StatTable } from '../types';
import { actionSpeed, formatTurnOrder, movePriority, turnOrder, type TurnOrderEntry } from './turn-order';

/**
 * Expected orders follow Pokemon Showdown's rules (see turn-order.ts): sort
 * by priority, then action Speed; equal both is random. Gen 9 action Speed
 * is trunc(Trick Room ? 10000 - Speed : Speed, 13) (sim/pokemon.ts
 * getActionSpeed); the Champions mod uses -Speed under Trick Room. Speeds are
 * the level 50 values of the sets below, worked out by hand.
 */

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp,
  atk,
  def,
  spa,
  spd,
  spe,
});

const SIDE: SideState = {
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  tailwind: false,
  helpingHand: false,
  friendGuard: false,
  battery: false,
  powerSpot: false,
  steelySpirit: false,
  stealthRock: false,
  spikes: 0,
};

const FIELD: FieldState = {
  weather: 'none',
  terrain: 'none',
  isDoubles: true,
  isGravity: false,
  isWonderRoom: false,
  isMagicRoom: false,
  isBeadsOfRuin: false,
  isSwordOfRuin: false,
  isTabletsOfRuin: false,
  isVesselOfRuin: false,
  attackerSide: SIDE,
  defenderSide: SIDE,
};

const NO_FLAGS: Move['flags'] = {
  contact: false,
  punch: false,
  sound: false,
  slicing: false,
  bite: false,
  bullet: false,
  wind: false,
  pulse: false,
};

const move = (name: string, patch: Partial<Move> = {}): Move => ({
  name,
  type: 'Normal',
  basePower: 80,
  variablePower: 'none',
  category: 'Physical',
  target: 'single',
  priority: 0,
  hits: 1,
  flags: NO_FLAGS,
  ...patch,
});

/** A level 50 Pokemon with 31 IVs, no EVs, neutral nature: Speed = base + 20. */
const mon = (species: string, baseSpe: number, patch: Partial<Pokemon> = {}): Pokemon => ({
  species,
  level: 50,
  types: ['Normal'],
  isTerastallized: false,
  baseStats: table(80, 80, 80, 80, 80, baseSpe),
  ivs: table(31, 31, 31, 31, 31, 31),
  evs: table(0, 0, 0, 0, 0, 0),
  nature: 'Hardy',
  ability: '',
  abilitySuppressed: false,
  item: null,
  weightKg: 50,
  currentHp: null,
  statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  status: 'none',
  ...patch,
});

const entry = (id: string, pokemon: Pokemon, m: Move, patch: Partial<TurnOrderEntry> = {}): TurnOrderEntry => ({
  id,
  pokemon,
  move: m,
  tailwind: false,
  itemConsumed: false,
  moveHeals: false,
  ...patch,
});

const order = (entries: TurnOrderEntry[], opts: { game?: Game; trickRoom?: boolean; field?: Partial<FieldState> } = {}) =>
  turnOrder({
    game: opts.game ?? 'gen9',
    field: { ...FIELD, ...opts.field },
    isTrickRoom: opts.trickRoom ?? false,
    entries,
  });

const ids = (o: ReturnType<typeof order>) => o.moves.map((m) => m.entry.id);

// Speeds: fast 120, mid 100, slow 50 (base 100 / 80 / 30).
const fast = mon('Fast', 100);
const mid = mon('Mid', 80);
const slow = mon('Slow', 30);
const tackle = move('Tackle');
const fakeOut = move('Fake Out', { priority: 3 });

describe('turnOrder: priority, then Speed', () => {
  it('orders a bracket by Speed, fastest first', () => {
    const o = order([entry('slow', slow, tackle), entry('fast', fast, tackle), entry('mid', mid, tackle)]);
    expect(ids(o)).toEqual(['fast', 'mid', 'slow']);
    expect(o.moves.map((m) => m.speed.speed)).toEqual([120, 100, 50]);
  });

  it('puts a higher priority bracket first regardless of Speed', () => {
    const o = order([entry('fast', fast, tackle), entry('slow', slow, fakeOut)]);
    expect(ids(o)).toEqual(['slow', 'fast']);
  });

  it('Trick Room reverses Speed within a bracket but leaves priority alone', () => {
    const o = order([entry('fast', fast, tackle), entry('mid', mid, tackle), entry('slow', slow, tackle), entry('fo', fast, fakeOut)], {
      trickRoom: true,
    });
    expect(ids(o)).toEqual(['fo', 'slow', 'mid', 'fast']);
  });

  it('Tailwind doubles only its own side', () => {
    // mid 100 with Tailwind = 200, ahead of fast 120.
    const o = order([entry('fast', fast, tackle), entry('mid', mid, tackle, { tailwind: true })]);
    expect(ids(o)).toEqual(['mid', 'fast']);
    expect(o.moves[0]!.speed.speed).toBe(200);
  });

  it('Unburden with a consumed item doubles Speed', () => {
    const unburden = mon('Hawlucha', 80, { ability: 'Unburden', item: 'Grassy Seed' });
    expect(ids(order([entry('fast', fast, tackle), entry('u', unburden, tackle)]))).toEqual(['fast', 'u']);
    expect(ids(order([entry('fast', fast, tackle), entry('u', unburden, tackle, { itemConsumed: true })]))).toEqual(['u', 'fast']);
  });
});

describe('turnOrder: Speed ties', () => {
  it('marks equal Speed in the same bracket as a coin flip sharing places', () => {
    const o = order([entry('a', mid, tackle), entry('fast', fast, tackle), entry('b', mon('Mid2', 80), tackle)]);
    expect(o.moves[0]!.entry.id).toBe('fast');
    const tied = o.moves.slice(1);
    expect(tied.map((m) => [m.first, m.last])).toEqual([
      [2, 3],
      [2, 3],
    ]);
    expect(tied[0]!.tiedWith).toEqual([tied[1]!.entry.id]);
    expect(o.moves[0]!.tiedWith).toEqual([]);
  });

  it('does not tie equal Speed across different brackets', () => {
    const o = order([entry('a', mid, tackle), entry('b', mid, fakeOut)]);
    expect(o.moves.every((m) => m.tiedWith.length === 0)).toBe(true);
  });

  it('says coin flip in the text output', () => {
    const o = order([entry('a', mid, tackle), entry('b', mon('Mid2', 80), tackle)]);
    const text = formatTurnOrder(o, (id) => (id === 'a' ? 'Mid' : 'Mid2'));
    expect(text).toBe(
      [
        'Turn order:',
        '1-2. (coin flip) Mid: Tackle (100 Speed; Speed tie with Mid2: coin flip)',
        '1-2. (coin flip) Mid2: Tackle (100 Speed; Speed tie with Mid: coin flip)',
      ].join('\n'),
    );
  });
});

describe('actionSpeed: Trick Room per game', () => {
  it('Gen 9 wraps 10000 - Speed to 13 bits, so 1809+ Speed moves first under Trick Room', () => {
    // (10000 - 1809) % 8192 = 8191; (10000 - 50) % 8192 = 1758.
    expect(actionSpeed('gen9', 1809, true)).toBe(8191);
    expect(actionSpeed('gen9', 50, true)).toBe(1758);
    expect(actionSpeed('gen9', 1808, true)).toBe(0);
    expect(actionSpeed('gen9', 120, false)).toBe(120);
  });

  it('Champions has no wraparound', () => {
    expect(actionSpeed('champions', 1809, true)).toBe(-1809);
    expect(actionSpeed('champions', 50, true)).toBe(-50);
  });

  it('a 1809 Speed Pokemon moves before a slow one under Gen 9 Trick Room, but not in Champions', () => {
    // base 250, +6, Scarf: 270 * 4 = 1080 * 1.5 = 1620, Tailwind 3240 -> well above 1809.
    const blazing = mon('Blazing', 250, { item: 'Choice Scarf', statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 6 } });
    const entries = [entry('slow', slow, tackle), entry('blazing', blazing, tackle, { tailwind: true })];
    expect(ids(order(entries, { game: 'gen9', trickRoom: true }))).toEqual(['blazing', 'slow']);
    expect(ids(order(entries, { game: 'champions', trickRoom: true }))).toEqual(['slow', 'blazing']);
  });
});

describe('movePriority', () => {
  const status = move('Tailwind', { category: 'Status', type: 'Flying', basePower: 0 });

  it('Prankster adds +1 to Status moves only', () => {
    const p = mon('Whimsicott', 116, { ability: 'Prankster' });
    expect(movePriority(entry('w', p, status), FIELD).bracket).toBe(1);
    expect(movePriority(entry('w', p, tackle), FIELD).bracket).toBe(0);
    expect(movePriority(entry('w', { ...p, abilitySuppressed: true }, status), FIELD).bracket).toBe(0);
  });

  it('Gale Wings adds +1 to Flying moves at full HP only', () => {
    const brave = move('Brave Bird', { type: 'Flying' });
    const t = mon('Talonflame', 126, { ability: 'Gale Wings' });
    expect(movePriority(entry('t', t, brave), FIELD).bracket).toBe(1);
    expect(movePriority(entry('t', { ...t, currentHp: 10 }, brave), FIELD).bracket).toBe(0);
  });

  it('Triage adds +3 to healing moves', () => {
    const kiss = move('Draining Kiss', { type: 'Fairy', category: 'Special' });
    const c = mon('Comfey', 100, { ability: 'Triage' });
    expect(movePriority(entry('c', c, kiss, { moveHeals: true }), FIELD).bracket).toBe(3);
    expect(movePriority(entry('c', c, kiss), FIELD).bracket).toBe(0);
  });

  it('Grassy Glide gets +1 in Grassy Terrain when grounded', () => {
    const glide = move('Grassy Glide', { type: 'Grass' });
    const grassy = { ...FIELD, terrain: 'grassy' as const };
    const rillaboom = mon('Rillaboom', 85, { types: ['Grass'] });
    const flyer = mon('Flyer', 85, { types: ['Flying'] });
    expect(movePriority(entry('r', rillaboom, glide), grassy).bracket).toBe(1);
    expect(movePriority(entry('r', rillaboom, glide), FIELD).bracket).toBe(0);
    expect(movePriority(entry('f', flyer, glide), grassy).bracket).toBe(0);
    // Iron Ball grounds a Flying type.
    expect(movePriority(entry('f', { ...flyer, item: 'Iron Ball' }, glide), grassy).bracket).toBe(1);
  });

  it('Lagging Tail and Stall move last in their bracket, even under Trick Room', () => {
    const tail = mon('Tail', 30, { item: 'Lagging Tail' });
    expect(ids(order([entry('tail', mon('Faster', 100, { item: 'Lagging Tail' }), tackle), entry('mid', mid, tackle)]))).toEqual([
      'mid',
      'tail',
    ]);
    // Slowest under Trick Room, but Lagging Tail still puts it last.
    expect(ids(order([entry('tail', tail, tackle), entry('mid', mid, tackle)], { trickRoom: true }))).toEqual(['mid', 'tail']);
    // Moving last in +3 is still ahead of priority 0.
    expect(ids(order([entry('mid', mid, tackle), entry('tail', tail, fakeOut)]))).toEqual(['tail', 'mid']);
    const stall = mon('Sableye', 70, { ability: 'Stall' });
    expect(ids(order([entry('s', stall, tackle), entry('slow', slow, tackle)]))).toEqual(['slow', 's']);
  });

  it('notes Quick Claw instead of guessing its roll', () => {
    const o = order([entry('q', mon('Claw', 30, { item: 'Quick Claw' }), tackle), entry('fast', fast, tackle)]);
    expect(ids(o)).toEqual(['fast', 'q']);
    expect(o.moves[1]!.notes[0]).toMatch(/Quick Claw/);
  });
});

describe('overflow note', () => {
  it('explains the Gen 9 Trick Room overflow only on the 1809+ Pokemon', () => {
    const blazing = mon('Blazing', 250, { item: 'Choice Scarf', statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 6 } });
    const o = order([entry('slow', slow, tackle), entry('blazing', blazing, tackle, { tailwind: true })], { trickRoom: true });
    const lines = formatTurnOrder(o, (id) => id).split('\n');
    expect(lines[1]).toMatch(/^1\. blazing: Tackle \(3240 Speed .*Gen 9 Trick Room overflow/);
    expect(lines[2]).not.toMatch(/overflow/);
    const champions = formatTurnOrder(order(o.moves.map((m) => m.entry), { game: 'champions', trickRoom: true }), (id) => id);
    expect(champions).not.toMatch(/overflow/);
  });
});

describe('formatTurnOrder', () => {
  it('lists each move with the reason for its place', () => {
    const scarf = mon('Scarfer', 80, { item: 'Choice Scarf' });
    const o = order(
      [entry('scarf', scarf, tackle), entry('fo', slow, fakeOut), entry('mid', mid, tackle, { tailwind: true })],
      { trickRoom: true },
    );
    const names: Record<string, string> = { scarf: 'Scarfer', fo: 'Slow', mid: 'Mid' };
    expect(formatTurnOrder(o, (id) => names[id]!)).toBe(
      [
        'Turn order (Trick Room: slower moves first within each priority bracket):',
        '1. Slow: Fake Out (priority +3)',
        '2. Scarfer: Tackle (150 Speed (100, Choice Scarf 1.5x))',
        '3. Mid: Tackle (200 Speed (100, Tailwind 2x))',
      ].join('\n'),
    );
  });
});
