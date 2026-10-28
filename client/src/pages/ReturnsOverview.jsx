/**
 * The Returns overview for one calendar month. Feedback is one buyer's return; its note can mention several
 * problems, and each mention counts in its bucket. Three counters: feedback, mentions per bucket, and feedback that
 * mention more than one thing. Also: what each bucket means (and every mention behind it, to check or re-file),
 * how far the reason picked on the platform matches the note, each product's reviews, and notes that fit no bucket.
 */
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BUCKETS, OTHER_BUCKET, expectedBuckets } from '../../../shared/returnBuckets.js';
import { CHANNELS } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate } from '../lib/format.js';
import { commonPhrases } from '../lib/phrases.js';
import ErrorNote from '../components/ErrorNote.jsx';
import { Donut, HBars, StackedColumns } from '../components/Charts.jsx';

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// "Feedback" is one buyer's return (one per Amazon order, however many units), with or without a comment.
const reviewsText = (n) => `${n} feedback`;
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const SERIES = [
  { key: 'amazon', label: 'Amazon', color: '--series-1' },
  { key: 'tiktok', label: 'TikTok', color: '--series-2' },
  { key: 'other', label: 'Other', color: '--series-3' },
];
const GENERIC = { key: 'generic', color: '--series-generic' };

function Chevron({ open }) {
  return (
    <svg className={`chevron ${open ? 'is-open' : ''}`} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Editing a bucket's definition (the definition itself shows in the bucket's row). */
function Definition({ bucket, onSaved }) {
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(bucket.description);
  const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      await api(`/api/returns/categories/${bucket.key}`, { method: 'PATCH', body: { description: text } });
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(err);
    }
  };
  if (editing)
    return (
      <form className="stack" onSubmit={save}>
        <ErrorNote error={error} />
        <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label={`Definition of ${bucket.name}`} maxLength={1000} />
        <div className="row">
          <button className="btn primary small">Save</button>
          <button type="button" className="btn ghost small" onClick={() => (setEditing(false), setText(bucket.description))}>
            Cancel
          </button>
        </div>
      </form>
    );
  return can('editor') ? (
    <p className="small">
      <button className="link-btn small" onClick={() => setEditing(true)}>
        Edit definition
      </button>
    </p>
  ) : null;
}

/** The word the rules matched, from why ('note matched: "connect"'), marked in the note. */
function Highlighted({ note, why }) {
  const word = /note matched: "(.+)"/.exec(why || '')?.[1];
  const at = word ? note.toLowerCase().indexOf(word.toLowerCase()) : -1;
  if (at < 0) return <>{note}</>;
  return (
    <>
      {note.slice(0, at)}
      <mark className="matched">{note.slice(at, at + word.length)}</mark>
      {note.slice(at + word.length)}
    </>
  );
}

/**
 * A picker of every bucket's sub-reasons, as "category/subreason" values. `taken` buckets already have a mention on
 * this feedback, so they're shown greyed out: a piece of feedback holds one mention per bucket.
 */
function SubreasonSelect({ options, value, onChange, label, exclude, taken = [], disabled }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} disabled={disabled}>
      <option value="">{label}…</option>
      {options.map((c) => (
        <optgroup key={c.key} label={taken.includes(c.key) ? `${c.name} (already mentioned)` : c.name}>
          {c.subreasons
            .filter((s) => `${c.key}/${s.key}` !== exclude)
            .map((s) => (
              <option key={s.key} value={`${c.key}/${s.key}`} disabled={taken.includes(c.key)}>
                {s.name}
              </option>
            ))}
        </optgroup>
      ))}
    </select>
  );
}

/**
 * One review, as it sits in a bucket: the note with the matched word marked, its other mentions, and for editors
 * the actions on this mention (right, not about this, re-file) or on the review (add a mention).
 */
