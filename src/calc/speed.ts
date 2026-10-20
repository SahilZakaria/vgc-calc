import type { FieldState, Game, Pokemon, StatName, Weather } from '../types';
import { chainMultipliers } from './calculate';
import { pokeRound } from './modifier-pipeline';
import { withItemChecked } from './modifiers/abilities-items';
import { calculateStats } from './stats';

/**
 * Effective Speed: the number turn order compares.
 *
 * SOURCE
 * ------
 * @smogon/calc 0.12.0 dist/mechanics/util.js getFinalSpeed, checked against
 * Showdown's handlers in the simulator bundled with @pkmn/mods (data/
 * abilities, items, moves and conditions, every onModifySpe):
 *   1. Speed stat from the set, then the stat stage (util.js
 *      getModifiedStat, the same stage table as the damage calc).
 *   2. One 4096-based chain, clamped to [410, 131172], applied with
 *      pokeRound:
 *        Tailwind (that side)                      2x    8192
 *        Unburden, item consumed                   2x    8192
 *        Chlorophyll in Sun / Harsh Sun            2x    8192
 *        Swift Swim in Rain / Heavy Rain           2x    8192
 *        Sand Rush in Sand, Slush Rush in Snow     2x    8192
 *        Surge Surfer in Electric Terrain          2x    8192
 *        Quick Feet with any status                1.5x  6144
 *        Protosynthesis / Quark Drive on Speed     1.5x  6144
 *        Choice Scarf                              1.5x  6144
 *        Iron Ball, Macho Brace, Power items       0.5x  2048
 *        Quick Powder on Ditto                     2x    8192
 *      Every value is a multiple of 2048, so the chain is exact and the
 *      order does not matter.
 *   3. Paralysis: floor(speed * 50 / 100), skipped by Quick Feet
 *      (conditions par, onModifySpePriority -101, after the chain).
 *   4. Capped at 10000 (Showdown sim/pokemon.ts getStat).
 *
 * Champions: the @pkmn/mods Champions mod changes paralysis only in its
 * full-paralysis chance (1 in 8); the Speed drop is inherited. It changes no
 * Speed-modifying item or ability. The Champions formula is therefore the
 * same, with the primal weathers treated as no weather, as calculate.ts does.
 *
 * Items: Magic Room and Klutz remove the item first (withItemChecked, which
 * keeps the Power items under Klutz, as Showdown's ignoreKlutz does). With
 * Unburden active the item is gone, so no item applies; @smogon/calc skips
 * the item checks the same way.
 *
 * Weather: Air Lock / Cloud Nine anywhere on the field clears it
 * (`weatherSuppressed`). Utility Umbrella stops Sun and Rain from reaching its
 * holder, so it blocks Chlorophyll and Swift Swim (Showdown reads
 * pokemon.effectiveWeather() for those two and field.isWeather() for Sand
 * Rush and Slush Rush). @smogon/calc does not model the Umbrella here.
 *
 * Protosynthesis / Quark Drive follow @smogon/calc: active in Sun (including
 * Harsh Sun) / Electric Terrain or while holding Booster Energy, boosting
 * Speed only when Speed is the highest stat after stages (ties go to the
 * earlier stat in Atk, Def, SpA, SpD, Spe order).
 *
 * NOT MODELED: Slow Start (needs the turn count), Grass Pledge's swamp, and
 * Quick Claw / Quick Draw / Custap Berry, which change order within a
 * priority bracket by chance or HP and are not Speed modifiers.
 */

export const SPEED_CAP = 10000;
export const DOUBLE_SPEED = 8192;
export const BOOSTED_SPEED = 6144;
export const HALVED_SPEED = 2048;
/** Paralysis keeps this percentage of Speed (Gen 7 on, and Champions). */
export const PARALYSIS_SPEED_PERCENT = 50;

const CHAIN_MIN = 410;
const CHAIN_MAX = 131172;

/** Items that halve the holder's Speed (Iron Ball and util.js EV_ITEMS). */
export const SPEED_HALVING_ITEMS: ReadonlySet<string> = new Set([
  'Iron Ball',
  'Macho Brace',
  'Power Anklet',
  'Power Band',
  'Power Belt',
  'Power Bracer',
  'Power Lens',
  'Power Weight',
]);

/** Battle state around one Pokemon that its Speed depends on. */
export interface SpeedConditions {
  game: Game;
  field: FieldState;
  /** Tailwind is up on this Pokemon's side. */
  tailwind: boolean;
  /**
   * The Pokemon's held item has been used or lost this battle, so Unburden
   * (if it has it) is active and the item no longer counts.
   */
  itemConsumed: boolean;
  /** Air Lock or Cloud Nine is active somewhere on the field. */
  weatherSuppressed: boolean;
}

export interface SpeedModifier {
  /** What applied it, e.g. "Tailwind" or "Choice Scarf". */
  source: string;
  /** 4096-based multiplier, e.g. 8192 for 2x. */
  multiplier: number;
}

export interface SpeedBreakdown {
  /** Speed stat from the set. */
  stat: number;
  /** Stat stage used, clamped to -6..+6. */
  stage: number;
  /** After the stage. */
  staged: number;
  modifiers: SpeedModifier[];
  /** After the modifier chain. */
  modified: number;
  /** Paralysis halved it. */
  paralyzed: boolean;
  /** The 10000 cap cut it. */
  capped: boolean;
  /** Effective Speed. */
  speed: number;
}

const PRIMAL: ReadonlySet<Weather> = new Set<Weather>(['harshSun', 'heavyRain', 'strongWinds']);

function hasAbility(pokemon: Pokemon, ability: string): boolean {
  return !pokemon.abilitySuppressed && pokemon.ability === ability;
}

