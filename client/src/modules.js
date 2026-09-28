/**
 * Aether's modules and the roadmap phase each one ships in.
 * Drives the sidebar. Modules without `built: true` show a placeholder page.
 */
export const MODULES = [
  {
    path: '/readiness',
    label: 'Readiness',
    built: true,
    phase: 2,
    summary: 'Every product in every market: certifications, manual and packaging at a glance.',
  },
  {
    path: '/projects',
    label: 'Projects',
    built: true,
    phase: 1,
    summary: 'Launch and new-product projects, each with a checklist of items, owners, states and blockers.',
  },
  {
    path: '/products',
    label: 'Products',
    built: true,
    phase: 1,
    summary: 'The product catalog: Luna products plus products synced from Odyssey, with variants per market.',
  },
  {
    path: '/markets',
    label: 'Markets',
    built: true,
    phase: 1,
    summary: 'Countries and regions with plug type, voltage, required marks and languages.',
  },
  {
    path: '/certifications',
    label: 'Certifications',
    built: true,
    phase: 2,
    summary: 'CE, UKCA, FCC and other marks per product and market, with labs, cert numbers, evidence and expiry dates.',
  },
  {
    path: '/manuals',
    label: 'Manuals & packaging',
    built: true,
    phase: 2,
    summary: 'Versioned manuals and packaging per product and region, linked to design assets and approvals.',
  },
  {
    path: '/design-requests',
    label: 'Design requests',
    built: true,
    phase: 2,
    summary: 'Images, renders and graphics requested from the design team.',
  },
  {
    path: '/vendors',
    label: 'Vendors',
    built: true,
    phase: 3,
    summary: 'Manufacturers, cert labs, packaging and translation vendors, shared with Odyssey.',
  },
  {
    path: '/returns',
    built: true,
    label: 'Returns',
    phase: 4,
    summary: 'Amazon and TikTok return codes and reasons by product and period, to spot defects and trends.',
  },
  {
    path: '/comparisons',
    built: true,
    label: 'Comparisons',
    phase: 4,
    summary: 'Competitive analysis of Luna products against what is on the market.',
  },
];
