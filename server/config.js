/**
 * Central configuration, read once from the environment.
 * Everything the server needs from env vars goes through here.
 */

const isProduction = process.env.NODE_ENV === 'production';

// Railway sets RAILWAY_PUBLIC_DOMAIN automatically; PUBLIC_URL overrides it.
const publicUrl = (
  process.env.PUBLIC_URL ||
  (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null) ||
  `http://localhost:${process.env.PORT || 3001}`
).replace(/\/$/, '');

export const config = {
  isProduction,
  port: Number(process.env.PORT) || 3001,
  publicUrl,
  databaseUrl: process.env.DATABASE_URL,
  // Railway's internal Postgres URL does not use SSL; its public URL does.
  databaseSsl: process.env.DATABASE_SSL === 'true',
  sessionSecret: process.env.SESSION_SECRET,
  // Signing in with this email always grants admin, even without an invite.
  // Used to bootstrap the first admin on a fresh database.
  adminEmail: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
  // Optional: on startup, sets this password on the ADMIN_EMAIL account
  // (creating it if needed) so the first admin can sign in without Google.
  // Remove it once you're in, or it will reset the password on every restart.
  adminPassword: process.env.ADMIN_PASSWORD || '',
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
  // Folder for uploaded files (certificates, manuals, designs). On Railway, a
  // volume mounted at e.g. /data with FILES_DIR=/data/files. Unset = links only.
  filesDir: process.env.FILES_DIR || '',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB) || 25,
  // Phase 3: Odyssey integration (not used yet).
  odyssey: {
    apiUrl: process.env.ODYSSEY_API_URL,
    apiKey: process.env.ODYSSEY_API_KEY,
  },
};

config.google.enabled = Boolean(config.google.clientId && config.google.clientSecret);

export function assertConfig() {
  const missing = [];
  if (!config.databaseUrl) missing.push('DATABASE_URL');
  if (isProduction && !config.sessionSecret) missing.push('SESSION_SECRET');
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
