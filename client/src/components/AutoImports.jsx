/** Automatic returns imports from marketplace APIs: when each last ran, what it brought in, and Import now. */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDateTime } from '../lib/format.js';
import ErrorNote from './ErrorNote.jsx';

export default function AutoImports({ onImported }) {
  const { can } = useAuth();
  const { data, reload } = useLoad('/api/returns/auto-imports');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  if (!data) return null;
  const amazon = data.amazon;
  const last = amazon.runs[0];

  const importNow = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await api('/api/returns/auto-imports/amazon', { method: 'POST', body: {} });
      setMessage(res.message);
      await onImported?.();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      reload();
    }
  };

  return (
    <section className="card" aria-label="Automatic imports">
      <div className="row between">
        <h2>Automatic imports</h2>
        {amazon.configured && can('editor') && (
          <button className="btn small" onClick={importNow} disabled={busy}>
            {busy ? 'Importing… (Amazon builds the report first, about a minute)' : 'Import Amazon now'}
          </button>
        )}
      </div>
      <ul className="dash-items">
        <li>
          <div className="dash-item-main">
            <strong>Amazon</strong>
            <span className={`small ${amazon.configured ? '' : 'muted'}`}>{amazon.configured ? 'Connected' : 'Not connected yet'}</span>
          </div>
          <div className="muted small">
            {!amazon.configured
              ? 'Once the Selling Partner API keys are set, the FBA customer returns report imports by itself, the same as uploading it.'
              : last
                ? `Last run ${formatDateTime(last.started_at)}${last.ok === false ? '' : `: ${last.returns_created} new of ${last.rows_read} rows`}. Runs a few times a day over the last two weeks; returns already imported are skipped.`
                : 'No run yet. The first runs a few minutes after the server starts.'}
          </div>
          {last?.ok === false && <div className="small error-text">Last run failed: {last.error}</div>}
        </li>
        <li>
          <div className="dash-item-main">
            <strong>TikTok Shop</strong>
            <span className="small muted">Coming next</span>
          </div>
          <div className="muted small">Upload TikTok's returns export below until the TikTok connection is built.</div>
        </li>
      </ul>
      <ErrorNote error={error} />
      {message && <p className="muted small">{message}</p>}
    </section>
  );
}
