import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FieldState, Game, SideState } from '@vgc/types';
import { FieldInput } from './FieldInput';

// No DOM library is installed, so these tests expand the element tree by
// calling each function component (none of them use hooks) and then invoke
// the host elements' onChange props directly.

type AnyProps = Record<string, unknown> & { children?: ReactNode };

function expand(node: ReactNode): ReactElement<AnyProps>[] {
  if (Array.isArray(node)) return node.flatMap(expand);
  if (!isValidElement<AnyProps>(node)) return [];
  if (typeof node.type === 'function') {
    const component = node.type as (props: AnyProps) => ReactNode;
    return expand(component(node.props));
  }
  return [node, ...expand(node.props.children)];
}

const emptySide = (): SideState => ({
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  tailwind: false,
  helpingHand: false,
  friendGuard: false,
  battery: false,
  powerSpot: false,
  steelySpirit: false,
  stealthRock: false,
  spikes: 0,
});

const baseField = (): FieldState => ({
  weather: 'none',
  terrain: 'none',
  isDoubles: true,
  isGravity: false,
  isWonderRoom: false,
  isMagicRoom: false,
  isBeadsOfRuin: false,
  isSwordOfRuin: false,
  isTabletsOfRuin: false,
  isVesselOfRuin: false,
  attackerSide: emptySide(),
  defenderSide: emptySide(),
});

function setup(game: Game, field: FieldState = baseField(), isTrickRoom = false) {
  const onChange = vi.fn<(f: FieldState) => void>();
  const onTrickRoomChange = vi.fn<(on: boolean) => void>();
  const nodes = expand(
    <FieldInput
      field={field}
      game={game}
      onChange={onChange}
      isTrickRoom={isTrickRoom}
      onTrickRoomChange={onTrickRoomChange}
    />,
  );
  const byId = (id: string) => {
    const el = nodes.find((n) => n.props.id === id);
    if (!el) throw new Error(`no element with id ${id}`);
    return el;
  };
  const optionValues = (selectId: string) =>
    expand(byId(selectId).props.children).filter((n) => n.type === 'option').map((n) => n.props.value);
  const fire = (id: string, value: { checked?: boolean; value?: string } = {}) => {
    const handler = byId(id).props.onChange as (e: { currentTarget: typeof value }) => void;
    handler({ currentTarget: value });
    expect(onChange).toHaveBeenCalledTimes(1);
    return onChange.mock.calls[0]![0];
  };
  const hasId = (id: string) => nodes.some((n) => n.props.id === id);
  const checkedOf = (id: string) => byId(id).props.checked;
  const toggleTrickRoom = (checked: boolean) => {
    const handler = byId('field-isTrickRoom').props.onChange as (e: { currentTarget: { checked: boolean } }) => void;
    handler({ currentTarget: { checked } });
    return onTrickRoomChange.mock.calls;
  };
  return { fire, hasId, optionValues, checkedOf, toggleTrickRoom, onChange };
}

describe('FieldInput Trick Room', () => {
  it('shows a Trick Room toggle in both games, reflecting the prop', () => {
    for (const game of ['champions', 'gen9'] as const) {
      expect(setup(game).checkedOf('field-isTrickRoom')).toBe(false);
      expect(setup(game, baseField(), true).checkedOf('field-isTrickRoom')).toBe(true);
    }
  });

  it('reports a toggle through onTrickRoomChange, leaving the field alone', () => {
    const { toggleTrickRoom, onChange } = setup('champions');
    expect(toggleTrickRoom(true)).toEqual([[true]]);
    expect(onChange).not.toHaveBeenCalled();
  });
});

const RUIN_IDS = ['field-isBeadsOfRuin', 'field-isSwordOfRuin', 'field-isTabletsOfRuin', 'field-isVesselOfRuin'];

describe('FieldInput game-specific controls', () => {
  it('hides Ruin toggles and primal weathers in Champions', () => {
    const { hasId, optionValues } = setup('champions');
    for (const id of RUIN_IDS) expect(hasId(id)).toBe(false);
    expect(optionValues('field-weather')).toEqual(['none', 'sun', 'rain', 'sand', 'snow']);
  });

  it('shows Ruin toggles and primal weathers in Gen 9', () => {
    const { hasId, optionValues } = setup('gen9');
    for (const id of RUIN_IDS) expect(hasId(id)).toBe(true);
    expect(optionValues('field-weather')).toEqual([
      'none', 'sun', 'rain', 'sand', 'snow', 'harshSun', 'heavyRain', 'strongWinds',
    ]);
  });

  it('keeps an already-set primal weather selectable in Champions so the select matches state', () => {
    const { optionValues } = setup('champions', { ...baseField(), weather: 'heavyRain' });
    expect(optionValues('field-weather')).toEqual(['none', 'sun', 'rain', 'sand', 'snow', 'heavyRain']);
  });

  it('offers all five terrains in both games', () => {
    for (const game of ['champions', 'gen9'] as const) {
      expect(setup(game).optionValues('field-terrain')).toEqual(['none', 'electric', 'grassy', 'misty', 'psychic']);
    }
  });
});

