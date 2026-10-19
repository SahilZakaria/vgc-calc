// Static-render test. The repo has no DOM test environment, so this checks
// the first render: every component is on screen and the result is the
// reference calc. The state rules behind the handlers are tested in
// appState.test.ts and theme.test.ts.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  const html = renderToStaticMarkup(<App />);

  it("shows the default calc result, with Incineroar's Intimidate applied", () => {
    // @smogon/calc 0.12.0, Champions doubles, Incineroar abilityOn: -1 32+ Atk
    // Garchomp Earthquake vs. 32 HP / 0 Def Incineroar: 102-122 (50.4 - 60.3%)
    // -- guaranteed 2HKO. ResultDisplay prints percents to one decimal.
    expect(html).toContain('50.4% - 60.3% (guaranteed 2HKO)');
    expect(html).toContain('Garchomp Earthquake vs. Incineroar');
  });

  it('explains the Intimidate drop next to the attacker and marks its Atk stage', () => {
    expect(html).toContain('Incineroar&#x27;s Intimidate: Atk −1');
    expect(html).toContain('>Ignore</button>');
    expect(html).toContain('aria-label="Atk boost, includes Incineroar&#x27;s Intimidate"');
    // The note sits in the attacker's column, before the defender's input.
    expect(html.indexOf('Incineroar&#x27;s Intimidate: Atk −1')).toBeLessThan(html.indexOf('aria-label="Defender"'));
  });

  it('shows the reverse calc result alongside it', () => {
    // @smogon/calc 0.12.0, Champions doubles: 0 Atk Incineroar Flare Blitz
    // vs. 0 HP / 0 Def Garchomp: 39-47 (21.3 - 25.6%) -- 0.7% chance to 4HKO.
    // ResultDisplay says "possible" for a less-than-certain KO.
    expect(html).toContain('21.3% - 25.6% (possible 4HKO)');
    expect(html).toContain('Incineroar Flare Blitz vs. Garchomp');
    // Forward first, reverse second.
    expect(html.indexOf('50.4% - 60.3%')).toBeLessThan(html.indexOf('21.3% - 25.6%'));
  });

  it("gives each direction its own move picker, labeled with the attacking Pokemon", () => {
    expect(html.match(/class="move-input"/g)).toHaveLength(2);
    expect(html.match(/class="result-display"/g)).toHaveLength(2);
    expect(html).toContain('Garchomp&#x27;s move');
    expect(html).toContain('Incineroar&#x27;s move');
    expect(html).toContain('value="Earthquake"');
    expect(html).toContain('value="Flare Blitz"');
    expect(html).toContain('aria-label="Attacker&#x27;s move into defender"');
    expect(html).toContain('aria-label="Defender&#x27;s move into attacker"');
  });

  it('renders all four components', () => {
    expect(html).toContain('aria-label="Attacker"');
    expect(html).toContain('aria-label="Defender"');
    expect(html).toContain('class="move-input"');
    expect(html).toContain('class="field-input"');
    expect(html).toContain('class="result-display"');
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
    expect(html).toContain('Level 50 (fixed in Champions)');
    expect(html).not.toContain('Tera type');
  });
});
