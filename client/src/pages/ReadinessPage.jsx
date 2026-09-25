import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LIFECYCLES } from '../../../shared/workflow.js';
import { useLoad } from '../lib/useLoad.js';
import { READINESS } from '../lib/statuses.js';
import ErrorNote from '../components/ErrorNote.jsx';
import ReadinessCell from '../components/ReadinessCell.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

export default function ReadinessPage() {
  const [includeSunset, setIncludeSunset] = useState(false);
  const { data, error } = useLoad(`/api/readiness${includeSunset ? '?includeSunset=true' : ''}`);

  return (
    <div className="page wide">
      <header className="page-header">
        <h1>Readiness</h1>
        <p className="muted">
          Every product in every market it sells in or is planned for: certifications, manual and packaging at a glance. Certification chips: ✓ certified, …
          under way, ○ not tracked yet, ! rejected or expiring.
        </p>
      </header>

      <div className="toolbar">
        <div className="legend">
          {Object.values(READINESS).map((s) => (
            <StatusBadge key={s.label} status={s} />
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={includeSunset} onChange={(e) => setIncludeSunset(e.target.checked)} />
          Include discontinued products
        </label>
      </div>

      <ErrorNote error={error} />
      {!data ? (
        !error && <p className="muted">Loading…</p>
      ) : data.markets.length === 0 ? (
        <div className="card empty">
          <p className="muted">
            Nothing to show yet. Give products their markets on the <Link to="/products">Products</Link> page, or add certifications and manuals.
          </p>
        </div>
      ) : (
        <div className="card flush">
          <div className="table-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th>Product</th>
                  {data.markets.map((m) => (
                    <th key={m.id}>
                      <Link to={`/markets/${m.id}`}>{m.code}</Link>
                      <div className="muted small">{(m.required_marks || []).join(', ')}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map(({ product, cells }) => (
                  <tr key={product.id}>
                    <th scope="row">
                      <Link to={`/products/${product.id}`}>{product.name}</Link>
                      <div className="muted small">
                        {[product.model, LIFECYCLES[product.lifecycle]].filter(Boolean).join(' · ')}
                      </div>
                    </th>
                    {data.markets.map((m) => (
                      <td key={m.id}>
                        <ReadinessCell cell={cells[m.id]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
