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
  listing: 'Listing',
  other: 'Other',
};

export const LIFECYCLES = {
  upcoming: 'Upcoming',
  active: 'Active',
  sunset: 'Sunset',
};
