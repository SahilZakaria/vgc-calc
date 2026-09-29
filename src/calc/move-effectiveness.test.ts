import { calculate as smogonCalculate, toID } from '@smogon/calc';
import { describe, expect, it } from 'vitest';
// Test-only use of the oracle adapter; src/calc itself never imports it.
import {
  smogonGeneration,
  toSmogonField,
  toSmogonMove,
  toSmogonPokemon,
} from '../oracle/smogon-adapter';
import type {
  DamageContext,
  FieldState,
  Game,
  Move,
  MoveCategory,
  Pokemon,
  SideState,
  StatTable,
  TypeName,
  Weather,
} from '../types';
import { calculate } from './calculate';
import { getMoveEffectiveness } from './move-effectiveness';

// Expected multipliers come from Bulbapedia:
//   - "Freeze-Dry (move)": super effective against Water regardless of Ice's
//     usual resistance, and the Water part is still combined with the
//     defender's other type.
//   - "Flying Press (move)": effectiveness is the product of Fighting's and
//     Flying's against each of the target's types; Ghost stays immune.
//   - "Strong winds": moves that would be super effective against Flying are
//     instead neutral against the Flying part (so a 4x hit becomes 2x);
//     Air Lock / Cloud Nine suppress it.
// Full-damage cases at the bottom compare against @smogon/calc 0.12.0 run on
// the same inputs through smogon-adapter.ts.

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp,
  atk,
  def,
  spa,
  spd,
  spe,
});

const NO_BOOSTS = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

function typed(types: TypeName[], ability = 'Pressure'): Pokemon {
  return {
    species: 'Test',
    level: 50,
    types,
    isTerastallized: false,
    baseStats: table(100, 100, 100, 100, 100, 100),
    ivs: table(31, 31, 31, 31, 31, 31),
    evs: table(0, 0, 0, 0, 0, 0),
    nature: 'Hardy',
    ability,
    abilitySuppressed: false,
    item: null,
    weightKg: 50,
    currentHp: null,
    statBoosts: NO_BOOSTS,
    status: 'none',
  };
}

function move(name: string, type: TypeName, basePower: number, category: MoveCategory): Move {
  return {
    name,
    type,
    basePower,
    variablePower: 'none',
    category,
    target: 'single',
    priority: 0,
    hits: 1,
    flags: {
      contact: category === 'Physical',
      punch: false,
      sound: false,
      slicing: false,
      bite: false,
      bullet: false,
      wind: false,
      pulse: false,
    },
  };
}

const side = (): SideState => ({
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
});

const field = (weather: Weather = 'none'): FieldState => ({
  weather,
  terrain: 'none',
  isDoubles: false,
  isGravity: false,
  isWonderRoom: false,
  isMagicRoom: false,
  isBeadsOfRuin: false,
  isSwordOfRuin: false,
  isTabletsOfRuin: false,
  isVesselOfRuin: false,
  attackerSide: side(),
  defenderSide: side(),
});

const ctx = (
  attacker: Pokemon,
  defender: Pokemon,
  m: Move,
  weather: Weather = 'none',
  game: Game = 'gen9',
): DamageContext => ({ game, attacker, defender, move: m, field: field(weather), isCritical: false });

const FREEZE_DRY = move('Freeze-Dry', 'Ice', 70, 'Special');
const ICE_BEAM = move('Ice Beam', 'Ice', 90, 'Special');
const FLYING_PRESS = move('Flying Press', 'Fighting', 100, 'Physical');
const CLOSE_COMBAT = move('Close Combat', 'Fighting', 120, 'Physical');
const THUNDERBOLT = move('Thunderbolt', 'Electric', 90, 'Special');
const EARTHQUAKE = move('Earthquake', 'Ground', 100, 'Physical');

const eff = (m: Move, types: TypeName[], weather: Weather = 'none', game: Game = 'gen9', defAbility?: string) =>
  getMoveEffectiveness(ctx(typed(['Normal']), typed(types, defAbility), m, weather, game));

describe('getMoveEffectiveness: Freeze-Dry', () => {
  it.each<[TypeName[], number]>([
    [['Water'], 2],
    [['Water', 'Flying'], 4], // Gyarados
    [['Water', 'Ground'], 4], // Swampert
    [['Water', 'Steel'], 1], // Empoleon: 2 x 0.5
    [['Water', 'Ice'], 1], // Lapras: 2 x 0.5
    [['Fire'], 0.5], // non-Water types use the Ice chart
  ])('against %j is %s', (types, expected) => {
    expect(eff(FREEZE_DRY, types)).toBe(expected);
  });

  it('applies in Champions too', () => {
    expect(eff(FREEZE_DRY, ['Water', 'Flying'], 'none', 'champions')).toBe(4);
  });

  it('does not affect other Ice moves', () => {
    expect(eff(ICE_BEAM, ['Water'])).toBe(0.5);
  });

  it('uses the Tera type when terastallized', () => {
    const defender = { ...typed(['Fire']), isTerastallized: true, teraType: 'Water' as TypeName };
    expect(getMoveEffectiveness(ctx(typed(['Normal']), defender, FREEZE_DRY))).toBe(2);
  });
});

