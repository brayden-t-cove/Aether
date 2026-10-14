import { TEAMS } from '../../../shared/roles.js';

/** Toggle chips for a person's teams. People wear several hats, so any number can be on. */
export default function TeamPicker({ value = [], onChange, label = 'Teams', disabled = false }) {
  const toggle = (team) => onChange(value.includes(team) ? value.filter((t) => t !== team) : [...value, team]);
  return (
    <div className="team-picker" role="group" aria-label={label}>
      {Object.entries(TEAMS).map(([key, name]) => (
        <button
          key={key}
          type="button"
          className={`chip ${value.includes(key) ? 'chip-on' : ''}`}
          aria-pressed={value.includes(key)}
          onClick={() => toggle(key)}
          disabled={disabled}
        >
          {name}
        </button>
      ))}
    </div>
  );
}

/** A person's teams as plain text, e.g. "Design, Leadership". */
export const teamNames = (teams = []) => teams.map((t) => TEAMS[t] || t).join(', ');
