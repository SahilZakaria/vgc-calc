import { calculate as smogonCalculate, toID } from '@smogon/calc';
import { describe, expect, it } from 'vitest';
// Test-only use of the oracle adapter; calculate.ts itself never imports it.
import {
  smogonGeneration,
  toSmogonField,
  toSmogonMove,
  toSmogonPokemon,
  type OracleGame,
} from '../oracle/smogon-adapter';
import type {
  DamageContext,
  FieldState,
  Game,
  Move,
  MoveCategory,
  MoveTarget,
  Pokemon,
  SideState,
  StatTable,
  TypeName,
} from '../types';
import { calculate, DAMAGE_CHAIN, RANDOM_ROLL_FLOOR } from './calculate';
import { MODIFIER_ORDER } from './modifier-pipeline';

// Expected values come from @smogon/calc 0.12.0 (the oracle), run on the same
// inputs through src/oracle/smogon-adapter.ts. Nothing is hard-coded from our
// own output.

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp,
  atk,
  def,
  spa,
  spd,
  spe,
});

// Champions spToEv as stated in CLAUDE.md.
const spToEv = (sp: number): number => (sp === 0 ? 0 : 8 * sp - 4);
const spread = (sp: StatTable): StatTable => table(
  spToEv(sp.hp),
  spToEv(sp.atk),
  spToEv(sp.def),
  spToEv(sp.spa),
  spToEv(sp.spd),
  spToEv(sp.spe),
);

interface MonOptions {
  game?: OracleGame;
  nature?: string;
  /** Stat Points in Champions, EVs in Gen 9. */
  investment?: StatTable;
  ability?: string;
  boosts?: Partial<Pokemon['statBoosts']>;
  status?: Pokemon['status'];
  teraType?: TypeName;
}

// Builds a Pokemon from @smogon/calc's own dex entry so both calculators start
// from identical base stats. The default ability is one neither calculator
// acts on, so each case exercises only what it names.
function mon(species: string, opts: MonOptions = {}): Pokemon {
  const game = opts.game ?? 'champions';
  const dex = smogonGeneration(game).species.get(toID(species));
  if (!dex) throw new Error(`${species} missing from @smogon/calc ${game} dex`);
  const investment = opts.investment ?? table(0, 0, 0, 0, 0, 0);
  return {
    species: dex.name,
    level: 50,
    types: [...dex.types] as TypeName[],
    ...(opts.teraType !== undefined ? { teraType: opts.teraType } : {}),
    isTerastallized: opts.teraType !== undefined,
    baseStats: { ...dex.baseStats },
    ivs: table(31, 31, 31, 31, 31, 31),
    evs: game === 'champions' ? spread(investment) : investment,
    nature: opts.nature ?? 'Hardy',
    ability: opts.ability ?? 'Pressure',
    abilitySuppressed: false,
    item: null,
    weightKg: dex.weightkg,
    currentHp: null,
    statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...opts.boosts },
    status: opts.status ?? 'none',
  };
}

