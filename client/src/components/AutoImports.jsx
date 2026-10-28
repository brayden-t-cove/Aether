/** Automatic returns imports from marketplace APIs: when each last ran, what it brought in, and Import now. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDateTime } from '../lib/format.js';
import ErrorNote from './ErrorNote.jsx';

const CHANNELS = [
  { key: 'amazon', name: 'Amazon', setup: 'Once the Selling Partner API keys are set, the FBA customer returns report imports by itself, the same as uploading it.' },
  { key: 'tiktok', name: 'TikTok Shop', setup: 'Once the TikTok Shop app keys are set and the shop is authorized, returns import by themselves, the same as uploading the export.' },
];

function Channel({ c, status, busy, onImport }) {
  const { can } = useAuth();
  const last = status.runs[0];
  const ready = status.configured && (c.key !== 'tiktok' || status.authorized);
  const state = !status.configured ? 'Not connected yet' : c.key === 'tiktok' && !status.authorized ? 'Waiting for the shop to be authorized' : 'Connected';
  return (
    <li>
      <div className="dash-item-main">
        <strong>{c.name}</strong>
        <span className={`small ${ready ? '' : 'muted'}`}>{state}</span>
        <span className="spacer" />
        {ready && can('editor') && (
          <button className="btn small" onClick={() => onImport(c.key)} disabled={busy}>
            {busy === c.key ? 'Importing…' : `Import ${c.name} now`}
          </button>
        )}
      </div>
      <div className="muted small">
        {!status.configured ? (
          c.setup
        ) : !ready ? (
          <>
            An admin authorizes the shop from <Link to="/admin/integrations">Integrations</Link>.
          </>
        ) : last ? (
          `Last run ${formatDateTime(last.started_at)}${last.ok === false ? '' : `: ${last.returns_created} new of ${last.rows_read} rows`}. Runs a few times a day over the last two weeks; returns already imported are skipped.`
        ) : (
          'No run yet. The first runs a few minutes after the server starts.'
        )}
      </div>
      {last?.ok === false && <div className="small error-text">Last run failed: {last.error}</div>}
    </li>
  );
}

export default function AutoImports({ onImported }) {
  const { data, reload } = useLoad('/api/returns/auto-imports');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  if (!data) return null;

  const importNow = async (channel) => {
    setBusy(channel);
    setError(null);
    setMessage(null);
    try {
      const res = await api(`/api/returns/auto-imports/${channel}`, { method: 'POST', body: {} });
      setMessage(res.message);
      await onImported?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
      reload();
    }
  };

  return (
    <section className="card" aria-label="Automatic imports">
      <h2>Automatic imports</h2>
      <ul className="dash-items">
        {CHANNELS.map((c) => (
          <Channel key={c.key} c={c} status={data[c.key]} busy={busy} onImport={importNow} />
        ))}
      </ul>
      {busy === 'amazon' && <p className="muted small">Amazon builds the report first, which takes about a minute.</p>}
      <ErrorNote error={error} />
      {message && <p className="muted small">{message}</p>}
    </section>
  );
}
