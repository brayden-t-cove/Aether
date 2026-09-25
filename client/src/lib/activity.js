import { CERT_STATES, REQUEST_STATES, STATE_LABELS, VERSION_STATES } from '../../../shared/workflow.js';

function describeCertChanges(changes) {
  if (changes.state) return `to ${CERT_STATES[changes.state.to] || changes.state.to}`;
  return describeChanges(changes);
}

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
      if (a.action === 'attachment_added') return `${who} attached "${c.label}" to "${c.item}"`;
      if (a.action === 'attachment_removed') return `${who} removed "${c.label}" from "${c.item}"`;
      break;
    case 'certification':
      if (a.action === 'created') return `${who} added certification ${label}`;
      if (a.action === 'updated') return `${who} updated ${label} ${describeCertChanges(c)}`;
      if (a.action === 'deleted') return `${who} deleted certification ${label}`;
      if (a.action === 'attachment_added') return `${who} attached ${label}`;
      if (a.action === 'attachment_removed') return `${who} removed ${label}`;
      break;
    case 'document':
      if (a.action === 'created') return `${who} created ${label}`;
      if (a.action === 'updated') return `${who} updated ${label} ${describeChanges(c)}`;
      if (a.action === 'deleted') return `${who} deleted ${label}`;
      if (a.action === 'version_added') return `${who} added ${c.version} of ${label}`;
      if (a.action === 'version_updated')
        return c.state ? `${who} moved ${label} ${c.version} to ${VERSION_STATES[c.state.to] || c.state.to}` : `${who} updated ${label} ${c.version}`;
      if (a.action === 'version_removed') return `${who} deleted ${label} ${c.version}`;
      if (a.action === 'attachment_added') return `${who} attached ${label} to ${c.version}`;
      if (a.action === 'attachment_removed') return `${who} removed ${label} from ${c.version}`;
      break;
    case 'design_request':
      if (a.action === 'created') return `${who} requested ${label}`;
      if (a.action === 'updated')
        return c.state ? `${who} moved request ${label} to ${REQUEST_STATES[c.state.to] || c.state.to}` : `${who} updated request ${label} ${describeChanges(c)}`;
      if (a.action === 'deleted') return `${who} deleted request ${label}`;
      if (a.action === 'attachment_added') return `${who} delivered ${label}`;
      if (a.action === 'attachment_removed') return `${who} removed ${label}`;
      break;
    case 'vendor':
      if (a.action === 'created') return `${who} added vendor ${label}`;
      if (a.action === 'updated') return `${who} updated vendor ${label} ${describeChanges(c)}`;
      if (a.action === 'deleted') return `${who} deleted vendor ${label}`;
      if (a.action === 'contact_added') return `${who} added ${c.contact} as a contact at ${label}`;
      if (a.action === 'contact_removed') return `${who} removed contact ${c.contact} from ${label}`;
      if (a.action === 'product_linked') return `${who} linked a product to ${label}`;
      if (a.action === 'product_unlinked') return `${who} unlinked a product from ${label}`;
      break;
    case 'sync': {
      const s = c;
      const parts = [
        s.products_created && `${s.products_created} new products`,
        s.products_linked && `${s.products_linked} linked`,
        s.products_updated && `${s.products_updated} updated`,
        s.vendors_created && `${s.vendors_created} new vendors`,
      ].filter(Boolean);
      return `Odyssey sync${a.user_name ? ` by ${a.user_name}` : ''}: ${parts.join(', ') || 'changes'}`;
    }
    case 'product':
      if (a.action === 'sent_to_odyssey') return `${who} sent ${label} to Odyssey`;
      if (a.action === 'variant_added') return `${who} added variant ${label}`;
      if (a.action === 'variant_updated') return `${who} updated variant ${label}`;
      if (a.action === 'variant_removed') return `${who} removed variant ${label}`;
    // falls through
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
  if (a.entity_type === 'certification') return `/certifications/${a.entity_id}`;
  if (a.entity_type === 'document') return `/manuals/${a.entity_id}`;
  if (a.entity_type === 'design_request') return `/design-requests/${a.entity_id}`;
  if (a.entity_type === 'vendor') return `/vendors/${a.entity_id}`;
  if (a.entity_type === 'sync') return '/products';
  return null;
}
