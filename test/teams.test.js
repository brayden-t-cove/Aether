import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

// Made-up people wearing several hats: a product developer who is also in leadership, a designer, a tester.
describe.skipIf(!TEST_DATABASE_URL)('teams, project people and My work', () => {
  let db, admin, lead, designer, tester, viewer, project;

  beforeAll(async () => {
    db = await setupDb();
    const app = makeApp(db);
    admin = await signedInAgent(app, db, { email: 'boss@example.com', role: 'admin', name: 'Boss' });
    lead = await signedInAgent(app, db, { email: 'lead@example.com', role: 'editor', name: 'Lee' });
    designer = await signedInAgent(app, db, { email: 'des@example.com', role: 'editor', name: 'Dee' });
    tester = await signedInAgent(app, db, { email: 'test@example.com', role: 'editor', name: 'Tess' });
    viewer = await signedInAgent(app, db, { email: 'viv@example.com', name: 'Viv' });
    await admin.agent.patch(`/api/admin/users/${lead.user.id}`).send({ teams: ['leadership', 'product_development'] }).expect(200);
    await admin.agent.patch(`/api/admin/users/${designer.user.id}`).send({ teams: ['design'] }).expect(200);
    await admin.agent.patch(`/api/admin/users/${tester.user.id}`).send({ teams: ['product_development'] }).expect(200);
  });
  afterAll(() => db?.end());

  it('starts a project with its people: the creator, the owner, and anyone picked', async () => {
    await lead.agent.post('/api/projects').send({ name: 'Bad', member_ids: ['nope'] }).expect(400);
    const { body } = await lead.agent
      .post('/api/projects')
      .send({ name: 'Porch Cam launch', owner_id: tester.user.id, member_ids: [designer.user.id] })
      .expect(201);
    project = body.project;
    const { body: p } = await viewer.agent.get(`/api/projects/${project.id}`).expect(200);
    expect(p.members.map((m) => [m.name, m.teams])).toEqual([
      ['Dee', ['design']],
      ['Lee', ['leadership', 'product_development']],
      ['Tess', ['product_development']],
    ]);
  });

  it('changes the people on a project, logging who was added and removed', async () => {
    await viewer.agent.put(`/api/projects/${project.id}/members`).send({ user_ids: [] }).expect(403);
    await lead.agent.put(`/api/projects/${project.id}/members`).send({ user_ids: ['00000000-0000-0000-0000-000000000000'] }).expect(400);
    const { body } = await lead.agent.put(`/api/projects/${project.id}/members`).send({ user_ids: [lead.user.id, designer.user.id, viewer.user.id] }).expect(200);
    expect(body.members.map((m) => m.name)).toEqual(['Dee', 'Lee', 'Viv']);
    const { body: p } = await viewer.agent.get(`/api/projects/${project.id}`).expect(200);
    expect(p.activity.find((a) => a.action === 'members_updated').changes).toMatchObject({ added: ['Viv'], removed: ['Tess'] });
  });

  it('gives each item a team from its category, which can be changed, and follows a new category unless picked by hand', async () => {
    const add = async (fields) => (await lead.agent.post(`/api/projects/${project.id}/items`).send(fields).expect(201)).body.item;
    const box = await add({ title: 'Retail box artwork', category: 'packaging' });
    const drop = await add({ title: 'Drop test', category: 'testing' });
    const misc = await add({ title: 'Pricing sign-off' });
    const nobody = await add({ title: 'Loose end', team: null });
    expect([box.team, drop.team, misc.team, nobody.team]).toEqual(['design', 'product_development', 'leadership', null]);
    await lead.agent.post(`/api/projects/${project.id}/items`).send({ title: 'x', team: 'marketing' }).expect(400);

    // Category changes: the team follows while it was the default…
    const { body: moved } = await lead.agent.patch(`/api/items/${misc.id}`).send({ category: 'listing' }).expect(200);
    expect(moved.item.team).toBe('ecommerce');
    // …but not once someone picked a team.
    await lead.agent.patch(`/api/items/${box.id}`).send({ team: 'product_development' }).expect(200);
    const { body: kept } = await lead.agent.patch(`/api/items/${box.id}`).send({ category: 'design' }).expect(200);
    expect(kept.item.team).toBe('product_development');
    await lead.agent.patch(`/api/items/${box.id}`).send({ team: 'design' }).expect(200);
  });

  it('adds whoever is given an item to the project’s people', async () => {
    const { body: p } = await viewer.agent.get(`/api/projects/${project.id}`).expect(200);
    const drop = p.items.find((i) => i.title === 'Drop test');
    await lead.agent.patch(`/api/items/${drop.id}`).send({ owner_id: tester.user.id }).expect(200);
    const { body: after } = await viewer.agent.get(`/api/projects/${project.id}`).expect(200);
    expect(after.members.map((m) => m.name)).toContain('Tess');
  });

  it('shows each person their items, their teams’ unclaimed work, and their teammates’ work, across projects', async () => {
    const { body: dee } = await designer.agent.get('/api/my-work').expect(200);
    expect(dee.teams).toEqual(['design']);
    expect(dee.mine).toEqual([]);
    expect(dee.unclaimed.map((i) => i.title)).toEqual(['Retail box artwork']);
    expect(dee.projects.map((p) => [p.name, p.open_items, p.my_items])).toEqual([['Porch Cam launch', 4, 0]]);

    // Lee is on two teams, so sees Product Development's work too: Tess has the drop test.
    const { body: lee } = await lead.agent.get('/api/my-work').expect(200);
    expect(lee.teams).toEqual(['leadership', 'product_development']);
    expect(lee.unclaimed.map((i) => i.title)).toEqual([]);
    expect(lee.teammates.map((i) => [i.title, i.owner_name])).toEqual([['Drop test', 'Tess']]);

    // Anyone can look at another person's or another team's work.
    const { body: tess } = await viewer.agent.get(`/api/my-work?user=${tester.user.id}`).expect(200);
    expect(tess.mine.map((i) => i.title)).toEqual(['Drop test']);
    const { body: design } = await viewer.agent.get('/api/my-work?team=design').expect(200);
    expect(design.unclaimed.map((i) => i.title)).toEqual(['Retail box artwork']);
  });

  it('takes an unclaimed item: it becomes theirs and leaves the team’s unclaimed list', async () => {
    const { body: before } = await designer.agent.get('/api/my-work').expect(200);
    await designer.agent.patch(`/api/items/${before.unclaimed[0].id}`).send({ owner_id: designer.user.id }).expect(200);
    const { body } = await designer.agent.get('/api/my-work').expect(200);
    expect(body.mine.map((i) => i.title)).toEqual(['Retail box artwork']);
    expect(body.unclaimed).toEqual([]);
  });

  it('lists design requests for Design: their own and the ones nobody has taken', async () => {
    await lead.agent.post('/api/design-requests').send({ title: 'Lifestyle shot' }).expect(201);
    await lead.agent.post('/api/design-requests').send({ title: 'Banner', assignee_id: designer.user.id }).expect(201);
    const { body } = await designer.agent.get('/api/my-work').expect(200);
    expect(body.requests.map((r) => r.title).sort()).toEqual(['Banner', 'Lifestyle shot']);
    const { body: tess } = await tester.agent.get('/api/my-work').expect(200);
    expect(tess.requests).toEqual([]);
  });
});
