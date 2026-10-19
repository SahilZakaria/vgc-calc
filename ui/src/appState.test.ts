import { describe, expect, it } from 'vitest';
import { initialState, isSpread, matchupLabel, runCalc, switchGame } from './appState';

// Reference rolls from @smogon/calc 0.12.0 (the repo's oracle), level 50:
// Adamant 252 Atk EV / 32 Atk SP Garchomp Earthquake vs. Hardy 252 HP EV /
// 32 HP SP Incineroar, no items, Rough Skin vs. Intimidate.
//   Champions (gen 0), doubles: "152-182 (75.2 - 90%) -- guaranteed 2HKO"
//   Champions (gen 0), singles: "206-246 (101.9 - 121.7%) -- guaranteed OHKO"
//   Scarlet/Violet (gen 9), doubles: same rolls as Champions doubles.
// Incineroar's max HP is 202 in all three.
const REF_DOUBLES = [152, 156, 158, 158, 162, 162, 164, 168, 168, 170, 170, 174, 176, 176, 180, 182];
const REF_SINGLES = [206, 210, 212, 216, 216, 218, 222, 224, 228, 230, 230, 234, 236, 240, 242, 246];
const REF_MAX_HP = 202;

function rollsOf(outcome: ReturnType<typeof runCalc>): number[] {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result.rolls;
}

describe('initialState', () => {
  const state = initialState();

  it('starts in Champions doubles with the reference matchup', () => {
    expect(state.game).toBe('champions');
    expect(state.field.isDoubles).toBe(true);
    expect(state.attacker.species).toBe('Garchomp');
    expect(state.defender.species).toBe('Incineroar');
    expect(state.move.name).toBe('Earthquake');
  });

  it('builds Champions sets: level 50, 31 IVs, 32 SP stored as 252 EVs', () => {
    expect(state.attacker.level).toBe(50);
    expect(Object.values(state.attacker.ivs).every((iv) => iv === 31)).toBe(true);
    expect(state.attacker.evs.atk).toBe(252);
    expect(state.defender.evs.hp).toBe(252);
  });

  it('takes base stats from the game data (Bulbapedia: Garchomp 108/130/95/80/85/102)', () => {
    expect(state.attacker.baseStats).toEqual({ hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 });
  });

  it('matches the @smogon/calc rolls in doubles', () => {
    const outcome = runCalc(state);
    expect(rollsOf(outcome)).toEqual(REF_DOUBLES);
    expect(outcome.ok && outcome.result.defenderMaxHp).toBe(REF_MAX_HP);
  });

  it('matches the @smogon/calc rolls in singles', () => {
    expect(rollsOf(runCalc({ ...state, field: { ...state.field, isDoubles: false } }))).toEqual(REF_SINGLES);
  });

  it('labels the matchup and flags the spread hit', () => {
    expect(matchupLabel(state)).toBe('Garchomp Earthquake vs. Incineroar');
    expect(isSpread(state)).toBe(true);
    expect(isSpread({ ...state, field: { ...state.field, isDoubles: false } })).toBe(false);
  });
});

describe('switchGame', () => {
  it('returns the same state when the game does not change', () => {
    const state = initialState();
    expect(switchGame(state, 'champions')).toBe(state);
  });

  it('to Scarlet/Violet keeps the sets and matches the gen 9 reference', () => {
    const gen9 = switchGame(initialState(), 'gen9');
    expect(gen9.game).toBe('gen9');
    expect(gen9.attacker.evs.atk).toBe(252);
    expect(gen9.move.name).toBe('Earthquake');
    expect(rollsOf(runCalc(gen9))).toEqual(REF_DOUBLES);
  });

  it('to Champions forces level 50, 31 IVs, SP-exact EVs and no Tera', () => {
    const gen9 = switchGame(initialState(), 'gen9');
    const edited = {
      ...gen9,
      attacker: {
        ...gen9.attacker,
        level: 100,
        ivs: { ...gen9.attacker.ivs, atk: 0 },
        // 250 EVs is not 8n - 4; it maps down to 31 SP = 244 EVs.
        evs: { ...gen9.attacker.evs, atk: 250 },
        isTerastallized: true,
      },
    };
    const back = switchGame(edited, 'champions');
    expect(back.attacker.level).toBe(50);
    expect(back.attacker.ivs.atk).toBe(31);
    expect(back.attacker.evs.atk).toBe(244);
    expect(back.attacker.isTerastallized).toBe(false);
  });

  it('keeps a move the new game does not have', () => {
    const state = initialState();
    const made = { ...state, move: { ...state.move, name: 'Not A Real Move' } };
    expect(switchGame(made, 'gen9').move).toBe(made.move);
  });
});

describe('runCalc', () => {
  it('reports an error instead of throwing on an unknown nature', () => {
    const state = initialState();
    const outcome = runCalc({ ...state, attacker: { ...state.attacker, nature: 'Nonsense' } });
    expect(outcome.ok).toBe(false);
  });
});