/** util.js getModifiedStat (Gen 3+), same as the damage calc. */
export function applySpeedStage(stat: number, stage: number): number {
  const s = Math.max(-6, Math.min(6, stage));
  return Math.floor((stat * Math.max(2, 2 + s)) / Math.max(2, 2 - s));
}

/** The field weather as it reaches this Pokemon's Speed abilities. */
function fieldWeather(cond: SpeedConditions): Weather {
  if (cond.weatherSuppressed) return 'none';
  const { weather } = cond.field;
  return cond.game === 'champions' && PRIMAL.has(weather) ? 'none' : weather;
}

/**
 * The Pokemon's item as far as Speed is concerned: gone when consumed, and
 * removed by Magic Room or Klutz.
 */
export function speedItem(pokemon: Pokemon, cond: Pick<SpeedConditions, 'field' | 'itemConsumed'>): string | null {
  if (cond.itemConsumed) return null;
  return withItemChecked(pokemon, cond.field.isMagicRoom).item;
}

const QP_ORDER: readonly Exclude<StatName, 'hp'>[] = ['atk', 'def', 'spa', 'spd', 'spe'];

/** util.js getQPBoostedStat: the highest stat after stages, earlier stat wins ties. */
function boostedParadoxStat(pokemon: Pokemon): Exclude<StatName, 'hp'> {
  const stats = calculateStats(pokemon.baseStats, pokemon.ivs, pokemon.evs, pokemon.nature, pokemon.level);
  let best: Exclude<StatName, 'hp'> = 'atk';
  for (const stat of QP_ORDER) {
    if (applySpeedStage(stats[stat], pokemon.statBoosts[stat]) > applySpeedStage(stats[best], pokemon.statBoosts[best])) {
      best = stat;
    }
  }
  return best;
}

/** The one Speed ability multiplier that applies, if any (util.js checks them as an if/else chain). */
function abilityModifier(pokemon: Pokemon, item: string | null, cond: SpeedConditions): SpeedModifier | null {
  if (pokemon.abilitySuppressed) return null;
  const weather = fieldWeather(cond);
  // Utility Umbrella keeps Sun and Rain off its holder.
  const umbrella = item === 'Utility Umbrella';
  const sun = !umbrella && (weather === 'sun' || weather === 'harshSun');
  const rain = !umbrella && (weather === 'rain' || weather === 'heavyRain');
  const double = (source: string): SpeedModifier => ({ source, multiplier: DOUBLE_SPEED });
  switch (pokemon.ability) {
    case 'Unburden':
      return cond.itemConsumed ? double('Unburden') : null;
    case 'Chlorophyll':
      return sun ? double('Chlorophyll') : null;
    case 'Swift Swim':
      return rain ? double('Swift Swim') : null;
    case 'Sand Rush':
      return weather === 'sand' ? double('Sand Rush') : null;
    case 'Slush Rush':
      return weather === 'snow' ? double('Slush Rush') : null;
    case 'Surge Surfer':
      return cond.field.terrain === 'electric' ? double('Surge Surfer') : null;
    case 'Quick Feet':
      return pokemon.status !== 'none' ? { source: 'Quick Feet', multiplier: BOOSTED_SPEED } : null;
    case 'Protosynthesis':
    case 'Quark Drive': {
      const booster = item === 'Booster Energy';
      const active =
        booster ||
        (pokemon.ability === 'Protosynthesis'
          ? weather === 'sun' || weather === 'harshSun'
          : cond.field.terrain === 'electric');
      return active && boostedParadoxStat(pokemon) === 'spe'
        ? { source: pokemon.ability, multiplier: BOOSTED_SPEED }
        : null;
    }
    default:
      return null;
  }
}

function itemModifier(pokemon: Pokemon, item: string | null): SpeedModifier | null {
  if (item === null) return null;
  if (item === 'Choice Scarf') return { source: item, multiplier: BOOSTED_SPEED };
  if (SPEED_HALVING_ITEMS.has(item)) return { source: item, multiplier: HALVED_SPEED };
  if (item === 'Quick Powder' && pokemon.species === 'Ditto') return { source: item, multiplier: DOUBLE_SPEED };
  return null;
}

export function finalSpeed(pokemon: Pokemon, cond: SpeedConditions): SpeedBreakdown {
  const stat = calculateStats(pokemon.baseStats, pokemon.ivs, pokemon.evs, pokemon.nature, pokemon.level).spe;
  const stage = Math.max(-6, Math.min(6, pokemon.statBoosts.spe));
  const staged = applySpeedStage(stat, stage);

  const item = speedItem(pokemon, cond);
  const modifiers: SpeedModifier[] = [];
  if (cond.tailwind) modifiers.push({ source: 'Tailwind', multiplier: DOUBLE_SPEED });
  const ability = abilityModifier(pokemon, item, cond);
  if (ability) modifiers.push(ability);
  const held = itemModifier(pokemon, item);
  if (held) modifiers.push(held);

  const chain = chainMultipliers(
    modifiers.map((m) => m.multiplier),
    CHAIN_MIN,
    CHAIN_MAX,
  );
  const modified = pokeRound((staged * chain) / 4096);

  const paralyzed = pokemon.status === 'par' && !hasAbility(pokemon, 'Quick Feet');
  const afterPar = paralyzed ? Math.floor((modified * PARALYSIS_SPEED_PERCENT) / 100) : modified;
  const capped = afterPar > SPEED_CAP;
  const speed = Math.max(0, Math.min(SPEED_CAP, afterPar));

  return { stat, stage, staged, modifiers, modified, paralyzed, capped, speed };
}
