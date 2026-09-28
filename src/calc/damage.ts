/**
 * Gen 9 base damage, before any modifiers (spread, weather, crit, STAB,
 * type effectiveness, burn, items, etc.), expanded into the 16 random rolls.
 *
 *   base = floor(floor(floor(floor(2 * level / 5 + 2) * basePower * attack) / defense) / 50) + 2
 *   roll_i = floor(base * (85 + i) / 100), i = 0..15
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
  const levelFactor = Math.floor((2 * level) / 5 + 2);
  const base =
    Math.floor(Math.floor((levelFactor * basePower * attack) / defense) / 50) + 2;

  const rolls: number[] = [];
  for (let r = 85; r <= 100; r++) {
    rolls.push(Math.floor((base * r) / 100));
  }
  return rolls;
}
