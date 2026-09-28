import { describe, expect, it } from 'vitest';
import type { StatTable } from '../types';
import { calculateChampionsStats, spToEv, validateChampionsSpread } from './stats';

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp,
  atk,
  def,
  spa,
  spd,
  spe,
});

const ZERO_SP = table(0, 0, 0, 0, 0, 0);

// Documented closed forms for Champions (level 50, 31 IVs):
//   HP    = base + SP + 75
//   other = floor(nature * (base + SP + 20))
const closedFormHp = (base: number, sp: number): number => base + sp + 75;
const closedFormOther = (base: number, sp: number, nature: number): number =>
  Math.floor(nature * (base + sp + 20));

describe('spToEv', () => {
  it('maps 0 SP to 0 EVs', () => {
    expect(spToEv(0)).toBe(0);
  });

  it('maps n SP to 8n - 4 EVs', () => {
    expect(spToEv(1)).toBe(4);
    expect(spToEv(2)).toBe(12);
    expect(spToEv(16)).toBe(124);
  });

  it('maps 32 SP to 252 EVs', () => {
    expect(spToEv(32)).toBe(252);
  });

  it('rejects negative, fractional, and over-cap values', () => {
    expect(() => spToEv(-1)).toThrow();
    expect(() => spToEv(1.5)).toThrow();
    expect(() => spToEv(33)).toThrow();
  });
});

describe('validateChampionsSpread', () => {
  it('accepts an empty spread', () => {
    expect(validateChampionsSpread(ZERO_SP)).toEqual({ valid: true, errors: [] });
  });

  it('accepts exactly 66 total with two maxed stats', () => {
    expect(validateChampionsSpread(table(2, 32, 0, 0, 0, 32)).valid).toBe(true);
  });

  it('rejects 67 total', () => {
    const result = validateChampionsSpread(table(3, 32, 0, 0, 0, 32));
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('rejects 33 in a single stat', () => {
    const result = validateChampionsSpread(table(0, 33, 0, 0, 0, 0));
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('rejects negative and fractional values', () => {
    expect(validateChampionsSpread(table(-1, 0, 0, 0, 0, 0)).valid).toBe(false);
    expect(validateChampionsSpread(table(0, 0.5, 0, 0, 0, 0)).valid).toBe(false);
  });
});

describe('calculateChampionsStats', () => {
  // Garchomp (108/130/95/80/85/102). Level 50 values with 31 IVs from the
  // Showdown damage calculator: 4 HP EVs = 184 HP, 252 Atk Jolly = 182,
  // 252 Atk Adamant = 200, 252 Spe Jolly = 169. 1 SP = 4 EVs, 32 SP = 252 EVs.
  const GARCHOMP = table(108, 130, 95, 80, 85, 102);

  it('matches the Jolly 1/32/0/0/0/32 Garchomp benchmark', () => {
    const stats = calculateChampionsStats(GARCHOMP, table(1, 32, 0, 0, 0, 32), 'Jolly');
    expect(stats.hp).toBe(184);
    expect(stats.atk).toBe(182);
    expect(stats.spe).toBe(169);
  });

  it('matches the Adamant 32 Atk Garchomp benchmark', () => {
    expect(calculateChampionsStats(GARCHOMP, table(0, 32, 0, 0, 0, 0), 'Adamant').atk).toBe(200);
  });

  it('throws on an invalid spread', () => {
    expect(() => calculateChampionsStats(GARCHOMP, table(3, 32, 0, 0, 0, 32), 'Jolly')).toThrow();
  });

  // Exhaustive agreement with the closed forms over every base stat 1-255,
  // every SP 0-32, and all three nature multipliers.
  //
  // Base HP 1 is excluded from the HP sweep: calculateStats special-cases it
  // (Shedinja always has 1 HP), so delegation returns 1 while the closed form
  // returns 76 + SP. This disagreement is reported, not resolved here.
  it('agrees with HP = base + SP + 75 for base HP 2-255', () => {
    for (let base = 2; base <= 255; base++) {
      for (let sp = 0; sp <= 32; sp++) {
        const stats = calculateChampionsStats(table(base, 100, 100, 100, 100, 100), table(sp, 0, 0, 0, 0, 0), 'Hardy');
        expect(stats.hp, `base ${base}, SP ${sp}`).toBe(closedFormHp(base, sp));
      }
    }
  });

  it('agrees with floor(nature * (base + SP + 20)) for base 1-255', () => {
    // Adamant: +Atk, -SpA, neutral Def.
    for (let base = 1; base <= 255; base++) {
      for (let sp = 0; sp <= 32; sp++) {
        const bases = table(100, base, base, base, 100, 100);
        const stats = calculateChampionsStats(bases, table(0, sp, sp, 0, 0, 0), 'Adamant');
        const spaStats = calculateChampionsStats(bases, table(0, 0, 0, sp, 0, 0), 'Adamant');
        const label = `base ${base}, SP ${sp}`;
        expect(stats.atk, label).toBe(closedFormOther(base, sp, 1.1));
        expect(stats.def, label).toBe(closedFormOther(base, sp, 1.0));
        expect(spaStats.spa, label).toBe(closedFormOther(base, sp, 0.9));
      }
    }
  });
});
