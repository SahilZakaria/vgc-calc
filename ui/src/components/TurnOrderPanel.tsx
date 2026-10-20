import { useState } from 'react';
import {
  formatTurnOrder,
  placeText,
  placementReason,
  TRICK_ROOM_NOTE,
  type TurnOrder,
} from '../../../src/calc/turn-order';
import './TurnOrderPanel.css';

export interface TurnOrderPanelProps {
  order: TurnOrder;
  /** Display name per entry id, e.g. "Garchomp". */
  names: Readonly<Record<string, string>>;
  /** Short position label per entry id, e.g. "Left 1". */
  slotLabels: Readonly<Record<string, string>>;
}

/**
 * The order this turn's moves resolve, one cell per Pokemon, each with the
 * reason for its place. Speed ties are shown as a coin flip: the tied moves
 * share a place range ("2-3") and carry a "coin flip" tag instead of being
 * silently ordered.
 */
export function TurnOrderPanel({ order, names, slotLabels }: TurnOrderPanelProps) {
  const [copied, setCopied] = useState(false);
  const nameOf = (id: string) => names[id] ?? id;
  const text = formatTurnOrder(order, nameOf);

  const copy = () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) return;
    clipboard.writeText(text).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => undefined,
    );
  };

  return (
    <section className="to" aria-label="Turn order">
      <h2 className="to-title">
        Turn order
        {order.isTrickRoom && <span className="to-room">Trick Room: {TRICK_ROOM_NOTE}</span>}
      </h2>
      <ol className="to-list">
        {order.moves.map((move) => {
          const id = move.entry.id;
          const tied = move.tiedWith.length > 0;
          return (
            <li
              key={id}
              className={tied ? 'to-item to-item-tie' : 'to-item'}
              value={move.first}
              data-entry={id}
              title={slotLabels[id]}
            >
              <span className="to-place" aria-hidden="true">
                {placeText(move)}
              </span>
              <span className="to-body">
                <span className="to-line">
                  <span className="to-name">{nameOf(id)}</span>
                  <span className="to-move">{move.entry.move.name || 'no move'}</span>
                  {tied && <span className="to-tag">coin flip</span>}
                </span>
                <span className="to-reason">{placementReason(order, move, nameOf)}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <button type="button" className="to-copy" onClick={copy} title="Copy the turn order as text">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </section>
  );
}
