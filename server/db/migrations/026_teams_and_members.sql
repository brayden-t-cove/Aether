-- People wear more than one hat: a user can be on several teams. A project lists the people working on it. Each
-- checklist item belongs to a team (who it's for), defaulting from its category, and may also have one owner.

CREATE TABLE user_teams (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team    TEXT NOT NULL CHECK (team IN ('leadership', 'product_development', 'international', 'design', 'ecommerce', 'external')),
  PRIMARY KEY (user_id, team)
);
INSERT INTO user_teams (user_id, team) SELECT id, team FROM users WHERE team IS NOT NULL;
-- users.team stays as each person's first team, for anything that reads one.

CREATE TABLE project_members (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  added_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX idx_project_members_user ON project_members (user_id);
-- Everyone already involved: each project's owner and the owners of its items.
INSERT INTO project_members (project_id, user_id)
SELECT id, owner_id FROM projects WHERE owner_id IS NOT NULL
UNION
SELECT project_id, owner_id FROM checklist_items WHERE owner_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE checklist_items ADD COLUMN team TEXT
  CHECK (team IN ('leadership', 'product_development', 'international', 'design', 'ecommerce', 'external'));
-- The same defaults as CATEGORY_TEAMS in shared/roles.js.
UPDATE checklist_items SET team = CASE category
  WHEN 'certification' THEN 'international'
  WHEN 'testing'       THEN 'product_development'
  WHEN 'manual'        THEN 'design'
  WHEN 'packaging'     THEN 'design'
  WHEN 'design'        THEN 'design'
  WHEN 'listing'       THEN 'ecommerce'
  WHEN 'marketing'     THEN 'ecommerce'
  ELSE 'leadership' END;
CREATE INDEX idx_items_team ON checklist_items (team, state);
