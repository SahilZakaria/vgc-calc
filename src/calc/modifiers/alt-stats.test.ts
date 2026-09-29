import { calculate as smogonCalculate, toID } from '@smogon/calc';
import { describe, expect, it } from 'vitest';
// Test-only use of the oracle adapter; alt-stats.ts and calculate.ts never import it.
import {
  smogonGeneration,
  toSmogonField,
  toSmogonMove,
  toSmogonPokemon,
  type OracleGame,
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
import { defensiveStat, hitsPhysicalDefense, ignoresDefensiveStages, offensiveStat } from './alt-stats';

// Expected values come from @smogon/calc 0.12.0 (the oracle), run on the same
// inputs through src/oracle/smogon-adapter.ts, and from its move data. Nothing
// is hard-coded from our own output.

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
const spToEvs = (sp: StatTable): StatTable =>
  table(spToEv(sp.hp), spToEv(sp.atk), spToEv(sp.def), spToEv(sp.spa), spToEv(sp.spd), spToEv(sp.spe));

interface MonOptions {
  game?: OracleGame;
  nature?: string;
  /** Stat Points in Champions, EVs in Gen 9. */
  investment?: StatTable;
  ability?: string;
  boosts?: Partial<Pokemon['statBoosts']>;
}

// Builds a Pokemon from @smogon/calc's own dex entry so both calculators start
// from identical base stats. The default ability is one neither calculator
// acts on.
function mon(species: string, opts: MonOptions = {}): Pokemon {
  const game = opts.game ?? 'champions';
  const dex = smogonGeneration(game).species.get(toID(species));
  if (!dex) throw new Error(`${species} missing from @smogon/calc ${game} dex`);
  const investment = opts.investment ?? table(0, 0, 0, 0, 0, 0);
  return {
    species: dex.name,
    level: 50,
    types: [...dex.types] as TypeName[],
    isTerastallized: false,
    baseStats: { ...dex.baseStats },
    ivs: table(31, 31, 31, 31, 31, 31),
    evs: game === 'champions' ? spToEvs(investment) : investment,
    nature: opts.nature ?? 'Hardy',
    ability: opts.ability ?? 'Pressure',
    abilitySuppressed: false,
    item: null,
    weightKg: dex.weightkg,
    currentHp: null,
    statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...opts.boosts },
    status: 'none',
  };
}

function move(name: string, type: TypeName, basePower: number, category: MoveCategory, contact: boolean): Move {
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
      contact,
      punch: false,
      sound: false,
      slicing: name === 'Secret Sword',
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

function field(
  overrides: Partial<Omit<FieldState, 'attackerSide' | 'defenderSide'>> & {
    defenderSide?: Partial<SideState>;
  } = {},
): FieldState {
  const { defenderSide, ...rest } = overrides;
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
    attackerSide: side(),
    defenderSide: side(defenderSide),
  };
}

function oracleRolls(game: OracleGame, c: DamageContext): number[] {
  const result = smogonCalculate(
    smogonGeneration(game),
    toSmogonPokemon(game, c.attacker),
    toSmogonPokemon(game, c.defender),
    toSmogonMove(game, c.move, { isCrit: c.isCritical }),
    toSmogonField(c.field),
  );
  const { damage } = result;
  return typeof damage === 'number' ? new Array<number>(16).fill(damage) : damage.flat();
}

const ctx = (
  attacker: Pokemon,
  defender: Pokemon,
  m: Move,
  f: FieldState = field(),
  isCritical = false,
  game: Game = 'gen9',
): DamageContext => ({ game, attacker, defender, move: m, field: f, isCritical });

// Move data (base power, type, category, contact) matches @smogon/calc's dex.
const FOUL_PLAY = move('Foul Play', 'Dark', 95, 'Physical', true);
const BODY_PRESS = move('Body Press', 'Fighting', 80, 'Physical', true);
const PSYSHOCK = move('Psyshock', 'Psychic', 80, 'Special', false);
const PSYSTRIKE = move('Psystrike', 'Psychic', 100, 'Special', false);
const SECRET_SWORD = move('Secret Sword', 'Fighting', 85, 'Special', false);
const PSYCHIC = move('Psychic', 'Psychic', 90, 'Special', false);
const CLOSE_COMBAT = move('Close Combat', 'Fighting', 120, 'Physical', true);
const SACRED_SWORD = move('Sacred Sword', 'Fighting', 90, 'Physical', true);
const DARKEST_LARIAT = move('Darkest Lariat', 'Dark', 85, 'Physical', true);
const CHIP_AWAY = move('Chip Away', 'Normal', 70, 'Physical', true);

