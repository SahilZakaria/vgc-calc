import { describe, expect, it } from 'vitest';
import {
  editPokemon,
  effectivePokemon,
  forwardContext,
  initialState,
  isSpread,
  matchupLabel,
  reverseContext,
  runCalc,
  setManualStages,
  stageEffects,
  switchGame,
  type CalcState,
} from './appState';

// Reference rolls from @smogon/calc 0.12.0 (the repo's oracle), level 50:
// Adamant 252 Atk EV / 32 Atk SP Garchomp Earthquake vs. Hardy 252 HP EV /
// 32 HP SP Incineroar, no items, Rough Skin vs. Intimidate.
// With Incineroar's Intimidate applied (their abilityOn: true, so Garchomp is
// at -1 Atk):
//   Champions (gen 0), doubles: "102-122 (50.4 - 60.3%) -- guaranteed 2HKO"
//   Champions (gen 0), singles: "138-164 (68.3 - 81.1%) -- guaranteed 2HKO"
//   Scarlet/Violet (gen 9), doubles: same rolls as Champions doubles.
// Without it (abilityOn false, Garchomp at +0, or Garchomp with Clear Body):
//   Champions (gen 0), doubles: "152-182 (75.2 - 90%) -- guaranteed 2HKO"
//   Champions (gen 0), singles: "206-246 (101.9 - 121.7%) -- guaranteed OHKO"
// Garchomp with Defiant (Intimidate on: +1 Atk), or entered at +2 Atk with
// Intimidate on: "230-272 (113.8 - 134.6%) -- guaranteed OHKO".
// Garchomp at +2 Atk with Intimidate off: "306-362 (151.4 - 179.2%)".
// Incineroar's max HP is 202 in every case.
const REF_DOUBLES = [102, 104, 104, 108, 108, 108, 110, 110, 114, 114, 114, 116, 116, 120, 120, 122];
const REF_SINGLES = [138, 140, 140, 144, 144, 146, 150, 150, 152, 152, 156, 156, 158, 158, 162, 164];
const REF_DOUBLES_UNINTIMIDATED = [152, 156, 158, 158, 162, 162, 164, 168, 168, 170, 170, 174, 176, 176, 180, 182];
const REF_SINGLES_UNINTIMIDATED = [206, 210, 212, 216, 216, 218, 222, 224, 228, 230, 230, 234, 236, 240, 242, 246];
const REF_DOUBLES_PLUS_1 = [230, 234, 236, 240, 240, 242, 246, 248, 252, 254, 258, 260, 264, 266, 270, 272];
const REF_DOUBLES_PLUS_2 = [306, 312, 314, 318, 320, 324, 330, 332, 336, 338, 342, 348, 350, 354, 356, 362];
const REF_MAX_HP = 202;

// Incineroar at -1 Atk (Garchomp's Mirror Armor bouncing its Intimidate):
// Flare Blitz vs. 0 HP / 0 Def Garchomp, gen 0 doubles, "27-32 (14.7 - 17.4%)".
// @smogon/calc does not model Mirror Armor, so this is their result for a -1
// Atk Incineroar entered by hand with Intimidate off.
const REF_REVERSE_MINUS_1 = [27, 27, 27, 27, 28, 28, 29, 29, 29, 30, 30, 30, 30, 31, 31, 32];

// Reverse direction, same reference and sets: Hardy 0 Atk Incineroar Flare
// Blitz vs. Adamant 0 HP / 0 Def Garchomp, level 50, gen 0 and gen 9 alike.
//   doubles (and singles; single target): "39-47 (21.3 - 25.6%) -- 0.7% chance to 4HKO"
//   Reflect on Garchomp's side: "26-31 (14.2 - 16.9%)"
//   Helping Hand on Incineroar's side: "59-70 (32.2 - 38.2%)"
//   critical hit: "59-70 (32.2 - 38.2%)"
// Garchomp's max HP is 183.
const REF_REVERSE = [39, 40, 40, 41, 42, 42, 42, 42, 43, 44, 44, 45, 45, 45, 46, 47];
const REF_REVERSE_REFLECT = [26, 27, 27, 27, 28, 28, 28, 28, 29, 29, 29, 30, 30, 30, 31, 31];
const REF_REVERSE_BOOSTED = [59, 60, 60, 61, 62, 63, 63, 64, 65, 66, 66, 67, 68, 69, 69, 70];
const REF_REVERSE_MAX_HP = 183;

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
    expect(state.reverseMove.name).toBe('Flare Blitz');
    expect(state.isCritical).toBe(false);
    expect(state.reverseIsCritical).toBe(false);
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
    const outcome = runCalc(forwardContext(state));
    expect(rollsOf(outcome)).toEqual(REF_DOUBLES);
    expect(outcome.ok && outcome.result.defenderMaxHp).toBe(REF_MAX_HP);
  });

  it('matches the @smogon/calc rolls in singles', () => {
    expect(rollsOf(runCalc(forwardContext({ ...state, field: { ...state.field, isDoubles: false } })))).toEqual(REF_SINGLES);
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
    expect(rollsOf(runCalc(forwardContext(gen9)))).toEqual(REF_DOUBLES);
    expect(gen9.reverseMove.name).toBe('Flare Blitz');
    expect(rollsOf(runCalc(reverseContext(gen9)))).toEqual(REF_REVERSE);
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
    const reverseMade = { ...state, reverseMove: { ...state.reverseMove, name: 'Not A Real Move' } };
    expect(switchGame(reverseMade, 'gen9').reverseMove).toBe(reverseMade.reverseMove);
  });
});

