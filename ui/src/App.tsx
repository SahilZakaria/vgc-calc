import { useEffect, useId, useMemo, useState } from 'react';
import type { FieldState, Game, Move, Pokemon } from '../../src/types';
import { FieldInput } from './components/FieldInput';
import { MatchupGrid } from './components/MatchupGrid';
import { MoveInput } from './components/MoveInput';
import { PokemonInput } from './components/PokemonInput';
import { StageEffectNotes } from './components/StageEffectNotes';
import type { BoostStat } from './components/pokemonInputModel';
import {
  activeSlots,
  allMatchups,
  changedStats,
  editPokemon,
  effectiveField,
  initialState,
  setManualStages,
  stageEffects,
  switchGame,
  updateSlot,
  type CalcState,
  type Side,
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

const SLOT_LABELS: Readonly<Record<Slot, string>> = {
  left1: 'Left 1',
  left2: 'Left 2',
  right1: 'Right 1',
  right2: 'Right 2',
};

// On-screen order of each side's panels. The left side runs across the top and
// the right side across the bottom, mirrored the way a doubles board faces:
// Left 1 sits above Right 2 and Left 2 above Right 1. Rendered in this order
// (not reordered with CSS) so Tab order follows what is on screen.
export const BOARD_ORDER: Readonly<Record<Side, readonly Slot[]>> = {
  left: ['left1', 'left2'],
  right: ['right2', 'right1'],
};

const SIDE_LABELS: Readonly<Record<Side, string>> = { left: 'Left side', right: 'Right side' };

// FieldInput's attackerSide is the left side; see fieldFor in appState.ts.
const FIELD_SIDE_LABELS = { attackerSide: SIDE_LABELS.left, defenderSide: SIDE_LABELS.right } as const;

export interface AppProps {
  /** Starting state; tests pass one to render other setups. */
  initial?: () => CalcState;
}

export function App({ initial = initialState }: AppProps = {}) {
  const [state, setState] = useState<CalcState>(initial);
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference(browserStorage()));
  // One expanded cell per results grid, keyed by matchupKey().
  const [expanded, setExpanded] = useState<Record<Side, string | null>>({ left: null, right: null });

  useEffect(() => {
    applyThemePreference(document.documentElement, theme);
    saveThemePreference(browserStorage(), theme);
  }, [theme]);

  // Every hit recalculates on every state change; there is no submit step.
  const matchups = useMemo(() => allMatchups(state), [state]);

  // The inputs show each Pokemon with Intimidate's stage changes applied;
  // editPokemon separates the user's own edits back out.
  const effects = useMemo(() => stageEffects(state), [state]);
  const shown = useMemo(() => effectiveField(state), [state]);
  const active = activeSlots(state);

  const setPokemon = (slot: Slot) => (pokemon: Pokemon) => setState((s) => editPokemon(s, slot, pokemon));
  const setManual = (slot: Slot) => (stats: BoostStat[], manual: boolean) =>
    setState((s) => setManualStages(s, slot, stats, manual));
  const setMove = (slot: Slot) => (move: Move) => setState((s) => updateSlot(s, slot, { move }));
  const setCritical = (slot: Slot) => (isCritical: boolean) => setState((s) => updateSlot(s, slot, { isCritical }));
  const setField = (field: FieldState) => setState((s) => ({ ...s, field }));
  const setGame = (game: Game) => setState((s) => switchGame(s, game));
  const toggle = (side: Side) => (key: string) =>
    setExpanded((e) => ({ ...e, [side]: e[side] === key ? null : key }));

  const sideColumn = (side: Side) =>
    BOARD_ORDER[side]
      .filter((slot) => active.includes(slot))
      .map((slot) => (
        <SlotPanel
          key={slot}
          slot={slot}
          state={state}
          pokemon={shown[slot]}
          effects={effects}
          onPokemonChange={setPokemon(slot)}
          onSetManual={setManual(slot)}
          onMoveChange={setMove(slot)}
          onCriticalChange={setCritical(slot)}
        />
      ));

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">VGC Calc</h1>
        <Segmented label="Game" value={state.game} options={GAME_OPTIONS} onChange={setGame} />
        <Segmented label="Theme" value={theme} options={THEME_OPTIONS} onChange={setTheme} />
      </header>

      <main className={state.field.isDoubles ? 'app-main app-main-doubles' : 'app-main app-main-singles'}>
        <div className="app-side app-side-left" aria-label={SIDE_LABELS.left} role="group">
          {sideColumn('left')}
        </div>

        <div className="app-results" aria-live="polite">
          <MatchupGrid
            label={`${SIDE_LABELS.left} attacking`}
            matchups={matchups.left}
            expanded={expanded.left}
            onToggle={toggle('left')}
          />
          <MatchupGrid
            label={`${SIDE_LABELS.right} attacking`}
            matchups={matchups.right}
            expanded={expanded.right}
            onToggle={toggle('right')}
          />
          <p className="app-hint">Click a cell to see all 16 rolls.</p>
        </div>

        <div className="app-side app-side-right" aria-label={SIDE_LABELS.right} role="group">
          {sideColumn('right')}
        </div>
      </main>

      <footer className="app-field">
        <FieldInput game={state.game} field={state.field} onChange={setField} sideLabels={FIELD_SIDE_LABELS} />
      </footer>
    </div>
  );
}

interface SlotPanelProps {
  slot: Slot;
  state: CalcState;
  /** The Pokemon with automatic stage changes applied. */
  pokemon: Pokemon;
  effects: readonly StageEffect[];
  onPokemonChange: (pokemon: Pokemon) => void;
  onSetManual: (stats: BoostStat[], manual: boolean) => void;
  onMoveChange: (move: Move) => void;
  onCriticalChange: (isCritical: boolean) => void;
}

// One Pokemon on the field: its set, its one move (limited to its own
// learnset) with the crit toggle, and the automatic stage changes on it.
function SlotPanel({
  slot,
  state,
  pokemon,
  effects,
  onPokemonChange,
  onSetManual,
  onMoveChange,
  onCriticalChange,
}: SlotPanelProps) {
  const entry = state.slots[slot];
  const species = pokemon.species;
  const mine = effects.filter((e) => e.slot === slot);
  return (
    <div className="app-slot" data-slot={slot}>
      <PokemonInput
        label={SLOT_LABELS[slot]}
        game={state.game}
        pokemon={pokemon}
        autoStages={autoStageReasons(mine)}
        onChange={onPokemonChange}
      />
      <div className="app-slot-move">
        <MoveInput
          game={state.game}
          species={species}
          move={entry.move}
          label={species === '' ? 'Move' : `${species}'s move`}
          onChange={onMoveChange}
        />
        <label className="app-check">
          <input
            type="checkbox"
            checked={entry.isCritical}
            onChange={(e) => onCriticalChange(e.currentTarget.checked)}
          />
          Crit
        </label>
      </div>
      <StageEffectNotes effects={mine} onSetManual={onSetManual} />
    </div>
  );
}

// Stat -> cause, for the stats on one Pokemon that an applied effect changed.
function autoStageReasons(effects: readonly StageEffect[]): Partial<Record<BoostStat, string>> {
  const reasons: Partial<Record<BoostStat, string>> = {};
  for (const effect of effects) {
    for (const stat of changedStats(effect.changes)) {
      if (effect.overridden.includes(stat)) continue;
      reasons[stat] = reasons[stat] ? `${reasons[stat]} and ${effect.source}` : effect.source;
    }
  }
  return reasons;
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
