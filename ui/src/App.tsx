import { useEffect, useId, useMemo, useState } from 'react';
import type { DamageContext, FieldState, Game, Move, Pokemon } from '../../src/types';
import { FieldInput } from './components/FieldInput';
import { MoveInput } from './components/MoveInput';
import { PokemonInput } from './components/PokemonInput';
import { ResultDisplay } from './components/ResultDisplay';
import { StageEffectNotes } from './components/StageEffectNotes';
import type { BoostStat } from './components/pokemonInputModel';
import {
  changedStats,
  editPokemon,
  effectivePokemon,
  forwardContext,
  initialState,
  isSpread,
  matchupLabel,
  reverseContext,
  runCalc,
  setManualStages,
  stageEffects,
  switchGame,
  type CalcOutcome,
  type CalcState,
  type Slot,
  type StageEffect,
} from './appState';
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

  // Both directions recalculate on every state change; there is no submit step.
  const forward = useMemo(() => forwardContext(state), [state]);
  const reverse = useMemo(() => reverseContext(state), [state]);
  const forwardOutcome = useMemo(() => runCalc(forward), [forward]);
  const reverseOutcome = useMemo(() => runCalc(reverse), [reverse]);

  // The inputs show each Pokemon with Intimidate's stage changes applied;
  // editPokemon separates the user's own edits back out.
  const effects = useMemo(() => stageEffects(state), [state]);
  const shownAttacker = useMemo(() => effectivePokemon(state, 'attacker'), [state]);
  const shownDefender = useMemo(() => effectivePokemon(state, 'defender'), [state]);

  const setPokemon = (slot: Slot) => (pokemon: Pokemon) => setState((s) => editPokemon(s, slot, pokemon));
  const setManual = (slot: Slot) => (stats: BoostStat[], manual: boolean) =>
    setState((s) => setManualStages(s, slot, stats, manual));
  const setMove = (move: Move) => setState((s) => ({ ...s, move }));
  const setReverseMove = (reverseMove: Move) => setState((s) => ({ ...s, reverseMove }));
  const setCritical = (isCritical: boolean) => setState((s) => ({ ...s, isCritical }));
  const setReverseCritical = (reverseIsCritical: boolean) => setState((s) => ({ ...s, reverseIsCritical }));
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
          <PokemonInput
            label="Attacker"
            game={state.game}
            pokemon={shownAttacker}
            autoStages={autoStageReasons(effects, 'attacker')}
            onChange={setPokemon('attacker')}
          />
          <StageEffectNotes effects={effects.filter((e) => e.slot === 'attacker')} onSetManual={setManual('attacker')} />
        </div>

        <div className="app-center">
          <Direction
            label="Attacker's move into defender"
            ctx={forward}
            outcome={forwardOutcome}
            onMoveChange={setMove}
            onCriticalChange={setCritical}
          />
          <Direction
            label="Defender's move into attacker"
            ctx={reverse}
            outcome={reverseOutcome}
            onMoveChange={setReverseMove}
            onCriticalChange={setReverseCritical}
          />
        </div>

        <div className="app-side">
          <PokemonInput
            label="Defender"
            game={state.game}
            pokemon={shownDefender}
            autoStages={autoStageReasons(effects, 'defender')}
            onChange={setPokemon('defender')}
          />
          <StageEffectNotes effects={effects.filter((e) => e.slot === 'defender')} onSetManual={setManual('defender')} />
        </div>
      </main>

      <footer className="app-field">
        <FieldInput game={state.game} field={state.field} onChange={setField} />
      </footer>
    </div>
  );
}

// Stat -> cause, for the stats on one Pokemon that an applied effect changed.
function autoStageReasons(effects: readonly StageEffect[], slot: Slot): Partial<Record<BoostStat, string>> {
  const reasons: Partial<Record<BoostStat, string>> = {};
  for (const effect of effects) {
    if (effect.slot !== slot) continue;
    for (const stat of changedStats(effect.changes)) {
      if (effect.overridden.includes(stat)) continue;
      reasons[stat] = reasons[stat] ? `${reasons[stat]} and ${effect.source}` : effect.source;
    }
  }
  return reasons;
}

interface DirectionProps {
  label: string;
  ctx: DamageContext;
  outcome: CalcOutcome;
  onMoveChange: (move: Move) => void;
  onCriticalChange: (isCritical: boolean) => void;
}

// One direction of the matchup: the attacking Pokemon's move picker (limited
// to its own learnset), the crit toggle, and the result of that hit.
function Direction({ label, ctx, outcome, onMoveChange, onCriticalChange }: DirectionProps) {
  const species = ctx.attacker.species;
  return (
    <section className="app-direction" aria-label={label}>
      <div className="app-matchup">
        <p className="app-matchup-text">
          {matchupLabel(ctx)}
          {isSpread(ctx) && <span className="app-tag">spread</span>}
          {ctx.isCritical && <span className="app-tag">crit</span>}
        </p>
        <label className="app-check">
          <input
            type="checkbox"
            checked={ctx.isCritical}
            onChange={(e) => onCriticalChange(e.currentTarget.checked)}
          />
          Crit
        </label>
      </div>
      <MoveInput
        game={ctx.game}
        species={species}
        move={ctx.move}
        label={species === '' ? 'Move' : `${species}'s move`}
        onChange={onMoveChange}
      />
      <div className="app-result" aria-live="polite">
        {outcome.ok ? (
          <ResultDisplay result={outcome.result} />
        ) : (
          <p className="app-error" role="alert">
            Can't calculate: {outcome.error}
          </p>
        )}
      </div>
    </section>
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
