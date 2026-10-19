import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import type { Game, Pokemon, StatName, TypeName } from '../../../src/types';
import {
  BOOST_STATS,
  GEN9_MAX_IV,
  GEN9_MAX_LEVEL,
  GEN9_MIN_LEVEL,
  MAX_BOOST,
  MIN_BOOST,
  STAT_LABELS,
  STAT_NAMES,
  STATUS_OPTIONS,
  TYPE_NAMES,
  applySpecies,
  filterOptions,
  finalStats,
  getGameData,
  normalizeForGame,
  setBoost,
  setIv,
  setLevel,
  setSpreadValue,
  spreadLimits,
  spreadValue,
  type BoostStat,
} from './pokemonInputModel';
import { legalAbilities } from './legalData';
import './PokemonInput.css';

const GAME_LABEL: Record<Game, string> = {
  champions: 'Champions',
  gen9: 'Scarlet/Violet',
};

export interface PokemonInputProps {
  pokemon: Pokemon;
  onChange: (pokemon: Pokemon) => void;
  game: Game;
  /** Heading shown above the fields, e.g. "Attacker". */
  label?: string;
}

const BOOST_VALUES: readonly number[] = Array.from(
  { length: MAX_BOOST - MIN_BOOST + 1 },
  (_, i) => MAX_BOOST - i,
);

const formatBoost = (n: number): string => (n > 0 ? `+${n}` : String(n));

const parseInput = (raw: string): number => (raw.trim() === '' ? 0 : Number(raw));

/**
 * Controlled editor for one Pokemon. Every change goes through `onChange`
 * with a whole new Pokemon; nothing is stored locally except search text.
 *
 * In Champions mode the spread inputs are Stat Points, stored on the Pokemon
 * as their EV equivalent (spToEv), and every emitted Pokemon is level 50 with
 * 31 IVs and Tera off. The component does not emit on its own when `game`
 * changes; the parent owns that conversion.
 */
