import type { DamageResult } from '@vgc/types';
import './ResultDisplay.css';

// Percent of max HP, floored to one decimal, the way Showdown's calc shows it
// (87.54% displays as 87.5%, never rounded up to 87.6%).
function percentOf(damage: number, maxHp: number): number {
  return Math.floor((damage * 1000) / maxHp) / 10;
}

function koLabel(hits: number): string {
  return hits === 1 ? 'OHKO' : `${hits}HKO`;
}

// Single-hit rolls only: no residual damage, items or multi-turn effects.
// Hits needed is counted by repeating the same roll, so the best case is the
// max roll and the worst case is the min roll. If both need the same number of
// hits, every roll reaches it ("guaranteed"); otherwise only high rolls do.
function koDescription(rolls: readonly number[], maxHp: number): string {
  const minRoll = Math.min(...rolls);
  const maxRoll = Math.max(...rolls);
  if (maxRoll <= 0 || maxHp <= 0) return 'no damage';

  const bestCase = Math.ceil(maxHp / maxRoll);
  const worstCase = minRoll > 0 ? Math.ceil(maxHp / minRoll) : Infinity;
  return bestCase === worstCase ? `guaranteed ${koLabel(bestCase)}` : `possible ${koLabel(bestCase)}`;
}

export interface ResultDisplayProps {
  result: DamageResult;
}

export function ResultDisplay({ result }: ResultDisplayProps) {
  const { rolls, defenderMaxHp } = result;
  const minPercent = percentOf(Math.min(...rolls), defenderMaxHp).toFixed(1);
  const maxPercent = percentOf(Math.max(...rolls), defenderMaxHp).toFixed(1);
  const summary = `${minPercent}% - ${maxPercent}% (${koDescription(rolls, defenderMaxHp)})`;

  return (
    <section className="result-display">
      <p className="result-display__summary">{summary}</p>
      <dl className="result-display__facts">
        <div>
          <dt>Damage</dt>
          <dd>
            {minPercent}% to {maxPercent}%
          </dd>
        </div>
        <div>
          <dt>Defender max HP</dt>
          <dd>{defenderMaxHp}</dd>
        </div>
      </dl>
      <ol className="result-display__rolls" aria-label="Damage rolls">
        {rolls.map((roll, i) => (
          <li key={i}>{roll}</li>
        ))}
      </ol>
    </section>
  );
}
