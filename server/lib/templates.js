/**
 * Checklist templates: starting checklists for new projects.
 *
 * Each template builds a list of items from the project's market (so a UK
 * launch gets a UKCA item, a G-type plug item, and so on). `blockedBy` lists
 * the keys of items that must be done first. These are drafts until the team's
 * real checklists replace them.
 */

const list = (values, fallback) => (values?.length ? values.join(', ') : fallback);

const TEMPLATES = {
  market_launch: {
    label: 'Market launch',
    description: 'Certification, regional hardware, manual, packaging and listing for selling an existing product in a new market.',
    projectType: 'launch',
    needsMarket: true,
    build: ({ market }) => {
      const marks = market?.required_marks?.length ? market.required_marks : ['Regulatory'];
      const certKeys = marks.map((mark) => `cert_${mark}`);
      return [
        { key: 'testing', category: 'testing', title: `Compliance testing at lab for ${market?.code ?? 'market'}` },
        ...marks.map((mark) => ({
          key: `cert_${mark}`,
          category: 'certification',
          title: `${mark} certification`,
          blockedBy: ['testing'],
        })),
        {
          key: 'power',
          category: 'packaging',
          title: `Regional power adapter (type ${list(market?.plug_types, '?')} plug, ${market?.voltage || 'local voltage'})`,
        },
        {
          key: 'manual',
          category: 'manual',
          title: `Manual localized (${list(market?.languages, 'local languages')})`,
        },
        {
          key: 'markings',
          category: 'packaging',
          title: `${marks.join(' / ')} markings on product label and packaging`,
          blockedBy: certKeys,
        },
        {
          key: 'artwork',
          category: 'packaging',
          title: 'Packaging artwork approved',
          blockedBy: ['markings', 'manual', 'power'],
        },
        { key: 'logistics', category: 'other', title: 'Importer, distribution and logistics set up' },
        {
          key: 'listing',
          category: 'listing',
          title: `Marketplace listing ready (${market?.code ?? 'market'})`,
          blockedBy: ['artwork', ...certKeys],
        },
        {
          key: 'golive',
          category: 'other',
          title: 'Launch go / no-go review',
          blockedBy: ['listing', 'logistics'],
        },
      ];
    },
  },

  new_product: {
    label: 'New product',
    description: 'From specification through testing, certification, manual, packaging and first listing.',
    projectType: 'new_product',
    needsMarket: false,
    build: ({ market }) => {
      const marks = market?.required_marks?.length ? market.required_marks : ['Regulatory'];
      const certKeys = marks.map((mark) => `cert_${mark}`);
      return [
        { key: 'spec', category: 'other', title: 'Product specification signed off' },
        { key: 'samples', category: 'testing', title: 'Samples received from manufacturer', blockedBy: ['spec'] },
        { key: 'qa', category: 'testing', title: 'Product and app testing passed', blockedBy: ['samples'] },
        { key: 'lab', category: 'testing', title: 'Compliance testing at lab', blockedBy: ['samples'] },
        ...marks.map((mark) => ({
          key: `cert_${mark}`,
          category: 'certification',
          title: `${mark} certification`,
          blockedBy: ['lab'],
        })),
        { key: 'manual', category: 'manual', title: 'Manual written and approved', blockedBy: ['spec'] },
        { key: 'renders', category: 'packaging', title: 'Product images and renders', blockedBy: ['samples'] },
        {
          key: 'packaging',
          category: 'packaging',
          title: 'Packaging artwork approved',
          blockedBy: ['manual', 'renders', ...certKeys],
        },
        { key: 'listing', category: 'listing', title: 'Marketplace listing ready', blockedBy: ['packaging', 'qa'] },
        { key: 'golive', category: 'other', title: 'Launch go / no-go review', blockedBy: ['listing'] },
      ];
    },
  },
};

export function listTemplates() {
  return Object.entries(TEMPLATES).map(([key, t]) => ({
    key,
    label: t.label,
    description: t.description,
    projectType: t.projectType,
    needsMarket: t.needsMarket,
  }));
}

export function getTemplate(key) {
  return TEMPLATES[key] || null;
}
