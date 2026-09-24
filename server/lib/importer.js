/**
 * Bulk import of products and projects.
 *
 * Accepts rows as they come out of a spreadsheet (any column order, loose
 * headers like "Odyssey_Name" or "Launch Date", "--" for blanks, the team's
 * own words like "Development") and turns them into Aether records.
 *
 * planImport() never writes: it returns what would happen, row by row, so the
 * UI can show a preview. runImport() applies the same plan in one transaction.
 */
import { ITEM_CATEGORIES, PROJECT_TYPES, STATES } from '../../shared/workflow.js';
import { logActivity } from './activity.js';
import { createProduct, setProductMarkets, updateProduct } from './products.js';
import { createProject } from './projects.js';
import { createItem } from './items.js';

export const MAX_ROWS = 1000;

const BLANKS = new Set(['', '-', '--', '—', 'n/a', 'na', 'none', 'tbd', 'unknown', '?']);
const clean = (value) => {
  if (value === null || value === undefined) return '';
  const s = String(value).trim();
  return BLANKS.has(s.toLowerCase()) ? '' : s;
};
const key = (header) => String(header).toLowerCase().replace(/[^a-z0-9]/g, '');
const splitList = (value) =>
  clean(value)
    .split(/[;,/|]/)
    .map((x) => x.trim())
    .filter((x) => x && !BLANKS.has(x.toLowerCase()));

// Header spellings → product field.
const PRODUCT_HEADERS = {
  name: ['name', 'product', 'productname'],
  model: ['model', 'modelnumber', 'modelno', 'odysseyname', 'odyssey'],
  sku: ['sku'],
  category: ['category', 'type'],
  manufacturer: ['manufacturer', 'vendor', 'factory', 'oem', 'supplier'],
  lifecycle: ['lifecycle', 'status', 'stage'],
  launch_date: ['launchdate', 'launch', 'launched'],
  sunset_date: ['sunsetdate', 'sunset', 'discontinueddate', 'eoldate'],
  markets: ['markets', 'market', 'soldin', 'countries', 'regions'],
  channels: ['channels', 'channel', 'saleschannels'],
  replaces: ['replaces', 'replacing'],
  notes: ['notes', 'note', 'comments'],
};

const LIFECYCLE_WORDS = {
  active: ['active', 'selling', 'live', 'onsale', 'current'],
  upcoming: ['upcoming', 'development', 'indevelopment', 'dev', 'planned', 'pipeline', 'new', 'prelaunch'],
  sunset: ['sunset', 'discontinued', 'eol', 'endoflife', 'retired', 'inactive'],
};

const CHANNEL_NAMES = { amazon: 'Amazon', tiktok: 'TikTok', tiktokshop: 'TikTok', walmart: 'Walmart', shopify: 'Shopify', website: 'Website' };

// Common ways people write market names → market code.
const MARKET_ALIASES = {
  usa: 'US', unitedstates: 'US', america: 'US',
  canada: 'CA',
  mex: 'MX', mexico: 'MX',
  gb: 'UK', greatbritain: 'UK', unitedkingdom: 'UK', england: 'UK',
  europe: 'EU', europeanunion: 'EU',
  southafrica: 'ZA', sa: 'ZA', rsa: 'ZA',
  australia: 'AU', aus: 'AU',
};

function pick(raw, aliases) {
  for (const [header, value] of Object.entries(raw || {})) {
    if (aliases.includes(key(header))) return value;
  }
  return undefined;
}

function parseLifecycle(value) {
  const k = key(value);
  return Object.keys(LIFECYCLE_WORDS).find((lc) => LIFECYCLE_WORDS[lc].includes(k)) || null;
}

/** 'YYYY-MM-DD' or 'M/D/YYYY' → 'YYYY-MM-DD'; null if blank; undefined if unreadable. */
function parseDate(value) {
  const s = clean(value);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return undefined;
}

function normalizeChannel(value) {
  return CHANNEL_NAMES[key(value)] || value.replace(/^\w/, (c) => c.toUpperCase());
}

