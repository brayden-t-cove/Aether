-- Phase 3: vendors, Odyssey test sessions, and a record of each sync with Odyssey.

CREATE TABLE vendors (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (name <> ''),
  type        TEXT NOT NULL DEFAULT 'manufacturer'
              CHECK (type IN ('manufacturer', 'cert_lab', 'packaging', 'translation', 'logistics', 'design', 'other')),
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('prospect', 'active', 'inactive')),
  website     TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  -- Vendors synced from Odyssey keep their Odyssey ID; their core fields are read-only here.
  source      TEXT NOT NULL DEFAULT 'aether' CHECK (source IN ('aether', 'odyssey')),
  odyssey_id  TEXT UNIQUE,
  synced_at   TIMESTAMPTZ,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_vendors_name ON vendors (lower(name));

CREATE TABLE vendor_contacts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id  UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (name <> ''),
  role       TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  -- WeChat, WhatsApp, etc.
  messaging  TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vendor_contacts_vendor ON vendor_contacts (vendor_id);

-- Which vendors work on which products, and in what capacity.
CREATE TABLE vendor_products (
  vendor_id  UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'manufacturer'
             CHECK (role IN ('manufacturer', 'cert_lab', 'packaging', 'translation', 'logistics', 'design', 'other')),
  PRIMARY KEY (vendor_id, product_id, role)
);
CREATE INDEX idx_vendor_products_product ON vendor_products (product_id);

-- The lab that runs a certification can be a vendor.
ALTER TABLE certifications ADD COLUMN lab_vendor_id UUID REFERENCES vendors(id) ON DELETE SET NULL;

ALTER TABLE products ADD COLUMN synced_at TIMESTAMPTZ;

-- Test sessions from Odyssey (read-only copies), shown as evidence on products and projects.
CREATE TABLE test_sessions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  odyssey_id         TEXT NOT NULL UNIQUE,
  odyssey_product_id TEXT,
  product_id         UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name       TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT '',
  test_plan          TEXT NOT NULL DEFAULT '',
  tester             TEXT NOT NULL DEFAULT '',
  test_count         INTEGER NOT NULL DEFAULT 0,
  pass_count         INTEGER NOT NULL DEFAULT 0,
  fail_count         INTEGER NOT NULL DEFAULT 0,
  skip_count         INTEGER NOT NULL DEFAULT 0,
  issue_count        INTEGER NOT NULL DEFAULT 0,
  started_at         TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  synced_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_test_sessions_product ON test_sessions (product_id, started_at DESC);

-- One row per sync attempt, so the app can show when data was last refreshed and why a sync failed.
CREATE TABLE sync_runs (
  id               BIGSERIAL PRIMARY KEY,
  source           TEXT NOT NULL DEFAULT 'odyssey',
  trigger          TEXT NOT NULL DEFAULT 'schedule' CHECK (trigger IN ('schedule', 'manual')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at      TIMESTAMPTZ,
  ok               BOOLEAN,
  error            TEXT,
  products_created INTEGER NOT NULL DEFAULT 0,
  products_linked  INTEGER NOT NULL DEFAULT 0,
  products_updated INTEGER NOT NULL DEFAULT 0,
  sessions_synced  INTEGER NOT NULL DEFAULT 0,
  vendors_created  INTEGER NOT NULL DEFAULT 0,
  vendors_updated  INTEGER NOT NULL DEFAULT 0,
  started_by       UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_sync_runs_started ON sync_runs (source, started_at DESC);

-- Small key/value store for background jobs (e.g. the last day a digest was sent).
CREATE TABLE job_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
