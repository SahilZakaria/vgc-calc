import { calculate as smogonCalculate } from '@smogon/calc';
import { describe, expect, it } from 'vitest';
import { calculate } from '../calc/calculate';
import { calculateStats } from '../calc/stats';
import { CHAMPIONS_IV, CHAMPIONS_LEVEL, MAX_SP_PER_STAT, MAX_SP_TOTAL, spToEv } from '../champions/stats';
import type {
  DamageContext,
  FieldState,
  Move,
  MoveCategory,
  Pokemon,
  SideState,
  StatName,
  StatTable,
  Terrain,
  TypeName,
  Weather,
} from '../types';
import {
  smogonGeneration,
  toSmogonField,
  toSmogonMove,
  toSmogonPokemon,
  type OracleGame,
  type SmogonGeneration,
} from './smogon-adapter';

// Randomized differential test: our calculate() against @smogon/calc 0.12.0
// (through smogon-adapter.ts) on generated DamageContexts. The expected rolls
// come from @smogon/calc on the same inputs; nothing is taken from our output.
//
// Replaying
// ---------
//   FUZZ_SEED=<seed> npm run test:fuzz
// The fuzz run is excluded from `npm test`; `npm run test:fuzz` runs only it.
// FUZZ_SEED accepts an integer or any string (hashed). Each case draws from
// its own PRNG seeded by (seed, game, case index), so a case replays the same
// way whatever FUZZ_CASES is. Other knobs:
//   FUZZ_CASES       cases per game (default 2000)
//   FUZZ_PRINT       how many mismatches per game to print in full (default 25)
//
// What is generated
// -----------------
// Mismatches caused by known @smogon/calc bugs (KNOWN_ORACLE_BUGS below) are
// reported as expected disagreements and do not fail the run.
//
// Species, types, base stats and weights come from @smogon/calc's dex for the
// game under test, and so do moves (type, category, base power, target,
// priority, flags). Items and abilities are drawn from the ones src/calc acts
// on, plus neutral fillers neither calculator acts on, restricted to those in
// that game's dex; Mega forms always hold their own Mega Stone. Champions Pokemon are level 50 with 31 IVs and a legal Stat
// Point spread (<= 32 per stat, <= 66 total); Gen 9 Pokemon get a random level
// (biased to 50), IVs 0-31 and a legal EV spread (<= 252 per stat, <= 510).
//
// Moves are limited to what calculate.ts claims to handle. Excluded: multi-hit
// moves, fixed-damage moves, Z / Max moves, and every move @smogon/calc treats
// specially by name (variable power, type or category changes, extra
// multipliers) except the ones src/calc implements: Body Press, Foul Play,
// Psyshock, Psystrike, Secret Sword, Brick Break, Psychic Fangs, Earthquake,
// Bulldoze, Hydro Steam and the ability-ignoring Moongeist Beam / Sunsteel
// Strike. Moves whose dex entry always crits (willCrit) are generated with
// isCritical true, since our Move type has no such flag.
//
// Deliberately left at their defaults: Terastallization, and the side flags
// src/calc does not model (Helping Hand, Friend Guard, Battery, Power Spot,
// Steely Spirit, Tailwind).

const GAMES: readonly OracleGame[] = ['champions', 'gen9'];
const STATS: readonly StatName[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
const BOOSTABLE = ['atk', 'def', 'spa', 'spd', 'spe'] as const;
const ROLLS = 16;

const DEFAULT_SEED = 0x5eed_2026;
const DEFAULT_CASES = 2000;
const DEFAULT_PRINT = 25;

// ---------------------------------------------------------------------------
// Seeded PRNG
// ---------------------------------------------------------------------------

/** FNV-1a over a string, for turning seeds and labels into 32-bit ints. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function parseSeed(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SEED;
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? Number(trimmed) >>> 0 : hash32(trimmed);
}

function parseCount(raw: string | undefined, fallback: number): number {
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

const SEED = parseSeed(process.env.FUZZ_SEED);
const CASES = parseCount(process.env.FUZZ_CASES, DEFAULT_CASES);
const PRINT_LIMIT = parseCount(process.env.FUZZ_PRINT, DEFAULT_PRINT);

/** mulberry32: small, fast, and good enough for test-case generation. */
class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max], inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    const item = items[Math.floor(this.next() * items.length)];
    if (item === undefined) throw new Error('pick from an empty list');
    return item;
  }

  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const a = out[i] as T;
      out[i] = out[j] as T;
      out[j] = a;
    }
    return out;
  }
}

