import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { joinList } from '../lib/format.js';
import ErrorNote from '../components/ErrorNote.jsx';
import MarketForm from '../components/MarketForm.jsx';

export default function MarketsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const { data, error } = useLoad('/api/markets');

  async function create(payload) {
    const { market } = await api('/api/markets', { method: 'POST', body: payload });
    navigate(`/markets/${market.id}`);
  }

  return (
    <div className="page">
      <header className="page-header row between">
        <div>
          <h1>Markets</h1>
          <p className="muted">Where Luna sells, and what each market requires.</p>
        </div>
        {can('editor') && !adding && (
          <button className="btn primary" onClick={() => setAdding(true)}>
            Add market
          </button>
        )}
      </header>

      {adding && (
        <div className="card">
          <h2>New market</h2>
          <MarketForm onSubmit={create} onCancel={() => setAdding(false)} submitLabel="Add market" />
        </div>
      )}

      <div className="card flush">
        <ErrorNote error={error} />
        {!data ? (
          <p className="muted pad">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Plug</th>
                  <th>Power</th>
                  <th>Required marks</th>
                  <th>Languages</th>
                  <th className="num">Open projects</th>
                </tr>
              </thead>
              <tbody>
                {data.markets.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Link to={`/markets/${m.id}`}>
                        <strong>{m.code}</strong>
                      </Link>
                      <div className="muted small">{m.name}</div>
                    </td>
                    <td>{joinList(m.plug_types)}</td>
                    <td className="small">{[m.voltage, m.frequency].filter(Boolean).join(' / ') || '—'}</td>
                    <td>{joinList(m.required_marks)}</td>
                    <td className="small">{joinList(m.languages)}</td>
                    <td className="num">{m.open_project_count || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
