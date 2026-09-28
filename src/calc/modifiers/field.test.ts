import { describe, expect, it } from 'vitest';
import type {
  DamageContext, FieldState, Move, MoveCategory, Pokemon, SideState, StatTable, TypeName,
} from '../../types';
import { calculateBaseDamage } from '../damage';
import { MODIFIER_ORDER, runPipeline, runPostRoll, runPreRoll, sortModifiers } from '../modifier-pipeline';
import { getDefensiveTypes, getTypeEffectiveness } from '../type-chart';
import {
  ATTACK_STAT_FIELD_MODIFIERS,
  BEADS_OF_RUIN_MODIFIER,
  DEFENSE_STAT_FIELD_MODIFIERS,
  effectiveWeather,
  FIELD_DAMAGE_MODIFIERS,
  isGrounded,
  RUIN_MULTIPLIER,
  SCREEN_DOUBLES,
  SCREEN_SINGLES,
  SCREENS_MODIFIER,
  screensMultiplier,
  SWORD_OF_RUIN_MODIFIER,
  TABLETS_OF_RUIN_MODIFIER,
  TERRAIN_BOOST,
  TERRAIN_MODIFIER,
  TERRAIN_WEAKEN,
  terrainMultiplier,
  VESSEL_OF_RUIN_MODIFIER,
  WEATHER_BOOST,
  WEATHER_MODIFIER,
  WEATHER_WEAKEN,
  weatherMultiplier,
} from './field';

// ---------------------------------------------------------------------------
// Fixtures
//
// Reference: @smogon/calc 0.12.0, Generations.get(9), level 50, Hardy nature,
// 31 IVs, 0 EVs, no items unless stated.
//   Attacker Snorlax (ability Gluttony): Atk 130, SpA 85  (their Pokemon.stats)
//   Defender Blissey (ability Natural Cure): Def 30, SpD 155
// Snorlax is pure Normal and every move used below is non-Normal, so there is
// no STAB; Blissey is pure Normal, so every move is neutral except Brick Break.
// Expected roll arrays are copied verbatim from calculate(...).damage.
// ---------------------------------------------------------------------------

const stats = (s: Partial<StatTable>): StatTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...s });
const SNORLAX = { atk: 130, spa: 85 } as const;
const BLISSEY = { def: 30, spd: 155 } as const;

const noSide: SideState = {
  reflect: false, lightScreen: false, auroraVeil: false,
  tailwind: false, helpingHand: false, friendGuard: false, battery: false,
  powerSpot: false, steelySpirit: false, stealthRock: false, spikes: 0,
};

function mon(species: string, overrides: Partial<Pokemon> = {}): Pokemon {
  return {
    species,
    level: 50,
    types: ['Normal'],
    isTerastallized: false,
    baseStats: stats({}),
    ivs: stats({}),
    evs: stats({}),
    nature: 'Hardy',
    ability: '',
    abilitySuppressed: false,
    item: null,
    weightKg: 1,
    currentHp: null,
    statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    status: 'none',
    ...overrides,
  };
}

// Base power / type / category from @smogon/calc 0.12.0 Gen 9 move data.
const MOVES = {
  Flamethrower: ['Fire', 90, 'Special'],
  Surf: ['Water', 90, 'Special'],
  'Hydro Steam': ['Water', 80, 'Special'],
  Thunderbolt: ['Electric', 90, 'Special'],
  'Seed Bomb': ['Grass', 80, 'Physical'],
  Psychic: ['Psychic', 90, 'Special'],
  Earthquake: ['Ground', 100, 'Physical'],
  Bulldoze: ['Ground', 60, 'Physical'],
  'Dragon Pulse': ['Dragon', 85, 'Special'],
  Crunch: ['Dark', 80, 'Physical'],
  'Brick Break': ['Fighting', 75, 'Physical'],
} as const satisfies Record<string, readonly [TypeName, number, MoveCategory]>;

