import { Field, Generations, Move, Pokemon, Result, calculate, type StatsTable } from '@smogon/calc';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DamageResult } from '@vgc/types';
import { ResultDisplay } from './ResultDisplay';

// Reference: @smogon/calc 0.12.0 (the engine behind the Showdown calc).
// Rolls and max HP come from its calculate(); the expected KO text comes from
// its kochance() and the expected percent range from its moveDesc('%'). With
// no hazards or end-of-turn effects, its text is either "guaranteed nHKO" or
// "X% chance to nHKO"; this component says "possible nHKO" for the second.

type Gen = ReturnType<typeof Generations.get>;

interface Expected {
  result: DamageResult;
  summary: string;
}

function fromSmogon(smogon: Result): Expected {
  const rolls = smogon.damage;
  if (!Array.isArray(rolls) || rolls.length !== 16 || !rolls.every((r) => typeof r === 'number')) {
    throw new Error('expected 16 single-hit rolls from @smogon/calc');
  }
  const flatRolls = rolls as number[];
  const hp = smogon.defender.maxHP();

  const koText = smogon.kochance().text;
  const chance = /^\d+(?:\.\d+)?% chance to (\S+)$/.exec(koText);
  if (!chance && !/^guaranteed \S+$/.test(koText)) throw new Error(`unexpected KO text: ${koText}`);
  const expectedKo = chance ? `possible ${chance[1]}` : koText;

  const range = /^([\d.]+) - ([\d.]+)%$/.exec(smogon.moveDesc('%'));
  if (!range) throw new Error(`unexpected range text: ${smogon.moveDesc('%')}`);
  const min = Number(range[1]).toFixed(1);
  const max = Number(range[2]).toFixed(1);

  return {
    result: {
      rolls: flatRolls,
      defenderMaxHp: hp,
      minPercent: (Math.min(...flatRolls) / hp) * 100,
      maxPercent: (Math.max(...flatRolls) / hp) * 100,
    },
    summary: `${min}% - ${max}% (${expectedKo})`,
  };
}

function smogonCalc(
  gen: Gen,
  attacker: string,
  attackerSp: Partial<StatsTable>,
  defender: string,
  defenderSp: Partial<StatsTable>,
  move: string,
): Result {
  return calculate(
    gen,
    new Pokemon(gen, attacker, { evs: attackerSp, nature: 'Adamant' }),
    new Pokemon(gen, defender, { evs: defenderSp }),
    new Move(gen, move),
    new Field({ gameType: 'Doubles' }),
  );
}

// Hand-picked rolls fed through @smogon/calc's own Result, to pin the exact
// KO boundaries (a roll equal to max HP, one point short, and so on).
function smogonWithRolls(gen: Gen, defender: Pokemon, rolls: number[]): Result {
  return new Result(gen, new Pokemon(gen, 'Garchomp'), defender, new Move(gen, 'Tackle'), new Field(), rolls, {
    attackerName: 'Garchomp',
    defenderName: defender.name,
    moveName: 'Tackle',
  });
}

function spread(low: number, high: number): number[] {
  return Array.from({ length: 16 }, (_, i) => low + Math.round(((high - low) * i) / 15));
}

function render(result: DamageResult): string {
  return renderToStaticMarkup(createElement(ResultDisplay, { result }));
}

function summaryOf(html: string): string {
  const match = /<p class="result-display__summary">([^<]*)<\/p>/.exec(html);
  if (!match) throw new Error('summary line not found');
  return match[1];
}

const champions = Generations.get(0);
const gen9 = Generations.get(9);
const incineroar = new Pokemon(gen9, 'Incineroar', { evs: { hp: 252 } });
const hp = incineroar.maxHP();

const cases: Array<[string, Result]> = [
  ['Champions: 32 Atk Garchomp Earthquake vs 32 HP Incineroar', smogonCalc(champions, 'Garchomp', { atk: 32 }, 'Incineroar', { hp: 32 }, 'Earthquake')],
  ['Gen 9: Garchomp Earthquake vs Heatran (OHKO)', smogonCalc(gen9, 'Garchomp', { atk: 252 }, 'Heatran', {}, 'Earthquake')],
  ['Gen 9: Garchomp Dragon Claw vs bulky Amoonguss (not a guaranteed KO)', smogonCalc(gen9, 'Garchomp', { atk: 252 }, 'Amoonguss', { hp: 252, def: 252 }, 'Dragon Claw')],
  ['Gen 9: Garchomp Rock Slide vs Sylveon (chance to 4HKO)', smogonCalc(gen9, 'Garchomp', { atk: 32 }, 'Sylveon', { hp: 32 }, 'Rock Slide')],
  ['rolls from exactly max HP up: guaranteed OHKO', smogonWithRolls(gen9, incineroar, spread(hp, hp + 30))],
  ['min roll one short of max HP: possible OHKO', smogonWithRolls(gen9, incineroar, spread(hp - 1, hp + 30))],
  ['max roll one short of max HP, min roll exactly half: guaranteed 2HKO', smogonWithRolls(gen9, incineroar, spread(Math.ceil(hp / 2), hp - 1))],
  ['min roll just under half: possible 2HKO', smogonWithRolls(gen9, incineroar, spread(Math.ceil(hp / 2) - 1, hp - 1))],
];

describe('ResultDisplay', () => {
  it.each(cases)('summary matches @smogon/calc: %s', (_name, smogon) => {
    const { result, summary } = fromSmogon(smogon);
    expect(summaryOf(render(result))).toBe(summary);
  });

  it('renders all 16 rolls in order and the defender max HP', () => {
    const { result } = fromSmogon(cases[0][1]);
    const html = render(result);
    const shown = [...html.matchAll(/<li>(\d+)<\/li>/g)].map((m) => Number(m[1]));
    expect(shown).toEqual(result.rolls);
    expect(html).toContain(`<dd>${result.defenderMaxHp}</dd>`);
  });

  // No external reference: @smogon/calc refuses to describe a 0-damage result.
  // This only checks that an immune hit does not claim a KO.
  it('does not claim a KO when every roll is 0', () => {
    const summary = summaryOf(render({ rolls: new Array<number>(16).fill(0), defenderMaxHp: 200, minPercent: 0, maxPercent: 0 }));
    expect(summary).toBe('0.0% - 0.0% (no damage)');
  });
});
