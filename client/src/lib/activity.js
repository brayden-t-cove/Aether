import { STATE_LABELS } from '../../../shared/workflow.js';

const FIELD_LABELS = {
  state: 'state',
  owner_id: 'owner',
  due_date: 'due date',
  target_date: 'target date',
  evidence_url: 'evidence link',
  lifecycle: 'lifecycle',
};

function describeChanges(changes) {
  const keys = Object.keys(changes).filter((k) => !['label', 'item_id'].includes(k));
  if (changes.state) return `to ${STATE_LABELS[changes.state.to] || changes.state.to}`;
  return keys.length ? `(${keys.map((k) => FIELD_LABELS[k] || k.replace(/_/g, ' ')).join(', ')})` : '';
}

/** One human sentence per activity row. */
export function describeActivity(a) {
  const who = a.user_name || 'Someone';
  const c = a.changes || {};
  const label = c.label ? `"${c.label}"` : '';

  switch (a.entity_type) {
    case 'user':
      if (a.action === 'invited') return `${who} invited ${c.email} as ${c.role}`;
      if (a.action === 'updated') return `${who} updated a user ${describeChanges(c)}`;
      if (a.action === 'password_reset') return `${who} reset a user's password`;
      if (a.action === 'password_changed') return `${who} changed their password`;
      break;
    case 'project':
      if (a.action === 'created') return `${who} started project ${label}${c.items ? ` with ${c.items} checklist items` : ''}`;
      if (a.action === 'updated') return `${who} updated project ${label} ${describeChanges(c)}`;
      if (a.action === 'deleted') return `${who} deleted project ${label}`;
      if (a.action === 'item_added') return `${who} added ${label}`;
      if (a.action === 'item_updated') return `${who} ${c.state ? 'moved' : 'updated'} ${label} ${describeChanges(c)}`;
      if (a.action === 'item_removed') return `${who} removed ${label}`;
      if (a.action === 'dependency_added') return `${who} set ${label} to wait on "${c.blocked_by}"`;
      if (a.action === 'dependency_removed') return `${who} removed a blocker from ${label}`;
      break;
    case 'product':
    case 'market':
      if (a.action === 'created') return `${who} added ${a.entity_type} ${label}`;
      if (a.action === 'updated') return `${who} updated ${a.entity_type} ${label} ${describeChanges(c)}`;
      if (a.action === 'deleted') return `${who} deleted ${a.entity_type} ${label}`;
      break;
  }
  return `${who} ${a.action.replace(/_/g, ' ')} ${a.entity_type}`;
}

/** Link target for an activity row, if the record still exists. */
export function activityLink(a) {
  if (a.action === 'deleted') return null;
  if (a.entity_type === 'project') return `/projects/${a.entity_id}`;
  if (a.entity_type === 'product') return `/products/${a.entity_id}`;
  if (a.entity_type === 'market') return `/markets/${a.entity_id}`;
  return null;
}