function move(name: keyof typeof MOVES): Move {
  const [type, basePower, category] = MOVES[name];
  return {
    name, type, basePower, category,
    variablePower: 'none',
    target: 'single',
    priority: 0,
    hits: 1,
    flags: {
      contact: false, punch: false, sound: false, slicing: false,
      bite: false, bullet: false, wind: false, pulse: false,
    },
  };
}

interface Scenario {
  move: keyof typeof MOVES;
  field?: Partial<FieldState>;
  defenderSide?: Partial<SideState>;
  attacker?: Partial<Pokemon>;
  defender?: Partial<Pokemon>;
  isCritical?: boolean;
}

function context(s: Scenario): DamageContext {
  return {
    attacker: mon('Snorlax', { ability: 'Gluttony', ...s.attacker }),
    defender: mon('Blissey', { ability: 'Natural Cure', ...s.defender }),
    move: move(s.move),
    field: {
      weather: 'none',
      terrain: 'none',
      isDoubles: false,
      isGravity: false,
      isWonderRoom: false,
      isMagicRoom: false,
      isBeadsOfRuin: false,
      isSwordOfRuin: false,
      isTabletsOfRuin: false,
      isVesselOfRuin: false,
      attackerSide: noSide,
      defenderSide: { ...noSide, ...s.defenderSide },
      ...s.field,
    },
    isCritical: s.isCritical ?? false,
  };
}

/**
 * Minimal Gen 9 damage calc that uses only this module's modifiers, in the
 * order documented in modifier-pipeline.ts. No STAB, burn, items, spread or
 * other abilities are involved in any scenario, so every other stage is 1x.
 */
function rolls(s: Scenario): number[] {
  const ctx = context(s);
  const physical = ctx.move.category === 'Physical';
  const attack = runPipeline(physical ? SNORLAX.atk : SNORLAX.spa, ctx, ATTACK_STAT_FIELD_MODIFIERS);
  const defense = runPipeline(physical ? BLISSEY.def : BLISSEY.spd, ctx, DEFENSE_STAT_FIELD_MODIFIERS);
  const basePower = runPipeline(ctx.move.basePower, ctx, [TERRAIN_MODIFIER]);

  // calculateBaseDamage's 100% roll is the unrolled base damage.
  const base = calculateBaseDamage(50, attack, defense, basePower)[15] ?? 0;
  let pre = runPreRoll(base, ctx, FIELD_DAMAGE_MODIFIERS);
  if (ctx.isCritical) pre = Math.floor(pre * 1.5);
  const effectiveness = getTypeEffectiveness(ctx.move.type, getDefensiveTypes(ctx.defender));

  const out: number[] = [];
  for (let r = 85; r <= 100; r++) {
    const rolled = Math.floor((pre * r) / 100);
    out.push(runPostRoll(Math.floor(rolled * effectiveness), ctx, FIELD_DAMAGE_MODIFIERS));
  }
  return pre === 0 ? [0] : out;
}

// Frequently repeated @smogon/calc results.
const FLAMETHROWER_PLAIN = [19, 19, 20, 20, 20, 20, 20, 21, 21, 21, 21, 22, 22, 22, 22, 23];
const SPECIAL_90_BOOSTED = [28, 29, 29, 29, 30, 30, 30, 31, 31, 31, 32, 32, 32, 33, 33, 34];
const SPECIAL_90_WEAKENED = [9, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11];
const SPECIAL_90_TERRAIN = [25, 25, 26, 26, 26, 27, 27, 27, 27, 28, 28, 28, 29, 29, 29, 30];
const CRUNCH_PLAIN = [130, 132, 133, 135, 137, 138, 140, 141, 143, 144, 146, 147, 149, 150, 152, 154];