// Champions sets (Stat Points; legal: <= 32 per stat, <= 66 total).
const umbreon = (o: MonOptions = {}): Pokemon =>
  mon('Umbreon', { nature: 'Calm', investment: table(32, 0, 2, 0, 32, 0), ...o });
const garchomp = (o: MonOptions = {}): Pokemon =>
  mon('Garchomp', { nature: 'Jolly', investment: table(2, 32, 0, 0, 0, 32), ...o });
const kingambit = (o: MonOptions = {}): Pokemon =>
  mon('Kingambit', { nature: 'Adamant', investment: table(32, 32, 2, 0, 0, 0), ...o });
const corviknight = (o: MonOptions = {}): Pokemon =>
  mon('Corviknight', { nature: 'Impish', investment: table(32, 0, 32, 0, 2, 0), ...o });
const avalugg = (o: MonOptions = {}): Pokemon =>
  mon('Avalugg', { nature: 'Relaxed', investment: table(32, 0, 32, 0, 2, 0), ...o });
const incineroar = (o: MonOptions = {}): Pokemon =>
  mon('Incineroar', { nature: 'Careful', investment: table(32, 2, 0, 0, 32, 0), ...o });
const hatterene = (o: MonOptions = {}): Pokemon =>
  mon('Hatterene', { nature: 'Quiet', investment: table(32, 0, 2, 32, 0, 0), ...o });
const sneasler = (o: MonOptions = {}): Pokemon =>
  mon('Sneasler', { nature: 'Jolly', investment: table(2, 32, 0, 0, 0, 32), ...o });
// Low Def, high SpD target so a Def-vs-SpD mix-up shows up in the rolls.
const farigiraf = (o: MonOptions = {}): Pokemon =>
  mon('Farigiraf', { nature: 'Calm', investment: table(32, 0, 0, 0, 32, 0), ...o });

// Gen 9 sets (EVs) for moves and abilities missing from Champions.
const g9 = (species: string, nature: string, evs: StatTable, o: MonOptions = {}): Pokemon =>
  mon(species, { game: 'gen9', nature, investment: evs, ...o });
const mewtwo = (o: MonOptions = {}): Pokemon => g9('Mewtwo', 'Timid', table(4, 0, 0, 252, 0, 252), o);
const keldeo = (o: MonOptions = {}): Pokemon => g9('Keldeo', 'Modest', table(4, 0, 0, 252, 0, 252), o);
const blissey = (o: MonOptions = {}): Pokemon => g9('Blissey', 'Calm', table(252, 0, 4, 0, 252, 0), o);
const chienPao = (o: MonOptions = {}): Pokemon =>
  g9('Chien-Pao', 'Jolly', table(4, 252, 0, 0, 0, 252), { ability: 'Sword of Ruin', ...o });
const tingLu = (o: MonOptions = {}): Pokemon =>
  g9('Ting-Lu', 'Careful', table(252, 4, 0, 0, 252, 0), { ability: 'Vessel of Ruin', ...o });
const corviknight9 = (o: MonOptions = {}): Pokemon => g9('Corviknight', 'Impish', table(252, 0, 252, 0, 4, 0), o);

describe('stat selection matches @smogon/calc move data', () => {
  const dex = smogonGeneration('gen9').moves;

  it('Foul Play uses the target as the offensive Pokemon', () => {
    expect(dex.get(toID('Foul Play'))?.overrideOffensivePokemon).toBe('target');
    expect(offensiveStat(FOUL_PLAY)).toEqual({ source: 'defender', stat: 'atk' });
    expect(defensiveStat(FOUL_PLAY)).toBe('def');
  });

  it('Body Press uses the user\'s Def', () => {
    expect(dex.get(toID('Body Press'))?.overrideOffensiveStat).toBe('def');
    expect(offensiveStat(BODY_PRESS)).toEqual({ source: 'attacker', stat: 'def' });
    expect(defensiveStat(BODY_PRESS)).toBe('def');
  });

  it.each([PSYSHOCK, PSYSTRIKE, SECRET_SWORD])('$name is special but hits Def', (m) => {
    expect(dex.get(toID(m.name))?.overrideDefensiveStat).toBe('def');
    expect(dex.get(toID(m.name))?.category).toBe('Special');
    expect(offensiveStat(m)).toEqual({ source: 'attacker', stat: 'spa' });
    expect(defensiveStat(m)).toBe('def');
    expect(hitsPhysicalDefense(m)).toBe(true);
  });

  it('ordinary moves follow their category', () => {
    expect(offensiveStat(PSYCHIC)).toEqual({ source: 'attacker', stat: 'spa' });
    expect(defensiveStat(PSYCHIC)).toBe('spd');
    expect(hitsPhysicalDefense(PSYCHIC)).toBe(false);
    expect(offensiveStat(CLOSE_COMBAT)).toEqual({ source: 'attacker', stat: 'atk' });
    expect(defensiveStat(CLOSE_COMBAT)).toBe('def');
  });

  it.each(['champions', 'gen9'] as const)('ignoresDefensiveStages matches the %s ignoreDefensive flag', (game) => {
    for (const m of smogonGeneration(game).moves) {
      expect(ignoresDefensiveStages({ ...CLOSE_COMBAT, name: m.name }), m.name).toBe(m.ignoreDefensive === true);
    }
  });
});

