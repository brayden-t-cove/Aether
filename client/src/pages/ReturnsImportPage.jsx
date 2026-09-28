import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CHANNELS, REASON_GROUPS } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDateTime } from '../lib/format.js';
import { parseTable } from '../lib/table.js';
import ErrorNote from '../components/ErrorNote.jsx';
import { MarketSelect } from '../components/Pickers.jsx';

const HOW_TO = {
  amazon: 'In Seller Central: Reports → Fulfillment → Customer Returns (FBA). Download as .txt or .csv and upload it here.',
  tiktok: 'In TikTok Shop Seller Center: Orders → Returns/Refunds → Export. Upload the .csv here.',
  other: 'Any .csv or .tsv with columns such as Date, Order ID, SKU, Product name, Quantity and Reason.',
};

export default function ReturnsImportPage() {
  const { can } = useAuth();
  const [channel, setChannel] = useState('amazon');
  const [marketId, setMarketId] = useState('');
  const [upload, setUpload] = useState(null); // { filename, rows }
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const imports = useLoad('/api/returns/imports');

  async function preview(next) {
    setBusy(true);
    setError(null);
    setPlan(null);
    setResult(null);
    try {
      setUpload(next);
      setPlan(await api('/api/returns/import', { method: 'POST', body: { channel, market_id: marketId || null, rows: next.rows, dryRun: true } }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const rows = parseTable(await file.text());
    if (!rows.length) return setError(new Error('No rows found. Is the header row included?'));
    preview({ filename: file.name, rows });
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api('/api/returns/import', { method: 'POST', body: { channel, market_id: marketId || null, rows: upload.rows, filename: upload.filename } }));
      setPlan(null);
      imports.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function undo(imp) {
    if (!window.confirm(`Remove the ${imp.created_count} returns imported from ${imp.filename || CHANNELS[imp.channel]}?`)) return;
    try {
      await api(`/api/returns/imports/${imp.id}`, { method: 'DELETE' });
      imports.reload();
    } catch (err) {
      setError(err);
    }
  }

  const s = (result || plan)?.summary;

  return (
    <div className="page narrow-ish">
      <nav className="crumbs">
        <Link to="/returns">Returns</Link> /
      </nav>
      <header className="page-header">
        <h1>Import returns</h1>
        <p className="muted">Upload a returns report. You'll see what will be added before anything is saved, and re-importing the same report never double counts.</p>
      </header>

      <div className="card stack">
        <div className="form-row">
          <label>
            Channel
            <select value={channel} onChange={(e) => { setChannel(e.target.value); setPlan(null); setResult(null); }}>
              {Object.entries(CHANNELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            Market
            <MarketSelect value={marketId} onChange={(id) => setMarketId(id)} emptyLabel="— Not specified —" />
          </label>
        </div>
        <p className="muted small">{HOW_TO[channel] || HOW_TO.other}</p>
        <label className="btn file-btn">
          {busy ? 'Reading…' : 'Choose report…'}
          <input type="file" accept=".csv,.tsv,.txt" onChange={handleFile} hidden disabled={busy} />
        </label>
      </div>

      <ErrorNote error={error} />

      {s && (
        <div className={`card ${result ? 'success-card' : ''}`}>
          <h2>{result ? 'Import complete' : `Preview: ${upload.filename}`}</h2>
          <p>
            {result ? `Added ${result.import.created_count} returns` : `${s.create} returns (${s.units} units) will be added`}
            {s.duplicates > 0 && `, ${s.duplicates} already imported (skipped)`}
            {s.errors > 0 && <span className="error-text">, {s.errors} rows can't be read</span>}
            {s.unmatched > 0 && <span className="warning-text">. {s.unmatched} aren't matched to a product yet; assign them on the Returns page after importing</span>}.
          </p>
          <div className="row">
            {!result && can('editor') && (
              <button className="btn primary" onClick={runImport} disabled={busy || s.create === 0}>
                {busy ? 'Importing…' : 'Import'}
              </button>
            )}
            {result && (
              <Link className="btn primary" to="/returns">
                See returns
              </Link>
            )}
          </div>
          {!result && plan.rows.length > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Date</th>
                    <th>Product</th>
                    <th className="num">Qty</th>
                    <th>Reason</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.slice(0, 50).map((r) => (
                    <tr key={r.line}>
                      <td className="muted small">{r.line}</td>
                      <td className="small">{r.return_date || '—'}</td>
                      <td>
                        {r.product_name || <span className="warning-text">Unmatched</span>}
                        <div className="muted small">{[r.external_id, r.sku, r.product_label].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="num">{r.quantity}</td>
                      <td className="small">
                        {r.reason}
                        {r.reason_group && <div className="muted">{REASON_GROUPS[r.reason_group]}</div>}
                      </td>
                      <td className="small">
                        {r.action === 'create' && <span className="tag action-create">New</span>}
                        {r.action === 'duplicate' && <span className="tag action-skip">{r.reason_dup}</span>}
                        {r.action === 'error' && <span className="error-text">{r.error}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {plan.rows.length > 50 && <p className="muted small pad">Showing the first 50 of {s.rows} rows.</p>}
            </div>
          )}
        </div>
      )}

      <section className="card">
        <h2>Past imports</h2>
        {!imports.data?.imports.length ? (
          <p className="muted">None yet.</p>
        ) : (
          <ul className="dash-items">
            {imports.data.imports.map((imp) => (
              <li key={imp.id}>
                <div className="dash-item-main">
                  <strong>{imp.filename || CHANNELS[imp.channel]}</strong>
                  <span className="muted small">
                    {CHANNELS[imp.channel]} · {imp.created_count} added · {imp.duplicate_count} skipped · {formatDateTime(imp.created_at)}
                    {imp.created_by_name && ` · ${imp.created_by_name}`}
                  </span>
                  <span className="spacer" />
                  {can('admin') && (
                    <button className="btn ghost small danger" onClick={() => undo(imp)}>
                      Undo
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