describe('constants', () => {
  // Values quoted from @smogon/calc 0.12.0 dist/mechanics/gen789.js; see field.ts.
  it('match the 4096-based values in @smogon/calc', () => {
    expect(WEATHER_BOOST).toBe(6144);
    expect(WEATHER_WEAKEN).toBe(2048);
    expect(TERRAIN_BOOST).toBe(5325);
    expect(TERRAIN_WEAKEN).toBe(2048);
    expect(SCREEN_DOUBLES).toBe(2732);
    expect(SCREEN_SINGLES).toBe(2048);
    expect(RUIN_MULTIPLIER).toBe(3072);
  });

  it('weather and screens occupy their pipeline slots', () => {
    expect(WEATHER_MODIFIER.order).toBe(MODIFIER_ORDER.weather);
    expect(SCREENS_MODIFIER.order).toBe(MODIFIER_ORDER.screens);
    expect(() => sortModifiers(ATTACK_STAT_FIELD_MODIFIERS)).not.toThrow();
    expect(() => sortModifiers(DEFENSE_STAT_FIELD_MODIFIERS)).not.toThrow();
  });
});

describe('weather vs @smogon/calc (Gen 9 Singles)', () => {
  const cases: [string, Scenario, number[]][] = [
    ['no weather, Flamethrower', { move: 'Flamethrower' }, FLAMETHROWER_PLAIN],
    ['Sun boosts Fire', { move: 'Flamethrower', field: { weather: 'sun' } }, SPECIAL_90_BOOSTED],
    // Base 23 * 0.5 = 11.5 -> pokeRound -> 11 (exact .5 rounds down).
    ['Sun weakens Water', { move: 'Surf', field: { weather: 'sun' } }, SPECIAL_90_WEAKENED],
    ['Rain boosts Water', { move: 'Surf', field: { weather: 'rain' } }, SPECIAL_90_BOOSTED],
    ['Rain weakens Fire', { move: 'Flamethrower', field: { weather: 'rain' } }, SPECIAL_90_WEAKENED],
    ['Harsh Sunshine boosts Fire', { move: 'Flamethrower', field: { weather: 'harshSun' } }, SPECIAL_90_BOOSTED],
    ['Harsh Sunshine nullifies Water', { move: 'Surf', field: { weather: 'harshSun' } }, [0]],
    ['Heavy Rain boosts Water', { move: 'Surf', field: { weather: 'heavyRain' } }, SPECIAL_90_BOOSTED],
    ['Heavy Rain nullifies Fire', { move: 'Flamethrower', field: { weather: 'heavyRain' } }, [0]],
    ['Sand does nothing to Fire', { move: 'Flamethrower', field: { weather: 'sand' } }, FLAMETHROWER_PLAIN],
    [
      'defender Utility Umbrella ignores Sun',
      { move: 'Flamethrower', field: { weather: 'sun' }, defender: { item: 'Utility Umbrella' } },
      FLAMETHROWER_PLAIN,
    ],
    [
      'attacker Cloud Nine clears Sun',
      { move: 'Flamethrower', field: { weather: 'sun' }, attacker: { ability: 'Cloud Nine' } },
      FLAMETHROWER_PLAIN,
    ],
    [
      'Sun boosts Hydro Steam',
      { move: 'Hydro Steam', field: { weather: 'sun' } },
      [26, 26, 26, 27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 30, 31],
    ],
  ];

  it.each(cases)('%s', (_label, scenario, expected) => {
    expect(rolls(scenario)).toEqual(expected);
  });
});

describe('weather rules', () => {
  it('primal nullification keeps 0 through the screens stage', () => {
    const ctx = context({ move: 'Surf', field: { weather: 'harshSun' }, defenderSide: { lightScreen: true } });
    expect(weatherMultiplier(ctx)).toBe(0);
    expect(runPostRoll(runPreRoll(23, ctx, FIELD_DAMAGE_MODIFIERS), ctx, FIELD_DAMAGE_MODIFIERS)).toBe(0);
  });

  it('Utility Umbrella does not prevent primal nullification (gen789.js calculateSMSSSV)', () => {
    const ctx = context({ move: 'Surf', field: { weather: 'harshSun' }, defender: { item: 'Utility Umbrella' } });
    expect(weatherMultiplier(ctx)).toBe(0);
  });

  it('a suppressed Air Lock does not clear weather', () => {
    const ctx = context({
      move: 'Flamethrower',
      field: { weather: 'sun' },
      defender: { ability: 'Air Lock', abilitySuppressed: true },
    });
    expect(effectiveWeather(ctx)).toBe('sun');
    expect(WEATHER_MODIFIER.applies(ctx)).toBe(true);
  });

  it('does not apply to unaffected types', () => {
    expect(WEATHER_MODIFIER.applies(context({ move: 'Crunch', field: { weather: 'sun' } }))).toBe(false);
  });
});

