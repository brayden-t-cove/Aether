/**
 * Sort returns into the codebook from what the buyer wrote.
 *
 * Only the buyer's own words count: Amazon's preset menu text and TikTok's
 * reason are stripped from the note first, because the platform reason is
 * often wrong. A return with no note goes to No Comment. Otherwise every
 * keyword rule is tried; when a note fits more than one category, the
 * category with the lowest tie-break rank wins (see return_categories), and
 * within a category the first matching sub-reason in RULES wins.
 *
 * Returns the rules can't place are left without a category, for a person
 * to sort. Manual calls are never overwritten.
 */
import { getCodebook } from './returnCodebook.js';

// Accents off, curly quotes straight, lower case, so one pattern covers "cámara" and "camara", "won’t" and "won't".
const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’ʼ`]/g, "'")
    .toLowerCase();

// Negations buyers write, with or without the apostrophe.
const NOT = String.raw`(?:won'?t|wont|will not|wouldn'?t|would not|doesn'?t|does not|dont|don'?t|didn'?t|did not|can'?t|cannot|could ?not|couldn'?t|isn'?t|is not|unable to|not|never|no)`;
const rx = (source) => new RegExp(source, 'i');

/**
 * [category key, sub-reason key, pattern]. Within a category, earlier rules win.
 * Patterns run on folded text (lower case, no accents, straight apostrophes).
 */
export const RULES = [
  ['shipping', 'not_received', rx(String.raw`\b(?:never|not|haven'?t|have not|hasn'?t|has not|didn'?t|did not)\b (?:\w+ ){0,2}(?:receiv\w*|recie\w*|delivered|arrived|arrive|came|come)\b|\bstol(?:e|en)\b|wrong (?:house|address)|(?:package|order) (?:is |was )?(?:missing|lost)|\bentire package\b|\bnever got (?:it|them|my|the (?:package|item|order))\b|\bmail ?box\b|\bparcel (?:box|locker)\b|where (?:it is|is (?:my|the) (?:package|order|item))|(?:don'?t|do not) have it\b`)],
  ['shipping', 'late', rx(String.raw`\b(?:arrived|came|arriving|delivered|delivery|shipping) (?:to+ |way |very )?(?:late|slow)\b|\blate (?:delivery|arrival)\b|delivery date|\btracking\b|stuck (?:at|in) (?:the )?warehouse|\bwaiting (?:over|for|two|three|\d)\b.{0,20}\b(?:days?|weeks?|item|package|order)|(?:not|hasn'?t|has not|never) (?:been )?shipped|how long .{0,30}deliver|took (?:too |a )?long(?: time)? to (?:arrive|ship|get here|deliver)`)],
  ['shipping', 'wrong_missing', rx(String.raw`\bmissing (?:\w+ )?(?:cable|cord|part|parts|piece|pieces|item|items|accessor\w*|screws?|mount|adapter|charger|camera|cameras|bulb|base)\b|\b(?:cable|cord|part|parts|piece|pieces|adapter|charger|camera) (?:is |was |were |are )?missing\b|wrong item (?:was )?(?:sent|received|arrived|came|in)\b|(?:sent|received|got) (?:me )?(?:the |a )?wrong\b|not what (?:i|we) ordered|no es lo que pedi|\bincomplete\b|only (?:one|1) (?:\w+ ){0,2}(?:was )?(?:sent|mailed|shipped|came|arrived|delivered)\b|缺少`)],
  ['shipping', 'damaged_package', rx(String.raw`\b(?:box|package|packaging|packing)\b (?:was |were |came |arrived |had been |is |looked )?(?:already |all )?(?:opened|open|damaged|broken|broke|brock|crushed|torn|ripped)\b|\b(?:opened|damaged|crushed|broken) (?:box|package)`)],

  ['connectivity', 'drops_offline', rx(String.raw`off-?\s?line|disconnect|desconect|\bstay(?:s|ed|ing)? (?:\w+ )?(?:connected|conected|comnected|online|on (?:the )?(?:wi-?fi|internet|network))|keeps? (?:on )?(?:losing|dropping|going (?:out|off))|\blos(?:e|es|ing|t) (?:the |its |my )?(?:connection|wi-?fi|signal|internet)|\blooses (?:connection|wi-?fi|signal)|\bdrop(?:s|ped|ping)? (?:the )?(?:\w+ )?(?:connection|wi-?fi|signal|off)|keep (?:a |the )?connection|maintain|stop(?:ped|s)? connecting|connected (?:\w+ ){0,4}once|\blos(?:s|ses) (?:connection|signal)|stay hooked|keeps? restarting|connection is (?:poor|bad|weak|spotty)|reconnect|\b(?:won'?t|doesn'?t|does not|not|didn'?t|wouldn'?t) stay\b|\bse (?:le )?(?:va|desconecta)|kicks? (?:you|me|it) off|unstable|intermittent|in and out|keeps? (?:resetting|needing (?:to be )?reset)|\breset(?:ting)? it (?:every|over|constantly|again)|\bgoes out\b|\bcuts? (?:out|off)\b|fuera de servicio`)],
  ['connectivity', 'weak_signal', rx(String.raw`(?:weak|low|poor|bad|no) (?:wi-?fi )?(?:signal|range|reception)|(?:signal|range|reception) (?:is |was )?(?:weak|low|poor|bad)|doesn'?t get any (?:service|signal)|only works? (?:inside|indoors|near)|only indoors|(?:outside|outdoors?|through (?:the )?(?:window|glass)|(?:on|in|to) (?:the |my )?windows?)\b.{0,40}\b(?:offline|disconnect|losing|lose|signal|wi-?fi|connection)|(?:offline|disconnect\w*|signal|connection)\b.{0,40}\b(?:outside|outdoors?|through (?:the )?(?:window|glass)|windows?)\b`)],
  ['connectivity', 'router_isp', rx(String.raw`\b2\.4\b|\b5 ?g(?:hz)?\b|\b5\.0\b|\bghz\b|\bmesh\b|\bstarlink\b|\bhot ?spot\b|\bextender\b|\bband\b|frequenc|(?:not |in)compatible with (?:my |our |the )?(?:internet|wi[- ]?fi|network|router|system)|\b(?:work|works|compatible) (?:with|on|for) (?:my|our) (?:type of |kind of )?(?:internet|wi[- ]?fi|network|system)\b|(?:apartment|building|complex)(?:'?s)? (?:wi[- ]?fi|internet|network)|accommodate|dumb down`)],
  ['connectivity', 'bluetooth', rx(String.raw`bluetooth|\bpair\w* (?:\w+ ){0,2}(?:phone|devices?)\b|\bconnect\w* (?:\w+ ){0,2}(?:to|with) (?:my |the |our )?(?:phone|devices?)\b`)],
  ['connectivity', 'wont_connect', rx(String.raw`connect|conect|comnect|\bpair(?:ing|ed|s)?\b|\bsync\b|hook(?:ed)? (?:it |them )?up|\bwi[- ]?fi\b|\bwify\b|\bprogram\b|communicat|\binternet\b|\bnetwork\b|\bonline\b`)],

  ['subscription', 'subscription_cost', rx(String.raw`(?:subscri\w*|suscrip\w*|membership|plan|app|service|fee)\b.{0,40}\b(?:expensive|too (?:high|much)|pricey|insane|costly|cost)|(?:expensive|pricey|costly|too (?:high|much))\b.{0,40}\b(?:subscri\w*|membership|plan|app)|\$\s?\d[\d.,]*\s?(?:a|per|/|each)\s?(?:month|mo|year|yr)`)],
  ['subscription', 'stills_only', rx(String.raw`(?:only|just|solo) (?:\w+ ){0,2}(?:still )?(?:pictures|photos|fotos|snapshots|stills|snaps)|still (?:pictures|photos|images|shots)|no video (?:without|unless)|(?:without|unless) (?:a |you )?(?:\w+ ){0,2}subscri\w* (?:\w+ ){0,3}(?:only|just) (?:pictures|photos)`)],
  ['subscription', 'sd_card', rx(String.raw`\bm?sd\b|micro ?s?sd|sd ?card|memory card|\bssd\b|\busd\b|ads card`)],
  ['subscription', 'unexpected_subscription', rx(String.raw`subscri|suscrip|membership|monthly (?:fee|charge|payment|plan)|\bfees?\b|pay (?:for|to use|monthly|a month|extra|more)|have to pay|charge (?:my card|monthly|a month)|credit card|(?:a|per) month\b|per year|yearly|annual (?:plan|fee)|cloud (?:storage|plan|service)`)],

  ['fit', 'switch_on', rx(String.raw`\bswitch\b|always on|leave (?:the |my |your )?(?:light|switch|lights) on|light (?:switch )?on (?:all|24)|turn(?:ed)? off the light|apag\w* la luz`)],
  ['fit', 'environment', rx(String.raw`landlord|\brental\b|\brent(?:ing)?\b|\bhoa\b|association|not allowed|permission|not (?:suitable|right|the best option|good) for (?:my|our|the)|(?:doesn'?t|does not|won'?t|will not|don'?t) work (?:for|in|on) (?:my|our|the) (?:area|space|yard|home|house|needs|place)|space (?:i|they|we) need`)],
  ['fit', 'window', rx(String.raw`\btint(?:ed)?\b|double.?pane|dual.?pane|\bglass\b|\bwindows?\b(?! ?cam)`)],
  ['fit', 'fixture', rx(String.raw`fixture|socket|\bholder\b|\blamps?\b|lampara|\bfoco\b|porch light|(?:outdoor|outside|exterior|flood|post|ceiling|garage|front|back) (?:\w+ )?lights?\b|\bhang(?:s|ing)? (?:down|upside|up)\b|too (?:big|large|small|heavy|tall|wide)\b|\bceiling\b|\b(?:doesn'?t|does not|won'?t|didn'?t|did not|not|wont) fit\b|\bfits?\b|\bscrew`)],
  ['fit', 'view_angle', rx(String.raw`\bangle\b|field of view|\bviewing (?:area|angle|range)\b|\bcover(?:age|s)?\b|perimeter|abarca|wide enough|\bnarrow\b|\bplacement|where (?:i|we) (?:need|want)(?:ed)?|view (?:i|we) (?:was|were|wanted)|view from|\baim\b`)],
  ['fit', 'cord_power', rx(String.raw`\bcords?\b|(?:cable|wire) (?:is |was )?(?:too|not long)|\b(?:no|nearest|near|close to|far from|without|by) (?:an? |the )?(?:plug|outlet|power)s?\b|\b(?:plug|outlet)s? (?:near|where|close|by|nearby|far|available)|power (?:source|supply|outlet)|extension cord|\bwireless\b|inalambric|\bcordless\b|batter(?:y|ies)|\badapter\b|hard ?wired`)],
  ['fit', 'mount', rx(String.raw`\bmount|adhesi|sticky|stick(?:s|ing)? (?:to|on)|suction|magnet|bracket`)],

  ['performance', 'not_recording', rx(String.raw`${NOT} (?:\w+ ){0,2}(?:record|save|saving|saved|captur|catch)|miss(?:es|ed|ing)? (?:events?|things|people|motion|everything)|continuous\w* record|no recordings?|stopped recording`)],
  ['performance', 'motion', rx(String.raw`motion|detect|\balerts?\b|notific|notif\b|\btrack(?:s|ing)?\b|\bfollows? (?:me|people|movement|motion|objects?|the)\b|\brotat|\bswivel|\bpan\b|\btilt|move around|\bturns? (?:toward|to|around)|picks? (?:people )?up`)],
  ['performance', 'lag', rx(String.raw`\blag|\bslow\b|\bdelay|freez|takes? (?:too |so |very )?(?:long|forever) to (?:load|open|view|show)|live (?:view|feed|video|stream)|buffer|\bloading\b|no carga|stuck`)],
  ['performance', 'image_quality', rx(String.raw`quality|\bnight\b|noche|\bblur|blury|fuzzy|grainy|pixel|resolution|\bclear\b|\bpicture\b|\bimage|imagen|glare|lighting|\bdark\b|\bfocus|\bzoom|\bcolou?r`)],

  ['hardware', 'overheating', rx(String.raw`overheat|\bhot\b|\bfire\b|smok|\bburn|melt|spark|calient`)],
  ['hardware', 'support_confirmed', rx(String.raw`(?:support|customer service|tech|luna|manufacturer|they|agent)\b.{0,60}\b(?:defective|faulty|replacement|bad unit|needs? (?:an? )?update)|\b(?:defective|faulty)\b.{0,60}\b(?:support|customer service|told|according|manufacturer|luma|luna)`)],
  ['hardware', 'works_then_dies', rx(String.raw`work(?:s|ed)? for (?:a |about )?(?:second|minute|few|day|couple|week|while|little)|(?:stopped|stop|quit) working|\bdied\b|dead after`)],
  ['hardware', 'wont_power_on', rx(String.raw`${NOT} (?:even )?(?:turn|power|light|switch|boot)(?:ed|s)? ?(?:on|up)\b|${NOT} (?:even )?(?:turn|power)\b|no power|dead on arrival|\bdoa\b|\bbroken?\b|\bcracked\b|shattered|no (?:enciende|prende)|reset loop|restarts?`)],

  ['setup', 'no_manual', rx(String.raw`instruction|\bmanual\b|\bguide\b|directions|booklet`)],
  ['setup', 'smart_home', rx(String.raw`alexa|google home|echo show|homekit|smartthings|\brtsp\b|onvif|\bnvr\b|ifttt|eye gaze|home assistant|blue ?iris`)],
  ['setup', 'trust', rx(String.raw`authentic|counterfeit|\bfake\b|knock ?off|identification|already (?:set ?up|registered|linked|tied|bound|set on)|someone else'?s (?:email|account)|(?:email|account)s? (?:are |were |was )?already|not trusting|don'?t trust`)],
  ['setup', 'firmware', rx(String.raw`firmware|\bupdat|\bupgrad`)],
  ['setup', 'app_setup', rx(String.raw`\bapp\b|\bapplication\b|set ?up|setup|install|activat|\bqr\b|\bscan|download|log ?in|sign ?in|\baccount\b|register|\berror\b`)],

  ['changed_mind', 'mistake', rx(String.raw`by mistake|mistaken|accident|\bnot mean to\b|didn'?t (?:mean|intend) to|never ordered|didn'?t order|did not order|ordered (?:the )?wrong|wrong one|(?:didn'?t|did not) (?:even )?realize (?:i|we) (?:had )?(?:ordered|bought|purchased)|unauthori[sz]ed|meant to (?:order|buy|get)|wanted (?:the |an? )?(?:indoor|outdoor|other|different)`)],
  ['changed_mind', 'bought_another', rx(String.raw`another (?:one|camera|brand|system)|different (?:camera|brand|system|one)|other (?:brand|camera|cameras|system|two)|already (?:have|had|own|bought|got|purchased)|bought (?:a |an )?(?:better|another|different|other)|found (?:a |an )?(?:better|cheaper|another|other)|better (?:price|deal|one)|\bduplicate|double.?order|ordered (?:two|2|extra|more than)|\bto+ many\b|only need(?:ed)? (?:one|two|three|\d)|\binstead\b|like the other|both arrived|got (?:a |an )?better|already (?:ordered|received)|thought it'?s part of`)],
  ['changed_mind', 'circumstances', rx(String.raw`no longer|(?:don'?t|do not|didn'?t|dont) need|not need(?:ed)?|changed? (?:my |our )?mind|\bgift\b|\bmoving\b|\bmoved\b|circumstances|decided (?:not|to|against)|\bya no\b|no (?:lo )?necesito|no necesario|(?:don'?t|do not|dont) want|no need`)],

  ['non_specific', 'vague', rx(String.raw`${NOT} (?:\w+ ){0,3}(?:work|working|works|function|functioning|funciona|sirve)|defective|faulty|junk|garbage|trash|terrible|horrible|awful|useless|sucks|\bpoor\b|\bcheap\b|not (?:as|what) (?:i |we )?(?:expected|described|advertised|thought)|not as (?:described|advertised|expected)|disappoint|(?:don'?t|didn'?t|do not|did not|dont) like|not (?:happy|satisfied|good)|dissatisf|malfunction|\bbad (?:camera|product|quality|item)\b|\bproblems?\b|\bissues?\b|\bdamaged\b|neither (?:\w+ )?works?|not (?:what|the (?:type|kind) of \w+) (?:was |we |i )?(?:\w+ )?(?:intended|looking for|needed|wanted)|not (?:be )?right for|features for (?:my|our) use|(?:can ?not|cannot|can'?t|unable to) use\b|(?:didn'?t|did not|doesn'?t|does not) do what|not (?:very )?accurate|fonctionne pas|pas ce que|\bcheep\b|no lo use`)],
];

