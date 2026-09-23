# Aether

Luna's product-readiness hub. The plan, data model and phases are in `docs/ROADMAP.md`; setup is in `README.md`.

## Conventions

- ES modules everywhere. The server is plain JavaScript on Node 22; the client is React 19 + Vite.
- Schema changes go in a new numbered file in `server/db/migrations/`. Never edit a migration that has shipped.
- Use real tables and columns, not JSON blobs (Odyssey's JSONB-per-record storage is the pattern to avoid).
- Data access lives in `server/lib/<entity>.js`; routes in `server/routes/<entity>.js`, mounted in `server/app.js`.
- Everyone signed in can read. Guard writes with `requireRole('editor')`, and user management with `requireRole('admin')`.
- Call `logActivity()` for every create, update and state change.
- Roles and teams are defined once in `shared/roles.js`, which both server and client import.
- Add new modules to `client/src/modules.js` so they appear in the sidebar.

## Checks

```bash
npm run lint
TEST_DATABASE_URL=postgres://aether:aether@localhost:5432/aether_test npm test   # wipes that DB
npm run build
```