describe('terrain vs @smogon/calc (Gen 9 Singles)', () => {
  const cases: [string, Scenario, number[]][] = [
    ['no terrain, Thunderbolt', { move: 'Thunderbolt' }, FLAMETHROWER_PLAIN],
    ['Electric Terrain boosts Electric', { move: 'Thunderbolt', field: { terrain: 'electric' } }, SPECIAL_90_TERRAIN],
    [
      'Grassy Terrain boosts Grass',
      { move: 'Seed Bomb', field: { terrain: 'grassy' } },
      [170, 172, 174, 176, 178, 180, 182, 184, 186, 188, 190, 192, 194, 196, 198, 200],
    ],
    ['Psychic Terrain boosts Psychic', { move: 'Psychic', field: { terrain: 'psychic' } }, SPECIAL_90_TERRAIN],
    [
      'Grassy Terrain halves Earthquake',
      { move: 'Earthquake', field: { terrain: 'grassy' } },
      [82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97],
    ],
    [
      'Grassy Terrain halves Bulldoze',
      { move: 'Bulldoze', field: { terrain: 'grassy' } },
      [50, 50, 51, 51, 52, 53, 53, 54, 54, 55, 56, 56, 57, 57, 58, 59],
    ],
    [
      'Misty Terrain halves Dragon',
      { move: 'Dragon Pulse', field: { terrain: 'misty' } },
      [10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 11, 11, 12],
    ],
    [
      'Air Balloon attacker is not boosted',
      { move: 'Thunderbolt', field: { terrain: 'electric' }, attacker: { item: 'Air Balloon' } },
      FLAMETHROWER_PLAIN,
    ],
    [
      'Gravity grounds an Air Balloon attacker',
      { move: 'Thunderbolt', field: { terrain: 'electric', isGravity: true }, attacker: { item: 'Air Balloon' } },
      SPECIAL_90_TERRAIN,
    ],
    [
      'Tera Flying attacker is not boosted',
      {
        move: 'Thunderbolt',
        field: { terrain: 'electric' },
        attacker: { isTerastallized: true, teraType: 'Flying' },
      },
      FLAMETHROWER_PLAIN,
    ],
  ];

  it.each(cases)('%s', (_label, scenario, expected) => {
    expect(rolls(scenario)).toEqual(expected);
  });
});

describe('terrain rules', () => {
  // Rules from @smogon/calc 0.12.0 dist/mechanics/util.js isGrounded.
  const field = context({ move: 'Earthquake' }).field;

  it('grounding', () => {
    expect(isGrounded(mon('A'), field)).toBe(true);
    expect(isGrounded(mon('A', { types: ['Normal', 'Flying'] }), field)).toBe(false);
    expect(isGrounded(mon('A', { ability: 'Levitate' }), field)).toBe(false);
    expect(isGrounded(mon('A', { ability: 'Levitate', abilitySuppressed: true }), field)).toBe(true);
    expect(isGrounded(mon('A', { types: ['Flying'], item: 'Iron Ball' }), field)).toBe(true);
    expect(isGrounded(mon('A', { types: ['Flying'] }), { ...field, isGravity: true })).toBe(true);
    // Terastallizing out of Flying grounds the Pokemon.
    expect(isGrounded(mon('A', { types: ['Flying'], isTerastallized: true, teraType: 'Steel' }), field)).toBe(true);
  });

  it('Grassy Earthquake is not halved against an ungrounded defender', () => {
    const ctx = context({ move: 'Earthquake', field: { terrain: 'grassy' }, defender: { item: 'Air Balloon' } });
    expect(terrainMultiplier(ctx)).toBe(4096);
    expect(TERRAIN_MODIFIER.applies(ctx)).toBe(false);
  });

  it('boost depends on the attacker, not the defender, being grounded', () => {
    const ctx = context({ move: 'Thunderbolt', field: { terrain: 'electric' }, defender: { types: ['Flying'] } });
    expect(terrainMultiplier(ctx)).toBe(TERRAIN_BOOST);
  });

  it('operates on base power: 90 -> 117, 100 -> 50', () => {
    // 90 * 5325 / 4096 = 117.004 -> 117; 100 * 2048 / 4096 = 50.
    expect(TERRAIN_MODIFIER.apply(90, context({ move: 'Thunderbolt', field: { terrain: 'electric' } }))).toBe(117);
    expect(TERRAIN_MODIFIER.apply(100, context({ move: 'Earthquake', field: { terrain: 'grassy' } }))).toBe(50);
  });

  it('is not part of the damage chain', () => {
    expect(FIELD_DAMAGE_MODIFIERS).not.toContain(TERRAIN_MODIFIER);
  });
});