function caseRng(game: OracleGame, index: number): Rng {
  return new Rng(hash32(`${SEED}:${game}:${index}`));
}

// ---------------------------------------------------------------------------
// Pools
// ---------------------------------------------------------------------------

const TYPES: ReadonlySet<string> = new Set<TypeName>([
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
]);

const isTypeName = (t: string): t is TypeName => TYPES.has(t);

/** Abilities src/calc acts on (modifiers/*.ts and calculate.ts). */
const SUPPORTED_ABILITIES: readonly string[] = [
  'Technician', 'Guts', 'Huge Power', 'Pure Power', 'Thick Fat', 'Tinted Lens', 'Multiscale',
  'Solid Rock', 'Filter', 'Flash Fire', 'Water Absorb', 'Storm Drain', 'Volt Absorb',
  'Lightning Rod', 'Sap Sipper', 'Levitate', 'Eelevate', 'Mold Breaker', 'Teravolt', 'Turboblaze',
  'Klutz', 'Adaptability', 'Infiltrator', 'Air Lock', 'Cloud Nine', 'Mega Sol',
  'Tablets of Ruin', 'Vessel of Ruin', 'Sword of Ruin', 'Beads of Ruin',
];

/** Abilities neither calculator changes damage for. */
const NEUTRAL_ABILITIES: readonly string[] = ['Pressure', 'Run Away', 'Keen Eye', 'Inner Focus'];

/** Items src/calc acts on (modifiers/*.ts), including items.js type boosters. */
const SUPPORTED_ITEMS: readonly string[] = [
  'Choice Band', 'Choice Specs', 'Assault Vest', 'Life Orb', 'Expert Belt', 'Utility Umbrella',
  'Air Balloon', 'Iron Ball', 'Heavy-Duty Boots', 'Ability Shield', 'Power Anklet',
  'Draco Plate', 'Dragon Fang', 'Dread Plate', 'Black Glasses', 'Earth Plate', 'Soft Sand',
  'Fist Plate', 'Black Belt', 'Flame Plate', 'Charcoal', 'Icicle Plate', 'Never-Melt Ice',
  'Insect Plate', 'Silver Powder', 'Iron Plate', 'Metal Coat', 'Meadow Plate', 'Rose Incense',
  'Miracle Seed', 'Mind Plate', 'Odd Incense', 'Twisted Spoon', 'Fairy Feather', 'Pixie Plate',
  'Sky Plate', 'Sharp Beak', 'Splash Plate', 'Sea Incense', 'Wave Incense', 'Mystic Water',
  'Spooky Plate', 'Spell Tag', 'Stone Plate', 'Rock Incense', 'Hard Stone', 'Toxic Plate',
  'Poison Barb', 'Zap Plate', 'Magnet', 'Silk Scarf',
];

/** Items neither calculator changes damage for. */
const NEUTRAL_ITEMS: readonly string[] = ['Leftovers', 'Sitrus Berry', 'Focus Sash', 'Quick Claw'];

/** Name-special-cased moves in gen789.js / champions.js that src/calc implements. */
const HANDLED_SPECIAL_MOVES: ReadonlySet<string> = new Set([
  'Body Press', 'Foul Play', 'Psyshock', 'Psystrike', 'Secret Sword', 'Brick Break', 'Psychic Fangs',
  'Earthquake', 'Bulldoze', 'Hydro Steam', 'Moongeist Beam', 'Sunsteel Strike',
]);

/**
 * Every move @smogon/calc 0.12.0 special-cases by name in gen789.js or
 * champions.js (move.named(...), move.name ===, and the calculateBasePower
 * switch). Collected with grep over their dist; these are outside what
 * calculate.ts handles unless listed in HANDLED_SPECIAL_MOVES.
 */