describe('runCalc', () => {
  it('reports an error instead of throwing on an unknown nature', () => {
    const state = initialState();
    const outcome = runCalc(forwardContext({ ...state, attacker: { ...state.attacker, nature: 'Nonsense' } }));
    expect(outcome.ok).toBe(false);
  });
});

describe('forwardContext', () => {
  it('is the attacker, defender, move, field and crit flag, without the reverse fields', () => {
    const state = initialState();
    expect(forwardContext(state)).toEqual({
      game: state.game,
      attacker: { ...state.attacker, statBoosts: { ...state.attacker.statBoosts, atk: -1 } },
      defender: state.defender,
      move: state.move,
      field: state.field,
      isCritical: state.isCritical,
    });
  });
});

describe('reverseContext', () => {
  const state = initialState();

  function withSides(base: CalcState, left: Partial<CalcState['field']['attackerSide']>, right: Partial<CalcState['field']['defenderSide']>): CalcState {
    return {
      ...base,
      field: {
        ...base.field,
        attackerSide: { ...base.field.attackerSide, ...left },
        defenderSide: { ...base.field.defenderSide, ...right },
      },
    };
  }

  it("swaps the Pokemon and uses the defender's move", () => {
    const reverse = reverseContext(state);
    expect(reverse.attacker).toEqual(state.defender);
    // Still under Incineroar's Intimidate when it is the one being hit.
    expect(reverse.defender).toEqual(effectivePokemon(state, 'attacker'));
    expect(reverse.defender.statBoosts.atk).toBe(-1);
    expect(reverse.move).toBe(state.reverseMove);
    expect(matchupLabel(reverse)).toBe('Incineroar Flare Blitz vs. Garchomp');
    expect(isSpread(reverse)).toBe(false);
  });

  it('matches the @smogon/calc rolls in doubles and singles', () => {
    const outcome = runCalc(reverseContext(state));
    expect(rollsOf(outcome)).toEqual(REF_REVERSE);
    expect(outcome.ok && outcome.result.defenderMaxHp).toBe(REF_REVERSE_MAX_HP);
    expect(rollsOf(runCalc(reverseContext({ ...state, field: { ...state.field, isDoubles: false } })))).toEqual(REF_REVERSE);
  });

  it("applies Reflect on the attacker's side to the reverse hit only", () => {
    const reflected = withSides(state, { reflect: true }, {});
    expect(rollsOf(runCalc(reverseContext(reflected)))).toEqual(REF_REVERSE_REFLECT);
    expect(rollsOf(runCalc(forwardContext(reflected)))).toEqual(REF_DOUBLES);
  });

  it("applies Helping Hand on the defender's side to the reverse hit only", () => {
    const helped = withSides(state, {}, { helpingHand: true });
    expect(rollsOf(runCalc(reverseContext(helped)))).toEqual(REF_REVERSE_BOOSTED);
    expect(rollsOf(runCalc(forwardContext(helped)))).toEqual(REF_DOUBLES);
  });

  it('keeps a separate crit flag for each direction', () => {
    const reverseCrit = { ...state, reverseIsCritical: true };
    expect(rollsOf(runCalc(reverseContext(reverseCrit)))).toEqual(REF_REVERSE_BOOSTED);
    expect(rollsOf(runCalc(forwardContext(reverseCrit)))).toEqual(REF_DOUBLES);
    const forwardCrit = { ...state, isCritical: true };
    expect(rollsOf(runCalc(reverseContext(forwardCrit)))).toEqual(REF_REVERSE);
  });
});

