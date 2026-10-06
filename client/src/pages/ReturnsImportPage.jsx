import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CHANNELS, MATCH_CONFIDENCE, REASON_GROUPS } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDateTime } from '../lib/format.js';
import { parseTable, readText } from '../lib/table.js';
import { readMatchWorkbook } from '../lib/matchWorkbook.js';
import ErrorNote from '../components/ErrorNote.jsx';
import { MarketSelect } from '../components/Pickers.jsx';

const HOW_TO = {
  amazon: 'In Seller Central: Reports → Fulfillment → Customer Returns (FBA). Download as .txt or .csv and upload it here.',
  tiktok: 'In TikTok Shop Seller Center: Orders → Manage returns → All, then Export. Upload the .csv here.',
  other: 'Any .csv or .tsv with columns such as Date, Order ID, SKU, Product name, Quantity and Reason.',
};

const ROUNDED = (n) =>
  `${n} Return Order IDs are stored as numbers, and Excel has rounded them, so they can't be matched. Format the Return Order ID column as Text and paste the IDs in again from the TikTok export, then upload again.`;

/** Upload the customer-match workbook: only each return's ID and match confidence are sent. */
function MatchUpload() {
  const { can } = useAuth();
  const stored = useLoad('/api/returns/matches');
  const [upload, setUpload] = useState(null); // { filename, matches, used }
  const [summary, setSummary] = useState(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const send = (next, dryRun) =>
    api('/api/returns/matches', { method: 'POST', body: { channel: 'tiktok', filename: next.filename, matches: next.matches, dryRun } });

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    setSaved(false);
    try {
      const { matches, used, rounded } = await readMatchWorkbook(file);
      if (!matches.length && rounded) throw new Error(ROUNDED(rounded));
      if (!matches.length) throw new Error('No returns found. The workbook needs a "Return Order ID" column and a "Match Confidence" column (or an "Unmatched Returns" tab).');
      const next = { filename: file.name, matches, used, rounded };
      setUpload(next);
      setSummary((await send(next, true)).summary);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      setSummary((await send(upload, false)).summary);
      setSaved(true);
      stored.reload();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const totals = {};
  for (const m of stored.data?.matches || []) totals[m.confidence] = (totals[m.confidence] || 0) + m.returns;
  const storedCount = Object.values(totals).reduce((a, b) => a + b, 0);
  const s = summary;

  return (
    <section className="card stack" aria-labelledby="matches-heading">
      <h2 id="matches-heading">Customer matches (TikTok)</h2>
      <p className="muted small">
        Upload the customer-match workbook (.xlsx) to record how confidently each TikTok return was matched to a customer. The Returns page then
        counts High and Medium matches by default. Only each return's ID and confidence are sent; names, phone numbers, emails and addresses stay
        on your computer.
      </p>
      {storedCount > 0 && (
        <p className="small">
          On file: {storedCount} returns ({Object.entries(MATCH_CONFIDENCE).map(([k, v]) => `${totals[k] || 0} ${v}`).join(', ')}).
        </p>
      )}
      {can('editor') && (
        <label className="btn file-btn">
          {busy ? 'Reading…' : 'Choose workbook…'}
          <input type="file" accept=".xlsx" onChange={handleFile} hidden disabled={busy} aria-label="Customer-match workbook file" />
        </label>
      )}
      <ErrorNote error={error} />
      {s && (
        <div className={saved ? 'success-card pad' : ''}>
          <h3>{saved ? 'Matches saved' : `Preview: ${upload.filename}`}</h3>
          <p>
            {s.returns} returns: {Object.entries(MATCH_CONFIDENCE).map(([k, v]) => `${s.byConfidence[k]} ${v}`).join(', ')}
            {s.noActivation > 0 && ` (${s.noActivation} unmatched with no activation in the buyer's zip)`}.
            {' '}
            {s.added} new, {s.changed} changed, {s.unchanged} unchanged
            {s.invalid > 0 && <span className="warning-text">, {s.invalid} rows without a return ID or a known confidence (skipped)</span>}.
          </p>
          <p className="muted small">
            Read {upload.used.map((u) => `${u.rows} rows from "${u.sheet}"`).join(' and ')}. A return listed more than once keeps its strongest match.
            {s.notImported > 0 && ` ${s.notImported} of these returns aren't in Aether yet; their match applies once the TikTok export that has them is imported.`}
          </p>
          {upload.rounded > 0 && <p className="warning-text small">{ROUNDED(upload.rounded)}</p>}
          {!saved && (
            <button className="btn primary" onClick={save} disabled={busy || s.added + s.changed === 0}>
              {busy ? 'Saving…' : 'Save matches'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

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
    const rows = parseTable(await readText(file));
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
          <input type="file" accept=".csv,.tsv,.txt" onChange={handleFile} hidden disabled={busy} aria-label="Returns report file" />
        </label>
      </div>

      <ErrorNote error={error} />

      {s && (
        <div className={`card ${result ? 'success-card' : ''}`}>
          <h2>{result ? 'Import complete' : `Preview: ${upload.filename}`}</h2>
          <p>
            {result ? `Added ${result.import.created_count} returns` : `${s.create} returns (${s.units} units) will be added`}
            {s.added > 0 && `, ${s.added} more ${s.added === 1 ? 'unit' : 'units'} for returns already imported`}
            {(result ? result.import.notes_added : s.notes_added) > 0 &&
              `, ${result ? result.import.notes_added : s.notes_added} already imported ${result ? 'got' : 'will get'} their buyer note`}
            {s.duplicates > 0 && `, ${s.duplicates} already imported (skipped)`}
            {s.errors > 0 && <span className="error-text">, {s.errors} rows can't be read</span>}
            {s.unmatched > 0 && <span className="warning-text">. {s.unmatched} aren't matched to a product yet; assign them on the Returns page after importing</span>}.
          </p>
          {s.with_note != null && (
            <p className="muted small">
              {s.with_note} of {s.rows} rows have a note from the buyer
              {channel === 'tiktok' ? ' (the Buyer Note column)' : channel === 'amazon' ? ' (Customer Comments, beyond the menu choice)' : ''}.
            </p>
          )}
          {plan?.dateOrder && !result && (
            <p className="muted small">
              Dates read {plan.dateOrder === 'dmy' ? 'day first (28/09/2026 is 28 September)' : 'month first (09/28/2026 is September 28)'}. Check a few rows below before importing.
            </p>
          )}
          {plan?.grouped && !result && <p className="muted small">Amazon lists each returned unit on its own row. Units from the same order become one return, so returns count the same way on every channel.</p>}
          <div className="row">
            {!result && can('editor') && (
              <button className="btn primary" onClick={runImport} disabled={busy || s.create + (s.added || 0) + (s.notes_added || 0) === 0}>
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
                    <th>Buyer&apos;s note</th>
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
                        <div className="muted small">{[r.order_ref && `Order ${r.order_ref}`, r.external_id, r.sku, r.product_label].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td className="num">{r.quantity}</td>
                      <td className="small">
                        {r.reason}
                        {r.reason_group && <div className="muted">{REASON_GROUPS[r.reason_group]}</div>}
                      </td>
                      <td className="small import-note">{r.note ? <span title={r.note}>{r.note}</span> : <span className="muted">—</span>}</td>
                      <td className="small">
                        {r.action === 'create' && <span className="tag action-create">New</span>}
                        {r.action === 'update' && <span className="tag action-create">{r.reason_dup}</span>}
                        {r.action === 'add' && <span className="tag action-create">{r.reason_dup}</span>}
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

      <MatchUpload />

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
