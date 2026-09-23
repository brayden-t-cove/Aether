/**
 * Create (or reset the password of) a user from the command line.
 * Useful for the first admin on a fresh database, or local dev without Google.
 *
 *   npm run user:create -- --email you@lunahome.com --name "You" --role admin --password "a long password"
 */
import { parseArgs } from 'node:util';
import { config, assertConfig } from '../server/config.js';
import { createPool } from '../server/db/pool.js';
import { migrate } from '../server/db/migrate.js';
import { createUser, findUserByEmail, setPassword, updateUser, MIN_PASSWORD_LENGTH } from '../server/lib/users.js';
import { ROLES } from '../shared/roles.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string', default: '' },
    role: { type: 'string', default: 'viewer' },
    team: { type: 'string' },
    password: { type: 'string' },
  },
});

if (!values.email) {
  console.error('Usage: npm run user:create -- --email EMAIL [--name NAME] [--role admin|editor|viewer] [--team TEAM] [--password PASSWORD]');
  process.exit(1);
}
if (!ROLES.includes(values.role)) {
  console.error(`--role must be one of: ${ROLES.join(', ')}`);
  process.exit(1);
}
if (values.password && values.password.length < MIN_PASSWORD_LENGTH) {
  console.error(`--password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  process.exit(1);
}

assertConfig();
const db = createPool({ connectionString: config.databaseUrl, ssl: config.databaseSsl });
try {
  await migrate(db, { log: () => {} });
  let user = await findUserByEmail(db, values.email);
  if (user) {
    user = await updateUser(db, user.id, { role: values.role, active: true, ...(values.name && { name: values.name }), ...(values.team && { team: values.team }) });
    if (values.password) await setPassword(db, user.id, values.password);
    console.log(`Updated ${user.email} (${user.role})`);
  } else {
    user = await createUser(db, { email: values.email, name: values.name, role: values.role, team: values.team || null, password: values.password });
    console.log(`Created ${user.email} (${user.role})`);
  }
} finally {
  await db.end();
}
