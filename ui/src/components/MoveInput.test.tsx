import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Move } from '@vgc/types';
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

function render(move: Move, game: 'champions' | 'gen9' = 'gen9'): string {
  return renderToStaticMarkup(<MoveInput move={move} game={game} onChange={() => {}} />);
}

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
    expect(html).toContain('placeholder="Search Scarlet/Violet moves"');
  });
});
