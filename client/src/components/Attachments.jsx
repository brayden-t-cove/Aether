import { useRef, useState } from 'react';
import { useLoad } from '../lib/useLoad.js';
import { api } from '../lib/api.js';
import ErrorNote from './ErrorNote.jsx';

const formatSize = (bytes) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Files and links on a record. Uploads appear only when the server has file
 * storage set up; links always work.
 */
export default function Attachments({ entityType, entityId, attachments = [], editable, onChange, compact = false }) {
  const { data: config } = useLoad('/api/attachments/config');
  const [adding, setAdding] = useState(null); // null | 'link'
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef(null);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await onChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const addLink = (e) => {
    e.preventDefault();
    run(async () => {
      await api('/api/attachments/link', { method: 'POST', body: { entity_type: entityType, entity_id: entityId, url, name } });
      setUrl('');
      setName('');
      setAdding(null);
    });
  };

  const upload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (config?.maxUploadMb && file.size > config.maxUploadMb * 1024 * 1024) {
      setError(new Error(`Files can be at most ${config.maxUploadMb} MB`));
      return;
    }
    run(async () => {
      const form = new FormData();
      form.append('entity_type', entityType);
      form.append('entity_id', entityId);
      form.append('file', file);
      const res = await fetch('/api/attachments/file', { method: 'POST', body: form, credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
    });
  };

  const remove = (a) => {
    if (window.confirm(`Remove "${a.name}"?`)) run(() => api(`/api/attachments/${a.id}`, { method: 'DELETE' }));
  };

  return (
    <div className={`attachments ${compact ? 'compact' : ''}`}>
      <ErrorNote error={error} />
      {attachments.length === 0 && !editable && <p className="muted small">No files or links.</p>}
      {attachments.length > 0 && (
        <ul className="attachment-list">
          {attachments.map((a) => (
            <li key={a.id}>
              <span className="attachment-icon" aria-hidden="true">
                {a.kind === 'link' ? '↗' : '📄'}
              </span>
              <a href={a.kind === 'link' ? a.url : `/api/attachments/${a.id}/download`} target="_blank" rel="noreferrer noopener">
                {a.name}
              </a>
              <span className="muted small">
                {a.kind === 'file' && formatSize(a.size_bytes)}
                {a.uploaded_by_name && ` · ${a.uploaded_by_name}`}
              </span>
              {editable && (
                <button className="btn ghost small" onClick={() => remove(a)} disabled={busy} aria-label={`Remove ${a.name}`}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && adding === 'link' && (
        <form className="row" onSubmit={addLink}>
          <input type="url" required placeholder="https://drive.google.com/…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Link" />
          <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Link name" />
          <button className="btn small" disabled={busy}>
            Add
          </button>
          <button type="button" className="btn ghost small" onClick={() => setAdding(null)}>
            Cancel
          </button>
        </form>
      )}
      {editable && adding !== 'link' && (
        <div className="row">
          {config?.uploads && (
            <>
              <button className="btn small" onClick={() => fileInput.current?.click()} disabled={busy}>
                {busy ? 'Uploading…' : 'Upload file'}
              </button>
              <input ref={fileInput} type="file" hidden onChange={upload} />
            </>
          )}
          <button className="btn ghost small" onClick={() => setAdding('link')} disabled={busy}>
            Add link
          </button>
          {config && !config.uploads && <span className="muted small">File uploads aren't set up yet. Links work.</span>}
        </div>
      )}
    </div>
  );
}
