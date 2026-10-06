-- The returns codebook becomes six buckets plus Other, as agreed for the Returns dashboard:
--   Connectivity · Fit & Installation · Subscription · Performance / Hardware ·
--   Shipping, Logistics, Missing Parts / Damaged · Changed Mind · Other
-- Sub-reasons stay as they were and move under their new bucket, so detail isn't lost and every return
-- (rule-sorted or filed by hand) follows its sub-reason. Each bucket gets a definition for the dashboard's key.

ALTER TABLE return_categories ADD COLUMN description TEXT NOT NULL DEFAULT '';

-- Returns point at (category, sub-reason) together; lift that while sub-reasons change category.
ALTER TABLE returns DROP CONSTRAINT returns_category_id_subreason_id_fkey;

-- Hardware Defect / DOA, and the app, manual and firmware parts of Setup, join Performance.
UPDATE return_subreasons s
   SET category_id = (SELECT id FROM return_categories WHERE key = 'performance'),
       sort_order  = CASE s.key WHEN 'wont_power_on' THEN 5 WHEN 'support_confirmed' THEN 6 WHEN 'works_then_dies' THEN 7
                                WHEN 'overheating' THEN 8 WHEN 'app_setup' THEN 9 WHEN 'no_manual' THEN 10 ELSE 11 END
  FROM return_categories c
 WHERE c.id = s.category_id AND (c.key = 'hardware' OR (c.key = 'setup' AND s.key IN ('app_setup', 'no_manual', 'firmware')));

-- Smart-home pairing is a connection problem; a trust or authenticity worry fits no bucket.
UPDATE return_subreasons s SET category_id = (SELECT id FROM return_categories WHERE key = 'connectivity'), sort_order = 6
  FROM return_categories c WHERE c.id = s.category_id AND c.key = 'setup' AND s.key = 'smart_home';
UPDATE return_subreasons s SET category_id = (SELECT id FROM return_categories WHERE key = 'non_specific'), sort_order = 2
  FROM return_categories c WHERE c.id = s.category_id AND c.key = 'setup' AND s.key = 'trust';

UPDATE returns r SET category_id = s.category_id FROM return_subreasons s WHERE s.id = r.subreason_id AND r.category_id <> s.category_id;
ALTER TABLE returns ADD FOREIGN KEY (category_id, subreason_id) REFERENCES return_subreasons (category_id, id);

-- Secondary categories on Hardware or Setup now mean Performance / Hardware.
INSERT INTO return_secondary_categories (return_id, category_id, added_by, created_at)
SELECT x.return_id, (SELECT id FROM return_categories WHERE key = 'performance'), x.added_by, x.created_at
  FROM return_secondary_categories x JOIN return_categories c ON c.id = x.category_id
 WHERE c.key IN ('hardware', 'setup')
ON CONFLICT DO NOTHING;
DELETE FROM return_secondary_categories x USING return_categories c WHERE c.id = x.category_id AND c.key IN ('hardware', 'setup');
-- A return's secondary category can't be its main one.
DELETE FROM return_secondary_categories x USING returns r WHERE r.id = x.return_id AND r.category_id = x.category_id;

DELETE FROM return_categories WHERE key IN ('hardware', 'setup');

UPDATE return_categories SET tie_break_rank = NULL;
UPDATE return_categories c SET
  name = v.name, sort_order = v.sort_order, tie_break_rank = v.rank, description = v.description
  FROM (VALUES
    ('connectivity', 'Connectivity', 1, 2,
     'The camera won''t connect to Wi-Fi or the app, drops offline, or can''t pair with a phone, router or smart-home system. Includes home networks it doesn''t support (5 GHz only, mesh, weak signal).'),
    ('fit', 'Fit & Installation', 2, 4,
     'It works, but doesn''t suit where or how the buyer wants to use it: doesn''t fit the light fixture or window, wrong view or angle, cord or power too far, needs the switch left on, mount won''t hold, or not allowed (landlord, HOA).'),
    ('subscription', 'Subscription', 3, 3,
     'A surprise or too costly subscription, video only with a plan (stills without), or needing an SD card.'),
    ('performance', 'Performance / Hardware', 4, 5,
     'The camera connects but doesn''t do its job, or is faulty: poor picture or night vision, motion and alerts, lag, not recording, won''t power on, dies after a while, overheats, confirmed defective by support, or the app, setup steps, manual or firmware let it down.'),
    ('shipping', 'Shipping, Logistics, Missing Parts / Damaged', 5, 1,
     'The order went wrong before the camera was used: not received, late, wrong or missing items or parts, or arrived damaged.'),
    ('changed_mind', 'Changed Mind', 6, 6,
     'Nothing wrong with the camera: no longer needed, bought another or too many, a gift, or ordered by mistake.'),
    ('non_specific', 'Other', 7, 7,
     'A note that doesn''t say what went wrong ("doesn''t work", "not as expected"), a trust or authenticity worry, and notes the rules couldn''t place that are waiting to be filed by hand.'),
    ('no_comment', 'No Comment', 8, NULL,
     'The buyer left no note of their own: blank, or only the platform''s menu choice. Counted, but not in any bucket.'),
    ('sample', 'Sample Program', 9, NULL, 'Refundable samples. Set aside: not counted as returns.'),
    ('not_customer', 'Not a Customer Return', 10, NULL, 'Never reached a customer: undeliverable, or damaged by the carrier or in the warehouse. Set aside: not counted as returns.')
  ) AS v (key, name, sort_order, rank, description)
 WHERE c.key = v.key;

UPDATE return_subreasons s SET name = 'Wrong / missing item or parts' FROM return_categories c WHERE c.id = s.category_id AND c.key = 'shipping' AND s.key = 'wrong_missing';
UPDATE return_subreasons s SET name = 'Arrived damaged (item or package)' FROM return_categories c WHERE c.id = s.category_id AND c.key = 'shipping' AND s.key = 'damaged_package';
