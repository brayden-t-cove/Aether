/**
 * App roles and Luna teams, shared by the server and the client.
 *
 * Everyone can read everything. Roles only control what a user can change:
 *   viewer — read only
 *   editor — create and edit records
 *   admin  — everything, plus user management
 */

export const ROLES = ['viewer', 'editor', 'admin'];

export const ROLE_LABELS = {
  viewer: 'Viewer',
  editor: 'Editor',
  admin: 'Admin',
};

export const TEAMS = {
  leadership: 'Leadership',
  product_development: 'Product Development',
  international: 'International Expansion',
  design: 'Design',
  ecommerce: 'E-commerce',
  external: 'External',
};

/**
 * Which team a checklist item is for, by its category, unless someone picks another. People can be on several
 * teams, and anyone can see and pick up any item; this only decides where an item shows up as "your team's".
 */
export const CATEGORY_TEAMS = {
  certification: 'international',
  testing: 'product_development',
  manual: 'design',
  packaging: 'design',
  design: 'design',
  listing: 'ecommerce',
  marketing: 'ecommerce',
  business: 'leadership',
  other: 'leadership',
};

const RANK = { viewer: 0, editor: 1, admin: 2 };

/** True when `role` is at least `required` (e.g. admin satisfies editor). */
export function hasRole(role, required) {
  return role in RANK && required in RANK && RANK[role] >= RANK[required];
}
