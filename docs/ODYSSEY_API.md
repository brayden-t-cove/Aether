# Aether ↔ Odyssey API

Aether keeps its own database and talks to Odyssey over HTTP. This file is the contract between the two apps, and describes the one change Odyssey needs.

## What Aether calls

All requests send `Authorization: Bearer <service key>`.

| Call | Used for | Response |
| --- | --- | --- |
| `GET /api/catalog` | Products | List of catalog entries: `id`, `name`, `manufacturer`, `modelNumber`, `version`, `category`, `status` |
| `GET /api/sessions` | Test results | List of session summaries: `id`, `productName`, `catalogId`, `status`, `testPlan`, `testerName`, `createdAt`, `completedAt`, `testCaseCount`, `passCount`, `failCount`, `skipCount`, `issueCount` |
| `GET /api/vendors` | Vendors | List of vendors: `id`, `name`, `relationshipStatus`, `website`, `notes`, `contacts[]` (`name`, `role`, `email`, `wechat`) |
| `POST /api/catalog` | "Send to Odyssey" | Body: `name`, `manufacturer`, `modelNumber`, `category`, `entity: ["Luna"]`, `type: "production"`, `specs.marketedName`. Returns the new entry with its `id` |

These are Odyssey's existing endpoints and shapes. Nothing new is needed on Odyssey except accepting the service key.

Aether syncs every 15 minutes (`ODYSSEY_SYNC_MINUTES`) and when someone clicks **Sync now**. If Odyssey is down or refuses the key, Aether keeps its last copy and shows the error and the time of the last good sync.

## The change Odyssey needs

Today Odyssey's `requireAuth` and `requireEditor` only accept a signed-in browser session. Add a service-key check before the routes, so Aether can call them as a Luna editor:

```js
// server.js — after passport.session(), before the routes.
// Lets Aether call the API with `Authorization: Bearer $AETHER_SERVICE_KEY`.
// The key acts as a Luna editor: it sees Luna's catalog and can add products
// (which land as pending_review, like any editor's).
import { timingSafeEqual } from 'node:crypto';

const AETHER_KEY = process.env.AETHER_SERVICE_KEY || '';
function isAetherKey(header) {
  if (!AETHER_KEY || !header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice(7));
  const expected = Buffer.from(AETHER_KEY);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

app.use((req, res, next) => {
  if (!req.user && isAetherKey(req.get('authorization'))) {
    req.user = { id: 'aether-service', name: 'Aether', role: 'editor', entity: 'Luna' };
    req.isAuthenticated = () => true;
  }
  next();
});
```

Then set the same random value on both apps:

| App | Variable |
| --- | --- |
| Odyssey | `AETHER_SERVICE_KEY=<long random string>` |
| Aether | `ODYSSEY_API_URL=https://<odyssey domain>` and `ODYSSEY_API_KEY=<same string>` |

Generate the key with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### Also worth fixing in Odyssey

`GET/POST/PUT/DELETE /api/vendors` currently have no auth check at all. Adding `requireAuth` (and `requireEditor` on writes) closes that gap, and the service key above keeps working.

## How records are matched

- **Products:** an Odyssey entry matches an Aether product with the same Odyssey ID; otherwise one whose model equals the Odyssey name, model number (with or without version) or marketed name; otherwise one with the same name.
  - A match is **linked**: Aether stores the Odyssey ID and keeps all its own data.
  - Entries with no match are added as **synced** products. Their name, model, manufacturer, category and lifecycle follow Odyssey and can't be edited in Aether. Markets, channels, notes and everything else can.
  - Odyssey status maps to lifecycle: `active` → Active; `eol`, `discontinued`, `rejected` → Discontinued; anything else → In development.
- **Vendors:** matched by Odyssey ID, then by name. Aether's own vendors keep their data when linked. Vendors that exist only in Odyssey are added as synced, contacts included.
- **Test sessions:** copied read-only and attached to the product through `catalogId`.
