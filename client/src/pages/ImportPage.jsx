import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { parseImportJson, parseTable } from '../lib/table.js';
import ErrorNote from '../components/ErrorNote.jsx';

const ACTION_LABELS = { create: 'New', update: 'Update', skip: 'Skip', error: 'Error' };

function PlanTable({ rows, kind, done }) {
  if (!rows.length) return null;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>{kind === 'products' ? 'Product' : 'Project'}</th>
            <th>Action</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>
                {done && r.id ? <Link to={`/${kind}/${r.id}`}>{r.name}</Link> : <strong>{r.name}</strong>}
                {r.model && <div className="muted small">{r.model}</div>}
                {kind === 'projects' && r.itemCount > 0 && <div className="muted small">{r.itemCount} checklist items</div>}
              </td>
              <td>
                <span className={`tag action-${r.action}`}>{ACTION_LABELS[r.action]}</span>
              </td>
              <td className="small">
                {r.error && <div className="error-text">{r.error}</div>}
                {r.reason && <div className="muted">{r.reason}</div>}
                {r.warnings?.map((w, j) => (
                  <div key={j} className="warning-text">
                    ⚠ {w}
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ImportPage() {
  const [text, setText] = useState('');
  const [payload, setPayload] = useState(null);
  const [plan, setPlan] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setPayload(null);
    setPlan(null);
    setResult(null);
    setError(null);
  }

  async function preview(data) {
    reset();
    setBusy(true);
    try {
      setPayload(data);
      setPlan(await api('/api/admin/import', { method: 'POST', body: { ...data, dryRun: true } }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function readText(content, fileName = '') {
    try {
      const trimmed = content.trim();
      if (fileName.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) return parseImportJson(trimmed);
      const rows = parseTable(content);
      if (!rows.length) throw new Error('No rows found. Include the header row (Name, SKU, Category…) and at least one product.');
      return { products: rows, projects: [] };
    } catch (err) {
      throw new Error(err instanceof SyntaxError ? `That file isn't valid JSON: ${err.message}` : err.message);
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await preview(readText(await file.text(), file.name.toLowerCase()));
    } catch (err) {
      reset();
      setError(err);
    }
  }

  async function handlePaste(e) {
    e.preventDefault();
    try {
      await preview(readText(text));
    } catch (err) {
      reset();
      setError(err);
    }
  }

  async function runImport() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api('/api/admin/import', { method: 'POST', body: payload }));
      setPlan(null);
      setText('');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const shown = result || plan;
  const s = shown?.summary;
  const nothingToDo = s && s.productsCreate + s.productsUpdate + s.projectsCreate === 0;

  return (
    <div className="page">
      <header className="page-header">
        <h1>Import</h1>
        <p className="muted">
          Add or update many products at once, or load an import file with products and projects. You'll see a preview before anything is saved.
        </p>
      </header>

      {!shown && (
        <div className="grid-2">
          <form className="card stack" onSubmit={handlePaste}>
            <h2>Paste from a spreadsheet</h2>
            <p className="muted small">
              Copy the rows from Excel or Google Sheets, <strong>including the header row</strong>, and paste them here. Recognized columns: Name, Model
              (or Odyssey Name), SKU, Category, Manufacturer, Lifecycle, Launch Date, Sunset Date, Markets, Channels, Replaces, Notes. Use "--" or leave
              blank for unknowns.
            </p>
            <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Name\tSKU\tCategory\tLifecycle\t…'} aria-label="Pasted table" />
            <div>
              <button className="btn primary" disabled={!text.trim() || busy}>
                {busy ? 'Checking…' : 'Preview'}
              </button>
            </div>
          </form>
          <div className="card stack">
            <h2>Upload a file</h2>
            <p className="muted small">A .csv or .tsv of products, or a .json import file with products and projects.</p>
            <label className="btn file-btn">
              Choose file…
              <input type="file" accept=".csv,.tsv,.txt,.json" onChange={handleFile} hidden />
            </label>
          </div>
        </div>
      )}

      <ErrorNote error={error} />

      {shown && (
        <>
          <div className={`card ${result ? 'success-card' : ''}`}>
            <h2>{result ? 'Import complete' : 'Preview'}</h2>
            <p>
              {result ? 'Imported' : 'This will'}: <strong>{s.productsCreate}</strong> new products, <strong>{s.productsUpdate}</strong> product updates,{' '}
              <strong>{s.projectsCreate}</strong> new projects
              {s.projectsSkip > 0 && <>, {s.projectsSkip} skipped</>}.
              {s.errors > 0 && <span className="error-text"> {s.errors} rows have errors and {result ? 'were' : 'will be'} left out.</span>}
              {s.warnings > 0 && <span className="warning-text"> {s.warnings} warnings, see below.</span>}
            </p>
            <div className="row">
              {!result && (
                <button className="btn primary" onClick={runImport} disabled={busy || nothingToDo}>
                  {busy ? 'Importing…' : 'Import'}
                </button>
              )}
              {result && (
                <>
                  <Link className="btn primary" to="/">
                    Go to dashboard
                  </Link>
                  <Link className="btn" to="/products">
                    View products
                  </Link>
                </>
              )}
              <button className="btn ghost" onClick={reset} disabled={busy}>
                {result ? 'Import more' : 'Cancel'}
              </button>
            </div>
          </div>
          {shown.products.length > 0 && (
            <section className="card flush">
              <h2 className="pad-h">Products</h2>
              <PlanTable rows={shown.products} kind="products" done={Boolean(result)} />
            </section>
          )}
          {shown.projects.length > 0 && (
            <section className="card flush">
              <h2 className="pad-h">Projects</h2>
              <PlanTable rows={shown.projects} kind="projects" done={Boolean(result)} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
