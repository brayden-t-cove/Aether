/**
 * Merge another product into this one, for duplicates the Possible duplicates page doesn't pick up (names too
 * different, or added twice by hand). Everything on the other product moves here, and it's removed.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import ErrorNote from './ErrorNote.jsx';

export default function MergeDuplicate({ product, onMerged }) {
  const [open, setOpen] = useState(false);
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const { data } = useLoad(open ? '/api/products' : null);
  // A synced copy can't take in a product made in Aether: Aether's own product is the one to keep.
  const candidates = (data?.products || []).filter((p) => p.id !== product.id && !(product.source === 'odyssey' && p.source === 'aether'));
  const picked = candidates.find((p) => p.id === other);

  async function merge(e) {
    e.preventDefault();
    if (!window.confirm(`Merge "${picked.name}" into "${product.name}"? "${picked.name}" will be removed, and everything on it moves here.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/products/${product.id}/merge`, { method: 'POST', body: { merge_id: other } });
      setOpen(false);
      setOther('');
      await onMerged();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button className="btn ghost small" onClick={() => setOpen(true)}>
        Merge a duplicate into this product
      </button>
    );
  return (
    <form className="card stack merge-duplicate" onSubmit={merge} aria-label="Merge a duplicate into this product">
      <h2>Merge a duplicate into {product.name}</h2>
      <p className="muted small">
        Pick the other copy of this product. Its projects, certifications, listings, returns, test results, markets and vendors move here; this product
        keeps its name and details and fills in anything it’s missing. The other copy is removed, and its name stays searchable here.
        {product.source === 'odyssey' && ' To merge with a product made in Aether, open that product instead: it’s the one to keep.'}
      </p>
      <ErrorNote error={error} />
      <label>
        Duplicate to merge in
        <select value={other} onChange={(e) => setOther(e.target.value)} required>
          <option value="">— Choose a product —</option>
          {candidates.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.model ? ` (${p.model})` : ''}
              {p.source === 'odyssey' ? ' · from Odyssey' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button className="btn primary" disabled={!other || busy}>
          {busy ? 'Merging…' : 'Merge'}
        </button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