describe('getMoveEffectiveness: Flying Press', () => {
  it.each<[TypeName[], number]>([
    [['Grass', 'Fighting'], 4], // Breloom: (1 x 2) x (1 x 2)
    [['Normal'], 2], // Fighting 2 x Flying 1
    [['Grass'], 2], // Fighting 1 x Flying 2
    [['Steel'], 1], // Fighting 2 x Flying 0.5
    [['Electric'], 0.5], // Fighting 1 x Flying 0.5
    [['Ghost'], 0], // Fighting immunity carries
    [['Flying'], 0.5], // Fighting 0.5 x Flying 1
  ])('against %j is %s', (types, expected) => {
    expect(eff(FLYING_PRESS, types)).toBe(expected);
  });

  it('does not affect other Fighting moves', () => {
    expect(eff(CLOSE_COMBAT, ['Grass'])).toBe(1);
  });
});

describe('getMoveEffectiveness: Strong Winds', () => {
  it.each<[Move, TypeName[], number]>([
    [ICE_BEAM, ['Dragon', 'Flying'], 2], // Rayquaza / Dragonite: 4x -> 2x
    [THUNDERBOLT, ['Water', 'Flying'], 2], // Gyarados: 4x -> 2x
    [THUNDERBOLT, ['Normal', 'Flying'], 1], // 2x -> 1x
    [FREEZE_DRY, ['Water', 'Flying'], 2], // Ice is super effective on Flying
    [ICE_BEAM, ['Dragon'], 2], // not Flying: unchanged
    [CLOSE_COMBAT, ['Normal', 'Flying'], 1], // not super effective on Flying: unchanged
  ])('%s against %j is %s', (m, types, expected) => {
    expect(eff(m, types, 'strongWinds')).toBe(expected);
  });

  it('leaves immunities alone', () => {
    expect(eff(EARTHQUAKE, ['Normal', 'Flying'], 'strongWinds')).toBe(0);
  });

  it('is suppressed by Cloud Nine', () => {
    expect(eff(ICE_BEAM, ['Dragon', 'Flying'], 'strongWinds', 'gen9', 'Cloud Nine')).toBe(4);
  });

  it('does not apply in Champions', () => {
    expect(eff(ICE_BEAM, ['Dragon', 'Flying'], 'strongWinds', 'champions')).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Full damage against @smogon/calc
// ---------------------------------------------------------------------------

// Real species from each game's @smogon/calc dex, level 50, 31 IVs. 252 EVs
// is 32 SP, so the same spread is legal in both games.
function dexMon(game: Game, species: string, evs: StatTable, nature: string): Pokemon {
  const dex = smogonGeneration(game).species.get(toID(species));
  if (!dex) throw new Error(`${species} missing from @smogon/calc ${game} dex`);
  return {
    ...typed([...dex.types] as TypeName[]),
    species: dex.name,
    baseStats: { ...dex.baseStats },
    evs,
    nature,
    weightKg: dex.weightkg,
  };
}

const attackerSpec = (game: Game, species: string) =>
  dexMon(game, species, table(4, 0, 0, 252, 0, 252), 'Modest');
const attackerPhys = (game: Game, species: string) =>
  dexMon(game, species, table(4, 252, 0, 0, 0, 252), 'Adamant');
const bulky = (game: Game, species: string) => dexMon(game, species, table(252, 0, 4, 0, 252, 0), 'Calm');

function oracleRolls(c: DamageContext): number[] {
  const { damage } = smogonCalculate(
    smogonGeneration(c.game),
    toSmogonPokemon(c.game, c.attacker),
    toSmogonPokemon(c.game, c.defender),
    toSmogonMove(c.game, c.move, { isCrit: c.isCritical }),
    toSmogonField(c.field),
  );
  return typeof damage === 'number' ? new Array<number>(16).fill(damage) : damage.flat();
}

const ORACLE_CASES: { name: string; ctx: DamageContext }[] = (['gen9', 'champions'] as const).flatMap((game) => [
  {
    name: `${game}: Freeze-Dry into Gyarados`,
    ctx: ctx(attackerSpec(game, 'Glaceon'), bulky(game, 'Gyarados'), FREEZE_DRY, 'none', game),
  },
  {
    name: `${game}: Flying Press into Abomasnow (4x)`,
    ctx: ctx(attackerPhys(game, 'Hawlucha'), bulky(game, 'Abomasnow'), FLYING_PRESS, 'none', game),
  },
  {
    name: `${game}: Ice Beam into Dragonite in Strong Winds`,
    ctx: ctx(attackerSpec(game, 'Glaceon'), bulky(game, 'Dragonite'), ICE_BEAM, 'strongWinds', game),
  },
]);

describe('move and field effectiveness overrides agree with @smogon/calc', () => {
  it.each(ORACLE_CASES)('$name', ({ ctx: c }) => {
    expect(calculate(c).rolls).toEqual(oracleRolls(c));
  });
});
