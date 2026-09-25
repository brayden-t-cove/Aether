-- Checklist items can belong to a stage (e.g. "Sample product provided"),
-- so a project's checklist reads in the order the work happens.
ALTER TABLE checklist_items ADD COLUMN stage TEXT NOT NULL DEFAULT '';

-- More categories for the launch checklists: design work, marketing, and
-- business arrangements (pricing, contracts, payments).
ALTER TABLE checklist_items DROP CONSTRAINT checklist_items_category_check;
ALTER TABLE checklist_items ADD CONSTRAINT checklist_items_category_check
  CHECK (category IN ('certification', 'testing', 'manual', 'packaging', 'design', 'listing', 'marketing', 'business', 'other'));