async function loadContext(db) {
  const [products, markets, users, projects] = await Promise.all([
    db.query('SELECT id, name, model, sku FROM products'),
    db.query('SELECT id, code, name FROM markets'),
    db.query('SELECT id, email FROM users WHERE active'),
    db.query('SELECT id, name FROM projects'),
  ]);
  const marketByKey = new Map();
  for (const m of markets.rows) {
    marketByKey.set(key(m.code), m);
    marketByKey.set(key(m.name), m);
  }
  return {
    products: products.rows,
    marketByKey,
    userByEmail: new Map(users.rows.map((u) => [u.email.toLowerCase(), u])),
    projectNames: new Set(projects.rows.map((p) => p.name.toLowerCase())),
  };
}

function findMarket(ctx, value) {
  const k = key(value);
  return ctx.marketByKey.get(k) || ctx.marketByKey.get(key(MARKET_ALIASES[k] || '')) || null;
}

/** Find an existing product by model, then SKU, then name (case-insensitive). */
function findProduct(products, { model, sku, name }) {
  const lower = (s) => (s || '').toLowerCase();
  return (
    (model && products.find((p) => lower(p.model) === lower(model))) ||
    (sku && products.find((p) => lower(p.sku) === lower(sku))) ||
    (name && products.find((p) => lower(p.name) === lower(name))) ||
    null
  );
}

function planProduct(raw, ctx, seen) {
  const warnings = [];
  const get = (field) => pick(raw, PRODUCT_HEADERS[field]);
  const name = clean(get('name'));
  if (!name) return { action: 'error', name: '(no name)', error: 'Missing product name', warnings };

  const fields = { name };
  for (const f of ['model', 'sku', 'category', 'manufacturer', 'notes']) {
    const value = clean(get(f));
    if (value) fields[f] = value;
  }

  const lifecycleRaw = clean(get('lifecycle'));
  if (lifecycleRaw) {
    const lifecycle = parseLifecycle(lifecycleRaw);
    if (!lifecycle) return { action: 'error', name, error: `Unknown lifecycle "${lifecycleRaw}"`, warnings };
    fields.lifecycle = lifecycle;
  }

  for (const f of ['launch_date', 'sunset_date']) {
    const raw_ = get(f);
    const date = parseDate(raw_);
    if (date === undefined) warnings.push(`Couldn't read ${f.replace('_', ' ')} "${clean(raw_)}", left blank`);
    else if (date) fields[f] = date;
  }

  const channels = splitList(get('channels')).map(normalizeChannel);
  if (channels.length) fields.channels = [...new Set(channels)];

  let marketIds;
  const marketValues = splitList(get('markets'));
  if (marketValues.length) {
    marketIds = [];
    for (const value of marketValues) {
      const market = findMarket(ctx, value);
      if (market) marketIds.push(market.id);
      else warnings.push(`Unknown market "${value}", skipped. Add it under Markets first.`);
    }
    marketIds = [...new Set(marketIds)];
  }

  const replaces = clean(get('replaces')) || null;

  const identity = (fields.model || fields.sku || name).toLowerCase();
  if (seen.has(identity)) return { action: 'error', name, error: 'Listed twice in this import', warnings };
  seen.add(identity);

  const existing = findProduct(ctx.products, fields);
  return {
    action: existing ? 'update' : 'create',
    name,
    model: fields.model || null,
    existingId: existing?.id || null,
    fields,
    marketIds,
    replaces,
    warnings,
  };
}

function hasCycle(items) {
  const byTitle = new Map(items.map((i) => [i.title.toLowerCase(), i]));
  const state = new Map(); // 1 = visiting, 2 = done
  const visit = (item) => {
    const k = item.title.toLowerCase();
    if (state.get(k) === 1) return true;
    if (state.get(k) === 2) return false;
    state.set(k, 1);
    for (const t of item.waitsOn) if (byTitle.has(t) && visit(byTitle.get(t))) return true;
    state.set(k, 2);
    return false;
  };
  return items.some(visit);
}

