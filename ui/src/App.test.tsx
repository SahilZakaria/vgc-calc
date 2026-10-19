// Static-render test. The repo has no DOM test environment, so this checks
// the first render: every component is on screen and the result is the
// reference calc. The state rules behind the handlers are tested in
// appState.test.ts and theme.test.ts.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  const html = renderToStaticMarkup(<App />);

  it('shows the default calc result', () => {
    // @smogon/calc 0.12.0, Champions doubles: 32+ Atk Garchomp Earthquake
    // vs. 32 HP / 0 Def Incineroar: 152-182 (75.2 - 90%) -- guaranteed 2HKO.
    // ResultDisplay prints percents to one decimal.
    expect(html).toContain('75.2% - 90.0% (guaranteed 2HKO)');
    expect(html).toContain('Garchomp Earthquake vs. Incineroar');
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
