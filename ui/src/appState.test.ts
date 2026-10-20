import { describe, expect, it } from 'vitest';
import {
  activeSlots,
  allMatchups,
  editPokemon,
  effectivePokemon,
  fieldFor,
  foesOf,
  initialState,
  isSpread,
  matchupContext,
  matchupLabel,
  runCalc,
  setManualStages,
  stageEffects,
  switchGame,
  turnOrderFor,
  turnOrderNames,
  unburdenActive,
  updateSlot,
  type CalcState,
  type Slot,
} from './appState';

// Reference rolls from @smogon/calc 0.12.0 (the repo's oracle), level 50,
// gameType Doubles unless noted. Sets:
//   Garchomp   Adamant, 32 Atk SP (252 EVs), Rough Skin
//   Charizard  Timid, 32 SpA / 32 Spe SP, Blaze
//   Incineroar Hardy, 32 HP SP, Intimidate
//   Gardevoir  Modest, 32 HP / 32 SpA SP, Synchronize
// Incineroar's Intimidate is entered as -1 Atk on both left Pokemon.
// Champions (gen 0) and Scarlet/Violet (gen 9) give the same rolls for all of
// these:
//   -1 Garchomp Earthquake vs. Incineroar: 102-122 (50.4 - 60.3%) -- guaranteed 2HKO
//   -1 Garchomp Earthquake vs. Gardevoir: 66-78 (37.7 - 44.5%) -- guaranteed 3HKO
//   Charizard Heat Wave vs. Incineroar: 29-35 (14.3 - 17.3%) -- possible 6HKO
//   Charizard Heat Wave vs. Gardevoir: 48-57 (27.4 - 32.5%) -- guaranteed 4HKO
//   Incineroar Flare Blitz vs. Garchomp: 39-47 (21.3 - 25.6%) -- 0.7% chance to 4HKO
//   Incineroar Flare Blitz vs. Charizard: 46-55 (30 - 35.9%) -- 45.3% chance to 3HKO
//   Gardevoir Dazzling Gleam vs. Garchomp: 126-150 (68.8 - 81.9%) -- guaranteed 2HKO
//   Gardevoir Dazzling Gleam vs. Charizard: 31-37 (20.2 - 24.1%) -- guaranteed 5HKO
const REF = {
  'left1>right1': [102, 104, 104, 108, 108, 108, 110, 110, 114, 114, 114, 116, 116, 120, 120, 122],
  'left1>right2': [66, 66, 67, 67, 69, 69, 70, 70, 72, 72, 73, 73, 75, 75, 76, 78],
  'left2>right1': [29, 30, 30, 30, 30, 31, 31, 32, 32, 33, 33, 33, 33, 34, 34, 35],
  'left2>right2': [48, 48, 49, 49, 49, 51, 51, 51, 52, 52, 54, 54, 54, 55, 55, 57],
  'right1>left1': [39, 40, 40, 41, 42, 42, 42, 42, 43, 44, 44, 45, 45, 45, 46, 47],
  'right1>left2': [46, 47, 48, 48, 48, 49, 50, 51, 51, 51, 52, 53, 53, 54, 54, 55],
  'right2>left1': [126, 128, 128, 132, 132, 134, 134, 138, 138, 140, 140, 144, 144, 146, 146, 150],
  'right2>left2': [31, 32, 32, 33, 33, 33, 33, 34, 34, 35, 35, 36, 36, 36, 36, 37],
} as const;
const MAX_HP: Record<Slot, number> = { left1: 183, left2: 153, right1: 202, right2: 175 };