describe('Intimidate', () => {
  const state = initialState();
  const withAbility = (base: CalcState, slot: 'attacker' | 'defender', ability: string): CalcState => ({
    ...base,
    [slot]: { ...base[slot], ability },
  });

  it("applies Incineroar's Intimidate to Garchomp automatically and says so", () => {
    expect(stageEffects(state)).toEqual([
      { slot: 'attacker', source: "Incineroar's Intimidate", cause: null, changes: { atk: -1 }, overridden: [] },
    ]);
    // The entered stage stays 0; only the effective Pokemon is at -1.
    expect(state.attacker.statBoosts.atk).toBe(0);
    expect(effectivePokemon(state, 'attacker').statBoosts.atk).toBe(-1);
    expect(rollsOf(runCalc(forwardContext(state)))).toEqual(REF_DOUBLES);
  });

  it('Ignore stops applying it; Apply brings it back', () => {
    const ignored = setManualStages(state, 'attacker', ['atk'], true);
    expect(stageEffects(ignored)[0]?.overridden).toEqual(['atk']);
    expect(rollsOf(runCalc(forwardContext(ignored)))).toEqual(REF_DOUBLES_UNINTIMIDATED);
    expect(rollsOf(runCalc(forwardContext({ ...ignored, field: { ...ignored.field, isDoubles: false } })))).toEqual(
      REF_SINGLES_UNINTIMIDATED,
    );
    const applied = setManualStages(ignored, 'attacker', ['atk'], false);
    expect(applied.manualStages.attacker).toEqual([]);
    expect(rollsOf(runCalc(forwardContext(applied)))).toEqual(REF_DOUBLES);
  });

  it('a stage picked by hand overrides it, and Apply adds it on top of that stage', () => {
    const shown = effectivePokemon(state, 'attacker');
    const picked = editPokemon(state, 'attacker', { ...shown, statBoosts: { ...shown.statBoosts, atk: 2 } });
    expect(picked.attacker.statBoosts.atk).toBe(2);
    expect(picked.manualStages.attacker).toEqual(['atk']);
    expect(rollsOf(runCalc(forwardContext(picked)))).toEqual(REF_DOUBLES_PLUS_2);
    const applied = setManualStages(picked, 'attacker', ['atk'], false);
    expect(effectivePokemon(applied, 'attacker').statBoosts.atk).toBe(1);
    expect(rollsOf(runCalc(forwardContext(applied)))).toEqual(REF_DOUBLES_PLUS_1);
  });

  it('other edits keep the automatic change out of the stored stages', () => {
    const shown = effectivePokemon(state, 'attacker');
    const edited = editPokemon(state, 'attacker', { ...shown, status: 'par' });
    expect(edited.attacker.status).toBe('par');
    expect(edited.attacker.statBoosts.atk).toBe(0);
    expect(edited.manualStages.attacker).toEqual([]);
    expect(effectivePokemon(edited, 'attacker').statBoosts.atk).toBe(-1);
  });

  it('a blocking ability shows the block and leaves the stage alone', () => {
    const blocked = withAbility(state, 'attacker', 'Clear Body');
    expect(stageEffects(blocked)).toEqual([
      { slot: 'attacker', source: "Incineroar's Intimidate", cause: 'Clear Body', changes: {}, overridden: [] },
    ]);
    expect(rollsOf(runCalc(forwardContext(blocked)))).toEqual(REF_DOUBLES_UNINTIMIDATED);
  });

  it('Defiant turns it into +1 Atk', () => {
    const defiant = withAbility(state, 'attacker', 'Defiant');
    expect(stageEffects(defiant)[0]?.changes).toEqual({ atk: 1 });
    expect(rollsOf(runCalc(forwardContext(defiant)))).toEqual(REF_DOUBLES_PLUS_1);
  });

  it('Competitive keeps the Atk drop and adds +2 SpA', () => {
    const competitive = withAbility(state, 'attacker', 'Competitive');
    expect(effectivePokemon(competitive, 'attacker').statBoosts).toMatchObject({ atk: -1, spa: 2 });
  });

  it('Mirror Armor bounces it onto Incineroar instead', () => {
    const mirror = withAbility(state, 'attacker', 'Mirror Armor');
    expect(stageEffects(mirror)).toEqual([
      { slot: 'attacker', source: "Incineroar's Intimidate", cause: 'Mirror Armor', changes: {}, overridden: [] },
      { slot: 'defender', source: "Garchomp's Mirror Armor", cause: null, changes: { atk: -1 }, overridden: [] },
    ]);
    expect(rollsOf(runCalc(forwardContext(mirror)))).toEqual(REF_DOUBLES_UNINTIMIDATED);
    expect(rollsOf(runCalc(reverseContext(mirror)))).toEqual(REF_REVERSE_MINUS_1);
  });

  it('goes away when the ability is changed or suppressed', () => {
    expect(stageEffects(withAbility(state, 'defender', 'Blaze'))).toEqual([]);
    const suppressed = { ...state, defender: { ...state.defender, abilitySuppressed: true } };
    expect(stageEffects(suppressed)).toEqual([]);
    expect(rollsOf(runCalc(forwardContext(suppressed)))).toEqual(REF_DOUBLES_UNINTIMIDATED);
  });

  it('works in both directions when both Pokemon have Intimidate', () => {
    const both = withAbility(state, 'attacker', 'Intimidate');
    expect(stageEffects(both).map((e) => e.slot)).toEqual(['defender', 'attacker']);
    expect(effectivePokemon(both, 'defender').statBoosts.atk).toBe(-1);
    expect(effectivePokemon(both, 'attacker').statBoosts.atk).toBe(-1);
  });

  it('keeps hand-set stages across a game switch', () => {
    const ignored = setManualStages(state, 'attacker', ['atk'], true);
    const gen9 = switchGame(ignored, 'gen9');
    expect(gen9.manualStages.attacker).toEqual(['atk']);
    expect(rollsOf(runCalc(forwardContext(gen9)))).toEqual(REF_DOUBLES_UNINTIMIDATED);
  });
});
