import type { FieldState, Game, Pokemon, Terrain, Weather } from '../types';
import { finalSpeed, type SpeedBreakdown } from './speed';
import { actionSpeed, speedText } from './turn-order';

/**
 * Switch-in abilities that set the weather or the terrain, and which one wins
 * when several are on the field. Like Intimidate, these are not damage
 * modifiers: the caller resolves them here and passes the resulting weather
 * and terrain to calculate() in FieldState.
 *
 * SOURCE
 * ------
 * Pokemon Showdown (data/abilities.ts as bundled in @pkmn/mods 0.10.11, and
 * sim/battle.ts and sim/pokemon.ts on GitHub master, read 2026-10-20):
 *   - Every ability below calls field.setWeather / field.setTerrain in its
 *     onStart handler, so it fires on switch-in. Sand Spit and Seed Sower set
 *     sand / Grassy Terrain only when hit (onDamagingHit), so they are not
 *     switch-in setters and are left out.
 *   - Switch-in handlers run in speedSort order of handler.speed, which
 *     resolvePriority sets to pokemon.speed, and pokemon.speed is
 *     getActionSpeed(): the effective Speed, reversed by Trick Room. So the
 *     fastest activates first and the slowest last; the last setter's weather
 *     overwrites the rest. Under Trick Room the order flips and the fastest
 *     wins. Exact ties are shuffled at random (speedSort / speedOrder).
 *   - Desolate Land, Primordial Sea and Delta Stream have onAnySetWeather
 *     handlers that refuse any non-primal weather while their own primal
 *     weather is up. A primal weather replaces anything, including another
 *     primal weather.
 *
 * The Speed used is speed.ts finalSpeed with turn-order.ts actionSpeed, the
 * same numbers the turn order uses. A setter's own Speed cannot depend on the
 * weather or terrain through its ability (its ability is the setter), so the
 * field passed in only matters for Tailwind-style side effects.
 *
 * Champions: the primal weathers belong to legendaries Champions does not
 * have, and calculate.ts treats them as no weather there, so the three primal
 * abilities set nothing in Champions mode.
 *
 * NOT MODELED: Neutralizing Gas (stops other abilities from activating),
 * Mega Evolution or switching mid-turn re-triggering a setter, and Cloud
 * Nine / Air Lock, which leave the weather set but cancel its effects (the
 * damage calc and speed.ts already handle that suppression).
 */

/** Switch-in abilities that set the weather. */
export const WEATHER_ABILITIES: Readonly<Record<string, Weather>> = {
  Drought: 'sun',
  'Orichalcum Pulse': 'sun',
  Drizzle: 'rain',
  'Sand Stream': 'sand',
  'Snow Warning': 'snow',
  'Desolate Land': 'harshSun',
  'Primordial Sea': 'heavyRain',
  'Delta Stream': 'strongWinds',
};

/** Switch-in abilities that set the terrain. */
export const TERRAIN_ABILITIES: Readonly<Record<string, Terrain>> = {
  'Electric Surge': 'electric',
  'Hadron Engine': 'electric',
  'Grassy Surge': 'grassy',
  'Misty Surge': 'misty',
  'Psychic Surge': 'psychic',
};

/** Weathers only another primal weather can replace. */
export const PRIMAL_WEATHERS: ReadonlySet<Weather> = new Set<Weather>(['harshSun', 'heavyRain', 'strongWinds']);

export const WEATHER_NAMES: Readonly<Record<Weather, string>> = {
  none: 'No weather',
  sun: 'Sun',
  rain: 'Rain',
  sand: 'Sand',
  snow: 'Snow',
  harshSun: 'Harsh Sun',
  heavyRain: 'Heavy Rain',
  strongWinds: 'Strong Winds',
};

export const TERRAIN_NAMES: Readonly<Record<Terrain, string>> = {
  none: 'No terrain',
  electric: 'Electric Terrain',
  grassy: 'Grassy Terrain',
  misty: 'Misty Terrain',
  psychic: 'Psychic Terrain',
};

/** One Pokemon on the field as its switch-in ability sees it. */
export interface SwitchInEntry {
  /** Caller's key for this Pokemon, e.g. its field slot. */
  id: string;
  pokemon: Pokemon;
  /** Tailwind is up on this Pokemon's side. */
  tailwind: boolean;
  /** The held item has been used or lost (Unburden active). */
  itemConsumed: boolean;
}

export interface SwitchInInput {
  game: Game;
  field: FieldState;
  isTrickRoom: boolean;
  entries: readonly SwitchInEntry[];
}

export type FieldKind = 'weather' | 'terrain';

export interface FieldSetter<T extends string> {
  id: string;
  ability: string;
  value: T;
  speed: SpeedBreakdown;
  /** The value switch-in order compares (Trick Room applied). */
  actionSpeed: number;
  /** A primal weather was up when this activated, so it failed. */
  blocked: boolean;
}

export interface FieldAbilityResult<T extends string> {
  kind: FieldKind;
  isTrickRoom: boolean;
  /** Every active setter, in the order they activate (first to last). */
  setters: FieldSetter<T>[];
  /** The setter whose weather or terrain stays up, or null when none does. */
  winner: FieldSetter<T> | null;
  /**
   * Setters that tie the winner on action Speed and would have set something
   * else: the switch-in order between them is random. The winner shown is one
   * possible outcome.
   */
  tiedWith: FieldSetter<T>[];
}

export interface SwitchInFieldResult {
  weather: FieldAbilityResult<Weather>;
  terrain: FieldAbilityResult<Terrain>;
}

