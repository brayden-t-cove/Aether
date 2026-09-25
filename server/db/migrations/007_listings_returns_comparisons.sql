-- Phase 4: marketplace listings, returns (imported from Amazon / TikTok reports), and competitive comparisons.

-- A product's listing on a marketplace, e.g. its Amazon US ASIN. Also how returns get matched to products.
CREATE TABLE product_listings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('amazon', 'tiktok', 'walmart', 'website', 'other')),
  market_id   UUID REFERENCES markets(id) ON DELETE RESTRICT,
  -- ASIN on Amazon, product ID on TikTok Shop, item ID on Walmart.
  external_id TEXT NOT NULL DEFAULT '',
  sku         TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  state       TEXT NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'draft', 'in_review', 'live', 'paused', 'removed')),
  notes       TEXT NOT NULL DEFAULT '',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_listings_product ON product_listings (product_id);
CREATE UNIQUE INDEX idx_listings_external ON product_listings (channel, lower(external_id)) WHERE external_id <> '';
CREATE INDEX idx_listings_sku ON product_listings (channel, lower(sku)) WHERE sku <> '';

CREATE TABLE return_imports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel         TEXT NOT NULL,
  filename        TEXT NOT NULL DEFAULT '',
  row_count       INTEGER NOT NULL DEFAULT 0,
  created_count   INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  unmatched_count INTEGER NOT NULL DEFAULT 0,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One returned line from a marketplace report.
CREATE TABLE returns (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id        UUID REFERENCES return_imports(id) ON DELETE SET NULL,
  -- Null until the row is matched to a product (by listing, SKU, model or name).
  product_id       UUID REFERENCES products(id) ON DELETE SET NULL,
  channel          TEXT NOT NULL CHECK (channel IN ('amazon', 'tiktok', 'walmart', 'website', 'other')),
  market_id        UUID REFERENCES markets(id) ON DELETE SET NULL,
  return_date      DATE NOT NULL,
  -- The marketplace's own ID for this return (Amazon license plate number, TikTok return ID), when it has one.
  return_ref       TEXT NOT NULL DEFAULT '',
  order_ref        TEXT NOT NULL DEFAULT '',
  sku              TEXT NOT NULL DEFAULT '',
  external_id      TEXT NOT NULL DEFAULT '',
  product_label    TEXT NOT NULL DEFAULT '',
  quantity         INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  reason_code      TEXT NOT NULL DEFAULT '',
  reason           TEXT NOT NULL DEFAULT '',
  -- Broad bucket for spotting defects vs. buyer's remorse vs. shipping damage.
  reason_group     TEXT NOT NULL DEFAULT 'other'
                   CHECK (reason_group IN ('defect', 'not_as_described', 'changed_mind', 'shipping', 'other')),
  customer_comment TEXT NOT NULL DEFAULT '',
  disposition      TEXT NOT NULL DEFAULT '',
  status           TEXT NOT NULL DEFAULT '',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_returns_product_date ON returns (product_id, return_date);
CREATE INDEX idx_returns_date ON returns (return_date);
-- Re-importing the same report must not double count.
CREATE UNIQUE INDEX idx_returns_ref ON returns (channel, return_ref) WHERE return_ref <> '';
CREATE UNIQUE INDEX idx_returns_composite ON returns (channel, order_ref, sku, external_id, return_date, reason_code, quantity) WHERE return_ref = '';

CREATE TABLE competitors (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand      TEXT NOT NULL CHECK (brand <> ''),
  name       TEXT NOT NULL CHECK (name <> ''),
  model      TEXT NOT NULL DEFAULT '',
  category   TEXT NOT NULL DEFAULT '',
  price      NUMERIC(10, 2) CHECK (price >= 0),
  url        TEXT NOT NULL DEFAULT '',
  notes      TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_competitors_name ON competitors (lower(brand), lower(name));

-- A comparison grid: one Luna product against a set of competitors, over a list of attributes.
CREATE TABLE comparisons (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL CHECK (name <> ''),
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  notes      TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE comparison_competitors (
  comparison_id UUID NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (comparison_id, competitor_id)
);

CREATE TABLE comparison_attributes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comparison_id UUID NOT NULL REFERENCES comparisons(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (name <> ''),
  position      INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX idx_comparison_attributes_name ON comparison_attributes (comparison_id, lower(name));

-- One cell of the grid. competitor_id NULL is the Luna product's column.
CREATE TABLE comparison_values (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attribute_id  UUID NOT NULL REFERENCES comparison_attributes(id) ON DELETE CASCADE,
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  value         TEXT NOT NULL DEFAULT '',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_comparison_values_cell
  ON comparison_values (attribute_id, COALESCE(competitor_id, '00000000-0000-0000-0000-000000000000'::uuid));
