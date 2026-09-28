import { describe, expect, it } from 'vitest';
import type { StatTable } from '../types';
import { NATURES, calculateStats } from './stats';

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp,
  atk,
  def,
  spa,
  spd,
  spe,
});

const PERFECT_IVS = table(31, 31, 31, 31, 31, 31);

describe('calculateStats', () => {
  // Worked example from Bulbapedia's "Stat" article: level 78 Adamant Garchomp.
  it('matches the Bulbapedia level 78 Garchomp example', () => {
    const stats = calculateStats(
      table(108, 130, 95, 80, 85, 102),
      table(24, 12, 30, 16, 23, 5),
      table(74, 190, 91, 48, 84, 23),
      'Adamant',
      78,
    );
    expect(stats).toEqual(table(289, 278, 193, 135, 171, 171));
  });

  // Level 50 VGC benchmarks.
  it('gives 252 HP Incineroar 202 HP at level 50', () => {
    const stats = calculateStats(table(95, 115, 90, 80, 90, 60), PERFECT_IVS, table(252, 4, 0, 0, 0, 0), 'Careful', 50);
    expect(stats.hp).toBe(202);
  });

  it('gives Jolly 252 Atk / 252 Spe Garchomp 182 Atk and 169 Spe at level 50', () => {
    const stats = calculateStats(table(108, 130, 95, 80, 85, 102), PERFECT_IVS, table(4, 252, 0, 0, 0, 252), 'Jolly', 50);
    expect(stats.atk).toBe(182);
    expect(stats.spe).toBe(169);
  });

  it('gives Timid 252 Spe Regieleki 277 Spe at level 50', () => {
    const stats = calculateStats(table(80, 100, 50, 100, 50, 200), PERFECT_IVS, table(0, 0, 4, 252, 0, 252), 'Timid', 50);
    expect(stats.spe).toBe(277);
  });

  // Level 100 benchmarks.
  it('gives 252 HP Blissey 714 HP and Chansey 704 HP at level 100', () => {
    const evs = table(252, 0, 252, 0, 4, 0);
    expect(calculateStats(table(255, 10, 10, 75, 135, 55), PERFECT_IVS, evs, 'Bold', 100).hp).toBe(714);
    expect(calculateStats(table(250, 5, 5, 35, 105, 50), PERFECT_IVS, evs, 'Bold', 100).hp).toBe(704);
  });

  it('gives Jolly 252 Spe Garchomp 333 Spe and Deoxys-Speed 504 Spe at level 100', () => {
    const evs = table(4, 252, 0, 0, 0, 252);
    expect(calculateStats(table(108, 130, 95, 80, 85, 102), PERFECT_IVS, evs, 'Jolly', 100).spe).toBe(333);
    expect(calculateStats(table(50, 95, 90, 95, 90, 180), PERFECT_IVS, evs, 'Jolly', 100).spe).toBe(504);
  });

  it('always gives Shedinja 1 HP', () => {
    const stats = calculateStats(table(1, 90, 45, 30, 30, 40), PERFECT_IVS, table(252, 252, 0, 0, 0, 4), 'Adamant', 50);
    expect(stats.hp).toBe(1);
  });

  it('accepts nature names case-insensitively', () => {
    const base = table(108, 130, 95, 80, 85, 102);
    const evs = table(4, 252, 0, 0, 0, 252);
    expect(calculateStats(base, PERFECT_IVS, evs, 'jolly', 50)).toEqual(
      calculateStats(base, PERFECT_IVS, evs, 'Jolly', 50),
    );
  });

  it('throws on an unknown nature', () => {
    expect(() => calculateStats(PERFECT_IVS, PERFECT_IVS, PERFECT_IVS, 'Sleepy', 50)).toThrow(/Unknown nature/);
  });
});

describe('NATURES', () => {
  it('contains all 25 natures, 5 of them neutral', () => {
    const entries = Object.values(NATURES);
    expect(entries).toHaveLength(25);
    expect(entries.filter((n) => n.plus === null && n.minus === null)).toHaveLength(5);
  });

  it('covers every (plus, minus) pair of distinct non-HP stats exactly once', () => {
    const pairs = Object.values(NATURES)
      .filter((n) => n.plus !== null)
      .map((n) => `${n.plus}/${n.minus}`);
    expect(pairs).toHaveLength(20);
    expect(new Set(pairs).size).toBe(20);
  });
});
