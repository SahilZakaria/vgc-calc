// Static-render tests (the repo has no DOM test environment). Damage values
// come from appState.test.ts's @smogon/calc references; this checks what each
// cell shows and what expanding one adds.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { allMatchups, initialState, type CalcState } from '../appState';
import { MatchupGrid, matchupKey } from './MatchupGrid';

const state = initialState();
const left = allMatchups(state).left;

const render = (expanded: string | null, matchups = left) =>
  renderToStaticMarkup(<MatchupGrid label="Left side attacking" matchups={matchups} expanded={expanded} onToggle={() => {}} />);

describe('MatchupGrid', () => {
  it('lays out attackers as rows and defenders as columns', () => {
    const html = render(null);
    expect(html.match(/class="mg-defender"/g)).toHaveLength(2);
    expect(html.match(/class="mg-attacker"/g)).toHaveLength(2);
    expect(html.indexOf('>Incineroar<')).toBeLessThan(html.indexOf('>Gardevoir<'));
    expect(html.indexOf('>Garchomp<')).toBeLessThan(html.indexOf('>Charizard<'));
  });

  it('shows only the percent range and the KO line in each cell', () => {
    const html = render(null);
    // @smogon/calc: -1 Garchomp Earthquake vs. Incineroar 50.4 - 60.3%, guaranteed 2HKO.
    expect(html).toContain('<span class="mg-range">50.4 – 60.3%</span><span class="mg-ko">guaranteed 2HKO</span>');
    expect(html).not.toContain('class="result-display__rolls"');
  });

  it('marks spread moves', () => {
    expect(render(null).match(/>spread</g)).toHaveLength(2);
  });

  it('expands a cell to the full 16-roll result', () => {
    const key = matchupKey({ attacker: 'left1', defender: 'right2' });
    const html = render(key);
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html).toContain('Garchomp Earthquake vs. Gardevoir');
    expect(html).toContain('spread 0.75x');
    // @smogon/calc: -1 Garchomp Earthquake vs. 32 HP Gardevoir, 66-78.
    const rolls = [66, 66, 67, 67, 69, 69, 70, 70, 72, 72, 73, 73, 75, 75, 76, 78];
    expect(html).toContain(`<ol class="result-display__rolls" aria-label="Damage rolls">${rolls.map((r) => `<li>${r}</li>`).join('')}</ol>`);
  });

  it('shows the error in a cell the calc cannot handle', () => {
    const chomp = state.slots.left1;
    const bad: CalcState = {
      ...state,
      slots: { ...state.slots, left1: { ...chomp, pokemon: { ...chomp.pokemon, nature: 'Nonsense' } } },
    };
    const matchups = allMatchups(bad).left;
    const html = render(matchupKey({ attacker: 'left1', defender: 'right1' }), matchups);
    expect(html).toContain("can&#x27;t calculate");
    expect(html).toContain('role="alert"');
  });

  it('renders nothing with no matchups', () => {
    expect(render(null, [])).toBe('');
  });
});
