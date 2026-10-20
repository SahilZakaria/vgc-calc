// Static-render test. The repo has no DOM test environment, so this checks
// the first render: every component is on screen and the results grid shows
// the reference calcs. The state rules behind the handlers are tested in
// appState.test.ts, MatchupGrid.test.tsx and theme.test.ts.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { initialState } from './appState';

describe('App', () => {
  const html = renderToStaticMarkup(<App />);

  it('shows four Pokemon panels, two per side', () => {
    for (const label of ['Left 1', 'Left 2', 'Right 1', 'Right 2']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html.match(/class="pki"/g)).toHaveLength(4);
    expect(html.indexOf('aria-label="Left 2"')).toBeLessThan(html.indexOf('aria-label="Left side attacking"'));
    expect(html.indexOf('aria-label="Right side attacking"')).toBeLessThan(html.indexOf('aria-label="Right 1"'));
  });

  it('mirrors the bottom row so Left 1 faces Right 2 and Left 2 faces Right 1', () => {
    const at = (label: string) => html.indexOf(`aria-label="${label}"`);
    expect(at('Left 1')).toBeLessThan(at('Left 2'));
    expect(at('Right 2')).toBeLessThan(at('Right 1'));
    expect(html).toContain('class="app-main app-main-doubles"');
  });

  it('gives each Pokemon its own move picker and crit toggle', () => {
    expect(html.match(/class="move-input"/g)).toHaveLength(4);
    for (const name of ['Garchomp', 'Charizard', 'Incineroar', 'Gardevoir']) {
      expect(html).toContain(`${name}&#x27;s move`);
    }
    for (const move of ['Earthquake', 'Heat Wave', 'Flare Blitz', 'Dazzling Gleam']) {
      expect(html).toContain(`value="${move}"`);
    }
    expect(html.match(/>Crit<\/label>/g)).toHaveLength(4);
  });

  it('shows all eight hits as compact cells with the reference results', () => {
    expect(html.match(/class="mg-cell"/g)).toHaveLength(8);
    // @smogon/calc 0.12.0, Champions doubles, Incineroar's Intimidate on both
    // left Pokemon (see appState.test.ts for the sets and full rolls).
    const cells = [
      'Garchomp Earthquake vs. Incineroar: 50.4% - 60.3%, guaranteed 2HKO',
      'Garchomp Earthquake vs. Gardevoir: 37.7% - 44.5%, guaranteed 3HKO',
      'Charizard Heat Wave vs. Incineroar: 14.3% - 17.3%, possible 6HKO',
      'Charizard Heat Wave vs. Gardevoir: 27.4% - 32.5%, guaranteed 4HKO',
      'Incineroar Flare Blitz vs. Garchomp: 21.3% - 25.6%, possible 4HKO',
      'Incineroar Flare Blitz vs. Charizard: 30.0% - 35.9%, possible 3HKO',
      'Gardevoir Dazzling Gleam vs. Garchomp: 68.8% - 81.9%, guaranteed 2HKO',
      'Gardevoir Dazzling Gleam vs. Charizard: 20.2% - 24.1%, guaranteed 5HKO',
    ];
    for (const cell of cells) expect(html).toContain(`aria-label="${cell}"`);
  });

  it('starts with every cell collapsed', () => {
    expect(html).not.toContain('class="result-display"');
    expect(html).not.toContain('aria-expanded="true"');
  });

  it("explains Incineroar's Intimidate on both left Pokemon and marks their Atk stage", () => {
    expect(html.match(/Incineroar&#x27;s Intimidate: Atk −1/g)).toHaveLength(2);
    expect(html.match(/aria-label="Atk boost, includes Incineroar&#x27;s Intimidate"/g)).toHaveLength(2);
    expect(html.match(/>Ignore<\/button>/g)).toHaveLength(2);
  });

  it('keeps the field panel, with the sides named left and right', () => {
    expect(html).toContain('class="field-input"');
    expect(html).toContain('<legend>Left side</legend>');
    expect(html).toContain('<legend>Right side</legend>');
    expect(html).toContain('Helping Hand');
    expect(html).toContain('Friend Guard');
  });

  it('offers the game and theme toggles with Champions and dark selected', () => {
    const checked = (label: string) =>
      new RegExp(`value="${label}" checked=""`).test(html) || new RegExp(`checked="" value="${label}"`).test(html);
    expect(checked('champions')).toBe(true);
    expect(checked('gen9')).toBe(false);
    expect(checked('dark')).toBe(true);
    expect(html).toContain('>Light<');
    expect(html).toContain('>System<');
  });

  it('passes Champions mode to the Pokemon inputs (SP column, fixed level)', () => {
    expect(html.match(/Level 50 \(fixed in Champions\)/g)).toHaveLength(4);
    expect(html).not.toContain('Tera type');
  });
});

describe('App in singles', () => {
  const singles = () => {
    const state = initialState();
    return { ...state, field: { ...state.field, isDoubles: false } };
  };
  const html = renderToStaticMarkup(<App initial={singles} />);

  it('shows only the first Pokemon on each side, in the singles layout', () => {
    expect(html).toContain('class="app-main app-main-singles"');
    expect(html.match(/class="pki"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Left 1"');
    expect(html).toContain('aria-label="Right 1"');
    expect(html).not.toContain('aria-label="Left 2"');
    expect(html).not.toContain('aria-label="Right 2"');
  });

  it('puts the results between the two Pokemon', () => {
    const at = (label: string) => html.indexOf(`aria-label="${label}"`);
    expect(at('Left 1')).toBeLessThan(at('Left side attacking'));
    expect(at('Right side attacking')).toBeLessThan(at('Right 1'));
    expect(html.match(/class="mg-cell"/g)).toHaveLength(2);
  });

  it('brings back both second Pokemon, sets intact, when doubles is turned back on', () => {
    // The Format toggle only replaces state.field; this is that state.
    const back = () => {
      const state = singles();
      return { ...state, field: { ...state.field, isDoubles: true } };
    };
    const again = renderToStaticMarkup(<App initial={back} />);
    expect(again).toContain('class="app-main app-main-doubles"');
    expect(again.match(/class="pki"/g)).toHaveLength(4);
    expect(again).toContain('Charizard&#x27;s move');
    expect(again).toContain('Gardevoir&#x27;s move');
    expect(again).toContain('value="Heat Wave"');
    expect(again).toContain('value="Dazzling Gleam"');
  });
});
