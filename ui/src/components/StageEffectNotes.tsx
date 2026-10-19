import type { StageEffect } from '../appState';
import { BOOST_STATS, STAT_LABELS, type BoostStat } from './pokemonInputModel';
import './StageEffectNotes.css';

export interface StageEffectNotesProps {
  /** Effects on one Pokemon. */
  effects: readonly StageEffect[];
  /** true: stop applying the change to these stats; false: apply it again. */
  onSetManual: (stats: BoostStat[], manual: boolean) => void;
}

const formatStage = (n: number): string => (n > 0 ? `+${n}` : `−${-n}`);

/** "Atk −1, SpA +2" for the stats an effect changes. */
export function describeChanges(effect: StageEffect): string {
  return BOOST_STATS.filter((stat) => (effect.changes[stat] ?? 0) !== 0)
    .map((stat) => `${STAT_LABELS[stat]} ${formatStage(effect.changes[stat] ?? 0)}`)
    .join(', ');
}

/** One line per effect, e.g. "Incineroar's Intimidate: Atk −1". */
export function describeEffect(effect: StageEffect): string {
  const changes = describeChanges(effect);
  if (changes === '') {
    if (effect.cause === 'Mirror Armor') return `${effect.source}: bounced back by Mirror Armor`;
    if (effect.cause !== null) return `${effect.source}: blocked by ${effect.cause}`;
    return `${effect.source}: no effect, stage already at its limit`;
  }
  return effect.cause === null ? `${effect.source}: ${changes}` : `${effect.source}: ${changes} (${effect.cause})`;
}

/**
 * Shows the automatic stage changes on one Pokemon (Intimidate and what its
 * target's ability or item did with it), so a changed number has a visible
 * reason. Each applied change can be ignored, which marks its stats as set by
 * hand; an ignored change can be applied again.
 */
export function StageEffectNotes({ effects, onSetManual }: StageEffectNotesProps) {
  if (effects.length === 0) return null;
  return (
    <ul className="sen" aria-label="Automatic stat stage changes">
      {effects.map((effect, i) => {
        const stats = BOOST_STATS.filter((stat) => (effect.changes[stat] ?? 0) !== 0);
        const ignored = effect.overridden.length > 0;
        return (
          <li key={i} className={ignored ? 'sen-item sen-ignored' : 'sen-item'}>
            <span className="sen-text">
              {describeEffect(effect)}
              {ignored && <span className="sen-status"> · not applied, stage set by hand</span>}
            </span>
            {stats.length > 0 &&
              (ignored ? (
                <button type="button" className="sen-button" onClick={() => onSetManual(effect.overridden, false)}>
                  Apply
                </button>
              ) : (
                <button type="button" className="sen-button" onClick={() => onSetManual(stats, true)}>
                  Ignore
                </button>
              ))}
          </li>
        );
      })}
    </ul>
  );
}
