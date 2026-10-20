import { getFinalSpeed } from '@smogon/calc/dist/mechanics/util';
import { describe, expect, it } from 'vitest';
import { toSmogonField, toSmogonPokemon, smogonGeneration } from '../oracle/smogon-adapter';
import type { FieldState, Game, Pokemon, SideState, StatTable } from '../types';
import { finalSpeed, type SpeedConditions } from './speed';

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

// Jolly 252 Spe Garchomp, level 50, 31 IVs: the VGC benchmark 169 Speed.
const garchomp = (set: Partial<Pokemon> = {}): Pokemon => ({
  species: 'Garchomp',
  level: 50,
  types: ['Dragon', 'Ground'],
  isTerastallized: false,
  baseStats: table(108, 130, 95, 80, 85, 102),
  ivs: table(31, 31, 31, 31, 31, 31),
  evs: table(4, 252, 0, 0, 0, 252),
  nature: 'Jolly',
  ability: 'Rough Skin',
  abilitySuppressed: false,
  item: null,
  weightKg: 95,
  currentHp: null,
  statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  status: 'none',
  ...set,
});

const cond = (patch: Partial<SpeedConditions> = {}): SpeedConditions => ({
  game: 'gen9',
  field: FIELD,
  tailwind: false,
  itemConsumed: false,
  weatherSuppressed: false,
  ...patch,
});

const speedOf = (pokemon: Pokemon, patch: Partial<SpeedConditions> = {}) => finalSpeed(pokemon, cond(patch)).speed;

describe('finalSpeed: published VGC benchmarks', () => {
  // Level 50 Speed tiers that VGC damage-calc users quote: Jolly 252 Garchomp
  // is 169, 253 with Choice Scarf (the "Scarf Chomp" 253 benchmark).
  it('gives Jolly 252 Garchomp 169 Speed, 253 with Choice Scarf', () => {
    expect(speedOf(garchomp())).toBe(169);
    expect(speedOf(garchomp({ item: 'Choice Scarf' }))).toBe(253);
  });

  it('applies the Champions SP spread the same way (Timid 32 SP Charizard is 167)', () => {
    const charizard = garchomp({
      species: 'Charizard',
      baseStats: table(78, 84, 78, 109, 85, 100),
      evs: table(0, 0, 0, 252, 0, 252),
      nature: 'Timid',
    });
    expect(speedOf(charizard, { game: 'champions' })).toBe(167);
  });
});

/**
 * Differential check against @smogon/calc 0.12.0 getFinalSpeed: every
 * modifier it models, alone and stacked, in both games.
 */
