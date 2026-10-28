-- Automatic returns imports from marketplace APIs (Amazon's returns report, TikTok's returns search) are logged with the
-- other sync runs, under source 'amazon_returns' / 'tiktok_returns', with how many rows came back and how many were new.
ALTER TABLE sync_runs ADD COLUMN rows_read INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_runs ADD COLUMN returns_created INTEGER NOT NULL DEFAULT 0;
-- And which import it made, so it can be found (or undone) on the Import page.
ALTER TABLE sync_runs ADD COLUMN import_id UUID REFERENCES return_imports(id) ON DELETE SET NULL;
-- What a run noticed that people should see, e.g. the fields TikTok's API sent (names only), to confirm the mapping.
ALTER TABLE sync_runs ADD COLUMN detail TEXT NOT NULL DEFAULT '';
