-- What the platform says the return is worth: TikTok's return unit price × quantity. Amazon's report has no prices.
ALTER TABLE returns ADD COLUMN refund_value NUMERIC(10, 2) CHECK (refund_value >= 0);
