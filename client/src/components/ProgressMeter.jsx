/** Done / total as a thin meter with the numbers beside it. */
export default function ProgressMeter({ done = 0, total = 0 }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const label = total ? `${done} of ${total} done (${pct}%)` : 'No checklist items';
  return (
    <div className="meter" title={label}>
      <div className="meter-track" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="meter-text">{total ? `${done}/${total}` : '—'}</span>
    </div>
  );
}