interface Case {
  name: string;
  game?: OracleGame;
  ctx: DamageContext;
}

const CASES: Case[] = [
  // Foul Play: the defender's Atk, stages and nature decide the damage.
  { name: 'Foul Play into a high-Atk target', ctx: ctx(umbreon(), garchomp(), FOUL_PLAY) },
  { name: 'Foul Play into a low-Atk target', ctx: ctx(umbreon(), hatterene(), FOUL_PLAY) },
  { name: 'Foul Play ignores the user\'s +2 Atk', ctx: ctx(umbreon({ boosts: { atk: 2 } }), garchomp(), FOUL_PLAY) },
  { name: 'Foul Play uses the target\'s +2 Atk', ctx: ctx(umbreon(), garchomp({ boosts: { atk: 2 } }), FOUL_PLAY) },
  { name: 'Foul Play uses the target\'s -1 Atk', ctx: ctx(umbreon(), garchomp({ boosts: { atk: -1 } }), FOUL_PLAY) },
  { name: 'Foul Play crit ignores the target\'s -1 Atk', ctx: ctx(umbreon(), garchomp({ boosts: { atk: -1 } }), FOUL_PLAY, field(), true) },
  { name: 'Foul Play crit keeps the target\'s +2 Atk', ctx: ctx(umbreon(), kingambit({ boosts: { atk: 2 } }), FOUL_PLAY, field(), true) },
  { name: 'Foul Play under Wonder Room (Atk unaffected, Def swapped)', ctx: ctx(umbreon(), garchomp(), FOUL_PLAY, field({ isWonderRoom: true })) },
  { name: 'Foul Play into Reflect', ctx: ctx(umbreon(), garchomp(), FOUL_PLAY, field({ defenderSide: { reflect: true } })) },

  // Body Press: the user's Def and Def stages.
  { name: 'Body Press from a high-Def user', ctx: ctx(corviknight(), kingambit(), BODY_PRESS) },
  { name: 'Body Press from Avalugg into Incineroar', ctx: ctx(avalugg(), incineroar(), BODY_PRESS) },
  { name: 'Body Press ignores the user\'s -2 Atk', ctx: ctx(corviknight({ boosts: { atk: -2 } }), kingambit(), BODY_PRESS) },
  { name: 'Body Press uses the user\'s +2 Def', ctx: ctx(corviknight({ boosts: { def: 2 } }), kingambit(), BODY_PRESS) },
  { name: 'Body Press crit ignores the user\'s -1 Def', ctx: ctx(corviknight({ boosts: { def: -1 } }), kingambit(), BODY_PRESS, field(), true) },
  { name: 'Body Press into the target\'s +1 Def', ctx: ctx(avalugg(), incineroar({ boosts: { def: 1 } }), BODY_PRESS) },

  // Psyshock: special attack against Def.
  { name: 'Psyshock into a low-Def, high-SpD target', ctx: ctx(hatterene(), sneasler(), PSYSHOCK) },
  { name: 'Psyshock into Farigiraf (Def 0 SP, SpD 32 SP)', ctx: ctx(hatterene(), farigiraf(), PSYSHOCK) },
  { name: 'Psyshock uses the target\'s +2 Def', ctx: ctx(hatterene(), farigiraf({ boosts: { def: 2 } }), PSYSHOCK) },
  { name: 'Psyshock ignores the target\'s +2 SpD', ctx: ctx(hatterene(), farigiraf({ boosts: { spd: 2 } }), PSYSHOCK) },
  { name: 'Psyshock crit ignores the target\'s +2 Def', ctx: ctx(hatterene(), farigiraf({ boosts: { def: 2 } }), PSYSHOCK, field(), true) },
  { name: 'Psyshock into Light Screen (screens follow the category)', ctx: ctx(hatterene(), farigiraf(), PSYSHOCK, field({ defenderSide: { lightScreen: true } })) },
  { name: 'Psyshock into Reflect (no reduction)', ctx: ctx(hatterene(), farigiraf(), PSYSHOCK, field({ defenderSide: { reflect: true } })) },
  { name: 'Psyshock under Wonder Room (hits the swapped-in SpD)', ctx: ctx(hatterene(), farigiraf(), PSYSHOCK, field({ isWonderRoom: true })) },

  // Gen 9: moves missing from Champions.
  { name: 'Psystrike into Blissey', game: 'gen9', ctx: ctx(mewtwo(), blissey(), PSYSTRIKE) },
  { name: 'Psystrike ignores Blissey\'s +6 SpD', game: 'gen9', ctx: ctx(mewtwo(), blissey({ boosts: { spd: 6 } }), PSYSTRIKE) },
  { name: 'Secret Sword into Blissey', game: 'gen9', ctx: ctx(keldeo(), blissey(), SECRET_SWORD) },
  { name: 'Secret Sword into Corviknight', game: 'gen9', ctx: ctx(keldeo(), corviknight9(), SECRET_SWORD) },
  { name: 'Foul Play in Gen 9', game: 'gen9', ctx: ctx(g9('Umbreon', 'Calm', table(252, 0, 4, 0, 252, 0)), chienPao(), FOUL_PLAY) },
  { name: 'Body Press in Gen 9', game: 'gen9', ctx: ctx(corviknight9(), blissey(), BODY_PRESS) },

  // Ruin abilities: attack side follows the category, defense side the stat hit.
  { name: 'Psyshock + Sword of Ruin lowers the Def it hits', game: 'gen9', ctx: ctx(chienPao(), blissey(), PSYSHOCK) },
  { name: 'Psyshock + Beads of Ruin does nothing', game: 'gen9', ctx: ctx(mewtwo(), blissey(), PSYSHOCK, field({ isBeadsOfRuin: true })) },
  { name: 'Psyshock + Vessel of Ruin lowers SpA', game: 'gen9', ctx: ctx(mewtwo(), tingLu(), PSYSHOCK) },
  { name: 'Body Press + Tablets of Ruin (category Physical)', game: 'gen9', ctx: ctx(corviknight9(), blissey(), BODY_PRESS, field({ isTabletsOfRuin: true })) },
  { name: 'Foul Play + Tablets of Ruin', game: 'gen9', ctx: ctx(g9('Umbreon', 'Calm', table(252, 0, 4, 0, 252, 0)), chienPao(), FOUL_PLAY, field({ isTabletsOfRuin: true })) },
  { name: 'Foul Play + Sword of Ruin on the defender side', game: 'gen9', ctx: ctx(g9('Umbreon', 'Calm', table(252, 0, 4, 0, 252, 0)), blissey(), FOUL_PLAY, field({ isSwordOfRuin: true })) },

  // ignoreDefensive moves: the target's Def stages, raised or lowered, are skipped.
  { name: 'Sacred Sword ignores the target\'s +2 Def', ctx: ctx(garchomp(), corviknight({ boosts: { def: 2 } }), SACRED_SWORD, field(), false, 'champions') },
  { name: 'Sacred Sword ignores the target\'s -2 Def', ctx: ctx(garchomp(), corviknight({ boosts: { def: -2 } }), SACRED_SWORD, field(), false, 'champions') },
  { name: 'Darkest Lariat ignores the target\'s +6 Def', ctx: ctx(incineroar(), avalugg({ boosts: { def: 6 } }), DARKEST_LARIAT, field(), false, 'champions') },
  { name: 'Darkest Lariat still uses the user\'s +2 Atk', ctx: ctx(incineroar({ boosts: { atk: 2 } }), avalugg({ boosts: { def: 2 } }), DARKEST_LARIAT, field(), false, 'champions') },
  { name: 'Sacred Sword into +2 Def Avalugg in Snow keeps the Snow boost', ctx: ctx(garchomp(), avalugg({ boosts: { def: 2 } }), SACRED_SWORD, field({ weather: 'snow' }), false, 'champions') },
  { name: 'Chip Away ignores the target\'s +2 Def', game: 'gen9', ctx: ctx(g9('Snorlax', 'Adamant', table(4, 252, 0, 0, 252, 0)), corviknight9({ boosts: { def: 2 } }), CHIP_AWAY) },
  { name: 'Sacred Sword ignores the target\'s +1 Def in Gen 9', game: 'gen9', ctx: ctx(g9('Gallade', 'Adamant', table(4, 252, 0, 0, 0, 252)), corviknight9({ boosts: { def: 1 } }), SACRED_SWORD) },
  { name: 'Darkest Lariat ignores the target\'s -1 Def in Gen 9', game: 'gen9', ctx: ctx(g9('Incineroar', 'Adamant', table(252, 252, 0, 0, 4, 0)), blissey({ boosts: { def: -1 } }), DARKEST_LARIAT) },
];

