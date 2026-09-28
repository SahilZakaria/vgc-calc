import { calculateStats } from '../calc/stats';
import type { StatName, StatTable } from '../types';

// Champions has no level or IV inputs: every Pokemon is level 50 with 31 IVs.
export const CHAMPIONS_LEVEL = 50;
export const CHAMPIONS_IV = 31;
export const MAX_SP_PER_STAT = 32;
export const MAX_SP_TOTAL = 66;

const STAT_NAMES: readonly StatName[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

const FIXED_IVS: StatTable = {
  hp: CHAMPIONS_IV,
  atk: CHAMPIONS_IV,
  def: CHAMPIONS_IV,
  spa: CHAMPIONS_IV,
  spd: CHAMPIONS_IV,
  spe: CHAMPIONS_IV,
};

// Converts Stat Points to the EV count that yields the same level 50 stat.
// 0 SP = 0 EVs; otherwise 8n - 4, so 32 SP = 252 EVs.
export function spToEv(sp: number): number {
  if (!Number.isInteger(sp) || sp < 0 || sp > MAX_SP_PER_STAT) {
    throw new Error(`Invalid stat points: ${sp} (must be an integer from 0 to ${MAX_SP_PER_STAT})`);
  }
  return sp === 0 ? 0 : 8 * sp - 4;
}

export interface SpreadValidation {
  valid: boolean;
  errors: string[];
}

export function validateChampionsSpread(statPoints: StatTable): SpreadValidation {
  const errors: string[] = [];
  let total = 0;
  for (const stat of STAT_NAMES) {
    const sp = statPoints[stat];
    if (!Number.isInteger(sp) || sp < 0) {
      errors.push(`${stat}: ${sp} is not a non-negative integer`);
    } else if (sp > MAX_SP_PER_STAT) {
      errors.push(`${stat}: ${sp} exceeds the per-stat maximum of ${MAX_SP_PER_STAT}`);
    }
    total += sp;
  }
  if (total > MAX_SP_TOTAL) {
    errors.push(`total: ${total} exceeds the maximum of ${MAX_SP_TOTAL}`);
  }
  return { valid: errors.length === 0, errors };
}

export function calculateChampionsStats(
  baseStats: StatTable,
  statPoints: StatTable,
  nature: string,
): StatTable {
  const validation = validateChampionsSpread(statPoints);
  if (!validation.valid) {
    throw new Error(`Invalid Champions spread: ${validation.errors.join('; ')}`);
  }
  const evs: StatTable = {
    hp: spToEv(statPoints.hp),
    atk: spToEv(statPoints.atk),
    def: spToEv(statPoints.def),
    spa: spToEv(statPoints.spa),
    spd: spToEv(statPoints.spd),
    spe: spToEv(statPoints.spe),
  };
  return calculateStats(baseStats, FIXED_IVS, evs, nature, CHAMPIONS_LEVEL);
}
