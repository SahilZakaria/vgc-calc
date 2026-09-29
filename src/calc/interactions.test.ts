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
} from '../types';
import { calculate } from './calculate';

// Regression tests for interactions between alt-stat moves (Psyshock, Body
// Press, Foul Play), abilities, items, Ruin abilities and the Sand / Snow stat
// boosts. These seven Gen 9 cases were cross-checked against @smogon/calc
// 0.12.0 when the alt-stats and abilities-items branches were merged.
//
// Expected values come from @smogon/calc (the oracle), run on the same inputs
// through src/oracle/smogon-adapter.ts. Nothing is hard-coded from our own
// output.

const GAME = 'gen9' as const;

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp,
  atk,
  def,
  spa,
  spd,
  spe,
});

interface MonOptions {
  nature: string;
  evs: StatTable;
  ability?: string;
  item?: string;
  status?: Pokemon['status'];
}

// Builds a Gen 9 Pokemon from @smogon/calc's own dex entry so both calculators
// start from identical base stats. The default ability is one neither
// calculator acts on, so each case exercises only what it names.
function mon(species: string, opts: MonOptions): Pokemon {
  const dex = smogonGeneration(GAME).species.get(toID(species));
  if (!dex) throw new Error(`${species} missing from @smogon/calc ${GAME} dex`);
  return {
    species: dex.name,
    level: 50,
    types: [...dex.types] as TypeName[],
    isTerastallized: false,
    baseStats: { ...dex.baseStats },
    ivs: table(31, 31, 31, 31, 31, 31),
    evs: opts.evs,
    nature: opts.nature,
    ability: opts.ability ?? 'Pressure',
    abilitySuppressed: false,
    item: opts.item ?? null,
    weightKg: dex.weightkg,
    currentHp: null,
    statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    status: opts.status ?? 'none',
  };
}

type Extra = Partial<Omit<MonOptions, 'nature' | 'evs'>>;

// Standard Gen 9 spreads for the three roles the cases use.
const special = (species: string, o: Extra = {}): Pokemon =>
  mon(species, { nature: 'Modest', evs: table(4, 0, 0, 252, 0, 252), ...o });
const physical = (species: string, o: Extra = {}): Pokemon =>
  mon(species, { nature: 'Adamant', evs: table(4, 252, 0, 0, 0, 252), ...o });
const wall = (species: string, o: Extra = {}): Pokemon =>
  mon(species, { nature: 'Bold', evs: table(252, 0, 252, 0, 4, 0), ...o });

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

const field = (overrides: Partial<Omit<FieldState, 'attackerSide' | 'defenderSide'>> = {}): FieldState => ({
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
  ...overrides,
  attackerSide: side(),
  defenderSide: side(),
});

const ctx = (
  attacker: Pokemon,
  defender: Pokemon,
  m: Move,
  f: FieldState = field(),
  game: Game = 'gen9',
): DamageContext => ({
  game,
  attacker,
  defender,
  move: m,
  field: f,
  isCritical: false,
});

function oracle(c: DamageContext): { rolls: number[]; maxHp: number } {
  const defender = toSmogonPokemon(GAME, c.defender);
  const { damage } = smogonCalculate(
    smogonGeneration(GAME),
    toSmogonPokemon(GAME, c.attacker),
    defender,
    toSmogonMove(GAME, c.move, { isCrit: c.isCritical }),
    toSmogonField(c.field),
  );
  const rolls = typeof damage === 'number' ? new Array<number>(16).fill(damage) : damage.flat();
  return { rolls, maxHp: defender.maxHP() };
}

const PSYSHOCK = move('Psyshock', 'Psychic', 80, 'Special');
const POWER_GEM = move('Power Gem', 'Rock', 80, 'Special');
const BODY_PRESS = move('Body Press', 'Fighting', 80, 'Physical');
const FOUL_PLAY = move('Foul Play', 'Dark', 95, 'Physical');

const CASES: { name: string; ctx: DamageContext }[] = [
  {
    name: 'Psyshock into Assault Vest (AV does not boost the Def it targets)',
    ctx: ctx(special('Alakazam'), wall('Snorlax', { item: 'Assault Vest' }), PSYSHOCK),
  },
  {
    name: 'Psyshock into Assault Vest under Sword of Ruin (Ruin lowers the Def it targets)',
    ctx: ctx(special('Alakazam'), wall('Snorlax', { item: 'Assault Vest' }), PSYSHOCK, field({ isSwordOfRuin: true })),
  },
  {
    name: 'Choice Specs Psyshock into Assault Vest Tyranitar in sand (no SpD boosts apply)',
    ctx: ctx(
      special('Alakazam', { item: 'Choice Specs' }),
      wall('Tyranitar', { item: 'Assault Vest' }),
      PSYSHOCK,
      field({ weather: 'sand' }),
    ),
  },
  {
    name: 'Power Gem into Assault Vest Tyranitar in sand under Beads of Ruin',
    ctx: ctx(
      special('Alakazam'),
      wall('Tyranitar', { item: 'Assault Vest' }),
      POWER_GEM,
      field({ weather: 'sand', isBeadsOfRuin: true }),
    ),
  },
  {
    name: 'Body Press with Choice Band and Huge Power under Tablets of Ruin (none touch Def)',
    ctx: ctx(
      wall('Azumarill', { item: 'Choice Band', ability: 'Huge Power' }),
      wall('Snorlax'),
      BODY_PRESS,
      field({ isTabletsOfRuin: true }),
    ),
  },
  {
    name: 'Foul Play with Guts, Choice Band and burn into Thick Fat under Tablets of Ruin',
    ctx: ctx(
      physical('Ursaluna', { item: 'Choice Band', ability: 'Guts', status: 'brn' }),
      physical('Garchomp', { ability: 'Thick Fat' }),
      FOUL_PLAY,
      field({ isTabletsOfRuin: true }),
    ),
  },
  {
    name: 'Body Press into an Ice type in snow under Sword of Ruin',
    ctx: ctx(
      wall('Corviknight', { item: 'Life Orb' }),
      wall('Abomasnow'),
      BODY_PRESS,
      field({ weather: 'snow', isSwordOfRuin: true }),
    ),
  },
];

describe('alt-stat, ability, item, Ruin and weather interactions agree with @smogon/calc', () => {
  it.each(CASES)('$name', ({ ctx: c }) => {
    const expected = oracle(c);
    const result = calculate(c);
    expect(result.rolls).toEqual(expected.rolls);
    expect(result.defenderMaxHp).toBe(expected.maxHp);
  });
});
