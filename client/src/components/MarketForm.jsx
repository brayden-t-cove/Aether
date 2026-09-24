import { useState } from 'react';
import ErrorNote from './ErrorNote.jsx';


const toForm = (m = {}) => ({
  code: m.code || '',
  name: m.name || '',
  plug_types: (m.plug_types || []).join(', '),
  voltage: m.voltage || '',
  frequency: m.frequency || '',
  required_marks: (m.required_marks || []).join(', '),
  languages: (m.languages || []).join(', '),
  notes: m.notes || '',
});

export default function MarketForm({ market, onSubmit, onCancel, submitLabel = 'Save' }) {
  const [form, setForm] = useState(() => toForm(market));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      // List fields go as "a, b" strings; the server splits them.
      await onSubmit(form);
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
          Code
          <input required maxLength={10} value={form.code} onChange={set('code')} placeholder="UK" />
        </label>
        <label>
          Name
          <input required value={form.name} onChange={set('name')} placeholder="United Kingdom" />
        </label>
      </div>
      <div className="form-row">
        <label>
          Plug types
          <input value={form.plug_types} onChange={set('plug_types')} placeholder="G" />
        </label>
        <label>
          Voltage
          <input value={form.voltage} onChange={set('voltage')} placeholder="230V" />
        </label>
        <label>
          Frequency
          <input value={form.frequency} onChange={set('frequency')} placeholder="50Hz" />
        </label>
      </div>
      <div className="form-row">
        <label>
          Required marks
          <input value={form.required_marks} onChange={set('required_marks')} placeholder="UKCA" />
        </label>
        <label>
          Languages
          <input value={form.languages} onChange={set('languages')} placeholder="English" />
        </label>
      </div>
      <p className="muted small">Separate multiple values with commas. Required marks become certification items when you start a launch.</p>
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
