-- Product details from Luna's product list: model number, manufacturer,
-- which markets each product sells in, and which product it replaces.

-- Model number, e.g. R8411 or W4. Also the product's name in Odyssey.
ALTER TABLE products ADD COLUMN model TEXT;
CREATE UNIQUE INDEX idx_products_model ON products (lower(model)) WHERE model IS NOT NULL;

ALTER TABLE products ADD COLUMN manufacturer TEXT NOT NULL DEFAULT '';

-- A new model that replaces an older one (e.g. Window Camera V2 replaces W4).
ALTER TABLE products ADD COLUMN replaces_id UUID REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE products ADD CONSTRAINT products_not_self_replacing CHECK (replaces_id <> id);

-- Markets a product sells in (active) or is planned for (in development).
CREATE TABLE product_markets (
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  market_id  UUID NOT NULL REFERENCES markets(id) ON DELETE RESTRICT,
  PRIMARY KEY (product_id, market_id)
);
CREATE INDEX idx_product_markets_market ON product_markets (market_id);

-- Markets Luna already sells in.
INSERT INTO markets (code, name, plug_types, voltage, frequency, required_marks, languages) VALUES
  ('MX', 'Mexico',       '{A,B}',   '127V', '60Hz', '{NOM,IFT}',    '{Spanish}'),
  ('ZA', 'South Africa', '{M,N,C}', '230V', '50Hz', '{ICASA,NRCS}', '{English}')
ON CONFLICT (code) DO NOTHING;
