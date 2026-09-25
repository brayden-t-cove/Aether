import { useLoad } from '../lib/useLoad.js';
import { formatDateTime } from '../lib/format.js';

/** Odyssey test sessions for a product (or a project's product), as evidence of readiness. */
export default function TestSessions({ productId, projectId }) {
  const query = productId ? `productId=${productId}` : `projectId=${projectId}`;
  const { data } = useLoad(`/api/test-sessions?${query}`);
  const sessions = data?.sessions || [];
  return (
    <section className="card flush">
      <h2 className="pad-h">Test results from Odyssey</h2>
      {sessions.length === 0 ? (
        <p className="muted pad">No Odyssey test sessions for this product yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Session</th>
                <th>Status</th>
                <th>Result</th>
                <th className="num">Issues</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const pct = s.test_count ? Math.round((s.pass_count / s.test_count) * 100) : null;
                return (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.test_plan || 'Test session'}</strong>
                      <div className="muted small">{[s.product_name, s.tester].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="small">{s.status.replace(/_/g, ' ') || '—'}</td>
                    <td>
                      <div className="meter" title={`${s.pass_count} passed, ${s.fail_count} failed, ${s.skip_count} skipped of ${s.test_count}`}>
                        <div className="meter-track">
                          <div className="meter-fill" style={{ width: `${pct ?? 0}%` }} />
                        </div>
                        <span className="meter-text">{pct === null ? '—' : `${s.pass_count}/${s.test_count}`}</span>
                      </div>
                      {s.fail_count > 0 && <div className="small overdue-text">{s.fail_count} failed</div>}
                    </td>
                    <td className="num">{s.issue_count || '—'}</td>
                    <td className="small muted">{formatDateTime(s.started_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
