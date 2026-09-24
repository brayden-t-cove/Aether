import { useState } from 'react';
import { LIFECYCLES } from '../../../shared/workflow.js';
import ErrorNote from './ErrorNote.jsx';

const toForm = (p = {}) => ({
  name: p.name || '',
  sku: p.sku || '',
  category: p.category || '',
  lifecycle: p.lifecycle || 'active',
  launch_date: p.launch_date || '',
  sunset_date: p.sunset_date || '',
  channels: (p.channels || []).join(', '),
  notes: p.notes || '',
});

/** Create or edit a product. onSubmit receives the API payload and may throw. */
export default function ProductForm({ product, onSubmit, onCancel, submitLabel = 'Save' }) {
  const [form, setForm] = useState(() => toForm(product));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ ...form, channels: form.channels });
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <ErrorNote error={error} />
      <div className="form-row">
        <label>
          Name
          <input required value={form.name} onChange={set('name')} />
        </label>
        <label>
          SKU
          <input value={form.sku} onChange={set('sku')} />
        </label>
        <label>
          Category
          <input value={form.category} onChange={set('category')} placeholder="Camera, Doorbell…" />
        </label>
      </div>
      <div className="form-row">
        <label>
          Lifecycle
          <select value={form.lifecycle} onChange={set('lifecycle')}>
            {Object.entries(LIFECYCLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Launch date
          <input type="date" value={form.launch_date} onChange={set('launch_date')} />
        </label>
        <label>
          Sunset date
          <input type="date" value={form.sunset_date} onChange={set('sunset_date')} />
        </label>
      </div>
      <label>
        <span>
          Channels <span className="muted small">(comma separated)</span>
        </span>
        <input value={form.channels} onChange={set('channels')} placeholder="Amazon, TikTok" />
      </label>
      <label>
        Notes
        <textarea rows={3} value={form.notes} onChange={set('notes')} />
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
