-- What a sub-reason says about the cause, for the Returns page's three groups. Set per sub-reason, not per
-- category, because Connectivity covers both: a router that only does 5 GHz is the buyer's conditions, while
-- "won't connect" usually doesn't say which. Sub-reasons with no cause (shipping, subscription, changed mind…)
-- count under "Other reasons".
ALTER TABLE return_subreasons ADD COLUMN cause TEXT CHECK (cause IN ('fault', 'conditions', 'unclear'));

UPDATE return_subreasons s SET cause = 'fault' FROM return_categories c
 WHERE c.id = s.category_id AND (c.key IN ('hardware', 'performance') OR (c.key = 'setup' AND s.key IN ('app_setup', 'no_manual', 'firmware')));
UPDATE return_subreasons s SET cause = 'conditions' FROM return_categories c
 WHERE c.id = s.category_id AND (c.key = 'fit' OR (c.key = 'connectivity' AND s.key IN ('router_isp', 'weak_signal')) OR (c.key = 'setup' AND s.key = 'smart_home'));
UPDATE return_subreasons s SET cause = 'unclear' FROM return_categories c
 WHERE c.id = s.category_id AND c.key = 'connectivity' AND s.key IN ('wont_connect', 'drops_offline', 'bluetooth');

-- Replaced by the sub-reason causes above.
ALTER TABLE return_categories DROP COLUMN product_problem;

-- A fifth flag: the note shows the camera itself is at fault (next to the router, other cameras work on the
-- same network, support confirmed it). It moves a return whose cause is unclear into "Product fault".
ALTER TABLE return_flags DROP CONSTRAINT return_flags_flag_check;
ALTER TABLE return_flags ADD CONSTRAINT return_flags_flag_check
  CHECK (flag IN ('support_unresolved', 'cites_claim', 'all_units', 'looks_used', 'points_to_fault'));
