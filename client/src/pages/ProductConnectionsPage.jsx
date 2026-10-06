/**
 * Everything connected to each product: its listings, and the returns attached to it, grouped the way imports
 * match them, with how each group was matched. For finding returns filed under the wrong camera and moving them.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CHANNELS, LIFECYCLES } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate } from '../lib/format.js';
import ErrorNote from '../components/ErrorNote.jsx';

const VIA = {
  listing: { label: 'Listing', className: 'via-listing', hint: 'Matched by a listing on this product: set on purpose.' },
  guess: { label: 'Guessed at import', className: 'via-guess', hint: 'No listing: the import matched the SKU, model or name in the platform title. Worth a look.' },
  conflict: { label: 'Listing says another product', className: 'via-conflict', hint: 'Filed here, but the listing for this ID belongs to another product.' },
};

const units = (n) => `${n} ${n === 1 ? 'unit' : 'units'}`;

/** One group of returns on a product, with how it was matched and a way to move it. */
function Group({ g, product, products, editable, onMoved }) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const via = VIA[g.via];
  const id = g.external_id || g.sku;

  async function move(target) {
    const where = target ? products.find((p) => p.id === target)?.name : 'Unmatched';
    const also = id ? (target ? ` Its listing (${id}) moves too, so future imports follow.` : ` Its listing (${id}) is removed from ${product.name}, so the next import asks again.`) : '';
    if (!window.confirm(`Move ${units(g.units)} (${CHANNELS[g.channel]} ${id || 'by title'}) from ${product.name} to ${where}?${also}`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/products/${product.id}/move-returns`, {
        method: 'POST',
        body: { channel: g.channel, external_id: g.external_id || '', sku: g.external_id ? '' : g.sku || '', product_label: id ? '' : g.product_label, to_product_id: target || null },
      });
      await onMoved();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <tr className={`conn-group via-row-${g.via}`}>
      <td className="small">{CHANNELS[g.channel]}</td>
      <td className="small">
        {g.external_id && <div>{g.external_id}</div>}
        {g.sku && <div className="muted">SKU {g.sku}</div>}
        {!id && <span className="muted">No ID or SKU</span>}
      </td>
      <td className="small conn-title">
        <span title={g.product_label}>{g.product_label || <span className="muted">—</span>}</span>
        {g.titles > 1 && <div className="muted">+{g.titles - 1} other titles</div>}
      </td>
      <td className="num">{g.units}</td>
      <td className="small">
        {formatDate(g.first_date)}
        {g.last_date !== g.first_date && ` – ${formatDate(g.last_date)}`}
      </td>
      <td className="small">
        <span className={`tag ${via.className}`} title={via.hint}>
          {via.label}
        </span>
        {g.via === 'conflict' && <div className="muted">Listing: {g.listing_product_name}</div>}
      </td>
      {editable && (
        <td className="small">
          <ErrorNote error={error} />
          <div className="row conn-move">
            <select value={to} onChange={(e) => setTo(e.target.value)} aria-label={`Move ${id || g.product_label} to`} disabled={busy}>
              <option value="">Move to…</option>
              {g.via === 'conflict' && <option value={g.listing_product_id}>{g.listing_product_name} (its listing)</option>}
              {products
                .filter((p) => p.id !== product.id && p.id !== g.listing_product_id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.model ? ` (${p.model})` : ''}
                  </option>
                ))}
            </select>
            <button className="btn small" onClick={() => move(to)} disabled={!to || busy}>
              Move
            </button>
            <button className="btn ghost small" onClick={() => move(null)} disabled={busy} title="Send these returns back to Unmatched on the Returns page">
              Not this product
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

function ProductCard({ product, listings, groups, products, editable, onMoved }) {
  const total = groups.reduce((n, g) => n + g.units, 0);
  return (
    <section className="card conn-card" aria-label={product.name}>
      <header className="row between conn-head">
        <div>
          <h2>
            <Link to={`/products/${product.id}`}>{product.name}</Link>
          </h2>
          <p className="muted small">
            {[product.model && `Model ${product.model}`, product.category, LIFECYCLES[product.lifecycle], product.source === 'odyssey' ? 'From Odyssey' : product.odyssey_id ? 'In Odyssey' : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <span className="muted small">{units(total)} returned</span>
      </header>

      <h3>Listings</h3>
      {listings.length ? (
        <ul className="conn-listings">
          {listings.map((l) => (
            <li key={l.id}>
              <strong>{CHANNELS[l.channel]}</strong> {l.external_id || <span className="muted">no listing ID</span>}
              {l.sku && <span className="muted"> · SKU {l.sku}</span>}
              <span className="muted"> · {units(l.units)} returned through it</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No listings.</p>
      )}

      <h3>Returns, by what the platform called them</h3>
      {groups.length ? (
        <div className="table-wrap">
          <table aria-label={`Returns on ${product.name}`}>
            <thead>
              <tr>
                <th>Channel</th>
                <th>Listing ID / SKU</th>
                <th>Title on the platform</th>
                <th className="num">Units</th>
                <th>Dates</th>
                <th>How it was matched</th>
                {editable && <th>Fix</th>}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <Group key={`${g.channel}:${g.key}`} g={g} product={product} products={products} editable={editable} onMoved={onMoved} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted small">No returns.</p>
      )}
    </section>
  );
}

export default function ProductConnectionsPage() {
  const { can } = useAuth();
  const { data, error, reload } = useLoad('/api/products/connections');
  const [q, setQ] = useState('');
  const [onlyCheck, setOnlyCheck] = useState(false);

  const needle = q.trim().toLowerCase();
  const rows = (data?.products || []).map((p) => ({
    product: p,
    listings: data.listings.filter((l) => l.product_id === p.id),
    groups: data.groups.filter((g) => g.product_id === p.id),
  }));
  const toCheck = (r) => r.groups.some((g) => g.via !== 'listing');
  const matches = (r) =>
    !needle ||
    [r.product.name, r.product.model, ...r.listings.flatMap((l) => [l.external_id, l.sku]), ...r.groups.flatMap((g) => [g.external_id, g.sku, g.product_label])].some((v) =>
      v?.toLowerCase().includes(needle),
    );
  const shown = rows.filter((r) => (r.listings.length || r.groups.length) && matches(r) && (!onlyCheck || toCheck(r)));
  const empty = rows.filter((r) => !r.listings.length && !r.groups.length && matches(r));
  const counts = data && {
    guess: data.groups.filter((g) => g.via === 'guess').length,
    conflict: data.groups.filter((g) => g.via === 'conflict').length,
    unmatched: data.groups.filter((g) => g.via === 'unmatched').reduce((n, g) => n + g.units, 0),
  };
  // Biggest first, so the products that matter most get checked first.
  shown.sort((a, b) => b.groups.reduce((n, g) => n + g.units, 0) - a.groups.reduce((n, g) => n + g.units, 0) || a.product.name.localeCompare(b.product.name));

  return (
    <div className="page">
      <nav className="crumbs">
        <Link to="/products">Products</Link> /
      </nav>
      <header className="page-header">
        <h1>What’s connected to each product</h1>
        <p className="muted">
          Each product’s listings, and the returns filed under it, grouped by the listing ID, SKU or title the platform used. Check the titles look like that
          product; if not, move the group to the right one.
        </p>
      </header>
      <ErrorNote error={error} />
      {!data ? (
        !error && <p className="muted">Loading…</p>
      ) : (
        <>
          <p className="small">
            <span className="tag via-conflict">{counts.conflict} filed against their listing</span>{' '}
            <span className="tag via-guess">{counts.guess} guessed at import</span>{' '}
            {counts.unmatched > 0 && (
              <>
                · {units(counts.unmatched)} not matched to any product yet (<Link to="/returns">assign them on the Returns page</Link>)
              </>
            )}
          </p>
          <div className="toolbar">
            <label className="inline">
              <input type="checkbox" checked={onlyCheck} onChange={(e) => setOnlyCheck(e.target.checked)} /> Only products with something to check
            </label>
            <input type="search" placeholder="Search product, listing ID, SKU or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search connections" />
          </div>
          {shown.length === 0 && <p className="muted">{onlyCheck ? 'Nothing to check: every group is matched by a listing.' : 'Nothing matches.'}</p>}
          {shown.map((r) => (
            <ProductCard key={r.product.id} {...r} products={data.products} editable={can('editor')} onMoved={reload} />
          ))}
          {empty.length > 0 && !onlyCheck && (
            <section className="card">
              <h2>Nothing connected yet</h2>
              <p className="muted small">{empty.map((r) => r.product.name).join(', ')}</p>
            </section>
          )}
        </>
      )}
    </div>
  );
}
