import type { FieldState, Game, SideState, Terrain, Weather } from '@vgc/types';
import './FieldInput.css';

export interface FieldInputProps {
  field: FieldState;
  game: Game;
  onChange: (field: FieldState) => void;
}

type SideKey = 'attackerSide' | 'defenderSide';
type BooleanSideKey = { [K in keyof SideState]: SideState[K] extends boolean ? K : never }[keyof SideState];
type RuinKey = 'isBeadsOfRuin' | 'isSwordOfRuin' | 'isTabletsOfRuin' | 'isVesselOfRuin';
type FieldToggleKey = 'isGravity' | 'isWonderRoom' | 'isMagicRoom';

const BASE_WEATHERS: ReadonlyArray<{ value: Weather; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'sun', label: 'Sun' },
  { value: 'rain', label: 'Rain' },
  { value: 'sand', label: 'Sand' },
  { value: 'snow', label: 'Snow' },
];

// Primal weathers come from legendaries (Groudon, Kyogre, Rayquaza), which
// Champions does not have.
const PRIMAL_WEATHERS: ReadonlyArray<{ value: Weather; label: string }> = [
  { value: 'harshSun', label: 'Harsh Sun' },
  { value: 'heavyRain', label: 'Heavy Rain' },
  { value: 'strongWinds', label: 'Strong Winds' },
];

const TERRAINS: ReadonlyArray<{ value: Terrain; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'electric', label: 'Electric' },
  { value: 'grassy', label: 'Grassy' },
  { value: 'misty', label: 'Misty' },
  { value: 'psychic', label: 'Psychic' },
];

const FIELD_TOGGLES: ReadonlyArray<{ key: FieldToggleKey; label: string }> = [
  { key: 'isGravity', label: 'Gravity' },
  { key: 'isWonderRoom', label: 'Wonder Room' },
  { key: 'isMagicRoom', label: 'Magic Room' },
];

// The Ruin abilities belong to the Treasures of Ruin legendaries, which
// Champions does not have.
const RUIN_TOGGLES: ReadonlyArray<{ key: RuinKey; label: string }> = [
  { key: 'isTabletsOfRuin', label: 'Tablets of Ruin' },
  { key: 'isSwordOfRuin', label: 'Sword of Ruin' },
  { key: 'isVesselOfRuin', label: 'Vessel of Ruin' },
  { key: 'isBeadsOfRuin', label: 'Beads of Ruin' },
];

const SIDE_TOGGLES: ReadonlyArray<{ key: BooleanSideKey; label: string }> = [
  { key: 'reflect', label: 'Reflect' },
  { key: 'lightScreen', label: 'Light Screen' },
  { key: 'auroraVeil', label: 'Aurora Veil' },
  { key: 'tailwind', label: 'Tailwind' },
  { key: 'helpingHand', label: 'Helping Hand' },
  { key: 'friendGuard', label: 'Friend Guard' },
  { key: 'battery', label: 'Battery' },
  { key: 'powerSpot', label: 'Power Spot' },
  { key: 'steelySpirit', label: 'Steely Spirit' },
  { key: 'stealthRock', label: 'Stealth Rock' },
];

const SIDES: ReadonlyArray<{ key: SideKey; label: string }> = [
  { key: 'attackerSide', label: 'Attacker side' },
  { key: 'defenderSide', label: 'Defender side' },
];

const MAX_SPIKES = 3;

function weatherOptions(game: Game, current: Weather): ReadonlyArray<{ value: Weather; label: string }> {
  if (game === 'gen9') return [...BASE_WEATHERS, ...PRIMAL_WEATHERS];
  // In Champions, keep a primal weather that is already set visible so the
  // select never shows a value other than the one in state.
  const stray = PRIMAL_WEATHERS.find((w) => w.value === current);
  return stray ? [...BASE_WEATHERS, { value: stray.value, label: `${stray.label} (not in Champions)` }] : BASE_WEATHERS;
}

