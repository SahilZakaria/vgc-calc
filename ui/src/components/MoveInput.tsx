import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { Game, Move, MoveFlags, MoveTarget } from '@vgc/types';
import { cachedLearnset, loadLearnset } from './legalData';
import { findMove, moveId, searchMoves } from './moveData';
import './MoveInput.css';

interface MoveInputProps {
  move: Move;
  onChange: (move: Move) => void;
  game: Game;
  /** The attacking species. Only moves in its learnset for `game` are offered. */
  species: string;
  label?: string;
}

type Learnset =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'none' }
  | { status: 'ready'; moves: ReadonlySet<string> };

// The species' learnset from legalData. Gen 9 learnsets load on demand, so
// the first render for a species may be 'loading'.
function useLearnset(game: Game, species: string): Learnset {
  const [, setVersion] = useState(0);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const key = `${game}:${species}`;
  const cached = species === '' ? null : cachedLearnset(game, species);

  useEffect(() => {
    if (species === '' || cachedLearnset(game, species) !== undefined) return;
    let live = true;
    loadLearnset(game, species).then(
      () => live && setVersion((v) => v + 1),
      () => live && setFailedKey(key),
    );
    return () => {
      live = false;
    };
  }, [game, species, key]);

  if (cached === null) return { status: 'none' };
  if (cached !== undefined) return { status: 'ready', moves: cached };
  return failedKey === key ? { status: 'failed' } : { status: 'loading' };
}

const MAX_RESULTS = 50;

const GAME_LABEL: Record<Game, string> = {
  champions: 'Champions',
  gen9: 'Scarlet/Violet',
};

const TARGET_LABEL: Record<MoveTarget, string> = {
  single: 'Single target',
  allAdjacentFoes: 'All adjacent foes',
  allAdjacent: 'All adjacent',
  self: 'Self',
};

const FLAG_LABEL: Record<keyof MoveFlags, string> = {
  contact: 'Contact',
  punch: 'Punch',
  sound: 'Sound',
  slicing: 'Slicing',
  bite: 'Bite',
  bullet: 'Bullet',
  wind: 'Wind',
  pulse: 'Pulse',
};

const FLAG_KEYS = Object.keys(FLAG_LABEL) as (keyof MoveFlags)[];

function formatPriority(priority: number): string {
  return priority > 0 ? `+${priority}` : String(priority);
}