function planProject(raw, ctx, plannedProducts, seen) {
  const warnings = [];
  const name = clean(raw?.name);
  if (!name) return { action: 'error', name: '(no name)', error: 'Missing project name', warnings };
  if (seen.has(name.toLowerCase())) return { action: 'error', name, error: 'Listed twice in this import', warnings };
  seen.add(name.toLowerCase());
  if (ctx.projectNames.has(name.toLowerCase())) {
    return { action: 'skip', name, reason: 'A project with this name already exists', warnings };
  }

  const type = clean(raw.type) || 'other';
  if (!Object.hasOwn(PROJECT_TYPES, type)) return { action: 'error', name, error: `Unknown project type "${type}"`, warnings };
  const state = clean(raw.state) || 'not_started';
  if (!STATES.includes(state)) return { action: 'error', name, error: `Unknown state "${state}"`, warnings };

  const productRef = clean(raw.product);
  if (productRef && !findProduct([...ctx.products, ...plannedProducts], { model: productRef, name: productRef })) {
    warnings.push(`Product "${productRef}" not found, project will have no product`);
  }
  let marketId = null;
  if (clean(raw.market)) {
    marketId = findMarket(ctx, raw.market)?.id || null;
    if (!marketId) warnings.push(`Market "${raw.market}" not found, project will have no market`);
  }

  const owner = (email) => {
    const e = clean(email).toLowerCase();
    if (!e) return null;
    const user = ctx.userByEmail.get(e);
    if (!user) warnings.push(`No active user ${e}, left unassigned. Invite them, then reassign.`);
    return user?.id || null;
  };

  const targetDate = parseDate(raw.target_date);
  if (targetDate === undefined) warnings.push(`Couldn't read target date "${raw.target_date}"`);

  const items = [];
  for (const it of Array.isArray(raw.items) ? raw.items : []) {
    const title = clean(it?.title);
    if (!title) {
      warnings.push('Skipped a checklist item with no title');
      continue;
    }
    const category = Object.hasOwn(ITEM_CATEGORIES, clean(it.category)) ? clean(it.category) : 'other';
    let itemState = clean(it.state) || 'not_started';
    if (!STATES.includes(itemState)) {
      warnings.push(`"${title}": unknown state "${it.state}", set to Not started`);
      itemState = 'not_started';
    }
    const due = parseDate(it.due_date);
    if (due === undefined) warnings.push(`"${title}": couldn't read due date "${it.due_date}"`);
    items.push({
      title,
      category,
      state: itemState,
      owner_id: owner(it.owner),
      due_date: due || null,
      notes: clean(it.notes),
      waitsOn: (Array.isArray(it.waits_on) ? it.waits_on : []).map(clean).filter(Boolean),
    });
  }

  // From here on waitsOn holds lower-cased titles that exist in this project.
  const titles = new Set(items.map((i) => i.title.toLowerCase()));
  for (const item of items) {
    for (const t of item.waitsOn) if (!titles.has(t.toLowerCase())) warnings.push(`"${item.title}" waits on "${t}", which isn't in this project`);
    item.waitsOn = item.waitsOn.map((t) => t.toLowerCase()).filter((t) => titles.has(t));
  }
  if (hasCycle(items)) return { action: 'error', name, error: 'Checklist items wait on each other in a loop', warnings };

  // Keep the "can't be done while waiting" rule: an item marked done must not wait on open items.
  const stateOf = new Map(items.map((i) => [i.title.toLowerCase(), i.state]));
  for (const item of items) {
    if (item.state === 'done' && item.waitsOn.some((t) => stateOf.get(t) !== 'done')) {
      warnings.push(`"${item.title}" is marked done but waits on open items, imported as In review`);
      item.state = 'in_review';
    }
  }

  return {
    action: 'create',
    name,
    fields: {
      name,
      type,
      state,
      market_id: marketId,
      owner_id: owner(raw.owner),
      target_date: targetDate || null,
      description: clean(raw.description),
    },
    productRef: productRef || null,
    items,
    warnings,
  };
}