// Same reference, other cases (gen 0):
//   singles, -1 Garchomp Earthquake vs. Incineroar: 138-164 (68.3 - 81.1%)
//   singles, +0 Charizard Heat Wave vs. Gardevoir: 64-76 (36.5 - 43.4%)
//   -2 Garchomp Earthquake vs. Incineroar: 78-92 (38.6 - 45.5%)
//   -1 Charizard Flare Blitz vs. Gardevoir: 51-60 (29.1 - 34.2%)
//   +0 Charizard Flare Blitz vs. Gardevoir: 75-88 (42.8 - 50.2%)
//   Helping Hand Gardevoir Dazzling Gleam vs. -1 Garchomp: 186-222 (101.6 - 121.3%)
//   Incineroar Flare Blitz vs. Garchomp through Reflect: 26-31 (14.2 - 16.9%)
const REF_SINGLES_EQ = [138, 140, 140, 144, 144, 146, 150, 150, 152, 152, 156, 156, 158, 158, 162, 164];
const REF_SINGLES_HEAT_WAVE = [64, 64, 66, 66, 67, 67, 69, 69, 70, 70, 72, 72, 73, 73, 75, 76];
const REF_EQ_MINUS_2 = [78, 78, 78, 80, 80, 80, 84, 84, 84, 86, 86, 86, 90, 90, 90, 92];
const REF_ZARD_FLARE_BLITZ_MINUS_1 = [51, 51, 51, 52, 52, 54, 54, 54, 55, 55, 57, 57, 57, 58, 58, 60];
const REF_ZARD_FLARE_BLITZ = [75, 75, 76, 76, 78, 79, 79, 81, 81, 82, 84, 84, 85, 85, 87, 88];
const REF_GLEAM_HELPING_HAND = [186, 188, 192, 194, 194, 198, 200, 204, 204, 206, 210, 212, 212, 216, 218, 222];
const REF_FLARE_BLITZ_REFLECT = [26, 27, 27, 27, 28, 28, 28, 28, 29, 29, 29, 30, 30, 30, 31, 31];

// From the repo's earlier two-Pokemon references (same oracle and sets):
//   +0 Garchomp Earthquake vs. Incineroar, doubles: 152-182 (75.2 - 90%)
//   +1 Garchomp Earthquake vs. Incineroar, doubles: 230-272 (113.8 - 134.6%)
//   +2 Garchomp Earthquake vs. Incineroar, doubles: 306-362 (151.4 - 179.2%)
//   -1 Incineroar Flare Blitz vs. Garchomp: 27-32 (14.7 - 17.4%)
//   critical Incineroar Flare Blitz vs. Garchomp: 59-70 (32.2 - 38.2%)
const REF_EQ_UNINTIMIDATED = [152, 156, 158, 158, 162, 162, 164, 168, 168, 170, 170, 174, 176, 176, 180, 182];
const REF_EQ_PLUS_1 = [230, 234, 236, 240, 240, 242, 246, 248, 252, 254, 258, 260, 264, 266, 270, 272];
const REF_EQ_PLUS_2 = [306, 312, 314, 318, 320, 324, 330, 332, 336, 338, 342, 348, 350, 354, 356, 362];
const REF_FLARE_BLITZ_MINUS_1 = [27, 27, 27, 27, 28, 28, 29, 29, 29, 30, 30, 30, 30, 31, 31, 32];
const REF_FLARE_BLITZ_CRIT = [59, 60, 60, 61, 62, 63, 63, 64, 65, 66, 66, 67, 68, 69, 69, 70];

function rolls(state: CalcState, attacker: Slot, defender: Slot): number[] {
  const outcome = runCalc(matchupContext(state, attacker, defender));
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.result.rolls;
}

const singles = (state: CalcState): CalcState => ({ ...state, field: { ...state.field, isDoubles: false } });

const withAbility = (state: CalcState, slot: Slot, ability: string): CalcState => ({
  ...state,
  slots: { ...state.slots, [slot]: { ...state.slots[slot], pokemon: { ...state.slots[slot].pokemon, ability } } },
});

