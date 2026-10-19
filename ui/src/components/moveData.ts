// Reads move data from @smogon/calc and converts it to our Move type.
// Used by MoveInput. Imports the data entry point only, so the UI bundle
// does not pull in the damage mechanics.

import { Generations } from '@smogon/calc/dist/data';
import type {
  Move as SmogonMove,
  MoveTarget as SmogonMoveTarget,
} from '@smogon/calc/dist/data/interface';
import type { Game, Move, MoveFlags, MoveTarget, TypeName, VariablePower } from '@vgc/types';

const TYPE_NAMES: ReadonlySet<string> = new Set<TypeName>([
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
  'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug',
  'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
]);

function isTypeName(value: string | undefined): value is TypeName {
  return value !== undefined && TYPE_NAMES.has(value);
}

// @smogon/calc numbers Champions as generation 0.
function generationFor(game: Game) {
  return Generations.get(game === 'champions' ? 0 : 9);
}

// Their data omits `target` for single-target moves and only lists the two
// spread targets. Anything else is treated as single-target, which matches
// their own Move class (missing target falls back to 'any').
function toTarget(target: SmogonMoveTarget | undefined): MoveTarget {
  switch (target) {
    case 'allAdjacentFoes':
    case 'allAdjacent':
    case 'self':
      return target;
    default:
      return 'single';
  }
}

// Same default hit count as their Move class: a fixed count is used as is,
// a range [min, max] defaults to min + 1 (3 for the usual 2-5 moves).
function toHits(multihit: number | number[] | undefined): number {
  if (multihit === undefined) return 1;
  if (typeof multihit === 'number') return multihit;
  const [min] = multihit;
  return min === undefined ? 1 : min + 1;
}

function toFlags(flags: SmogonMove['flags']): MoveFlags {
  return {
    contact: flags.contact === 1,
    punch: flags.punch === 1,
    sound: flags.sound === 1,
    slicing: flags.slicing === 1,
    bite: flags.bite === 1,
    bullet: flags.bullet === 1,
    wind: flags.wind === 1,
    pulse: flags.pulse === 1,
  };
}

// @smogon/calc computes these powers from the move name, so its data has no
// field for them. Only moves whose power clearly depends on one quantity are
// listed. Heavy Slam and Heat Crash use the user/target weight ratio; they
// are tagged userWeight because they are the only moves that read the
// user's weight. Flail and Reversal are left out: they scale inversely with
// user HP, which the single userHpRatio tag cannot express.
const VARIABLE_POWER: Readonly<Record<string, VariablePower>> = {
  'Low Kick': 'targetWeight',
  'Grass Knot': 'targetWeight',
  'Heavy Slam': 'userWeight',
  'Heat Crash': 'userWeight',
  'Gyro Ball': 'speedRatio',
  'Electro Ball': 'speedRatio',
  'Eruption': 'userHpRatio',
  'Water Spout': 'userHpRatio',
  'Dragon Energy': 'userHpRatio',
  'Crush Grip': 'targetHpRatio',
  'Wring Out': 'targetHpRatio',
  'Hard Press': 'targetHpRatio',
  'Acrobatics': 'noItem',
};

function toMove(data: SmogonMove): Move | null {
  // Some Champions entries are incomplete in their data (e.g. Metal Claw has
  // no type or power). Offering them would mean inventing values.
  if (!isTypeName(data.type) || typeof data.basePower !== 'number') return null;
  return {
    name: data.name,
    type: data.type,
    basePower: data.basePower,
    variablePower: VARIABLE_POWER[data.name] ?? 'none',
    // Their Move class treats a missing category as Status in Gen 4+ and
    // Champions; about 86 Champions status moves omit it.
    category: data.category ?? 'Status',
    target: toTarget(data.target),
    priority: data.priority ?? 0,
    hits: toHits(data.multihit),
    flags: toFlags(data.flags),
  };
}

const cache = new Map<Game, ReadonlyMap<string, Move>>();

// Every selectable move for the game, keyed by name and sorted by name.
// Z-Moves, Max Moves and the "(No Move)" placeholder are left out: none of
// them can be chosen as a regular move in either game.
export function movesFor(game: Game): ReadonlyMap<string, Move> {
  const cached = cache.get(game);
  if (cached) return cached;

  const moves: Move[] = [];
  for (const data of generationFor(game).moves) {
    if (data.isZ || data.isMax || data.id === 'nomove') continue;
    const move = toMove(data);
    if (move) moves.push(move);
  }
  moves.sort((a, b) => a.name.localeCompare(b.name));

  const byName = new Map(moves.map((move) => [move.name, move] as const));
  cache.set(game, byName);
  return byName;
}

export function findMove(game: Game, name: string): Move | undefined {
  return movesFor(game).get(name);
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Case- and punctuation-insensitive search ("uturn" finds "U-turn").
// Names that start with the query come before names that only contain it.
export function searchMoves(game: Game, query: string, limit: number): Move[] {
  const all = [...movesFor(game).values()];
  const needle = normalize(query);
  if (needle === '') return all.slice(0, limit);

  const starts: Move[] = [];
  const contains: Move[] = [];
  for (const move of all) {
    const hay = normalize(move.name);
    if (hay.startsWith(needle)) starts.push(move);
    else if (hay.includes(needle)) contains.push(move);
  }
  return [...starts, ...contains].slice(0, limit);
}
