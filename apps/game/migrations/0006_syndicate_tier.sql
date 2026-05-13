-- 0006_syndicate_tier.sql — premium-tier flag + HighLevel identifiers.
--
-- Adds the columns that let the codebase render a "free" vs "premium"
-- syndicate without doing any commercial logic itself. All billing,
-- subscription state machines, dunning, and provisioning happen inside
-- HighLevel automations (closed, not in this repo). The codebase just
-- stores the resulting status flag and the opaque HL identifiers so we
-- can deep-link a syndicate owner back into their CRM and so the
-- premium-tier UI can be gated correctly.
--
-- Columns:
--   tier
--     'free'      — default; embed widget on any site, master HL list
--     'premium'   — Aiva-managed HighLevel sub-account active
--     'past_due'  — subscription payment failed, grace period before
--                   downgrade. Set by HL webhook on Stripe payment-failed.
--
--   hl_location_id
--     Opaque HighLevel Location id of the customer's CRM sub-account.
--     Null for free-tier syndicates. Populated by the HL webhook when
--     a premium provisioning workflow completes inside HL.
--
--   hl_subscription_id
--     Opaque Stripe-subscription id forwarded by HL on the webhook.
--     Useful for cross-referencing in support cases. Treated as opaque.
--
--   hl_premium_since
--     Epoch ms when the syndicate first became premium. Survives a
--     later downgrade so we can compute "loyalty" metrics if needed.
--
-- These columns are nullable on free-tier rows so the migration is
-- backwards-compatible with existing data.

ALTER TABLE syndicates ADD COLUMN tier TEXT NOT NULL DEFAULT 'free';
ALTER TABLE syndicates ADD COLUMN hl_location_id TEXT;
ALTER TABLE syndicates ADD COLUMN hl_subscription_id TEXT;
ALTER TABLE syndicates ADD COLUMN hl_premium_since INTEGER;

CREATE INDEX IF NOT EXISTS idx_syndicates_tier
  ON syndicates(tier);
CREATE INDEX IF NOT EXISTS idx_syndicates_owner_user_id
  ON syndicates(owner_user_id);