describe('finalSpeed matches @smogon/calc getFinalSpeed', () => {
  interface Case {
    name: string;
    pokemon: Partial<Pokemon>;
    field?: Partial<FieldState>;
    tailwind?: boolean;
    unburden?: boolean;
  }
  const cases: Case[] = [
    { name: 'plain', pokemon: {} },
    { name: '+1', pokemon: { statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 1 } } },
    { name: '+6', pokemon: { statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 6 } } },
    { name: '-1', pokemon: { statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: -1 } } },
    { name: '-6', pokemon: { statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: -6 } } },
    { name: 'paralysis', pokemon: { status: 'par' } },
    { name: 'paralysis -1', pokemon: { status: 'par', statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: -1 } } },
    { name: 'tailwind', pokemon: {}, tailwind: true },
    { name: 'tailwind + paralysis', pokemon: { status: 'par' }, tailwind: true },
    { name: 'choice scarf', pokemon: { item: 'Choice Scarf' } },
    { name: 'scarf + tailwind + 2', pokemon: { item: 'Choice Scarf', statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 2 } }, tailwind: true },
    { name: 'iron ball', pokemon: { item: 'Iron Ball' } },
    { name: 'iron ball + paralysis', pokemon: { item: 'Iron Ball', status: 'par' } },
    { name: 'power anklet', pokemon: { item: 'Power Anklet' } },
    { name: 'macho brace', pokemon: { item: 'Macho Brace' } },
    { name: 'unburden off', pokemon: { ability: 'Unburden', item: 'Choice Scarf' } },
    { name: 'unburden on, scarf ignored', pokemon: { ability: 'Unburden', item: 'Choice Scarf' }, unburden: true },
    { name: 'unburden on + tailwind', pokemon: { ability: 'Unburden' }, unburden: true, tailwind: true },
    { name: 'chlorophyll sun', pokemon: { ability: 'Chlorophyll' }, field: { weather: 'sun' } },
    { name: 'chlorophyll no sun', pokemon: { ability: 'Chlorophyll' }, field: { weather: 'rain' } },
    { name: 'swift swim rain', pokemon: { ability: 'Swift Swim' }, field: { weather: 'rain' } },
    { name: 'sand rush', pokemon: { ability: 'Sand Rush' }, field: { weather: 'sand' } },
    { name: 'slush rush', pokemon: { ability: 'Slush Rush' }, field: { weather: 'snow' } },
    { name: 'surge surfer', pokemon: { ability: 'Surge Surfer' }, field: { terrain: 'electric' } },
    { name: 'quick feet burned', pokemon: { ability: 'Quick Feet', status: 'brn' } },
    { name: 'quick feet paralyzed', pokemon: { ability: 'Quick Feet', status: 'par' } },
    { name: 'swift swim rain + scarf + tailwind', pokemon: { ability: 'Swift Swim', item: 'Choice Scarf' }, field: { weather: 'rain' }, tailwind: true },
    { name: 'suppressed swift swim', pokemon: { ability: 'Swift Swim', abilitySuppressed: true }, field: { weather: 'rain' } },
    { name: 'quick powder ditto', pokemon: { species: 'Ditto', baseStats: table(48, 48, 48, 48, 48, 48), item: 'Quick Powder' } },
    { name: 'quick powder non-ditto', pokemon: { item: 'Quick Powder' } },
    { name: 'protosynthesis booster, spe best', pokemon: { ability: 'Protosynthesis', item: 'Booster Energy', evs: table(0, 0, 0, 0, 0, 252), statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 1 } } },
    { name: 'protosynthesis booster, atk best', pokemon: { ability: 'Protosynthesis', item: 'Booster Energy' } },
    { name: 'quark drive terrain, spe best', pokemon: { ability: 'Quark Drive', evs: table(0, 0, 0, 0, 0, 252), statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 2 } }, field: { terrain: 'electric' } },
  ];

  const games: Game[] = ['gen9', 'champions'];
  const SMOGON_GEN0_CAP = 999;
  for (const game of games) {
    for (const c of cases) {
      it(`${game}: ${c.name}`, () => {
        const pokemon = garchomp(c.pokemon);
        const field: FieldState = { ...FIELD, ...c.field };
        const sm = toSmogonPokemon(game, game === 'champions' ? { ...pokemon, evs: toSpExact(pokemon.evs) } : pokemon);
        if (c.unburden) sm.abilityOn = true;
        // Their QP check needs boostedStat set; 'auto' picks the best stat.
        if (pokemon.ability === 'Protosynthesis' || pokemon.ability === 'Quark Drive') sm.boostedStat = 'auto';
        const smField = toSmogonField(field);
        const side = smField.attackerSide;
        side.isTailwind = c.tailwind ?? false;
        const expected = getFinalSpeed(smogonGeneration(game), sm, smField, side);

        const ours = finalSpeed(game === 'champions' ? { ...pokemon, evs: toSpExact(pokemon.evs) } : pokemon, {
          game,
          field,
          tailwind: c.tailwind ?? false,
          itemConsumed: c.unburden ?? false,
          weatherSuppressed: false,
        });
        if (game === 'champions' && expected === SMOGON_GEN0_CAP) {
          // @smogon/calc numbers Champions as gen 0 and its cap check is
          // `gen.num <= 2 ? 999 : 10000`, so it caps Champions at 999. The
          // Champions simulator mod does not override getStat, so Showdown's
          // 10000 cap applies. Both capped cases are 1014 by hand: 169 doubled
          // (+2 stage or Swift Swim), x2 Tailwind, x1.5 Scarf.
          expect(ours.speed).toBe(1014);
        } else {
          expect(ours.speed).toBe(expected);
        }
      });
    }
  }
});