describe('calculate() with stat-overriding moves matches @smogon/calc roll for roll', () => {
  it.each(CASES)('$name', ({ game = 'champions', ctx: c }) => {
    expect(calculate(c).rolls).toEqual(oracleRolls(game, c));
  });

  it('each override changes the result versus the same move without it', () => {
    // Guards against cases that pass only because the override is a no-op.
    const renamed = (c: DamageContext): DamageContext => ({ ...c, move: { ...c.move, name: `Not ${c.move.name}` } });
    for (const c of [
      ctx(umbreon(), garchomp(), FOUL_PLAY),
      ctx(corviknight(), kingambit(), BODY_PRESS),
      ctx(hatterene(), farigiraf(), PSYSHOCK),
    ]) {
      expect(oracleRolls('champions', c)).not.toEqual(oracleRolls('champions', renamed(c)));
    }
  });

  it('ignoring Def stages changes the result versus an ordinary move', () => {
    const renamed = (c: DamageContext): DamageContext => ({ ...c, move: { ...c.move, name: `Not ${c.move.name}` } });
    const champions = [
      ctx(garchomp(), corviknight({ boosts: { def: 2 } }), SACRED_SWORD, field(), false, 'champions'),
      ctx(incineroar(), avalugg({ boosts: { def: 6 } }), DARKEST_LARIAT, field(), false, 'champions'),
    ];
    for (const c of champions) {
      expect(oracleRolls('champions', c)).not.toEqual(oracleRolls('champions', renamed(c)));
    }
    const chipAway = ctx(g9('Snorlax', 'Adamant', table(4, 252, 0, 0, 252, 0)), corviknight9({ boosts: { def: 2 } }), CHIP_AWAY);
    expect(oracleRolls('gen9', chipAway)).not.toEqual(oracleRolls('gen9', renamed(chipAway)));
  });
});

