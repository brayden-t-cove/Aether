/** Products that look like the same thing — one added in Aether, one synced from Odyssey — to merge or set apart. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LIFECYCLES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import ErrorNote from '../components/ErrorNote.jsx';
import OdysseyBadge from '../components/OdysseyBadge.jsx';

const likelihood = (score) => (score >= 85 ? 'Very likely' : score >= 65 ? 'Likely' : 'Possibly');

const COUNTS = [
  ['project_count', 'project', 'projects'],
  ['certification_count', 'certification', 'certifications'],
  ['listing_count', 'listing', 'listings'],
  ['return_count', 'return', 'returns'],
  ['test_session_count', 'test session', 'test sessions'],
];
const counted = (p) =>
  COUNTS.filter(([key]) => p[key] > 0)
    .map(([key, one, many]) => `${p[key]} ${p[key] === 1 ? one : many}`)
    .join(', ');

function Side({ product, heading }) {
  return (
    <div className="dup-side">
      <p className="dup-heading muted small">{heading}</p>
      <p>
        <Link to={`/products/${product.id}`}>
          <strong>{product.name}</strong>
        </Link>{' '}
        {product.source === 'odyssey' && <OdysseyBadge />}
      </p>
      <dl className="dup-facts small">
        <dt>Model</dt>
        <dd>{product.model || '—'}</dd>
        <dt>Manufacturer</dt>
        <dd>{product.manufacturer || '—'}</dd>
        <dt>Lifecycle</dt>
        <dd>{LIFECYCLES[product.lifecycle]}</dd>
      </dl>
      <p className="muted small">{counted(product) || 'Nothing attached yet'}</p>
    </div>
  );
}

function Pair({ pair, editable, onDone }) {
  const { keep, merge } = pair;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(fn, message) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onDone(message);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }
  const doMerge = () =>
    window.confirm(`Merge "${merge.name}" into "${keep.name}"? "${merge.name}" will be removed, and everything on it moves to "${keep.name}".`) &&
    run(() => api(`/api/products/${keep.id}/merge`, { method: 'POST', body: { merge_id: merge.id } }), { text: `Merged into ${keep.name}.`, id: keep.id });
  const dismiss = () =>
    run(() => api('/api/products/duplicates/dismiss', { method: 'POST', body: { product_id: keep.id, other_id: merge.id } }), {
      text: `${keep.name} and ${merge.name} won't be suggested again.`,
    });

  const model = merge.model || keep.model;
  return (
    <li className="card dup-pair" aria-label={`${keep.name} and ${merge.name}`}>
      <div className="row">
        <span className={`tag dup-score ${pair.score >= 85 ? 'high' : ''}`}>
          {likelihood(pair.score)} the same · {pair.score}
        </span>
      </div>
      <ul className="dup-reasons small">
        {pair.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <div className="dup-sides">
        <Side product={keep} heading="Added in Aether — kept" />
        <span className="dup-arrow" aria-hidden="true">
          ←
        </span>
        <Side product={merge} heading="Synced from Odyssey — merged in" />
      </div>
      <p className="muted small">
        Merging keeps the name <strong>{keep.name}</strong> and everything entered here, takes Odyssey's link
        {model ? <>, model number {model}</> : null} and manufacturer, and moves everything on {merge.name} across. {merge.name} stays searchable as another name.
      </p>
      <ErrorNote error={error} />
      {editable && (
        <div className="row">
          <button className="btn primary" onClick={doMerge} disabled={busy}>
            Merge into {keep.name}
          </button>
          <button className="btn ghost" onClick={dismiss} disabled={busy}>
            Not the same
          </button>
        </div>
      )}
    </li>
  );
}

export default function ProductDuplicatesPage() {
  const { can } = useAuth();
  const { data, error, loading, reload } = useLoad('/api/products/duplicates');
  const [done, setDone] = useState(null);
  const finished = async (message) => {
    setDone(message);
    await reload();
  };

  return (
    <div className="page">
      <nav className="crumbs">
        <Link to="/products">Products</Link> /
      </nav>
      <header className="page-header">
        <h1>Possible duplicates</h1>
        <p className="muted">
          Products added in Aether that look like a product synced from Odyssey. Merging makes them one product, linked to Odyssey, so the next sync updates it
          instead of adding the copy again.
        </p>
      </header>
      {done && (
        <p className="alert success" role="status">
          {done.text} {done.id && <Link to={`/products/${done.id}`}>Open it</Link>}
        </p>
      )}
      <ErrorNote error={error} />
      {loading && !data ? (
        <p className="muted">Loading…</p>
      ) : data?.pairs.length === 0 ? (
        <div className="card empty">
          <p>No look-alike products. Everything synced from Odyssey is either linked to its Aether product or has no close match.</p>
        </div>
      ) : (
        <ul className="dup-list">
          {data?.pairs.map((pair) => (
            <Pair key={`${pair.keep.id}:${pair.merge.id}`} pair={pair} editable={can('editor')} onDone={finished} />
          ))}
        </ul>
      )}
    </div>
  );
}
