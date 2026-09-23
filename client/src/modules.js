/**
 * Aether's modules and the roadmap phase each one ships in.
 * Drives the sidebar and the placeholder pages until each module is built.
 */
export const MODULES = [
  {
    path: '/projects',
    label: 'Projects',
    phase: 1,
    summary: 'Launch and new-product projects, each with a checklist of items, owners, states and blockers.',
  },
  {
    path: '/products',
    label: 'Products',
    phase: 1,
    summary: 'The product catalog: Luna products plus products synced from Odyssey, with variants per market.',
  },
  {
    path: '/markets',
    label: 'Markets',
    phase: 1,
    summary: 'Countries and regions with plug type, voltage, required marks and languages.',
  },
  {
    path: '/certifications',
    label: 'Certifications',
    phase: 2,
    summary: 'CE, UKCA, FCC and other marks per product and market, with labs, cert numbers, evidence and expiry dates.',
  },
  {
    path: '/manuals',
    label: 'Manuals & packaging',
    phase: 2,
    summary: 'Versioned manuals and packaging per product and region, linked to design assets and approvals.',
  },
  {
    path: '/vendors',
    label: 'Vendors',
    phase: 3,
    summary: 'Manufacturers, cert labs, packaging and translation vendors, shared with Odyssey.',
  },
  {
    path: '/returns',
    label: 'Returns',
    phase: 4,
    summary: 'Amazon and TikTok return codes and reasons by product and period, to spot defects and trends.',
  },
  {
    path: '/comparisons',
    label: 'Comparisons',
    phase: 4,
    summary: 'Competitive analysis of Luna products against what is on the market.',
  },
];
