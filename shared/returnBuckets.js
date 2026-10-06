/**
 * The six return buckets plus Other, as the Returns dashboard shows them, and what each platform reason
 * claims about a return, for comparing the reason the buyer picked with what their note says.
 */

/** Bucket keys (return_categories.key) in display order, each with its fixed chart color. */
export const BUCKETS = [
  { key: 'connectivity', color: '--series-1' },
  { key: 'fit', color: '--series-2' },
  { key: 'subscription', color: '--series-3' },
  { key: 'performance', color: '--series-4' },
  { key: 'shipping', color: '--series-5' },
  { key: 'changed_mind', color: '--series-6' },
  { key: 'non_specific', color: '--series-other' },
];
export const BUCKET_KEYS = BUCKETS.map((b) => b.key);
export const OTHER_BUCKET = 'non_specific';

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Platform reasons (TikTok's menu, and Amazon's codes as Aether labels them) → the buckets that reason is
 * consistent with. An empty list means the reason doesn't point anywhere ("Not as described", "No reason given"),
 * so it can't agree or disagree with the note. A reason not listed here is treated the same way.
 */
const EXPECTS = {
  // Changed mind
  'no longer needed': ['changed_mind'],
  'changed mind': ['changed_mind'],
  'found a better price': ['changed_mind'],
  'ordered the wrong item': ['changed_mind'],
  'unauthorized purchase': ['changed_mind'],
  'bought by mistake': ['changed_mind'],
  'accidental purchase': ['changed_mind'],
  // Doesn't work
  'defective item': ['performance', 'connectivity'],
  'defective does not work': ['performance', 'connectivity'],
  'quality not acceptable': ['performance'],
  'item does not work': ['performance', 'connectivity'],
  // Doesn't suit
  'not compatible': ['fit', 'connectivity'],
  'part not compatible': ['fit', 'connectivity'],
  // The order went wrong
  'missing parts': ['shipping'],
  'missing items': ['shipping'],
  'missing package': ['shipping'],
  'wrong item was sent': ['shipping'],
  'damaged item or packaging': ['shipping'],
  'damaged in shipping': ['shipping'],
  'item arrived too late': ['shipping'],
  'arrived too late': ['shipping'],
  'product wouldnt arrive on time': ['shipping'],
  'never arrived': ['shipping'],
  'extra item received': ['shipping'],
  // Says nothing specific
  'item doesnt match description': [],
  'not as described': [],
  'item does not meet expectations': [],
  'no reason given': [],
};

/** The buckets a platform reason is consistent with; [] when it doesn't point to one. */
export function expectedBuckets(reason) {
  return EXPECTS[norm(reason)] ?? [];
}
