import { calculate as smogonCalculate, toID } from '@smogon/calc';
import { describe, expect, it } from 'vitest';
// Test-only use of the oracle adapter; nothing in src/calc imports it.
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
  Move,
  MoveCategory,
  MoveTarget,
  Pokemon,
  SideState,
  StatTable,
  TypeName,
} from '../../types';
import { calculate } from '../calculate';
import {
  getItemBoostType,
  LIFE_ORB_BOOST,
  resolveAbilitiesAndItems,
} from './abilities-items';

// Every expected roll array comes from @smogon/calc 0.12.0 (the oracle), run
// on the same inputs through src/oracle/smogon-adapter.ts. Cases whose item or
// ability is missing from @smogon/calc's Champions tables (Choice Band / Specs,
// Assault Vest, Tinted Lens, Storm Drain) run in Gen 9 mode only.

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp, atk, def, spa, spd, spe,
});

// Champions spToEv as stated in CLAUDE.md.
const spToEv = (sp: number): number => (sp === 0 ? 0 : 8 * sp - 4);

interface MonOptions {
  game?: OracleGame;
  nature?: string;
  /** Stat Points in Champions, EVs in Gen 9. */
  investment?: StatTable;
  ability?: string;
  item?: string;
  status?: Pokemon['status'];
  currentHp?: number;
}

// Base stats and types come from @smogon/calc's own dex so both calculators
// start from identical Pokemon. The default ability is one neither acts on.
function mon(species: string, opts: MonOptions = {}): Pokemon {
  const game = opts.game ?? 'champions';
  const dex = smogonGeneration(game).species.get(toID(species));
  if (!dex) throw new Error(`${species} missing from @smogon/calc ${game} dex`);
  const inv = opts.investment ?? table(0, 0, 0, 0, 0, 0);
  const evs = game === 'champions'
    ? table(spToEv(inv.hp), spToEv(inv.atk), spToEv(inv.def), spToEv(inv.spa), spToEv(inv.spd), spToEv(inv.spe))
    : inv;
  return {
    species: dex.name,
    level: 50,
    types: [...dex.types] as TypeName[],
    isTerastallized: false,
    baseStats: { ...dex.baseStats },
    ivs: table(31, 31, 31, 31, 31, 31),
    evs,
    nature: opts.nature ?? 'Hardy',
    ability: opts.ability ?? 'Pressure',
    abilitySuppressed: false,
    item: opts.item ?? null,
    weightKg: dex.weightkg,
    currentHp: opts.currentHp ?? null,
    statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    status: opts.status ?? 'none',
  };
}

function move(
  name: string,
  type: TypeName,
  basePower: number,
  category: MoveCategory,
  target: MoveTarget = 'single',
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
      contact: category === 'Physical',
      punch: false, sound: false, slicing: false, bite: false, bullet: false, wind: false, pulse: false,
    },
  };
}

const side = (overrides: Partial<SideState> = {}): SideState => ({
  reflect: false, lightScreen: false, auroraVeil: false, tailwind: false, helpingHand: false,
  friendGuard: false, battery: false, powerSpot: false, steelySpirit: false, stealthRock: false, spikes: 0,
  ...overrides,
});

function field(overrides: Partial<Omit<FieldState, 'attackerSide' | 'defenderSide'>> & {
  attackerSide?: Partial<SideState>;
  defenderSide?: Partial<SideState>;
} = {}): FieldState {
  const { attackerSide, defenderSide, ...rest } = overrides;
  return {
    weather: 'none', terrain: 'none', isDoubles: true, isGravity: false, isWonderRoom: false,
    isMagicRoom: false, isBeadsOfRuin: false, isSwordOfRuin: false, isTabletsOfRuin: false,
    isVesselOfRuin: false,
    ...rest,
    attackerSide: side(attackerSide),
    defenderSide: side(defenderSide),
  };
}

function oracleRolls(game: OracleGame, c: DamageContext): number[] {
  const { damage } = smogonCalculate(
    smogonGeneration(game),
    toSmogonPokemon(game, c.attacker),
    toSmogonPokemon(game, c.defender),
    toSmogonMove(game, c.move, { isCrit: c.isCritical }),
    toSmogonField(c.field),
  );
  return typeof damage === 'number' ? new Array<number>(16).fill(damage) : damage.flat();
}

const ctx = (
  attacker: Pokemon,
  defender: Pokemon,
  m: Move,
  f: FieldState = field(),
  isCritical = false,
): DamageContext => ({ attacker, defender, move: m, field: f, isCritical });

