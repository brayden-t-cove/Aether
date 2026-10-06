import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getCodebook } from '../server/lib/returnCodebook.js';
import { cleanNote, RULES, sortReturn } from '../server/lib/returnRules.js';
import { makeApp, setupDb, signedInAgent, TEST_DATABASE_URL } from './helpers.js';

// Same ranks the migration seeds; the database tests below check they agree.
const rank = new Map(
  ['shipping', 'connectivity', 'subscription', 'fit', 'performance', 'changed_mind', 'non_specific'].map((k, i) => [k, i + 1]),
);
const sort = (customer_comment, extra = {}) => {
  const r = sortReturn({ channel: 'tiktok', customer_comment, ...extra }, { rank });
  return r.category ? `${r.category}/${r.subreason}` : null;
};

describe('cleaning notes', () => {
  const amazon = (comment) => cleanNote({ channel: 'amazon', comment });

  it("takes Amazon's menu off and remembers the choice", () => {
    expect(amazon('Changed Mind|My needs changed|Bought a bigger one')).toEqual({ note: 'Bought a bigger one', preset: 'preset_needs_changed' });
    expect(amazon('Ordering Issue|Ordered too many')).toEqual({ note: '', preset: 'preset_too_many' });
    expect(amazon('New')).toEqual({ note: '', preset: 'preset_new' });
    expect(amazon('Not Compatible|Wifi network')).toEqual({ note: 'Wifi network', preset: '' });
    expect(amazon('Delivery Issue|Item was late|Came two days after the date')).toEqual({ note: 'Came two days after the date', preset: '' });
    expect(amazon('Too small | Does not fit')).toEqual({ note: 'Too small | Does not fit', preset: '' });
  });

  it("drops empty answers to Amazon's follow-up question", () => {
    expect(amazon('Not as Expected|Kept losing the signal|No').note).toBe('Kept losing the signal');
    expect(amazon('Not as Expected|Picture is grainy|nothing specific').note).toBe('Picture is grainy');
    expect(amazon('Not as Expected|Not what I thought|No two-way talk|No').note).toBe('Not what I thought | No two-way talk');
  });

  it('decodes HTML entities and tidies spaces', () => {
    expect(amazon('Defective|Doesn&#39;t   turn on &amp; gets hot').note).toBe("Doesn't turn on & gets hot");
  });

  it("drops a TikTok note that only repeats the reason, and keeps one that goes on", () => {
    expect(cleanNote({ channel: 'tiktok', comment: 'No longer needed.', reason: 'No longer needed' }).note).toBe('');
    expect(cleanNote({ channel: 'tiktok', comment: 'No longer needed just changed my mind', reason: 'No longer needed' }).note).toBe('No longer needed just changed my mind');
  });

  it('hides phone numbers', () => {
    expect(cleanNote({ channel: 'tiktok', comment: 'Call me at (555) 010-0199 or 555.010.0123' }).note).toBe('Call me at [phone removed] or [phone removed]');
  });

  it('treats N/A, none and punctuation as no note', () => {
    for (const comment of ['', '  ', 'N/A', 'none', '.', '-', 'n/a.']) expect(cleanNote({ channel: 'tiktok', comment }).note).toBe('');
  });
});

