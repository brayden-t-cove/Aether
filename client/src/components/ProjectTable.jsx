import { Link } from 'react-router-dom';
import { PROJECT_TYPES } from '../../../shared/workflow.js';
import { formatDate, today } from '../lib/format.js';
import ProgressMeter from './ProgressMeter.jsx';
import StateBadge from './StateBadge.jsx';

/** Projects with state, progress and problems. `hide` drops columns, e.g. ['product']. */
export default function ProjectTable({ projects, hide = [] }) {
  const show = (col) => !hide.includes(col);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            {show('product') && <th>Product</th>}
            {show('market') && <th>Market</th>}
            <th>Owner</th>
            <th>State</th>
            <th>Progress</th>
            <th className="num">Blocked</th>
            <th className="num">Overdue</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((p) => {
            const late = p.state !== 'done' && p.target_date && p.target_date < today();
            return (
              <tr key={p.id}>
                <td>
                  <Link to={`/projects/${p.id}`}>
                    <strong>{p.name}</strong>
                  </Link>
                  <div className="muted small">{PROJECT_TYPES[p.type]}</div>
                </td>
                {show('product') && <td>{p.product_id ? <Link to={`/products/${p.product_id}`}>{p.product_name}</Link> : '—'}</td>}
                {show('market') && <td>{p.market_id ? <Link to={`/markets/${p.market_id}`}>{p.market_code}</Link> : '—'}</td>}
                <td>{p.owner_name || <span className="muted">Unassigned</span>}</td>
                <td>
                  <StateBadge state={p.state} />
                </td>
                <td>
                  <ProgressMeter done={p.done_count} total={p.item_count} />
                </td>
                <td className="num">{p.blocked_count ? <span className="flag flag-blocked">{p.blocked_count}</span> : <span className="muted">0</span>}</td>
                <td className="num">{p.overdue_count ? <span className="flag flag-overdue">{p.overdue_count}</span> : <span className="muted">0</span>}</td>
                <td className={late ? 'overdue-text' : ''}>{formatDate(p.target_date) || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
