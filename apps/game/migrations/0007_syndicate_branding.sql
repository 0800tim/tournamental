-- 0007_syndicate_branding.sql — branding + sponsor + prize fields.
--
-- The free-tier embed widget reads these fields via the public
-- `/api/v1/syndicates/[slug]/config` endpoint and renders them in
-- shadow DOM. The premium tier adds Aiva CRM on top; the branding
-- data lives here either way so a host can ship a branded embed
-- without paying anything.
--
-- All fields nullable; the embed widget falls back to Tournamental
-- defaults when a value is missing.
--
-- Columns:
--   branding_primary_colour     hex like '#fbbf24'; renders as accent
--   branding_accent_colour      hex like '#21a34a'; renders as secondary accent
--   branding_logo_url           hosted image URL (anywhere); shown in widget header
--   branding_hero_url           hosted image URL; shown as widget hero background
--   sponsor_name                shown as "Sponsored by ..." in widget footer
--   sponsor_url                 sponsor's own site, target=_blank on the logo
--   sponsor_logo_url            sponsor logo image
--   prize_text                  free-form copy describing the prize on the public landing

ALTER TABLE syndicates ADD COLUMN branding_primary_colour TEXT;
ALTER TABLE syndicates ADD COLUMN branding_accent_colour TEXT;
ALTER TABLE syndicates ADD COLUMN branding_logo_url TEXT;
ALTER TABLE syndicates ADD COLUMN branding_hero_url TEXT;
ALTER TABLE syndicates ADD COLUMN sponsor_name TEXT;
ALTER TABLE syndicates ADD COLUMN sponsor_url TEXT;
ALTER TABLE syndicates ADD COLUMN sponsor_logo_url TEXT;
ALTER TABLE syndicates ADD COLUMN prize_text TEXT;
