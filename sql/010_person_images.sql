-- 010: people get an image. Links only, no files copied: the full image, a 400px thumbnail,
-- the Wikimedia Commons page (author, licence and credit live there) and the short licence name.
-- Existing public-read policy covers the new columns.
alter table entities add column image_url text, add column image_thumb text, add column image_page text, add column image_license text;