export function MoveInput({ move, onChange, game, species, label = 'Move' }: MoveInputProps) {
  const baseId = useId();
  const inputId = `${baseId}-input`;
  const listId = `${baseId}-list`;

  // null while the user is not typing: the box then shows the selected name.
  const [query, setQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [overrideBp, setOverrideBp] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);

  const learnset = useLearnset(game, species);
  const allowed = learnset.status === 'ready' ? learnset.moves : null;

  const isOpen = query !== null;
  const results = useMemo(
    () => (query === null || allowed === null ? [] : searchMoves(game, query, MAX_RESULTS, allowed)),
    [game, query, allowed],
  );

  const dataMove = move.name === '' ? undefined : findMove(game, move.name);
  const missingFromGame = move.name !== '' && dataMove === undefined;
  const notLearnable =
    !missingFromGame && move.name !== '' && allowed !== null && !allowed.has(moveId(move.name));
  const speciesLabel = species === '' ? 'this Pokemon' : species;
  let emptyMessage = 'No matching moves';
  if (learnset.status === 'loading') emptyMessage = `Loading ${speciesLabel}'s learnset…`;
  else if (learnset.status === 'failed') emptyMessage = `Couldn't load ${speciesLabel}'s learnset.`;
  else if (learnset.status === 'none') emptyMessage = `No ${GAME_LABEL[game]} learnset data for ${speciesLabel}.`;
  const powerVaries =
    move.variablePower !== 'none' || (move.category !== 'Status' && dataMove?.basePower === 0);

  function select(next: Move) {
    setQuery(null);
    setOverrideBp(false);
    onChange(next);
  }

  function close() {
    setQuery(null);
  }

  function moveActive(delta: number) {
    if (results.length === 0) return;
    const next = (activeIndex + delta + results.length) % results.length;
    setActiveIndex(next);
    listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!isOpen) {
          setQuery('');
          setActiveIndex(0);
        } else {
          moveActive(1);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Enter': {
        const choice = results[activeIndex];
        if (isOpen && choice) {
          event.preventDefault();
          select(choice);
        }
        break;
      }
      case 'Escape':
        if (isOpen) {
          event.preventDefault();
          close();
        }
        break;
    }
  }

  function toggleOverride(on: boolean) {
    setOverrideBp(on);
    // Turning the override off goes back to the game data's power.
    if (!on && dataMove && move.basePower !== dataMove.basePower) {
      onChange({ ...move, basePower: dataMove.basePower });
    }
  }

  function onBasePowerChange(text: string) {
    const value = Number(text);
    if (text === '' || !Number.isFinite(value)) return;
    onChange({ ...move, basePower: Math.max(0, Math.round(value)) });
  }

  const activeOption = isOpen ? results[activeIndex] : undefined;
  const setFlags = FLAG_KEYS.filter((key) => move.flags[key]);

  return (
    <div className="move-input">
      <label className="move-input__label" htmlFor={inputId}>
        {label}
      </label>
      <div className="move-input__combo">
        <input
          id={inputId}
          className="move-input__search"
          type="text"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={species === '' ? `Search ${GAME_LABEL[game]} moves` : `Search ${species}'s moves`}
          value={query ?? move.name}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onFocus={(event) => {
            setQuery('');
            setActiveIndex(0);
            event.target.select();
          }}
          onBlur={close}
          onKeyDown={onKeyDown}
        />
        {isOpen && (
          <ul id={listId} ref={listRef} className="move-input__list" role="listbox">
            {results.length === 0 ? (
              <li className="move-input__empty">{emptyMessage}</li>
            ) : (
              results.map((option, index) => (
                <li
                  key={option.name}
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  className={
                    index === activeIndex
                      ? 'move-input__option move-input__option--active'
                      : 'move-input__option'
                  }
                  // mousedown, not click: click would fire after the input's blur closed the list.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    select(option);
                  }}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span className="move-input__option-name">{option.name}</span>
                  <span className="move-input__option-meta">
                    {option.type} · {option.category}
                    {option.category !== 'Status' ? ` · ${option.basePower}` : ''}
                  </span>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {missingFromGame && (
        <p className="move-input__note move-input__note--warn">
          {move.name} is not in the {GAME_LABEL[game]} move data.
        </p>
      )}

      {notLearnable && (
        <p className="move-input__note move-input__note--warn">
          {species} can't learn {move.name} in {GAME_LABEL[game]}.
        </p>
      )}

      {learnset.status === 'none' && (
        <p className="move-input__note move-input__note--warn">
          No {GAME_LABEL[game]} learnset data for {speciesLabel}, so no moves can be picked.
        </p>
      )}

      {move.name !== '' && (
        <dl className="move-input__details">
          <div className="move-input__field">
            <dt>Type</dt>
            <dd>{move.type}</dd>
          </div>
          <div className="move-input__field">
            <dt>Category</dt>
            <dd>{move.category}</dd>
          </div>
          <div className="move-input__field move-input__field--power">
            <dt>
              <label htmlFor={`${baseId}-bp`}>Base power</label>
            </dt>
            <dd>
              {overrideBp ? (
                <input
                  id={`${baseId}-bp`}
                  className="move-input__bp"
                  type="number"
                  min={0}
                  step={1}
                  value={move.basePower}
                  onChange={(event) => onBasePowerChange(event.target.value)}
                />
              ) : (
                <span>{move.basePower}</span>
              )}
              <label className="move-input__override">
                <input
                  type="checkbox"
                  checked={overrideBp}
                  onChange={(event) => toggleOverride(event.target.checked)}
                />
                Override
              </label>
            </dd>
          </div>
          <div className="move-input__field">
            <dt>Target</dt>
            <dd>{TARGET_LABEL[move.target]}</dd>
          </div>
          <div className="move-input__field">
            <dt>Priority</dt>
            <dd>{formatPriority(move.priority)}</dd>
          </div>
          <div className="move-input__field">
            <dt>Hits</dt>
            <dd>{move.hits}</dd>
          </div>
          <div className="move-input__field move-input__field--flags">
            <dt>Flags</dt>
            <dd>
              {setFlags.length === 0 ? (
                <span className="move-input__muted">None</span>
              ) : (
                <ul className="move-input__flags">
                  {setFlags.map((key) => (
                    <li key={key} className="move-input__flag">
                      {FLAG_LABEL[key]}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>
      )}

      {powerVaries && !overrideBp && (
        <p className="move-input__note">
          This move's power depends on the battle state. Turn on Override to set it.
        </p>
      )}
    </div>
  );
}