/**
 * KNOWN DISAGREEMENT: Body Press under Wonder Room.
 *
 * Pokemon Showdown (sim/pokemon.ts calculateStat, sim/battle-actions.ts
 * getDamage) reads Body Press as stat 'def' with Def stages, and Wonder Room
 * makes calculateStat('def') return the stored SpD: raw SpD, Def stages.
 * This module follows that, consistent with calculate.ts's Wonder Room rule
 * (raw Def and SpD swap, stages follow the stat name).
 *
 * @smogon/calc 0.12.0 (gen789.js / champions.js calculateAttack*) instead
 * reads `field.isWonderRoom ? 'spd' : 'def'` from rawStats that are already
 * swapped (util.js checkRawStatChanges): raw Def, SpD stages.
 *
 * Neither is checked against the cartridge here. The Showdown expectation is
 * built from the oracle itself: running @smogon/calc with the attacker's Def
 * and SpD (base stats, investment and stages) exchanged makes its "raw Def,
 * SpD stages" equal Showdown's "raw SpD, Def stages" for our attacker.
 */
describe('Body Press under Wonder Room', () => {
  const swapDefenses = (p: Pokemon): Pokemon => ({
    ...p,
    baseStats: { ...p.baseStats, def: p.baseStats.spd, spd: p.baseStats.def },
    evs: { ...p.evs, def: p.evs.spd, spd: p.evs.def },
    statBoosts: { ...p.statBoosts, def: p.statBoosts.spd, spd: p.statBoosts.def },
  });
  // Neutral nature, so exchanging base stats and investment exchanges the stats.
  const presser = corviknight({ nature: 'Hardy', investment: table(32, 0, 32, 0, 2, 0), boosts: { def: 1, spd: -1 } });
  const c = ctx(presser, kingambit(), BODY_PRESS, field({ isWonderRoom: true }));

  it('matches Showdown: raw SpD with Def stages', () => {
    expect(calculate(c).rolls).toEqual(oracleRolls('champions', { ...c, attacker: swapDefenses(presser) }));
  });

  it('disagrees with @smogon/calc, which uses raw Def with SpD stages', () => {
    expect(calculate(c).rolls).not.toEqual(oracleRolls('champions', c));
  });
});
