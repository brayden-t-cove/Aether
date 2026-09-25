/** A colored dot plus its label. Pass { label, tone } from lib/statuses.js. */
export default function StatusBadge({ status, title }) {
  return (
    <span className={`state tone-${status.tone}`} title={title}>
      <span className="state-dot" aria-hidden="true" />
      {status.label}
    </span>
  );
}
