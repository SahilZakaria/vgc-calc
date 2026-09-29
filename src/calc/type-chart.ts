import type { DamageContext, Pokemon, TypeName } from '../types';

/**
 * Attacking type -> defending type -> damage multiplier.
 * Only non-neutral (not 1x) entries are listed; anything absent is neutral (1x).
 */
const TYPE_CHART: Record<TypeName, Partial<Record<TypeName, number>>> = {
  Normal: { Rock: 0.5, Steel: 0.5, Ghost: 0 },
  Fire: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 2, Bug: 2, Rock: 0.5, Dragon: 0.5, Steel: 2 },
  Water: { Fire: 2, Water: 0.5, Grass: 0.5, Ground: 2, Rock: 2, Dragon: 0.5 },
  Electric: { Water: 2, Electric: 0.5, Grass: 0.5, Ground: 0, Flying: 2, Dragon: 0.5 },
  Grass: {
    Fire: 0.5,
    Water: 2,
    Grass: 0.5,
    Poison: 0.5,
    Ground: 2,
    Flying: 0.5,
    Bug: 0.5,
    Rock: 2,
    Dragon: 0.5,
    Steel: 0.5,
  },
  Ice: { Fire: 0.5, Water: 0.5, Grass: 2, Ice: 0.5, Ground: 2, Flying: 2, Dragon: 2, Steel: 0.5 },
  Fighting: {
    Normal: 2,
    Ice: 2,
    Poison: 0.5,
    Flying: 0.5,
    Psychic: 0.5,
    Bug: 0.5,
    Rock: 2,
    Ghost: 0,
    Dark: 2,
    Steel: 2,
    Fairy: 0.5,
  },
  Poison: { Grass: 2, Poison: 0.5, Ground: 0.5, Rock: 0.5, Ghost: 0.5, Steel: 0, Fairy: 2 },
  Ground: { Fire: 2, Electric: 2, Grass: 0.5, Poison: 2, Flying: 0, Bug: 0.5, Rock: 2, Steel: 2 },
  Flying: { Electric: 0.5, Grass: 2, Fighting: 2, Bug: 2, Rock: 0.5, Steel: 0.5 },
  Psychic: { Fighting: 2, Poison: 2, Psychic: 0.5, Dark: 0, Steel: 0.5 },
  Bug: {
    Fire: 0.5,
    Grass: 2,
    Fighting: 0.5,
    Poison: 0.5,
    Flying: 0.5,
    Psychic: 2,
    Ghost: 0.5,
    Dark: 2,
    Steel: 0.5,
    Fairy: 0.5,
  },
  Rock: { Fire: 2, Ice: 2, Fighting: 0.5, Ground: 0.5, Flying: 2, Bug: 2, Steel: 0.5 },
  Ghost: { Normal: 0, Psychic: 2, Ghost: 2, Dark: 0.5 },
  Dragon: { Dragon: 2, Steel: 0.5, Fairy: 0 },
  Dark: { Fighting: 0.5, Psychic: 2, Ghost: 2, Dark: 0.5, Fairy: 0.5 },
  Steel: { Fire: 0.5, Water: 0.5, Electric: 0.5, Ice: 2, Rock: 2, Steel: 0.5, Fairy: 2 },
  Fairy: { Fire: 0.5, Fighting: 2, Poison: 0.5, Dragon: 2, Dark: 2, Steel: 0.5 },
};

/**
 * Returns the combined type-effectiveness multiplier for a move of `moveType`
 * hitting a defender with `defenderTypes` (e.g. 4 for a double weakness, 0 for
 * an immunity).
 */
export function getTypeEffectiveness(moveType: TypeName, defenderTypes: TypeName[]): number {
  const matchups = TYPE_CHART[moveType];
  return defenderTypes.reduce((multiplier, defenderType) => {
    const factor = matchups[defenderType] ?? 1;
    return multiplier * factor;
  }, 1);
}

/**
 * A terastallized Pokemon defends purely as its single tera type, replacing
 * its original type(s) for matchup purposes.
 */
export function getDefensiveTypes(pokemon: Pokemon): TypeName[] {
  if (pokemon.isTerastallized && pokemon.teraType) {
    return [pokemon.teraType];
  }
  return pokemon.types;
}

/**
 * Type effectiveness of ctx.move against ctx.defender, with the field and item
 * exceptions @smogon/calc 0.12.0 applies (gen789.js calculateSMSSSV and
 * champions.js calculateChampions, via util.js getMoveEffectiveness):
 *   - Gravity: a Ground move hits the Flying type neutrally. This is per
 *     type, so Ground vs Flying/Steel under Gravity is 2x.
 *   - Iron Ball: if the Ground move's total effectiveness is 0, it becomes
 *     1. This is a flat 1, not a per-type fix, so Ground vs Flying/Steel with
 *     Iron Ball is 1x in @smogon/calc (in-game it would be 2x).
 * Klutz and Magic Room are not checked here; resolveAbilitiesAndItems in
 * modifiers/abilities-items.ts removes the item before this runs.
 */
export function getMoveEffectiveness(ctx: DamageContext): number {
  const { move, defender, field } = ctx;
  const effectiveness = getDefensiveTypes(defender).reduce(
    (multiplier, defenderType) =>
      field.isGravity && move.type === 'Ground' && defenderType === 'Flying'
        ? multiplier
        : multiplier * getTypeEffectiveness(move.type, [defenderType]),
    1,
  );
  if (effectiveness === 0 && move.type === 'Ground' && defender.item === 'Iron Ball') return 1;
  return effectiveness;
}
