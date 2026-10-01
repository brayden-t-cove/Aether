import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CHANNELS } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate } from '../lib/format.js';
import ErrorNote from '../components/ErrorNote.jsx';

const VIEWS = {
  unsorted: { label: 'Other', empty: 'Every return with a note has a category.' },
  unreviewed: { label: 'Not yet reviewed', empty: 'Every call the rules made has been reviewed.' },
};

/** A category / sub-reason picker, grouped by category. Value is "category/subreason". */
function CodebookSelect({ codebook, value, onChange, label }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {codebook.map((c) => (
        <optgroup key={c.key} label={c.name}>
          {c.subreasons.map((s) => (
            <option key={s.key} value={`${c.key}/${s.key}`}>
              {s.name}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ReturnRow({ r, view, codebook, editable, onSaved }) {
  const current = r.category_key ? `${r.category_key}/${r.subreason_key}` : '';
  const [choice, setChoice] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(value) {
    const [category, subreason] = value.split('/');
    setBusy(true);
    setError(null);
    try {
      await api(`/api/returns/${r.id}/category`, { method: 'PATCH', body: { category, subreason } });
      onSaved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <tr>
      <td>{formatDate(r.return_date)}</td>
      <td>
        {CHANNELS[r.channel] || r.channel}
        <div className="muted small">{r.product_name || r.product_label}</div>
      </td>
      <td>
        {r.note_clean}
        {r.reason && <div className="muted small">Platform reason: {r.reason}</div>}
      </td>
      {view === 'unreviewed' && (
        <td>
          {r.category_name}
          <div className="muted small">
            {r.subreason_name}
            {r.category_why && ` · ${r.category_why}`}
          </div>
        </td>
      )}
      {editable && (
        <td>
          <div className="row">
            <CodebookSelect codebook={codebook} value={choice} onChange={setChoice} label={`Category for the return on ${formatDate(r.return_date)}`} />
            {view === 'unreviewed' && choice === current ? (
              <button className="btn small" disabled={busy} onClick={() => save(current)}>
                Confirm
              </button>
            ) : (
              <button className="btn primary small" disabled={busy || !choice} onClick={() => save(choice)}>
                Save
              </button>
            )}
          </div>
          <ErrorNote error={error} />
        </td>
      )}
    </tr>
  );
}

export default function ReturnsReviewPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const view = VIEWS[params.get('view')] ? params.get('view') : 'unsorted';
  const channel = params.get('channel') || '';
  const query = new URLSearchParams({ view, ...(channel && { channel }) });
  const { data, error, reload } = useLoad(`/api/returns/review?${query}`);
  const { data: codebook } = useLoad('/api/returns/codebook');
  const editable = can('editor');
  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const c = data?.counts;

  return (
    <div className="page">
      <nav className="crumbs">
        <Link to="/returns">Returns</Link> /
      </nav>
      <header className="page-header">
        <h1>Review returns</h1>
        <p className="muted">
          Returns the rules couldn&apos;t place, and calls they made that no one has checked yet. A category set here is kept when the rules run again.
        </p>
      </header>

      {c && (
        <p aria-label="Review progress">
          <strong>{c.reviewed}</strong> of {c.noted} returns with a note reviewed ({c.noted ? Math.round((c.reviewed / c.noted) * 100) : 0}%)
        </p>
      )}

      <div className="toolbar">
        <div className="tabs" role="tablist">
          {Object.entries(VIEWS).map(([key, v]) => (
            <button key={key} role="tab" aria-selected={view === key} className={`tab ${view === key ? 'active' : ''}`} onClick={() => set('view', key === 'unsorted' ? '' : key)}>
              {v.label}
              {c && ` (${c[key]})`}
            </button>
          ))}
        </div>
        <label className="inline">
          Channel
          <select value={channel} onChange={(e) => set('channel', e.target.value)}>
            <option value="">All</option>
            {Object.entries(CHANNELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card flush">
        <ErrorNote error={error} />
        {!data || !codebook ? (
          !error && <p className="muted pad">Loading…</p>
        ) : data.returns.length === 0 ? (
          <p className="muted pad">{VIEWS[view].empty}</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Channel and product</th>
                  <th>Buyer&apos;s note</th>
                  {view === 'unreviewed' && <th>Rules&apos; call</th>}
                  {editable && <th>Category</th>}
                </tr>
              </thead>
              <tbody>
                {data.returns.map((r) => (
                  <ReturnRow key={r.id} r={r} view={view} codebook={codebook.categories} editable={editable} onSaved={reload} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
