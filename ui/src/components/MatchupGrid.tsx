import { useId } from 'react';
import { isSpread, matchupLabel, type Matchup, type Slot } from '../appState';
import { damageSummary, ResultDisplay } from './ResultDisplay';
import './MatchupGrid.css';

export interface MatchupGridProps {
  /** Caption, e.g. "Left side attacking". */
  label: string;
  /** Every hit from one side: attackers are rows, defenders are columns. */
  matchups: readonly Matchup[];
  /** The matchup whose rolls are shown, as matchupKey(), or null. */
  expanded: string | null;
  onToggle: (key: string) => void;
}

export const matchupKey = (m: Pick<Matchup, 'attacker' | 'defender'>): string => `${m.attacker}>${m.defender}`;

function unique(slots: readonly Slot[]): Slot[] {
  return slots.filter((slot, i) => slots.indexOf(slot) === i);
}

/**
 * Compact table of one side's hits on the other: each cell is one attacker's
 * move into one defender, showing only the percent range and the KO line.
 * Clicking a cell shows that hit's full result, with all 16 rolls, under the
 * table; clicking it again hides it.
 */
export function MatchupGrid({ label, matchups, expanded, onToggle }: MatchupGridProps) {
  const id = useId();
  const attackers = unique(matchups.map((m) => m.attacker));
  const defenders = unique(matchups.map((m) => m.defender));
  const find = (attacker: Slot, defender: Slot) =>
    matchups.find((m) => m.attacker === attacker && m.defender === defender);
  const open = matchups.find((m) => matchupKey(m) === expanded);
  const detailId = `${id}-detail`;

  if (matchups.length === 0) return null;

  return (
    <section className="mg" aria-label={label}>
      <table className="mg-table">
        <caption className="mg-caption">{label}</caption>
        <thead>
          <tr>
            <th scope="col" className="mg-corner">
              <span className="mg-visually-hidden">Attacker</span>
            </th>
            {defenders.map((d) => {
              const m = matchups.find((x) => x.defender === d);
              return (
                <th key={d} scope="col" className="mg-defender">
                  {m?.ctx.defender.species || 'defender'}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {attackers.map((a) => {
            const row = matchups.find((x) => x.attacker === a);
            if (!row) return null;
            return (
              <tr key={a}>
                <th scope="row" className="mg-attacker">
                  <span className="mg-attacker-name">{row.ctx.attacker.species || 'Attacker'}</span>
                  <span className="mg-move">
                    {row.ctx.move.name || 'no move'}
                    {isSpread(row.ctx) && <span className="mg-tag">spread</span>}
                    {row.ctx.isCritical && <span className="mg-tag">crit</span>}
                  </span>
                </th>
                {defenders.map((d) => {
                  const m = find(a, d);
                  if (!m) return <td key={d} />;
                  const key = matchupKey(m);
                  const isOpen = key === expanded;
                  return (
                    <td key={d} className="mg-cell-wrap">
                      <button
                        type="button"
                        className={isOpen ? 'mg-cell mg-cell-open' : 'mg-cell'}
                        aria-expanded={isOpen}
                        aria-controls={isOpen ? detailId : undefined}
                        aria-label={`${matchupLabel(m.ctx)}: ${cellText(m)}`}
                        title={isOpen ? 'Hide rolls' : 'Show all 16 rolls'}
                        onClick={() => onToggle(key)}
                      >
                        <CellBody matchup={m} />
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>

      {open && (
        <div id={detailId} className="mg-detail" aria-live="polite">
          <p className="mg-detail-title">
            {matchupLabel(open.ctx)}
            {isSpread(open.ctx) && <span className="mg-tag">spread 0.75x</span>}
            {open.ctx.isCritical && <span className="mg-tag">crit</span>}
          </p>
          {open.outcome.ok ? (
            <ResultDisplay result={open.outcome.result} />
          ) : (
            <p className="mg-error" role="alert">
              Can't calculate: {open.outcome.error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function cellText(m: Matchup): string {
  if (!m.outcome.ok) return `can't calculate (${m.outcome.error})`;
  const s = damageSummary(m.outcome.result);
  return `${s.minPercent}% - ${s.maxPercent}%, ${s.ko}`;
}

function CellBody({ matchup }: { matchup: Matchup }) {
  if (!matchup.outcome.ok) {
    return (
      <>
        <span className="mg-range mg-range-error">—</span>
        <span className="mg-ko">can't calculate</span>
      </>
    );
  }
  const s = damageSummary(matchup.outcome.result);
  return (
    <>
      <span className="mg-range">
        {s.minPercent} – {s.maxPercent}%
      </span>
      <span className="mg-ko">{s.ko}</span>
    </>
  );
}
