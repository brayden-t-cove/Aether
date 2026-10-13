/**
 * Sort returns into the codebook from what the buyer wrote.
 *
 * Only the buyer's own words count: Amazon's preset menu text and TikTok's
 * reason are stripped from the note first, because the platform reason is
 * often wrong. A return with no note goes to No Comment. Otherwise every
 * keyword rule is tried, and each bucket the note matches is a mention (the
 * first matching sub-reason in RULES within each bucket). A change of mind
 * counts only when nothing else is mentioned, and a note that only says
 * something vague is Generic, not a mention. The return's main category is
 * its highest-priority mention (lowest tie-break rank in return_categories).
 *
 * Returns the rules can't place are left without a category, for a person
 * to sort. What a person decides is never overwritten.
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
  ['shipping', 'not_received', rx(String.raw`\b(?:never|not|haven'?t|have not|hasn'?t|has not|didn'?t|did not)\b (?:\w+ ){0,2}(?:receiv\w*|recie\w*|delivered|arrived|arrive|came|come)\b(?! (?:until|till|with)\b)|\bstol(?:e|en)\b|wrong (?:house|address)|(?:package|order) (?:is |was )?(?:missing|lost)|\bentire package\b|\bnever got (?:it|them|my|the (?:package|item|order))\b(?! (?:to|working|connected|online)\b)|\bmail ?box\b|\bparcel (?:box|locker)\b|where (?:it is|is (?:my|the) (?:package|order|item))|(?:don'?t|do not) have it\b`)],
  ['shipping', 'late', rx(String.raw`(?:didn'?t|did not|wasn'?t|was not) (?:arrive|come|get here|delivered) (?:until|till)\b|\bwas due (?:by|on)\b|\b(?:arrived|came|arriving|delivered|delivery|shipping) (?:to+ |way |very )?(?:late|slow)\b|\blate (?:delivery|arrival)\b|delivery date|\btracking\b|stuck (?:at|in) (?:the )?warehouse|\bwaiting (?:over|for|two|three|\d)\b.{0,20}\b(?:days?|weeks?|item|package|order)|(?:not|hasn'?t|has not|never) (?:been )?shipped|how long .{0,30}deliver|took (?:too |a )?long(?: time)? to (?:arrive|ship|get here|deliver)`)],
  ['shipping', 'wrong_missing', rx(String.raw`\bno (?:\w+ ){0,2}(?:cables?|cords?|chargers?|adapters?|plugs?|screws|mount|base)\b (?:was |were )?(?:included|in the box|provided)|\b(?:cables?|cords?|chargers?|adapters?) (?:was |were |is |are )?not included|(?:didn'?t|did not|doesn'?t|does not) (?:come with|include) (?:a |the |any )?(?:\w+ )?(?:cables?|cords?|chargers?|adapters?)\b|\bmissing (?:\w+ ){0,2}(?:cable|cord|part|parts|piece|pieces|item|items|accessor\w*|screws?|mount|adapter|charger|camera|cameras|bulb|base)\b|\b(?:cable|cord|part|parts|piece|pieces|adapter|charger|camera) (?:is |was |were |are )?missing\b|wrong item (?:was )?(?:sent|received|arrived|came|in)\b|(?:sent|received|got) (?:me )?(?:the |a )?wrong\b|not what (?:i|we) ordered|no es lo que pedi|\bincomplete\b|only (?:one|1) (?:\w+ ){0,2}(?:was )?(?:sent|mailed|shipped|came|arrived|delivered)\b|缺少`)],
  ['shipping', 'damaged_package', rx(String.raw`\b(?:arrived|came|received|delivered|showed up|was delivered) (?:\w+ ){0,2}damaged\b|\bdamaged (?:on arrival|in (?:shipping|transit|the mail|delivery)|when (?:it )?(?:arrived|received|delivered))\b|\b(?:box|package|packaging|packing)\b (?:was |were |came |arrived |had been |is |looked )?(?:already |all )?(?:opened|open|damaged|broken|broke|brock|crushed|torn|ripped)\b|\b(?:opened|damaged|crushed|broken) (?:box|package)`)],

  ['connectivity', 'drops_offline', rx(String.raw`off-?\s?line|disconnect|desconect|\bstay(?:s|ed|ing)? (?:\w+ )?(?:connected|conected|comnected|online|on (?:the )?(?:wi-?fi|internet|network))|keeps? (?:on )?(?:losing|dropping|going (?:out|off))|\blos(?:e|es|ing|t) (?:the |its |my )?(?:connection|wi-?fi|signal|internet)|\blooses (?:connection|wi-?fi|signal)|\bdrop(?:s|ped|ping)? (?:the )?(?:\w+ )?(?:connection|wi-?fi|signal|off)|keep (?:a |the )?connection|maintain|stop(?:ped|s)? connecting|connected (?:\w+ ){0,4}once|\blos(?:s|ses) (?:connection|signal)|stay hooked|keeps? restarting|connection is (?:poor|bad|weak|spotty)|reconnect|\b(?:won'?t|doesn'?t|does not|not|didn'?t|wouldn'?t) stay\b|\bse (?:le )?(?:va|desconecta)|kicks? (?:you|me|it) off|unstable|intermittent|in and out|keeps? (?:resetting|needing (?:to be )?reset)|\breset(?:ting)? it (?:every|over|constantly|again)|\bgoes out\b|\bcuts? (?:out|off)\b|fuera de servicio`)],
  ['connectivity', 'weak_signal', rx(String.raw`(?:weak|low|poor|bad|no) (?:wi-?fi )?(?:signal|range|reception)|(?:signal|range|reception) (?:is |was )?(?:weak|low|poor|bad)|doesn'?t get any (?:service|signal)|only works? (?:inside|indoors|near)|only indoors|(?:outside|outdoors?|through (?:the )?(?:window|glass)|(?:on|in|to) (?:the |my )?windows?)\b.{0,40}\b(?:offline|disconnect|losing|lose|signal|wi-?fi|connection)|(?:offline|disconnect\w*|signal|connection)\b.{0,40}\b(?:outside|outdoors?|through (?:the )?(?:window|glass)|windows?)\b`)],
  ['connectivity', 'router_isp', rx(String.raw`\b2\.4\b|\b5 ?g(?:hz)?\b|\b5\.0\b|\bghz\b|\bmesh\b|\bstarlink\b|\bhot ?spot\b|\bextender\b|\bband\b|frequenc|(?:not |in)compatible with (?:my |our |the )?(?:internet|wi[- ]?fi|network|router|system)|\b(?:work|works|compatible) (?:with|on|for) (?:my|our) (?:type of |kind of )?(?:internet|wi[- ]?fi|network|system)\b|(?:apartment|building|complex)(?:'?s)? (?:wi[- ]?fi|internet|network)|accommodate|dumb down`)],
  ['connectivity', 'bluetooth', rx(String.raw`bluetooth|\bpair\w* (?:\w+ ){0,2}(?:phone|devices?)\b|\bconnect\w* (?:\w+ ){0,2}(?:to|with) (?:my |the |our )?(?:phone|devices?)\b`)],
  ['connectivity', 'wont_connect', rx(String.raw`empareja|vincula|connect|conect|comnect|\bpair(?:ing|ed|s)?\b|\bsync\b|hook(?:ed)? (?:it |them )?up|\bwi[- ]?fi\b|\bwify\b|\bprogram\b|communicat|\binternet\b|\bnetwork\b|\bonline\b`)],

  ['subscription', 'subscription_cost', rx(String.raw`(?:subscri\w*|suscrip\w*|membership|plan|app|service|fee)\b.{0,40}\b(?:expensive|too (?:high|much)|pricey|insane|costly|cost)|(?:expensive|pricey|costly|too (?:high|much))\b.{0,40}\b(?:subscri\w*|membership|plan|app)|\$\s?\d[\d.,]*\s?(?:a|per|/|each)\s?(?:month|mo|year|yr)`)],
  ['subscription', 'stills_only', rx(String.raw`(?:only|just|solo) (?:\w+ ){0,2}(?:still )?(?:pictures|photos|fotos|snapshots|stills|snaps)|still (?:pictures|photos|images|shots)|no video (?:without|unless)|(?:without|unless) (?:a |you )?(?:\w+ ){0,2}subscri\w* (?:\w+ ){0,3}(?:only|just) (?:pictures|photos)`)],
  ['subscription', 'sd_card', rx(String.raw`\bm?sd\b|micro ?s?sd|sd ?card|memory card|\bssd\b|\busd\b|ads card`)],
  ['subscription', 'unexpected_subscription', rx(String.raw`subscri|suscrip|membership|monthly (?:fee|charge|payment|plan)|\bfees?\b|pay (?:for|to use|monthly|a month|extra|more)|have to pay|charge (?:my card|monthly|a month)|credit card|(?:pay|paying|charge|charged|fee|cost|costs|\$\s?\d[\d.,]*)\b(?:\w+ ){0,3}(?:a|per) month\b|per year|yearly|annual (?:plan|fee)|cloud (?:storage|plan|service)`)],

  ['fit', 'switch_on', rx(String.raw`\bswitch\b|always on|leave (?:the |my |your )?(?:light|switch|lights) on|light (?:switch )?on (?:all|24)|turn(?:ed)? off the light|apag\w* la luz`)],
  ['fit', 'environment', rx(String.raw`landlord|\brental\b|\brent(?:ing)?\b|\bhoa\b|association|not allowed|permission|not (?:suitable|right|the best option|good) for (?:my|our|the)|(?:doesn'?t|does not|won'?t|will not|don'?t) work (?:for|in|on) (?:my|our|the) (?:area|space|yard|home|house|needs|place)|space (?:i|they|we) need`)],
  ['fit', 'window', rx(String.raw`\btint(?:ed)?\b|double.?pane|dual.?pane|\bglass\b|\bwindows?\b(?! ?cam)`)],
  ['fit', 'fixture', rx(String.raw`fixture|socket|\bholder\b|\blamps?\b|lampara|\bfoco\b|porch light|(?:outdoor|outside|exterior|flood|post|ceiling|garage|front|back) (?:\w+ )?lights?\b|\bhang(?:s|ing)? (?:down|upside|up)\b|too (?:big|large|small|heavy|tall|wide)\b|\bceiling\b|\b(?:doesn'?t|does not|won'?t|didn'?t|did not|not|wont) fit\b|\bfits?\b|\bscrew(?:s|ed|ing)? (?:it |them )?(?:in|into|onto)\b`)],
  ['fit', 'view_angle', rx(String.raw`\bangle\b|field of view|\bviewing (?:area|angle|range)\b|\bcoverage\b|\bcover(?:s|ed|ing)? (?:\w+ ){0,2}(?:area|yard|driveway|porch|room|space|house|entrance|door|garden|front|back|side|corner|angle)s?\b|perimeter|abarca|wide enough|\bnarrow\b|\bplacement|where (?:i|we) (?:need|want)(?:ed)?|view (?:i|we) (?:was|were|wanted)|view from|\baim\b`)],
  ['fit', 'cord_power', rx(String.raw`\bcords?\b|(?:cable|wire) (?:is |was )?(?:too|not long)|\b(?:no|nearest|near|close to|far from|without|by) (?:an? |the )?(?:plug|outlet|power)s?\b|\b(?:plug|outlet)s? (?:near|where|close|by|nearby|far|available)|power (?:source|supply|outlet)|extension cord|\bwireless\b|inalambric|\bcordless\b|batter(?:y|ies)|\badapter\b|hard ?wired`)],
  ['fit', 'mount', rx(String.raw`\bmount|adhesi|sticky|stick(?:s|ing)? (?:to|on)|suction|magnet|bracket`)],

  ['performance', 'not_recording', rx(String.raw`${NOT} (?:\w+ ){0,2}(?:record|save|saving|saved|captur|catch)|miss(?:es|ed|ing)? (?:events?|things|people|motion|everything)|continuous\w* record|no recordings?|stopped recording`)],
  ['performance', 'motion', rx(String.raw`motion|detect(?:s|ed|ion|ing)? (?:\w+ ){0,2}(?:motion|movement|people|person|anything|anyone|cars?|animals?|faces?)\b|\balerts?\b|notific|notif\b|\btrack(?:s|ing)?\b|\bfollows? (?:me|people|movement|motion|objects?|the)\b|\brotat|\bswivel|\bpan\b|\btilt|move around|\bturns? (?:toward|to|around)|picks? (?:people )?up`)],
  ['performance', 'lag', rx(String.raw`\blag|\bslow\b|\bdelay(?:s|ed)? (?:\w+ ){0,2}(?:video|feed|notification|notifications|alert|alerts|view|stream|footage)|freez|takes? (?:too |so |very )?(?:long|forever) to (?:load|open|view|show)|live (?:view|feed|video|stream) (?:\w+ ){0,3}(?:slow|lags?|freez\w*|buffer\w*|load\w*|delay\w*)|buffer|\bloading\b|no carga|stuck`)],
  ['performance', 'image_quality', rx(String.raw`(?:picture|image|video|camera|night|footage) quality|quality (?:of|is|was)|night ?vision|(?:at|during the) night\b.{0,30}\b(?:see|picture|image|video|blur|dark)|(?:see|picture|image|video)\b.{0,30}\b(?:at|during the) night|noche|\bblur|blury|fuzzy|grainy|pixel|resolution|(?:not|isn'?t|wasn'?t|never|un) ?clear\b|clear (?:picture|image|video|view)|(?:picture|image|video|view) (?:is|was|looks|looked) (?:\w+ )?(?:bad|poor|terrible|awful|dark|blurry|grainy|fuzzy)|(?:bad|poor|terrible|awful) (?:picture|image|video)|imagen|glare|(?:too|very|so|completely) dark|dark (?:picture|image|video)|\bfocus|\bzoom|no colou?r|black and white`)],

  ['performance', 'overheating', rx(String.raw`overheat|\bhot\b|\bfire\b|smok|\bburn|melt|spark|calient`)],
  ['performance', 'support_confirmed', rx(String.raw`(?:support|customer service|tech|luna|manufacturer|they|agent)\b.{0,60}\b(?:defective|faulty|replacement|bad unit|needs? (?:an? )?update)|\b(?:defective|faulty)\b.{0,60}\b(?:support|customer service|told|according|manufacturer|luma|luna)`)],
  ['performance', 'works_then_dies', rx(String.raw`work(?:s|ed)? for (?:a |about )?(?:second|minute|few|day|couple|week|while|little)|(?:stopped|stop|quit) working|\bdied\b|dead after`)],
  ['performance', 'wont_power_on', rx(String.raw`${NOT} (?:\w+ )?(?:charge|charging|hold (?:a )?charge)\b|${NOT} (?:even )?(?:turn|power|light|switch|boot)(?:ed|s)? ?(?:on|up)\b|${NOT} (?:even )?(?:turn|power)\b|no power|dead on arrival|\bdoa\b|\bbroken?\b|\bcracked\b|shattered|no (?:enciende|prende)|reset loop|restarts?`)],

  ['performance', 'no_manual', rx(String.raw`(?:no|missing|without|lack of|poor|bad|confusing|unclear|vague|useless|didn'?t come with|did not come with) (?:\w+ ){0,2}(?:instructions?|manual|directions|guide|booklet)|(?:instructions?|manual|directions)\b (?:\w+ ){0,3}(?:unclear|confusing|missing|bad|useless|hard to|difficult|in (?:chinese|english|spanish))|\bmanual\b`)],
  ['connectivity', 'smart_home', rx(String.raw`alexa|google home|echo show|homekit|smartthings|\brtsp\b|onvif|\bnvr\b|ifttt|eye gaze|home assistant|blue ?iris`)],
  ['non_specific', 'trust', rx(String.raw`authentic|counterfeit|\bfake\b|knock ?off|identification|already (?:set ?up|registered|linked|tied|bound|set on)|someone else'?s (?:email|account)|(?:email|account)s? (?:are |were |was )?already|not trusting|don'?t trust`)],
  ['performance', 'firmware', rx(String.raw`firmware|\bupdat|\bupgrad`)],
  ['performance', 'app_setup', rx(String.raw`\bapp\b|\bapplication\b|set ?up|setup|install|activat|\bqr\b|\bscan|download|log ?in|sign ?in|\baccount\b|register|\berror\b`)],

  ['changed_mind', 'mistake', rx(String.raw`by mistake|por error|mistaken|accident|\bnot mean to\b|didn'?t (?:mean|intend) to|never ordered|didn'?t order|did not order|ordered (?:the )?wrong|wrong one|(?:didn'?t|did not) (?:even )?realize (?:i|we) (?:had )?(?:ordered|bought|purchased)|unauthori[sz]ed|meant to (?:order|buy|get)|wanted (?:the |an? )?(?:indoor|outdoor|other|different)`)],
  ['changed_mind', 'bought_another', rx(String.raw`another (?:one|camera|brand|system)|different (?:camera|brand|system|one)|other (?:brand|camera|cameras|system|two)|already (?:have|had|own|bought|got|purchased)|bought (?:a |an )?(?:better|another|different|other)|found (?:a |an )?(?:better|cheaper|another|other)|better (?:price|deal|one)|\bduplicate|double.?order|ordered (?:two|2|extra|more than)|\bto+ many\b|only need(?:ed)? (?:one|two|three|\d)|\binstead\b|like the other|both arrived|got (?:a |an )?better|already (?:ordered|received)|thought it'?s part of`)],
  ['changed_mind', 'circumstances', rx(String.raw`no longer|(?:don'?t|do not|didn'?t|dont) need|not need(?:ed)?|changed? (?:my |our )?mind|\bgift\b|\bmoving\b|\bmoved\b|circumstances|decided (?:not|to|against)|\bya no\b|no (?:lo )?necesito|no necesario|(?:don'?t|do not|dont) want|no need`)],

  ['generic', 'vague', rx(String.raw`${NOT} (?:\w+ ){0,3}(?:work|working|works|function|functioning|funciona|sirve)|defective|faulty|junk|garbage|trash|terrible|horrible|awful|useless|sucks|\bpoor\b|\bcheap\b|not (?:as|what) (?:i |we )?(?:expected|described|advertised|thought)|not as (?:described|advertised|expected)|disappoint|(?:don'?t|didn'?t|do not|did not|dont) like|not (?:happy|satisfied|good)|dissatisf|malfunction|\bbad (?:camera|product|quality|item)\b|\bproblems?\b|\bissues?\b|\bdamaged\b|neither (?:\w+ )?works?|not (?:what|the (?:type|kind) of \w+) (?:was |we |i )?(?:\w+ )?(?:intended|looking for|needed|wanted)|not (?:be )?right for|features for (?:my|our) use|(?:can ?not|cannot|can'?t|unable to) use\b|(?:didn'?t|did not|doesn'?t|does not) do what|not (?:very )?accurate|fonctionne pas|pas ce que|\bcheep\b|no lo use`)],
];

/**
 * Flags ride alongside the category. [flag key, pattern on the folded note].
 * "Points to a camera fault" catches notes that rule out the buyer's setup: next to the router, other
 * cameras working on the same network, support confirming it's defective.
 * "All units affected" also needs more than one unit, or words that say so.
 */
