-- Returns codebook: one shared set of categories and sub-reasons for every channel.
-- Each return gets one main category and one sub-reason. The old reason_group stays for now.

CREATE TABLE return_categories (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key            TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  name           TEXT NOT NULL UNIQUE CHECK (name <> ''),
  sort_order     INTEGER NOT NULL,
  -- When a note fits more than one category, the lowest rank wins. Null for categories the rules never pick from a note.
  tie_break_rank INTEGER UNIQUE,
  -- Counted in share-of-returns math. False for No Comment, Sample Program and Not a Customer Return.
  in_share       BOOLEAN NOT NULL DEFAULT true,
  -- Left out of every count (Sample Program, Not a Customer Return), not just the shares.
  set_aside      BOOLEAN NOT NULL DEFAULT false,
  CHECK (NOT set_aside OR NOT in_share)
);

CREATE TABLE return_subreasons (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES return_categories(id) ON DELETE CASCADE,
  key         TEXT NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]*$'),
  name        TEXT NOT NULL CHECK (name <> ''),
  sort_order  INTEGER NOT NULL,
  UNIQUE (category_id, key),
  UNIQUE (category_id, name),
  -- Lets returns reference (category, sub-reason) together, so a sub-reason can't sit under the wrong category.
  UNIQUE (category_id, id)
);

ALTER TABLE returns
  ADD COLUMN category_id     UUID REFERENCES return_categories(id),
  ADD COLUMN subreason_id    UUID,
  -- Who made the call: the keyword rules, or a person.
  ADD COLUMN category_source TEXT NOT NULL DEFAULT '' CHECK (category_source IN ('', 'rule', 'manual')),
  -- Why, in words, e.g. "note matched: wifi".
  ADD COLUMN category_why    TEXT NOT NULL DEFAULT '',
  ADD FOREIGN KEY (category_id, subreason_id) REFERENCES return_subreasons (category_id, id),
  ADD CHECK ((category_id IS NULL) = (subreason_id IS NULL)),
  ADD CHECK ((category_id IS NULL) = (category_source = ''));
CREATE INDEX idx_returns_category ON returns (category_id, subreason_id);

INSERT INTO return_categories (key, name, sort_order, tie_break_rank, in_share, set_aside) VALUES
  ('shipping',     'Shipping & Fulfillment',          1, 1, true, false),
  ('connectivity', 'Connectivity',                    2, 2, true, false),
  ('subscription', 'Subscription & Recording',        3, 3, true, false),
  ('fit',          'Fit & Installation',              4, 4, true, false),
  ('performance',  'Performance & Quality',           5, 5, true, false),
  ('hardware',     'Hardware Defect / DOA',           6, 6, true, false),
  ('setup',        'Setup, App & Instructions',       7, 7, true, false),
  ('changed_mind', 'Changed Mind / No Longer Needed', 8, 8, true, false),
  ('non_specific', 'Non-specific',                    9, 9, true, false),
  ('no_comment',   'No Comment',                     10, NULL, false, false),
  ('sample',       'Sample Program',                 11, NULL, false, true),
  ('not_customer', 'Not a Customer Return',          12, NULL, false, true);

INSERT INTO return_subreasons (category_id, key, name, sort_order)
SELECT c.id, s.key, s.name, s.sort_order
  FROM (VALUES
    ('shipping', 'not_received',      'Not received / lost / stolen', 1),
    ('shipping', 'late',              'Late / not shipped', 2),
    ('shipping', 'wrong_missing',     'Wrong / missing item in order', 3),
    ('shipping', 'damaged_package',   'Damaged / opened package', 4),

    ('connectivity', 'wont_connect',  'Won''t connect / pair at setup', 1),
    ('connectivity', 'drops_offline', 'Drops offline / unstable', 2),
    ('connectivity', 'router_isp',    'Router / ISP / 5GHz incompatibility', 3),
    ('connectivity', 'bluetooth',     'Bluetooth / phone pairing', 4),
    ('connectivity', 'weak_signal',   'Weak signal outdoors / through window', 5),

    ('subscription', 'unexpected_subscription', 'Unexpected subscription required', 1),
    ('subscription', 'subscription_cost',       'Subscription too expensive', 2),
    ('subscription', 'stills_only',             'Stills only / no video without sub', 3),
    ('subscription', 'sd_card',                 'SD card (slot / cost / compatibility)', 4),

    ('fit', 'fixture',     'Light fixture fit (too big / won''t hang / socket)', 1),
    ('fit', 'view_angle',  'Field of view / angle', 2),
    ('fit', 'window',      'Window incompatibility (tint / double / glass)', 3),
    ('fit', 'cord_power',  'Cord / power location', 4),
    ('fit', 'environment', 'Environment / permissions', 5),
    ('fit', 'switch_on',   'Needs switch always on', 6),
    ('fit', 'mount',       'Mount / adhesion', 7),

    ('performance', 'image_quality', 'Image quality / night vision / glare', 1),
    ('performance', 'motion',        'Motion detection / tracking / alerts', 2),
    ('performance', 'lag',           'Lag / slow app / live view', 3),
    ('performance', 'not_recording', 'Doesn''t record / misses events', 4),

    ('hardware', 'wont_power_on',   'Won''t power on / broken', 1),
    ('hardware', 'support_confirmed', 'Confirmed defective by support', 2),
    ('hardware', 'works_then_dies', 'Works briefly then dies', 3),
    ('hardware', 'overheating',     'Overheating / safety', 4),

    ('setup', 'app_setup',  'App / QR / setup difficulty', 1),
    ('setup', 'no_manual',  'No manual / instructions', 2),
    ('setup', 'smart_home', 'Smart-home / Alexa / RTSP integration', 3),
    ('setup', 'trust',      'Trust / authenticity concern', 4),
    ('setup', 'firmware',   'Firmware update fails', 5),

    ('changed_mind', 'bought_another', 'Bought another / duplicate / too many', 1),
    ('changed_mind', 'circumstances',  'Circumstances changed / gift', 2),
    ('changed_mind', 'mistake',        'Ordered by mistake / never ordered', 3),

    ('non_specific', 'vague', 'Vague ("doesn''t work", "not as expected")', 1),

    ('no_comment', 'blank',                  'Blank', 1),
    ('no_comment', 'preset_needs_changed',   'Preset only: Changed Mind / My needs changed', 2),
    ('no_comment', 'preset_found_other',     'Preset only: Changed Mind / Found other item', 3),
    ('no_comment', 'preset_better_price',    'Preset only: Changed Mind / Found a better price', 4),
    ('no_comment', 'preset_too_many',        'Preset only: Ordering Issue / Ordered too many', 5),
    ('no_comment', 'preset_accidental',      'Preset only: Ordering Issue / Accidental purchase', 6),
    ('no_comment', 'preset_wrong_item',      'Preset only: Ordering Issue / Ordered wrong item', 7),
    ('no_comment', 'preset_not_as_expected', 'Preset only: Not as expected', 8),
    ('no_comment', 'preset_new',             'Preset only: New', 9),

    ('sample', 'refundable_sample', 'Refundable sample', 1),

    ('not_customer', 'undeliverable',     'Undeliverable, returned by carrier', 1),
    ('not_customer', 'damaged_warehouse', 'Damaged in Amazon warehouse', 2),
    ('not_customer', 'damaged_carrier',   'Damaged by carrier', 3)
  ) AS s (category_key, key, name, sort_order)
  JOIN return_categories c ON c.key = s.category_key;
