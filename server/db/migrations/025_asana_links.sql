-- Asana, read-only: an Aether project can be linked to its Asana project (one per launch), and a checklist item to
-- an Asana task. Comments on linked tasks are pulled into the item's updates.

ALTER TABLE projects ADD COLUMN asana_project_gid  TEXT;
ALTER TABLE projects ADD COLUMN asana_project_name TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN asana_project_url  TEXT NOT NULL DEFAULT '';

ALTER TABLE checklist_items ADD COLUMN asana_task_gid  TEXT;
ALTER TABLE checklist_items ADD COLUMN asana_task_name TEXT NOT NULL DEFAULT '';
ALTER TABLE checklist_items ADD COLUMN asana_task_url  TEXT NOT NULL DEFAULT '';
-- When its comments were last pulled.
ALTER TABLE checklist_items ADD COLUMN asana_pulled_at TIMESTAMPTZ;
-- A task feeds one item, so its comments aren't copied twice.
CREATE UNIQUE INDEX idx_items_asana_task ON checklist_items (asana_task_gid) WHERE asana_task_gid IS NOT NULL;

-- Updates pulled from Asana: who wrote them in Asana (matched to an Aether user by email when possible), and the
-- Asana comment's ID, so each is copied once and follows edits there.
ALTER TABLE item_comments ADD COLUMN source TEXT NOT NULL DEFAULT 'aether' CHECK (source IN ('aether', 'asana'));
ALTER TABLE item_comments ADD COLUMN external_id TEXT UNIQUE;
ALTER TABLE item_comments ADD COLUMN author_label TEXT NOT NULL DEFAULT '';

-- Pull runs are logged with the Odyssey syncs, under their own source.
ALTER TABLE sync_runs ADD COLUMN comments_synced INTEGER NOT NULL DEFAULT 0;
