import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { initialState, setAbilityFieldIgnored, switchInField, turnOrderNames, type CalcState, type Slot } from '../appState';
import { describeFieldEffect, FieldEffectNotes, fieldSourceBadge } from './FieldEffectNotes';

const LABELS = { left1: 'Left 1', left2: 'Left 2', right1: 'Right 1', right2: 'Right 2' } as const;

const withAbility = (state: CalcState, slot: Slot, ability: string): CalcState => ({
  ...state,
  slots: { ...state.slots, [slot]: { ...state.slots[slot], pokemon: { ...state.slots[slot].pokemon, ability } } },
});

function render(state: CalcState): string {
  return renderToStaticMarkup(
    <FieldEffectNotes info={switchInField(state)} names={turnOrderNames(state, LABELS)} onSetIgnored={() => undefined} />,
  );
}

// Starting field Speeds (Champions, level 50): Charizard 167, Gardevoir 100.
describe('FieldEffectNotes', () => {
  it('renders nothing when no ability sets weather or terrain', () => {
    expect(render(initialState())).toBe('');
  });

  it('names the Pokemon and ability that set the weather, with an Ignore button', () => {
    const html = render(withAbility(initialState(), 'right2', 'Drought'));
    expect(html).toContain('Weather: Sun from Gardevoir&#x27;s Drought');
    expect(html).toContain('>Ignore</button>');
    expect(html).not.toContain('data-kind="terrain"');
  });

  it('explains a weather war by Speed', () => {
    let state = withAbility(initialState(), 'left2', 'Drought');
    state = withAbility(state, 'right2', 'Drizzle');
    const html = render(state);
    expect(html).toContain('Weather: Rain from Gardevoir&#x27;s Drizzle');
    expect(html).toContain(
      'Gardevoir (100 Speed) is slower than Charizard (167 Speed), so its Drizzle activates last and replaces Sun.',
    );
  });

  it('shows an ignored ability as set by hand with a Use ability button', () => {
    const state = setAbilityFieldIgnored(withAbility(initialState(), 'left1', 'Electric Surge'), 'terrain', true);
    const html = render(state);
    expect(html).toContain('Terrain: No terrain, set by hand');
    expect(html).toContain('Garchomp&#x27;s Electric Surge (Electric Terrain) is ignored.');
    expect(html).toContain('>Use ability</button>');
  });
});

describe('fieldSourceBadge', () => {
  const nameOf = (id: string) => id;
  it('is absent with no ability setter', () => {
    expect(fieldSourceBadge('weather', switchInField(initialState()).weather, nameOf)).toBeUndefined();
  });

  it('names the ability, or says by hand when it is ignored', () => {
    const state = withAbility(initialState(), 'right1', 'Sand Stream');
    expect(fieldSourceBadge('weather', switchInField(state).weather, nameOf)).toMatchObject({
      text: 'Sand Stream',
      kind: 'ability',
    });
    const ignored = setAbilityFieldIgnored(state, 'weather', true);
    expect(fieldSourceBadge('weather', switchInField(ignored).weather, nameOf)).toMatchObject({
      text: 'by hand',
      kind: 'manual',
    });
  });

  it('describeFieldEffect gives no reason for a lone setter', () => {
    const state = withAbility(initialState(), 'right1', 'Snow Warning');
    expect(describeFieldEffect('weather', switchInField(state).weather, (id) => id)).toEqual({
      headline: "Weather: Snow from right1's Snow Warning",
      detail: null,
    });
  });
});
