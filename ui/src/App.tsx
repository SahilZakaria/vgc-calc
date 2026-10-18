import { calculate } from '@vgc/calc/calculate';
import type { DamageContext, Pokemon, SideState, StatTable } from '@vgc/types';

// Placeholder that proves the UI reaches the real calculator in ../src.
// One hardcoded Champions doubles calc: Adamant 32 Atk SP Garchomp's
// Earthquake into 32 HP SP Incineroar.

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp,
  atk,
  def,
  spa,
  spd,
  spe,
});

// Champions has no IVs (treated as 31) and 32 SP = 252 EVs.
const IVS = table(31, 31, 31, 31, 31, 31);
const NO_BOOSTS: Pokemon['statBoosts'] = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };

const emptySide: SideState = {
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  tailwind: false,
  helpingHand: false,
  friendGuard: false,
  battery: false,
  powerSpot: false,
  steelySpirit: false,
  stealthRock: false,
  spikes: 0,
};

const DEMO: DamageContext = {
  game: 'champions',
  attacker: {
    species: 'Garchomp',
    level: 50,
    types: ['Dragon', 'Ground'],
    isTerastallized: false,
    baseStats: table(108, 130, 95, 80, 85, 102),
    ivs: IVS,
    evs: table(0, 252, 0, 0, 0, 0),
    nature: 'Adamant',
    ability: 'Rough Skin',
    abilitySuppressed: false,
    item: null,
    weightKg: 95,
    currentHp: null,
    statBoosts: NO_BOOSTS,
    status: 'none',
  },
  defender: {
    species: 'Incineroar',
    level: 50,
    types: ['Fire', 'Dark'],
    isTerastallized: false,
    baseStats: table(95, 115, 90, 80, 90, 60),
    ivs: IVS,
    evs: table(252, 0, 0, 0, 0, 0),
    nature: 'Hardy',
    ability: 'Intimidate',
    abilitySuppressed: false,
    item: null,
    weightKg: 83,
    currentHp: null,
    statBoosts: NO_BOOSTS,
    status: 'none',
  },
  move: {
    name: 'Earthquake',
    type: 'Ground',
    basePower: 100,
    variablePower: 'none',
    category: 'Physical',
    target: 'allAdjacent',
    priority: 0,
    hits: 1,
    flags: {
      contact: false,
      punch: false,
      sound: false,
      slicing: false,
      bite: false,
      bullet: false,
      wind: false,
      pulse: false,
    },
  },
  field: {
    weather: 'none',
    terrain: 'none',
    isDoubles: true,
    isGravity: false,
    isWonderRoom: false,
    isMagicRoom: false,
    isBeadsOfRuin: false,
    isSwordOfRuin: false,
    isTabletsOfRuin: false,
    isVesselOfRuin: false,
    attackerSide: emptySide,
    defenderSide: emptySide,
  },
  isCritical: false,
};

export function App() {
  const result = calculate(DEMO);
  return (
    <main>
      <h1>VGC Calc</h1>
      <p>Garchomp Earthquake vs Incineroar (Champions, doubles)</p>
      <pre>{JSON.stringify(result.rolls)}</pre>
      <p>
        {result.minPercent.toFixed(1)}% – {result.maxPercent.toFixed(1)}% of {result.defenderMaxHp} HP
      </p>
    </main>
  );
}
