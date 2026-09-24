# Aether

Luna's product-readiness hub: one place to see where every product stands on its way to market, what is blocking it, and who owns the next step.

See [docs/ROADMAP.md](docs/ROADMAP.md) for scope, modules, the data model and the phase plan.

**Status:** Phase 0 (foundation). Users can sign in with Google or email and see the app shell. The module pages are placeholders until their phase is built.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19, React Router, Vite (`client/`) |
| Backend | Node 22, Express, Passport (`server/`) |
| Database | Postgres 16 with versioned SQL migrations (`server/db/migrations/`) |
| Auth | Google OAuth and email/password, invite-only, sessions stored in Postgres |
| Hosting | Railway (`railway.json`) |
| CI | GitHub Actions: lint, test, build (`.github/workflows/ci.yml`) |

```
client/            React app (served by Express in production from client/dist)
  src/pages/       One file per page
  src/modules.js   Module list and roadmap phase, drives the sidebar
server/
  app.js           Express app factory (used by index.js and tests)
  index.js         Entry point: check config, migrate, listen
  config.js        All environment variables
  auth/            Passport strategies and role middleware
  db/              Pool, migration runner and migrations
  lib/             Data access and helpers (users, activity log, HTTP errors)
  routes/          API routes
shared/roles.js    Roles and teams, used by both server and client
scripts/           CLI: migrate, create-user
test/              Vitest + Supertest against a real Postgres
docs/ROADMAP.md    The plan
```

## Local development

Requirements: Node 22 and Postgres 16 (Docker is easiest).

```bash
docker compose up -d              # Postgres on :5432 with aether and aether_test databases
cp .env.example .env              # defaults work with docker compose
npm install
npm run user:create -- --email you@lunahome.com --name "You" --role admin --password "at least ten chars"
npm run dev                       # API on :3001, app on http://localhost:5173
```

Migrations run automatically when the server starts. `npm run migrate` runs them on their own.

Google sign-in is optional locally. To turn it on:

1. Create an OAuth client in Google Cloud Console (type **Web application**).
2. Add the redirect URI `http://localhost:5173/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `PUBLIC_URL=http://localhost:5173` in `.env`.

The Vite dev server proxies `/auth` to the API, so the whole flow stays on port 5173.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API with auto-restart, plus the Vite dev server |
| `npm run build` | Build the client into `client/dist` |
| `npm start` | Production server (API and built client) |
| `npm run migrate` | Apply pending migrations |
| `npm run user:create -- --email … --role admin\|editor\|viewer [--password …] [--team …]` | Create a user, or update an existing one |
| `npm run lint` | ESLint |
| `npm test` | Tests. Database tests need `TEST_DATABASE_URL` and **wipe that database** |

## Users and roles

Aether is invite-only. An admin adds a person's email under **Admin → Users**. That person can then sign in with Google using that email, or with a password if the admin set one. Anyone signing in with an email that was not invited is refused.

Everyone signed in can read everything. Roles only control editing:

| Role | Can |
| --- | --- |
| Viewer | Read everything |
| Editor | Create and edit records |
| Admin | Everything, plus user management |

Each user also has an optional **team** (Leadership, Product Development, International Expansion, Design, E-commerce, External). Teams are used for ownership and filtering, not for permissions.

Deactivated users are signed out on their next request. Users are never hard-deleted, so the activity log stays intact.

**First admin:** set `ADMIN_EMAIL` to your Google address. Signing in with it always grants admin, even on an empty database. To sign in with email before Google is set up, also set `ADMIN_PASSWORD` (10+ characters): on startup the app sets that password on the `ADMIN_EMAIL` account. Remove `ADMIN_PASSWORD` once you're in, or it resets the password on every restart. You can also run `npm run user:create` against the production database.

## Activity log

Every change is recorded in `activity_log` (entity, action, before/after values, user, time) through `logActivity()` in `server/lib/activity.js`. New modules should call it for every create, update and state change. The dashboard shows the latest entries.

## Deploying to Railway

1. Create a Railway project. Add a **Postgres** service and a service from this GitHub repo.
2. On the app service, set these variables:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}`
   - `SESSION_SECRET` = a long random string (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
   - `NODE_ENV` = `production`
   - `ADMIN_EMAIL` = your Google address
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
3. Generate a public domain for the service. In the Google OAuth client, add the redirect URI `https://<that domain>/auth/google/callback`. If you use a custom domain, also set `PUBLIC_URL`.
4. In the service settings, set the deploy branch to `main` and turn on **Wait for CI**, so Railway deploys only after GitHub Actions passes.

`railway.json` sets the build and start commands and the `/api/health` health check. Migrations run on startup, and an advisory lock stops two instances from running them at the same time.

## Writing migrations

Add a file to `server/db/migrations/` named with the next number, such as `002_products_and_markets.sql`. Each file runs once, in a transaction. Never edit a migration that has already been deployed; add a new one instead.