describe('initialState', () => {
  const state = initialState();

  it('starts in Champions doubles with two Pokemon a side, each with one move', () => {
    expect(state.game).toBe('champions');
    expect(state.field.isDoubles).toBe(true);
    const names = (slot: Slot) => [state.slots[slot].pokemon.species, state.slots[slot].move.name];
    expect(names('left1')).toEqual(['Garchomp', 'Earthquake']);
    expect(names('left2')).toEqual(['Charizard', 'Heat Wave']);
    expect(names('right1')).toEqual(['Incineroar', 'Flare Blitz']);
    expect(names('right2')).toEqual(['Gardevoir', 'Dazzling Gleam']);
    expect(Object.values(state.slots).every((s) => !s.isCritical && s.manualStages.length === 0)).toBe(true);
  });

  it('builds Champions sets: level 50, 31 IVs, 32 SP stored as 252 EVs', () => {
    const chomp = state.slots.left1.pokemon;
    expect(chomp.level).toBe(50);
    expect(Object.values(chomp.ivs).every((iv) => iv === 31)).toBe(true);
    expect(chomp.evs.atk).toBe(252);
    expect(state.slots.right1.pokemon.evs.hp).toBe(252);
  });

  it('takes base stats from the game data (Bulbapedia: Garchomp 108/130/95/80/85/102)', () => {
    expect(state.slots.left1.pokemon.baseStats).toEqual({ hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 });
  });
});

describe('field layout', () => {
  it('uses all four slots in doubles and only the first of each side in singles', () => {
    const state = initialState();
    expect(activeSlots(state)).toEqual(['left1', 'left2', 'right1', 'right2']);
    expect(foesOf(state, 'left2')).toEqual(['right1', 'right2']);
    expect(foesOf(state, 'right1')).toEqual(['left1', 'left2']);
    expect(activeSlots(singles(state))).toEqual(['left1', 'right1']);
    expect(foesOf(singles(state), 'left1')).toEqual(['right1']);
  });

  it('keeps the field as is for left attackers and swaps the sides for right attackers', () => {
    const field = { ...initialState().field, attackerSide: { ...initialState().field.attackerSide, reflect: true } };
    expect(fieldFor(field, 'left')).toBe(field);
    expect(fieldFor(field, 'right').defenderSide.reflect).toBe(true);
    expect(fieldFor(field, 'right').attackerSide.reflect).toBe(false);
  });
});

describe('allMatchups', () => {
  const state = initialState();
  const matchups = allMatchups(state);

  it('has every attacker into every opposing defender: four hits from each side', () => {
    const keys = (side: 'left' | 'right') => matchups[side].map((m) => `${m.attacker}>${m.defender}`);
    expect(keys('left')).toEqual(['left1>right1', 'left1>right2', 'left2>right1', 'left2>right2']);
    expect(keys('right')).toEqual(['right1>left1', 'right1>left2', 'right2>left1', 'right2>left2']);
  });

  it('matches the @smogon/calc rolls and max HP for all eight hits', () => {
    for (const m of [...matchups.left, ...matchups.right]) {
      const key = `${m.attacker}>${m.defender}` as keyof typeof REF;
      if (!m.outcome.ok) throw new Error(m.outcome.error);
      expect(m.outcome.result.rolls, key).toEqual(REF[key]);
      expect(m.outcome.result.defenderMaxHp, key).toBe(MAX_HP[m.defender]);
    }
  });

  it('has one hit a side in singles, without spread reduction', () => {
    const one = allMatchups(singles(state));
    expect(one.left.map((m) => m.defender)).toEqual(['right1']);
    expect(one.right.map((m) => m.defender)).toEqual(['left1']);
    expect(one.left[0]?.outcome.ok && one.left[0].outcome.result.rolls).toEqual(REF_SINGLES_EQ);
  });
});

