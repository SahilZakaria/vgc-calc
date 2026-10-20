// Static-render tests (the repo has no DOM test environment). The rules that
// produce each StageEffect are tested in src/calc/intimidate.test.ts and
// appState.test.ts; this checks the wording and which button is offered.

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { StageEffect } from '../appState';
import { describeEffect, StageEffectNotes } from './StageEffectNotes';

const effect = (over: Partial<StageEffect>): StageEffect => ({
  slot: 'left1',
  source: "Incineroar's Intimidate",
  cause: null,
  changes: { atk: -1 },
  overridden: [],
  ...over,
});

const render = (effects: StageEffect[]): string =>
  renderToStaticMarkup(<StageEffectNotes effects={effects} onSetManual={() => {}} />);

describe('describeEffect', () => {
  it('names the source and the stage change', () => {
    expect(describeEffect(effect({}))).toBe("Incineroar's Intimidate: Atk −1");
  });

  it('names the ability that changed it', () => {
    expect(describeEffect(effect({ cause: 'Defiant', changes: { atk: 1 } }))).toBe(
      "Incineroar's Intimidate: Atk +1 (Defiant)",
    );
    expect(describeEffect(effect({ cause: 'Competitive', changes: { atk: -1, spa: 2 } }))).toBe(
      "Incineroar's Intimidate: Atk −1, SpA +2 (Competitive)",
    );
  });

  it('says what blocked it', () => {
    expect(describeEffect(effect({ cause: 'Clear Body', changes: {} }))).toBe(
      "Incineroar's Intimidate: blocked by Clear Body",
    );
    expect(describeEffect(effect({ cause: 'Mirror Armor', changes: {} }))).toBe(
      "Incineroar's Intimidate: bounced back by Mirror Armor",
    );
    expect(describeEffect(effect({ changes: {} }))).toBe(
      "Incineroar's Intimidate: no effect, stage already at its limit",
    );
  });
});

describe('StageEffectNotes', () => {
  it('renders nothing without effects', () => {
    expect(render([])).toBe('');
  });

  it('offers Ignore on an applied change', () => {
    const html = render([effect({})]);
    expect(html).toContain('Incineroar&#x27;s Intimidate: Atk −1');
    expect(html).toContain('>Ignore</button>');
    expect(html).not.toContain('>Apply</button>');
  });

  it('offers Apply on a change overridden by a hand-set stage', () => {
    const html = render([effect({ overridden: ['atk'] })]);
    expect(html).toContain('not applied, stage set by hand');
    expect(html).toContain('>Apply</button>');
    expect(html).not.toContain('>Ignore</button>');
  });

  it('offers no button on a blocked effect', () => {
    const html = render([effect({ cause: 'Clear Body', changes: {} })]);
    expect(html).toContain('blocked by Clear Body');
    expect(html).not.toContain('<button');
  });
});
