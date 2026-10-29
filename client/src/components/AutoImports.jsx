/** Automatic returns imports from marketplace APIs: when each last ran, what it brought in, and Import now. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate, formatDateTime } from '../lib/format.js';
import ErrorNote from './ErrorNote.jsx';

const CHANNELS = [
  { key: 'amazon', name: 'Amazon', setup: 'Once the Selling Partner API keys are set, the FBA customer returns report imports by itself, the same as uploading it.' },
  { key: 'tiktok', name: 'TikTok Shop', setup: 'Once the TikTok Shop app keys are set and the shop is authorized, returns import by themselves, the same as uploading the export.' },
];

// What a first connection brings in: this month and the 23 before it (as HISTORY_MONTHS on the server).
const twoYearsBack = () => {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() - 23, 1);
  return `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
};

/** Past returns: brought in a month at a time, once on connecting and again from any date someone picks. */
function History({ c, history, onStart }) {
  const { can } = useAuth();
  const [from, setFrom] = useState(history?.from || twoYearsBack());
  const running = history?.status === 'running';
  const text = !history
    ? 'Past returns: not brought in yet. They come in on their own after the first run, or start it here.'
    : running
      ? `Bringing in past returns since ${formatDate(history.from)}: done through ${history.through ? formatDate(history.through) : '…'}, ${history.created} new so far.`
      : history.status === 'done'
        ? `Past returns since ${formatDate(history.from)} brought in (${history.created} new; the rest were already here).`
        : `Bringing in past returns stopped${history.through ? ` after ${formatDate(history.through)}` : ''}: ${history.error || 'the server restarted'}.`;
  return (
    <div className="small">
      <span className={running ? '' : 'muted'}>{text}</span>
      {!running && can('editor') && (
        <span className="history-start">
          {' '}
          <label>
            From <input type="date" value={from} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setFrom(e.target.value)} aria-label={`${c.name} past returns from`} />
          </label>{' '}
          <button className="btn small" onClick={() => onStart(c.key, from)} disabled={!from}>
            Bring in past {c.name} returns
          </button>
        </span>
      )}
    </div>
  );
}

function Channel({ c, status, busy, onImport, onHistory }) {
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
      {ready && <History c={c} history={status.history} onStart={onHistory} />}
    </li>
  );
}

export default function AutoImports({ onImported }) {
  const { data, reload } = useLoad('/api/returns/auto-imports');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const going = ['amazon', 'tiktok'].some((k) => data?.[k]?.history?.status === 'running');
  // While past returns are coming in, check on them every so often.
  useEffect(() => {
    if (!going) return undefined;
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, [going, reload]);
  if (!data) return null;

  const startHistory = async (channel, from) => {
    setError(null);
    setMessage(null);
    try {
      const res = await api(`/api/returns/auto-imports/${channel}/history`, { method: 'POST', body: { from } });
      setMessage(res.message);
    } catch (err) {
      setError(err);
    } finally {
      reload();
    }
  };

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
          <Channel key={c.key} c={c} status={data[c.key]} busy={busy} onImport={importNow} onHistory={startHistory} />
        ))}
      </ul>
      {busy === 'amazon' && <p className="muted small">Amazon builds the report first, which takes about a minute.</p>}
      <ErrorNote error={error} />
      {message && <p className="muted small">{message}</p>}
    </section>
  );
}
