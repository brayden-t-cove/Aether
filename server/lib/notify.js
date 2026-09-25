/**
 * Slack notifications through an incoming webhook.
 *
 * Sending never throws and never slows a request down: messages go out in
 * the background with a short timeout, and failures are only logged. With no
 * webhook configured every call is a no-op.
 */
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createNotifier({ slack = {}, publicUrl = '', appEnv = 'production' } = {}, { log = console } = {}) {
  const url = slack.webhookUrl;
  const prefix = appEnv === 'production' ? '' : `[${appEnv}] `;
  const link = (path, text) => (publicUrl ? `<${publicUrl}${path}|${esc(text)}>` : `*${esc(text)}*`);

  async function post(text) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: prefix + text }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Slack returned ${res.status}`);
  }

  /** Fire and forget. */
  function send(text) {
    if (!url) return;
    post(text).catch((err) => log.error('[slack]', err.message));
  }

  return {
    enabled: Boolean(url),
    link,
    esc,
    send,
    /** Awaitable version for the admin "send test" button, which should report failures. */
    sendNow: (text) => (url ? post(text) : Promise.reject(new Error('Slack is not set up (SLACK_WEBHOOK_URL)'))),
  };
}

/** The messages Aether sends. Each takes the notifier plus the event's data. */
export const messages = {
  itemBlocked: (n, { item, project, who }) =>
    `🚧 ${n.link(`/projects/${project.id}`, item.title)} was marked *Blocked* in ${n.esc(project.name)} by ${n.esc(who)}${item.notes ? `\n> ${n.esc(item.notes).slice(0, 300)}` : ''}`,
  projectDone: (n, { project, who }) => `✅ ${n.link(`/projects/${project.id}`, project.name)} is done (${n.esc(who)})`,
  certChanged: (n, { cert, state, who }) =>
    `${state === 'certified' ? '✅' : '❌'} ${n.link(`/certifications/${cert.id}`, `${cert.mark} for ${cert.product_name} (${cert.market_code})`)} is *${state === 'certified' ? 'certified' : 'rejected'}* (${n.esc(who)})`,
  versionReview: (n, { doc, version, who }) =>
    `📝 ${n.link(`/manuals/${doc.id}`, `${doc.title} ${version.version}`)} for ${n.esc(doc.product_name)} is ready for review (${n.esc(who)})`,
  versionApproved: (n, { doc, version, who }) => `👍 ${n.link(`/manuals/${doc.id}`, `${doc.title} ${version.version}`)} for ${n.esc(doc.product_name)} was approved by ${n.esc(who)}`,
  requestCreated: (n, { request, who }) =>
    `🎨 New design request: ${n.link(`/design-requests/${request.id}`, request.title)}${request.assignee_name ? ` for ${n.esc(request.assignee_name)}` : ''} (from ${n.esc(who)})`,
  requestDelivered: (n, { request, who }) => `🎨 ${n.link(`/design-requests/${request.id}`, request.title)} was delivered by ${n.esc(who)} and is waiting for approval`,
  returnsImported: (n, { count, units, channel, who }) => `📦 ${n.esc(who)} imported ${count} ${n.esc(channel)} returns (${units} units). ${n.link('/returns', 'See returns')}`,
  syncFailed: (n, { error }) => `⚠️ Aether couldn't sync with Odyssey: ${n.esc(error)}. Aether is showing its last copy.`,
};
