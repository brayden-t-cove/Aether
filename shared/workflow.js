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

// ── Phase 3 ────────────────────────────────────────────────────────────────

export const VENDOR_TYPES = {
  manufacturer: 'Manufacturer',
  cert_lab: 'Certification lab',
  packaging: 'Packaging',
  translation: 'Translation',
  logistics: 'Logistics',
  design: 'Design',
  other: 'Other',
};

export const VENDOR_STATUSES = {
  prospect: 'Prospect',
  active: 'Active',
  inactive: 'Inactive',
};

// ── Phase 4 ────────────────────────────────────────────────────────────────

export const CHANNELS = {
  amazon: 'Amazon',
  tiktok: 'TikTok',
  walmart: 'Walmart',
  website: 'Website',
  other: 'Other',
};

export const LISTING_STATES = {
  planned: 'Planned',
  draft: 'Draft',
  in_review: 'In review',
  live: 'Live',
  paused: 'Paused',
  removed: 'Removed',
};

/** Broad reasons, so defects stand out from buyer's remorse and shipping damage. */
export const REASON_GROUPS = {
  defect: 'Defect or quality',
  not_as_described: 'Not as described',
  changed_mind: 'Changed mind',
  shipping: 'Shipping or damage',
  other: 'Other',
};

/** Amazon customer-return reason codes → readable label and group. */
export const AMAZON_REASONS = {
  DEFECTIVE: ['Defective / does not work', 'defect'],
  QUALITY_UNACCEPTABLE: ['Quality not acceptable', 'defect'],
  MISSING_PARTS: ['Missing parts', 'defect'],
  NOT_AS_DESCRIBED: ['Not as described', 'not_as_described'],
  NOT_COMPATIBLE: ['Not compatible', 'not_as_described'],
  PART_NOT_COMPATIBLE: ['Part not compatible', 'not_as_described'],
  UNWANTED_ITEM: ['No longer needed', 'changed_mind'],
  FOUND_BETTER_PRICE: ['Found a better price', 'changed_mind'],
  ORDERED_WRONG_ITEM: ['Ordered the wrong item', 'changed_mind'],
  UNAUTHORIZED_PURCHASE: ['Unauthorized purchase', 'changed_mind'],
  NO_REASON_GIVEN: ['No reason given', 'changed_mind'],
  DAMAGED_BY_CARRIER: ['Damaged in shipping', 'shipping'],
  DAMAGED_BY_FC: ['Damaged at the warehouse', 'shipping'],
  MISSED_ESTIMATED_DELIVERY: ['Arrived too late', 'shipping'],
  NEVER_ARRIVED: ['Never arrived', 'shipping'],
  EXTRA_ITEM: ['Extra item received', 'shipping'],
  SWITCHEROO: ['Different item returned', 'other'],
};
