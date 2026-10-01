-- Flags ride alongside a return's category; secondary categories are other problems the buyer also mentions.

CREATE TABLE return_flags (
  return_id  UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  -- Keys and labels are in shared/workflow.js (RETURN_FLAGS).
  flag       TEXT NOT NULL CHECK (flag IN ('support_unresolved', 'cites_claim', 'all_units', 'looks_used')),
  -- 'rule' rows are worked out again on every sort. A 'manual' row is a person's call, on or off, and the rules leave it alone.
  source     TEXT NOT NULL CHECK (source IN ('rule', 'manual')),
  active     BOOLEAN NOT NULL DEFAULT true,
  CHECK (active OR source = 'manual'),
  set_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (return_id, flag)
);
CREATE INDEX idx_return_flags_flag ON return_flags (flag) WHERE active;

CREATE TABLE return_secondary_categories (
  return_id   UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES return_categories(id),
  added_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (return_id, category_id)
);
