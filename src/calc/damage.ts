/**
 * Lowest random roll, in percent. The damage formula uses 85..100. Kept as a
 * named constant because Champions briefly shipped without the 85% floor.
 */
export const RANDOM_ROLL_FLOOR = 85;
/** Highest random roll, in percent. The 100% roll is the base damage itself. */
export const RANDOM_ROLL_CEILING = 100;

/**
 * Gen 9 base damage (the 100% roll), before any modifiers (spread, weather,
 * crit, STAB, type effectiveness, burn, items, etc.).
 *
 *   base = floor(floor(floor(floor(2 * level / 5 + 2) * basePower * attack) / defense) / 50) + 2
 */
export function baseDamage(
  level: number,
  attack: number,
  defense: number,
  basePower: number,
): number {
  const levelFactor = Math.floor((2 * level) / 5 + 2);
  return Math.floor(Math.floor((levelFactor * basePower * attack) / defense) / 50) + 2;
}

/**
 * baseDamage expanded into the 16 random rolls.
 *
 *   roll_i = floor(base * (RANDOM_ROLL_FLOOR + i) / 100), i = 0..15
 *
 * The random factor is technically applied after spread/weather/crit in the
 * modifier chain; here it is applied directly to the base damage.
 */
export function calculateBaseDamage(
  level: number,
  attack: number,
  defense: number,
  basePower: number,
): number[] {
  const base = baseDamage(level, attack, defense, basePower);

  const rolls: number[] = [];
  for (let r = RANDOM_ROLL_FLOOR; r <= RANDOM_ROLL_CEILING; r++) {
    rolls.push(Math.floor((base * r) / 100));
  }
  return rolls;
}
