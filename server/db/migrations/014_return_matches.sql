-- How confidently each return was matched to a real customer, from the customer-match workbook.
-- Keyed by the platform's return ID rather than tied to a returns row, so the workbook can be
-- uploaded before or after the returns export it describes. Only the ID and the confidence are kept:
-- the workbook's names, phone numbers, emails and addresses never reach the server.
CREATE TABLE return_matches (
  channel    TEXT NOT NULL CHECK (channel IN ('amazon', 'tiktok', 'walmart', 'website', 'other')),
  return_ref TEXT NOT NULL CHECK (return_ref <> ''),
  -- Keys and labels are in shared/workflow.js (MATCH_CONFIDENCE).
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium', 'low', 'unmatched')),
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (channel, return_ref)
);

-- Categories that point at a problem with the product itself, for the Returns page's "Product problems" share.
ALTER TABLE return_categories ADD COLUMN product_problem BOOLEAN NOT NULL DEFAULT false;
UPDATE return_categories SET product_problem = true WHERE key IN ('connectivity', 'performance', 'hardware', 'setup');
