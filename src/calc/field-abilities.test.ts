import { getFinalSpeed } from '@smogon/calc/dist/mechanics/util';
import { describe, expect, it } from 'vitest';
// Test-only use of the oracle adapter; nothing in src/calc imports it.
import { smogonGeneration, toSmogonField, toSmogonPokemon } from '../oracle/smogon-adapter';
import type { FieldState, Game, Pokemon, SideState, StatTable } from '../types';
import {
  resolveSwitchInField,
  sourceText,
  TERRAIN_ABILITIES,
  WEATHER_ABILITIES,
  winnerReason,
  type SwitchInEntry,
} from './field-abilities';

// Reference: Pokemon Showdown.
// - data/abilities.ts (bundled in @pkmn/mods 0.10.11): Drought, Orichalcum
//   Pulse -> sunnyday; Drizzle -> raindance; Sand Stream -> sandstorm; Snow
//   Warning -> snowscape; Desolate Land / Primordial Sea / Delta Stream ->
//   their primal weather, each with onAnySetWeather refusing non-primal
//   weather while it is up; Electric Surge, Hadron Engine -> electricterrain;
//   Grassy, Misty, Psychic Surge -> their terrain. All in onStart.
//   Sand Spit and Seed Sower use onDamagingHit (not switch-in).
// - sim/battle.ts resolvePriority: handler.speed = pokemon.speed; speedSort
//   runs the fastest first and shuffles exact ties.
// - sim/pokemon.ts updateSpeed: pokemon.speed = getActionSpeed(), which
//   applies Trick Room.
// So the slowest setter activates last and its weather stays (Bulbapedia,
// "Weather": when several weather abilities activate at once, the slowest
// Pokemon's weather prevails), and Trick Room reverses that.
// Speeds are checked against @smogon/calc getFinalSpeed below.

const table = (hp: number, atk: number, def: number, spa: number, spd: number, spe: number): StatTable => ({
  hp,
  atk,
  def,
  spa,
  spd,
  spe,
});