describe('screens vs @smogon/calc', () => {
  const cases: [string, Scenario, number[]][] = [
    ['no screens, Crunch', { move: 'Crunch' }, CRUNCH_PLAIN],
    [
      'Reflect, singles (2048)',
      { move: 'Crunch', defenderSide: { reflect: true } },
      [65, 66, 66, 67, 68, 69, 70, 70, 71, 72, 73, 73, 74, 75, 76, 77],
    ],
    [
      'Reflect, doubles (2732)',
      { move: 'Crunch', field: { isDoubles: true }, defenderSide: { reflect: true } },
      [87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 103],
    ],
    ['Reflect ignores special moves', { move: 'Flamethrower', defenderSide: { reflect: true } }, FLAMETHROWER_PLAIN],
    [
      'Light Screen, singles',
      { move: 'Flamethrower', defenderSide: { lightScreen: true } },
      [9, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11],
    ],
    [
      'Light Screen, doubles',
      { move: 'Flamethrower', field: { isDoubles: true }, defenderSide: { lightScreen: true } },
      [13, 13, 13, 13, 13, 13, 13, 14, 14, 14, 14, 15, 15, 15, 15, 15],
    ],
    ['Light Screen ignores physical moves', { move: 'Crunch', defenderSide: { lightScreen: true } }, CRUNCH_PLAIN],
    [
      'Aurora Veil on physical, doubles',
      { move: 'Crunch', field: { isDoubles: true }, defenderSide: { auroraVeil: true } },
      [87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 103],
    ],
    [
      'Aurora Veil does not stack with Reflect',
      { move: 'Crunch', field: { isDoubles: true }, defenderSide: { auroraVeil: true, reflect: true } },
      [87, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 103],
    ],
    [
      'Aurora Veil on special, singles',
      { move: 'Flamethrower', defenderSide: { auroraVeil: true } },
      [9, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11],
    ],
    [
      'critical hit bypasses Reflect',
      { move: 'Crunch', defenderSide: { reflect: true }, isCritical: true },
      [196, 198, 200, 203, 205, 207, 210, 212, 214, 217, 219, 221, 224, 226, 228, 231],
    ],
    [
      'Infiltrator bypasses Reflect',
      { move: 'Crunch', defenderSide: { reflect: true }, attacker: { ability: 'Infiltrator' } },
      CRUNCH_PLAIN,
    ],
    [
      'Brick Break breaks Reflect',
      { move: 'Brick Break', defenderSide: { reflect: true } },
      [246, 248, 252, 254, 258, 260, 262, 266, 268, 272, 274, 278, 280, 284, 286, 290],
    ],
  ];

  it.each(cases)('%s', (_label, scenario, expected) => {
    expect(rolls(scenario)).toEqual(expected);
  });

  it('critical hits bypass every screen', () => {
    const ctx = context({
      move: 'Crunch',
      field: { isDoubles: true },
      defenderSide: { reflect: true, auroraVeil: true },
      isCritical: true,
    });
    expect(screensMultiplier(ctx)).toBe(4096);
    expect(SCREENS_MODIFIER.applies(ctx)).toBe(false);
  });

  it('only the defender\'s side matters', () => {
    const ctx = context({ move: 'Crunch' });
    ctx.field.attackerSide = { ...noSide, reflect: true };
    expect(SCREENS_MODIFIER.applies(ctx)).toBe(false);
  });
});

