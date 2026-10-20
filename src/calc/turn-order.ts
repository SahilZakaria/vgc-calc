import type { FieldState, Game, Move, Pokemon } from '../types';
import { withItemChecked } from './modifiers/abilities-items';
import { isGrounded } from './modifiers/field';
import { finalSpeed, speedItem, type SpeedBreakdown } from './speed';
import { calculateStats } from './stats';

/**
 * The order the moves chosen this turn resolve in. One turn, one move per
 * Pokemon; no multi-turn sequencing.
 *
 * SOURCE
 * ------
 * Pokemon Showdown's simulator (the copy bundled with @pkmn/mods, plus
 * sim/pokemon.ts on GitHub for the Gen 9 getActionSpeed):
 *   - Actions sort by priority, highest first, then by action Speed, highest
 *     first. Equal priority and equal action Speed is decided at random
 *     (speedSort), shown here as a coin flip, never silently ordered.
 *   - Priority is the move's priority after onModifyPriority:
 *       Prankster    +1 to Status moves
 *       Gale Wings   +1 to Flying moves at full HP
 *       Triage       +3 to healing moves (Showdown's "heal" move flag)
 *       Grassy Glide +1 in Grassy Terrain when the user is grounded
 *     then onFractionalPriority, which only reorders within a bracket:
 *       Stall, Lagging Tail, Full Incense, and Mycelium Might on Status moves
 *       make the user move last in its bracket (-0.1).
 *   - Action Speed (Pokemon#getActionSpeed) is the effective Speed from
 *     speed.ts, changed by Trick Room. Trick Room never touches priority.
 *       Gen 9:     Trick Room uses 10000 - Speed, and the result is cut to
 *                  13 bits (trunc(speed, 13), so mod 8192). Under Trick Room
 *                  a Speed of 1809 or more wraps around and moves first in
 *                  its bracket; without it, a Speed of 8192 or more wraps.
 *       Champions: the @pkmn/mods Champions mod replaces getActionSpeed with
 *                  plain -Speed under Trick Room ("Remove Trick Room
 *                  underflow"), with no 13-bit cut.
 *
 * NOT MODELED (deliberately): Quash, After You, Instruct and other moves that
 * change the order of others; Quick Claw, Quick Draw and Custap Berry (chance
 * or HP based; flagged in the notes); Speed changes made during the turn
 * (a Tailwind or Trick Room set this turn applies from the next turn, which
 * this one-turn view does not show); switching and Mega Evolution timing.
 */

/** Effects that let a Pokemon move first in its bracket by chance or HP. */
const CHANCE_FIRST_ITEMS: Readonly<Record<string, string>> = {
  'Quick Claw': 'Quick Claw may let it move first in its bracket (20% chance), not modeled',
  'Custap Berry': 'Custap Berry lets it move first in its bracket at 1/4 HP or less, not modeled',
};

const MOVES_LAST_ITEMS: ReadonlySet<string> = new Set(['Lagging Tail', 'Full Incense']);

/** One Pokemon and the move it uses this turn. */
export interface TurnOrderEntry {
  /** Caller's key for this Pokemon, e.g. its field slot. */
  id: string;
  pokemon: Pokemon;
  move: Move;
  /** Tailwind is up on this Pokemon's side. */
  tailwind: boolean;
  /** The held item has been used or lost (Unburden active). */
  itemConsumed: boolean;
  /**
   * The move heals the user (Showdown's "heal" flag), for Triage. Move has
   * no such flag in src/types.ts, so the caller looks it up.
   */
  moveHeals: boolean;
}

export interface TurnOrderInput {
  game: Game;
  field: FieldState;
  /** Trick Room is up. FieldState has no flag for it, so it is passed here. */
  isTrickRoom: boolean;
  entries: readonly TurnOrderEntry[];
}

export interface PriorityBreakdown {
  /** The move's own priority. */
  base: number;
  /** After abilities and terrain. This is the bracket. */
  bracket: number;
  /** What changed it, e.g. "Prankster +1". */
  sources: string[];
  /** Moves last within its bracket, and why (e.g. "Lagging Tail"). */
  movesLast: string | null;
}

export interface PlacedMove {
  entry: TurnOrderEntry;
  priority: PriorityBreakdown;
  speed: SpeedBreakdown;
  /** The value compared within a bracket (Trick Room applied). */
  actionSpeed: number;
  /** 1-based place. Tied moves share the range first..last. */
  first: number;
  last: number;
  /** ids of the moves this one is tied with (coin flip); empty if none. */
  tiedWith: string[];
  /** Chance-based effects that could change its place, not modeled. */
  notes: string[];
}

export interface TurnOrder {
  game: Game;
  isTrickRoom: boolean;
  moves: PlacedMove[];
}