describe('sorting a return', () => {
  it('reads the note, not the platform reason', () => {
    expect(sort('It will not connect to my wifi', { reason: 'No longer needed' })).toBe('connectivity/wont_connect');
    expect(sort('Keeps going offline every night')).toBe('connectivity/drops_offline');
    expect(sort('Only works on the 2.4 GHz band')).toBe('connectivity/router_isp');
  });

  it('breaks ties in codebook order', () => {
    // changed mind + connectivity → connectivity; shipping beats everything.
    expect(sort("Don't need it anymore, and it would not connect")).toBe('connectivity/wont_connect');
    expect(sort('Never received it, and the reviews say it drops offline')).toBe('shipping/not_received');
    // fit beats performance; performance beats hardware.
    expect(sort('Too big for the porch light and the picture is blurry')).toBe('fit/fixture');
    expect(sort('Night vision is poor and one stopped working')).toBe('performance/image_quality');
    // a vague "doesn't work" only counts when nothing more specific is said.
    expect(sort("Doesn't work")).toBe('non_specific/vague');
    expect(sort("Doesn't work, it needs a monthly subscription")).toBe('subscription/unexpected_subscription');
  });

  it('covers every category', () => {
    expect(sort('The box was opened before delivery')).toBe('shipping/damaged_package');
    expect(sort('The yearly subscription is too expensive')).toBe('subscription/subscription_cost');
    expect(sort('No slot for an SD card')).toBe('subscription/sd_card');
    expect(sort('Our windows are tinted')).toBe('fit/window');
    expect(sort('Motion alerts come an hour late')).toBe('performance/motion');
    expect(sort('It will not turn on at all')).toBe('performance/wont_power_on');
    expect(sort('No instructions in the box')).toBe('performance/no_manual');
    expect(sort('Does not work with Alexa')).toBe('connectivity/smart_home');
    expect(sort('Item arrived damaged')).toBe('shipping/damaged_package');
    expect(sort('Is this a fake? Looks like a knock off')).toBe('non_specific/trust');
    expect(sort('Camera will not charge. No charging cable included')).toBe('shipping/wrong_missing');
    expect(sort('Item was due by 11am. Didn’t arrive until 6pm')).toBe('shipping/late');
    expect(sort('La cámara no empareja con el celular')).toBe('connectivity/wont_connect');
    expect(sort('It will not charge at all')).toBe('performance/wont_power_on');
    // "Cover" as in an accessory isn't the camera's coverage.
    expect(sort('I wish it had a silicone cover like my phone')).toBe(null);
    expect(sort('It does not cover the whole driveway')).toBe('fit/view_angle');
    expect(sort('Won’t connect to our internet. Tried multiple times, never got it to work')).toBe('connectivity/wont_connect');
    expect(sort('Ordered it by mistake')).toBe('changed_mind/mistake');
    expect(sort('Was a gift, no longer needed')).toBe('changed_mind/circumstances');
  });

  it('reads Spanish with or without accents', () => {
    expect(sort('La cámara se desconecta cada rato')).toBe('connectivity/drops_offline');
    expect(sort('En la noche la imagen no es clara')).toBe('performance/image_quality');
  });

  it('does not mistake product names or longer words for keywords', () => {
    expect(sort('The window cam picture is blurry')).toBe('performance/image_quality');
    // "camera" is not "came", and "replacement" is not "placement".
    expect(sort('Only one camera will connect, I want a replacement')).toBe('connectivity/wont_connect');
  });

  it('says why', () => {
    expect(sortReturn({ channel: 'tiktok', customer_comment: 'It is offline most days' }, { rank }).why).toBe('note matched: "offline"');
  });

  it('files a return with no note under No Comment', () => {
    expect(sort('')).toBe('no_comment/blank');
    expect(sort('Ordering Issue|Accidental purchase', { channel: 'amazon' })).toBe('no_comment/preset_accidental');
  });

  it('sets aside samples and returns that never reached a customer, whatever the note says', () => {
    expect(sort('Stopped working', { channel: 'amazon', reason_code: 'UNDELIVERABLE_REFUSED' })).toBe('not_customer/undeliverable');
    expect(sort('', { channel: 'amazon', reason_code: 'DAMAGED_BY_FC' })).toBe('not_customer/damaged_warehouse');
    expect(sort('', { channel: 'amazon', reason_code: 'DAMAGED_BY_CARRIER' })).toBe('not_customer/damaged_carrier');
    expect(sort('Loved it', { reason_code: 'CONGRATS_ON_MEETING_YOUR_REFUNDABLE_SAMPLE_CRITERIA!' })).toBe('sample/refundable_sample');
  });

  it('leaves a note it does not recognise for a person', () => {
    expect(sortReturn({ channel: 'tiktok', customer_comment: 'Thanks' }, { rank })).toEqual({ note_clean: 'Thanks', category: null, subreason: null, why: '' });
  });
});

