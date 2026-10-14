/**
 * A stand-in for Asana's REST API (the few read endpoints Aether uses), with made-up data. Lists come back a page at a
 * time like the real API, so paging is exercised. Mutate `data` to change what it serves.
 */
import express from 'express';

export function sampleAsanaData() {
  const story = (gid, text, name, email, at, subtype = 'comment_added') => ({
    gid,
    resource_subtype: subtype,
    text,
    created_at: at,
    created_by: { name, email },
  });
  return {
    projects: {
      1001: { gid: '1001', name: 'Sample Cam · UK launch', permalink_url: 'https://app.asana.com/0/1001/list', tasks: ['2001', '2002', '2003'] },
    },
    tasks: {
      2001: {
        gid: '2001',
        name: 'Book UKCA testing',
        completed: false,
        permalink_url: 'https://app.asana.com/0/1001/2001',
        assignee: { name: 'Pat Expansion' },
        stories: [
          story('3001', 'Asked two labs for quotes.', 'Pat Expansion', 'pat@example.com', '2026-10-01T15:00:00Z'),
          story('3002', 'Pat Expansion changed the due date', 'Pat Expansion', 'pat@example.com', '2026-10-02T15:00:00Z', 'due_date_changed'),
          story('3003', 'Lab B can start on the 20th.', 'Sam Outside', 'sam@lab.example', '2026-10-03T15:00:00Z'),
        ],
      },
      2002: { gid: '2002', name: 'Translate the manual', completed: false, permalink_url: 'https://app.asana.com/0/1001/2002', assignee: null, stories: [] },
      2003: { gid: '2003', name: 'Order UK plugs', completed: true, permalink_url: 'https://app.asana.com/0/1001/2003', assignee: null, stories: [] },
    },
  };
}

export async function startFakeAsana({ port = 0, token = 'asana-test-token', pageSize = 2 } = {}) {
  const data = sampleAsanaData();
  const app = express();

  app.use((req, res, next) => {
    if (req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ errors: [{ message: 'Not Authorized' }] });
    next();
  });

  const page = (req, list) => {
    const limit = Math.min(Number(req.query.limit) || 100, pageSize);
    const start = Number(req.query.offset) || 0;
    const next = start + limit < list.length ? { offset: String(start + limit) } : null;
    return { data: list.slice(start, start + limit), next_page: next };
  };
  const notFound = (res) => res.status(404).json({ errors: [{ message: 'Unknown object' }] });
  const taskOut = ({ stories, ...t }) => t; // eslint-disable-line no-unused-vars

  app.get('/api/1.0/projects/:gid', (req, res) => {
    const p = data.projects[req.params.gid];
    if (!p) return notFound(res);
    res.json({ data: { gid: p.gid, name: p.name, permalink_url: p.permalink_url } });
  });
  app.get('/api/1.0/projects/:gid/tasks', (req, res) => {
    const p = data.projects[req.params.gid];
    if (!p) return notFound(res);
    res.json(page(req, p.tasks.map((gid) => taskOut(data.tasks[gid]))));
  });
  app.get('/api/1.0/tasks/:gid', (req, res) => {
    const t = data.tasks[req.params.gid];
    if (!t) return notFound(res);
    res.json({ data: taskOut(t) });
  });
  app.get('/api/1.0/tasks/:gid/stories', (req, res) => {
    const t = data.tasks[req.params.gid];
    if (!t) return notFound(res);
    res.json(page(req, t.stories));
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/api/1.0`,
    token,
    data,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