describe('spread moves', () => {
  const state = initialState();

  it('apply the 0.75x reduction against both foes in doubles', () => {
    // Heat Wave (allAdjacentFoes) and Earthquake (allAdjacent) are both spread.
    expect(isSpread(matchupContext(state, 'left2', 'right1'))).toBe(true);
    expect(isSpread(matchupContext(state, 'left2', 'right2'))).toBe(true);
    expect(isSpread(matchupContext(state, 'left1', 'right2'))).toBe(true);
    expect(isSpread(matchupContext(state, 'right1', 'left1'))).toBe(false);
    expect(rolls(state, 'left2', 'right1')).toEqual(REF['left2>right1']);
    expect(rolls(state, 'left2', 'right2')).toEqual(REF['left2>right2']);
  });

  it('do not get the reduction in singles', () => {
    const one = singles(state);
    expect(isSpread(matchupContext(one, 'left1', 'right1'))).toBe(false);
    expect(rolls(one, 'left1', 'right1')).toEqual(REF_SINGLES_EQ);
    // Charizard's Heat Wave into Gardevoir, with those two as the singles pair.
    const zardVsGarde: CalcState = { ...one, slots: { ...one.slots, left1: one.slots.left2, right1: one.slots.right2 } };
    expect(isSpread(matchupContext(zardVsGarde, 'left1', 'right1'))).toBe(false);
    expect(rolls(zardVsGarde, 'left1', 'right1')).toEqual(REF_SINGLES_HEAT_WAVE);
  });
});

describe('matchupContext', () => {
  const state = initialState();

  it("uses the attacker's own move and crit flag", () => {
    const ctx = matchupContext(state, 'right2', 'left1');
    expect(ctx.move).toBe(state.slots.right2.move);
    expect(ctx.attacker).toEqual(state.slots.right2.pokemon);
    expect(matchupLabel(ctx)).toBe('Gardevoir Dazzling Gleam vs. Garchomp');
    const crit = updateSlot(state, 'right1', { isCritical: true });
    expect(rolls(crit, 'right1', 'left1')).toEqual(REF_FLARE_BLITZ_CRIT);
    // Only that Pokemon's hits crit.
    expect(rolls(crit, 'right2', 'left1')).toEqual(REF['right2>left1']);
    expect(rolls(crit, 'left1', 'right1')).toEqual(REF['left1>right1']);
  });

  it("applies the left side's Reflect only to hits on the left side", () => {
    const reflected = { ...state, field: { ...state.field, attackerSide: { ...state.field.attackerSide, reflect: true } } };
    expect(rolls(reflected, 'right1', 'left1')).toEqual(REF_FLARE_BLITZ_REFLECT);
    expect(rolls(reflected, 'left1', 'right1')).toEqual(REF['left1>right1']);
  });

  it("applies the right side's Helping Hand to both right attackers and no left attacker", () => {
    const helped = { ...state, field: { ...state.field, defenderSide: { ...state.field.defenderSide, helpingHand: true } } };
    expect(rolls(helped, 'right2', 'left1')).toEqual(REF_GLEAM_HELPING_HAND);
    expect(rolls(helped, 'right1', 'left1')).toEqual(REF_FLARE_BLITZ_CRIT); // 1.5x, same rolls as the crit
    expect(rolls(helped, 'left1', 'right1')).toEqual(REF['left1>right1']);
  });

  it('reports an error instead of throwing on an unknown nature', () => {
    const bad = editPokemon(state, 'left1', { ...effectivePokemon(state, 'left1'), nature: 'Nonsense' });
    expect(runCalc(matchupContext(bad, 'left1', 'right1')).ok).toBe(false);
  });
});

