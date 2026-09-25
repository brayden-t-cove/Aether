/**
 * Checklist templates: starting checklists for new projects, taken from
 * Brayden's launch checklists (Sep 2026, still being refined).
 *
 * Each template is a list of stages. Items keep the team's wording, with the
 * market's details filled in where they help (marks, plug, languages).
 * `blockedBy` lists the keys of items that must be done first; only real
 * hand-offs are linked, so a checklist doesn't drown in "waiting on" chips.
 * Items marked `added: true` weren't in the original list but are needed for
 * the links to be truthful (e.g. certification has to finish before its IDs
 * can go in the manual).
 */

const list = (values, fallback) => (values?.length ? values.join(', ') : fallback);
const marksOf = (market) => list(market?.required_marks, 'required marks');
const where = (market) => market?.name || 'the market';

const TEMPLATES = {
  us_launch: {
    label: 'US launch (new product)',
    description: 'From validating a new product with the manufacturer through samples, manual and packaging, listings and launch in the US.',
    projectType: 'new_product',
    needsMarket: false,
    defaultMarketCode: 'US',
    stages: ({ market }) => [
      {
        name: 'Validate the product',
        items: [
          { key: 'comparative', category: 'other', title: 'Comparative analysis' },
          { key: 'functionality', category: 'testing', title: 'Functionality testing' },
          { key: 'integration', category: 'other', title: 'Integration discussion' },
          { key: 'mold', category: 'design', title: 'Mold design' },
        ],
      },
      {
        name: 'Arrangements for making the product',
        items: [
          { key: 'pricing', category: 'business', title: 'Discussion on specs and pricing', blockedBy: ['comparative', 'functionality'] },
          { key: 'specs', category: 'other', title: 'Full technical specs defined', blockedBy: ['pricing'] },
          { key: 'cert_plan', category: 'certification', title: 'Discussion on certification arrangement' },
          { key: 'plan', category: 'other', title: 'Project plan and deadlines created', blockedBy: ['specs', 'cert_plan'] },
          { key: 'iv_needs', category: 'other', title: 'Discussion on IV integration needs', blockedBy: ['integration'] },
          { key: 'contract', category: 'business', title: 'Early contract agreements for production and payment', blockedBy: ['pricing'] },
        ],
      },
      {
        name: 'Sample product provided',
        items: [
          { key: 'sample_check', category: 'testing', title: 'Sample hardware matches the agreed specifications', blockedBy: ['specs'] },
          {
            key: 'sample_mods',
            category: 'other',
            title: "Modifications needed on the sample that weren't seen during mold design",
            blockedBy: ['sample_check'],
          },
          { key: 'renders', category: 'design', title: 'Renders provided for early design work, and design requests submitted', blockedBy: ['mold'] },
          { key: 'cert_agree', category: 'certification', title: `Agreement on how ${marksOf(market)} certification will be done`, blockedBy: ['cert_plan'] },
          { key: 'cert_done', category: 'certification', title: `${marksOf(market)} certification complete`, blockedBy: ['cert_agree'], added: true },
          { key: 'regression', category: 'testing', title: 'Integration verified and full regression testing done', blockedBy: ['iv_needs', 'sample_check'] },
          { key: 'longterm', category: 'testing', title: 'Long-term testing set up', blockedBy: ['sample_check'] },
          { key: 'odyssey', category: 'other', title: 'Product cataloged in Odyssey' },
        ],
      },
      {
        name: 'User manual and packaging',
        items: [
          { key: 'drafts', category: 'manual', title: 'First drafts of the user manual and design created and sent to the design team', blockedBy: ['specs'] },
          {
            key: 'materials',
            category: 'design',
            title: 'Design request materials sent to the design team (images, renders, compliance statements)',
            blockedBy: ['renders'],
          },
          { key: 'signoff', category: 'manual', title: 'User manual and design signed off', blockedBy: ['drafts', 'materials'] },
          {
            key: 'cert_ids',
            category: 'certification',
            title: 'Certification IDs documented and labeled in the user manual or packaging where required',
            blockedBy: ['cert_done', 'signoff'],
          },
        ],
      },
      {
        name: 'Final sign-off',
        items: [
          { key: 'manual_oem', category: 'manual', title: "Final user manual signed off and delivered to the OEM, matching the OEM's size requirements", blockedBy: ['cert_ids'] },
          { key: 'packaging_oem', category: 'packaging', title: "Final packaging design sent to the OEM, matching the OEM's packaging size", blockedBy: ['cert_ids'] },
          { key: 'listings', category: 'listing', title: 'SKU and listings created on Amazon, TikTok and any other marketplaces we sell on', blockedBy: ['materials'] },
          { key: 'listing_ok', category: 'listing', title: 'Listings reviewed and signed off by everyone required', blockedBy: ['listings'] },
        ],
      },
      {
        name: 'Product launch',
        items: [
          { key: 'ads', category: 'marketing', title: 'Ads created and affiliates signed up', blockedBy: ['listing_ok'] },
          { key: 'affiliate_samples', category: 'marketing', title: 'Early production samples sent to corporate for affiliate advertising', blockedBy: ['packaging_oem', 'manual_oem'] },
        ],
      },
      {
        name: 'Post launch',
        items: [
          { key: 'payments', category: 'business', title: 'Final payments made', blockedBy: ['ads'] },
          { key: 'reorders', category: 'business', title: 'Additional orders placed, with delivery timelines', blockedBy: ['ads'] },
        ],
      },
    ],
  },

  international_launch: {
    label: 'International launch',
    description: "Take an existing product into a new country: requirements, samples, hardware and design rework, listings and launch.",
    projectType: 'launch',
    needsMarket: true,
    stages: ({ market }) => [
      {
        name: 'Identify the country',
        items: [
          {
            key: 'marketplaces',
            category: 'listing',
            title: `Research the marketplaces used in ${where(market)} and what each requires to sell there`,
          },
          {
            key: 'cert_reqs',
            category: 'certification',
            title: `Identify certification requirements for the camera and accessories (e.g. ${marksOf(market)})`,
          },
          {
            key: 'components',
            category: 'other',
            title: `Identify components that need changes to meet local standards (e.g. type ${list(market?.plug_types, '?')} plug, ${market?.voltage || 'local voltage'})`,
          },
          {
            key: 'languages',
            category: 'manual',
            title: `Identify translation requirements for the manual and packaging (${list(market?.languages, 'local languages')})`,
          },
          { key: 'timeline', category: 'other', title: 'Timeline created from the information gathered', blockedBy: ['marketplaces', 'cert_reqs', 'components', 'languages'] },
        ],
      },
      {
        name: 'Samples',
        items: [
          {
            key: 'samples',
            category: 'testing',
            title: 'Engineering or production samples sent to the certification contact, or to the vendor for marketing material',
            blockedBy: ['cert_reqs'],
          },
          { key: 'cert_done', category: 'certification', title: `${marksOf(market)} certification complete`, blockedBy: ['samples'], added: true },
          { key: 'warehouse', category: 'business', title: `Warehouse locations set up in ${where(market)}`, blockedBy: ['marketplaces'] },
        ],
      },
      {
        name: 'Hardware rework',
        items: [
          {
            key: 'hardware',
            category: 'other',
            title: 'Hardware changes made (e.g. certification markings on the camera, power type)',
            blockedBy: ['components', 'cert_reqs'],
          },
        ],
      },
      {
        name: 'Design rework',
        items: [
          {
            key: 'redesign',
            category: 'design',
            title: `User manual and packaging reworked for ${where(market)} (translations, extra certification marks, required statements)`,
            blockedBy: ['languages', 'hardware', 'cert_done'],
          },
          { key: 'verify', category: 'manual', title: `All information checked and correct for ${where(market)}`, blockedBy: ['redesign'] },
        ],
      },
      {
        name: 'Final sign-off',
        items: [
          { key: 'manual_oem', category: 'manual', title: "Final user manual signed off and delivered to the OEM, matching the OEM's size requirements", blockedBy: ['verify'] },
          { key: 'packaging_oem', category: 'packaging', title: "Final packaging design sent to the OEM, matching the OEM's packaging size", blockedBy: ['verify'] },
          { key: 'listings', category: 'listing', title: 'SKU and listings created on the marketplaces we intend to sell on', blockedBy: ['marketplaces'] },
          { key: 'listing_ok', category: 'listing', title: 'Listings reviewed and signed off by everyone required', blockedBy: ['listings'] },
        ],
      },
      {
        name: 'Product launch',
        items: [{ key: 'ads', category: 'marketing', title: 'Ads created and affiliates signed up', blockedBy: ['listing_ok', 'packaging_oem', 'manual_oem', 'warehouse'] }],
      },
      {
        name: 'Post launch',
        items: [
          { key: 'payments', category: 'business', title: 'Final payments made', blockedBy: ['ads'] },
          { key: 'reorders', category: 'business', title: 'Additional orders placed, with delivery timelines', blockedBy: ['ads'] },
        ],
      },
    ],
  },
};

export function listTemplates() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    key,
    label: t.label,
    description: t.description,
    projectType: t.projectType,
    needsMarket: t.needsMarket,
    defaultMarketCode: t.defaultMarketCode || null,
  }));
}

/** A template with build(ctx) returning a flat item list, each item tagged with its stage. */
export function getTemplate(key) {
  if (typeof key !== 'string' || !Object.hasOwn(TEMPLATES, key)) return null;
  const t = TEMPLATES[key];
  return {
    ...t,
    build: (ctx) => t.stages(ctx).flatMap((stage) => stage.items.map((item) => ({ ...item, stage: stage.name }))),
  };
}
