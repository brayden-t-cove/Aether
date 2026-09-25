import { useState } from 'react';
import { REQUEST_STATES, REQUEST_TYPES } from '../../../shared/workflow.js';
import { useLoad } from '../lib/useLoad.js';
import ErrorNote from './ErrorNote.jsx';
import { ProductSelect, UserSelect } from './Pickers.jsx';

const toForm = (r = {}) => ({
  title: r.title || '',
  type: r.type || 'image',
  product_id: r.product_id || '',
  document_id: r.document_id || '',
  assignee_id: r.assignee_id || '',
  due_date: r.due_date || '',
  state: r.state || 'requested',
  description: r.description || '',
});

export default function RequestForm({ request, initial, onSubmit, onCancel, submitLabel = 'Save' }) {
  const [form, setForm] = useState(() => ({ ...toForm(request), ...initial }));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const docs = useLoad(form.product_id ? `/api/documents?productId=${form.product_id}` : null);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        ...form,
        product_id: form.product_id || null,
        document_id: form.document_id || null,
        assignee_id: form.assignee_id || null,
      });
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
          What's needed
          <input required value={form.title} onChange={set('title')} placeholder="Lifestyle renders for the box" />
        </label>
        <label>
          Type
          <select value={form.type} onChange={set('type')}>
            {Object.entries(REQUEST_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label>
          Product
          <ProductSelect value={form.product_id} onChange={(id) => setForm((f) => ({ ...f, product_id: id, document_id: '' }))} emptyLabel="— None —" />
        </label>
        <label>
          For
          <select value={form.document_id} onChange={set('document_id')} disabled={!docs.data?.documents.length}>
            <option value="">— No specific document —</option>
            {(docs.data?.documents || []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.title}
                {d.market_code ? ` (${d.market_code})` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="form-row">
        <label>
          Assigned to
          <UserSelect value={form.assignee_id} onChange={(id) => setForm((f) => ({ ...f, assignee_id: id }))} />
        </label>
        <label>
          Due
          <input type="date" value={form.due_date} onChange={set('due_date')} />
        </label>
        {request && (
          <label>
            State
            <select value={form.state} onChange={set('state')}>
              {Object.entries(REQUEST_STATES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <label>
        Details
        <textarea rows={4} value={form.description} onChange={set('description')} placeholder="Sizes, angles, text to include, where it will be used…" />
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
