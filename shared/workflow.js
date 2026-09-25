/**
 * Vocabulary for products, projects and checklist items, shared by the server
 * (validation) and the client (labels, pickers). Keys match the CHECK
 * constraints in server/db/migrations/002_products_markets_projects.sql.
 */

/** One shared set of states for projects and checklist items, in workflow order. */
export const STATES = ['not_started', 'in_progress', 'blocked', 'in_review', 'done'];

export const STATE_LABELS = {
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  in_review: 'In review',
  done: 'Done',
};

export const PROJECT_TYPES = {
  launch: 'Market launch',
  new_product: 'New product',
  app_feature: 'App feature',
  other: 'Other',
};

export const ITEM_CATEGORIES = {
  certification: 'Certification',
  testing: 'Testing',
  manual: 'Manual',
  packaging: 'Packaging',
  design: 'Design',
  listing: 'Listing',
  marketing: 'Marketing',
  business: 'Business',
  other: 'Other',
};

/** Keys are stored; labels use the team's own words. */
export const LIFECYCLES = {
  upcoming: 'In development',
  active: 'Active',
  sunset: 'Discontinued',
};

// ── Phase 2 ────────────────────────────────────────────────────────────────

export const CERT_STATES = {
  not_started: 'Not started',
  in_progress: 'In progress',
  submitted: 'Submitted',
  certified: 'Certified',
  rejected: 'Rejected',
  not_required: 'Not required',
};

/** Days before expiry that a certification counts as "expiring soon". */
export const EXPIRY_WARNING_DAYS = 90;

export const DOCUMENT_KINDS = {
  manual: 'User manual',
  quick_start: 'Quick start guide',
  packaging: 'Packaging',
  label: 'Label',
  insert: 'Insert',
  other: 'Other',
};

export const VERSION_STATES = {
  draft: 'Draft',
  in_design: 'In design',
  in_review: 'In review',
  approved: 'Approved',
  sent: 'Sent to OEM',
};

export const REQUEST_TYPES = {
  image: 'Image',
  render: 'Render',
  graphic: 'Graphic',
  video: 'Video',
  other: 'Other',
};

export const REQUEST_STATES = {
  requested: 'Requested',
  in_progress: 'In progress',
  delivered: 'Delivered',
  approved: 'Approved',
  cancelled: 'Cancelled',
};
