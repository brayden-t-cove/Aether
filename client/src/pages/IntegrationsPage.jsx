import { useState } from 'react';
import { api } from '../lib/api.js';
import { useLoad } from '../lib/useLoad.js';
import { formatDateTime } from '../lib/format.js';
import ErrorNote from '../components/ErrorNote.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

const on = (ok, yes = 'Connected', no = 'Not set up') => ({ label: ok ? yes : no, tone: ok ? 'good' : 'neutral' });

function Action({ label, path, onDone }) {
  const [state, setState] = useState(null);
  return (
    <span className="row">
      <button
        className="btn small"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          try {
            const res = await api(path, { method: 'POST' });
            setState({ ok: true, text: res.message || 'Done' });
            onDone?.();
          } catch (err) {
            setState({ ok: false, text: err.message });
          }
        }}
      >
        {state === 'busy' ? 'Working…' : label}
      </button>
      {state && state !== 'busy' && <span className={`small ${state.ok ? 'muted' : 'error-text'}`}>{state.text}</span>}
    </span>
  );
}

export default function IntegrationsPage() {
  const { data, error, reload } = useLoad('/api/admin/integrations');
  // After authorizing the TikTok shop, TikTok sends the admin back here with ?tiktok=connected (or why it failed).
  const tiktokNotice = new URLSearchParams(window.location.search).get('tiktok');

  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><p className="muted">Loading…</p></div>;
  const { app, odyssey, asana, amazon, tiktok, slack, uploads, database } = data;

  return (
    <div className="page narrow-ish">
      <header className="page-header">
        <h1>Integrations</h1>
        <p className="muted">What Aether is connected to. Settings are environment variables on the server (Railway → Aether → Variables); see the README.</p>
      </header>

      <section className="card">
        <div className="row between">
          <h2>Odyssey</h2>
          <StatusBadge status={on(odyssey.configured)} />
        </div>
        {odyssey.configured ? (
          <>
            <p className="small">
              Syncing products, test sessions and vendors from <strong>{odyssey.url}</strong> every {odyssey.syncMinutes} minutes.
              {odyssey.lastSuccessAt ? ` Last successful sync ${formatDateTime(odyssey.lastSuccessAt)}.` : ' No successful sync yet.'}
            </p>
            <Action label="Sync now" path="/api/odyssey/sync" onDone={reload} />
            {odyssey.runs.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>By</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {odyssey.runs.map((r) => (
                      <tr key={r.id}>
                        <td className="small">{formatDateTime(r.started_at)}</td>
                        <td className="small">{r.started_by_name || (r.trigger === 'history' ? 'Past returns' : 'Schedule')}</td>
                        <td className="small">
                          {r.ok === false ? (
                            <span className="error-text">{r.error}</span>
                          ) : r.ok ? (
                            `${r.products_created} new, ${r.products_linked} linked, ${r.products_updated} updated products · ${r.sessions_synced} sessions · ${r.vendors_created + r.vendors_updated} vendor changes`
                          ) : (
                            'Running…'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="muted small">
            Set <code>ODYSSEY_API_URL</code> and <code>ODYSSEY_API_KEY</code>. Odyssey needs a small change to accept the key; see <code>docs/ODYSSEY_API.md</code>.
          </p>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h2>Amazon returns</h2>
          <StatusBadge status={on(amazon.configured)} />
        </div>
        {amazon.configured ? (
          <>
            <p className="small">
              Read-only. Imports the FBA customer returns report every {amazon.syncHours} hours, over the last two weeks, through the same import as an upload
              (duplicates skipped). Marketplace {amazon.marketplaceId}.
              {amazon.lastSuccessAt ? ` Last successful import ${formatDateTime(amazon.lastSuccessAt)}.` : ' No successful import yet.'}
            </p>
            <Action label="Import now" path="/api/returns/auto-imports/amazon" onDone={reload} />
            {amazon.runs.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>By</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {amazon.runs.map((r) => (
                      <tr key={r.id}>
                        <td className="small">{formatDateTime(r.started_at)}</td>
                        <td className="small">{r.started_by_name || (r.trigger === 'history' ? 'Past returns' : 'Schedule')}</td>
                        <td className="small">
                          {r.ok === null ? 'Running…' : r.ok ? `${r.returns_created} new of ${r.rows_read} rows` : <span className="error-text">{r.error}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="muted small">
            Set <code>AMAZON_SP_CLIENT_ID</code>, <code>AMAZON_SP_CLIENT_SECRET</code> and <code>AMAZON_SP_REFRESH_TOKEN</code> from a private app in
            Seller Central (Apps and Services → Develop Apps) with the Amazon Fulfillment role. See docs/MARKETPLACE_APIS.md.
          </p>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h2>TikTok returns</h2>
          <StatusBadge status={on(tiktok.configured && tiktok.authorized, 'Connected', tiktok.configured ? 'Shop not authorized' : 'Not set up')} />
        </div>
        {tiktokNotice && <p className={`small ${tiktokNotice === 'connected' ? '' : 'error-text'}`}>{tiktokNotice === 'connected' ? 'The TikTok shop is connected.' : tiktokNotice}</p>}
        {!tiktok.configured ? (
          <p className="muted small">
            Set <code>TIKTOK_APP_KEY</code> and <code>TIKTOK_APP_SECRET</code> from an app in TikTok Shop Partner Center with the Return &amp; Refund scope.
            See docs/MARKETPLACE_APIS.md.
          </p>
        ) : !tiktok.authorized ? (
          <div className="small stack-tight">
            <p>To finish, an admin authorizes the shop for Aether:</p>
            <ol>
              <li>
                In Partner Center, set the app's redirect URL to <code>{tiktok.callbackUrl}</code>.
              </li>
              <li>Open the app's authorization link (Partner Center → the app → Authorize), signed in to Aether here as an admin, and approve it for the shop.</li>
              <li>TikTok sends you back here, and this card shows Connected.</li>
            </ol>
          </div>
        ) : (
          <>
            <p className="small">
              Read-only. Imports {tiktok.shop || 'the shop'}'s returns every {tiktok.syncHours} hours, over the last two weeks, through the same import as an
              upload (duplicates skipped).
              {tiktok.lastSuccessAt ? ` Last successful import ${formatDateTime(tiktok.lastSuccessAt)}.` : ' No successful import yet.'}
            </p>
            <Action label="Import now" path="/api/returns/auto-imports/tiktok" onDone={reload} />
            {tiktok.runs.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>By</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tiktok.runs.map((r) => (
                      <tr key={r.id}>
                        <td className="small">{formatDateTime(r.started_at)}</td>
                        <td className="small">{r.started_by_name || (r.trigger === 'history' ? 'Past returns' : 'Schedule')}</td>
                        <td className="small">
                          {r.ok === null ? 'Running…' : r.ok ? `${r.returns_created} new of ${r.rows_read} rows` : <span className="error-text">{r.error}</span>}
                          {r.detail && <div className="muted">{r.detail}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h2>Asana</h2>
          <StatusBadge status={on(asana.configured)} />
        </div>
        {asana.configured ? (
          <>
            <p className="small">
              Read-only. Comments on Asana tasks linked to checklist items are pulled into the items' updates every {asana.syncMinutes} minutes.{' '}
              {asana.linked.projects} project{asana.linked.projects === 1 ? '' : 's'} and {asana.linked.items} item{asana.linked.items === 1 ? '' : 's'} linked.
              {asana.lastSuccessAt ? ` Last successful pull ${formatDateTime(asana.lastSuccessAt)}.` : ' No successful pull yet.'}
            </p>
            <Action label="Pull from Asana" path="/api/asana/pull" onDone={reload} />
            {asana.runs.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>By</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {asana.runs.map((r) => (
                      <tr key={r.id}>
                        <td className="small">{formatDateTime(r.started_at)}</td>
                        <td className="small">{r.started_by_name || (r.trigger === 'history' ? 'Past returns' : 'Schedule')}</td>
                        <td className="small">
                          {r.ok === null ? 'Running…' : `${r.comments_synced} new comment${r.comments_synced === 1 ? '' : 's'}`}
                          {r.error && <div className="error-text">{r.error}</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : (
          <p className="muted small">
            Set <code>ASANA_TOKEN</code> to a personal access token (Asana → Settings → Apps → Developer apps). Aether only reads: it sees what that
            person can see in Asana.
          </p>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h2>Slack</h2>
          <StatusBadge status={on(slack.configured)} />
        </div>
        {slack.configured ? (
          <>
            <p className="small">
              Posts when items are blocked, certifications are certified or rejected, manuals are ready for review or approved, design work is delivered, returns are
              imported, and when Odyssey sync starts failing. A daily digest goes out after {slack.digestHourUtc}:00 UTC
              {slack.lastDigestDate ? ` (last sent ${slack.lastDigestDate})` : ''}.
            </p>
            <div className="row">
              <Action label="Send a test message" path="/api/admin/integrations/slack-test" />
              <Action label="Send today's digest now" path="/api/admin/integrations/digest" onDone={reload} />
            </div>
          </>
        ) : (
          <p className="muted small">
            Create an incoming webhook in Slack (Apps → Incoming Webhooks → Add to a channel) and set <code>SLACK_WEBHOOK_URL</code>.
          </p>
        )}
      </section>

      <section className="card">
        <div className="row between">
          <h2>File uploads</h2>
          <StatusBadge status={on(uploads.enabled, 'On', 'Links only')} />
        </div>
        <p className="muted small">
          {uploads.enabled
            ? `Uploads up to ${uploads.maxUploadMb} MB are stored on the server's volume.`
            : 'Attach a Railway volume at /data and set FILES_DIR=/data/files to allow uploads. Links work either way.'}
        </p>
      </section>

      <section className="card">
        <h2>About this server</h2>
        <dl className="details">
          <dt>Environment</dt>
          <dd>{app.env}</dd>
          <dt>Version</dt>
          <dd>{app.version}</dd>
          <dt>Address</dt>
          <dd>{app.publicUrl}</dd>
          <dt>Google sign-in</dt>
          <dd>{app.googleSignIn ? 'On' : 'Off'}</dd>
          <dt>Database</dt>
          <dd>
            {database.migrations.length} migrations applied, latest {database.migrations.at(-1)?.name}
          </dd>
        </dl>
      </section>
    </div>
  );
}
