/**
 * Match confidence from the customer-match workbook. The browser reads the workbook and sends only
 * each return's ID and confidence; everything else in the file stays on the uploader's computer.
 */
import { MATCH_CONFIDENCE } from '../../shared/workflow.js';

export const MAX_MATCH_ROWS = 50_000;

const RANK = Object.fromEntries(Object.keys(MATCH_CONFIDENCE).map((k, i) => [k, i])); // high = 0, strongest

const REASONS = new Set(['no_activation', 'order_not_found']);

/** "High", "medium ", "Unmatched" → a MATCH_CONFIDENCE key, or null. */
export function confidenceKey(value) {
  const s = String(value ?? '').trim().toLowerCase();
  return Object.hasOwn(MATCH_CONFIDENCE, s) ? s : null;
}

/**
 * Work out what an upload would change. The workbook lists a return once per customer it was checked
 * against, so each return keeps its strongest confidence.
 */
export async function planMatches(db, { channel, matches }) {
  const best = new Map(); // ref → { confidence, reason }
  let invalid = 0;
  for (const m of matches) {
    const ref = typeof m?.return_ref === 'string' || typeof m?.return_ref === 'number' ? String(m.return_ref).trim() : '';
    const confidence = confidenceKey(m?.confidence);
    if (!ref || ref.length > 100 || !confidence) {
      invalid++;
      continue;
    }
    // Only an unmatched return has a reason it couldn't be matched.
    const reason = confidence === 'unmatched' && REASONS.has(m?.unmatched_reason) ? m.unmatched_reason : null;
    const prev = best.get(ref);
    if (!prev || RANK[confidence] < RANK[prev.confidence] || (confidence === prev.confidence && reason === 'no_activation')) best.set(ref, { confidence, reason });
  }

  const refs = [...best.keys()];
  const [{ rows: known }, { rows: stored }] = await Promise.all([
    db.query('SELECT DISTINCT return_ref FROM returns WHERE channel = $1 AND return_ref = ANY($2::text[])', [channel, refs]),
    db.query('SELECT return_ref, confidence, unmatched_reason FROM return_matches WHERE channel = $1 AND return_ref = ANY($2::text[])', [channel, refs]),
  ]);
  const before = new Map(stored.map((r) => [r.return_ref, r]));
  const byConfidence = Object.fromEntries(Object.keys(MATCH_CONFIDENCE).map((k) => [k, 0]));
  let added = 0;
  let changed = 0;
  let noActivation = 0;
  for (const [ref, { confidence, reason }] of best) {
    byConfidence[confidence]++;
    if (reason === 'no_activation') noActivation++;
    const was = before.get(ref);
    if (!was) added++;
    else if (was.confidence !== confidence || was.unmatched_reason !== reason) changed++;
  }
  return {
    channel,
    matches: best,
    summary: {
      rows: matches.length,
      returns: best.size,
      invalid,
      byConfidence,
      // Unmatched because no camera went online in the buyer's zip.
      noActivation,
      added,
      changed,
      unchanged: best.size - added - changed,
      // Returns in the workbook that haven't been imported from the platform's export yet.
      notImported: best.size - known.length,
    },
  };
}

/** Save a plan: new returns are added, changed ones replaced, unchanged ones left as they are. */
export async function saveMatches(db, plan, { userId }) {
  const refs = [...plan.matches.keys()];
  const values = [...plan.matches.values()];
  await db.query(
    `INSERT INTO return_matches (channel, return_ref, confidence, unmatched_reason, updated_by)
     SELECT $1, ref, conf, reason, $5 FROM unnest($2::text[], $3::text[], $4::text[]) AS t(ref, conf, reason)
     ON CONFLICT (channel, return_ref) DO UPDATE
       SET confidence = EXCLUDED.confidence, unmatched_reason = EXCLUDED.unmatched_reason, updated_by = EXCLUDED.updated_by, updated_at = now()
     WHERE (return_matches.confidence, return_matches.unmatched_reason) IS DISTINCT FROM (EXCLUDED.confidence, EXCLUDED.unmatched_reason)`,
    [plan.channel, refs, values.map((v) => v.confidence), values.map((v) => v.reason), userId],
  );
}

/** What's stored, for the import page: counts per channel and confidence, and how many match an imported return. */
export async function matchesOverview(db) {
  const { rows } = await db.query(
    `SELECT m.channel, m.confidence, count(*)::int AS returns,
            count(*) FILTER (WHERE m.unmatched_reason = 'no_activation')::int AS no_activation,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM returns r WHERE r.channel = m.channel AND r.return_ref = m.return_ref))::int AS imported,
            max(m.updated_at) AS updated_at
       FROM return_matches m GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  return rows;
}