/**
 * Flags ride alongside the category. [flag key, pattern on the folded note].
 * "All units affected" also needs more than one unit, or words that say so.
 */
export const FLAG_RULES = [
  ['support_unresolved', rx(String.raw`customer (?:service|support|care|serivce)|costumer service|tech(?:nical)? support|\bsupport\b|help ?desk|\bcalled (?:luna|the (?:company|number|manufacturer))|\bcontacted\b|spoke (?:to|with) (?:luna|someone|an? (?:agent|rep)|support|the company|customer)|\bservice people\b|\bluna (?:help|team|told|said)\b|\b(?:they|agent|rep)\b (?:\w+ ){0,3}(?:couldn'?t|could not|can'?t|cannot|were unable to|was unable to) help`)],
  ['cites_claim', rx(String.raw`advertis|marketing|\bfraud|supposed to be (?:a|an)\b|\blisting\b|\bdescription\b|\bstated\b|\bpromis|\bclaims? (?:to|it|that)\b|misleading|false|\bthe add?\b|\bads?\b (?:made|said|showed|says)|\btik ?tok (?:live|videos?|shop|ad)\b|\blive\b(?! (?:view|feed|video|stream|motion|footage|recording)|ly)|(?:said|says|showed) (?:it|they) (?:would|could|can|will)\b|(?:it'?s|it is|they'?re) supposed to (?:have|include|come|show|record|work with)|the video (?:said|showed)|(?:seller|host|presenter) said`)],
  ['all_units', rx(String.raw`\bboth\b|\bneither\b|\bnone of\b|\ball (?:\d+|two|three|four|five|of (?:them|the)|cameras|units|bulbs|the cameras)\b|\bevery (?:one|camera|unit)\b|\beach (?:one|camera|unit)\b|\b(?:2|3|4|5|two|three|four|five) (?:cameras|of them|units|bulbs|devices|lights)\b|\bsecond (?:set|one|camera)\b`)],
  ['looks_used', rx(String.raw`(?:looks?|looked|obviously|clearly|was|been|already|previously|seems?|seemed) used\b|\bused (?:one|camera|item|product|unit)\b|scratch|previously (?:returned|opened)|refurbish|already (?:set ?up|registered|linked|tied|bound|set on)|someone else'?s|\bdirty\b|open(?:ed)? box|not (?:brand )?new|second.?hand|identification|outer date|out ?dated`)],
];