// Attackers (Champions Stat Points unless noted; all legal).
const PHYS = table(2, 32, 0, 0, 0, 32);
const SPEC = table(2, 0, 0, 32, 0, 32);
const BULK = table(32, 0, 16, 0, 16, 0);
const PHYS_EV = table(4, 252, 0, 0, 0, 252);
const SPEC_EV = table(4, 0, 0, 252, 0, 252);
const BULK_EV = table(252, 0, 128, 0, 128, 0);

type Opts = Omit<MonOptions, 'game'>;
const phys = (species: string, o: Opts = {}, game: OracleGame = 'champions'): Pokemon =>
  mon(species, { game, nature: 'Adamant', investment: game === 'gen9' ? PHYS_EV : PHYS, ...o });
const spec = (species: string, o: Opts = {}, game: OracleGame = 'champions'): Pokemon =>
  mon(species, { game, nature: 'Modest', investment: game === 'gen9' ? SPEC_EV : SPEC, ...o });
const wall = (species: string, o: Opts = {}, game: OracleGame = 'champions'): Pokemon =>
  mon(species, { game, nature: 'Bold', investment: game === 'gen9' ? BULK_EV : BULK, ...o });

const DRAGON_CLAW = move('Dragon Claw', 'Dragon', 80, 'Physical');
const IRON_HEAD = move('Iron Head', 'Steel', 80, 'Physical');
const FIRE_FANG = move('Fire Fang', 'Fire', 65, 'Physical');
const FLARE_BLITZ = move('Flare Blitz', 'Fire', 120, 'Physical');
const ICE_PUNCH = move('Ice Punch', 'Ice', 75, 'Physical');
const AQUA_JET = move('Aqua Jet', 'Water', 40, 'Physical');
const PLAY_ROUGH = move('Play Rough', 'Fairy', 90, 'Physical');
const BULLET_PUNCH = move('Bullet Punch', 'Steel', 40, 'Physical');
const MAGICAL_LEAF = move('Magical Leaf', 'Grass', 60, 'Special');
const RETURN = move('Return', 'Normal', 102, 'Physical');
const EARTHQUAKE = move('Earthquake', 'Ground', 100, 'Physical', 'allAdjacent');
const HIGH_HORSEPOWER = move('High Horsepower', 'Ground', 95, 'Physical');
const THOUSAND_ARROWS = move('Thousand Arrows', 'Ground', 90, 'Physical', 'allAdjacentFoes');
const DRAIN_PUNCH = move('Drain Punch', 'Fighting', 75, 'Physical');
const FLAMETHROWER = move('Flamethrower', 'Fire', 90, 'Special');
const HEAT_WAVE = move('Heat Wave', 'Fire', 95, 'Special', 'allAdjacentFoes');
const HYDRO_PUMP = move('Hydro Pump', 'Water', 110, 'Special');
const THUNDERBOLT = move('Thunderbolt', 'Electric', 90, 'Special');
const ENERGY_BALL = move('Energy Ball', 'Grass', 90, 'Special');
const PSYCHIC = move('Psychic', 'Psychic', 90, 'Special');
const SHADOW_BALL = move('Shadow Ball', 'Ghost', 80, 'Special');
const BUG_BUZZ = move('Bug Buzz', 'Bug', 90, 'Special');
const ICE_BEAM = move('Ice Beam', 'Ice', 90, 'Special');

interface Case {
  name: string;
  game?: OracleGame;
  ctx: DamageContext;
  /** Expect every roll to be 0 (and require the oracle to agree). */
  immune?: boolean;
  /**
   * false when the case's abilities and items should leave damage unchanged
   * (inactive, ignored, or cancelling out). Defaults to true.
   */
  changes?: boolean;
}

const g9 = 'gen9' as const;