const SIDE: SideState = {
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

const FIELD: FieldState = {
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
  attackerSide: SIDE,
  defenderSide: SIDE,
};

function mon(species: string, spe: number, ability: string, set: Partial<Pokemon> = {}): Pokemon {
  return {
    species,
    level: 50,
    types: ['Normal'],
    isTerastallized: false,
    baseStats: table(80, 80, 80, 80, 80, spe),
    ivs: table(31, 31, 31, 31, 31, 31),
    evs: table(0, 0, 0, 0, 0, 0),
    nature: 'Hardy',
    ability,
    abilitySuppressed: false,
    item: null,
    weightKg: 50,
    currentHp: null,
    statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    status: 'none',
    ...set,
  };
}

// Level 50, 31 IVs, 0 EVs unless noted:
//   Timid 252 Spe Charizard (base 100)  167
//   Pelipper (base 65)                   85
//   Tyranitar (base 61)                  81
//   Abomasnow (base 60)                  80
//   Torkoal (base 20)                    40
//   Groudon / Kyogre (base 90)          110
const charizard = (set: Partial<Pokemon> = {}) =>
  mon('Charizard', 100, 'Drought', { nature: 'Timid', evs: table(0, 0, 0, 0, 0, 252), ...set });
const pelipper = (set: Partial<Pokemon> = {}) => mon('Pelipper', 65, 'Drizzle', set);
const tyranitar = (set: Partial<Pokemon> = {}) => mon('Tyranitar', 61, 'Sand Stream', set);
const abomasnow = (set: Partial<Pokemon> = {}) => mon('Abomasnow', 60, 'Snow Warning', set);
const torkoal = (set: Partial<Pokemon> = {}) => mon('Torkoal', 20, 'Drought', set);
const groudon = () => mon('Groudon', 90, 'Desolate Land');
const kyogre = () => mon('Kyogre', 90, 'Primordial Sea');

const entry = (id: string, pokemon: Pokemon, patch: Partial<SwitchInEntry> = {}): SwitchInEntry => ({
  id,
  pokemon,
  tailwind: false,
  itemConsumed: false,
  ...patch,
});

function resolve(entries: SwitchInEntry[], opts: { game?: Game; isTrickRoom?: boolean } = {}) {
  return resolveSwitchInField({
    game: opts.game ?? 'gen9',
    field: FIELD,
    isTrickRoom: opts.isTrickRoom ?? false,
    entries,
  });
}

const nameOf = (id: string) => id;

describe('setter list', () => {
  it('covers every switch-in weather and terrain ability in the Showdown data', () => {
    expect(WEATHER_ABILITIES).toEqual({
      Drought: 'sun',
      'Orichalcum Pulse': 'sun',
      Drizzle: 'rain',
      'Sand Stream': 'sand',
      'Snow Warning': 'snow',
      'Desolate Land': 'harshSun',
      'Primordial Sea': 'heavyRain',
      'Delta Stream': 'strongWinds',
    });
    expect(TERRAIN_ABILITIES).toEqual({
      'Electric Surge': 'electric',
      'Hadron Engine': 'electric',
      'Grassy Surge': 'grassy',
      'Misty Surge': 'misty',
      'Psychic Surge': 'psychic',
    });
    // On-hit setters are not switch-in setters.
    expect(WEATHER_ABILITIES['Sand Spit']).toBeUndefined();
    expect(TERRAIN_ABILITIES['Seed Sower']).toBeUndefined();
  });
});

describe('a single setter', () => {
  it.each([
    ['Drought', 'sun'],
    ['Drizzle', 'rain'],
    ['Sand Stream', 'sand'],
    ['Snow Warning', 'snow'],
    ['Orichalcum Pulse', 'sun'],
  ] as const)('%s sets %s', (ability, weather) => {
    const r = resolve([entry('a', mon('A', 80, ability)), entry('b', mon('B', 80, 'Blaze'))]);
    expect(r.weather.winner?.value).toBe(weather);
    expect(r.weather.winner?.id).toBe('a');
    expect(r.terrain.winner).toBeNull();
    expect(winnerReason(r.weather, nameOf)).toBeNull();
  });

  it.each([
    ['Electric Surge', 'electric'],
    ['Hadron Engine', 'electric'],
    ['Grassy Surge', 'grassy'],
    ['Misty Surge', 'misty'],
    ['Psychic Surge', 'psychic'],
  ] as const)('%s sets %s terrain', (ability, terrain) => {
    const r = resolve([entry('a', mon('A', 80, ability))]);
    expect(r.terrain.winner?.value).toBe(terrain);
    expect(r.weather.winner).toBeNull();
  });

  it('names the source', () => {
    const r = resolve([entry('left2', charizard())]);
    expect(sourceText(r.weather, () => 'Charizard')).toBe("Sun from Charizard's Drought");
  });

  it('does nothing when the ability is suppressed', () => {
    const r = resolve([entry('a', pelipper({ abilitySuppressed: true }))]);
    expect(r.weather.winner).toBeNull();
    expect(r.weather.setters).toEqual([]);
  });
});

describe('weather war: the slower setter wins', () => {
  it('uses the same Speeds as @smogon/calc', () => {
    const gen = smogonGeneration('gen9');
    const field = toSmogonField(FIELD);
    for (const [p, expected] of [
      [charizard(), 167],
      [pelipper(), 85],
      [tyranitar(), 81],
      [abomasnow(), 80],
      [torkoal(), 40],
    ] as const) {
      const r = resolve([entry('x', p)]);
      expect(r.weather.winner?.speed.speed).toBe(expected);
      expect(getFinalSpeed(gen, toSmogonPokemon('gen9', p), field, field.attackerSide)).toBe(expected);
    }
  });

  it('Pelipper (85) beats Charizard (167): rain', () => {
    const r = resolve([entry('zard', charizard()), entry('pel', pelipper())]);
    expect(r.weather.setters.map((s) => s.id)).toEqual(['zard', 'pel']);
    expect(r.weather.winner?.value).toBe('rain');
    expect(r.weather.winner?.id).toBe('pel');
    expect(winnerReason(r.weather, nameOf)).toBe(
      'pel (85 Speed) is slower than zard (167 Speed), so its Drizzle activates last and replaces Sun.',
    );
  });

  it('Torkoal (40) beats Pelipper (85): sun, regardless of input order', () => {
    for (const entries of [
      [entry('pel', pelipper()), entry('tork', torkoal())],
      [entry('tork', torkoal()), entry('pel', pelipper())],
    ]) {
      expect(resolve(entries).weather.winner?.id).toBe('tork');
    }
  });

  it('with four setters the slowest wins (Torkoal over Abomasnow, Tyranitar, Pelipper)', () => {
    const r = resolve([
      entry('pel', pelipper()),
      entry('ttar', tyranitar()),
      entry('aboma', abomasnow()),
      entry('tork', torkoal()),
    ]);
    expect(r.weather.setters.map((s) => s.id)).toEqual(['pel', 'ttar', 'aboma', 'tork']);
    expect(r.weather.winner?.value).toBe('sun');
  });

  it('Speed modifiers count: paralysis makes Charizard slower than Pelipper', () => {
    // 167 halved to 83, under Pelipper's 85.
    const r = resolve([entry('zard', charizard({ status: 'par' })), entry('pel', pelipper())]);
    expect(r.weather.winner?.id).toBe('zard');
    expect(r.weather.winner?.speed.speed).toBe(83);
  });

  it('Tailwind counts: Pelipper under Tailwind (170) is faster than Charizard', () => {
    const r = resolve([entry('zard', charizard()), entry('pel', pelipper(), { tailwind: true })]);
    expect(r.weather.winner?.id).toBe('zard');
  });

  it('Trick Room reverses it: the faster setter wins', () => {
    const r = resolve([entry('zard', charizard()), entry('pel', pelipper())], { isTrickRoom: true });
    expect(r.weather.winner?.id).toBe('zard');
    expect(winnerReason(r.weather, nameOf)).toBe(
      'zard (167 Speed) is faster than pel (85 Speed); Trick Room makes switch-in abilities activate slowest first, so its Drought activates last and replaces Rain.',
    );
  });

  it('Champions uses the same rule', () => {
    const r = resolve([entry('zard', charizard()), entry('pel', pelipper())], { game: 'champions' });
    expect(r.weather.winner?.id).toBe('pel');
  });

  it('reports an exact Speed tie as a coin flip', () => {
    // Base 65 with 0 EVs: both 85.
    const r = resolve([entry('pel', pelipper()), entry('sun', mon('Sun65', 65, 'Drought'))]);
    expect(r.weather.tiedWith.map((s) => s.id)).toHaveLength(1);
    expect(winnerReason(r.weather, nameOf)).toContain('coin flip');
  });

  it('two setters of the same weather are not a conflict', () => {
    const r = resolve([entry('zard', charizard()), entry('tork', torkoal())]);
    expect(r.weather.winner?.value).toBe('sun');
    expect(winnerReason(r.weather, nameOf)).toBeNull();
  });
});

describe('primal weather', () => {
  it('a regular weather cannot replace it even when slower', () => {
    const r = resolve([entry('groudon', groudon()), entry('tork', mon('Tork', 20, 'Drizzle'))]);
    expect(r.weather.winner?.value).toBe('harshSun');
    expect(r.weather.setters.find((s) => s.id === 'tork')?.blocked).toBe(true);
    expect(winnerReason(r.weather, nameOf)).toContain('primal weather');
  });

  it('replaces a regular weather that activated before it', () => {
    // Pelipper under Tailwind (170) activates before Groudon (110); Desolate Land replaces the rain.
    const r = resolve([entry('pel', pelipper(), { tailwind: true }), entry('groudon', groudon())]);
    expect(r.weather.setters.map((s) => s.id)).toEqual(['pel', 'groudon']);
    expect(r.weather.winner?.value).toBe('harshSun');
    expect(r.weather.setters[0]?.blocked).toBe(false);
  });

  it('between two primals the slower one wins', () => {
    const slowKyogre = { ...kyogre(), baseStats: table(100, 100, 90, 150, 140, 60) }; // 80 Speed
    const r = resolve([entry('groudon', groudon()), entry('kyogre', slowKyogre)]);
    expect(r.weather.winner?.value).toBe('heavyRain');
  });

  it('does nothing in Champions', () => {
    const r = resolve([entry('groudon', groudon()), entry('pel', pelipper())], { game: 'champions' });
    expect(r.weather.winner?.value).toBe('rain');
    expect(r.weather.setters.map((s) => s.id)).toEqual(['pel']);
  });
});

describe('terrain war', () => {
  it('the slower Surge wins', () => {
    const r = resolve([
      entry('rillaboom', mon('Rillaboom', 85, 'Grassy Surge')), // 105
      entry('indeedee', mon('Indeedee', 95, 'Psychic Surge')), // 115
    ]);
    expect(r.terrain.winner?.value).toBe('grassy');
    expect(winnerReason(r.terrain, nameOf)).toBe(
      'rillaboom (105 Speed) is slower than indeedee (115 Speed), so its Grassy Surge activates last and replaces Psychic Terrain.',
    );
  });

  it('weather and terrain resolve independently', () => {
    const r = resolve([entry('pel', pelipper()), entry('tapu', mon('Tapu Koko', 130, 'Electric Surge'))]);
    expect(r.weather.winner?.value).toBe('rain');
    expect(r.terrain.winner?.value).toBe('electric');
  });
});