function MentionedReview({ r, bucketKey, options, onChanged }) {
  const { can } = useAuth();
  const [refile, setRefile] = useState('');
  const [also, setAlso] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const mention = r.mentions.find((m) => m.category === bucketKey);
  const others = r.mentions.filter((m) => m.category !== bucketKey);
  const note = mention?.note || r.note_clean;
  const act = async (action, value) => {
    const [category, subreason] = (value || '').split('/');
    setBusy(true);
    setError(null);
    try {
      await api(`/api/returns/${r.id}/mentions`, { method: 'POST', body: { action, category: mention?.category, to: value ? { category, subreason } : undefined } });
      await onChanged();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };
  const status = mention ? (mention.checked ? (mention.source === 'manual' && !mention.why ? 'Filed by hand' : 'Checked') : null) : r.category_key === 'generic' ? 'Generic' : 'Not filed yet';

  return (
    <li className={`note-item filed-return ${mention?.checked ? 'is-checked' : ''}`}>
      <p className="note-text">
        “<Highlighted note={note} why={mention?.why} />”
      </p>
      <p className="muted small">
        {formatDate(r.return_date)} · {CHANNELS[r.channel]}
        {r.product_name && ` · ${r.product_name}`}
        {r.reason && ` · Picked: ${r.reason}`}
        {r.quantity > 1 && ` · ${r.quantity} units`}
        {status ? <span className={`tag ${mention?.checked ? 'checked-tag' : 'note-unfiled'}`}>{status}</span> : mention?.why && <span className="muted"> · {mention.why}</span>}
      </p>
      {others.length > 0 && <p className="small also-mentions">Also mentions: {others.map((m) => m.category_name).join(', ')}</p>}
      <ErrorNote error={error} />
      {can('editor') && (
        <div className="row filed-actions">
          {mention && !mention.checked && (
            <button className="btn small" onClick={() => act('check')} disabled={busy}>
              Looks right
            </button>
          )}
          {mention && (
            <button className="btn ghost small" onClick={() => act('dismiss')} disabled={busy}>
              Not about this
            </button>
          )}
          {mention ? (
            <>
              <SubreasonSelect
                options={options}
                value={refile}
                onChange={setRefile}
                label="Re-file as"
                exclude={`${mention.category}/${mention.subreason}`}
                taken={others.map((m) => m.category)}
                disabled={busy}
              />
              <button className="btn small" onClick={() => act('refile', refile)} disabled={!refile || busy}>
                Re-file
              </button>
            </>
          ) : null}
          <SubreasonSelect
            options={options}
            value={also}
            onChange={setAlso}
            label={mention ? 'Also mentions' : 'File as'}
            taken={r.mentions.map((m) => m.category)}
            disabled={busy}
          />
          <button className="btn small" onClick={() => act('add', also)} disabled={!also || busy}>
            {mention ? 'Add' : 'File'}
          </button>
        </div>
      )}
    </li>
  );
}

/** A sub-reason's (or a group's) reviews this month, unchecked first, so each call can be confirmed or corrected. */
function MentionList({ bucketKey, subreason, query, options, onChanged }) {
  const params = new URLSearchParams({ ...query, bucket: bucketKey, ...(subreason && { subreason }), limit: '1000' });
  const { data, error, reload } = useLoad(`/api/returns?${params}`);
  const [all, setAll] = useState(false);
  const changed = async () => {
    await reload();
    await onChanged();
  };
  if (error) return <ErrorNote error={error} />;
  if (!data) return <p className="muted small">Loading…</p>;
  const isChecked = (r) => r.mentions.find((m) => m.category === bucketKey)?.checked;
  const list = [...data.returns].sort((a, b) => Number(Boolean(isChecked(a))) - Number(Boolean(isChecked(b))));
  if (!list.length) return <p className="muted small">None this month.</p>;
  return (
    <div className="subreason-returns">
      <ul className="note-list">
        {(all ? list : list.slice(0, 15)).map((r) => (
          <MentionedReview key={r.id} r={r} bucketKey={bucketKey} options={options} onChanged={changed} />
        ))}
      </ul>
      {!all && list.length > 15 && (
        <button className="link-btn small" onClick={() => setAll(true)}>
          Show all {list.length}
        </button>
      )}
    </div>
  );
}

/** A bucket's sub-reasons with their mentions and how many are checked; each opens to its reviews. */
function SubreasonList({ bucket, query, options, onChanged }) {
  const [open, setOpen] = useState(null);
  const subs = bucket.subreasons.filter((s) => s.mentions);
  if (!subs.length) return <p className="muted small">No mentions this month.</p>;
  const max = Math.max(...subs.map((s) => s.mentions));
  return (
    <ul className="subreason-list" aria-label={`${bucket.name} by sub-reason`}>
      {subs.map((s) => {
        const isOpen = open === s.key;
        return (
          <li key={s.key} className={isOpen ? 'is-open' : ''}>
            <button className="subreason-head" onClick={() => setOpen(isOpen ? null : s.key)} aria-expanded={isOpen}>
              <Chevron open={isOpen} />
              <span className="subreason-name">{s.name}</span>
              <span className="hbar-track">
                <span className="hbar-fill" style={{ width: `${(s.mentions / max) * 100}%`, background: `var(${bucket.color})` }} />
              </span>
              <span className="subreason-value">{s.mentions}</span>
              <span className={`subreason-checked small ${s.checked >= s.mentions ? 'all-checked' : ''}`}>
                {s.checked} of {s.mentions} checked
              </span>
            </button>
            {isOpen && <MentionList bucketKey={bucket.key} subreason={s.key} query={query} options={options} onChanged={onChanged} />}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The key: each bucket with its definition, mentions and the share of reviews that mention it; opening one shows
 * its sub-reasons. Below, the two groups that aren't mentions: Generic and No Comment.
 */
function BucketKey({ buckets, groups, base, onSaved, query, options, onChanged }) {
  const [open, setOpen] = useState(null);
  const row = (b, value, share, body) => {
    const isOpen = open === b.key;
    return (
      <li key={b.key} className={`bucket ${isOpen ? 'is-open' : ''} ${b.group ? 'bucket-group' : ''}`}>
        <button className="bucket-head" onClick={() => setOpen(isOpen ? null : b.key)} aria-expanded={isOpen}>
          <Chevron open={isOpen} />
          <span className="legend-swatch" style={{ background: `var(${b.color})` }} aria-hidden="true" />
          <span className="bucket-name">
            {b.name}
            <span className="bucket-definition">{b.description}</span>
          </span>
          <span className="bucket-value">
            {value} <span className="muted">· {share}</span>
          </span>
        </button>
        {isOpen && (
          <div className="bucket-body">
            <Definition bucket={b} onSaved={onSaved} />
            {body}
          </div>
        )}
      </li>
    );
  };
  return (
    <ul className="bucket-key">
      {buckets.map((b) =>
        row(b, count(b.mentions, 'mention', 'mentions'), `${pct(b.mentions, base.n)}% ${base.label}`, <SubreasonList bucket={b} query={query} options={options} onChanged={onChanged} />),
      )}
      {groups.map((g) =>
        row(
          g,
          reviewsText(g.reviews),
          `${pct(g.reviews, base.n)}% ${base.label}`,
          g.key === 'generic' ? (
            <>
              <p className="muted small">Feedback that says nothing specific. File one under a bucket if it does say what went wrong.</p>
              <MentionList bucketKey="generic" query={query} options={options} onChanged={onChanged} />
            </>
          ) : (
            <p className="muted small">Nothing to read: the buyer left no note of their own.</p>
          ),
        ),
      )}
    </ul>
  );
}

/**
 * How far the reason picked on the platform matches what the buyer wrote. Only reviews whose note says what went
 * wrong count (a bucket, not just Other), and only platform reasons that point to a bucket can agree or disagree.
 * A review agrees when any of its mentions is a bucket its platform reason points to.
 */
function PlatformVsNotes({ rows, topReasons, buckets, totals, base }) {
  const name = Object.fromEntries(buckets.map((b) => [b.key, b.name]));
  const byReason = new Map();
  for (const r of rows) {
    const said = r.buckets.filter((b) => b !== OTHER_BUCKET);
    if (!said.length) continue;
    const e = byReason.get(r.reason) || { reason: r.reason, reviews: 0, agree: 0, buckets: {}, expected: expectedBuckets(r.reason) };
    e.reviews += 1;
    for (const b of said) e.buckets[b] = (e.buckets[b] || 0) + 1;
    if (said.some((b) => e.expected.includes(b))) e.agree += 1;
    byReason.set(r.reason, e);
  }
  const reasons = [...byReason.values()].sort((a, b) => b.reviews - a.reviews);
  const claimed = reasons.filter((r) => r.expected.length);
  const claimReviews = claimed.reduce((n, r) => n + r.reviews, 0);
  const agreeReviews = claimed.reduce((n, r) => n + r.agree, 0);
  const noClaim = reasons.filter((r) => !r.expected.length).reduce((n, r) => n + r.reviews, 0);
  const topPlatform = topReasons[0];
  const topBucket = buckets.filter((b) => b.key !== OTHER_BUCKET).sort((a, b) => b.mentions - a.mentions)[0];
  if (!reasons.length) return <p className="muted">No feedback with a clear note this month.</p>;

  return (
    <>
      <div className="variance-headline">
        <div className="stat">
          <span className="stat-label">Platform reason matches the note</span>
          <span className="stat-value">{pct(agreeReviews, claimReviews)}%</span>
          <span className="stat-hint">
            {agreeReviews} of {reviewsText(claimReviews)} where both say what went wrong
          </span>
        </div>
        <div className="stat stat-overdue">
          <span className="stat-label">Margin of error</span>
          <span className="stat-value">{claimReviews ? 100 - pct(agreeReviews, claimReviews) : 0}%</span>
          <span className="stat-hint">Picked a reason their own note contradicts</span>
        </div>
        {topPlatform && topBucket?.mentions > 0 && (
          <p className="variance-story">
            On the platform, the top reason is <strong>{topPlatform.reason || topPlatform.reason_code}</strong> ({pct(topPlatform.reviews, totals.reviews)}% of
            all feedback). In the buyers’ own words, it’s <strong>{topBucket.name}</strong> (mentioned in {pct(topBucket.mentions, base.n)}% {base.label}).
          </p>
        )}
      </div>
      <div className="table-wrap">
        <table aria-label="Platform reason against the buyer's note">
          <thead>
            <tr>
              <th>Reason picked on the platform</th>
              <th className="num">Feedback with a clear note</th>
              <th className="num">Note agrees</th>
              <th>What the notes mention</th>
            </tr>
          </thead>
          <tbody>
            {reasons.map((r) => (
              <tr key={r.reason}>
                <td>
                  {r.reason}
                  {r.expected.length > 0 && <div className="muted small">Points to {r.expected.map((k) => name[k]).join(' or ')}</div>}
                </td>
                <td className="num">{r.reviews}</td>
                <td className="num">{r.expected.length ? `${pct(r.agree, r.reviews)}%` : <span className="muted" title="This reason doesn't point to a bucket">—</span>}</td>
                <td className="small">
                  {Object.entries(r.buckets)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([k, n]) => `${name[k]} ${pct(n, r.reviews)}%`)
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Counts feedback whose note says what went wrong (not only Other, Generic or No comment). Feedback agrees when any problem it mentions fits its
        platform reason: “Defective item” fits connectivity or performance; “No longer needed” only Changed Mind. Feedback that mentions two buckets counts
        in both on the right.
        {noClaim > 0 && ` ${reviewsText(noClaim)} had a platform reason that doesn’t point anywhere (“Not as described”, “No reason given”) and aren’t in the percentage.`}
      </p>
    </>
  );
}

/** One review's note, with where it came from. */
function Note({ r, showProduct, bucketKey }) {
  const mention = bucketKey && r.mentions.find((m) => m.category === bucketKey);
  return (
    <li className="note-item">
      <p className="note-text">“{mention?.note || r.note_clean}”</p>
      <p className="muted small">
        {formatDate(r.return_date)} · {CHANNELS[r.channel]}
        {showProduct && r.product_name && ` · ${r.product_name}`}
        {r.reason && ` · Picked: ${r.reason}`}
        {r.quantity > 1 && ` · ${r.quantity} units`}
        {!r.category_key && <span className="tag note-unfiled">Not filed yet</span>}
      </p>
    </li>
  );
}

// The buckets a review is listed under: its mentions, or Other while nobody has filed it, or Generic.
const bucketsOf = (r) => (r.mentions.length ? r.mentions.map((m) => m.category) : r.category_key === 'generic' ? ['generic'] : !r.category_key ? [OTHER_BUCKET] : []);

/** Reviews grouped by bucket (a review that mentions two is under both), the latest few of each, with the rest on request. */
function NotesByBucket({ notes, buckets }) {
  const [all, setAll] = useState({});
  const groups = buckets.map((b) => ({ ...b, notes: notes.filter((n) => bucketsOf(n).includes(b.key)) })).filter((g) => g.notes.length);
  if (!groups.length) return <p className="muted small">No notes from buyers for this product this month.</p>;
  return groups.map((g) => (
    <div key={g.key} className="note-group">
      <h4>
        <span className="legend-swatch" style={{ background: `var(${g.color})` }} aria-hidden="true" /> {g.name} <span className="muted small">({g.notes.length})</span>
      </h4>
      <ul className="note-list">
        {(all[g.key] ? g.notes : g.notes.slice(0, 10)).map((n) => (
          <Note key={n.id} r={n} bucketKey={g.key} />
        ))}
      </ul>
      {g.notes.length > 10 && !all[g.key] && (
        <button className="link-btn small" onClick={() => setAll({ ...all, [g.key]: true })}>
          Show all {g.notes.length}
        </button>
      )}
    </div>
  ));
}

/** A product's row; opening it shows that camera's mentions and its buyers' notes for the month. */
function ProductRow({ p, buckets, groups, productBuckets, query, withBlank }) {
  const [open, setOpen] = useState(false);
  const notes = useLoad(open && p.product_id ? `/api/returns?${new URLSearchParams({ ...query, productId: p.product_id, noted: '1', limit: '1000' })}` : null);
  const mine = buckets.map((b) => ({ ...b, mentions: productBuckets.find((x) => x.product_id === p.product_id && x.bucket === b.key)?.mentions || 0 }));
  const top = [...mine].filter((b) => b.key !== OTHER_BUCKET).sort((a, b) => b.mentions - a.mentions)[0];
  const feedback = withBlank ? p.reviews : p.noted_reviews;
  return (
    <>
      <tr className={`product-row ${open ? 'is-open' : ''}`}>
        <td>
          {p.product_id ? (
            <button className="link-btn product-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
              <Chevron open={open} /> {p.name}
            </button>
          ) : (
            <span className="muted">Unmatched</span>
          )}
          {p.model && <div className="muted small product-model">{p.model}</div>}
        </td>
        <td className="num">{feedback}</td>
        <td className="num">{p.units}</td>
        <td className="num">
          {pct(p.noted_reviews, p.reviews)}% <span className="muted small">({p.noted_reviews})</span>
        </td>
        <td className="small">{top?.mentions ? top.name : '—'}</td>
      </tr>
      {open && (
        <tr className="product-detail">
          <td colSpan={5}>
            <div className="product-detail-body">
              <div>
                <h4>What its feedback mentions</h4>
                {mine.some((b) => b.mentions) ? (
                  <HBars
                    ariaLabel={`${p.name} by bucket`}
                    data={mine.filter((b) => b.mentions).map((b) => ({ label: b.name, value: b.mentions, share: pct(b.mentions, feedback), color: b.color }))}
                  />
                ) : (
                  <p className="muted small">No notes that say why.</p>
                )}
                <p className="muted small">
                  % of this product’s {reviewsText(feedback)}{withBlank ? '' : ' with a comment'}. <Link to={`/products/${p.product_id}`}>Open product</Link>
                </p>
              </div>
              <div>
                <h4>What buyers wrote</h4>
                <ErrorNote error={notes.error} />
                {!notes.data ? !notes.error && <p className="muted small">Loading…</p> : <NotesByBucket notes={notes.data.returns} buckets={[...buckets, ...groups.filter((g) => g.key === 'generic')]} />}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/** Notes that fit no bucket, and what keeps coming up in them. */
function OtherSection({ query }) {
  const { can } = useAuth();
  const { data, error } = useLoad(`/api/returns?${new URLSearchParams({ ...query, bucket: OTHER_BUCKET, noted: '1', limit: '1000' })}`);
  const [phrase, setPhrase] = useState(null);
  const [all, setAll] = useState(false);
  const notes = useMemo(() => data?.returns || [], [data]);
  const text = (n) => n.mentions.find((m) => m.category === OTHER_BUCKET)?.note || n.note_clean;
  const phrases = useMemo(() => commonPhrases(notes.map((n) => n.mentions.find((m) => m.category === OTHER_BUCKET)?.note || n.note_clean)), [notes]);
  const matches = phrase ? notes.filter((n) => new RegExp(`\\b${phrase.replace(/ /g, "[’']?\\W*")}\\b`, 'i').test(text(n).replace(/[’']/g, ''))) : notes;
  const unfiled = notes.filter((n) => !n.category_key).length;

  return (
    <section className="card" aria-labelledby="other-heading">
      <h2 id="other-heading">Other: notes that fit no bucket</h2>
      <p className="muted small">
        Specific points that aren’t connectivity, fit, subscription, performance, shipping or a change of mind, to spot themes worth a bucket or a
        product change. Notes that say nothing specific are under Generic instead.
        {unfiled > 0 && can('editor') && (
          <>
            {' '}
            {unfiled} not filed yet: <Link to="/returns/review">file them on the Review page</Link>.
          </>
        )}
      </p>
      <ErrorNote error={error} />
      {!data ? (
        !error && <p className="muted">Loading…</p>
      ) : !notes.length ? (
        <p className="muted">No notes in Other this month.</p>
      ) : (
        <>
          <h3>Coming up more than once</h3>
          {phrases.length ? (
            <div className="chips" role="group" aria-label="Common words and phrases">
              {phrases.map((p) => (
                <button key={p.phrase} className={`chip ${phrase === p.phrase ? 'chip-on' : ''}`} aria-pressed={phrase === p.phrase} onClick={() => setPhrase(phrase === p.phrase ? null : p.phrase)}>
                  {p.phrase} <span className="muted">{p.count}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">Nothing comes up in more than one note yet.</p>
          )}
          <h3>{phrase ? `Notes mentioning “${phrase}” (${matches.length})` : `All notes (${notes.length})`}</h3>
          <ul className="note-list">
            {(all || phrase ? matches : matches.slice(0, 10)).map((n) => (
              <Note key={n.id} r={n} showProduct bucketKey={OTHER_BUCKET} />
            ))}
          </ul>
          {!phrase && !all && matches.length > 10 && (
            <button className="link-btn small" onClick={() => setAll(true)}>
              Show all {matches.length}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default function ReturnsOverview({ data, codebook, query, monthName, onCodebookChanged, onReturnsChanged }) {
  const [showTable, setShowTable] = useState(false);
  const [params, setParams] = useSearchParams();
  const t = data.totals;
  // Feedback with no comment is hidden unless asked for: percentages are then of feedback with a comment, which is
  // what says why something came back. Shown, they're of all feedback.
  const withBlank = params.get('blank') === '1';
  const toggleBlank = () => {
    const next = new URLSearchParams(params);
    if (withBlank) next.delete('blank');
    else next.set('blank', '1');
    setParams(next, { replace: true });
  };
  const base = withBlank ? { n: t.reviews, label: 'of all feedback' } : { n: t.noted_reviews, label: 'of feedback with a comment' };
  const buckets = BUCKETS.map((b) => {
    const c = codebook.find((x) => x.key === b.key) || { name: b.key, description: '', subreasons: [] };
    const subs = data.bySubreason.filter((s) => s.bucket === b.key);
    const subreasons = c.subreasons.map((s) => {
      const row = subs.find((x) => x.key === s.key);
      return { ...s, mentions: row?.mentions || 0, checked: row?.checked || 0 };
    });
    // Other also holds notes nobody has filed yet; mentions a person carried over without a sub-reason sit apart.
    for (const extra of subs.filter((s) => !c.subreasons.some((x) => x.key === s.key))) {
      subreasons.push({ key: extra.key ?? '', name: extra.name || 'No sub-reason', mentions: extra.mentions, checked: extra.checked });
    }
    return { ...b, name: c.name, description: c.description, subreasons, mentions: subs.reduce((n, s) => n + s.mentions, 0) };
  });
  const group = (key, color, reviews) => {
    const c = codebook.find((x) => x.key === key) || { name: key, description: '' };
    return { key, color, group: true, name: c.name, description: c.description, reviews };
  };
  const groups = [group('generic', GENERIC.color, t.generic_reviews), ...(withBlank ? [group('no_comment', '--series-blank', t.no_comment_reviews)] : [])];
  const options = codebook.filter((c) => c.in_share);
  const top = [...buckets].filter((b) => b.key !== OTHER_BUCKET).sort((a, b) => b.mentions - a.mentions)[0];

  const months = [...new Set(data.byMonth.map((r) => r.month))].sort();
  const columns = months.map((m) => {
    const values = {};
    for (const row of data.byMonth.filter((r) => r.month === m)) {
      const k = row.channel === 'amazon' || row.channel === 'tiktok' ? row.channel : 'other';
      values[k] = (values[k] || 0) + row.units;
    }
    return { key: m, label: new Date(`${m}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), values };
  });
  const usedSeries = SERIES.filter((s) => columns.some((c) => c.values[s.key]));

  return (
    <>
      <div className="row between counting-bar">
        <p className="small counting-key" aria-label="How to read these numbers">
          <strong>Feedback</strong> is one buyer’s return (an Amazon order counts once, however many units). <strong>Mentions</strong> are the
          problems it raises: one piece of feedback can mention several, each in its bucket. <strong>Units</strong> are items sent back: one piece of
          feedback can cover several, so units aren’t a count of problems.
        </p>
        <label className="inline small blank-toggle">
          <input type="checkbox" checked={withBlank} onChange={toggleBlank} /> Include feedback with no comment ({t.blank_reviews})
        </label>
      </div>
      <section className="stats" aria-label="Summary">
        <div className="stat">
          <span className="stat-label">Feedback</span>
          <span className="stat-value">{base.n}</span>
          <span className="stat-hint">
            {withBlank ? monthName : `with a comment · ${t.blank_reviews} without, hidden`} · {count(t.units, 'unit', 'units')} returned in all
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Mentioned more than one thing</span>
          <span className="stat-value">{t.multi_reviews}</span>
          <span className="stat-hint">
            {pct(t.multi_reviews, t.mentioning_reviews)}% of the {reviewsText(t.mentioning_reviews)} that say what went wrong
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Left a comment</span>
          <span className="stat-value">{pct(t.noted_reviews, t.reviews)}%</span>
          <span className="stat-hint">
            {t.noted_reviews} of {reviewsText(t.reviews)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Top bucket</span>
          <span className="stat-value stat-text">{top?.mentions ? top.name : '—'}</span>
          <span className="stat-hint">{top?.mentions ? `mentioned in ${pct(top.mentions, base.n)}% ${base.label}` : ''}</span>
        </div>
        <div className={`stat ${t.unmatched_units ? 'stat-overdue' : ''}`}>
          <span className="stat-label">Not matched to a product</span>
          <span className="stat-value">{t.unmatched_units}</span>
          <span className="stat-hint">{t.unmatched_units === 1 ? 'unit' : 'units'}</span>
        </div>
      </section>

      <section className="grid-2">
        <div className="card">
          <h2>Why returns came back</h2>
          <Donut
            ariaLabel="Mentions by bucket, with Generic and No comment feedback"
            center={base.n}
            centerLabel="feedback"
            data={[
              ...buckets.map((b) => ({ key: b.key, label: b.name, value: b.mentions, color: b.color })),
              ...groups.map((g) => ({ key: g.key, label: g.name, value: g.reviews, color: g.color })),
            ]}
          />
          <p className="muted small">
            Share of mentions: each problem a buyer raises counts in its bucket, so feedback that names two counts in both ({t.mentions} mentions from{' '}
            {reviewsText(t.mentioning_reviews)}). Generic{withBlank ? ' and No Comment count' : ' counts'} whole feedback.
          </p>
        </div>
        <div className="card">
          <h2>Comment left vs blank</h2>
          <Donut
            ariaLabel="Feedback with a comment and without"
            center={`${pct(t.noted_reviews, t.reviews)}%`}
            centerLabel="left a comment"
            data={[
              { key: 'noted', label: 'Left a comment', value: t.noted_reviews, color: '--series-1' },
              { key: 'blank', label: 'Left it blank', value: t.blank_reviews, color: '--series-blank' },
            ]}
          />
          <p className="muted small">All feedback, whatever the toggle. Blank includes notes that only repeat the menu choice, “N/A” and the like.</p>
        </div>
      </section>

      <section className="card">
        <h2>The buckets and what they mean</h2>
        <p className="muted small">
          How feedback is counted: samples and returns that never reached a customer are set aside first. Then the buyer’s own words (not the reason they
          picked on the platform; for an Amazon order, every unit’s comment) are matched against each bucket’s keywords, and every bucket the note mentions
          counts once. A change of mind counts only when nothing else is mentioned. A note that says nothing specific is Generic. Notes the rules can’t place
          go to Other until someone files them. Open a bucket for its sub-reasons, and a sub-reason for every piece of feedback behind it.
        </p>
        <BucketKey buckets={buckets} groups={groups} base={base} onSaved={onCodebookChanged} query={query} options={options} onChanged={onReturnsChanged} />
      </section>

      <section className="card">
        <h2>Platform reason vs the buyer’s note</h2>
        <p className="muted small">How far the reason buyers pick on the platform can be trusted, judged against what their own note says.</p>
        <PlatformVsNotes rows={data.reviewBuckets} topReasons={data.topReasons} buckets={buckets} totals={t} base={base} />
      </section>

      <section className="card flush">
        <h2 className="pad-h">By product</h2>
        <p className="muted small pad-h">Open a camera to see what its feedback mentions and what its buyers wrote this month.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">{withBlank ? 'Feedback' : 'Feedback with a comment'}</th>
                <th className="num">Units</th>
                <th className="num">Left a comment</th>
                <th>Top bucket</th>
              </tr>
            </thead>
            <tbody>
              {data.byProduct.map((p) => (
                <ProductRow key={p.product_id || 'unmatched'} p={p} buckets={buckets} groups={groups} productBuckets={data.productBuckets} query={query} withBlank={withBlank} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <OtherSection query={query} />

      <section className="card">
        <div className="row between">
          <h2>Units returned per month</h2>
          <button className="btn ghost small" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
            {showTable ? 'Show chart' : 'Show table'}
          </button>
        </div>
        {showTable ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  {usedSeries.map((s) => (
                    <th key={s.key} className="num">
                      {s.label}
                    </th>
                  ))}
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((c) => (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    {usedSeries.map((s) => (
                      <td key={s.key} className="num">
                        {c.values[s.key] || 0}
                      </td>
                    ))}
                    <td className="num">{usedSeries.reduce((n, s) => n + (c.values[s.key] || 0), 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <StackedColumns data={columns} series={usedSeries} ariaLabel="Units returned per month by channel" />
        )}
        <p className="muted small">The 12 months up to {monthName}.</p>
      </section>
    </>
  );
}