const SMOGON_SPECIAL_MOVES: readonly string[] = [
  'Acrobatics', 'Assurance', 'Aura Wheel', 'Barb Barrage', 'Behemoth Bash', 'Behemoth Blade',
  'Bolt Beak', 'Brine', 'Clangorous Soul', 'Collision Course', 'Crush Grip', 'Dragon Energy',
  'Dream Eater', 'Dynamax Cannon', 'Electro Ball', 'Electro Drift', 'Electro Shot', 'Eruption',
  'Expanding Force', 'Facade', 'Final Gambit', 'Fishious Rend', 'Flail', 'Fling', 'Grass Knot',
  'Grav Apple', 'Gyro Ball', 'Hard Press', 'Heat Crash', 'Heavy Slam', 'Hex', 'Infernal Parade',
  'Ivy Cudgel', 'Judgment', 'Knock Off', 'Lash Out', 'Low Kick', 'Meteor Beam', 'Misty Explosion',
  'Multi-Attack', 'Natural Gift', 'Nature Power', "Nature's Madness", 'Nihil Light', 'Order Up',
  'Pain Split', 'Payback', 'Photon Geyser', 'Poltergeist', 'Power Trip', 'Psyblade', 'Punishment',
  'Pursuit', 'Raging Bull', 'Revelation Dance', 'Reversal', 'Rising Voltage', 'Shell Side Arm',
  'Sky Drop', 'Smelling Salts', 'Solar Beam', 'Solar Blade', 'Spectral Thief', 'Steel Roller',
  'Stored Power', 'Struggle', 'Synchronoise', 'Techno Blast', 'Tera Blast', 'Tera Starstorm',
  'Terrain Pulse', 'Thousand Arrows', 'Triple Axel', 'Triple Kick', 'Venoshock', 'Wake-Up Slap',
  'Water Shuriken', 'Water Spout', 'Weather Ball', 'Wring Out', 'Light That Burns the Sky',
  'G-Max Drum Solo', 'G-Max Fire Ball', 'G-Max Hydrosnipe', 'G-Max One Blow', 'G-Max Rapid Flow',
];

const EXCLUDED_MOVES: ReadonlySet<string> = new Set(
  SMOGON_SPECIAL_MOVES.filter((name) => !HANDLED_SPECIAL_MOVES.has(name)),
);

const WEATHERS: readonly Weather[] = [
  'none', 'none', 'none', 'sun', 'rain', 'sand', 'snow', 'harshSun', 'heavyRain', 'strongWinds',
];
const TERRAINS: readonly Terrain[] = ['none', 'none', 'electric', 'grassy', 'misty', 'psychic'];
const STATUSES: readonly Pokemon['status'][] = ['brn', 'par', 'psn', 'tox', 'slp', 'frz'];

type DexMove = SmogonGeneration['moves'] extends { [Symbol.iterator](): Iterator<infer M> } ? M : never;
type DexSpecies = SmogonGeneration['species'] extends { [Symbol.iterator](): Iterator<infer S> } ? S : never;

interface GamePools {
  species: DexSpecies[];
  damagingMoves: DexMove[];
  statusMoves: DexMove[];
  abilities: string[];
  items: string[];
  natures: string[];
  /** Mega form name -> the Mega Stone it evolves with. */
  megaStones: ReadonlyMap<string, string>;
}

function buildPools(game: OracleGame): GamePools {
  const gen = smogonGeneration(game);
  const abilityNames = new Set([...gen.abilities].map((a) => a.name as string));
  const itemNames = new Set([...gen.items].map((i) => i.name as string));

  const species = [...gen.species].filter((s) => s.types.every((t) => isTypeName(t)));
  const usable = [...gen.moves].filter(
    (m) =>
      isTypeName(m.type) &&
      !m.isZ &&
      !m.isMax &&
      m.multihit === undefined &&
      !EXCLUDED_MOVES.has(m.name) &&
      // Fixed-damage moves (Seismic Toss, Super Fang, ...) carry `damage`.
      !('damage' in m && m.damage !== undefined),
  );
  const damagingMoves = usable.filter((m) => m.category !== 'Status' && m.basePower > 0);
  const statusMoves = usable.filter((m) => m.category === 'Status');

  const megaStones = new Map<string, string>();
  for (const item of gen.items) {
    for (const mega of Object.values(item.megaStone ?? {})) megaStones.set(mega, item.name);
  }

  return {
    species,
    damagingMoves,
    statusMoves,
    abilities: [...SUPPORTED_ABILITIES, ...NEUTRAL_ABILITIES].filter((a) => abilityNames.has(a)),
    items: [...SUPPORTED_ITEMS, ...NEUTRAL_ITEMS].filter((i) => itemNames.has(i)),
    natures: [...gen.natures].map((n) => n.name as string),
    megaStones,
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const zeroTable = (): StatTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });

