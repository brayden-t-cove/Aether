import { Link } from 'react-router-dom';
import { certStatus, READINESS, versionStatus } from '../lib/statuses.js';
import StatusBadge from './StatusBadge.jsx';

const CERT_ICON = { good: '✓', critical: '!', serious: '!', warning: '…', active: '…', neutral: '○' };

/** One product × market: overall status, each certification, manual and packaging. */
export default function ReadinessCell({ cell }) {
  if (!cell) return <span className="muted">—</span>;
  const doc = (label, d) => (
    <div className="rc-line">
      <span className="rc-label">{label}</span>
      {d ? (
        <Link to={`/manuals/${d.id}`} className={`rc-value tone-${versionStatus(d.state).tone}`}>
          {versionStatus(d.state).label}
          {d.version ? ` · ${d.version}` : ''}
        </Link>
      ) : (
        <span className="rc-value muted">None</span>
      )}
    </div>
  );
  return (
    <div className="rc">
      <StatusBadge status={READINESS[cell.status]} />
      <div className="rc-line rc-certs">
        {cell.certs.length === 0 && <span className="muted small">No certifications needed on record</span>}
        {cell.certs.map((c) => {
          const s = certStatus(c);
          const text = `${c.mark} ${CERT_ICON[s.tone]}`;
          return c.id ? (
            <Link key={c.mark + c.id} to={`/certifications/${c.id}`} className={`cert-chip tone-${s.tone}`} title={`${c.mark}: ${s.label}`}>
              {text}
            </Link>
          ) : (
            <span key={c.mark} className="cert-chip tone-neutral" title={`${c.mark}: not tracked yet`}>
              {text}
            </span>
          );
        })}
      </div>
      {doc('Manual', cell.manual)}
      {doc('Packaging', cell.packaging)}
      {cell.open_projects > 0 && (
        <div className="rc-line muted small">
          {cell.open_projects} open project{cell.open_projects > 1 ? 's' : ''}
        </div>
      )}
      {!cell.sells && <div className="rc-line muted small">Not selling here yet</div>}
    </div>
  );
}