export function PokemonInput({ pokemon, onChange, game, label }: PokemonInputProps) {
  const id = useId();
  const data = getGameData(game);
  const isChampions = game === 'champions';
  const shown = normalizeForGame(pokemon, game);
  const limits = spreadLimits(shown, game);
  const stats = finalStats(shown, game);
  const nature = data.natures.find((n) => n.name === shown.nature);
  const abilities = legalAbilities(game, shown.species);
  const abilityLegal = abilities.some((a) => a.name === shown.ability);

  const emit = (next: Pokemon) => onChange(normalizeForGame(next, game));

  const selectSpecies = (name: string | null) => {
    if (name === null) return;
    const next = applySpecies(shown, name, game);
    if (next) emit(next);
  };

  const natureMark = (stat: StatName): 'plus' | 'minus' | null => {
    if (!nature || stat === 'hp') return null;
    if (nature.plus === stat) return 'plus';
    if (nature.minus === stat) return 'minus';
    return null;
  };

  return (
    <section className="pki" aria-label={label ?? 'Pokemon'}>
      {label && <h2 className="pki-title">{label}</h2>}

      <div className="pki-grid">
        <SearchSelect
          label="Species"
          value={shown.species}
          options={data.species}
          onSelect={selectSpecies}
          className="pki-span-2"
        />

        <div className="pki-field">
          <span className="pki-label">Level</span>
          {isChampions ? (
            <span className="pki-fixed" aria-label="Level 50 (fixed in Champions)">
              50
            </span>
          ) : (
            <input
              id={`${id}-level`}
              className="pki-input pki-number"
              type="number"
              aria-label="Level"
              min={GEN9_MIN_LEVEL}
              max={GEN9_MAX_LEVEL}
              value={shown.level}
              onChange={(e) => emit(setLevel(shown, parseInput(e.target.value)))}
            />
          )}
        </div>

        <div className="pki-field pki-types" aria-label="Types">
          <span className="pki-label">Type</span>
          <span className="pki-type-list">
            {shown.types.map((t) => (
              <span key={t} className={`pki-type pki-type-${t.toLowerCase()}`}>
                {t}
              </span>
            ))}
          </span>
          <span className="pki-weight">{shown.weightKg} kg</span>
        </div>

        <label className="pki-field">
          <span className="pki-label">Nature</span>
          <select
            className="pki-input"
            value={shown.nature}
            onChange={(e) => emit({ ...shown, nature: e.target.value })}
          >
            {!nature && <option value={shown.nature}>{shown.nature || '—'}</option>}
            {data.natures.map((n) => (
              <option key={n.name} value={n.name}>
                {n.plus && n.minus ? `${n.name} (+${STAT_LABELS[n.plus]} −${STAT_LABELS[n.minus]})` : n.name}
              </option>
            ))}
          </select>
        </label>

        <label className="pki-field">
          <span className="pki-label">Ability</span>
          <select
            className="pki-input"
            value={shown.ability}
            onChange={(e) => emit({ ...shown, ability: e.target.value })}
          >
            {/* Keeps the select controlled when the current ability is not legal. */}
            {!abilityLegal && (
              <option value={shown.ability} disabled>
                {shown.ability ? `${shown.ability} (not legal)` : '—'}
              </option>
            )}
            {abilities.map((a) => (
              <option key={a.name} value={a.name}>
                {a.hidden ? `${a.name} (Hidden)` : a.name}
              </option>
            ))}
          </select>
          {!abilityLegal && shown.ability && (
            <span className="pki-warn" role="note">
              {abilities.length === 0
                ? `No ${GAME_LABEL[game]} ability data for ${shown.species}.`
                : `${shown.species} can't have ${shown.ability} in ${GAME_LABEL[game]}.`}
            </span>
          )}
        </label>

        <SearchSelect
          label="Item"
          value={shown.item}
          options={data.items}
          noneLabel="No item"
          onSelect={(item) => emit({ ...shown, item })}
          warning={
            shown.item !== null && !data.items.includes(shown.item)
              ? `${shown.item} is not an item in ${GAME_LABEL[game]}.`
              : undefined
          }
        />

        <label className="pki-field">
          <span className="pki-label">Status</span>
          <select
            className="pki-input"
            value={shown.status}
            onChange={(e) => {
              const status = STATUS_OPTIONS.find((s) => s.value === e.target.value)?.value;
              if (status) emit({ ...shown, status });
            }}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {!isChampions && (
          <div className="pki-field pki-tera">
            <label className="pki-label" htmlFor={`${id}-tera`}>
              Tera type
            </label>
            <div className="pki-tera-row">
              <select
                id={`${id}-tera`}
                className="pki-input"
                value={shown.teraType ?? ''}
                onChange={(e) => {
                  const teraType = TYPE_NAMES.find((t) => t === e.target.value);
                  emit({ ...shown, teraType, isTerastallized: teraType ? shown.isTerastallized : false });
                }}
              >
                <option value="">—</option>
                {TYPE_NAMES.map((t: TypeName) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <label className="pki-check">
                <input
                  type="checkbox"
                  checked={shown.isTerastallized}
                  disabled={shown.teraType === undefined}
                  onChange={(e) => emit({ ...shown, isTerastallized: e.target.checked })}
                />
                Terastallized
              </label>
            </div>
          </div>
        )}
      </div>

      <table className="pki-stats">
        <thead>
          <tr>
            <th scope="col">Stat</th>
            <th scope="col">Base</th>
            <th scope="col">{limits.unit === 'SP' ? 'SP' : 'EVs'}</th>
            {!isChampions && <th scope="col">IVs</th>}
            <th scope="col">Boost</th>
            <th scope="col">Total</th>
          </tr>
        </thead>
        <tbody>
          {STAT_NAMES.map((stat) => {
            const mark = natureMark(stat);
            return (
              <tr key={stat} className={mark ? `pki-nature-${mark}` : undefined}>
                <th scope="row">
                  {STAT_LABELS[stat]}
                  {mark === 'plus' && <span aria-label="raised by nature"> +</span>}
                  {mark === 'minus' && <span aria-label="lowered by nature"> −</span>}
                </th>
                <td className="pki-base">{shown.baseStats[stat]}</td>
                <td>
                  <input
                    className="pki-input pki-number"
                    type="number"
                    aria-label={`${STAT_LABELS[stat]} ${limits.unit}`}
                    min={0}
                    max={limits.perStat}
                    value={spreadValue(shown, game, stat)}
                    onChange={(e) => emit(setSpreadValue(shown, game, stat, parseInput(e.target.value)))}
                  />
                </td>
                {!isChampions && (
                  <td>
                    <input
                      className="pki-input pki-number"
                      type="number"
                      aria-label={`${STAT_LABELS[stat]} IVs`}
                      min={0}
                      max={GEN9_MAX_IV}
                      value={shown.ivs[stat]}
                      onChange={(e) => emit(setIv(shown, stat, parseInput(e.target.value)))}
                    />
                  </td>
                )}
                <td>
                  {stat === 'hp' ? null : (
                    <BoostSelect
                      stat={stat}
                      value={shown.statBoosts[stat]}
                      onChange={(n) => emit(setBoost(shown, stat, n))}
                    />
                  )}
                </td>
                <td className="pki-final" data-stat={stat}>
                  {stats ? stats[stat] : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={isChampions ? 5 : 6}>
              <span className={limits.used > limits.total ? 'pki-over' : undefined}>
                {limits.used} / {limits.total} {limits.unit}
              </span>
              {' · '}
              {limits.total - limits.used} left
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

function BoostSelect({
  stat,
  value,
  onChange,
}: {
  stat: BoostStat;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <select
      className={`pki-input pki-boost${value > 0 ? ' pki-boost-up' : value < 0 ? ' pki-boost-down' : ''}`}
      aria-label={`${STAT_LABELS[stat]} boost`}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {BOOST_VALUES.map((n) => (
        <option key={n} value={n}>
          {formatBoost(n)}
        </option>
      ))}
    </select>
  );
}

const MAX_RESULTS = 60;

interface SearchSelectProps {
  label: string;
  value: string | null;
  options: readonly string[];
  onSelect: (value: string | null) => void;
  /** When set, offers a first option that selects null. */
  noneLabel?: string;
  className?: string;
  /** Shown under the input, e.g. when the current value is not legal. */
  warning?: string;
}

// Text input that filters a long option list (combobox pattern). Typing only
// changes the local query; the value changes when an option is picked.
function SearchSelect({ label, value, options, onSelect, noneLabel, className, warning }: SearchSelectProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const open = query !== null;

  const choices = useMemo<(string | null)[]>(() => {
    if (!open) return [];
    const matches = filterOptions(options, query, MAX_RESULTS);
    return noneLabel !== undefined && query.trim() === '' ? [null, ...matches] : matches;
  }, [open, options, query, noneLabel]);

  const close = () => {
    setQuery(null);
    setActive(0);
  };

  const pick = (choice: string | null) => {
    onSelect(choice);
    close();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setQuery('');
      else setActive((i) => Math.min(i + 1, choices.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && choices.length > 0) {
        e.preventDefault();
        const choice = choices[Math.min(active, choices.length - 1)];
        if (choice !== undefined) pick(choice);
      }
    } else if (e.key === 'Escape') {
      close();
    }
  };

  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div className={`pki-field pki-search${className ? ` ${className}` : ''}`}>
      <label className="pki-label" htmlFor={`${id}-input`}>
        {label}
      </label>
      <input
        id={`${id}-input`}
        className="pki-input"
        type="text"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && choices.length > 0 ? optionId(active) : undefined}
        placeholder={value === null ? noneLabel : undefined}
        value={open ? query : (value ?? '')}
        onFocus={(e) => {
          setQuery('');
          setActive(0);
          e.currentTarget.select();
        }}
        // Picking an option keeps focus, so a later click has to reopen the list.
        onClick={() => {
          if (!open) {
            setQuery('');
            setActive(0);
          }
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onBlur={close}
        onKeyDown={onKeyDown}
      />
      {open && (
        <ul id={listId} className="pki-options" role="listbox" aria-label={label}>
          {choices.length === 0 && <li className="pki-empty">No matches</li>}
          {choices.map((choice, i) => (
            <li
              key={choice ?? '\u0000none'}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={`pki-option${i === active ? ' pki-active' : ''}${choice === value ? ' pki-current' : ''}`}
              // mousedown, not click, so the input's blur does not close the list first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(choice);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {choice ?? noneLabel}
            </li>
          ))}
        </ul>
      )}
      {warning && (
        <span className="pki-warn" role="note">
          {warning}
        </span>
      )}
    </div>
  );
}