/** Splits a random budget over shuffled stats, respecting a per-stat cap. */
function randomSpread(rng: Rng, perStatMax: number, totalMax: number): StatTable {
  const out = zeroTable();
  if (rng.chance(0.3)) {
    // A typical "two maxed stats and a leftover" spread.
    const [a, b, c] = rng.shuffle(STATS);
    if (a === undefined || b === undefined || c === undefined) throw new Error('unreachable');
    out[a] = perStatMax;
    out[b] = perStatMax;
    out[c] = Math.min(perStatMax, totalMax - 2 * perStatMax);
    return out;
  }
  let remaining = rng.int(0, totalMax);
  for (const stat of rng.shuffle(STATS)) {
    const value = rng.int(0, Math.min(perStatMax, remaining));
    out[stat] = value;
    remaining -= value;
  }
  return out;
}

function randomIvs(rng: Rng): StatTable {
  const out = zeroTable();
  for (const stat of STATS) out[stat] = rng.chance(0.6) ? 31 : rng.int(0, 31);
  return out;
}

/**
 * A Mega form always holds its own Mega Stone, since Mega Evolution needs it.
 * The random draw still happens for Megas so every other case replays the
 * same. Gen 9's dex has one Mega without a stone, Rayquaza-Mega, which keeps
 * the random item.
 */
function randomItem(rng: Rng, pools: GamePools, species: string): string | null {
  const drawn = rng.chance(0.7) ? rng.pick(pools.items) : null;
  return pools.megaStones.get(species) ?? drawn;
}

function randomPokemon(rng: Rng, game: OracleGame, pools: GamePools): Pokemon {
  const dex = rng.pick(pools.species);
  const types = dex.types.filter(isTypeName);

  let level: number;
  let ivs: StatTable;
  let evs: StatTable;
  if (game === 'champions') {
    level = CHAMPIONS_LEVEL;
    ivs = { hp: CHAMPIONS_IV, atk: CHAMPIONS_IV, def: CHAMPIONS_IV, spa: CHAMPIONS_IV, spd: CHAMPIONS_IV, spe: CHAMPIONS_IV };
    const sp = randomSpread(rng, MAX_SP_PER_STAT, MAX_SP_TOTAL);
    evs = zeroTable();
    for (const stat of STATS) evs[stat] = spToEv(sp[stat]);
  } else {
    level = rng.chance(0.6) ? 50 : rng.chance(0.3) ? 100 : rng.int(1, 100);
    ivs = randomIvs(rng);
    evs = randomSpread(rng, 252, 510);
  }

  const statBoosts = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  for (const stat of BOOSTABLE) {
    if (rng.chance(0.35)) statBoosts[stat] = rng.int(-6, 6);
  }

  const nature = rng.pick(pools.natures);
  const baseStats = { ...dex.baseStats };

  let currentHp: number | null = null;
  if (rng.chance(0.25)) {
    const maxHp = calculateStats(baseStats, ivs, evs, nature, level).hp;
    currentHp = rng.chance(0.3) ? maxHp : rng.int(1, maxHp);
  }

  return {
    species: dex.name,
    level,
    types,
    isTerastallized: false,
    baseStats,
    ivs,
    evs,
    nature,
    ability: rng.pick(pools.abilities),
    abilitySuppressed: rng.chance(0.05),
    item: randomItem(rng, pools, dex.name),
    weightKg: dex.weightkg,
    currentHp,
    statBoosts,
    status: rng.chance(0.75) ? 'none' : rng.pick(STATUSES),
  };
}

const TARGETS: Readonly<Record<string, Move['target']>> = {
  allAdjacentFoes: 'allAdjacentFoes',
  allAdjacent: 'allAdjacent',
  self: 'self',
};

function randomMove(rng: Rng, pools: GamePools): { move: Move; willCrit: boolean } {
  const dex = rng.chance(0.02) ? rng.pick(pools.statusMoves) : rng.pick(pools.damagingMoves);
  if (!isTypeName(dex.type)) throw new Error(`unreachable: ${dex.type}`);
  const category: MoveCategory = dex.category ?? 'Status';
  const f = dex.flags;
  return {
    move: {
      name: dex.name,
      type: dex.type,
      basePower: dex.basePower,
      variablePower: 'none',
      category,
      target: (dex.target !== undefined ? TARGETS[dex.target] : undefined) ?? 'single',
      priority: dex.priority ?? 0,
      hits: 1,
      flags: {
        contact: f.contact === 1,
        punch: f.punch === 1,
        sound: f.sound === 1,
        slicing: f.slicing === 1,
        bite: f.bite === 1,
        bullet: f.bullet === 1,
        wind: f.wind === 1,
        pulse: f.pulse === 1,
      },
    },
    willCrit: dex.willCrit === true,
  };
}

