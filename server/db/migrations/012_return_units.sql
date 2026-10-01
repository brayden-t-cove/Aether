-- Amazon's FBA customer returns report has one row per returned unit. Units are grouped into one
-- return per order, so both channels count returns the same way, and each unit is kept here so
-- re-importing a report (or the next month's, when an order's units straddle it) never double counts.
CREATE TABLE return_units (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id          UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  -- The import that brought this unit in; may differ from the return's own import.
  import_id          UUID REFERENCES return_imports(id) ON DELETE SET NULL,
  report_line        INTEGER NOT NULL DEFAULT 0,
  unit_key           TEXT NOT NULL,
  unit_date          DATE NOT NULL,
  license_plate      TEXT NOT NULL DEFAULT '',
  sku                TEXT NOT NULL DEFAULT '',
  external_id        TEXT NOT NULL DEFAULT '',
  fnsku              TEXT NOT NULL DEFAULT '',
  product_label      TEXT NOT NULL DEFAULT '',
  quantity           INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  reason_code        TEXT NOT NULL DEFAULT '',
  customer_comment   TEXT NOT NULL DEFAULT '',
  disposition        TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT '',
  fulfillment_center TEXT NOT NULL DEFAULT '',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_return_units_return ON return_units (return_id);
CREATE INDEX idx_return_units_import ON return_units (import_id);
-- A unit is identified by its whole row (order, license plate, exact time, SKU, reason, quantity) plus how many
-- identical rows came before it: some units have no license plate, and Amazon sometimes reuses one.
CREATE UNIQUE INDEX idx_return_units_key ON return_units (unit_key);
CREATE INDEX idx_return_units_plate ON return_units (license_plate) WHERE license_plate <> '';