describe('switchGame', () => {
  it('returns the same state when the game does not change', () => {
    const state = initialState();
    expect(switchGame(state, 'champions')).toBe(state);
  });

  it('to Scarlet/Violet keeps every set and move and matches the gen 9 reference', () => {
    const gen9 = switchGame(initialState(), 'gen9');
    expect(gen9.game).toBe('gen9');
    expect(gen9.slots.left1.pokemon.evs.atk).toBe(252);
    expect(gen9.slots.right2.move.name).toBe('Dazzling Gleam');
    for (const m of [...allMatchups(gen9).left, ...allMatchups(gen9).right]) {
      const key = `${m.attacker}>${m.defender}` as keyof typeof REF;
      expect(m.outcome.ok && m.outcome.result.rolls, key).toEqual(REF[key]);
    }
  });

  it('to Champions forces level 50, 31 IVs, SP-exact EVs and no Tera on every slot', () => {
    const gen9 = switchGame(initialState(), 'gen9');
    const chomp = gen9.slots.left2.pokemon;
    const edited: CalcState = {
      ...gen9,
      slots: {
        ...gen9.slots,
        left2: {
          ...gen9.slots.left2,
          // 250 EVs is not 8n - 4; it maps down to 31 SP = 244 EVs.
          pokemon: { ...chomp, level: 100, ivs: { ...chomp.ivs, atk: 0 }, evs: { ...chomp.evs, spa: 250 }, isTerastallized: true },
        },
      },
    };
    const back = switchGame(edited, 'champions').slots.left2.pokemon;
    expect(back.level).toBe(50);
    expect(back.ivs.atk).toBe(31);
    expect(back.evs.spa).toBe(244);
    expect(back.isTerastallized).toBe(false);
  });

  it('keeps a move the new game does not have', () => {
    const state = initialState();
    const made = updateSlot(state, 'right2', { move: { ...state.slots.right2.move, name: 'Not A Real Move' } });
    expect(switchGame(made, 'gen9').slots.right2.move).toBe(made.slots.right2.move);
  });
});

