import { useState } from 'react';
import { CERT_STATES } from '../../../shared/workflow.js';
import { useLoad } from '../lib/useLoad.js';
import ErrorNote from './ErrorNote.jsx';
import { MarketSelect, ProductSelect } from './Pickers.jsx';

const toForm = (c = {}) => ({
  product_id: c.product_id || '',
  market_id: c.market_id || '',
  variant_id: c.variant_id || '',
  mark: c.mark || '',
  state: c.state || 'not_started',
  lab: c.lab || '',
  cert_number: c.cert_number || '',
  issued_date: c.issued_date || '',
  expiry_date: c.expiry_date || '',
  notes: c.notes || '',
});

/** Create or edit a certification. `initial` can pre-fill product and market. */
export default function CertificationForm({ certification, initial, onSubmit, onCancel, submitLabel = 'Save' }) {
  const [form, setForm] = useState(() => ({ ...toForm(certification), ...initial }));
  const [marks, setMarks] = useState([]);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const variants = useLoad(form.product_id ? `/api/products/${form.product_id}/variants` : null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ ...form, variant_id: form.variant_id || null });
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
          Product
          <ProductSelect required value={form.product_id} onChange={(id) => setForm((f) => ({ ...f, product_id: id, variant_id: '' }))} />
        </label>
        <label>
          Market
          <MarketSelect
            required
            value={form.market_id}
            onChange={(id, market) => {
              setMarks(market?.required_marks || []);
              setForm((f) => ({ ...f, market_id: id, mark: f.mark || market?.required_marks?.[0] || '' }));
            }}
          />
        </label>
        <label>
          <span>
            Mark <span className="muted small">(FCC, UKCA, PTCRB…)</span>
          </span>
          <input required list="cert-marks" value={form.mark} onChange={set('mark')} />
          <datalist id="cert-marks">
            {[...new Set([...marks, 'FCC', 'PTCRB', 'UKCA', 'CE', 'ISED', 'NOM', 'IFT', 'ICASA', 'NRCS', 'RCM'])].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="form-row">
        <label>
          State
          <select value={form.state} onChange={set('state')}>
            {Object.entries(CERT_STATES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lab
          <input value={form.lab} onChange={set('lab')} />
        </label>
        <label>
          <span>
            Certificate number <span className="muted small">(e.g. FCC ID)</span>
          </span>
          <input value={form.cert_number} onChange={set('cert_number')} />
        </label>
      </div>
      <div className="form-row">
        <label>
          Issued
          <input type="date" value={form.issued_date} onChange={set('issued_date')} />
        </label>
        <label>
          Expires
          <input type="date" value={form.expiry_date} onChange={set('expiry_date')} />
        </label>
        <label>
          Variant
          <select value={form.variant_id} onChange={set('variant_id')} disabled={!variants.data?.variants.length}>
            <option value="">All variants</option>
            {(variants.data?.variants || []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </div>
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
