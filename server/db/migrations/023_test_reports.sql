-- Test results that don't come from Odyssey: a lab report or an in-house test, kept as a PDF or a link to one.
-- They sit alongside the Odyssey test sessions in a product's (and its projects') Test results.
CREATE TABLE test_reports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  -- The project it was added from, if any. The report belongs to the product, so every project for it shows it.
  project_id  UUID REFERENCES projects(id) ON DELETE SET NULL,
  title       TEXT NOT NULL CHECK (title <> ''),
  result      TEXT NOT NULL DEFAULT '' CHECK (result IN ('', 'passed', 'failed', 'partial')),
  tested_on   DATE,
  -- The lab or person who ran the test.
  tested_by   TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_test_reports_product ON test_reports (product_id, tested_on DESC NULLS LAST, created_at DESC);

-- The report's PDF or link lives in attachments, like every other file.
ALTER TABLE attachments DROP CONSTRAINT attachments_entity_type_check;
ALTER TABLE attachments ADD CONSTRAINT attachments_entity_type_check
  CHECK (entity_type IN ('certification', 'document_version', 'design_request', 'checklist_item', 'test_report'));
