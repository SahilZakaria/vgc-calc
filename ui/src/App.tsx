import { useEffect, useId, useMemo, useState } from 'react';
import type { FieldState, Game, Move, Pokemon } from '../../src/types';
import { FieldInput } from './components/FieldInput';
import { MoveInput } from './components/MoveInput';
import { PokemonInput } from './components/PokemonInput';
import { ResultDisplay } from './components/ResultDisplay';
import { initialState, isSpread, matchupLabel, runCalc, switchGame, type CalcState } from './appState';
import {
  applyThemePreference,
  browserStorage,
  loadThemePreference,
  saveThemePreference,
  type ThemePreference,
} from './theme';
import './App.css';

const GAME_OPTIONS: readonly { value: Game; label: string }[] = [
  { value: 'champions', label: 'Champions' },
  { value: 'gen9', label: 'Scarlet/Violet' },
];

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
];

export function App() {
  const [state, setState] = useState<CalcState>(initialState);
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference(browserStorage()));

  useEffect(() => {
    applyThemePreference(document.documentElement, theme);
    saveThemePreference(browserStorage(), theme);
  }, [theme]);

  // Recalculates on every state change; there is no submit step.
  const outcome = useMemo(() => runCalc(state), [state]);

  const setAttacker = (attacker: Pokemon) => setState((s) => ({ ...s, attacker }));
  const setDefender = (defender: Pokemon) => setState((s) => ({ ...s, defender }));
  const setMove = (move: Move) => setState((s) => ({ ...s, move }));
  const setField = (field: FieldState) => setState((s) => ({ ...s, field }));
  const setGame = (game: Game) => setState((s) => switchGame(s, game));

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">VGC Calc</h1>
        <Segmented label="Game" value={state.game} options={GAME_OPTIONS} onChange={setGame} />
        <Segmented label="Theme" value={theme} options={THEME_OPTIONS} onChange={setTheme} />
      </header>

      <main className="app-main">
        <div className="app-side">
          <PokemonInput label="Attacker" game={state.game} pokemon={state.attacker} onChange={setAttacker} />
        </div>

        <div className="app-center">
          <section className="app-result" aria-live="polite" aria-label="Result">
            <p className="app-matchup">
              {matchupLabel(state)}
              {isSpread(state) && <span className="app-tag">spread</span>}
              {state.isCritical && <span className="app-tag">crit</span>}
            </p>
            {outcome.ok ? (
              <ResultDisplay result={outcome.result} />
            ) : (
              <p className="app-error" role="alert">
                Can't calculate: {outcome.error}
              </p>
            )}
          </section>

          <div className="app-move">
            <MoveInput game={state.game} move={state.move} onChange={setMove} />
            <label className="app-check">
              <input
                type="checkbox"
                checked={state.isCritical}
                onChange={(e) => {
                  const isCritical = e.currentTarget.checked;
                  setState((s) => ({ ...s, isCritical }));
                }}
              />
              Critical hit
            </label>
          </div>
        </div>

        <div className="app-side">
          <PokemonInput label="Defender" game={state.game} pokemon={state.defender} onChange={setDefender} />
        </div>
      </main>

      <footer className="app-field">
        <FieldInput game={state.game} field={state.field} onChange={setField} />
      </footer>
    </div>
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

// A row of radio buttons styled as one control.
function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  const name = useId();
  const labelId = `${name}-label`;
  return (
    <div className="segmented">
      <span id={labelId} className="segmented-label">
        {label}
      </span>
      <div className="segmented-options" role="radiogroup" aria-labelledby={labelId}>
        {options.map((option) => (
          <label key={option.value} className="segmented-option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
