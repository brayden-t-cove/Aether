-- Mentions: a buyer's note can raise more than one problem ("too big for the fixture and it keeps going offline").
-- Instead of the rules picking one bucket, each problem the note mentions is its own mention, in its own bucket.
-- Buckets count mentions; a review (one return) can have several. The return keeps a main category (the
-- highest-priority mention, or Generic / No Comment / set aside) for the Review page.
--
-- Also: a "Generic" group for notes that say nothing specific ("doesn't work", "didn't like it"). The Vague
-- sub-reason moves there from Other, so Other is left for specific points that fit no bucket.

INSERT INTO return_categories (key, name, sort_order, tie_break_rank, in_share, set_aside, description) VALUES
  ('generic', 'Generic', 8, NULL, false, false,
   'The buyer commented, but said nothing specific: "doesn''t work", "not as expected", "didn''t like it". Counted only when the note mentions nothing more specific.');
UPDATE return_categories SET sort_order = 9 WHERE key = 'no_comment';
UPDATE return_categories SET sort_order = 10 WHERE key = 'sample';
UPDATE return_categories SET sort_order = 11 WHERE key = 'not_customer';
UPDATE return_categories SET description =
  'A specific point that fits none of the buckets (a missing accessory they wished for, a trust or authenticity worry), and notes the rules couldn''t place that are waiting to be filed by hand.'
 WHERE key = 'non_specific';

-- Vague moves from Other to Generic, and returns filed under it follow.
ALTER TABLE returns DROP CONSTRAINT returns_category_id_subreason_id_fkey;
UPDATE return_subreasons s SET category_id = (SELECT id FROM return_categories WHERE key = 'generic'), sort_order = 1
  FROM return_categories c WHERE c.id = s.category_id AND c.key = 'non_specific' AND s.key = 'vague';
UPDATE return_subreasons s SET sort_order = 1 FROM return_categories c WHERE c.id = s.category_id AND c.key = 'non_specific' AND s.key = 'trust';
UPDATE returns r SET category_id = s.category_id FROM return_subreasons s WHERE s.id = r.subreason_id AND r.category_id <> s.category_id;
ALTER TABLE returns ADD CONSTRAINT returns_category_id_subreason_id_fkey FOREIGN KEY (category_id, subreason_id) REFERENCES return_subreasons (category_id, id);

CREATE TABLE return_mentions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id    UUID NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  category_id  UUID NOT NULL REFERENCES return_categories(id),
  -- Null only for mentions carried over from "also about" categories, which had no sub-reason.
  subreason_id UUID,
  -- Who found it: the keyword rules, or a person.
  source       TEXT NOT NULL CHECK (source IN ('rule', 'manual')),
  -- Why, in words, e.g. 'note matched: "connect"'.
  why          TEXT NOT NULL DEFAULT '',
  -- The comment it came from: the return's note, or for an Amazon order, the comment on one of its units.
  note         TEXT NOT NULL DEFAULT '',
  -- A person said it isn't about this; kept so the rules don't add it back.
  dismissed    BOOLEAN NOT NULL DEFAULT false,
  checked_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  checked_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (return_id, category_id),
  FOREIGN KEY (category_id, subreason_id) REFERENCES return_subreasons (category_id, id)
);
CREATE INDEX idx_return_mentions_category ON return_mentions (category_id, subreason_id) WHERE NOT dismissed;

-- What's already filed becomes mentions: the main category if it's a bucket (or Other), keeping who made the call
-- and whether it was checked; and "also about" categories as a person's mentions.
INSERT INTO return_mentions (return_id, category_id, subreason_id, source, why, note, checked_by, checked_at)
SELECT r.id, r.category_id, r.subreason_id, r.category_source, r.category_why, r.note_clean, r.reviewed_by,
       CASE WHEN r.category_source = 'manual' THEN COALESCE(r.reviewed_at, now()) ELSE r.reviewed_at END
  FROM returns r JOIN return_categories c ON c.id = r.category_id
 WHERE c.in_share;
INSERT INTO return_mentions (return_id, category_id, source, note, checked_by, checked_at)
SELECT x.return_id, x.category_id, 'manual', r.note_clean, x.added_by, x.created_at
  FROM return_secondary_categories x JOIN returns r ON r.id = x.return_id JOIN return_categories c ON c.id = x.category_id
 WHERE c.in_share
ON CONFLICT (return_id, category_id) DO NOTHING;
DROP TABLE return_secondary_categories;

-- Returns the rules haven't looked at for mentions yet. The server sorts these when it starts, so notes that
-- mention more than one problem get all their mentions.
ALTER TABLE returns ADD COLUMN mentions_sorted BOOLEAN NOT NULL DEFAULT false;
