import { useState } from 'react';
import { VENDOR_STATUSES, VENDOR_TYPES } from '../../../shared/workflow.js';
import ErrorNote from './ErrorNote.jsx';

export default function VendorForm({ vendor, onSubmit, onCancel, submitLabel = 'Save' }) {
  const synced = vendor?.source === 'odyssey';
  const [form, setForm] = useState({
    name: vendor?.name || '',
    type: vendor?.type || 'manufacturer',
    status: vendor?.status || 'active',
    website: vendor?.website || '',
    country: vendor?.country || '',
    notes: vendor?.notes || '',
  });
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // Synced vendors: only send the fields Aether owns.
      await onSubmit(synced ? { type: form.type, country: form.country } : form);
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <ErrorNote error={error} />
      {synced && <p className="muted small">Name, status, website and notes come from Odyssey and are edited there.</p>}
      <div className="form-row">
        <label>
          Name
          <input required value={form.name} onChange={set('name')} disabled={synced} />
        </label>
        <label>
          Type
          <select value={form.type} onChange={set('type')}>
            {Object.entries(VENDOR_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select value={form.status} onChange={set('status')} disabled={synced}>
            {Object.entries(VENDOR_STATUSES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label>
          Website
          <input type="url" value={form.website} onChange={set('website')} disabled={synced} placeholder="https://" />
        </label>
        <label>
          Country
          <input value={form.country} onChange={set('country')} />
        </label>
      </div>
      <label>
        Notes
        <textarea rows={3} value={form.notes} onChange={set('notes')} disabled={synced} />
      </label>
      <div className="row">
        <button className="btn primary" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