/** Work out what an import would do, without writing anything. */
export async function planImport(db, { products = [], projects = [] } = {}) {
  const ctx = await loadContext(db);
  const seenProducts = new Set();
  const productPlans = products.map((row) => planProduct(row, ctx, seenProducts));
  const planned = productPlans.filter((p) => p.fields).map((p) => ({ id: null, name: p.fields.name, model: p.fields.model }));

  for (const plan of productPlans) {
    if (plan.replaces && !findProduct([...ctx.products, ...planned], { model: plan.replaces, name: plan.replaces })) {
      plan.warnings.push(`Replaced product "${plan.replaces}" not found, link skipped`);
      plan.replaces = null;
    }
  }

  const seenProjects = new Set();
  const projectPlans = projects.map((row) => planProject(row, ctx, planned, seenProjects));
  const count = (plans, action) => plans.filter((p) => p.action === action).length;

  return {
    products: productPlans,
    projects: projectPlans,
    summary: {
      productsCreate: count(productPlans, 'create'),
      productsUpdate: count(productPlans, 'update'),
      projectsCreate: count(projectPlans, 'create'),
      projectsSkip: count(projectPlans, 'skip'),
      errors: count(productPlans, 'error') + count(projectPlans, 'error'),
      warnings: [...productPlans, ...projectPlans].reduce((n, p) => n + p.warnings.length, 0),
    },
  };
}

/** Apply a plan. `tx` must be a transaction client. Rows with errors are left out. */
export async function runImport(tx, plan, userId) {
  const idByRef = new Map();
  const remember = (product) => {
    if (product.model) idByRef.set(product.model.toLowerCase(), product.id);
    idByRef.set(product.name.toLowerCase(), product.id);
  };
  const { rows: existing } = await tx.query('SELECT id, name, model FROM products');
  existing.forEach(remember);

  for (const p of plan.products) {
    if (p.action === 'create') {
      const created = await createProduct(tx, p.fields, userId);
      p.id = created.id;
      remember(created);
      await logActivity(tx, { entityType: 'product', entityId: created.id, action: 'created', changes: { label: created.name, imported: true }, userId });
    } else if (p.action === 'update') {
      const { name: _name, ...rest } = p.fields; // keep the existing name when matched by model or SKU
      await updateProduct(tx, p.existingId, rest);
      p.id = p.existingId;
      await logActivity(tx, { entityType: 'product', entityId: p.id, action: 'updated', changes: { label: p.name, imported: true, fields: Object.keys(rest) }, userId });
    } else continue;
    if (p.marketIds) await setProductMarkets(tx, p.id, p.marketIds);
  }

  for (const p of plan.products) {
    if (!p.id || !p.replaces) continue;
    const replacesId = idByRef.get(p.replaces.toLowerCase());
    if (replacesId && replacesId !== p.id) await updateProduct(tx, p.id, { replaces_id: replacesId });
  }

  for (const pr of plan.projects) {
    if (pr.action !== 'create') continue;
    const productId = pr.productRef ? idByRef.get(pr.productRef.toLowerCase()) || null : null;
    const project = await createProject(tx, { ...pr.fields, product_id: productId }, userId);
    pr.id = project.id;

    const idByTitle = new Map();
    for (const [position, item] of pr.items.entries()) {
      const { waitsOn: _w, ...fields } = item;
      const created = await createItem(tx, project.id, { ...fields, position }, userId);
      idByTitle.set(item.title.toLowerCase(), created.id);
    }
    for (const item of pr.items) {
      for (const t of item.waitsOn) {
        await tx.query('INSERT INTO item_dependencies (item_id, blocked_by_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [
          idByTitle.get(item.title.toLowerCase()),
          idByTitle.get(t),
        ]);
      }
    }
    await logActivity(tx, {
      entityType: 'project',
      entityId: project.id,
      action: 'created',
      changes: { label: project.name, imported: true, items: pr.items.length },
      userId,
    });
  }

  return plan;
}