// Champions sets are always SP-exact (8n - 4 EVs); 252 is already exact.
function toSpExact(evs: StatTable): StatTable {
  const fix = (ev: number) => (ev === 0 ? 0 : Math.max(4, ev - ((ev - 4) % 8)));
  return table(fix(evs.hp), fix(evs.atk), fix(evs.def), fix(evs.spa), fix(evs.spd), fix(evs.spe));
}

/**
 * Cases @smogon/calc's getFinalSpeed does not cover on its own. Expected
 * values follow Showdown's handlers (simulator bundled with @pkmn/mods):
 * Utility Umbrella blanks Sun and Rain for its holder (Pokemon#effectiveWeather,
 * read by Chlorophyll and Swift Swim); Magic Room and Klutz suppress items,
 * except that the Power items ignore Klutz (ignoreKlutz: true); Air Lock /
 * Cloud Nine clear weather; Speed caps at 10000 (sim/pokemon.ts getStat).
 */
describe('finalSpeed: Showdown rules outside getFinalSpeed', () => {
  it('Utility Umbrella blocks Chlorophyll in Sun but not Sand Rush in Sand', () => {
    expect(speedOf(garchomp({ ability: 'Chlorophyll', item: 'Utility Umbrella' }), { field: { ...FIELD, weather: 'sun' } })).toBe(169);
    expect(speedOf(garchomp({ ability: 'Sand Rush', item: 'Utility Umbrella' }), { field: { ...FIELD, weather: 'sand' } })).toBe(338);
  });

  it('Magic Room suppresses Choice Scarf and Iron Ball', () => {
    const room = { field: { ...FIELD, isMagicRoom: true } };
    expect(speedOf(garchomp({ item: 'Choice Scarf' }), room)).toBe(169);
    expect(speedOf(garchomp({ item: 'Iron Ball' }), room)).toBe(169);
  });

  it('Klutz suppresses Iron Ball but not Power Anklet', () => {
    expect(speedOf(garchomp({ ability: 'Klutz', item: 'Iron Ball' }))).toBe(169);
    // 169 * 0.5 = 84.5, pokeRound rounds .5 down.
    expect(speedOf(garchomp({ ability: 'Klutz', item: 'Power Anklet' }))).toBe(84);
  });

  it('Air Lock or Cloud Nine on the field turns off Swift Swim', () => {
    const rain = { field: { ...FIELD, weather: 'rain' as const } };
    expect(speedOf(garchomp({ ability: 'Swift Swim' }), rain)).toBe(338);
    expect(speedOf(garchomp({ ability: 'Swift Swim' }), { ...rain, weatherSuppressed: true })).toBe(169);
  });

  it('a consumed item no longer counts even without Unburden', () => {
    expect(speedOf(garchomp({ item: 'Iron Ball' }), { itemConsumed: true })).toBe(169);
  });

  it('caps Speed at 10000', () => {
    const rain = { tailwind: true, field: { ...FIELD, weather: 'rain' as const } };
    const set = { ability: 'Swift Swim', item: 'Choice Scarf', statBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 6 } };
    // Base 255 Jolly 252: floor((510 + 31 + 63) / 2) + 5 = 307, x1.1 = 337.
    // +6 = 1348; Tailwind 2x, Swift Swim 2x, Scarf 1.5x = 6x -> 8088.
    const real = finalSpeed(garchomp({ ...set, baseStats: table(100, 100, 100, 100, 100, 255) }), cond(rain));
    expect(real.speed).toBe(8088);
    expect(real.capped).toBe(false);
    // A made-up base 500: 552 x1.1 = 607, +6 = 2428, x6 = 14568 -> 10000.
    const huge = finalSpeed(garchomp({ ...set, baseStats: table(100, 100, 100, 100, 100, 500) }), cond(rain));
    expect(huge.speed).toBe(10000);
    expect(huge.capped).toBe(true);
  });

  it('reports each modifier in the breakdown', () => {
    const result = finalSpeed(garchomp({ item: 'Choice Scarf', status: 'par' }), cond({ tailwind: true }));
    expect(result.modifiers.map((m) => m.source)).toEqual(['Tailwind', 'Choice Scarf']);
    expect(result.modified).toBe(507);
    expect(result.paralyzed).toBe(true);
    expect(result.speed).toBe(253);
  });
});
