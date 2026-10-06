-- Merging duplicate products: other names a product has gone by, and pairs
-- someone has said are not the same product (so they stop being suggested).

-- Other names and model numbers a product was known by, e.g. the Odyssey name
-- of a synced copy merged into it. Searched alongside the product's own name.
CREATE TABLE product_aliases (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  alias      TEXT NOT NULL CHECK (btrim(alias) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_product_aliases ON product_aliases (product_id, lower(alias));

-- A pair of products that look alike but aren't the same. Stored once, smaller ID first.
CREATE TABLE product_distinct_pairs (
  product_a  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_b  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_a, product_b),
  CHECK (product_a < product_b)
);
CREATE INDEX idx_product_distinct_pairs_b ON product_distinct_pairs (product_b);
