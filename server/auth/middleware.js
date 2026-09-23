import { hasRole } from '../../shared/roles.js';

export function requireAuth(req, res, next) {
  if (req.isAuthenticated?.()) return next();
  res.status(401).json({ error: 'Sign in required' });
}

/** Require at least `role` (see shared/roles.js for the hierarchy). */
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.isAuthenticated?.()) return res.status(401).json({ error: 'Sign in required' });
    if (!hasRole(req.user.role, role)) return res.status(403).json({ error: `${role} access required` });
    next();
  };
}