function activeAbility(pokemon: Pokemon): string | null {
  return pokemon.abilitySuppressed ? null : pokemon.ability;
}

const WEATHER_SUPPRESSORS = ['Air Lock', 'Cloud Nine'];

function resolveKind<T extends string>(
  kind: FieldKind,
  input: SwitchInInput,
  valueOf: (ability: string) => T | undefined,
  isPrimal: (value: T) => boolean,
): FieldAbilityResult<T> {
  const { game, field, isTrickRoom, entries } = input;
  const weatherSuppressed = entries.some((e) => WEATHER_SUPPRESSORS.includes(activeAbility(e.pokemon) ?? ''));

  const found: FieldSetter<T>[] = [];
  for (const entry of entries) {
    const ability = activeAbility(entry.pokemon);
    if (ability === null) continue;
    const value = valueOf(ability);
    if (value === undefined) continue;
    if (game === 'champions' && isPrimal(value)) continue;
    const speed = finalSpeed(entry.pokemon, {
      game,
      field,
      tailwind: entry.tailwind,
      itemConsumed: entry.itemConsumed,
      weatherSuppressed,
    });
    found.push({
      id: entry.id,
      ability,
      value,
      speed,
      actionSpeed: actionSpeed(game, speed.speed, isTrickRoom),
      blocked: false,
    });
  }

  // Fastest action Speed first. The sort is stable, so an exact tie keeps the
  // caller's order; the tie is reported in tiedWith rather than decided.
  const setters = [...found].sort((a, b) => b.actionSpeed - a.actionSpeed);

  let winner: FieldSetter<T> | null = null;
  for (const setter of setters) {
    if (winner && isPrimal(winner.value) && !isPrimal(setter.value)) {
      setter.blocked = true;
      continue;
    }
    winner = setter;
  }

  // A tie only matters between setters that could each be the last to land:
  // the same class (primal or not) as the winner, with a different value.
  const tiedWith = winner
    ? setters.filter(
        (s) =>
          s !== winner &&
          s.actionSpeed === winner.actionSpeed &&
          s.value !== winner.value &&
          isPrimal(s.value) === isPrimal(winner.value),
      )
    : [];

  return { kind, isTrickRoom, setters, winner, tiedWith };
}

/** Which switch-in abilities set the weather and terrain, and which one wins each. */
export function resolveSwitchInField(input: SwitchInInput): SwitchInFieldResult {
  return {
    weather: resolveKind<Weather>(
      'weather',
      input,
      (a) => WEATHER_ABILITIES[a],
      (w) => PRIMAL_WEATHERS.has(w),
    ),
    terrain: resolveKind<Terrain>(
      'terrain',
      input,
      (a) => TERRAIN_ABILITIES[a],
      () => false,
    ),
  };
}

// ---------------------------------------------------------------------------
// Explanations
// ---------------------------------------------------------------------------

function valueName<T extends string>(kind: FieldKind, value: T): string {
  return kind === 'weather' ? WEATHER_NAMES[value as Weather] : TERRAIN_NAMES[value as Terrain];
}

/** "Sun from Charizard's Drought". */
export function sourceText<T extends string>(result: FieldAbilityResult<T>, nameOf: (id: string) => string): string | null {
  const w = result.winner;
  if (!w) return null;
  return `${valueName(result.kind, w.value)} from ${nameOf(w.id)}'s ${w.ability}`;
}

/**
 * Why the winner's weather or terrain is the one that stays up, or null when
 * there was nothing to decide (a single setter, or every setter agreeing).
 * e.g. "Pelipper (85 Speed) is slower than Charizard (167 Speed), so its
 * Drizzle activates last and replaces Sun."
 */
export function winnerReason<T extends string>(
  result: FieldAbilityResult<T>,
  nameOf: (id: string) => string,
): string | null {
  const w = result.winner;
  if (!w) return null;
  const rivals = result.setters.filter((s) => s.value !== w.value);
  if (rivals.length === 0) return null;

  const parts: string[] = [];
  const blocked = rivals.filter((s) => s.blocked);
  if (blocked.length > 0) {
    const names = blocked.map((s) => `${nameOf(s.id)}'s ${s.ability}`).join(' and ');
    parts.push(`${valueName(result.kind, w.value)} is a primal weather, so ${names} cannot replace it`);
  }

  const overwritten = rivals.filter((s) => !s.blocked && !result.tiedWith.includes(s));
  if (overwritten.length > 0) {
    const others = overwritten.map((s) => `${nameOf(s.id)} (${speedText(s.speed)})`).join(' and ');
    const replaced = [...new Set(overwritten.map((s) => valueName(result.kind, s.value)))].join(' and ');
    const winnerSpeed = `${nameOf(w.id)} (${speedText(w.speed)})`;
    parts.push(
      result.isTrickRoom
        ? `${winnerSpeed} is faster than ${others}; Trick Room makes switch-in abilities activate slowest first, so its ${w.ability} activates last and replaces ${replaced}`
        : `${winnerSpeed} is slower than ${others}, so its ${w.ability} activates last and replaces ${replaced}`,
    );
  }

  if (result.tiedWith.length > 0) {
    const others = result.tiedWith.map((s) => `${nameOf(s.id)}'s ${s.ability}`).join(' and ');
    parts.push(
      `Speed tie with ${others} at ${w.speed.speed} Speed: coin flip for which activates last; shown as ${valueName(result.kind, w.value)}`,
    );
  }
  return parts.join('. ') + '.';
}
