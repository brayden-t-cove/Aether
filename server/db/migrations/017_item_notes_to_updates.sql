-- Notes become updates: each checklist item's existing notes move into its thread as the first entry, credited to
-- whoever created the item and dated when the item was last changed, and the single notes field goes away.
INSERT INTO item_comments (item_id, body, state, created_by, created_at)
SELECT id, left(notes, 5000), state, created_by, updated_at FROM checklist_items WHERE btrim(notes) <> '';
ALTER TABLE checklist_items DROP COLUMN notes;
