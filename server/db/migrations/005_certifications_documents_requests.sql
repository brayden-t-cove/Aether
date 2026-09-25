-- Phase 2: regional variants, certifications, manuals and packaging (with
-- versions), design requests, and file attachments.

-- A regional version of a product, e.g. the UK variant with a type G plug.
CREATE TABLE product_variants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  market_id   UUID REFERENCES markets(id) ON DELETE RESTRICT,
  name        TEXT NOT NULL CHECK (name <> ''),
  sku         TEXT,
  model       TEXT,
  -- What differs from the base product: plug, packaging, language…
  differences TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_variants_product ON product_variants (product_id);

-- One certification (FCC, UKCA, PTCRB…) for a product in a market.
CREATE TABLE certifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  market_id   UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  variant_id  UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  mark        TEXT NOT NULL CHECK (mark <> ''),
  state       TEXT NOT NULL DEFAULT 'not_started'
              CHECK (state IN ('not_started', 'in_progress', 'submitted', 'certified', 'rejected', 'not_required')),
  lab         TEXT NOT NULL DEFAULT '',
  -- The certificate or grant ID, e.g. an FCC ID.
  cert_number TEXT NOT NULL DEFAULT '',
  issued_date DATE,
  expiry_date DATE,
  notes       TEXT NOT NULL DEFAULT '',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_certs_product ON certifications (product_id, market_id);
CREATE INDEX idx_certs_expiry ON certifications (expiry_date) WHERE state = 'certified';

-- A manual, packaging design, label… for a product. No market = used in every market.
CREATE TABLE documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  market_id   UUID REFERENCES markets(id) ON DELETE RESTRICT,
  variant_id  UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  kind        TEXT NOT NULL DEFAULT 'manual'
              CHECK (kind IN ('manual', 'quick_start', 'packaging', 'label', 'insert', 'other')),
  title       TEXT NOT NULL CHECK (title <> ''),
  languages   TEXT[] NOT NULL DEFAULT '{}',
  notes       TEXT NOT NULL DEFAULT '',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_product ON documents (product_id, kind);

-- Each revision of a document moves draft → in design → in review → approved → sent to OEM.
CREATE TABLE document_versions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version     TEXT NOT NULL CHECK (version <> ''),
  state       TEXT NOT NULL DEFAULT 'draft'
              CHECK (state IN ('draft', 'in_design', 'in_review', 'approved', 'sent')),
  notes       TEXT NOT NULL DEFAULT '',
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);
CREATE INDEX idx_versions_document ON document_versions (document_id, created_at DESC);

-- A request to the design team: images, renders, graphics for a product or document.
CREATE TABLE design_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title        TEXT NOT NULL CHECK (title <> ''),
  type         TEXT NOT NULL DEFAULT 'image' CHECK (type IN ('image', 'render', 'graphic', 'video', 'other')),
  product_id   UUID REFERENCES products(id) ON DELETE SET NULL,
  document_id  UUID REFERENCES documents(id) ON DELETE SET NULL,
  description  TEXT NOT NULL DEFAULT '',
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  assignee_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  due_date     DATE,
  state        TEXT NOT NULL DEFAULT 'requested'
               CHECK (state IN ('requested', 'in_progress', 'delivered', 'approved', 'cancelled')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_requests_state ON design_requests (state, due_date);
CREATE INDEX idx_requests_assignee ON design_requests (assignee_id);

-- Files and links attached to a certification, document version, design request or checklist item.
-- Uploaded files live in FILES_DIR under storage_key; links just store a URL.
CREATE TABLE attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('certification', 'document_version', 'design_request', 'checklist_item')),
  entity_id    UUID NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('file', 'link')),
  name         TEXT NOT NULL CHECK (name <> ''),
  url          TEXT,
  storage_key  TEXT UNIQUE,
  content_type TEXT,
  size_bytes   BIGINT,
  uploaded_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((kind = 'file' AND storage_key IS NOT NULL) OR (kind = 'link' AND url IS NOT NULL))
);
CREATE INDEX idx_attachments_entity ON attachments (entity_type, entity_id, created_at);
