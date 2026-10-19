import { calculate as smogonCalculate, toID } from '@smogon/calc';
import { describe, expect, it } from 'vitest';
// Test-only use of the oracle adapter; src/calc itself never imports it.
import {
  smogonGeneration,
  toSmogonField,
  toSmogonMove,
  toSmogonPokemon,
} from '../../oracle/smogon-adapter';
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
} from '../../types';
import { calculate } from '../calculate';
import {
  BATTERY_BOOST,
  batteryMultiplier,
  FRIEND_GUARD_REDUCTION,
  friendGuardMultiplier,
  HELPING_HAND_BOOST,
  helpingHandMultiplier,
  POWER_SPOT_BOOST,
  powerSpotMultiplier,
  STEELY_SPIRIT_BOOST,
  steelySpiritMultiplier,
} from './ally';

// Helping Hand, Friend Guard, Battery, Power Spot and an ally's Steely Spirit.
//
// Expected rolls come from @smogon/calc 0.12.0 (the oracle), run on the same
// inputs through src/oracle/smogon-adapter.ts. Every case compares all 16
// rolls. The constant checks below are the literal values @smogon/calc pushes
// (dist/mechanics/gen789.js and champions.js), not values from our own code.

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp,
  atk,
  def,
  spa,
  spd,
  spe,
});

interface MonOptions {
  ability?: string;
  item?: string;
}

// 252 / 252 / 4 EVs is 32 / 32 / 1 SP, valid in both games.
const ATTACK_SPREAD = table(4, 252, 0, 252, 0, 0);
const BULK_SPREAD = table(252, 0, 252, 0, 4, 0);

