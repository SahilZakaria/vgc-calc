import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { initialState, turnOrderFor, turnOrderNames, updateSlot, type CalcState } from '../appState';
import { TurnOrderPanel } from './TurnOrderPanel';

const LABELS = { left1: 'Left 1', left2: 'Left 2', right1: 'Right 1', right2: 'Right 2' } as const;

function render(state: CalcState): string {
  return renderToStaticMarkup(
    <TurnOrderPanel order={turnOrderFor(state)} names={turnOrderNames(state, LABELS)} slotLabels={LABELS} />,
  );
}

const items = (html: string) => [...html.matchAll(/data-entry="(\w+)"/g)].map((m) => m[1]);

describe('TurnOrderPanel', () => {
  // Starting field, Champions level 50: Timid 32 SP Charizard 167, Garchomp
  // 122 (base 102, 0 SP), Gardevoir 100 (base 80), Incineroar 80 (base 60).
  it('lists the four moves in Speed order with each Speed as the reason', () => {
    const html = render(initialState());
    expect(items(html)).toEqual(['left2', 'left1', 'right2', 'right1']);
    expect(html).toContain('aria-label="Turn order"');
    for (const reason of ['167 Speed', '122 Speed', '100 Speed', '80 Speed']) expect(html).toContain(reason);
    expect(html).toContain('<ol class="to-list">');
    expect(html).not.toContain('coin flip');
  });

  it('shows a Speed tie as a shared place with a coin flip tag', () => {
    const start = initialState();
    // 20 SP (156 EVs) Incineroar: floor((120 + 31 + 39) / 2) + 5 = 100, tying Gardevoir.
    const incin = start.slots.right1;
    const tied: CalcState = {
      ...start,
      slots: {
        ...start.slots,
        right1: { ...incin, pokemon: { ...incin.pokemon, evs: { ...incin.pokemon.evs, spe: 156 } } },
      },
    };
    const html = render(tied);
    expect(html.match(/to-item to-item-tie/g)).toHaveLength(2);
    expect(html.match(/>3-4</g)).toHaveLength(2);
    expect(html.match(/>coin flip</g)).toHaveLength(2);
    expect(html).toContain('Speed tie with Gardevoir: coin flip');
  });

  it('reverses the order and says so under Trick Room', () => {
    const html = render({ ...initialState(), isTrickRoom: true });
    expect(items(html)).toEqual(['right1', 'right2', 'left1', 'left2']);
    expect(html).toContain('Trick Room: slower moves first within each priority bracket');
  });

  it('keeps priority ahead of Trick Room', () => {
    const start = initialState();
    const fakeOut = { ...start.slots.left2.move, name: 'Fake Out', priority: 3 };
    const html = render(updateSlot({ ...start, isTrickRoom: true }, 'left2', { move: fakeOut }));
    expect(items(html)[0]).toBe('left2');
    expect(html).toContain('priority +3');
  });

  it('lists each place with name and move on one line and the reason under it, plus a Copy button', () => {
    const html = render(initialState());
    expect(html).toMatch(
      /<span class="to-place"[^>]*>1<\/span><span class="to-body"><span class="to-line"><span class="to-name">Charizard<\/span><span class="to-move">Heat Wave<\/span><\/span><span class="to-reason">167 Speed<\/span>/,
    );
    expect(html).toContain('>Copy</button>');
  });

  it('states Trick Room in the panel body, not in the title', () => {
    const html = render({ ...initialState(), isTrickRoom: true });
    expect(html).toContain('<h2 class="to-title">Turn order</h2><p class="to-room">Trick Room:');
  });
});
