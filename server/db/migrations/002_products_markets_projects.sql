-- Phase 1: products, markets, projects, checklist items and blockers.

-- One shared set of states for projects and checklist items.
-- not_started → in_progress → in_review → done, with blocked possible at any point.

CREATE TABLE products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (name <> ''),
  sku         TEXT UNIQUE,
  category    TEXT NOT NULL DEFAULT '',
  lifecycle   TEXT NOT NULL DEFAULT 'upcoming' CHECK (lifecycle IN ('upcoming', 'active', 'sunset')),
  launch_date DATE,
  sunset_date DATE,
  -- Sales channels, e.g. {Amazon,TikTok}.
  channels    TEXT[] NOT NULL DEFAULT '{}',
  notes       TEXT NOT NULL DEFAULT '',
  -- Phase 3: products synced from Odyssey keep their Odyssey ID and are read-only here.
  source      TEXT NOT NULL DEFAULT 'aether' CHECK (source IN ('aether', 'odyssey')),
  odyssey_id  TEXT UNIQUE,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_products_lifecycle ON products (lifecycle, name);

CREATE TABLE markets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Short code used in names and filters, e.g. UK, US, EU.
  code           TEXT NOT NULL UNIQUE CHECK (code <> ''),
  name           TEXT NOT NULL CHECK (name <> ''),
  plug_types     TEXT[] NOT NULL DEFAULT '{}',
  voltage        TEXT NOT NULL DEFAULT '',
  frequency      TEXT NOT NULL DEFAULT '',
  required_marks TEXT[] NOT NULL DEFAULT '{}',
  languages      TEXT[] NOT NULL DEFAULT '{}',
  notes          TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Starting set of markets. Editable in the app.
INSERT INTO markets (code, name, plug_types, voltage, frequency, required_marks, languages) VALUES
  ('US', 'United States',  '{A,B}',     '120V', '60Hz', '{FCC}',           '{English}'),
  ('CA', 'Canada',         '{A,B}',     '120V', '60Hz', '{ISED}',          '{English,French}'),
  ('UK', 'United Kingdom', '{G}',       '230V', '50Hz', '{UKCA}',          '{English}'),
  ('EU', 'European Union', '{C,F}',     '230V', '50Hz', '{CE}',            '{English,German,French,Spanish,Italian}'),
  ('AU', 'Australia',      '{I}',       '230V', '50Hz', '{RCM}',           '{English}');

CREATE TABLE projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (name <> ''),
  type        TEXT NOT NULL DEFAULT 'launch' CHECK (type IN ('launch', 'new_product', 'app_feature', 'other')),
  product_id  UUID REFERENCES products(id) ON DELETE RESTRICT,
  market_id   UUID REFERENCES markets(id) ON DELETE RESTRICT,
  owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  state       TEXT NOT NULL DEFAULT 'not_started'
              CHECK (state IN ('not_started', 'in_progress', 'blocked', 'in_review', 'done')),
  target_date DATE,
  description TEXT NOT NULL DEFAULT '',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_projects_product ON projects (product_id);
CREATE INDEX idx_projects_market ON projects (market_id);
CREATE INDEX idx_projects_state ON projects (state);

CREATE TABLE checklist_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL CHECK (title <> ''),
  category     TEXT NOT NULL DEFAULT 'other'
               CHECK (category IN ('certification', 'manual', 'packaging', 'testing', 'listing', 'other')),
  owner_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  state        TEXT NOT NULL DEFAULT 'not_started'
               CHECK (state IN ('not_started', 'in_progress', 'blocked', 'in_review', 'done')),
  due_date     DATE,
  evidence_url TEXT NOT NULL DEFAULT '',
  notes        TEXT NOT NULL DEFAULT '',
  position     INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ,
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_items_project ON checklist_items (project_id, position);
CREATE INDEX idx_items_owner ON checklist_items (owner_id);
CREATE INDEX idx_items_due ON checklist_items (due_date) WHERE state <> 'done';

-- "item_id waits on blocked_by_id". Blockers may live in another project
-- (e.g. a UK launch waiting on a product's certification work).
CREATE TABLE item_dependencies (
  item_id       UUID NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  blocked_by_id UUID NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, blocked_by_id),
  CHECK (item_id <> blocked_by_id)
);
CREATE INDEX idx_dependencies_blocker ON item_dependencies (blocked_by_id);
