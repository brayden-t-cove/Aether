-- Who confirmed or changed a return's category, and when. Replaces the companion review sheet.
ALTER TABLE returns
  ADD COLUMN reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN reviewed_at TIMESTAMPTZ;
-- The Other page: returns the rules couldn't place.
CREATE INDEX idx_returns_unsorted ON returns (return_date) WHERE category_id IS NULL;