describe('Intimidate', () => {
  const state = initialState();

  it("applies Incineroar's Intimidate to both opposing Pokemon and says so", () => {
    expect(stageEffects(state)).toEqual([
      { slot: 'left1', source: "Incineroar's Intimidate", cause: null, changes: { atk: -1 }, overridden: [] },
      { slot: 'left2', source: "Incineroar's Intimidate", cause: null, changes: { atk: -1 }, overridden: [] },
    ]);
    expect(effectivePokemon(state, 'left1').statBoosts.atk).toBe(-1);
    expect(effectivePokemon(state, 'left2').statBoosts.atk).toBe(-1);
    // Not its own ally.
    expect(effectivePokemon(state, 'right2').statBoosts.atk).toBe(0);
    // The entered stages stay 0.
    expect(state.slots.left1.pokemon.statBoosts.atk).toBe(0);
    expect(state.slots.left2.pokemon.statBoosts.atk).toBe(0);
  });

  it("lowers the second Pokemon's physical damage too", () => {
    const flareBlitz = { ...state.slots.right1.move };
    const physical = updateSlot(state, 'left2', { move: flareBlitz });
    expect(rolls(physical, 'left2', 'right2')).toEqual(REF_ZARD_FLARE_BLITZ_MINUS_1);
    const ignored = setManualStages(physical, 'left2', ['atk'], true);
    expect(rolls(ignored, 'left2', 'right2')).toEqual(REF_ZARD_FLARE_BLITZ);
    // Ignoring it on one Pokemon leaves it on the other.
    expect(rolls(ignored, 'left1', 'right1')).toEqual(REF['left1>right1']);
  });

  it('only hits the one opposing Pokemon in singles', () => {
    expect(stageEffects(singles(state)).map((e) => e.slot)).toEqual(['left1']);
    expect(effectivePokemon(singles(state), 'left2').statBoosts.atk).toBe(0);
  });

  it('stacks when both opposing Pokemon have it', () => {
    const two = withAbility(state, 'right2', 'Intimidate');
    expect(stageEffects(two).map((e) => [e.slot, e.source])).toEqual([
      ['left1', "Incineroar's Intimidate"],
      ['left2', "Incineroar's Intimidate"],
      ['left1', "Gardevoir's Intimidate"],
      ['left2', "Gardevoir's Intimidate"],
    ]);
    expect(effectivePokemon(two, 'left1').statBoosts.atk).toBe(-2);
    expect(rolls(two, 'left1', 'right1')).toEqual(REF_EQ_MINUS_2);
  });

  it('Ignore stops applying it; Apply brings it back', () => {
    const ignored = setManualStages(state, 'left1', ['atk'], true);
    expect(stageEffects(ignored)[0]?.overridden).toEqual(['atk']);
    expect(rolls(ignored, 'left1', 'right1')).toEqual(REF_EQ_UNINTIMIDATED);
    const applied = setManualStages(ignored, 'left1', ['atk'], false);
    expect(applied.slots.left1.manualStages).toEqual([]);
    expect(rolls(applied, 'left1', 'right1')).toEqual(REF['left1>right1']);
  });

  it('a stage picked by hand overrides it, and Apply adds it on top of that stage', () => {
    const shown = effectivePokemon(state, 'left1');
    const picked = editPokemon(state, 'left1', { ...shown, statBoosts: { ...shown.statBoosts, atk: 2 } });
    expect(picked.slots.left1.pokemon.statBoosts.atk).toBe(2);
    expect(picked.slots.left1.manualStages).toEqual(['atk']);
    expect(rolls(picked, 'left1', 'right1')).toEqual(REF_EQ_PLUS_2);
    const applied = setManualStages(picked, 'left1', ['atk'], false);
    expect(effectivePokemon(applied, 'left1').statBoosts.atk).toBe(1);
    expect(rolls(applied, 'left1', 'right1')).toEqual(REF_EQ_PLUS_1);
  });

  it('other edits keep the automatic change out of the stored stages', () => {
    const shown = effectivePokemon(state, 'left1');
    const edited = editPokemon(state, 'left1', { ...shown, status: 'par' });
    expect(edited.slots.left1.pokemon.status).toBe('par');
    expect(edited.slots.left1.pokemon.statBoosts.atk).toBe(0);
    expect(edited.slots.left1.manualStages).toEqual([]);
    expect(effectivePokemon(edited, 'left1').statBoosts.atk).toBe(-1);
  });

  it('a blocking ability shows the block on that Pokemon only', () => {
    const blocked = withAbility(state, 'left1', 'Clear Body');
    expect(stageEffects(blocked)).toEqual([
      { slot: 'left1', source: "Incineroar's Intimidate", cause: 'Clear Body', changes: {}, overridden: [] },
      { slot: 'left2', source: "Incineroar's Intimidate", cause: null, changes: { atk: -1 }, overridden: [] },
    ]);
    expect(rolls(blocked, 'left1', 'right1')).toEqual(REF_EQ_UNINTIMIDATED);
  });

  it('Defiant turns it into +1 Atk', () => {
    const defiant = withAbility(state, 'left1', 'Defiant');
    expect(stageEffects(defiant)[0]?.changes).toEqual({ atk: 1 });
    expect(rolls(defiant, 'left1', 'right1')).toEqual(REF_EQ_PLUS_1);
  });

  it('Competitive keeps the Atk drop and adds +2 SpA', () => {
    const competitive = withAbility(state, 'left2', 'Competitive');
    expect(effectivePokemon(competitive, 'left2').statBoosts).toMatchObject({ atk: -1, spa: 2 });
  });

  it('Mirror Armor bounces it onto Incineroar instead', () => {
    const mirror = withAbility(state, 'left1', 'Mirror Armor');
    expect(stageEffects(mirror).slice(0, 2)).toEqual([
      { slot: 'left1', source: "Incineroar's Intimidate", cause: 'Mirror Armor', changes: {}, overridden: [] },
      { slot: 'right1', source: "Garchomp's Mirror Armor", cause: null, changes: { atk: -1 }, overridden: [] },
    ]);
    expect(rolls(mirror, 'left1', 'right1')).toEqual(REF_EQ_UNINTIMIDATED);
    expect(rolls(mirror, 'right1', 'left1')).toEqual(REF_FLARE_BLITZ_MINUS_1);
  });

  it('goes away when the ability is changed or suppressed', () => {
    expect(stageEffects(withAbility(state, 'right1', 'Blaze'))).toEqual([]);
    const right1 = state.slots.right1;
    const suppressed: CalcState = {
      ...state,
      slots: { ...state.slots, right1: { ...right1, pokemon: { ...right1.pokemon, abilitySuppressed: true } } },
    };
    expect(stageEffects(suppressed)).toEqual([]);
    expect(rolls(suppressed, 'left1', 'right1')).toEqual(REF_EQ_UNINTIMIDATED);
  });

  it('works from both sides when each side has an Intimidate user', () => {
    const both = withAbility(state, 'left1', 'Intimidate');
    expect(stageEffects(both).map((e) => e.slot)).toEqual(['right1', 'right2', 'left1', 'left2']);
    expect(effectivePokemon(both, 'right1').statBoosts.atk).toBe(-1);
    expect(effectivePokemon(both, 'right2').statBoosts.atk).toBe(-1);
    expect(effectivePokemon(both, 'left1').statBoosts.atk).toBe(-1);
  });

  it('keeps hand-set stages across a game switch', () => {
    const ignored = setManualStages(state, 'left1', ['atk'], true);
    const gen9 = switchGame(ignored, 'gen9');
    expect(gen9.slots.left1.manualStages).toEqual(['atk']);
    expect(rolls(gen9, 'left1', 'right1')).toEqual(REF_EQ_UNINTIMIDATED);
  });
});

