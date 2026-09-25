/**
 * Readiness: for each product × market, where certifications, the manual and
 * the packaging stand. This is the "one view" Phase 2 of the roadmap asks for.
 *
 * A cell's status:
 *   ready       every required mark certified (not expired), manual and packaging approved or sent
 *   attention   a certification was rejected or has expired
 *   in_progress some of it is under way
 *   not_started certifications or documents are on record here, but none has started
 *   not_tracked the product sells or is planned here, but nothing is recorded in Aether yet
 *   null        the product has nothing to do with this market
 */
import { EXPIRY_WARNING_DAYS } from '../../shared/workflow.js';

const DONE_VERSION = new Set(['approved', 'sent']);

function docSummary(docs) {
  if (!docs.length) return null;
  // Prefer the least-finished document, so "ready" means all of them are.
  const ranked = [...docs].sort((a, b) => rank(a.latest_state) - rank(b.latest_state));
  const d = ranked[0];
  return {
    id: d.id,
    title: d.title,
    count: docs.length,
    state: d.latest_state || 'none',
    version: d.latest_version,
    shared: !d.market_id,
  };
}

const RANKS = { none: 0, draft: 1, in_design: 2, in_review: 3, approved: 4, sent: 5 };
const rank = (state) => RANKS[state || 'none'] ?? 0;

export async function getReadiness(db, { productId, includeSunset = false } = {}) {
  const productFilter = productId ? 'WHERE p.id = $1' : includeSunset ? '' : "WHERE p.lifecycle <> 'sunset'";
  const params = productId ? [productId] : [];

  const [products, markets, sells, certs, docs, projects] = await Promise.all([
    db.query(`SELECT p.id, p.name, p.model, p.lifecycle FROM products p ${productFilter}
              ORDER BY CASE p.lifecycle WHEN 'active' THEN 0 WHEN 'upcoming' THEN 1 ELSE 2 END, p.name`, params),
    db.query('SELECT id, code, name, required_marks FROM markets ORDER BY code'),
    db.query('SELECT product_id, market_id FROM product_markets'),
    db.query(`SELECT c.id, c.product_id, c.market_id, c.mark, c.state, c.expiry_date,
                     CASE
                       WHEN c.state = 'certified' AND c.expiry_date < current_date THEN 'expired'
                       WHEN c.state = 'certified' AND c.expiry_date < current_date + ${EXPIRY_WARNING_DAYS} THEN 'expiring'
                     END AS expiry_status
                FROM certifications c`),
    db.query(`SELECT d.id, d.product_id, d.market_id, d.kind, d.title, lv.version AS latest_version, lv.state AS latest_state
                FROM documents d
                LEFT JOIN LATERAL (SELECT version, state FROM document_versions v WHERE v.document_id = d.id
                                    ORDER BY v.created_at DESC, v.id DESC LIMIT 1) lv ON true
               WHERE d.kind IN ('manual', 'packaging')`),
    db.query(`SELECT product_id, market_id, count(*)::int AS n FROM projects
               WHERE state <> 'done' AND product_id IS NOT NULL AND market_id IS NOT NULL
               GROUP BY product_id, market_id`),
  ]);

  const k = (p, m) => `${p}:${m}`;
  const sellSet = new Set(sells.rows.map((r) => k(r.product_id, r.market_id)));
  const projectCount = new Map(projects.rows.map((r) => [k(r.product_id, r.market_id), r.n]));
  const certsBy = new Map();
  for (const c of certs.rows) certsBy.set(k(c.product_id, c.market_id), [...(certsBy.get(k(c.product_id, c.market_id)) || []), c]);

  const usedMarkets = new Set();
  const rows = products.rows.map((product) => {
    const productDocs = docs.rows.filter((d) => d.product_id === product.id);
    const cells = {};
    for (const market of markets.rows) {
      const key = k(product.id, market.id);
      const marketCerts = certsBy.get(key) || [];
      const localDocs = productDocs.filter((d) => d.market_id === market.id);
      const sharedDocs = productDocs.filter((d) => !d.market_id);
      const openProjects = projectCount.get(key) || 0;
      const sells = sellSet.has(key);
      const relevant = sells || marketCerts.length > 0 || localDocs.length > 0 || openProjects > 0;
      if (!relevant) {
        cells[market.id] = null;
        continue;
      }
      usedMarkets.add(market.id);

      // A market-specific manual or packaging wins over the shared one.
      const pick = (kind) => {
        const local = localDocs.filter((d) => d.kind === kind);
        return docSummary(local.length ? local : sharedDocs.filter((d) => d.kind === kind));
      };
      const manual = pick('manual');
      const packaging = pick('packaging');

      const required = (market.required_marks || []).map((mark) => {
        const c = marketCerts.find((x) => x.mark.toUpperCase() === mark.toUpperCase());
        return { mark, id: c?.id || null, state: c?.state || 'missing', expiry_status: c?.expiry_status || null, expiry_date: c?.expiry_date || null };
      });
      const extra = marketCerts
        .filter((c) => !required.some((r) => r.id === c.id))
        .map((c) => ({ mark: c.mark, id: c.id, state: c.state, expiry_status: c.expiry_status, expiry_date: c.expiry_date }));
      const allCerts = [...required, ...extra];

      const certsOk = required.every((r) => (r.state === 'certified' && r.expiry_status !== 'expired') || r.state === 'not_required');
      const docsOk = DONE_VERSION.has(manual?.state) && DONE_VERSION.has(packaging?.state);
      const problem = allCerts.some((c) => c.state === 'rejected' || c.expiry_status === 'expired');
      const started =
        allCerts.some((c) => !['missing', 'not_started'].includes(c.state)) ||
        [manual, packaging].some((d) => d && d.state !== 'none') ||
        openProjects > 0;

      cells[market.id] = {
        sells,
        open_projects: openProjects,
        certs: allCerts,
        manual,
        packaging,
        status: problem
          ? 'attention'
          : certsOk && docsOk
            ? 'ready'
            : started
              ? 'in_progress'
              : marketCerts.length || manual || packaging
                ? 'not_started'
                : 'not_tracked',
      };
    }
    return { product, cells };
  });

  return {
    markets: markets.rows.filter((m) => usedMarkets.has(m.id)),
    rows,
  };
}
