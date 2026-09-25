import { CERT_STATES, REQUEST_STATES, VERSION_STATES } from '../../../shared/workflow.js';

/**
 * Label + tone for every Phase 2 status. Tones map to the status colors in
 * styles.css (neutral, active, warning, serious, critical, good) and always
 * render with their text label.
 */
const CERT_TONES = { not_started: 'neutral', in_progress: 'active', submitted: 'warning', certified: 'good', rejected: 'critical', not_required: 'neutral' };
const VERSION_TONES = { none: 'neutral', draft: 'neutral', in_design: 'active', in_review: 'warning', approved: 'good', sent: 'good' };
const REQUEST_TONES = { requested: 'neutral', in_progress: 'active', delivered: 'warning', approved: 'good', cancelled: 'neutral' };

export function certStatus(cert) {
  if (cert.expiry_status === 'expired') return { label: 'Expired', tone: 'critical' };
  if (cert.expiry_status === 'expiring') return { label: 'Expires soon', tone: 'serious' };
  if (cert.state === 'missing') return { label: 'Not tracked', tone: 'neutral' };
  return { label: CERT_STATES[cert.state] || cert.state, tone: CERT_TONES[cert.state] || 'neutral' };
}

export const versionStatus = (state) => ({ label: state && state !== 'none' ? VERSION_STATES[state] : 'No versions', tone: VERSION_TONES[state || 'none'] });

export const requestStatus = (state) => ({ label: REQUEST_STATES[state] || state, tone: REQUEST_TONES[state] || 'neutral' });

export const READINESS = {
  ready: { label: 'Ready', tone: 'good' },
  in_progress: { label: 'In progress', tone: 'active' },
  attention: { label: 'Needs attention', tone: 'critical' },
  not_started: { label: 'Not started', tone: 'neutral' },
  not_tracked: { label: 'Not tracked yet', tone: 'neutral' },
};
