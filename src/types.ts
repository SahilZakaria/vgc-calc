export type StatName = 'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe';
export type StatTable = Record<StatName, number>;

export type TypeName =
  | 'Normal' | 'Fire' | 'Water' | 'Electric' | 'Grass' | 'Ice'
  | 'Fighting' | 'Poison' | 'Ground' | 'Flying' | 'Psychic' | 'Bug'
  | 'Rock' | 'Ghost' | 'Dragon' | 'Dark' | 'Steel' | 'Fairy';

export type MoveCategory = 'Physical' | 'Special' | 'Status';
export type MoveTarget = 'single' | 'allAdjacentFoes' | 'allAdjacent' | 'self';

export type MoveFlags = {
  contact: boolean;
  punch: boolean;
  sound: boolean;
  slicing: boolean;
  bite: boolean;
  bullet: boolean;
  wind: boolean;
  pulse: boolean;
};

export type VariablePower =
  | 'none'
  | 'userWeight'
  | 'targetWeight'
  | 'speedRatio'
  | 'userHpRatio'
  | 'targetHpRatio'
  | 'noItem';

export interface Move {
  name: string;
  type: TypeName;
  basePower: number;
  variablePower: VariablePower;
  category: MoveCategory;
  target: MoveTarget;
  priority: number;
  hits: number;
  flags: MoveFlags;
}

export interface Pokemon {
  species: string;
  level: number;
  types: TypeName[];
  teraType?: TypeName;
  isTerastallized: boolean;
  baseStats: StatTable;
  ivs: StatTable;
  evs: StatTable;
  nature: string;
  ability: string;
  abilitySuppressed: boolean;
  item: string | null;
  weightKg: number;
  currentHp: number | null;
  statBoosts: Omit<StatTable, 'hp'>;
  status: 'none' | 'brn' | 'par' | 'psn' | 'tox' | 'slp' | 'frz';
}

export type Weather = 'none' | 'sun' | 'rain' | 'sand' | 'snow' | 'harshSun' | 'heavyRain' | 'strongWinds';
export type Terrain = 'none' | 'electric' | 'grassy' | 'misty' | 'psychic';
export type Game = 'champions' | 'gen9';

export interface SideState {
  reflect: boolean;
  lightScreen: boolean;
  auroraVeil: boolean;
  tailwind: boolean;
  helpingHand: boolean;
  friendGuard: boolean;
  battery: boolean;
  powerSpot: boolean;
  steelySpirit: boolean;
  stealthRock: boolean;
  spikes: number;
}

export interface FieldState {
  weather: Weather;
  terrain: Terrain;
  isDoubles: boolean;
  isGravity: boolean;
  isWonderRoom: boolean;
  isMagicRoom: boolean;
  isBeadsOfRuin: boolean;
  isSwordOfRuin: boolean;
  isTabletsOfRuin: boolean;
  isVesselOfRuin: boolean;
  attackerSide: SideState;
  defenderSide: SideState;
}

export interface DamageContext {
  game: Game;
  attacker: Pokemon;
  defender: Pokemon;
  move: Move;
  field: FieldState;
  isCritical: boolean;
}

export interface DamageResult {
  rolls: number[];
  defenderMaxHp: number;
  minPercent: number;
  maxPercent: number;
}

export interface Modifier {
  name: string;
  order: number;
  applies(ctx: DamageContext): boolean;
  apply(damage: number, ctx: DamageContext): number;
}