export const FLAG_RULES = [
  ['support_unresolved', rx(String.raw`customer (?:service|support|care|serivce)|costumer service|tech(?:nical)? support|\bsupport\b|help ?desk|\bcalled (?:luna|the (?:company|number|manufacturer))|\bcontacted\b|spoke (?:to|with) (?:luna|someone|an? (?:agent|rep)|support|the company|customer)|\bservice people\b|\bluna (?:help|team|told|said)\b|\b(?:they|agent|rep)\b (?:\w+ ){0,3}(?:couldn'?t|could not|can'?t|cannot|were unable to|was unable to) help`)],
  ['cites_claim', rx(String.raw`advertis|marketing|\bfraud|supposed to be (?:a|an)\b|\blisting\b|\bdescription\b|\bstated\b|\bpromis|\bclaims? (?:to|it|that)\b|misleading|false|\bthe add?\b|\bads?\b (?:made|said|showed|says)|\btik ?tok (?:live|videos?|shop|ad)\b|\blive\b(?! (?:view|feed|video|stream|motion|footage|recording)|ly)|(?:said|says|showed) (?:it|they) (?:would|could|can|will)\b|(?:it'?s|it is|they'?re) supposed to (?:have|include|come|show|record|work with)|the video (?:said|showed)|(?:seller|host|presenter) said`)],
  ['all_units', rx(String.raw`\bboth\b|\bneither\b|\bnone of\b|\ball (?:\d+|two|three|four|five|of (?:them|the)|cameras|units|bulbs|the cameras)\b|\bevery (?:one|camera|unit)\b|\beach (?:one|camera|unit)\b|\b(?:2|3|4|5|two|three|four|five) (?:cameras|of them|units|bulbs|devices|lights)\b|\bsecond (?:set|one|camera)\b`)],
  ['points_to_fault', rx(String.raw`(?:right next to|next to|close to|near|beside|in the same room as|(?:\d+|a few|two|three|five|ten) ?(?:ft|feet|foot|inches|inch) (?:away )?from) (?:the |my |our )?(?:router|modem|wi-?fi|box|extender)|\b\d+ ?(?:ft|feet|foot|inches)\b.{0,30}\b(?:router|modem|wi-?fi)\b|\bsame (?:room|network|location|spot)\b|\b(?:other|another) (?:\w+ ){0,2}(?:cameras?|devices?|bulbs?|ones?)\b.{0,50}\b(?:work|works|worked|working|fine|connect\w*|no (?:issue|problem)s?)\b|(?:support|service|tech|agent|rep|luna|they)\b.{0,40}\b(?:said|says|confirmed|verified|determined|advised|told me|recommend\w*)\b.{0,40}\b(?:defective|faulty|broken|replace\w*)\b|determined (?:the )?(?:item|camera|product|it) (?:is|was) defective`)],
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

// A change of mind that comes with a problem is the problem's doing; it counts only when it's all the buyer said.
const ONLY_ALONE = new Set(['changed_mind']);
// Setup words ("app", "set up", "install", "scan", "error") come up in nearly every connection complaint; they
// count as an app or setup problem only when the note mentions nothing else.
const WEAK = new Set(['performance/app_setup']);
// Two matches that describe one problem: the second isn't counted when the first is there.
const SAME_PROBLEM = [
  ['connectivity/weak_signal', 'fit/window'],
  ['shipping/wrong_missing', 'fit/mount'],
];
// Says nothing specific: not a mention, and only the return's group when nothing specific is mentioned.
const GENERIC = 'generic';

/**
 * Every bucket some notes mention: [{ category, subreason, matched, note }], the first matching sub-reason in each
 * bucket, from the first note that mentions it. A change of mind is dropped when a problem is also mentioned, and so
 * are setup words; two matches for one problem count once. Vague words come back as a single Generic entry only
 * when nothing specific is mentioned.
 */
export function findMentions(notes) {
  const found = new Map();
  const hits = new Set(); // every sub-reason that matched, not just each bucket's first, for SAME_PROBLEM
  for (const note of notes) {
    const text = fold(note);
    if (!text) continue;
    for (const [category, subreason, pattern] of RULES) {
      const m = pattern.exec(text);
      if (!m) continue;
      hits.add(`${category}/${subreason}`);
      if (!found.has(category)) found.set(category, { category, subreason, matched: m[0].trim(), note });
    }
  }
  const key = (m) => `${m.category}/${m.subreason}`;
  const all = [...found.values()].filter((m) => !SAME_PROBLEM.some(([first, second]) => key(m) === second && hits.has(first)));
  const specific = all.filter((m) => m.category !== GENERIC);
  if (!specific.length) return all;
  const strong = specific.filter((m) => !ONLY_ALONE.has(m.category) && !WEAK.has(key(m)));
  if (strong.length) return strong;
  const weak = specific.filter((m) => WEAK.has(key(m)));
  return weak.length ? weak : specific;
}

const matchedWhy = (m) => `note matched: "${m.matched}"`;

/**
 * Work out one return's mentions and main category. `rank` maps category key → tie-break rank. `comments` are
 * further raw comments on the same return (an Amazon order's units), read for mentions too.
 * → { note_clean, category, subreason, why, mentions: [{ category, subreason, why, note }] }, with category null
 * when no rule fits. Generic, No Comment and set-aside returns have no mentions.
 */
export function sortReturn({ channel, reason_code = '', reason = '', customer_comment = '', comments = [] }, { rank }) {
  const { note, preset } = cleanNote({ channel, comment: customer_comment, reason });
  const code = String(reason_code).toUpperCase();
  const fixed = BY_REASON.find(([ch, re]) => ch === channel && re.test(code));
  if (fixed) return { note_clean: note, category: fixed[2], subreason: fixed[3], why: `reason code: ${code}`, mentions: [] };
  const others = comments.map((c) => cleanNote({ channel, comment: c, reason }).note).filter((n) => n && n !== note);
  if (!note && !others.length) {
    return { note_clean: '', category: 'no_comment', subreason: preset || 'blank', why: preset ? 'menu choice only, no note' : 'no note', mentions: [] };
  }

  const found = findMentions([note, ...others]);
  if (found.length === 1 && found[0].category === GENERIC) {
    return { note_clean: note, category: GENERIC, subreason: found[0].subreason, why: matchedWhy(found[0]), mentions: [] };
  }
  if (!found.length) return { note_clean: note, category: null, subreason: null, why: '', mentions: [] };
  const mentions = found
    .map((m) => ({ category: m.category, subreason: m.subreason, why: matchedWhy(m), note: m.note }))
    .sort((a, b) => (rank.get(a.category) ?? Infinity) - (rank.get(b.category) ?? Infinity));
  const top = mentions[0];
  return { note_clean: note, category: top.category, subreason: top.subreason, why: top.why, mentions };
}

/**
 * A return's main category from its mentions: the highest-priority one that isn't dismissed. Returns with no
 * mention left keep a non-bucket group (Generic, No Comment, set aside), or go back to unsorted if they were
 * filed under a bucket. Run after a person adds, removes or re-files a mention.
 */
export async function syncPrimary(db, ids) {
  if (!ids.length) return;
  await db.query(
    `UPDATE returns r SET category_id = t.category_id, subreason_id = t.subreason_id, category_why = t.why,
            category_source = CASE WHEN t.source = 'manual' OR t.checked_at IS NOT NULL THEN 'manual' ELSE 'rule' END
       FROM (SELECT DISTINCT ON (m.return_id) m.return_id, m.category_id, m.subreason_id, m.why, m.source, m.checked_at
               FROM return_mentions m JOIN return_categories c ON c.id = m.category_id
              WHERE m.return_id = ANY($1::uuid[]) AND NOT m.dismissed AND m.subreason_id IS NOT NULL
              ORDER BY m.return_id, c.tie_break_rank NULLS LAST, c.sort_order) t
      WHERE r.id = t.return_id
        -- Set aside, or put outside the buckets by a person (Generic, No Comment): that stands.
        AND NOT EXISTS (SELECT 1 FROM return_categories c WHERE c.id = r.category_id AND (c.set_aside OR (NOT c.in_share AND r.category_source = 'manual')))`,
    [ids],
  );
  // Filed under a bucket, but every mention has been taken away: back to unsorted, for a person to file.
  await db.query(
    `UPDATE returns r SET category_id = NULL, subreason_id = NULL, category_source = '', category_why = ''
      WHERE r.id = ANY($1::uuid[])
        AND EXISTS (SELECT 1 FROM return_categories c WHERE c.id = r.category_id AND c.in_share)
        AND NOT EXISTS (SELECT 1 FROM return_mentions m WHERE m.return_id = r.id AND NOT m.dismissed AND m.subreason_id IS NOT NULL)`,
    [ids],
  );
}

/**
 * Re-run the rules on every return (or only one import's returns, or the given ids). Mentions a person added,
 * checked or dismissed are kept as they are; the rules' other mentions are worked out again. A main category a
 * person chose outside the buckets (Generic, No Comment, set aside) is kept. Flags are worked out for every
 * return, except where a person turned one on or off.
 * → { sorted, unsorted, flagged }: returns given a category, ones the rules couldn't place, and returns with a flag.
 */
export async function sortReturns(db, { importId, ids, unsortedMentions } = {}) {
  const codebook = await getCodebook(db);
  const rank = new Map(codebook.map((c) => [c.key, c.tie_break_rank ?? Infinity]));
  const codebookIds = new Map(codebook.flatMap((c) => c.subreasons.map((s) => [`${c.key}/${s.key}`, [c.id, s.id]])));

  const scope = importId
    ? ['WHERE r.import_id = $1', [importId]]
    : ids
      ? ['WHERE r.id = ANY($1::uuid[])', [ids]]
      : unsortedMentions
        ? ['WHERE NOT r.mentions_sorted', []]
        : ['', []];
  const { rows } = await db.query(
    `SELECT r.id, r.channel, r.reason_code, r.reason, r.customer_comment, r.quantity, r.category_source,
            c.in_share AS filed_in_bucket,
            ARRAY(SELECT u.customer_comment FROM return_units u WHERE u.return_id = r.id AND u.customer_comment <> '' ORDER BY u.unit_date, u.report_line) AS comments
       FROM returns r LEFT JOIN return_categories c ON c.id = r.category_id ${scope[0]}`,
    scope[1],
  );

  const cols = { id: [], category: [], subreason: [], source: [], why: [], note: [] };
  const found = { id: [], category: [], subreason: [], why: [], note: [] };
  const flags = { id: [], flag: [] };
  let sorted = 0;
  let unsorted = 0;
  for (const r of rows) {
    const s = sortReturn(r, { rank });
    const notes = [s.note_clean, ...s.mentions.map((m) => m.note)].filter(Boolean).join(' ');
    for (const flag of suggestFlags(notes, { units: r.quantity })) {
      flags.id.push(r.id);
      flags.flag.push(flag);
    }
    for (const m of s.mentions) {
      const [categoryId, subreasonId] = codebookIds.get(`${m.category}/${m.subreason}`) || [];
      if (!categoryId) continue;
      found.id.push(r.id);
      found.category.push(categoryId);
      found.subreason.push(subreasonId);
      found.why.push(m.why);
      found.note.push(m.note);
    }
    // A person's choice outside the buckets stays; one inside them is worked out from the mentions below.
    if (r.category_source === 'manual' && !r.filed_in_bucket) continue;
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
  const all = rows.map((r) => r.id);
  await db.query(
    `UPDATE returns r SET category_id = u.category_id, subreason_id = u.subreason_id, category_source = u.source,
            category_why = u.why, note_clean = u.note
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::text[])
            AS u (id, category_id, subreason_id, source, why, note)
      WHERE r.id = u.id`,
    [cols.id, cols.category, cols.subreason, cols.source, cols.why, cols.note],
  );
  // The rules' own mentions are worked out again; a person's (added, checked or dismissed) stay as they are.
  await db.query(
    "DELETE FROM return_mentions WHERE return_id = ANY($1::uuid[]) AND source = 'rule' AND NOT dismissed AND checked_at IS NULL",
    [all],
  );
  await db.query(
    `INSERT INTO return_mentions (return_id, category_id, subreason_id, source, why, note)
     SELECT u.id, u.category_id, u.subreason_id, 'rule', u.why, u.note
       FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::text[], $5::text[]) AS u (id, category_id, subreason_id, why, note)
       JOIN returns r ON r.id = u.id
      WHERE NOT EXISTS (SELECT 1 FROM return_categories c WHERE c.id = r.category_id AND NOT c.in_share AND r.category_source = 'manual')
     ON CONFLICT (return_id, category_id) DO NOTHING`,
    [found.id, found.category, found.subreason, found.why, found.note],
  );
  await syncPrimary(db, all);
  await db.query('UPDATE returns SET mentions_sorted = true WHERE id = ANY($1::uuid[]) AND NOT mentions_sorted', [all]);
  await db.query("DELETE FROM return_flags WHERE source = 'rule' AND return_id = ANY($1::uuid[])", [rows.map((r) => r.id)]);
  await db.query(
    `INSERT INTO return_flags (return_id, flag, source)
     SELECT id, flag, 'rule' FROM unnest($1::uuid[], $2::text[]) AS u (id, flag)
     ON CONFLICT (return_id, flag) DO NOTHING`,
    [flags.id, flags.flag],
  );
  return { sorted, unsorted, flagged: new Set(flags.id).size };
}