function hasAbility(pokemon: Pokemon, ability: string): boolean {
  return !pokemon.abilitySuppressed && pokemon.ability === ability;
}

function isAtFullHp(pokemon: Pokemon): boolean {
  if (pokemon.currentHp === null) return true;
  const max = calculateStats(pokemon.baseStats, pokemon.ivs, pokemon.evs, pokemon.nature, pokemon.level).hp;
  return pokemon.currentHp >= max;
}

const signed = (n: number): string => (n > 0 ? `+${n}` : `${n}`);

export function movePriority(entry: TurnOrderEntry, field: FieldState): PriorityBreakdown {
  const { pokemon, move } = entry;
  const base = move.priority;
  let bracket = base;
  const sources: string[] = [];
  const add = (amount: number, source: string) => {
    bracket += amount;
    sources.push(`${source} ${signed(amount)}`);
  };

  if (hasAbility(pokemon, 'Prankster') && move.category === 'Status') add(1, 'Prankster');
  if (hasAbility(pokemon, 'Gale Wings') && move.type === 'Flying' && isAtFullHp(pokemon)) add(1, 'Gale Wings');
  if (hasAbility(pokemon, 'Triage') && entry.moveHeals) add(3, 'Triage');
  if (move.name === 'Grassy Glide' && field.terrain === 'grassy') {
    // Grounding reads the item the Pokemon still has (Iron Ball, Air Balloon).
    const holder = { ...pokemon, item: speedItem(pokemon, { field, itemConsumed: entry.itemConsumed }) };
    if (isGrounded(holder, field)) add(1, 'Grassy Terrain');
  }

  const item = entry.itemConsumed ? null : withItemChecked(pokemon, field.isMagicRoom).item;
  let movesLast: string | null = null;
  if (hasAbility(pokemon, 'Mycelium Might') && move.category === 'Status') movesLast = 'Mycelium Might';
  else if (hasAbility(pokemon, 'Stall')) movesLast = 'Stall';
  else if (item !== null && MOVES_LAST_ITEMS.has(item)) movesLast = item;

  return { base, bracket, sources, movesLast };
}

/** Pokemon#getActionSpeed for each game. */
export function actionSpeed(game: Game, speed: number, isTrickRoom: boolean): number {
  if (game === 'champions') return isTrickRoom ? -speed : speed;
  const value = isTrickRoom ? 10000 - speed : speed;
  return value % 8192;
}

function notesFor(entry: TurnOrderEntry, field: FieldState, priority: PriorityBreakdown): string[] {
  const notes: string[] = [];
  const { pokemon, move } = entry;
  const item = entry.itemConsumed ? null : withItemChecked(pokemon, field.isMagicRoom).item;
  // Both only work in brackets of 0 or lower.
  if (item !== null && CHANCE_FIRST_ITEMS[item] && priority.bracket <= 0) notes.push(CHANCE_FIRST_ITEMS[item]);
  if (hasAbility(pokemon, 'Quick Draw') && move.category !== 'Status') {
    notes.push('Quick Draw may let it move first in its bracket (30% chance), not modeled');
  }
  return notes;
}

const WEATHER_SUPPRESSORS = ['Air Lock', 'Cloud Nine'];

export function turnOrder(input: TurnOrderInput): TurnOrder {
  const { game, field, isTrickRoom, entries } = input;
  const weatherSuppressed = entries.some((e) => WEATHER_SUPPRESSORS.some((a) => hasAbility(e.pokemon, a)));

  const scored = entries.map((entry) => {
    const priority = movePriority(entry, field);
    const speed = finalSpeed(entry.pokemon, {
      game,
      field,
      tailwind: entry.tailwind,
      itemConsumed: entry.itemConsumed,
      weatherSuppressed,
    });
    return {
      entry,
      priority,
      speed,
      actionSpeed: actionSpeed(game, speed.speed, isTrickRoom),
      notes: notesFor(entry, field, priority),
    };
  });

  // Fractional priority: "moves last" sits just below its bracket.
  const rank = (s: (typeof scored)[number]) => s.priority.bracket - (s.priority.movesLast ? 0.1 : 0);
  // Stable sort keeps input order inside a tie; ties are reported, not decided.
  const sorted = [...scored].sort((a, b) => rank(b) - rank(a) || b.actionSpeed - a.actionSpeed);
  const sameSlot = (a: (typeof scored)[number], b: (typeof scored)[number]) =>
    rank(a) === rank(b) && a.actionSpeed === b.actionSpeed;

  const moves: PlacedMove[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sameSlot(sorted[i]!, sorted[j + 1]!)) j++;
    const group = sorted.slice(i, j + 1);
    for (const s of group) {
      moves.push({
        ...s,
        first: i + 1,
        last: j + 1,
        tiedWith: group.filter((o) => o !== s).map((o) => o.entry.id),
      });
    }
    i = j + 1;
  }
  return { game, isTrickRoom, moves };
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