function move(
  name: string,
  type: TypeName,
  basePower: number,
  category: MoveCategory,
  target: MoveTarget = 'single',
  contact = category === 'Physical',
): Move {
  return {
    name,
    type,
    basePower,
    variablePower: 'none',
    category,
    target,
    priority: 0,
    hits: 1,
    flags: {
      contact,
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

const side = (overrides: Partial<SideState> = {}): SideState => ({
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
  ...overrides,
});

function field(overrides: Partial<Omit<FieldState, 'attackerSide' | 'defenderSide'>> & {
  attackerSide?: Partial<SideState>;
  defenderSide?: Partial<SideState>;
} = {}): FieldState {
  const { attackerSide, defenderSide, ...rest } = overrides;
  return {
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
    ...rest,
    attackerSide: side(attackerSide),
    defenderSide: side(defenderSide),
  };
}

function oracle(game: OracleGame, ctx: DamageContext): { rolls: number[]; maxHp: number } {
  const defender = toSmogonPokemon(game, ctx.defender);
  const result = smogonCalculate(
    smogonGeneration(game),
    toSmogonPokemon(game, ctx.attacker),
    defender,
    toSmogonMove(game, ctx.move, { isCrit: ctx.isCritical }),
    toSmogonField(ctx.field),
  );
  const { damage } = result;
  const rolls = typeof damage === 'number' ? new Array<number>(16).fill(damage) : damage.flat();
  return { rolls, maxHp: defender.maxHP() };
}

interface Case {
  name: string;
  game?: OracleGame;
  ctx: DamageContext;
}

const ctx = (
  attacker: Pokemon,
  defender: Pokemon,
  m: Move,
  f: FieldState = field(),
  isCritical = false,
  game: Game = 'gen9',
): DamageContext => ({ game, attacker, defender, move: m, field: f, isCritical });

// Common Champions sets (Stat Points, all legal: <= 32 per stat, <= 66 total).
const garchomp = (o: MonOptions = {}): Pokemon =>
  mon('Garchomp', { nature: 'Adamant', investment: table(2, 32, 0, 0, 0, 32), ...o });
const incineroar = (o: MonOptions = {}): Pokemon =>
  mon('Incineroar', { nature: 'Careful', investment: table(32, 2, 0, 0, 32, 0), ...o });
const hatterene = (o: MonOptions = {}): Pokemon =>
  mon('Hatterene', { nature: 'Quiet', investment: table(32, 0, 2, 32, 0, 0), ...o });
const farigiraf = (o: MonOptions = {}): Pokemon =>
  mon('Farigiraf', { nature: 'Bold', investment: table(32, 0, 17, 0, 17, 0), ...o });
const gholdengo = (o: MonOptions = {}): Pokemon =>
  mon('Gholdengo', { nature: 'Modest', investment: table(20, 0, 10, 32, 0, 4), ...o });
const palafin = (o: MonOptions = {}): Pokemon =>
  mon('Palafin-Hero', { nature: 'Adamant', investment: table(2, 32, 0, 0, 0, 32), ...o });
const charizard = (o: MonOptions = {}): Pokemon =>
  mon('Charizard', { nature: 'Timid', investment: table(2, 0, 0, 32, 0, 32), ...o });

const IRON_HEAD = move('Iron Head', 'Steel', 80, 'Physical');
const FIRE_FANG = move('Fire Fang', 'Fire', 65, 'Physical');
const DRAGON_CLAW = move('Dragon Claw', 'Dragon', 80, 'Physical');
const EARTHQUAKE = move('Earthquake', 'Ground', 100, 'Physical', 'allAdjacent', false);
const ROCK_SLIDE = move('Rock Slide', 'Rock', 75, 'Physical', 'allAdjacentFoes', false);
const HEAT_WAVE = move('Heat Wave', 'Fire', 95, 'Special', 'allAdjacentFoes');
const FLAMETHROWER = move('Flamethrower', 'Fire', 90, 'Special');
const WAVE_CRASH = move('Wave Crash', 'Water', 120, 'Physical');
const SHADOW_BALL = move('Shadow Ball', 'Ghost', 80, 'Special');
const MAKE_IT_RAIN = move('Make It Rain', 'Steel', 120, 'Special', 'allAdjacentFoes');
const PSYCHIC = move('Psychic', 'Psychic', 90, 'Special');
const FLARE_BLITZ = move('Flare Blitz', 'Fire', 120, 'Physical');
const ENERGY_BALL = move('Energy Ball', 'Grass', 90, 'Special');

const CASES: Case[] = [
  // Required coverage.
  { name: 'neutral hit (Fire Fang into Psychic/Fairy)', ctx: ctx(garchomp(), hatterene(), FIRE_FANG) },
  { name: 'super effective (Iron Head into Fairy)', ctx: ctx(garchomp(), hatterene(), IRON_HEAD) },
  { name: 'double super effective (Rock Slide into Charizard, singles)', ctx: ctx(garchomp(), charizard(), ROCK_SLIDE, field({ isDoubles: false })) },
  { name: 'resisted (Iron Head into Fire/Dark)', ctx: ctx(garchomp(), incineroar(), IRON_HEAD) },
  { name: 'resisted (Iron Head into Steel/Ghost)', ctx: ctx(garchomp(), gholdengo(), IRON_HEAD) },
  { name: 'double resisted (Energy Ball into Fire/Flying)', ctx: ctx(hatterene(), charizard(), ENERGY_BALL) },
  { name: 'STAB (Dragon Claw into Normal/Psychic)', ctx: ctx(garchomp(), farigiraf(), DRAGON_CLAW) },
  { name: 'STAB and super effective (Shadow Ball into Hatterene)', ctx: ctx(gholdengo(), hatterene(), SHADOW_BALL) },
  { name: 'sun-boosted Fire (Flamethrower)', ctx: ctx(charizard(), farigiraf(), FLAMETHROWER, field({ weather: 'sun' })) },
  { name: 'rain-boosted Water (Wave Crash)', ctx: ctx(palafin(), garchomp(), WAVE_CRASH, field({ weather: 'rain' })) },
  { name: 'rain-weakened Fire (Flamethrower)', ctx: ctx(charizard(), farigiraf(), FLAMETHROWER, field({ weather: 'rain' })) },
  { name: 'Reflect in doubles', ctx: ctx(garchomp(), farigiraf(), DRAGON_CLAW, field({ defenderSide: { reflect: true } })) },
  { name: 'Light Screen in singles', ctx: ctx(gholdengo(), farigiraf(), SHADOW_BALL, field({ isDoubles: false, defenderSide: { lightScreen: true } })) },
  { name: 'Aurora Veil in doubles, special', ctx: ctx(charizard(), farigiraf(), FLAMETHROWER, field({ defenderSide: { auroraVeil: true } })) },
  { name: 'spread Earthquake in doubles', ctx: ctx(garchomp(), incineroar(), EARTHQUAKE) },
  { name: 'same Earthquake in singles (no spread reduction)', ctx: ctx(garchomp(), incineroar(), EARTHQUAKE, field({ isDoubles: false })) },
  { name: 'spread Make It Rain in doubles', ctx: ctx(gholdengo(), hatterene(), MAKE_IT_RAIN) },
  { name: 'spread Heat Wave in sun, doubles', ctx: ctx(charizard(), hatterene(), HEAT_WAVE, field({ weather: 'sun' })) },
  { name: 'critical hit', ctx: ctx(garchomp(), farigiraf(), DRAGON_CLAW, field(), true) },
  { name: 'critical spread hit', ctx: ctx(garchomp(), incineroar(), EARTHQUAKE, field(), true) },
  { name: 'critical hit ignores Reflect', ctx: ctx(garchomp(), farigiraf(), DRAGON_CLAW, field({ defenderSide: { reflect: true } }), true) },

  // Stat stages.
  { name: '+2 Atk attacker', ctx: ctx(garchomp({ boosts: { atk: 2 } }), farigiraf(), DRAGON_CLAW) },
  { name: '-1 Atk attacker, +1 Def defender', ctx: ctx(garchomp({ boosts: { atk: -1 } }), farigiraf({ boosts: { def: 1 } }), DRAGON_CLAW) },
  { name: 'crit ignores -1 Atk and +1 Def', ctx: ctx(garchomp({ boosts: { atk: -1 } }), farigiraf({ boosts: { def: 1 } }), DRAGON_CLAW, field(), true) },
  { name: 'crit keeps +1 Atk and -1 Def', ctx: ctx(garchomp({ boosts: { atk: 1 } }), farigiraf({ boosts: { def: -1 } }), DRAGON_CLAW, field(), true) },
  { name: '+1 SpA into -2 SpD', ctx: ctx(gholdengo({ boosts: { spa: 1 } }), hatterene({ boosts: { spd: -2 } }), SHADOW_BALL) },

  // Wonder Room: Hatterene's Def (95) and SpD (103) invest differently here.
  { name: 'Wonder Room, special move uses Def', ctx: ctx(charizard(), hatterene({ investment: table(32, 0, 32, 0, 2, 0) }), FLAMETHROWER, field({ isWonderRoom: true })) },
  { name: 'Wonder Room, physical move uses SpD', ctx: ctx(garchomp(), hatterene({ investment: table(32, 0, 32, 0, 2, 0) }), IRON_HEAD, field({ isWonderRoom: true })) },
  { name: 'Wonder Room, Def boost applies to swapped stat', ctx: ctx(garchomp(), hatterene({ boosts: { def: 2 } }), IRON_HEAD, field({ isWonderRoom: true })) },

  // Other pipeline stages.
  { name: 'burned physical attacker', ctx: ctx(incineroar({ status: 'brn' }), farigiraf(), FLARE_BLITZ) },
  { name: 'burned special attacker is unaffected', ctx: ctx(charizard({ status: 'brn' }), farigiraf(), FLAMETHROWER) },
  { name: 'Psychic Terrain boost (grounded attacker)', ctx: ctx(hatterene(), incineroar({ investment: table(32, 0, 0, 0, 0, 0) }), PSYCHIC, field({ terrain: 'psychic' })) },
  { name: 'type immunity deals 0 (Earthquake into Charizard)', ctx: ctx(garchomp(), charizard(), EARTHQUAKE) },
  { name: 'everything at once: spread, sun, crit, STAB, SE, burn-free, doubles', ctx: ctx(charizard({ boosts: { spa: 1 } }), gholdengo({ boosts: { spd: 1 } }), HEAT_WAVE, field({ weather: 'sun', defenderSide: { lightScreen: true } }), true) },

  // Gen 9 mode: EVs, Tera STAB, Ruin.
  {
    name: 'Gen 9: neutral hit with EVs and a -Atk nature target',
    game: 'gen9',
    ctx: ctx(
      mon('Garchomp', { game: 'gen9', nature: 'Jolly', investment: table(4, 252, 0, 0, 0, 252) }),
      mon('Incineroar', { game: 'gen9', nature: 'Careful', investment: table(252, 4, 0, 0, 252, 0) }),
      DRAGON_CLAW,
    ),
  },
  {
    name: 'Gen 9: Tera Fire STAB on a non-STAB move',
    game: 'gen9',
    ctx: ctx(
      mon('Garchomp', { game: 'gen9', nature: 'Adamant', investment: table(4, 252, 0, 0, 0, 252), teraType: 'Fire' }),
      mon('Farigiraf', { game: 'gen9', nature: 'Bold', investment: table(252, 0, 252, 0, 4, 0) }),
      FIRE_FANG,
    ),
  },
  {
    name: 'Gen 9: Sword of Ruin (field flag)',
    game: 'gen9',
    ctx: ctx(
      mon('Garchomp', { game: 'gen9', nature: 'Adamant', investment: table(4, 252, 0, 0, 0, 252) }),
      mon('Farigiraf', { game: 'gen9', nature: 'Bold', investment: table(252, 0, 252, 0, 4, 0) }),
      DRAGON_CLAW,
      field({ isSwordOfRuin: true }),
    ),
  },
];

describe('calculate agrees with @smogon/calc on the full roll array', () => {
  it.each(CASES)('$name', ({ game = 'champions', ctx: c }) => {
    const expected = oracle(game, c);
    const result = calculate(c);
    expect(result.rolls).toEqual(expected.rolls);
    expect(result.defenderMaxHp).toBe(expected.maxHp);
  });
});

describe('calculate result shape', () => {
  const c = ctx(garchomp(), farigiraf(), DRAGON_CLAW);

  it('returns 16 non-decreasing rolls and min/max percent of max HP', () => {
    const result = calculate(c);
    expect(result.rolls).toHaveLength(16);
    expect([...result.rolls].sort((a, b) => a - b)).toEqual(result.rolls);
    expect(result.minPercent).toBeCloseTo((result.rolls[0]! / result.defenderMaxHp) * 100, 10);
    expect(result.maxPercent).toBeCloseTo((result.rolls[15]! / result.defenderMaxHp) * 100, 10);
  });

  it('returns all zero rolls for a Status move', () => {
    const result = calculate({ ...c, move: move('Protect', 'Normal', 0, 'Status', 'self') });
    expect(result.rolls).toEqual(new Array<number>(16).fill(0));
    expect(result.minPercent).toBe(0);
    expect(result.maxPercent).toBe(0);
  });

  it('keeps the roll floor at 85%', () => {
    expect(RANDOM_ROLL_FLOOR).toBe(85);
  });

  it('registers the damage chain in documented order', () => {
    expect(DAMAGE_CHAIN.map((m) => m.order)).toEqual([
      MODIFIER_ORDER.spread,
      MODIFIER_ORDER.weather,
      MODIFIER_ORDER.critical,
      MODIFIER_ORDER.stab,
      MODIFIER_ORDER.typeEffectiveness,
      MODIFIER_ORDER.burn,
      MODIFIER_ORDER.screens,
    ]);
  });
});
