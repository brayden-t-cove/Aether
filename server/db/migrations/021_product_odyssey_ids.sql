-- Odyssey can list the same product twice. When two synced copies (or an Aether product already linked to
-- Odyssey and another synced copy) are merged, the kept product keeps its own Odyssey ID and takes the other
-- as an extra one here, so the next sync files that entry's test sessions under it instead of re-adding the copy.
CREATE TABLE product_odyssey_ids (
  odyssey_id TEXT PRIMARY KEY CHECK (odyssey_id <> ''),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_odyssey_ids_product ON product_odyssey_ids (product_id);