function randomSide(rng: Rng): SideState {
  return {
    reflect: rng.chance(0.2),
    lightScreen: rng.chance(0.2),
    auroraVeil: rng.chance(0.1),
    tailwind: false,
    helpingHand: false,
    friendGuard: false,
    battery: false,
    powerSpot: false,
    steelySpirit: false,
    stealthRock: rng.chance(0.15),
    spikes: rng.chance(0.15) ? rng.int(1, 3) : 0,
  };
}

function randomField(rng: Rng): FieldState {
  return {
    weather: rng.pick(WEATHERS),
    terrain: rng.pick(TERRAINS),
    isDoubles: rng.chance(0.7),
    isGravity: rng.chance(0.08),
    isWonderRoom: rng.chance(0.15),
    isMagicRoom: rng.chance(0.08),
    isBeadsOfRuin: rng.chance(0.15),
    isSwordOfRuin: rng.chance(0.15),
    isTabletsOfRuin: rng.chance(0.15),
    isVesselOfRuin: rng.chance(0.15),
    attackerSide: randomSide(rng),
    defenderSide: randomSide(rng),
  };
}

function randomContext(rng: Rng, game: OracleGame, pools: GamePools): DamageContext {
  const attacker = randomPokemon(rng, game, pools);
  const defender = randomPokemon(rng, game, pools);
  const { move, willCrit } = randomMove(rng, pools);
  const field = randomField(rng);
  return { game, attacker, defender, move, field, isCritical: willCrit || rng.chance(0.25) };
}

// ---------------------------------------------------------------------------
// Running both calculators
// ---------------------------------------------------------------------------

type Outcome = { rolls: number[] } | { error: string };

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function runOurs(ctx: DamageContext): Outcome {
  try {
    return { rolls: calculate(ctx).rolls };
  } catch (e) {
    return { error: errorText(e) };
  }
}

function runOracle(game: OracleGame, ctx: DamageContext): Outcome {
  try {
    const { damage } = smogonCalculate(
      smogonGeneration(game),
      toSmogonPokemon(game, ctx.attacker),
      toSmogonPokemon(game, ctx.defender),
      toSmogonMove(game, ctx.move, { isCrit: ctx.isCritical }),
      toSmogonField(ctx.field),
    );
    const rolls = typeof damage === 'number' ? new Array<number>(ROLLS).fill(damage) : damage.flat();
    return { rolls };
  } catch (e) {
    return { error: errorText(e) };
  }
}

const sameOutcome = (a: Outcome, b: Outcome): boolean =>
  'rolls' in a && 'rolls' in b && a.rolls.length === b.rolls.length && a.rolls.every((r, i) => r === b.rolls[i]);

const showOutcome = (o: Outcome): string => ('rolls' in o ? `[${o.rolls.join(', ')}]` : `threw ${o.error}`);

interface Mismatch {
  index: number;
  ctx: DamageContext;
  ours: Outcome;
  theirs: Outcome;
}

// ---------------------------------------------------------------------------
// Known @smogon/calc bugs
// ---------------------------------------------------------------------------
//
// Mismatches matching one of these are expected disagreements: the oracle is
// wrong, not us. They do not fail the test, but each one is still counted
// and printed. Keep `matches` narrow (the setup and the shape of the wrong
// answer) so a real defect in the same area still fails.

interface KnownOracleBug {
  id: string;
  description: string;
  matches(game: OracleGame, ctx: DamageContext, ours: Outcome, theirs: Outcome): boolean;
}