function Toggle(props: { id: string; label: string; checked: boolean; onToggle: (checked: boolean) => void }) {
  return (
    <label className="field-input__toggle" htmlFor={props.id}>
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onToggle(e.currentTarget.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function SideControls(props: {
  sideKey: SideKey;
  label: string;
  side: SideState;
  onSideChange: (side: SideState) => void;
}) {
  const { sideKey, side, onSideChange } = props;
  const spikesId = `field-${sideKey}-spikes`;
  return (
    <fieldset className="field-input__group field-input__side">
      <legend>{props.label}</legend>
      <div className="field-input__toggles">
        {SIDE_TOGGLES.map(({ key, label }) => (
          <Toggle
            key={key}
            id={`field-${sideKey}-${key}`}
            label={label}
            checked={side[key]}
            onToggle={(checked) => onSideChange({ ...side, [key]: checked })}
          />
        ))}
      </div>
      <label className="field-input__select" htmlFor={spikesId}>
        <span>Spikes</span>
        <select
          id={spikesId}
          value={side.spikes}
          onChange={(e) => onSideChange({ ...side, spikes: Number(e.currentTarget.value) })}
        >
          {Array.from({ length: MAX_SPIKES + 1 }, (_, n) => (
            <option key={n} value={n}>
              {n === 0 ? 'None' : `${n} layer${n === 1 ? '' : 's'}`}
            </option>
          ))}
        </select>
      </label>
    </fieldset>
  );
}

export function FieldInput({ field, game, onChange }: FieldInputProps) {
  const update = (patch: Partial<FieldState>) => onChange({ ...field, ...patch });
  const showLegendaryEffects = game === 'gen9';

  return (
    <div className="field-input">
      <fieldset className="field-input__group">
        <legend>Field</legend>

        <div className="field-input__format" role="radiogroup" aria-label="Battle format">
          <label className="field-input__radio" htmlFor="field-format-singles">
            <input
              id="field-format-singles"
              type="radio"
              name="field-format"
              checked={!field.isDoubles}
              onChange={() => update({ isDoubles: false })}
            />
            <span>Singles</span>
          </label>
          <label className="field-input__radio" htmlFor="field-format-doubles">
            <input
              id="field-format-doubles"
              type="radio"
              name="field-format"
              checked={field.isDoubles}
              onChange={() => update({ isDoubles: true })}
            />
            <span>Doubles</span>
          </label>
        </div>

        <div className="field-input__selects">
          <label className="field-input__select" htmlFor="field-weather">
            <span>Weather</span>
            <select
              id="field-weather"
              value={field.weather}
              onChange={(e) => update({ weather: e.currentTarget.value as Weather })}
            >
              {weatherOptions(game, field.weather).map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field-input__select" htmlFor="field-terrain">
            <span>Terrain</span>
            <select
              id="field-terrain"
              value={field.terrain}
              onChange={(e) => update({ terrain: e.currentTarget.value as Terrain })}
            >
              {TERRAINS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field-input__toggles">
          {FIELD_TOGGLES.map(({ key, label }) => (
            <Toggle
              key={key}
              id={`field-${key}`}
              label={label}
              checked={field[key]}
              onToggle={(checked) => update({ [key]: checked })}
            />
          ))}
        </div>

        {showLegendaryEffects && (
          <div className="field-input__toggles field-input__ruin">
            {RUIN_TOGGLES.map(({ key, label }) => (
              <Toggle
                key={key}
                id={`field-${key}`}
                label={label}
                checked={field[key]}
                onToggle={(checked) => update({ [key]: checked })}
              />
            ))}
          </div>
        )}
      </fieldset>

      <div className="field-input__sides">
        {SIDES.map(({ key, label }) => (
          <SideControls
            key={key}
            sideKey={key}
            label={label}
            side={field[key]}
            onSideChange={(side) => update({ [key]: side })}
          />
        ))}
      </div>
    </div>
  );
}
