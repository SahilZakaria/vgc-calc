import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Move } from '@vgc/types';
import { loadLearnset } from './legalData';
import { MoveInput } from './MoveInput';

// No DOM test environment is installed (no jsdom or testing-library), so
// these tests check the rendered markup only. Typing, selecting and the
// override toggle are not covered here.

const NO_FLAGS: Move['flags'] = {
  contact: false, punch: false, sound: false, slicing: false,
  bite: false, bullet: false, wind: false, pulse: false,
};

// Fake Out per Bulbapedia: Normal, Physical, 40 BP, +3 priority, contact.
const FAKE_OUT: Move = {
  name: 'Fake Out',
  type: 'Normal',
  basePower: 40,
  variablePower: 'none',
  category: 'Physical',
  target: 'single',
  priority: 3,
  hits: 1,
  flags: { ...NO_FLAGS, contact: true },
};

function render(move: Move, game: 'champions' | 'gen9' = 'gen9', species = 'Incineroar'): string {
  return renderToStaticMarkup(<MoveInput move={move} game={game} species={species} onChange={() => {}} />);
}

// Static rendering does not run effects, so learnsets are loaded up front.
beforeAll(async () => {
  for (const game of ['champions', 'gen9'] as const) {
    await loadLearnset(game, 'Incineroar');
    await loadLearnset(game, 'Garchomp');
    await loadLearnset(game, 'Not A Pokemon');
  }
});

describe('MoveInput', () => {
  it('shows the selected move and its values as read-only text', () => {
    const html = render(FAKE_OUT);
    expect(html).toContain('value="Fake Out"');
    expect(html).toContain('<dd>Normal</dd>');
    expect(html).toContain('<dd>Physical</dd>');
    expect(html).toContain('<span>40</span>');
    expect(html).toContain('<dd>Single target</dd>');
    expect(html).toContain('<dd>+3</dd>');
    expect(html).toContain('Contact');
    expect(html).not.toContain('type="number"');
  });

  it('does not show the dropdown until the user interacts', () => {
    expect(render(FAKE_OUT)).not.toContain('role="listbox"');
  });

  it('warns when the move is not in the selected game', () => {
    const teraBlast: Move = { ...FAKE_OUT, name: 'Tera Blast', basePower: 80, category: 'Special' };
    expect(render(teraBlast, 'champions')).toContain('not in the Champions move data');
    expect(render(teraBlast, 'gen9')).not.toContain('not in the');
  });

  it('suggests the override for variable-power moves', () => {
    const lowKick: Move = { ...FAKE_OUT, name: 'Low Kick', type: 'Fighting', basePower: 0, variablePower: 'targetWeight', priority: 0 };
    expect(render(lowKick)).toContain('Turn on Override');
    expect(render(FAKE_OUT)).not.toContain('Turn on Override');
  });

  it('hides the details when no move is selected', () => {
    const html = render({ ...FAKE_OUT, name: '' });
    expect(html).not.toContain('<dl');
    expect(html).toContain('placeholder="Search Incineroar&#x27;s moves"');
    expect(render({ ...FAKE_OUT, name: '' }, 'gen9', '')).toContain('placeholder="Search Scarlet/Violet moves"');
  });
});

describe('MoveInput learnset checks', () => {
  // Reference: Bulbapedia. Incineroar learns Fake Out (Scarlet/Violet egg
  // move; standard on Champions sets). Garchomp cannot learn it in any game.
  it.each(['champions', 'gen9'] as const)('%s: warns when the attacker cannot learn the move', (game) => {
    const label = game === 'champions' ? 'Champions' : 'Scarlet/Violet';
    expect(render(FAKE_OUT, game, 'Garchomp')).toContain(`Garchomp can&#x27;t learn Fake Out in ${label}.`);
    expect(render(FAKE_OUT, game, 'Incineroar')).not.toContain('can&#x27;t learn');
  });

  it('says so when there is no learnset data for the attacker', () => {
    const html = render(FAKE_OUT, 'champions', 'Not A Pokemon');
    expect(html).toContain('No Champions learnset data for Not A Pokemon');
    expect(html).not.toContain('can&#x27;t learn');
  });

  it('does not warn while the learnset is still loading', () => {
    const html = render(FAKE_OUT, 'gen9', 'Talonflame');
    expect(html).not.toContain('can&#x27;t learn');
    expect(html).not.toContain('No Scarlet/Violet learnset data');
  });
});
