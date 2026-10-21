import {
  sourceText,
  TERRAIN_NAMES,
  WEATHER_NAMES,
  winnerReason,
  type FieldKind,
} from '../../../src/calc/field-abilities';
import type { Terrain, Weather } from '../../../src/types';
import type { FieldEffect, SwitchInField } from '../appState';
import type { FieldSourceBadge } from './FieldInput';
import './FieldEffectNotes.css';

export interface FieldEffectNotesProps {
  info: SwitchInField;
  /** Display name per slot, e.g. "Pelipper". */
  names: Readonly<Record<string, string>>;
  /** true: use the dropdown over the ability; false: use the ability again. */
  onSetIgnored: (kind: FieldKind, ignored: boolean) => void;
}

const KIND_LABELS: Readonly<Record<FieldKind, string>> = { weather: 'Weather', terrain: 'Terrain' };

function valueName(kind: FieldKind, value: string): string {
  return kind === 'weather' ? WEATHER_NAMES[value as Weather] : TERRAIN_NAMES[value as Terrain];
}

/** One line describing a weather or terrain set by a switch-in ability. */
export function describeFieldEffect<T extends string>(
  kind: FieldKind,
  effect: FieldEffect<T>,
  nameOf: (id: string) => string,
): { headline: string; detail: string | null } | null {
  const { abilities } = effect;
  const winner = abilities.winner;
  if (!winner) return null;
  const source = `${nameOf(winner.id)}'s ${winner.ability}`;
  if (effect.ignored) {
    return {
      headline: `${KIND_LABELS[kind]}: ${valueName(kind, effect.value)}, set by hand`,
      detail: `${source} (${valueName(kind, winner.value)}) is ignored.`,
    };
  }
  return {
    headline: `${KIND_LABELS[kind]}: ${sourceText(abilities, nameOf) ?? ''}`,
    detail: winnerReason(abilities, nameOf),
  };
}

/** The badge FieldInput shows beside the select, or undefined when no ability sets it. */
export function fieldSourceBadge<T extends string>(
  kind: FieldKind,
  effect: FieldEffect<T>,
  nameOf: (id: string) => string,
): FieldSourceBadge | undefined {
  const winner = effect.abilities.winner;
  if (!winner) return undefined;
  const source = `${nameOf(winner.id)}'s ${winner.ability}`;
  return effect.ignored
    ? { text: 'by hand', kind: 'manual', title: `${KIND_LABELS[kind]} picked by hand; ${source} is ignored` }
    : { text: winner.ability, kind: 'ability', title: `Set by ${source}` };
}

/**
 * Weather and terrain set by switch-in abilities: which Pokemon set it, why
 * it beat any rival setter, and a button to ignore it in favor of the field
 * dropdown (or to use it again). Renders nothing when no ability sets either.
 */
export function FieldEffectNotes({ info, names, onSetIgnored }: FieldEffectNotesProps) {
  const nameOf = (id: string) => names[id] ?? id;
  const rows = (['weather', 'terrain'] as const).flatMap((kind) => {
    const effect: FieldEffect<string> = info[kind];
    const text = describeFieldEffect(kind, effect, nameOf);
    return text ? [{ kind, effect, ...text }] : [];
  });
  if (rows.length === 0) return null;

  return (
    <section className="fen" aria-label="Weather and terrain from abilities">
      <h2 className="fen-title">Switch-in field</h2>
      <ul className="fen-list">
        {rows.map(({ kind, effect, headline, detail }) => (
          <li key={kind} className={effect.ignored ? 'fen-item fen-ignored' : 'fen-item'} data-kind={kind}>
            <span className="fen-head">
              <span className="fen-headline">{headline}</span>
              <button
                type="button"
                className="fen-button"
                onClick={() => onSetIgnored(kind, !effect.ignored)}
                title={
                  effect.ignored
                    ? `Use the ${kind} the ability sets`
                    : `Ignore the ability and use the ${kind} picked in the field panel`
                }
              >
                {effect.ignored ? 'Use ability' : 'Ignore'}
              </button>
            </span>
            {detail && <span className="fen-detail">{detail}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