const CASES: Case[] = [
  // Life Orb (5324, final mods).
  { name: 'Life Orb', ctx: ctx(phys('Garchomp', { item: 'Life Orb' }), wall('Farigiraf'), DRAGON_CLAW) },
  { name: 'Life Orb, special', ctx: ctx(spec('Charizard', { item: 'Life Orb' }), wall('Farigiraf'), FLAMETHROWER) },
  { name: 'Life Orb chained with Reflect (doubles)', ctx: ctx(phys('Garchomp', { item: 'Life Orb' }), wall('Farigiraf'), DRAGON_CLAW, field({ defenderSide: { reflect: true } })) },
  { name: 'Life Orb chained with Light Screen (singles)', ctx: ctx(spec('Gholdengo', { item: 'Life Orb' }), wall('Hatterene'), SHADOW_BALL, field({ isDoubles: false, defenderSide: { lightScreen: true } })) },
  { name: 'Gen 9: Life Orb', game: g9, ctx: ctx(phys('Garchomp', { item: 'Life Orb' }, g9), wall('Farigiraf', {}, g9), DRAGON_CLAW) },

  // Expert Belt (4915 on > 1x, final mods).
  { name: 'Expert Belt, super effective', ctx: ctx(phys('Garchomp', { item: 'Expert Belt' }), wall('Hatterene'), IRON_HEAD) },
  { name: 'Expert Belt, double super effective', ctx: ctx(phys('Tyranitar', { item: 'Expert Belt' }), wall('Charizard'), move('Rock Slide', 'Rock', 75, 'Physical', 'allAdjacentFoes')) },
  { name: 'Expert Belt, neutral: no boost', changes: false, ctx: ctx(phys('Garchomp', { item: 'Expert Belt' }), wall('Hatterene'), FIRE_FANG) },
  { name: 'Expert Belt, resisted: no boost', changes: false, ctx: ctx(phys('Garchomp', { item: 'Expert Belt' }), wall('Gholdengo'), IRON_HEAD) },
  { name: 'Gen 9: Expert Belt, super effective', game: g9, ctx: ctx(phys('Garchomp', { item: 'Expert Belt' }, g9), wall('Hatterene', {}, g9), IRON_HEAD) },

  // Choice Band / Specs (6144, attack stat). Gen 9 only.
  { name: 'Gen 9: Choice Band, physical', game: g9, ctx: ctx(phys('Garchomp', { item: 'Choice Band' }, g9), wall('Farigiraf', {}, g9), DRAGON_CLAW) },
  { name: 'Gen 9: Choice Band, special move: no boost', changes: false, game: g9, ctx: ctx(spec('Charizard', { item: 'Choice Band' }, g9), wall('Farigiraf', {}, g9), FLAMETHROWER) },
  { name: 'Gen 9: Choice Specs, special', game: g9, ctx: ctx(spec('Charizard', { item: 'Choice Specs' }, g9), wall('Farigiraf', {}, g9), FLAMETHROWER) },
  { name: 'Gen 9: Choice Specs, physical move: no boost', changes: false, game: g9, ctx: ctx(phys('Garchomp', { item: 'Choice Specs' }, g9), wall('Farigiraf', {}, g9), DRAGON_CLAW) },
  { name: 'Gen 9: Choice Band chained with Guts and Tablets of Ruin', game: g9, ctx: ctx(phys('Conkeldurr', { item: 'Choice Band', ability: 'Guts', status: 'brn' }, g9), wall('Farigiraf', {}, g9), DRAIN_PUNCH, field({ isTabletsOfRuin: true })) },
  { name: 'Gen 9: Choice Specs chained with Vessel of Ruin and Light Screen', game: g9, ctx: ctx(spec('Charizard', { item: 'Choice Specs' }, g9), wall('Farigiraf', {}, g9), FLAMETHROWER, field({ isVesselOfRuin: true, defenderSide: { lightScreen: true } })) },

  // Assault Vest (6144, defense stat). Gen 9 only.
  { name: 'Gen 9: Assault Vest, special', game: g9, ctx: ctx(spec('Charizard', {}, g9), wall('Incineroar', { item: 'Assault Vest' }, g9), move('Air Slash', 'Flying', 75, 'Special')) },
  { name: 'Gen 9: Assault Vest, physical: no boost', changes: false, game: g9, ctx: ctx(phys('Garchomp', {}, g9), wall('Incineroar', { item: 'Assault Vest' }, g9), DRAGON_CLAW) },
  { name: 'Gen 9: Assault Vest chained with Beads of Ruin', game: g9, ctx: ctx(spec('Charizard', {}, g9), wall('Incineroar', { item: 'Assault Vest' }, g9), move('Air Slash', 'Flying', 75, 'Special'), field({ isBeadsOfRuin: true })) },
  { name: 'Gen 9: Assault Vest under Wonder Room', game: g9, ctx: ctx(spec('Charizard', {}, g9), wall('Hatterene', { item: 'Assault Vest', investment: table(252, 0, 252, 0, 4, 0) }, g9), move('Air Slash', 'Flying', 75, 'Special'), field({ isWonderRoom: true })) },

  // Type-boosting items (4915, base power).
  { name: 'Charcoal, Fire move', ctx: ctx(spec('Charizard', { item: 'Charcoal' }), wall('Farigiraf'), FLAMETHROWER) },
  { name: 'Charcoal, non-Fire move: no boost', changes: false, ctx: ctx(spec('Charizard', { item: 'Charcoal' }), wall('Farigiraf'), move('Air Slash', 'Flying', 75, 'Special')) },
  { name: 'Mystic Water', ctx: ctx(phys('Azumarill', { item: 'Mystic Water' }), wall('Garchomp'), move('Liquidation', 'Water', 85, 'Physical')) },
  { name: 'Dragon Fang', ctx: ctx(phys('Garchomp', { item: 'Dragon Fang' }), wall('Farigiraf'), DRAGON_CLAW) },
  { name: 'Twisted Spoon in Psychic Terrain (chained with terrain)', ctx: ctx(spec('Hatterene', { item: 'Twisted Spoon' }), wall('Garchomp'), PSYCHIC, field({ terrain: 'psychic' })) },
  { name: 'Silk Scarf, Normal move', ctx: ctx(phys('Snorlax', { item: 'Silk Scarf' }), wall('Farigiraf'), RETURN) },
  { name: 'Spell Tag', ctx: ctx(spec('Gengar', { item: 'Spell Tag' }), wall('Hatterene'), SHADOW_BALL) },
  { name: 'Gen 9: Flame Plate', game: g9, ctx: ctx(spec('Charizard', { item: 'Flame Plate' }, g9), wall('Farigiraf', {}, g9), FLAMETHROWER) },
  { name: 'Gen 9: Mystic Water', game: g9, ctx: ctx(phys('Azumarill', { item: 'Mystic Water' }, g9), wall('Garchomp', {}, g9), move('Liquidation', 'Water', 85, 'Physical')) },

  // Guts (6144, attack stat; also skips the burn halving).
  { name: 'Guts, paralyzed', ctx: ctx(phys('Conkeldurr', { ability: 'Guts', status: 'par' }), wall('Farigiraf'), DRAIN_PUNCH) },
  { name: 'Guts, burned (no burn halving)', ctx: ctx(phys('Conkeldurr', { ability: 'Guts', status: 'brn' }), wall('Farigiraf'), DRAIN_PUNCH) },
  { name: 'Guts, asleep', ctx: ctx(phys('Conkeldurr', { ability: 'Guts', status: 'slp' }), wall('Farigiraf'), DRAIN_PUNCH) },
  { name: 'Guts, no status: no boost', changes: false, ctx: ctx(phys('Conkeldurr', { ability: 'Guts' }), wall('Farigiraf'), DRAIN_PUNCH) },
  { name: 'Guts, special move: no boost', changes: false, ctx: ctx(spec('Conkeldurr', { ability: 'Guts', status: 'psn' }), wall('Farigiraf'), move('Focus Blast', 'Fighting', 120, 'Special')) },
  { name: 'Gen 9: Guts, toxic', game: g9, ctx: ctx(phys('Conkeldurr', { ability: 'Guts', status: 'tox' }, g9), wall('Farigiraf', {}, g9), DRAIN_PUNCH) },

  // Huge Power / Pure Power (8192, attack stat).
  { name: 'Huge Power', ctx: ctx(phys('Azumarill', { ability: 'Huge Power' }), wall('Garchomp'), PLAY_ROUGH) },
  { name: 'Huge Power, special move: no boost', changes: false, ctx: ctx(spec('Azumarill', { ability: 'Huge Power' }), wall('Garchomp'), HYDRO_PUMP) },
  { name: 'Pure Power', ctx: ctx(phys('Medicham', { ability: 'Pure Power' }), wall('Farigiraf'), DRAIN_PUNCH) },
  { name: 'Huge Power with Mystic Water on a 40 BP move', ctx: ctx(phys('Azumarill', { ability: 'Huge Power', item: 'Mystic Water' }), wall('Garchomp'), AQUA_JET) },
  { name: 'Gen 9: Huge Power with Choice Band', game: g9, ctx: ctx(phys('Azumarill', { ability: 'Huge Power', item: 'Choice Band' }, g9), wall('Garchomp', {}, g9), PLAY_ROUGH) },

  // Technician (6144 on base power <= 60).
  { name: 'Technician, 40 BP', ctx: ctx(phys('Scizor', { ability: 'Technician' }), wall('Hatterene'), BULLET_PUNCH) },
  { name: 'Technician, exactly 60 BP', ctx: ctx(spec('Scizor', { ability: 'Technician' }), wall('Farigiraf'), MAGICAL_LEAF) },
  { name: 'Technician, 65 BP: no boost', changes: false, ctx: ctx(phys('Scizor', { ability: 'Technician' }), wall('Farigiraf'), FIRE_FANG) },
  { name: 'Technician with Metal Coat', ctx: ctx(phys('Scizor', { ability: 'Technician', item: 'Metal Coat' }), wall('Hatterene'), BULLET_PUNCH) },
  { name: 'Technician with Miracle Seed in Grassy Terrain (three BP mods)', ctx: ctx(spec('Scizor', { ability: 'Technician', item: 'Miracle Seed' }), wall('Farigiraf'), MAGICAL_LEAF, field({ terrain: 'grassy' })) },
  { name: 'Gen 9: Technician with Life Orb', game: g9, ctx: ctx(phys('Scizor', { ability: 'Technician', item: 'Life Orb' }, g9), wall('Hatterene', {}, g9), BULLET_PUNCH) },

  // Tinted Lens (8192 on < 1x). Gen 9 only.
  { name: 'Gen 9: Tinted Lens, resisted', game: g9, ctx: ctx(spec('Yanmega', { ability: 'Tinted Lens' }, g9), wall('Scizor', {}, g9), BUG_BUZZ) },
  { name: 'Gen 9: Tinted Lens, double resisted', game: g9, ctx: ctx(spec('Yanmega', { ability: 'Tinted Lens' }, g9), wall('Charizard', {}, g9), BUG_BUZZ) },
  { name: 'Gen 9: Tinted Lens, neutral: no boost', changes: false, game: g9, ctx: ctx(spec('Yanmega', { ability: 'Tinted Lens' }, g9), wall('Snorlax', {}, g9), BUG_BUZZ) },
  { name: 'Gen 9: Tinted Lens chained with Life Orb and Aurora Veil', game: g9, ctx: ctx(spec('Yanmega', { ability: 'Tinted Lens', item: 'Life Orb' }, g9), wall('Charizard', {}, g9), BUG_BUZZ, field({ defenderSide: { auroraVeil: true } })) },

  // Solid Rock / Filter (3072 on > 1x).
  { name: 'Solid Rock, super effective', ctx: ctx(spec('Venusaur'), wall('Rhyperior', { ability: 'Solid Rock' }), ENERGY_BALL) },
  { name: 'Solid Rock, neutral: no reduction', changes: false, ctx: ctx(spec('Charizard'), wall('Rhyperior', { ability: 'Solid Rock' }), SHADOW_BALL) },
  { name: 'Filter, super effective', ctx: ctx(phys('Garchomp'), wall('Mr. Mime', { ability: 'Filter' }), IRON_HEAD) },
  { name: 'Filter with Expert Belt', ctx: ctx(phys('Garchomp', { item: 'Expert Belt' }), wall('Mr. Mime', { ability: 'Filter' }), IRON_HEAD) },
  { name: 'Gen 9: Solid Rock, 4x', game: g9, ctx: ctx(spec('Venusaur', {}, g9), wall('Rhyperior', { ability: 'Solid Rock' }, g9), ENERGY_BALL) },

  // Multiscale (2048 at full HP).
  { name: 'Multiscale at full HP', ctx: ctx(spec('Charizard'), wall('Dragonite', { ability: 'Multiscale' }), ICE_BEAM) },
  { name: 'Multiscale below full HP: no reduction', changes: false, ctx: ctx(spec('Charizard'), wall('Dragonite', { ability: 'Multiscale', currentHp: 100 }), ICE_BEAM) },
  { name: 'Multiscale with Stealth Rock up: no reduction', changes: false, ctx: ctx(spec('Charizard'), wall('Dragonite', { ability: 'Multiscale' }), ICE_BEAM, field({ defenderSide: { stealthRock: true } })) },
  { name: 'Multiscale with Spikes on a Flying type: still applies', ctx: ctx(spec('Charizard'), wall('Dragonite', { ability: 'Multiscale' }), ICE_BEAM, field({ defenderSide: { spikes: 2 } })) },
  { name: 'Multiscale with Spikes on a grounded type: no reduction', changes: false, ctx: ctx(phys('Garchomp'), wall('Farigiraf', { ability: 'Multiscale' }), DRAGON_CLAW, field({ defenderSide: { spikes: 1 } })) },
  { name: 'Multiscale chained with Light Screen and Life Orb', ctx: ctx(spec('Charizard', { item: 'Life Orb' }), wall('Dragonite', { ability: 'Multiscale' }), ICE_BEAM, field({ defenderSide: { lightScreen: true } })) },
  { name: 'Gen 9: Multiscale with Stealth Rock but Heavy-Duty Boots', game: g9, ctx: ctx(spec('Charizard', {}, g9), wall('Dragonite', { ability: 'Multiscale', item: 'Heavy-Duty Boots' }, g9), ICE_BEAM, field({ defenderSide: { stealthRock: true } })) },

  // Thick Fat (2048 on the attacker's stat for Fire / Ice).
  { name: 'Thick Fat, Fire', ctx: ctx(spec('Charizard'), wall('Snorlax', { ability: 'Thick Fat' }), FLAMETHROWER) },
  { name: 'Thick Fat, Ice', ctx: ctx(phys('Mamoswine'), wall('Snorlax', { ability: 'Thick Fat' }), ICE_PUNCH) },
  { name: 'Thick Fat, Water: no reduction', changes: false, ctx: ctx(spec('Charizard'), wall('Snorlax', { ability: 'Thick Fat' }), HYDRO_PUMP) },
  // Huge Power (2x) and Thick Fat (0.5x) cancel out.
  { name: 'Thick Fat chained with Huge Power', changes: false, ctx: ctx(phys('Azumarill', { ability: 'Huge Power' }), wall('Snorlax', { ability: 'Thick Fat' }), ICE_PUNCH) },
  { name: 'Thick Fat with Charcoal, sun and spread', ctx: ctx(spec('Charizard', { item: 'Charcoal' }), wall('Snorlax', { ability: 'Thick Fat' }), HEAT_WAVE, field({ weather: 'sun' })) },
  { name: 'Gen 9: Thick Fat with Choice Band and Guts', game: g9, ctx: ctx(phys('Conkeldurr', { ability: 'Guts', status: 'par', item: 'Choice Band' }, g9), wall('Snorlax', { ability: 'Thick Fat' }, g9), FIRE_FANG) },

  // Levitate.
  { name: 'Levitate vs Ground', immune: true, ctx: ctx(phys('Garchomp'), wall('Rotom-Wash', { ability: 'Levitate' }), HIGH_HORSEPOWER) },
  { name: 'Levitate vs spread Ground', immune: true, ctx: ctx(phys('Garchomp'), wall('Gengar', { ability: 'Levitate' }), EARTHQUAKE) },
  { name: 'Levitate under Gravity', changes: false, ctx: ctx(phys('Garchomp'), wall('Rotom-Wash', { ability: 'Levitate' }), HIGH_HORSEPOWER, field({ isGravity: true })) },
  { name: 'Levitate vs non-Ground move', changes: false, ctx: ctx(phys('Garchomp'), wall('Rotom-Wash', { ability: 'Levitate' }), DRAGON_CLAW) },
  { name: 'Gen 9: Levitate with Iron Ball', changes: false, game: g9, ctx: ctx(phys('Garchomp', {}, g9), wall('Rotom-Wash', { ability: 'Levitate', item: 'Iron Ball' }, g9), HIGH_HORSEPOWER) },
  { name: 'Gen 9: Levitate vs Thousand Arrows', changes: false, game: g9, ctx: ctx(phys('Garchomp', {}, g9), wall('Gengar', { ability: 'Levitate' }, g9), THOUSAND_ARROWS) },

  // Immunity abilities.
  { name: 'Flash Fire vs Fire', immune: true, ctx: ctx(spec('Charizard'), wall('Farigiraf', { ability: 'Flash Fire' }), FLAMETHROWER) },
  { name: 'Flash Fire vs Water: no immunity', changes: false, ctx: ctx(spec('Charizard'), wall('Farigiraf', { ability: 'Flash Fire' }), HYDRO_PUMP) },
  { name: 'Water Absorb vs Water', immune: true, ctx: ctx(spec('Charizard'), wall('Vaporeon', { ability: 'Water Absorb' }), HYDRO_PUMP) },
  { name: 'Volt Absorb vs Electric', immune: true, ctx: ctx(spec('Raichu'), wall('Farigiraf', { ability: 'Volt Absorb' }), THUNDERBOLT) },
  { name: 'Lightning Rod vs Electric', immune: true, ctx: ctx(spec('Raichu'), wall('Farigiraf', { ability: 'Lightning Rod' }), THUNDERBOLT) },
  { name: 'Sap Sipper vs Grass', immune: true, ctx: ctx(spec('Venusaur'), wall('Farigiraf', { ability: 'Sap Sipper' }), ENERGY_BALL) },
  { name: 'Gen 9: Storm Drain vs Water', game: g9, immune: true, ctx: ctx(spec('Charizard', {}, g9), wall('Gastrodon', { ability: 'Storm Drain' }, g9), HYDRO_PUMP) },
  { name: 'Gen 9: Storm Drain vs Grass: no immunity', changes: false, game: g9, ctx: ctx(spec('Venusaur', {}, g9), wall('Gastrodon', { ability: 'Storm Drain' }, g9), ENERGY_BALL) },
  { name: 'Gen 9: Flash Fire vs Fire', game: g9, immune: true, ctx: ctx(spec('Charizard', {}, g9), wall('Heatran', { ability: 'Flash Fire' }, g9), FLAMETHROWER) },
  { name: 'Gen 9: Sap Sipper vs Grass', game: g9, immune: true, ctx: ctx(spec('Venusaur', {}, g9), wall('Farigiraf', { ability: 'Sap Sipper' }, g9), ENERGY_BALL) },
  { name: 'Gen 9: Volt Absorb vs Electric', game: g9, immune: true, ctx: ctx(spec('Raichu', {}, g9), wall('Farigiraf', { ability: 'Volt Absorb' }, g9), THUNDERBOLT) },

  // Mold Breaker ignores defender abilities.
  { name: 'Mold Breaker vs Multiscale', changes: false, ctx: ctx(spec('Charizard', { ability: 'Mold Breaker' }), wall('Dragonite', { ability: 'Multiscale' }), ICE_BEAM) },
  { name: 'Mold Breaker vs Levitate', changes: false, ctx: ctx(phys('Excadrill', { ability: 'Mold Breaker' }), wall('Rotom-Wash', { ability: 'Levitate' }), HIGH_HORSEPOWER) },
  { name: 'Mold Breaker vs Flash Fire', changes: false, ctx: ctx(spec('Charizard', { ability: 'Mold Breaker' }), wall('Farigiraf', { ability: 'Flash Fire' }), FLAMETHROWER) },
  { name: 'Mold Breaker vs Thick Fat', changes: false, ctx: ctx(spec('Charizard', { ability: 'Mold Breaker' }), wall('Snorlax', { ability: 'Thick Fat' }), FLAMETHROWER) },
  { name: 'Mold Breaker vs Solid Rock', changes: false, ctx: ctx(spec('Venusaur', { ability: 'Mold Breaker' }), wall('Rhyperior', { ability: 'Solid Rock' }), ENERGY_BALL) },
  { name: 'Gen 9: Mold Breaker vs Storm Drain', changes: false, game: g9, ctx: ctx(spec('Charizard', { ability: 'Mold Breaker' }, g9), wall('Gastrodon', { ability: 'Storm Drain' }, g9), HYDRO_PUMP) },
  { name: 'Gen 9: Teravolt vs Filter', changes: false, game: g9, ctx: ctx(phys('Garchomp', { ability: 'Teravolt' }, g9), wall('Mr. Mime', { ability: 'Filter' }, g9), IRON_HEAD) },
  { name: 'Gen 9: Sunsteel Strike vs Multiscale', changes: false, game: g9, ctx: ctx(phys('Garchomp', {}, g9), wall('Dragonite', { ability: 'Multiscale' }, g9), move('Sunsteel Strike', 'Steel', 100, 'Physical')) },
  { name: 'Gen 9: Ability Shield blocks Mold Breaker', game: g9, ctx: ctx(spec('Charizard', { ability: 'Mold Breaker' }, g9), wall('Dragonite', { ability: 'Multiscale', item: 'Ability Shield' }, g9), ICE_BEAM) },
  { name: 'Gen 9: Mold Breaker vs Levitate under Magic Room with Ability Shield', changes: false, game: g9, ctx: ctx(phys('Excadrill', { ability: 'Mold Breaker' }, g9), wall('Rotom-Wash', { ability: 'Levitate', item: 'Ability Shield' }, g9), HIGH_HORSEPOWER, field({ isMagicRoom: true })) },

  // Items switched off.
  { name: 'Magic Room disables Life Orb', changes: false, ctx: ctx(phys('Garchomp', { item: 'Life Orb' }), wall('Farigiraf'), DRAGON_CLAW, field({ isMagicRoom: true })) },
  { name: 'Magic Room disables a type-boosting item', changes: false, ctx: ctx(spec('Charizard', { item: 'Charcoal' }), wall('Farigiraf'), FLAMETHROWER, field({ isMagicRoom: true })) },
  { name: 'Klutz disables Life Orb', changes: false, ctx: ctx(phys('Garchomp', { ability: 'Klutz', item: 'Life Orb' }), wall('Farigiraf'), DRAGON_CLAW) },
  { name: 'Gen 9: Magic Room disables Choice Band and Assault Vest', changes: false, game: g9, ctx: ctx(phys('Garchomp', { item: 'Choice Band' }, g9), wall('Incineroar', { item: 'Assault Vest' }, g9), DRAGON_CLAW, field({ isMagicRoom: true })) },

  // Everything stacked.
  {
    name: 'crit spread Heat Wave in sun: Charcoal, Thick Fat, Light Screen skipped by crit',
    ctx: ctx(spec('Charizard', { item: 'Charcoal' }), wall('Snorlax', { ability: 'Thick Fat' }), HEAT_WAVE, field({ weather: 'sun', defenderSide: { lightScreen: true } }), true),
  },
  {
    name: 'Gen 9: Choice Specs Tinted Lens into resisting Multiscale behind Aurora Veil, singles',
    game: g9,
    // 1.5 (Specs) * 2 (Tinted Lens) / 1.5 (Assault Vest) / 2 (Multiscale) cancels out.
    changes: false,
    ctx: ctx(spec('Yanmega', { ability: 'Tinted Lens', item: 'Choice Specs' }, g9), wall('Dragonite', { ability: 'Multiscale', item: 'Assault Vest' }, g9), BUG_BUZZ, field({ isDoubles: false, defenderSide: { auroraVeil: true } })),
  },
];