// Speeds of the starting sets at level 50: base + 20 with 0 SP, and Timid
// 32 SP Charizard is floor((floor((200 + 31 + 63) / 2) + 5) * 1.1) = 167.
describe('turnOrderFor', () => {
  const speeds = (s: CalcState) => Object.fromEntries(turnOrderFor(s).moves.map((m) => [m.entry.id, m.speed.speed]));

  it("uses each side's own Tailwind", () => {
    const start = initialState();
    const leftWind: CalcState = {
      ...start,
      field: { ...start.field, attackerSide: { ...start.field.attackerSide, tailwind: true } },
    };
    expect(speeds(leftWind)).toEqual({ left1: 244, left2: 334, right1: 80, right2: 100 });
    const rightWind: CalcState = {
      ...start,
      field: { ...start.field, defenderSide: { ...start.field.defenderSide, tailwind: true } },
    };
    expect(speeds(rightWind)).toEqual({ left1: 122, left2: 167, right1: 160, right2: 200 });
  });

  it('only counts the item-used toggle for an Unburden holder', () => {
    const used = updateSlot(initialState(), 'left1', { itemConsumed: true });
    expect(unburdenActive(used.slots.left1)).toBe(false);
    expect(speeds(used).left1).toBe(122);
    const chomp = used.slots.left1;
    const unburden: CalcState = {
      ...used,
      slots: { ...used.slots, left1: { ...chomp, pokemon: { ...chomp.pokemon, ability: 'Unburden' } } },
    };
    expect(unburdenActive(unburden.slots.left1)).toBe(true);
    expect(speeds(unburden).left1).toBe(244);
  });

  it('orders only the two active Pokemon in singles', () => {
    const start = initialState();
    const order = turnOrderFor({ ...start, field: { ...start.field, isDoubles: false } });
    expect(order.moves.map((m) => m.entry.id)).toEqual(['left1', 'right1']);
  });

  it('asks the heal lookup about each move, for Triage', () => {
    const start = initialState();
    const gard = start.slots.right2;
    const triage: CalcState = {
      ...start,
      slots: { ...start.slots, right2: { ...gard, pokemon: { ...gard.pokemon, ability: 'Triage' } } },
    };
    const order = turnOrderFor(triage, (_game, name) => name === 'Dazzling Gleam');
    expect(order.moves[0]!.entry.id).toBe('right2');
    expect(order.moves[0]!.priority.bracket).toBe(3);
  });
});

describe('turnOrderNames', () => {
  const labels = { left1: 'Left 1', left2: 'Left 2', right1: 'Right 1', right2: 'Right 2' } as const;

  it('uses the species, adding the slot when two share one', () => {
    const start = initialState();
    expect(turnOrderNames(start, labels).left1).toBe('Garchomp');
    const mirror: CalcState = { ...start, slots: { ...start.slots, right1: start.slots.left1 } };
    const names = turnOrderNames(mirror, labels);
    expect(names.left1).toBe('Garchomp (Left 1)');
    expect(names.right1).toBe('Garchomp (Right 1)');
  });
});