describe('Ruin abilities vs @smogon/calc (Gen 9 Singles)', () => {
  const cases: [string, Scenario, number[]][] = [
    [
      'Tablets of Ruin lowers physical Atk',
      { move: 'Crunch', field: { isTabletsOfRuin: true } },
      [97, 98, 100, 101, 102, 103, 104, 105, 106, 108, 109, 110, 111, 112, 113, 115],
    ],
    ['Tablets of Ruin ignores special moves', { move: 'Flamethrower', field: { isTabletsOfRuin: true } }, FLAMETHROWER_PLAIN],
    [
      'Vessel of Ruin lowers SpA',
      { move: 'Flamethrower', field: { isVesselOfRuin: true } },
      [15, 15, 15, 15, 16, 16, 16, 16, 16, 16, 17, 17, 17, 17, 17, 18],
    ],
    [
      'Sword of Ruin lowers Def',
      { move: 'Crunch', field: { isSwordOfRuin: true } },
      [178, 180, 182, 184, 186, 189, 191, 193, 195, 197, 199, 201, 203, 205, 207, 210],
    ],
    [
      'Beads of Ruin lowers SpD',
      { move: 'Flamethrower', field: { isBeadsOfRuin: true } },
      [26, 26, 26, 27, 27, 27, 28, 28, 28, 29, 29, 29, 30, 30, 30, 31],
    ],
    [
      'Tablets of Ruin does not affect its own holder',
      { move: 'Crunch', field: { isTabletsOfRuin: true }, attacker: { ability: 'Tablets of Ruin' } },
      CRUNCH_PLAIN,
    ],
    [
      'Beads of Ruin does not affect its own holder',
      { move: 'Flamethrower', field: { isBeadsOfRuin: true }, defender: { ability: 'Beads of Ruin' } },
      FLAMETHROWER_PLAIN,
    ],
  ];

  it.each(cases)('%s', (_label, scenario, expected) => {
    expect(rolls(scenario)).toEqual(expected);
  });

  it('operates on the stat: 130 -> 97, 30 -> 22', () => {
    // 130 * 3072 / 4096 = 97.5 -> pokeRound -> 97; 30 * 0.75 = 22.5 -> 22.
    expect(TABLETS_OF_RUIN_MODIFIER.apply(130, context({ move: 'Crunch', field: { isTabletsOfRuin: true } }))).toBe(97);
    expect(SWORD_OF_RUIN_MODIFIER.apply(30, context({ move: 'Crunch', field: { isSwordOfRuin: true } }))).toBe(22);
  });

  it('an opposing holder activates the effect without the field flag', () => {
    expect(SWORD_OF_RUIN_MODIFIER.applies(context({ move: 'Crunch', attacker: { ability: 'Sword of Ruin' } }))).toBe(true);
    expect(VESSEL_OF_RUIN_MODIFIER.applies(context({ move: 'Surf', defender: { ability: 'Vessel of Ruin' } }))).toBe(true);
    expect(BEADS_OF_RUIN_MODIFIER.applies(context({ move: 'Surf' }))).toBe(false);
  });

  it('a suppressed holder is affected by the field flag', () => {
    const ctx = context({
      move: 'Crunch',
      field: { isTabletsOfRuin: true },
      attacker: { ability: 'Tablets of Ruin', abilitySuppressed: true },
    });
    expect(TABLETS_OF_RUIN_MODIFIER.applies(ctx)).toBe(true);
  });
});
