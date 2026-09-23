import bcrypt from 'bcryptjs';

export const MIN_PASSWORD_LENGTH = 10;

/** Fields safe to send to the browser. Never expose password_hash. */
export function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    role: row.role,
    team: row.team,
    active: row.active,
    hasPassword: Boolean(row.password_hash),
    googleLinked: Boolean(row.google_id),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

export async function findUserById(db, id) {
  const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function findUserByEmail(db, email) {
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [normalizeEmail(email)]);
  return rows[0] || null;
}

export async function listUsers(db) {
  const { rows } = await db.query('SELECT * FROM users ORDER BY active DESC, name, email');
  return rows;
}

export async function createUser(db, { email, name = '', role = 'viewer', team = null, password, invitedBy = null }) {
  const passwordHash = password ? await bcrypt.hash(password, 12) : null;
  const { rows } = await db.query(
    `INSERT INTO users (email, name, role, team, password_hash, invited_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [normalizeEmail(email), name.trim(), role, team, passwordHash, invitedBy],
  );
  return rows[0];
}

const UPDATABLE = ['name', 'role', 'team', 'active'];

export async function updateUser(db, id, patch) {
  const sets = [];
  const params = [];
  for (const key of UPDATABLE) {
    if (key in patch) {
      params.push(patch[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return findUserById(db, id);
  params.push(id);
  const { rows } = await db.query(
    `UPDATE users SET ${sets.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
    params,
  );
  return rows[0] || null;
}

export async function setPassword(db, id, password) {
  const hash = await bcrypt.hash(password, 12);
  await db.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, id]);
}

export async function verifyPassword(user, password) {
  if (!user?.password_hash || !password) return false;
  return bcrypt.compare(password, user.password_hash);
}

export async function recordLogin(db, id) {
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
}

/**
 * Resolve a Google sign-in to a user. Aether is invite-only: the email must
 * already belong to an active user, unless it is the bootstrap ADMIN_EMAIL.
 * Returns null when the person is not allowed in.
 */
export async function resolveGoogleUser(db, { email, name, avatarUrl, googleId }, { adminEmail } = {}) {
  email = normalizeEmail(email);
  let user = await findUserByEmail(db, email);

  if (!user) {
    if (!adminEmail || email !== adminEmail) return null;
    user = await createUser(db, { email, name, role: 'admin' });
  }
  if (!user.active) return null;
  // A Google account already linked to this email must match.
  if (user.google_id && user.google_id !== googleId) return null;

  const { rows } = await db.query(
    `UPDATE users
        SET google_id  = $2,
            name       = CASE WHEN name = '' THEN $3 ELSE name END,
            avatar_url = COALESCE($4, avatar_url),
            role       = CASE WHEN $5 THEN 'admin' ELSE role END,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [user.id, googleId, name || '', avatarUrl || null, Boolean(adminEmail) && email === adminEmail],
  );
  return rows[0];
}
