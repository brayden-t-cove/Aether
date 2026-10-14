/**
 * HTTP client for Asana's REST API, read-only. Authenticates with a personal access token (ASANA_TOKEN) sent as a
 * Bearer token; everything Aether reads is what that token's owner can see. Returns null when Asana isn't set up.
 */
export const ASANA_API_URL = 'https://app.asana.com/api/1.0';

export function createAsanaClient({ token, apiUrl = ASANA_API_URL, timeoutMs = 15000 } = {}) {
  if (!token) return null;
  const base = (apiUrl || ASANA_API_URL).replace(/\/$/, '');

  async function request(path, params = {}, what = 'that') {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
    let res;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new Error(`Couldn't reach Asana (${err.name === 'TimeoutError' ? 'timed out' : err.message})`, { cause: err });
    }
    const body = await res.json().catch(() => null);
    if (res.status === 401) throw Object.assign(new Error('Asana refused the token (check ASANA_TOKEN)'), { status: 401 });
    if (res.status === 403 || res.status === 404) {
      throw Object.assign(new Error(`Asana couldn't find ${what}, or the token's owner can't see it`), { status: 404 });
    }
    if (res.status === 429) throw Object.assign(new Error('Asana is rate-limiting requests. Try again in a minute.'), { status: 429 });
    if (!res.ok || !body) throw new Error(`Asana returned ${res.status}${body?.errors?.[0]?.message ? `: ${body.errors[0].message}` : ''}`);
    return body;
  }

  // Lists come a page at a time; follow next_page until done.
  async function all(path, params, what) {
    const out = [];
    let offset;
    for (let page = 0; page < 50; page++) {
      const body = await request(path, { ...params, limit: 100, offset }, what);
      out.push(...(body.data || []));
      offset = body.next_page?.offset;
      if (!offset) break;
    }
    return out;
  }

  return {
    url: base,
    getProject: async (gid) => (await request(`/projects/${gid}`, { opt_fields: 'name,permalink_url' }, 'that project')).data,
    /** A project's top-level tasks, with the board column (section) each sits in for that project. */
    listProjectTasks: (gid) =>
      all(
        `/projects/${gid}/tasks`,
        { opt_fields: 'name,completed,permalink_url,due_on,assignee.name,assignee.email,memberships.project.gid,memberships.section.name' },
        'that project',
      ),
    getTask: async (gid) => (await request(`/tasks/${gid}`, { opt_fields: 'name,completed,permalink_url' }, 'that task')).data,
    /** The comments on a task, oldest first: stories of type comment_added, not "X changed the due date". */
    listComments: async (gid) =>
      (await all(`/tasks/${gid}/stories`, { opt_fields: 'resource_subtype,text,created_at,created_by.name,created_by.email' }, 'that task')).filter(
        (s) => s.resource_subtype === 'comment_added',
      ),
  };
}

/**
 * The project and task IDs in an Asana link, or a bare ID. Handles both link styles:
 *   https://app.asana.com/0/<project>/<task>        (and /0/<project>/list, /board…)
 *   https://app.asana.com/1/<workspace>/project/<project>/task/<task>   (and /1/<workspace>/task/<task>)
 * → { projectGid, taskGid, gid } where gid is a bare ID given on its own.
 */
export function parseAsanaLink(input) {
  const text = String(input ?? '').trim();
  if (/^\d{4,}$/.test(text)) return { gid: text };
  let url;
  try {
    url = new URL(text);
  } catch {
    return {};
  }
  if (!/(^|\.)asana\.com$/.test(url.hostname)) return {};
  const parts = url.pathname.split('/').filter(Boolean);
  const out = {};
  if (parts[0] === '0') {
    if (/^\d+$/.test(parts[1] ?? '') && parts[1] !== '0') out.projectGid = parts[1];
    if (/^\d+$/.test(parts[2] ?? '')) out.taskGid = parts[2];
  } else {
    const after = (word) => {
      const i = parts.indexOf(word);
      return i >= 0 && /^\d+$/.test(parts[i + 1] ?? '') ? parts[i + 1] : undefined;
    };
    if (after('project')) out.projectGid = after('project');
    if (after('task') || after('item')) out.taskGid = after('task') || after('item');
  }
  return out;
}
