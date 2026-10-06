/**
 * The Returns overview for one calendar month: why returns came back (the six buckets plus Other, and No
 * comment), how many buyers left a comment, what each bucket means, how far the reason picked on the platform
 * matches the buyer's note, each product's returns, and the notes that fit no bucket.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BUCKETS, OTHER_BUCKET, expectedBuckets } from '../../../shared/returnBuckets.js';
import { CHANNELS } from '../../../shared/workflow.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { useLoad } from '../lib/useLoad.js';
import { formatDate } from '../lib/format.js';
import { commonPhrases } from '../lib/phrases.js';
import ErrorNote from '../components/ErrorNote.jsx';
import { Donut, HBars, StackedColumns } from '../components/Charts.jsx';

const units = (n) => `${n} ${n === 1 ? 'unit' : 'units'}`;
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const SERIES = [
  { key: 'amazon', label: 'Amazon', color: '--series-1' },
  { key: 'tiktok', label: 'TikTok', color: '--series-2' },
  { key: 'other', label: 'Other', color: '--series-3' },
];

function Chevron({ open }) {
  return (
    <svg className={`chevron ${open ? 'is-open' : ''}`} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Why some unclear connectivity returns have no activation data: the workbook covers TikTok only, and only what it lists. */
function activationRows(t) {
  const known = t.unclear_online_units + t.unclear_never_units;
  if (!t.unclear_units) return [];
  const unknown = t.unclear_units - known;
  const notTiktok = t.unclear_not_tiktok_units || 0;
  const notListed = t.unclear_not_in_workbook_units || 0;
  const weak = Math.max(0, unknown - notTiktok - notListed);
  return [
    { label: 'Went online, then failed', value: t.unclear_online_units, note: 'The buyer’s camera was activated, so it worked at least once' },
    { label: 'Never went online', value: t.unclear_never_units, note: 'No camera was activated in the buyer’s zip, so it likely never got past setup' },
    {
      label: 'No activation data',
      value: unknown,
      note: [
        notTiktok && `${notTiktok} from Amazon or other channels (the workbook covers TikTok only)`,
        notListed && `${notListed} TikTok not in the match workbook yet`,
        weak && `${weak} with a weak match or order not found`,
      ]
        .filter(Boolean)
        .join(' · '),
    },
  ].filter((r) => r.value > 0);
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

/** The key: each bucket with its definition, units and share; opening one shows its sub-reasons. */
function BucketKey({ buckets, totals, onSaved }) {
  const [open, setOpen] = useState(null);
  return (
    <ul className="bucket-key">
      {buckets.map((b) => {
        const isOpen = open === b.key;
        const activation = b.key === 'connectivity' ? activationRows(totals) : [];
        return (
          <li key={b.key} className={`bucket ${isOpen ? 'is-open' : ''}`}>
            <button className="bucket-head" onClick={() => setOpen(isOpen ? null : b.key)} aria-expanded={isOpen}>
              <Chevron open={isOpen} />
              <span className="legend-swatch" style={{ background: `var(${b.color})` }} aria-hidden="true" />
              <span className="bucket-name">
                {b.name}
                <span className="bucket-definition">{b.description}</span>
              </span>
              <span className="bucket-value">
                {b.units} <span className="muted">· {pct(b.units, totals.units)}%</span>
              </span>
            </button>
            {isOpen && (
              <div className="bucket-body">
                <Definition bucket={b} onSaved={onSaved} />
                {b.subreasons.some((s) => s.units) ? (
                  <HBars ariaLabel={`${b.name} by sub-reason`} color={b.color} data={b.subreasons.filter((s) => s.units).map((s) => ({ label: s.name, value: s.units }))} />
                ) : (
                  <p className="muted small">No returns in this bucket this month.</p>
                )}
                {activation.length > 0 && (
                  <>
                    <h4>Where the note doesn’t say why it won’t connect ({units(totals.unclear_units)})</h4>
                    <HBars ariaLabel="Unclear connectivity by activation" color={b.color} data={activation} />
                  </>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * How far the reason picked on the platform matches what the buyer wrote. Only returns whose note says what
 * went wrong count (not Other), and only platform reasons that point to a bucket can agree or disagree.
 */
function PlatformVsNotes({ rows, topReasons, buckets, totals }) {
  const name = Object.fromEntries(buckets.map((b) => [b.key, b.name]));
  const byReason = new Map();
  for (const r of rows) {
    if (r.bucket === OTHER_BUCKET) continue;
    const e = byReason.get(r.reason) || { reason: r.reason, units: 0, agree: 0, buckets: {}, expected: expectedBuckets(r.reason) };
    e.units += r.units;
    e.buckets[r.bucket] = (e.buckets[r.bucket] || 0) + r.units;
    if (e.expected.includes(r.bucket)) e.agree += r.units;
    byReason.set(r.reason, e);
  }
  const reasons = [...byReason.values()].sort((a, b) => b.units - a.units);
  const claimed = reasons.filter((r) => r.expected.length);
  const claimUnits = claimed.reduce((n, r) => n + r.units, 0);
  const agreeUnits = claimed.reduce((n, r) => n + r.agree, 0);
  const noClaim = reasons.filter((r) => !r.expected.length).reduce((n, r) => n + r.units, 0);
  const topPlatform = topReasons[0];
  const topBucket = buckets.filter((b) => b.key !== OTHER_BUCKET).sort((a, b) => b.units - a.units)[0];
  if (!reasons.length) return <p className="muted">No returns with a clear note this month.</p>;

  return (
    <>
      <div className="variance-headline">
        <div className="stat">
          <span className="stat-label">Platform reason matches the note</span>
          <span className="stat-value">{pct(agreeUnits, claimUnits)}%</span>
          <span className="stat-hint">
            {agreeUnits} of {units(claimUnits)} where both say what went wrong
          </span>
        </div>
        <div className="stat stat-overdue">
          <span className="stat-label">Margin of error</span>
          <span className="stat-value">{claimUnits ? 100 - pct(agreeUnits, claimUnits) : 0}%</span>
          <span className="stat-hint">Picked a reason their own note contradicts</span>
        </div>
        {topPlatform && topBucket && (
          <p className="variance-story">
            On the platform, the top reason is <strong>{topPlatform.reason || topPlatform.reason_code}</strong> ({pct(topPlatform.units, totals.units)}% of
            returns). In the buyers’ own words, it’s <strong>{topBucket.name}</strong> ({pct(topBucket.units, totals.units)}%).
          </p>
        )}
      </div>
      <div className="table-wrap">
        <table aria-label="Platform reason against the buyer's note">
          <thead>
            <tr>
              <th>Reason picked on the platform</th>
              <th className="num">Units with a clear note</th>
              <th className="num">Note agrees</th>
              <th>What the notes say</th>
            </tr>
          </thead>
          <tbody>
            {reasons.map((r) => (
              <tr key={r.reason}>
                <td>
                  {r.reason}
                  {r.expected.length > 0 && <div className="muted small">Points to {r.expected.map((k) => name[k]).join(' or ')}</div>}
                </td>
                <td className="num">{r.units}</td>
                <td className="num">{r.expected.length ? `${pct(r.agree, r.units)}%` : <span className="muted" title="This reason doesn't point to a bucket">—</span>}</td>
                <td className="small">
                  {Object.entries(r.buckets)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([k, u]) => `${name[k]} ${pct(u, r.units)}%`)
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        Counts returns whose note says what went wrong (not Other or No comment). A reason like “Defective item” agrees with a note about connectivity or
        performance; “No longer needed” only with Changed Mind.{noClaim > 0 && ` ${units(noClaim)} had a platform reason that doesn’t point anywhere (“Not as described”, “No reason given”) and aren’t in the percentage.`}
      </p>
    </>
  );
}

/** One return's note, with where it came from. */
function Note({ r, showProduct }) {
  return (
    <li className="note-item">
      <p className="note-text">“{r.note_clean}”</p>
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

/** Notes grouped by bucket, the latest few of each, with the rest on request. */
function NotesByBucket({ notes, buckets }) {
  const [all, setAll] = useState({});
  const groups = buckets
    .map((b) => ({ ...b, notes: notes.filter((n) => (n.category_key || OTHER_BUCKET) === b.key) }))
    .filter((g) => g.notes.length);
  if (!groups.length) return <p className="muted small">No notes from buyers for this product this month.</p>;
  return groups.map((g) => (
    <div key={g.key} className="note-group">
      <h4>
        <span className="legend-swatch" style={{ background: `var(${g.color})` }} aria-hidden="true" /> {g.name} <span className="muted small">({g.notes.length})</span>
      </h4>
      <ul className="note-list">
        {(all[g.key] ? g.notes : g.notes.slice(0, 10)).map((n) => (
          <Note key={n.id} r={n} />
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

/** A product's row; opening it shows that camera's buckets and its buyers' notes for the month. */
function ProductRow({ p, buckets, productBuckets, query }) {
  const [open, setOpen] = useState(false);
  const notes = useLoad(open && p.product_id ? `/api/returns?${new URLSearchParams({ ...query, productId: p.product_id, noted: '1', limit: '1000' })}` : null);
  const mine = buckets.map((b) => ({ ...b, units: productBuckets.find((x) => x.product_id === p.product_id && x.bucket === b.key)?.units || 0 }));
  const explained = mine.reduce((n, b) => n + b.units, 0);
  const top = [...mine].filter((b) => b.key !== OTHER_BUCKET).sort((a, b) => b.units - a.units)[0];
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
        <td className="num">{p.units}</td>
        <td className="num">
          {pct(p.noted_units, p.units)}% <span className="muted small">({p.noted_units})</span>
        </td>
        <td className="small">{top?.units ? top.name : '—'}</td>
      </tr>
      {open && (
        <tr className="product-detail">
          <td colSpan={4}>
            <div className="product-detail-body">
              <div>
                <h4>Why it came back</h4>
                {explained ? (
                  <HBars
                    ariaLabel={`${p.name} by bucket`}
                    data={mine.filter((b) => b.units).map((b) => ({ label: b.name, value: b.units, share: pct(b.units, p.units), color: b.color }))}
                  />
                ) : (
                  <p className="muted small">No notes that say why.</p>
                )}
                <p className="muted small">
                  {p.units - explained > 0 && `${units(p.units - explained)} with no comment. `}
                  <Link to={`/products/${p.product_id}`}>Open product</Link>
                </p>
              </div>
              <div>
                <h4>What buyers wrote</h4>
                <ErrorNote error={notes.error} />
                {!notes.data ? !notes.error && <p className="muted small">Loading…</p> : <NotesByBucket notes={notes.data.returns} buckets={buckets} />}
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
  const phrases = useMemo(() => commonPhrases(notes.map((n) => n.note_clean)), [notes]);
  const matches = phrase ? notes.filter((n) => new RegExp(`\\b${phrase.replace(/ /g, "[’']?\\W*")}\\b`, 'i').test(n.note_clean.replace(/[’']/g, ''))) : notes;
  const unfiled = notes.filter((n) => !n.category_key).length;

  return (
    <section className="card" aria-labelledby="other-heading">
      <h2 id="other-heading">Other: notes that fit no bucket</h2>
      <p className="muted small">
        What buyers wrote that isn’t connectivity, fit, subscription, performance, shipping or a change of mind, to spot themes worth a bucket or a
        product change.
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
              <Note key={n.id} r={n} showProduct />
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

export default function ReturnsOverview({ data, codebook, query, monthName, onCodebookChanged }) {
  const [showTable, setShowTable] = useState(false);
  const t = data.totals;
  const buckets = BUCKETS.map((b) => {
    const c = codebook.find((x) => x.key === b.key) || { name: b.key, description: '', subreasons: [] };
    const subs = data.bySubreason.filter((s) => s.bucket === b.key);
    const subreasons = c.subreasons.map((s) => ({ ...s, units: subs.find((x) => x.key === s.key)?.units || 0 }));
    // Other also holds notes nobody has filed yet.
    const unfiled = subs.filter((s) => !s.key).reduce((n, s) => n + s.units, 0);
    if (unfiled) subreasons.push({ key: 'unfiled', name: 'Not filed yet', units: unfiled });
    return { ...b, name: c.name, description: c.description, subreasons, units: subs.reduce((n, s) => n + s.units, 0) };
  });
  const noComment = codebook.find((c) => c.key === 'no_comment');
  const bucketed = buckets.reduce((n, b) => n + b.units, 0);
  const blankSlice = t.units - bucketed;
  const top = [...buckets].filter((b) => b.key !== OTHER_BUCKET).sort((a, b) => b.units - a.units)[0];

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
      <section className="stats" aria-label="Summary">
        <div className="stat">
          <span className="stat-label">Units returned</span>
          <span className="stat-value">{t.units}</span>
          <span className="stat-hint">{monthName}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Left a comment</span>
          <span className="stat-value">{pct(t.noted_units, t.units)}%</span>
          <span className="stat-hint">
            {t.noted_units} of {units(t.units)}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Top bucket</span>
          <span className="stat-value stat-text">{top?.units ? top.name : '—'}</span>
          <span className="stat-hint">{top?.units ? `${units(top.units)} · ${pct(top.units, t.units)}%` : ''}</span>
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
            ariaLabel="Units by bucket, and with no comment"
            center={t.units}
            centerLabel="units"
            data={[
              ...buckets.map((b) => ({ key: b.key, label: b.name, value: b.units, color: b.color })),
              { key: 'no_comment', label: noComment?.name || 'No comment', value: blankSlice, color: '--series-blank' },
            ]}
          />
          <p className="muted small">From what buyers wrote in their own words. No comment: they left nothing beyond the platform’s menu.</p>
        </div>
        <div className="card">
          <h2>Comment left vs blank</h2>
          <Donut
            ariaLabel="Returns with a comment and without"
            center={`${pct(t.noted_units, t.units)}%`}
            centerLabel="left a comment"
            data={[
              { key: 'noted', label: 'Left a comment', value: t.noted_units, color: '--series-1' },
              { key: 'blank', label: 'Left it blank', value: t.blank_units, color: '--series-blank' },
            ]}
          />
          <p className="muted small">Blank includes notes that only repeat the menu choice, “N/A” and the like.</p>
        </div>
      </section>

      <section className="card">
        <h2>The buckets and what they mean</h2>
        <p className="muted small">
          How a return lands in a bucket: samples and returns that never reached a customer are set aside first. Then the buyer’s own words (not the reason
          they picked on the platform) are matched against each bucket’s keywords, in a fixed order when a note fits more than one. Notes the rules can’t
          place go to Other until someone files them, and anyone can file or correct a return on the Review page. Open a bucket for its sub-reasons.
        </p>
        <BucketKey buckets={buckets} totals={t} onSaved={onCodebookChanged} />
      </section>

      <section className="card">
        <h2>Platform reason vs the buyer’s note</h2>
        <p className="muted small">How far the reason buyers pick on the platform can be trusted, judged against what their own note says.</p>
        <PlatformVsNotes rows={data.reasonVsBucket} topReasons={data.topReasons} buckets={buckets} totals={t} />
      </section>

      <section className="card flush">
        <h2 className="pad-h">By product</h2>
        <p className="muted small pad-h">Open a camera to see why it came back and what its buyers wrote this month.</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th className="num">Units</th>
                <th className="num">Left a comment</th>
                <th>Top bucket</th>
              </tr>
            </thead>
            <tbody>
              {data.byProduct.map((p) => (
                <ProductRow key={p.product_id || 'unmatched'} p={p} buckets={buckets} productBuckets={data.productBuckets} query={query} />
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