/** Which flags a note suggests. `units` is how many units the return covers. */
export function suggestFlags(note, { units = 1 } = {}) {
  const text = fold(note);
  if (!text) return [];
  return FLAG_RULES.filter(([key, pattern]) => pattern.test(text) && (key !== 'all_units' || units > 1 || /\bboth\b|\bneither\b|\bnone of\b|\ball\b|\bevery\b|\beach\b/.test(text))).map(([key]) => key);
}

/** Returns that never reached a customer, or were samples, go by their platform code whatever the note says. */
const BY_REASON = [
  ['amazon', /^UNDELIVERABLE/, 'not_customer', 'undeliverable'],
  ['amazon', /^DAMAGED_BY_FC$/, 'not_customer', 'damaged_warehouse'],
  ['amazon', /^DAMAGED_BY_CARRIER$/, 'not_customer', 'damaged_carrier'],
  ['tiktok', /REFUNDABLE_SAMPLE/, 'sample', 'refundable_sample'],
];

/**
 * Amazon's return menu writes the buyer's choices into the comment ahead of their own words, joined by "|":
 * "Changed Mind|My needs changed|We moved". Some top-level choices have a second level.
 * Top level → { second-level choice → No Comment sub-reason, '' → sub-reason when only the top level was picked }.
 */