const multiplierText = (m: number): string => {
  const x = m / 4096;
  return `${Number.isInteger(x) ? x : x.toFixed(2).replace(/0$/, '')}x`;
};

/** Effective Speed and what changed it from the stat, e.g. "244 Speed (122, Tailwind 2x)". */
export function speedText(speed: SpeedBreakdown): string {
  const parts: string[] = [];
  if (speed.stage !== 0) parts.push(`${signed(speed.stage)} stage`);
  for (const m of speed.modifiers) parts.push(`${m.source} ${multiplierText(m.multiplier)}`);
  if (speed.paralyzed) parts.push('paralysis 0.5x');
  if (speed.capped) parts.push('capped at 10000');
  return parts.length === 0 ? `${speed.speed} Speed` : `${speed.speed} Speed (${speed.stat}, ${parts.join(', ')})`;
}

/** Priority bracket with its causes, e.g. "priority +1 (Prankster +1)". */
export function priorityText(priority: PriorityBreakdown): string {
  const causes = priority.sources.length > 0 ? ` (${priority.sources.join(', ')})` : '';
  return `priority ${signed(priority.bracket)}${causes}`;
}

/** How Trick Room changes the order, said once for the whole turn. */
export const TRICK_ROOM_NOTE = 'slower moves first within each priority bracket';

export const placeText =(m: PlacedMove): string => (m.first === m.last ? `${m.first}` : `${m.first}-${m.last}`);

/**
 * Why a move sits where it does relative to the others: its bracket when that
 * separates it from its neighbors, its Speed when it shares a bracket, and the
 * coin flip when it ties.
 */
export function placementReason(order: TurnOrder, move: PlacedMove, nameOf: (id: string) => string): string {
  const parts: string[] = [];
  const sharesBracket = order.moves.some((o) => o !== move && o.priority.bracket === move.priority.bracket);
  if (move.priority.bracket !== 0 || move.priority.sources.length > 0 || !sharesBracket) {
    parts.push(priorityText(move.priority));
  }
  if (move.priority.movesLast) parts.push(`moves last in bracket (${move.priority.movesLast})`);
  if (sharesBracket) {
    // Trick Room is stated once for the whole order (TRICK_ROOM_NOTE).
    let speed = speedText(move.speed);
    const overflow = overflowNote(order, move);
    if (overflow) speed += `, ${overflow}`;
    parts.push(speed);
  }
  if (move.tiedWith.length > 0) {
    parts.push(`Speed tie with ${move.tiedWith.map(nameOf).join(' and ')}: coin flip`);
  }
  parts.push(...move.notes);
  return parts.join('; ');
}

/** Speed at or above which Gen 9 Trick Room's 13-bit cut makes a Pokemon move first. */
export const GEN9_TRICK_ROOM_OVERFLOW = 1809;
/** Speed at or above which the Gen 9 13-bit cut wraps outside Trick Room. */
export const GEN9_SPEED_OVERFLOW = 8192;

/** The Gen 9 13-bit wraparound, when it takes this move out of plain Speed order. */
function overflowNote(order: TurnOrder, move: PlacedMove): string | null {
  if (order.game !== 'gen9') return null;
  const speed = move.speed.speed;
  if (order.isTrickRoom && speed >= GEN9_TRICK_ROOM_OVERFLOW) {
    return `Gen 9 Trick Room overflow: ${GEN9_TRICK_ROOM_OVERFLOW}+ Speed moves before Pokemon under ${GEN9_TRICK_ROOM_OVERFLOW}`;
  }
  if (!order.isTrickRoom && speed >= GEN9_SPEED_OVERFLOW) {
    return `Gen 9 overflow: ${GEN9_SPEED_OVERFLOW}+ Speed wraps around to ${move.actionSpeed}`;
  }
  return null;
}

/**
 * Plain-text turn order, one line per move:
 *   1. Garchomp: Earthquake (122 Speed)
 *   2-3. (coin flip) Incineroar: Flare Blitz (80 Speed; Speed tie with ...)
 */
export function formatTurnOrder(order: TurnOrder, nameOf: (id: string) => string): string {
  const lines = [order.isTrickRoom ? `Turn order (Trick Room: ${TRICK_ROOM_NOTE}):` : 'Turn order:'];
  for (const move of order.moves) {
    const tie = move.tiedWith.length > 0 ? ' (coin flip)' : '';
    const name = nameOf(move.entry.id);
    const moveName = move.entry.move.name || 'no move';
    lines.push(`${placeText(move)}.${tie} ${name}: ${moveName} (${placementReason(order, move, nameOf)})`);
  }
  return lines.join('\n');
}

