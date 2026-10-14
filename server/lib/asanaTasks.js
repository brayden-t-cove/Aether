/** Bringing an Asana project's tasks into an Aether checklist: suggested matches, and the state a new item starts in. */

/** The board column (section) a task sits in within this project, if any. */
export function sectionOf(task, projectGid) {
  const m = (task.memberships || []).find((x) => x.project?.gid === projectGid) || task.memberships?.[0];
  return m?.section?.name || '';
}

/** A new item's state from its task: done when completed, else from the column's name ("In progress", "Blocked"…). */
export function stateFromTask(task, section) {
  if (task.completed) return 'done';
  const s = section.toLowerCase();
  if (/block|stuck|on hold|waiting/.test(s)) return 'blocked';
  if (/review|approv|qa\b/.test(s)) return 'in_review';
  if (/progress|doing|working|active|started/.test(s)) return 'in_progress';
  if (/done|complete|finished/.test(s)) return 'done';
  return 'not_started';
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'into', 'our', 'all', 'via']);
const words = (text) => new Set(String(text).toLowerCase().match(/[a-z0-9]+/g)?.filter((w) => w.length > 2 && !STOP.has(w)) || []);

/** How alike two titles are, 0–1: shared words over all words. */
export function similarity(a, b) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/**
 * For each unlinked task, the unlinked item whose title is most like it, if close enough. Best pairs first, and each
 * item is suggested at most once. → Map(task gid → item)
 */
export function suggestMatches(tasks, items, { min = 0.5 } = {}) {
  const pairs = [];
  for (const t of tasks) for (const i of items) {
    const score = similarity(t.name, i.title);
    if (score >= min) pairs.push({ t, i, score });
  }
  pairs.sort((a, b) => b.score - a.score);
  const out = new Map();
  const used = new Set();
  for (const { t, i } of pairs) {
    if (out.has(t.gid) || used.has(i.id)) continue;
    out.set(t.gid, i);
    used.add(i.id);
  }
  return out;
}
