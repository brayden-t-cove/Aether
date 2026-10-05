-- The buyer's own words, with Amazon's menu text and TikTok's reason taken off. The rules sort on this.
ALTER TABLE returns ADD COLUMN note_clean TEXT NOT NULL DEFAULT '';