describe.skipIf(!TEST_DATABASE_URL)('sorting returns in the database', () => {
  let db, app, editor, viewer;
  const TIKTOK = [
    { 'Return Order ID': 'R-10', 'Product Name': 'Sample Cam', 'Return Reason': 'No longer needed', 'Buyer Note': 'Would not connect to wifi', 'Time Requested': '09/08/2026 10:00:00' },
    { 'Return Order ID': 'R-11', 'Product Name': 'Sample Cam', 'Return Reason': 'Defective item', 'Buyer Note': '', 'Time Requested': '09/09/2026 10:00:00' },
    { 'Return Order ID': 'R-12', 'Product Name': 'Sample Cam', 'Return Reason': 'No longer needed', 'Buyer Note': 'Thanks', 'Time Requested': '09/10/2026 10:00:00' },
  ];
  const byRef = async () => {
    const { rows } = await db.query(
      `SELECT r.return_ref, c.key AS category, s.key AS subreason, r.category_source, r.category_why, r.note_clean
         FROM returns r LEFT JOIN return_categories c ON c.id = r.category_id LEFT JOIN return_subreasons s ON s.id = r.subreason_id`,
    );
    return Object.fromEntries(rows.map((r) => [r.return_ref, r]));
  };

  beforeAll(async () => {
    db = await setupDb();
    app = makeApp(db);
    ({ agent: editor } = await signedInAgent(app, db, { email: 'ed@example.com', role: 'editor' }));
    ({ agent: viewer } = await signedInAgent(app, db, { email: 'viv@example.com' }));
  });
  afterAll(() => db?.end());

  it('only uses categories and sub-reasons in the codebook, with the same tie-break order', async () => {
    const codebook = await getCodebook(db);
    const keys = new Set(codebook.flatMap((c) => c.subreasons.map((s) => `${c.key}/${s.key}`)));
    for (const [category, subreason] of RULES) expect(keys.has(`${category}/${subreason}`), `${category}/${subreason}`).toBe(true);
    for (const c of codebook) expect(c.tie_break_rank ?? undefined).toBe(rank.get(c.key));
  });

  it('sorts returns as they are imported', async () => {
    await editor.post('/api/returns/import').send({ channel: 'tiktok', rows: TIKTOK }).expect(200);
    const rows = await byRef();
    expect(rows['R-10']).toMatchObject({ category: 'connectivity', subreason: 'wont_connect', category_source: 'rule', note_clean: 'Would not connect to wifi' });
    expect(rows['R-11']).toMatchObject({ category: 'no_comment', subreason: 'blank', category_why: 'no note' });
    expect(rows['R-12']).toMatchObject({ category: null, category_source: '' });
    const { body } = await viewer.get('/api/activity').expect(200);
    expect(body.activity.find((a) => a.action === 'imported').changes).toMatchObject({ sorted: 2, unsorted: 1 });
  });

  it('lets editors re-sort, and never overwrites a manual call', async () => {
    const { rows: [manual] } = await db.query(
      `SELECT c.id AS category_id, s.id AS subreason_id FROM return_subreasons s JOIN return_categories c ON c.id = s.category_id
        WHERE c.key = 'non_specific' AND s.key = 'vague'`,
    );
    await db.query(
      `UPDATE returns SET category_id = $1, subreason_id = $2, category_source = 'manual', category_why = 'checked by hand' WHERE return_ref = 'R-12'`,
      [manual.category_id, manual.subreason_id],
    );
    await db.query("UPDATE returns SET category_id = NULL, subreason_id = NULL, category_source = '', category_why = '' WHERE return_ref = 'R-10'");

    await viewer.post('/api/returns/sort').expect(403);
    const res = await editor.post('/api/returns/sort').expect(200);
    expect(res.body).toEqual({ sorted: 2, unsorted: 0, flagged: 0 });

    const rows = await byRef();
    expect(rows['R-10']).toMatchObject({ category: 'connectivity', category_source: 'rule' });
    expect(rows['R-12']).toMatchObject({ category: 'non_specific', category_source: 'manual', category_why: 'checked by hand' });
    const { body } = await viewer.get('/api/activity').expect(200);
    expect(body.activity.find((a) => a.action === 'sorted')).toMatchObject({ entity_type: 'returns', changes: { sorted: 2, unsorted: 0 } });
  });
});
