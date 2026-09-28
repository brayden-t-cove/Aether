# Aether

Luna's product-readiness hub: one place to see where every product stands on its way to market, what is blocking it, and who owns the next step.

See [docs/ROADMAP.md](docs/ROADMAP.md) for scope, modules, the data model and the phase plan.

**Status:** all five roadmap phases are built: launch tracking, certifications and manuals, Odyssey sync and vendors, returns and comparisons, and Slack notifications. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for environment variables, a staging environment and moving to Azure, and [docs/ODYSSEY_API.md](docs/ODYSSEY_API.md) for the Odyssey connection.

## How launch tracking works

- **Products** are Luna's catalog, marked Upcoming, Active or Sunset.
- **Markets** hold each country's plug types, voltage, required marks and languages. US, CA, UK, EU and AU are set up at first.
- **Projects** tie a product to a market (for a launch) with an owner, a target date and a state.
- **Checklist items** belong to a project, each with a category, owner, due date, state, evidence link and notes.
- **Waits on:** an item can wait on other items, even in another project. An item can't be marked Done while something it waits on is still open, and loops are refused.
- **Blocked vs waiting:** *Blocked* means someone marked the item Blocked (an outside problem). *Waiting* means it is waiting on an earlier step, which is normal. The dashboard counts only Blocked items, and shows how many other items each one holds up.
- **Starting checklists** (`server/lib/templates.js`) come from the team's launch checklists and are organised in stages. *US launch (new product)* runs from validating the product through samples, manual and packaging, listings, launch and post launch. *International launch* takes an existing product into a new country and fills in that market's marks, plug, voltage and languages. Items already wait on the steps they depend on.
- **Stages:** items can belong to a stage, and the project page lists them stage by stage. Items without stages are grouped by category.
- **States** are shared by projects and items: Not started, In progress, Blocked, In review, Done.

## Certifications, manuals and design work (Phase 2)

- **Readiness** (sidebar): one grid of products × markets. Each cell shows the market's required marks (✓ certified, … under way, ○ not tracked, ! rejected or expiring), plus where the manual and packaging stand. A cell is *Ready* when every required mark is certified and both the manual and packaging are approved or sent to the OEM.
- **Certifications:** one record per mark per product and market (FCC, UKCA, PTCRB…), with state, lab, certificate number (e.g. FCC ID), issue and expiry dates, and evidence files or links. Certifications expired or expiring within 90 days show on the dashboard.
- **Manuals & packaging:** each manual, packaging design or label for a product, either for one market or shared by all markets. Each has versions (v1, v2…) moving Draft → In design → In review → Approved → Sent to OEM. Approval records who approved it and when, and each version holds its own files.
- **Design requests:** images, renders and graphics asked of the design team, optionally tied to a product and a document. They go Requested → In progress → Delivered → Approved. Deliverables are uploaded on the request.
- **Regional variants:** on the product page, e.g. "UK variant: type G plug, UKCA label". Certifications and documents can point at a variant.

### File uploads

Uploaded files are stored on disk in `FILES_DIR`. When it isn't set, Aether hides the upload buttons and accepts links only.

- **Railway:** right-click the Aether service → **Attach volume** → mount path `/data`, then set the variable `FILES_DIR=/data/files`.
- **Locally:** set `FILES_DIR=./.files` (it's git-ignored).
- **Limits:** `MAX_UPLOAD_MB` sets the maximum file size (default 25).
- **Downloads:** files are downloaded through Aether and need a signed-in user. PDFs and images open in the browser; every other type is downloaded rather than displayed.
- **Backups:** Railway volumes are not backed up automatically. Keep important certificates in Drive too, or add backups when this becomes the main copy.

## Vendors and Odyssey (Phase 3)

- **Vendors:** manufacturers, cert labs, packaging, translation and logistics partners, with contacts (including WeChat/WhatsApp), linked products, and the certifications a lab runs.
- **Odyssey sync:** every 15 minutes, and on **Sync now** (Products page or Admin → Integrations), Aether pulls Odyssey's products, test sessions and vendors.
  - Existing Aether products are linked, not duplicated.
  - Odyssey-only records arrive as synced, with their core fields read-only.
  - Test results show on product and project pages.
  - **Send to Odyssey** adds an Aether product to Odyssey's catalog.
  - Setup and matching rules: [docs/ODYSSEY_API.md](docs/ODYSSEY_API.md). Odyssey needs a small change to accept Aether's service key.

## Returns, listings and comparisons (Phase 4)

- **Listings:** each product's marketplace listings (Amazon ASIN, TikTok product ID, SKU, link, state), shown on the product page.
- **Returns:** **Returns → Import returns** reads Amazon's FBA customer returns report, TikTok Shop's returns export, or any similar CSV.
  - Rows are matched to products, and reasons are grouped (defect / not as described / changed mind / shipping).
  - Re-importing never double counts, and admins can undo an import.
  - The Returns page shows monthly trends by channel, top reasons and a per-product breakdown.
  - Unmatched rows can be assigned to a product, which also teaches future imports.
- **Comparisons:** a grid of a Luna product against competitors, with editable rows (price, resolution, field of view…). Competitors can be reused across comparisons.

## Notifications and operations (Phase 5)

- **Slack** (`SLACK_WEBHOOK_URL`) gets a post when:
  - an item is marked Blocked or a project is done
  - a certification is certified or rejected
  - a manual is ready for review or approved
  - design work is requested or delivered
  - returns are imported
  - Odyssey sync starts failing
- **Daily digest:** a morning message with overdue, blocked, expiring and in-review items, sent after `DIGEST_HOUR_UTC`.
- **Admin → Integrations** shows what's connected, with test buttons.
- **Staging:** `APP_ENV=staging` shows a banner so nobody mistakes it for production. Setup is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
- **Containers:** the `Dockerfile` builds a production image for Azure or any container host.

## Importing

Admins can bulk-load data under **Admin → Import**. Every import shows a preview first, and nothing is saved until you click Import.

- **Paste from a spreadsheet** (header row included) or upload a `.csv`/`.tsv`. Recognized columns: Name, Model (or Odyssey Name), SKU, Category, Manufacturer, Lifecycle, Launch Date, Sunset Date, Markets, Channels, Replaces, Notes. `--` or blank means unknown. Lifecycle accepts the team's words (Active, Development, Discontinued…), and markets accept names or codes (Mex, South Africa, UK…).
- **Upload a `.json` file** with `products` (the same columns) and `projects` (name, type, product model or name, market code, owner email, state, target date, description, and `items` with title, category, state, owner, due date, notes and `waits_on` titles).
- Products are matched to existing ones by model, then SKU, then name, and updated instead of duplicated. Projects whose name already exists are skipped, so running the same file twice is safe.

Don't commit import files with real business data: this repository is public.

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
| `npm run test:e2e` | End-to-end browser tests (Playwright) across every phase, against a real server with fake Odyssey and Slack. Uses `E2E_DATABASE_URL` (default `aether_e2e`), which it wipes. |

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