describe('abilities and items agree with @smogon/calc on the full roll array', () => {
  it.each(CASES)('$name', ({ game = 'champions', ctx: c, immune = false }) => {
    const expected = oracleRolls(game, c);
    if (immune) expect(expected).toEqual(new Array<number>(16).fill(0));
    else expect(expected.some((d) => d > 0)).toBe(true);
    expect(calculate(c).rolls).toEqual(expected);
  });
});

describe('the oracle confirms each case exercises what it names', () => {
  // Guards against a case passing because the oracle and we both ignored the
  // item or ability: stripping them must change the oracle's answer exactly
  // when the case says it should.
  const withoutEffect = (c: DamageContext): DamageContext => ({
    ...c,
    attacker: { ...c.attacker, ability: 'Pressure', item: null },
    defender: { ...c.defender, ability: 'Pressure', item: null },
  });

  it.each(CASES)('$name', ({ game = 'champions', ctx: c, changes = true }) => {
    const same = oracleRolls(game, c).join() === oracleRolls(game, withoutEffect(c)).join();
    expect(same).toBe(!changes);
  });
});

describe('resolveAbilitiesAndItems', () => {
  const base = ctx(phys('Garchomp', { item: 'Life Orb' }), wall('Dragonite', { ability: 'Multiscale' }), DRAGON_CLAW);

  it('returns the same context when nothing is suppressed', () => {
    expect(resolveAbilitiesAndItems(base)).toBe(base);
  });

  it('does not mutate its input', () => {
    const c = { ...base, attacker: { ...base.attacker, ability: 'Mold Breaker' }, field: field({ isMagicRoom: true }) };
    resolveAbilitiesAndItems(c);
    expect(c.attacker.item).toBe('Life Orb');
    expect(c.defender.abilitySuppressed).toBe(false);
  });
});

describe('constants', () => {
  it('uses 5324 for Life Orb, as @smogon/calc does', () => {
    expect(LIFE_ORB_BOOST).toBe(5324);
  });

  it('maps type-boosting items like @smogon/calc items.js getItemBoostType', () => {
    expect(getItemBoostType('Charcoal')).toBe('Fire');
    expect(getItemBoostType('Silk Scarf')).toBe('Normal');
    expect(getItemBoostType('Life Orb')).toBeUndefined();
    expect(getItemBoostType(null)).toBeUndefined();
  });
});
