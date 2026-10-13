import { useRef, useState } from 'react';
import { TEST_RESULTS } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate, formatDateTime } from '../lib/format.js';
import Attachments from './Attachments.jsx';
import ErrorNote from './ErrorNote.jsx';
import StatusBadge from './StatusBadge.jsx';

const RESULT_TONES = { passed: 'good', partial: 'warning', failed: 'critical' };
const PDF = 'application/pdf,.pdf';
const BLANK = { title: '', result: '', tested_on: '', tested_by: '', notes: '', source: 'file', url: '' };

/**
 * Test results for a product (or a project's product): reports added by hand, each with its PDF or a link to it,
 * and the test sessions synced from Odyssey, with a button to pull the latest from Odyssey.
 */
export default function TestResults({ productId, projectId }) {
  const { can } = useAuth();
  const editable = can('editor');
  const query = productId ? `productId=${productId}` : `projectId=${projectId}`;
  const sessions = useLoad(`/api/test-sessions?${query}`);
  const reports = useLoad(`/api/test-reports?${query}`);
  const odyssey = useLoad('/api/odyssey/status');
  const uploads = useLoad('/api/attachments/config');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const fileInput = useRef(null);

  const canUpload = Boolean(uploads.data?.uploads);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function run(fn) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const pull = () =>
    run(async () => {
      try {
        const { run: r } = await api('/api/odyssey/sync', { method: 'POST' });
        setMessage(`Pulled from Odyssey: ${r.sessions_synced} test sessions.`);
      } finally {
        odyssey.reload();
        sessions.reload();
      }
    });

  const add = (e) => {
    e.preventDefault();
    const file = form.source === 'file' ? fileInput.current?.files?.[0] : null;
    if (form.source === 'file' && !file) return setError(new Error('Choose the PDF to upload, or add a link instead'));
    if (file && uploads.data?.maxUploadMb && file.size > uploads.data.maxUploadMb * 1024 * 1024) {
      return setError(new Error(`Files can be at most ${uploads.data.maxUploadMb} MB`));
    }
    run(async () => {
      const { title, result, tested_on, tested_by, notes } = form;
      const { report } = await api('/api/test-reports', {
        method: 'POST',
        body: { ...(productId ? { product_id: productId } : { project_id: projectId }), title, result, tested_on, tested_by, notes },
      });
      try {
        if (file) {
          const body = new FormData();
          body.append('entity_type', 'test_report');
          body.append('entity_id', report.id);
          body.append('file', file);
          const res = await fetch('/api/attachments/file', { method: 'POST', body, credentials: 'same-origin' });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Upload failed');
        } else if (form.url) {
          await api('/api/attachments/link', { method: 'POST', body: { entity_type: 'test_report', entity_id: report.id, url: form.url, name: title } });
        }
        setForm(null);
      } catch (err) {
        // The result is saved; only its file didn't make it. It can be added from the list.
        setForm(null);
        throw new Error(`Saved "${title}", but its report wasn't added: ${err.message}. Add it from the list below.`);
      } finally {
        reports.reload();
      }
    });
  };

  const remove = (r) => {
    if (window.confirm(`Remove the test result "${r.title}" and its files?`)) {
      run(async () => {
        await api(`/api/test-reports/${r.id}`, { method: 'DELETE' });
        reports.reload();
      });
    }
  };

  const reportList = reports.data?.reports || [];
  const sessionList = sessions.data?.sessions || [];
  const lastSync = odyssey.data?.lastSuccessAt;

  return (
    <section className="card flush test-results">
      <div className="row between pad-h">
        <h2>Test results</h2>
        {editable && (
          <div className="row">
            {odyssey.data?.configured && (
              <button className="btn ghost small" onClick={pull} disabled={busy}>
                {busy && !form ? 'Pulling…' : 'Pull from Odyssey'}
              </button>
            )}
            {!form && (
              <button className="btn small" onClick={() => setForm({ ...BLANK, source: canUpload ? 'file' : 'link' })} disabled={busy}>
                Add test result
              </button>
            )}
          </div>
        )}
      </div>
      <div className="pad-h">
        <ErrorNote error={error} />
        {message && <p className="muted small">{message}</p>}
      </div>

      {form && (
        <form className="stack pad test-report-form" onSubmit={add} aria-label="Add a test result">
          <div className="form-row">
            <label>
              Title
              <input required value={form.title} onChange={set('title')} placeholder="e.g. FCC pre-scan, drop test, 72h soak" />
            </label>
            <label>
              Result
              <select value={form.result} onChange={set('result')}>
                <option value="">Not stated</option>
                {Object.entries(TEST_RESULTS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Test date
              <input type="date" value={form.tested_on} onChange={set('tested_on')} />
            </label>
            <label>
              Tested by
              <input value={form.tested_by} onChange={set('tested_by')} placeholder="Lab or person" />
            </label>
          </div>
          <fieldset className="report-source">
            <legend>The report</legend>
            <div className="row">
              {canUpload && (
                <label className="inline">
                  <input type="radio" name="source" value="file" checked={form.source === 'file'} onChange={set('source')} /> Upload a PDF
                </label>
              )}
              <label className="inline">
                <input type="radio" name="source" value="link" checked={form.source === 'link'} onChange={set('source')} /> Link to a PDF
              </label>
            </div>
            {form.source === 'file' ? (
              <input ref={fileInput} type="file" accept={PDF} aria-label="Report PDF" />
            ) : (
              <input type="url" required value={form.url} onChange={set('url')} placeholder="https://drive.google.com/…" aria-label="Report link" />
            )}
          </fieldset>
          <label>
            Notes
            <textarea rows={2} value={form.notes} onChange={set('notes')} />
          </label>
          <div className="row">
            <button className="btn primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save test result'}
            </button>
            <button type="button" className="btn ghost" onClick={() => setForm(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {reportList.length > 0 && (
        <ul className="test-reports" aria-label="Test reports">
          {reportList.map((r) => (
            <li key={r.id}>
              <div className="row between">
                <div>
                  <strong>{r.title}</strong>
                  {r.result && (
                    <>
                      {' '}
                      <StatusBadge status={{ label: TEST_RESULTS[r.result], tone: RESULT_TONES[r.result] }} />
                    </>
                  )}
                  <div className="muted small">
                    {[r.tested_on && formatDate(r.tested_on), r.tested_by, r.project_name && `from ${r.project_name}`].filter(Boolean).join(' · ') || `Added ${formatDateTime(r.created_at)}`}
                  </div>
                  {r.notes && <p className="small">{r.notes}</p>}
                </div>
                {editable && (
                  <button className="btn ghost small" onClick={() => remove(r)} disabled={busy} aria-label={`Remove ${r.title}`}>
                    Remove
                  </button>
                )}
              </div>
              <Attachments entityType="test_report" entityId={r.id} attachments={r.attachments} editable={editable} onChange={reports.reload} compact accept={PDF} />
            </li>
          ))}
        </ul>
      )}

      <h3 className="pad-h test-results-sub">From Odyssey</h3>
      {lastSync && <p className="muted small pad-h">Odyssey data from {formatDateTime(lastSync)}</p>}
      {sessionList.length === 0 ? (
        <p className="muted pad">{reportList.length ? 'No Odyssey test sessions for this product.' : 'No test results for this product yet.'}</p>
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
              {sessionList.map((s) => {
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
