import { useState } from 'react';
import { LIFECYCLES } from '../../../shared/workflow.js';
import { useLoad } from '../lib/useLoad.js';
import ErrorNote from './ErrorNote.jsx';

const toForm = (p = {}) => ({
  name: p.name || '',
  model: p.model || '',
  sku: p.sku || '',
  category: p.category || '',
  manufacturer: p.manufacturer || '',
  lifecycle: p.lifecycle || 'active',
  launch_date: p.launch_date || '',
  sunset_date: p.sunset_date || '',
  channels: (p.channels || []).join(', '),
  market_ids: p.market_ids || [],
  replaces_id: p.replaces_id || '',
  notes: p.notes || '',
});

/** Create or edit a product. onSubmit receives the API payload and may throw. */
export default function ProductForm({ product, onSubmit, onCancel, submitLabel = 'Save' }) {
  const synced = product?.source === 'odyssey';
  const [form, setForm] = useState(() => toForm(product));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const markets = useLoad('/api/markets');
  const products = useLoad('/api/products');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleMarket = (id) =>
    setForm((f) => ({ ...f, market_ids: f.market_ids.includes(id) ? f.market_ids.filter((m) => m !== id) : [...f.market_ids, id] }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ ...form, replaces_id: form.replaces_id || null });
    } catch (err) {
      setError(err);
      setSaving(false);
    }
  }

  const otherProducts = (products.data?.products || []).filter((p) => p.id !== product?.id);

  return (
    <form className="stack" onSubmit={handleSubmit}>
      <ErrorNote error={error} />
      {synced && <p className="muted small">This product comes from Odyssey: name, model, category, manufacturer and lifecycle are edited there.</p>}
      <div className="form-row">
        <label>
          Name
          <input required value={form.name} onChange={set('name')} disabled={synced} />
        </label>
        <label>
          <span>
            Model <span className="muted small">(also its Odyssey name)</span>
          </span>
          <input value={form.model} onChange={set('model')} disabled={synced} placeholder="W4" />
        </label>
        <label>
          SKU
          <input value={form.sku} onChange={set('sku')} />
        </label>
      </div>
      <div className="form-row">
        <label>
          Category
          <input value={form.category} onChange={set('category')} disabled={synced} placeholder="Doorbell, Indoor, Window…" />
        </label>
        <label>
          Manufacturer
          <input value={form.manufacturer} onChange={set('manufacturer')} disabled={synced} />
        </label>
        <label>
          Lifecycle
          <select value={form.lifecycle} onChange={set('lifecycle')} disabled={synced}>
            {Object.entries(LIFECYCLES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label>
          Launch date
          <input type="date" value={form.launch_date} onChange={set('launch_date')} />
        </label>
        <label>
          Discontinued date
          <input type="date" value={form.sunset_date} onChange={set('sunset_date')} />
        </label>
        <label>
          Replaces
          <select value={form.replaces_id} onChange={set('replaces_id')}>
            <option value="">— Nothing —</option>
            {otherProducts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.model ? ` (${p.model})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="checks">
        <legend>
          Markets <span className="muted small">{form.lifecycle === 'upcoming' ? '(planned)' : '(sold in)'}</span>
        </legend>
        {(markets.data?.markets || []).map((m) => (
          <label key={m.id} className="check">
            <input type="checkbox" checked={form.market_ids.includes(m.id)} onChange={() => toggleMarket(m.id)} />
            {m.code}
          </label>
        ))}
      </fieldset>
      <label>
        <span>
          Channels <span className="muted small">(comma separated{form.lifecycle === 'upcoming' ? '; planned' : ''})</span>
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