const KNOWN_ORACLE_BUGS: readonly KnownOracleBug[] = [
  {
    id: 'body-press-wonder-room',
    description:
      'Body Press under Wonder Room: checkRawStatChanges has already swapped the ' +
      "attacker's Def and SpD, then calculateAttack reads 'spd' when isWonderRoom " +
      "(gen789.js:956, champions.js:557), so it swaps twice and uses the unswapped Def.",
    matches: (_game, ctx, ours, theirs) =>
      ctx.move.name === 'Body Press' && ctx.field.isWonderRoom && 'rolls' in ours && 'rolls' in theirs,
  },
  {
    id: 'champions-iron-ball-levitate',
    description:
      'Champions only: the Levitate / Eelevate Ground immunity check (champions.js:178) ' +
      "lacks gen789.js's !hasItem('Iron Ball') guard, so a grounded Iron Ball holder " +
      'takes 0 from Ground moves.',
    matches: (game, ctx, ours, theirs) =>
      game === 'champions' &&
      ctx.move.type === 'Ground' &&
      ctx.defender.item === 'Iron Ball' &&
      (ctx.defender.ability === 'Levitate' || ctx.defender.ability === 'Eelevate') &&
      !ctx.field.isGravity &&
      'rolls' in ours &&
      ours.rolls.some((r) => r > 0) &&
      'rolls' in theirs &&
      theirs.rolls.every((r) => r === 0),
  },
];

function knownOracleBug(game: OracleGame, m: Mismatch): KnownOracleBug | undefined {
  return KNOWN_ORACLE_BUGS.find((bug) => bug.matches(game, m.ctx, m.ours, m.theirs));
}

function oneLine(game: OracleGame, m: Mismatch): string {
  const { attacker: a, defender: d, move, field } = m.ctx;
  return (
    `${game} #${m.index}: ${a.species} (${a.ability}, ${a.item ?? 'no item'}) ${move.name} ` +
    `[${move.type} ${move.category} ${move.basePower}] -> ${d.species} (${d.ability}, ${d.item ?? 'no item'}) ` +
    `weather=${field.weather} terrain=${field.terrain} crit=${m.ctx.isCritical} ` +
    `| ours ${showOutcome(m.ours)} | smogon ${showOutcome(m.theirs)}`
  );
}

function reproduction(game: OracleGame, m: Mismatch): string {
  return [
    `// ---- fuzz mismatch: game=${game} seed=${SEED} case=${m.index} ----`,
    `// replay: FUZZ_SEED=${SEED} npm run test:fuzz`,
    `const game: OracleGame = '${game}';`,
    `const ctx: DamageContext = ${JSON.stringify(m.ctx, null, 2)};`,
    `// ours:   ${showOutcome(m.ours)}`,
    `// smogon: ${showOutcome(m.theirs)}`,
  ].join('\n');
}

describe.each(GAMES)('fuzz: calculate() vs @smogon/calc (%s)', (game) => {
  it(`agrees on all 16 rolls for ${CASES} random cases (seed ${SEED})`, { timeout: 300_000 }, () => {
    const pools = buildPools(game);
    expect(pools.species.length).toBeGreaterThan(0);
    expect(pools.damagingMoves.length).toBeGreaterThan(0);

    const mismatches: Mismatch[] = [];
    for (let index = 0; index < CASES; index++) {
      const ctx = randomContext(caseRng(game, index), game, pools);
      const ours = runOurs(ctx);
      const theirs = runOracle(game, ctx);
      if (!sameOutcome(ours, theirs)) mismatches.push({ index, ctx, ours, theirs });
    }

    const expected = new Map<KnownOracleBug, Mismatch[]>();
    const unexpected: Mismatch[] = [];
    for (const m of mismatches) {
      const bug = knownOracleBug(game, m);
      if (bug === undefined) unexpected.push(m);
      else expected.set(bug, [...(expected.get(bug) ?? []), m]);
    }

    const passed = CASES - mismatches.length;
    console.log(
      `[fuzz] ${game}: ${passed}/${CASES} cases matched, ` +
        `${mismatches.length - unexpected.length} expected disagreements (known @smogon/calc bugs), ` +
        `${unexpected.length} unexpected (seed ${SEED})`,
    );
    for (const [bug, hits] of expected) {
      console.log(`[fuzz] ${game}: expected disagreement ${bug.id} x${hits.length}: ${bug.description}`);
      for (const m of hits) console.log(`  ${oneLine(game, m)}`);
    }
    if (unexpected.length > 0) {
      for (const m of unexpected) console.log(oneLine(game, m));
      for (const m of unexpected.slice(0, PRINT_LIMIT)) console.log(reproduction(game, m));
      if (unexpected.length > PRINT_LIMIT) {
        console.log(`[fuzz] ${unexpected.length - PRINT_LIMIT} more not printed in full; raise FUZZ_PRINT to see them.`);
      }
    }

    expect(unexpected.map((m) => m.index), `${unexpected.length} of ${CASES} ${game} cases disagree with @smogon/calc`).toEqual([]);
  });
});
