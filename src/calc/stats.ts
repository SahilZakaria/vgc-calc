import type { StatName, StatTable } from '../types';

type NatureStat = Exclude<StatName, 'hp'>;

interface NatureEffect {
  plus: NatureStat | null;
  minus: NatureStat | null;
}

// All 25 natures. Neutral natures raise and lower the same stat, so they are
// recorded with no effect.
export const NATURES: Readonly<Record<string, NatureEffect>> = {
  Hardy: { plus: null, minus: null },
  Lonely: { plus: 'atk', minus: 'def' },
  Brave: { plus: 'atk', minus: 'spe' },
  Adamant: { plus: 'atk', minus: 'spa' },
  Naughty: { plus: 'atk', minus: 'spd' },
  Bold: { plus: 'def', minus: 'atk' },
  Docile: { plus: null, minus: null },
  Relaxed: { plus: 'def', minus: 'spe' },
  Impish: { plus: 'def', minus: 'spa' },
  Lax: { plus: 'def', minus: 'spd' },
  Timid: { plus: 'spe', minus: 'atk' },
  Hasty: { plus: 'spe', minus: 'def' },
  Serious: { plus: null, minus: null },
  Jolly: { plus: 'spe', minus: 'spa' },
  Naive: { plus: 'spe', minus: 'spd' },
  Modest: { plus: 'spa', minus: 'atk' },
  Mild: { plus: 'spa', minus: 'def' },
  Quiet: { plus: 'spa', minus: 'spe' },
  Bashful: { plus: null, minus: null },
  Rash: { plus: 'spa', minus: 'spd' },
  Calm: { plus: 'spd', minus: 'atk' },
  Gentle: { plus: 'spd', minus: 'def' },
  Sassy: { plus: 'spd', minus: 'spe' },
  Careful: { plus: 'spd', minus: 'spa' },
  Quirky: { plus: null, minus: null },
};

const NON_HP_STATS: readonly NatureStat[] = ['atk', 'def', 'spa', 'spd', 'spe'];

function lookupNature(nature: string): NatureEffect {
  const key = nature.charAt(0).toUpperCase() + nature.slice(1).toLowerCase();
  const effect = NATURES[key];
  if (!effect) {
    throw new Error(`Unknown nature: ${nature}`);
  }
  return effect;
}

export function calculateStats(
  baseStats: StatTable,
  ivs: StatTable,
  evs: StatTable,
  nature: string,
  level: number,
): StatTable {
  const effect = lookupNature(nature);

  const core = (stat: StatName): number =>
    Math.floor(((2 * baseStats[stat] + ivs[stat] + Math.floor(evs[stat] / 4)) * level) / 100);

  // Shedinja (the only species with base HP 1) always has exactly 1 HP.
  const hp = baseStats.hp === 1 ? 1 : core('hp') + level + 10;

  const result: StatTable = { hp, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  for (const stat of NON_HP_STATS) {
    // Nature multiplier in tenths keeps the math in integers (no 0.9/1.1 float drift).
    const tenths = stat === effect.plus ? 11 : stat === effect.minus ? 9 : 10;
    result[stat] = Math.floor(((core(stat) + 5) * tenths) / 10);
  }
  return result;
}