function mon(game: Game, species: string, evs: StatTable, opts: MonOptions = {}): Pokemon {
  const dex = smogonGeneration(game).species.get(toID(species));
  if (!dex) throw new Error(`${species} missing from @smogon/calc ${game} dex`);
  return {
    species: dex.name,
    level: 50,
    types: [...dex.types] as TypeName[],
    isTerastallized: false,
    baseStats: { ...dex.baseStats },
    ivs: table(31, 31, 31, 31, 31, 31),
    evs,
    nature: 'Hardy',
    ability: opts.ability ?? 'Pressure',
    abilitySuppressed: false,
    item: opts.item ?? null,
    weightKg: dex.weightkg,
    currentHp: null,
    statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
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
      contact: false,
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

interface FieldOptions {
  attacker?: Partial<SideState>;
  defender?: Partial<SideState>;
  terrain?: FieldState['terrain'];
  isTabletsOfRuin?: boolean;
}

const field = (o: FieldOptions = {}): FieldState => ({
  weather: 'none',
  terrain: o.terrain ?? 'none',
  isDoubles: true,
  isGravity: false,
  isWonderRoom: false,
  isMagicRoom: false,
  isBeadsOfRuin: false,
  isSwordOfRuin: false,
  isTabletsOfRuin: o.isTabletsOfRuin ?? false,
  isVesselOfRuin: false,
  attackerSide: side(o.attacker),
  defenderSide: side(o.defender),
});

const ctx = (
  game: Game,
  attacker: Pokemon,
  defender: Pokemon,
  m: Move,
  f: FieldState,
  isCritical = false,
): DamageContext => ({ game, attacker, defender, move: m, field: f, isCritical });

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

const BODY_SLAM = move('Body Slam', 'Normal', 85, 'Physical');
const SLUDGE_BOMB = move('Sludge Bomb', 'Poison', 90, 'Special');
const THUNDERBOLT = move('Thunderbolt', 'Electric', 90, 'Special');
const THUNDER_SHOCK = move('Thunder Shock', 'Electric', 40, 'Special');
const IRON_HEAD = move('Iron Head', 'Steel', 80, 'Physical');
const BULLET_PUNCH = move('Bullet Punch', 'Steel', 40, 'Physical');
const EARTHQUAKE = move('Earthquake', 'Ground', 100, 'Physical');
const ROCK_SLIDE = move('Rock Slide', 'Rock', 75, 'Physical');
const ELECTROWEB: Move = { ...move('Electroweb', 'Electric', 55, 'Special'), target: 'allAdjacentFoes' };

// CHAIN POSITION
// util.js chainMods rounds after every multiplier, but for most stacks the
// order still makes no difference. The cases tagged "position" were found by
// searching every combination of the chain modifiers this calculator supports
// for one where moving the ally multiplier past the item boost changes a roll
// at level 50.
// Battery and Power Spot only expose their slot at base powers no real move
// has, so those two cases use a synthetic base power on a real move; both
// calculators take base power as given. An ally Steely Spirit's slot is never
// observable with the attack-stat modifiers this calculator supports.
const DRAGON_PULSE_150 = move('Dragon Pulse', 'Dragon', 150, 'Special');
const DRAGON_CLAW_150 = move('Dragon Claw', 'Dragon', 150, 'Physical');

interface Case {
  name: string;
  ctx: DamageContext;
  /** True when the flag must change the result (guards against a vacuous pass). */
  changes: boolean;
}

/** The same case with every ally flag cleared, to check `changes`. */
function withoutAllyFlags(c: DamageContext): DamageContext {
  const clear = { helpingHand: false, friendGuard: false, battery: false, powerSpot: false, steelySpirit: false };
  return {
    ...c,
    field: {
      ...c.field,
      attackerSide: { ...c.field.attackerSide, ...clear },
      defenderSide: { ...c.field.defenderSide, ...clear },
    },
  };
}

function gen9Cases(): Case[] {
  const g: Game = 'gen9';
  const garchomp = mon(g, 'Garchomp', ATTACK_SPREAD);
  const gengar = mon(g, 'Gengar', ATTACK_SPREAD);
  const raichu = mon(g, 'Raichu', ATTACK_SPREAD);
  const snorlax = mon(g, 'Snorlax', BULK_SPREAD);
  const metagross = mon(g, 'Metagross', ATTACK_SPREAD);
  return [
    {
      name: 'Helping Hand boosts a physical move',
      ctx: ctx(g, garchomp, snorlax, BODY_SLAM, field({ attacker: { helpingHand: true } })),
      changes: true,
    },
    {
      name: 'Helping Hand boosts a special move',
      ctx: ctx(g, gengar, snorlax, SLUDGE_BOMB, field({ attacker: { helpingHand: true } })),
      changes: true,
    },
    {
      name: 'Helping Hand chains before terrain, Technician and a type item',
      ctx: ctx(
        g,
        mon(g, 'Raichu', ATTACK_SPREAD, { ability: 'Technician', item: 'Magnet' }),
        snorlax,
        THUNDER_SHOCK,
        field({ attacker: { helpingHand: true }, terrain: 'electric' }),
      ),
      changes: true,
    },
    {
      name: 'Helping Hand on the defender side does nothing',
      ctx: ctx(g, garchomp, snorlax, BODY_SLAM, field({ defender: { helpingHand: true } })),
      changes: false,
    },
    {
      name: 'Battery boosts a special move',
      ctx: ctx(g, raichu, snorlax, THUNDERBOLT, field({ attacker: { battery: true } })),
      changes: true,
    },
    {
      name: 'Battery does not boost a physical move',
      ctx: ctx(g, garchomp, snorlax, BODY_SLAM, field({ attacker: { battery: true } })),
      changes: false,
    },
    {
      name: 'Power Spot boosts a physical move',
      ctx: ctx(g, garchomp, snorlax, EARTHQUAKE, field({ attacker: { powerSpot: true } })),
      changes: true,
    },
    {
      name: 'Power Spot boosts a special move',
      ctx: ctx(g, gengar, snorlax, SLUDGE_BOMB, field({ attacker: { powerSpot: true } })),
      changes: true,
    },
    {
      name: 'Helping Hand, terrain, Technician, Battery, Power Spot and a type item all chain',
      ctx: ctx(
        g,
        mon(g, 'Raichu', ATTACK_SPREAD, { ability: 'Technician', item: 'Magnet' }),
        snorlax,
        THUNDER_SHOCK,
        field({ attacker: { helpingHand: true, battery: true, powerSpot: true }, terrain: 'electric' }),
      ),
      changes: true,
    },
    {
      name: 'Steely Spirit boosts a Steel move',
      ctx: ctx(g, metagross, snorlax, IRON_HEAD, field({ attacker: { steelySpirit: true } })),
      changes: true,
    },
    {
      name: 'Steely Spirit does not boost a non-Steel move',
      ctx: ctx(g, metagross, snorlax, EARTHQUAKE, field({ attacker: { steelySpirit: true } })),
      changes: false,
    },
    {
      name: 'Steely Spirit chains with Huge Power, Tablets of Ruin and Choice Band',
      ctx: ctx(
        g,
        mon(g, 'Scizor', ATTACK_SPREAD, { ability: 'Huge Power', item: 'Choice Band' }),
        snorlax,
        BULLET_PUNCH,
        field({ attacker: { steelySpirit: true, helpingHand: true }, isTabletsOfRuin: true }),
      ),
      changes: true,
    },
    {
      name: 'Friend Guard reduces a physical hit',
      ctx: ctx(g, garchomp, snorlax, BODY_SLAM, field({ defender: { friendGuard: true } })),
      changes: true,
    },
    {
      name: 'Friend Guard reduces a special hit',
      ctx: ctx(g, gengar, snorlax, SLUDGE_BOMB, field({ defender: { friendGuard: true } })),
      changes: true,
    },
    {
      name: 'Friend Guard chains with Reflect, Solid Rock and Expert Belt',
      ctx: ctx(
        g,
        mon(g, 'Garchomp', ATTACK_SPREAD, { item: 'Expert Belt' }),
        mon(g, 'Tyranitar', BULK_SPREAD, { ability: 'Solid Rock' }),
        EARTHQUAKE,
        field({ defender: { friendGuard: true, reflect: true } }),
      ),
      changes: true,
    },
    {
      name: 'Friend Guard still applies on a critical hit',
      ctx: ctx(g, garchomp, snorlax, BODY_SLAM, field({ defender: { friendGuard: true, reflect: true } }), true),
      changes: true,
    },
    {
      name: 'Friend Guard on the attacker side does nothing',
      ctx: ctx(g, garchomp, snorlax, BODY_SLAM, field({ attacker: { friendGuard: true } })),
      changes: false,
    },
    {
      name: 'Helping Hand against Friend Guard on a spread move',
      ctx: ctx(
        g,
        garchomp,
        snorlax,
        { ...ROCK_SLIDE, target: 'allAdjacentFoes' },
        field({ attacker: { helpingHand: true }, defender: { friendGuard: true } }),
      ),
      changes: true,
    },
    {
      name: 'position: Helping Hand chains before a type item (Technician Magnet Electroweb)',
      ctx: ctx(
        g,
        mon(g, 'Raichu', ATTACK_SPREAD, { ability: 'Technician', item: 'Magnet' }),
        snorlax,
        ELECTROWEB,
        field({ attacker: { helpingHand: true } }),
      ),
      changes: true,
    },
    {
      name: 'position: Battery chains before a type item (Helping Hand, Misty Terrain, Dragon Fang)',
      ctx: ctx(
        g,
        mon(g, 'Gengar', ATTACK_SPREAD, { item: 'Dragon Fang' }),
        snorlax,
        DRAGON_PULSE_150,
        field({ attacker: { helpingHand: true, battery: true }, terrain: 'misty' }),
      ),
      changes: true,
    },
    {
      name: 'position: Power Spot chains before a type item (Helping Hand, Misty Terrain, Dragon Fang)',
      ctx: ctx(
        g,
        mon(g, 'Garchomp', ATTACK_SPREAD, { item: 'Dragon Fang' }),
        snorlax,
        DRAGON_CLAW_150,
        field({ attacker: { helpingHand: true, powerSpot: true }, terrain: 'misty' }),
      ),
      changes: true,
    },
    {
      name: 'position: Friend Guard chains before Expert Belt (Multiscale)',
      ctx: ctx(
        g,
        mon(g, 'Raichu', ATTACK_SPREAD, { item: 'Expert Belt' }),
        mon(g, 'Tyranitar', BULK_SPREAD, { ability: 'Multiscale' }),
        EARTHQUAKE,
        field({ defender: { friendGuard: true } }),
      ),
      changes: true,
    },
  ];
}

function championsCases(): Case[] {
  const g: Game = 'champions';
  const garchomp = mon(g, 'Garchomp', ATTACK_SPREAD);
  const gengar = mon(g, 'Gengar', ATTACK_SPREAD);
  const raichu = mon(g, 'Raichu', ATTACK_SPREAD);
  const snorlax = mon(g, 'Snorlax', BULK_SPREAD);
  const metagross = mon(g, 'Metagross', ATTACK_SPREAD);
  return [
    {
      name: 'Champions: Helping Hand boosts a physical move',
      ctx: ctx(g, garchomp, snorlax, BODY_SLAM, field({ attacker: { helpingHand: true } })),
      changes: true,
    },
    {
      name: 'Champions: Helping Hand chains before terrain and a type item',
      ctx: ctx(
        g,
        mon(g, 'Raichu', ATTACK_SPREAD, { ability: 'Technician', item: 'Magnet' }),
        snorlax,
        THUNDER_SHOCK,
        field({ attacker: { helpingHand: true }, terrain: 'electric' }),
      ),
      changes: true,
    },
    {
      name: 'Champions: Friend Guard reduces a special hit',
      ctx: ctx(g, gengar, snorlax, SLUDGE_BOMB, field({ defender: { friendGuard: true } })),
      changes: true,
    },
    {
      name: 'Champions: Friend Guard chains with Light Screen',
      ctx: ctx(g, gengar, snorlax, SLUDGE_BOMB, field({ defender: { friendGuard: true, lightScreen: true } })),
      changes: true,
    },
    {
      name: 'Champions position: Helping Hand chains before a type item',
      ctx: ctx(
        g,
        mon(g, 'Raichu', ATTACK_SPREAD, { ability: 'Technician', item: 'Magnet' }),
        snorlax,
        ELECTROWEB,
        field({ attacker: { helpingHand: true } }),
      ),
      changes: true,
    },
    {
      name: 'Champions position: Friend Guard chains before Expert Belt (Multiscale)',
      ctx: ctx(
        g,
        mon(g, 'Raichu', ATTACK_SPREAD, { item: 'Expert Belt' }),
        mon(g, 'Tyranitar', BULK_SPREAD, { ability: 'Multiscale' }),
        EARTHQUAKE,
        field({ defender: { friendGuard: true } }),
      ),
      changes: true,
    },
    // champions.js has no Battery, Power Spot or ally Steely Spirit code. See ally.ts.
    {
      name: 'Champions: Battery does nothing',
      ctx: ctx(g, raichu, snorlax, THUNDERBOLT, field({ attacker: { battery: true } })),
      changes: false,
    },
    {
      name: 'Champions: Power Spot does nothing',
      ctx: ctx(g, garchomp, snorlax, EARTHQUAKE, field({ attacker: { powerSpot: true } })),
      changes: false,
    },
    {
      name: 'Champions: an ally Steely Spirit does nothing',
      ctx: ctx(g, metagross, snorlax, IRON_HEAD, field({ attacker: { steelySpirit: true } })),
      changes: false,
    },
  ];
}

const CASES: Case[] = [...gen9Cases(), ...championsCases()];

describe('ally side flags agree with @smogon/calc on every roll', () => {
  it.each(CASES)('$name', ({ ctx: c, changes }) => {
    const expected = oracleRolls(c);
    expect(calculate(c).rolls).toEqual(expected);
    // The oracle itself must show the flag mattering (or not) as the case claims.
    const baseline = oracleRolls(withoutAllyFlags(c));
    if (changes) expect(expected).not.toEqual(baseline);
    else expect(expected).toEqual(baseline);
  });
});

describe('ally multipliers', () => {
  it('use the values @smogon/calc pushes', () => {
    // gen789.js: bpMods.push(6144) / push(5325) / push(5325), atMods.push(6144),
    // finalMods.push(3072).
    expect(HELPING_HAND_BOOST).toBe(6144);
    expect(BATTERY_BOOST).toBe(5325);
    expect(POWER_SPOT_BOOST).toBe(5325);
    expect(STEELY_SPIRIT_BOOST).toBe(6144);
    expect(FRIEND_GUARD_REDUCTION).toBe(3072);
  });

  it('are neutral when no flag is set', () => {
    const c = ctx('gen9', mon('gen9', 'Metagross', ATTACK_SPREAD), mon('gen9', 'Snorlax', BULK_SPREAD), IRON_HEAD, field());
    for (const f of [helpingHandMultiplier, batteryMultiplier, powerSpotMultiplier, steelySpiritMultiplier, friendGuardMultiplier]) {
      expect(f(c)).toBe(4096);
    }
  });
});