describe('FieldInput onChange', () => {
  it('switches between singles and doubles', () => {
    expect(setup('champions').fire('field-format-singles').isDoubles).toBe(false);
    const singles = { ...baseField(), isDoubles: false };
    expect(setup('champions', singles).fire('field-format-doubles').isDoubles).toBe(true);
  });

  it('sets weather and terrain without touching other fields', () => {
    const start = baseField();
    expect(setup('gen9', start).fire('field-weather', { value: 'harshSun' })).toEqual({ ...start, weather: 'harshSun' });
    expect(setup('champions', start).fire('field-terrain', { value: 'psychic' })).toEqual({ ...start, terrain: 'psychic' });
  });

  it.each(['isGravity', 'isWonderRoom', 'isMagicRoom'] as const)('toggles %s', (key) => {
    const next = setup('champions').fire(`field-${key}`, { checked: true });
    expect(next).toEqual({ ...baseField(), [key]: true });
  });

  it.each(['isBeadsOfRuin', 'isSwordOfRuin', 'isTabletsOfRuin', 'isVesselOfRuin'] as const)(
    'toggles %s in Gen 9',
    (key) => {
      const next = setup('gen9').fire(`field-${key}`, { checked: true });
      expect(next).toEqual({ ...baseField(), [key]: true });
    },
  );

  const sideToggles = [
    'reflect', 'lightScreen', 'auroraVeil', 'tailwind', 'helpingHand', 'friendGuard',
    'battery', 'powerSpot', 'steelySpirit', 'stealthRock',
  ] as const;

  for (const sideKey of ['attackerSide', 'defenderSide'] as const) {
    const other = sideKey === 'attackerSide' ? 'defenderSide' : 'attackerSide';

    it.each(sideToggles)(`toggles %s on ${sideKey} only`, (key) => {
      const next = setup('champions').fire(`field-${sideKey}-${key}`, { checked: true });
      expect(next[sideKey]).toEqual({ ...emptySide(), [key]: true });
      expect(next[other]).toEqual(emptySide());
    });

    it(`sets spikes layers on ${sideKey} as a number`, () => {
      const { fire, optionValues } = setup('champions');
      expect(optionValues(`field-${sideKey}-spikes`)).toEqual([0, 1, 2, 3]);
      const next = fire(`field-${sideKey}-spikes`, { value: '3' });
      expect(next[sideKey].spikes).toBe(3);
      expect(next[other].spikes).toBe(0);
    });
  }

  it('does not mutate the field it was given', () => {
    const start = baseField();
    const snapshot = structuredClone(start);
    setup('gen9', start).fire('field-attackerSide-reflect', { checked: true });
    expect(start).toEqual(snapshot);
  });
});

describe('FieldInput rendering', () => {
  it('renders through React with the controlled values reflected', () => {
    const field: FieldState = {
      ...baseField(),
      isGravity: true,
      defenderSide: { ...emptySide(), auroraVeil: true, spikes: 2 },
    };
    const html = renderToStaticMarkup(<FieldInput field={field} game="champions" onChange={() => {}} isTrickRoom={false} onTrickRoomChange={() => {}} />);
    expect(html).toContain('Aurora Veil');
    expect(html).not.toContain('Ruin');
    expect(html).not.toContain('Harsh Sun');
    expect(html).toMatch(/id="field-isGravity"[^>]*checked=""/);
    expect(html).toMatch(/id="field-defenderSide-auroraVeil"[^>]*checked=""/);
    expect(html).toMatch(/<option value="2" selected="">2 layers<\/option>/);
  });

  it('names the side panels from sideLabels, defaulting to attacker and defender', () => {
    const plain = renderToStaticMarkup(<FieldInput field={baseField()} game="champions" onChange={() => {}} isTrickRoom={false} onTrickRoomChange={() => {}} />);
    expect(plain).toContain('<legend>Attacker side</legend>');
    expect(plain).toContain('<legend>Defender side</legend>');
    const named = renderToStaticMarkup(
      <FieldInput
        field={baseField()}
        game="champions"
        onChange={() => {}}
        isTrickRoom={false}
        onTrickRoomChange={() => {}}
        sideLabels={{ attackerSide: 'Left side', defenderSide: 'Right side' }}
      />,
    );
    expect(named).toContain('<legend>Left side</legend>');
    expect(named).toContain('<legend>Right side</legend>');
    expect(named).not.toContain('Attacker side');
  });
});
