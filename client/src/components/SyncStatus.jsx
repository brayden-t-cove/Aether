import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDateTime } from '../lib/format.js';

/** "Last synced with Odyssey …" line with a Sync now button. Renders nothing if Odyssey isn't connected. */
export default function SyncStatus({ onSynced }) {
  const { can } = useAuth();
  const { data, reload } = useLoad('/api/odyssey/status');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  if (!data?.configured) return null;
  const last = data.runs[0];

  async function sync() {
    setBusy(true);
    setMessage(null);
    try {
      const { run } = await api('/api/odyssey/sync', { method: 'POST' });
      const changes = run.products_created + run.products_linked + run.products_updated + run.vendors_created + run.vendors_updated;
      setMessage({ ok: true, text: changes ? `Synced: ${run.products_created} new, ${run.products_linked} linked, ${run.products_updated} updated products; ${run.sessions_synced} test sessions.` : 'Up to date.' });
      onSynced?.();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy(false);
      reload();
    }
  }

  return (
    <div className="sync-status small">
      <span className={last && !last.ok ? 'overdue-text' : 'muted'}>
        {data.lastSuccessAt ? `Odyssey data from ${formatDateTime(data.lastSuccessAt)}` : 'Not synced with Odyssey yet'}
        {last && !last.ok && ` · last attempt failed: ${last.error}`}
      </span>
      {can('editor') && (
        <button className="btn ghost small" onClick={sync} disabled={busy}>
          {busy ? 'Syncing…' : 'Sync now'}
        </button>
      )}
      {message && <span className={message.ok ? 'muted' : 'overdue-text'}>{message.text}</span>}
    </div>
  );
}
