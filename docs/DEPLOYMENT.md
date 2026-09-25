# Deploying Aether

Aether is one Node server plus Postgres. Production runs on Railway; this page covers adding a staging environment and moving to Azure later.

## Environment variables

| Variable | Needed | What it does |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Postgres connection string |
| `SESSION_SECRET` | Yes (production) | Long random string that signs login cookies |
| `NODE_ENV` | Yes | `production` on any server |
| `APP_ENV` | No | `production` (default), `staging` or `development`. Anything but production shows a banner and prefixes Slack messages |
| `DATABASE_SSL` | No | `true` when the database needs SSL (Azure, or Railway's public URL) |
| `ADMIN_EMAIL` | No | This Google account always gets admin |
| `ADMIN_PASSWORD` | No | Sets the admin's password at startup. Remove it after first sign-in |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | No | Google sign-in |
| `PUBLIC_URL` | No | Public address, needed with a custom domain (Railway sets its own) |
| `FILES_DIR`, `MAX_UPLOAD_MB` | No | Folder for uploaded files, and the size limit (default 25) |
| `ODYSSEY_API_URL`, `ODYSSEY_API_KEY`, `ODYSSEY_SYNC_MINUTES` | No | Odyssey sync (see `docs/ODYSSEY_API.md`) |
| `SLACK_WEBHOOK_URL`, `DIGEST_HOUR_UTC` | No | Slack notifications and the daily digest time (default 14 = 9am Central) |

**Admin → Integrations** in the app shows what's connected.

## Staging on Railway

A staging copy lets the team try changes before they reach production.

1. In the Railway project, open the environment menu at the top (it says **production**) → **New environment** → **Duplicate production**. Name it `staging`.
2. Staging gets its own Postgres and its own copy of the variables. In staging's Aether service, change:
   - `APP_ENV=staging`
   - `SESSION_SECRET`: a different random string.
   - Remove `SLACK_WEBHOOK_URL`, or point it at a test channel.
   - Remove the Odyssey variables, unless Odyssey has a staging copy too.
3. Give staging its own domain (Settings → Networking), and add `https://<staging domain>/auth/google/callback` to the Google OAuth client's redirect URIs.
4. Point staging at the `claude/…` work branch (or a `staging` branch), so changes deploy there first. Production stays on `main`.

## Moving to Azure

The `Dockerfile` builds a production image that runs anywhere containers run. A typical Azure setup:

1. **Database:** Azure Database for PostgreSQL (Flexible Server). Create a database, then set `DATABASE_URL=postgres://user:pass@<server>.postgres.database.azure.com:5432/aether` and `DATABASE_SSL=true`.
2. **Image:** build and push it to Azure Container Registry:
   ```bash
   az acr build --registry <registry> --image aether:latest .
   ```
3. **App:** Azure Container Apps (or App Service for Containers) running that image on port 3001. Health probe path: `/api/health`.
4. **Files:** mount an Azure Files share (e.g. at `/data`) and set `FILES_DIR=/data/files`.
5. **Variables:** set everything in the table above. `PUBLIC_URL` must be the Azure address or custom domain. Then add `<PUBLIC_URL>/auth/google/callback` to the Google OAuth client.
6. **Data:** move it from Railway with `pg_dump` / `pg_restore`, and copy the uploaded files from the Railway volume to the Azure Files share.

The migrations run on startup, so a new database is set up the first time the app starts.

## Backups

- **Postgres:** Railway keeps backups on paid plans (Postgres service → Backups). On Azure, Flexible Server backs up automatically.
- **Uploaded files:** Railway volumes aren't backed up. Until they are, keep a copy of important certificates in Drive.