const AMAZON_MENU = {
  'changed mind': {
    'my needs changed': 'preset_needs_changed',
    'found other item': 'preset_found_other',
    'found a better price': 'preset_better_price',
    'not as expected': 'preset_not_as_expected',
    'item is defective': '',
  },
  'ordering issue': {
    'ordered too many': 'preset_too_many',
    'accidental purchase': 'preset_accidental',
    'ordered wrong item': 'preset_wrong_item',
    'unauthorized purchase': '',
  },
  'delivery issue': { 'item was late': '' },
  'not as expected': { '': 'preset_not_as_expected' },
  new: { '': 'preset_new' },
  'not compatible': {},
  defective: {},
  'received wrong item': {},
};
// Answers to Amazon's follow-up question that say nothing.
const FILLER = new Set(['', 'no', 'none', 'n/a', 'n\\a', 'na', 'ok', 'same', 'i dont know', "i don't know", 'nothing specific', '.', '-']);

// Amazon's report HTML-escapes the comment ("Doesn&#39;t").
const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const unescape = (s) =>
  s.replace(/&(?:#(\d+)|#x([\da-f]+)|(\w+));/gi, (m, dec, hex, name) =>
    dec ? String.fromCodePoint(Number(dec)) : hex ? String.fromCodePoint(parseInt(hex, 16)) : (ENTITIES[name.toLowerCase()] ?? m));

// Buyers sometimes leave a phone number. It's kept out of the cleaned note, which is what people read.
const PHONE = /(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\b\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

// Notes that say nothing: empty, "N/A", "none", ".", "-".
const EMPTY = /^[\s.\-_/,!?]*(?:n\/?a|none|no|nothing|null|nil)?[\s.\-_/,!?]*$/i;

/** The buyer's own words, with the platform's text taken off. `preset` is the menu choice, when there was one. */
export function cleanNote({ channel, comment, reason }) {
  let note = String(comment ?? '').replace(/\s+/g, ' ').trim();
  let preset = '';
  if (channel === 'amazon') {
    const parts = unescape(note).split('|').map((p) => p.trim());
    const top = AMAZON_MENU[parts[0]?.toLowerCase()];
    if (top) {
      parts.shift();
      const second = parts[0]?.toLowerCase();
      if (second && Object.hasOwn(top, second)) {
        parts.shift();
        preset = top[second];
      } else preset = top[''] ?? '';
    }
    while (parts.length && FILLER.has(parts.at(-1).toLowerCase())) parts.pop();
    note = parts.filter((p) => !FILLER.has(p.toLowerCase())).join(' | ');
  }
  // A TikTok note that only repeats the reason says nothing more; one that starts with it and goes on is kept whole.
  const bare = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (channel === 'tiktok' && reason && bare(note) === bare(reason)) note = '';
  note = note.replace(PHONE, '[phone removed]');
  return { note: EMPTY.test(note) ? '' : note.trim(), preset };
}

/**
 * Work out one return's category. `rank` maps category key → tie-break rank.
 * → { note_clean, category, subreason, why }, with category null when no rule fits.
 */
export function sortReturn({ channel, reason_code = '', reason = '', customer_comment = '' }, { rank }) {
  const { note, preset } = cleanNote({ channel, comment: customer_comment, reason });
  const code = String(reason_code).toUpperCase();
  const fixed = BY_REASON.find(([ch, re]) => ch === channel && re.test(code));
  if (fixed) return { note_clean: note, category: fixed[2], subreason: fixed[3], why: `reason code: ${code}` };
  if (!note) return { note_clean: '', category: 'no_comment', subreason: preset || 'blank', why: preset ? 'menu choice only, no note' : 'no note' };

  const text = fold(note);
  let best = null;
  for (const [category, subreason, pattern] of RULES) {
    const r = rank.get(category);
    if (best && r >= best.rank) continue;
    const m = pattern.exec(text);
    if (m) best = { rank: r, category, subreason, matched: m[0].trim() };
  }
  if (!best) return { note_clean: note, category: null, subreason: null, why: '' };
  return { note_clean: note, category: best.category, subreason: best.subreason, why: `note matched: "${best.matched}"` };
}

/**
 * Re-run the rules on every return (or only one import's returns, or the given ids). Categories set by a person are kept;
 * flags are worked out for every return, except where a person turned one on or off.
 * → { sorted, unsorted, flagged }: returns given a category, ones the rules couldn't place, and returns with a flag.
 */
export async function sortReturns(db, { importId, ids } = {}) {
  const codebook = await getCodebook(db);
  const rank = new Map(codebook.map((c) => [c.key, c.tie_break_rank ?? Infinity]));
  const codebookIds = new Map(codebook.flatMap((c) => c.subreasons.map((s) => [`${c.key}/${s.key}`, [c.id, s.id]])));

  const scope = importId ? ['WHERE import_id = $1', [importId]] : ids ? ['WHERE id = ANY($1::uuid[])', [ids]] : ['', []];
  const { rows } = await db.query(`SELECT id, channel, reason_code, reason, customer_comment, quantity, category_source FROM returns ${scope[0]}`, scope[1]);

  const cols = { id: [], category: [], subreason: [], source: [], why: [], note: [] };
  const flags = { id: [], flag: [] };
  let sorted = 0;
  let unsorted = 0;
  for (const r of rows) {
    const s = sortReturn(r, { rank });
    for (const flag of suggestFlags(s.note_clean, { units: r.quantity })) {
      flags.id.push(r.id);
      flags.flag.push(flag);
    }
    if (r.category_source === 'manual') continue;
    const [categoryId, subreasonId] = s.category ? codebookIds.get(`${s.category}/${s.subreason}`) : [null, null];
    if (categoryId) sorted++;
    else unsorted++;
    cols.id.push(r.id);
    cols.category.push(categoryId);
    cols.subreason.push(subreasonId);
    cols.source.push(categoryId ? 'rule' : '');
    cols.why.push(s.why);
    cols.note.push(s.note_clean);
  }
  await db.query(
    `UPDATE returns r SET category_id = u.category_id, subreason_id = u.subreason_id, category_source = u.source,
            category_why = u.why, note_clean = u.note
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[])
            AS u (id, category_id, subreason_id, source, why, note)
      WHERE r.id = u.id AND r.category_source <> 'manual'`,
    [cols.id, cols.category, cols.subreason, cols.source, cols.why, cols.note],
  );
  await db.query("DELETE FROM return_flags WHERE source = 'rule' AND return_id = ANY($1::uuid[])", [rows.map((r) => r.id)]);
  await db.query(
    `INSERT INTO return_flags (return_id, flag, source)
     SELECT id, flag, 'rule' FROM unnest($1::uuid[], $2::text[]) AS u (id, flag)
     ON CONFLICT (return_id, flag) DO NOTHING`,
    [flags.id, flags.flag],
  );
  return { sorted, unsorted, flagged: new Set(flags.id).size };
}
