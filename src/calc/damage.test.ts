import { describe, expect, it } from 'vitest';
import { calculateBaseDamage } from './damage';

// Reference rolls come from @smogon/calc 0.12.0 (Gen 9, Singles, no crit).
// Each scenario is chosen so no modifiers apply: no STAB, neutral type
// effectiveness, no damage-affecting items/abilities/field effects. That makes
// Smogon's final rolls equal to the unmodified base-damage rolls.
describe('calculateBaseDamage', () => {
  it('Lv50 252+ Atk Garchomp Body Slam vs 252 HP / 252+ Def Amoonguss', () => {
    // Atk 200, Def 134, BP 85
    expect(calculateBaseDamage(50, 200, 134, 85)).toEqual([
      48, 49, 49, 50, 50, 51, 51, 52, 53, 53, 54, 54, 55, 55, 56, 57,
    ]);
  });

  it('Lv50 252 SpA Flutter Mane Hyper Voice vs 252 HP / 4+ SpD Incineroar', () => {
    // SpA 187, SpD 122, BP 90
    expect(calculateBaseDamage(50, 187, 122, 90)).toEqual([
      52, 53, 53, 54, 55, 55, 56, 57, 57, 58, 58, 59, 60, 60, 61, 62,
    ]);
  });

  it('Lv100 252+ Atk Tyranitar Earthquake vs 252 HP / 252+ Def Blissey', () => {
    // Atk 403, Def 130, BP 100
    expect(calculateBaseDamage(100, 403, 130, 100)).toEqual([
      222, 225, 227, 230, 233, 235, 238, 241, 243, 246, 248, 251, 254, 256, 259, 262,
    ]);
  });

  it('Lv5 0 Atk Pikachu Scratch vs 0 HP / 0 Def Rattata', () => {
    // Atk 12, Def 10, BP 40
    expect(calculateBaseDamage(5, 12, 10, 40)).toEqual([
      4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5,
    ]);
  });

  it('always returns 16 rolls', () => {
    expect(calculateBaseDamage(50, 100, 100, 80)).toHaveLength(16);
  });
});
