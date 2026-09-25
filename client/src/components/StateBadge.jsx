import { STATE_LABELS } from '../../../shared/workflow.js';

/** State shown as a colored dot plus its label, so color is never the only cue. */
export default function StateBadge({ state, waiting = false }) {
  if (waiting && state !== 'blocked' && state !== 'done') {
    return (
      <span className="state state-waiting" title="Waiting on another item">
        <span className="state-dot" aria-hidden="true" />
        Waiting
      </span>
    );
  }
  return (
    <span className={`state state-${state}`}>
      <span className="state-dot" aria-hidden="true" />
      {STATE_LABELS[state] || state}
    </span>
  );
}
