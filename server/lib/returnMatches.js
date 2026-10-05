/**
 * Match confidence from the customer-match workbook. The browser reads the workbook and sends only
 * each return's ID and confidence; everything else in the file stays on the uploader's computer.
 */
import { MATCH_CONFIDENCE } from '../../shared/workflow.js';

export const MAX_MATCH_ROWS = 50_000;

const RANK = Object.fromEntries(Object.keys(MATCH_CONFIDENCE).map((k, i) => [k, i])); // high = 0, strongest

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
  const best = new Map();
  let invalid = 0;
  for (const m of matches) {
    const ref = typeof m?.return_ref === 'string' || typeof m?.return_ref === 'number' ? String(m.return_ref).trim() : '';
    const confidence = confidenceKey(m?.confidence);
    if (!ref || ref.length > 100 || !confidence) {
      invalid++;
      continue;
    }
    const prev = best.get(ref);
    if (!prev || RANK[confidence] < RANK[prev]) best.set(ref, confidence);
  }

  const refs = [...best.keys()];
  const [{ rows: known }, { rows: stored }] = await Promise.all([
    db.query('SELECT DISTINCT return_ref FROM returns WHERE channel = $1 AND return_ref = ANY($2::text[])', [channel, refs]),
    db.query('SELECT return_ref, confidence FROM return_matches WHERE channel = $1 AND return_ref = ANY($2::text[])', [channel, refs]),
  ]);
  const before = new Map(stored.map((r) => [r.return_ref, r.confidence]));
  const byConfidence = Object.fromEntries(Object.keys(MATCH_CONFIDENCE).map((k) => [k, 0]));
  let added = 0;
  let changed = 0;
  for (const [ref, confidence] of best) {
    byConfidence[confidence]++;
    if (!before.has(ref)) added++;
    else if (before.get(ref) !== confidence) changed++;
  }
  return {
    channel,
    matches: best,
    summary: {
      rows: matches.length,
      returns: best.size,
      invalid,
      byConfidence,
      added,
      changed,
      unchanged: best.size - added - changed,
      // Returns in the workbook that haven't been imported from the platform's export yet.
      notImported: best.size - known.length,
    },
  };
}

/** Save a plan: new returns are added, changed confidences replaced, unchanged ones left as they are. */
export async function saveMatches(db, plan, { userId }) {
  const refs = [...plan.matches.keys()];
  const confidences = [...plan.matches.values()];
  await db.query(
    `INSERT INTO return_matches (channel, return_ref, confidence, updated_by)
     SELECT $1, ref, conf, $4 FROM unnest($2::text[], $3::text[]) AS t(ref, conf)
     ON CONFLICT (channel, return_ref) DO UPDATE SET confidence = EXCLUDED.confidence, updated_by = EXCLUDED.updated_by, updated_at = now()
     WHERE return_matches.confidence <> EXCLUDED.confidence`,
    [plan.channel, refs, confidences, userId],
  );
}

/** What's stored, for the import page: counts per channel and confidence, and how many match an imported return. */
export async function matchesOverview(db) {
  const { rows } = await db.query(
    `SELECT m.channel, m.confidence, count(*)::int AS returns,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM returns r WHERE r.channel = m.channel AND r.return_ref = m.return_ref))::int AS imported,
            max(m.updated_at) AS updated_at
       FROM return_matches m GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  return rows;
}
