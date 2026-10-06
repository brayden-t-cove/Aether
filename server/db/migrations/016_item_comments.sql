-- Updates on checklist items: who said what about an item, and when. A comment written while changing the item's
-- state records the change (state_from → state), so the thread reads as the story of why it's where it is.
CREATE TABLE item_comments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    UUID NOT NULL REFERENCES checklist_items(id) ON DELETE CASCADE,
  body       TEXT NOT NULL CHECK (body <> '' AND length(body) <= 5000),
  -- The item's state when the comment was written.
  state      TEXT NOT NULL CHECK (state IN ('not_started', 'in_progress', 'blocked', 'in_review', 'done')),
  -- Set when the comment came with a state change: the state before it.
  state_from TEXT CHECK (state_from IN ('not_started', 'in_progress', 'blocked', 'in_review', 'done')),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at  TIMESTAMPTZ
);
CREATE INDEX idx_item_comments_item ON item_comments (item_id, created_at);

-- Notes become updates: each item's existing notes move into its thread as the first entry, credited to whoever
-- created the item and dated when the item was last changed, and the single notes field goes away.
INSERT INTO item_comments (item_id, body, state, created_by, created_at)
SELECT id, left(notes, 5000), state, created_by, updated_at FROM checklist_items WHERE btrim(notes) <> '';
ALTER TABLE checklist_items DROP COLUMN notes;
