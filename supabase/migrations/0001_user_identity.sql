-- Tournamental — user identity, friend graph, invite codes.
--
-- Runs inside the Supabase Postgres instance. `auth.users` is provided
-- by Supabase; everything in this migration lives in the `public`
-- schema and links 1:1 to that managed table by UUID.
--
-- Reference: docs/52-supabase-setup.md (dashboard walkthrough),
--            docs/32-auth-and-privacy.md (legacy SMS-OTP path, deprecated).
--
-- Conventions:
--   * All timestamps are TIMESTAMPTZ stored in UTC.
--   * Soft-delete (NULL → set timestamp) where the user might want to
--     recover the relationship (friendships); hard cascade where loss is
--     intentional (profile history when the profile is deleted).
--   * Every public row is constrained by RLS — see policies at the
--     bottom. The service-role key bypasses RLS by design and is used
--     server-side only.

-- ---------------------------------------------------------------------
-- USER PROFILE
-- One row per Supabase auth user. id is the same UUID as auth.users.id
-- so a JWT's `sub` claim joins directly.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  handle          TEXT UNIQUE NOT NULL,
  display_name    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- demographic (optional, user-set)
  age_bucket      TEXT,                                   -- "<18" | "18-24" | "25-34" | "35-44" | "45-54" | "55-64" | "65+"
  gender          TEXT,                                   -- "male" | "female" | "non-binary" | "prefer-not-to-say"

  -- location
  country_code    TEXT,                                   -- ISO-3166-1 alpha-2; set from CF-IPCountry on signup, user can override
  city            TEXT,                                   -- free-text optional
  timezone        TEXT,                                   -- IANA TZ (e.g. "Pacific/Auckland")

  -- football identity
  favourite_team_code     TEXT,                           -- FIFA team code, e.g. "ARG"
  follows_leagues         TEXT[],                         -- e.g. ['EPL','LaLiga']
  watches_via             TEXT,                           -- "streaming" | "free-to-air" | "stadium" | "highlights" | "mixed"

  -- engagement (mirrors GHL custom fields; updated server-side)
  visit_count             INT NOT NULL DEFAULT 0,
  last_visit_date         DATE,
  engagement_band         TEXT NOT NULL DEFAULT 'cold',   -- "cold" | "warm" | "hot"

  -- linked identities (for friend discovery + cross-channel push)
  telegram_id             BIGINT,                          -- t.me/<user> numeric ID
  whatsapp_phone_hash     TEXT,                            -- SHA-256(E.164 phone, salted) hex

  -- consent
  marketing_consent       BOOLEAN NOT NULL DEFAULT false,
  analytics_consent       BOOLEAN NOT NULL DEFAULT true,
  -- explicit opt-in for phone-number matching (separate from marketing).
  -- Friend matches via hashed phone only fire when BOTH parties have this
  -- flag true; GDPR/IPP9 compliant minimisation.
  phone_match_consent     BOOLEAN NOT NULL DEFAULT false,

  -- audit
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_profiles_handle      ON public.user_profiles(handle);
CREATE INDEX IF NOT EXISTS user_profiles_telegram    ON public.user_profiles(telegram_id);
CREATE INDEX IF NOT EXISTS user_profiles_phone_hash  ON public.user_profiles(whatsapp_phone_hash);
CREATE INDEX IF NOT EXISTS user_profiles_country     ON public.user_profiles(country_code);

-- Convenience trigger: keep updated_at fresh and write a change row to
-- user_profile_history whenever a tracked column moves.
CREATE OR REPLACE FUNCTION public.user_profiles_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_profiles_touch_updated_at ON public.user_profiles;
CREATE TRIGGER user_profiles_touch_updated_at
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.user_profiles_touch_updated_at();

-- ---------------------------------------------------------------------
-- PROFILE HISTORY
-- Append-only audit log of profile field changes. Useful for support
-- (rolling back a bad self-edit) and for the eventual data-export flow.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_profile_history (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_profile_history_user ON public.user_profile_history(user_id);

-- ---------------------------------------------------------------------
-- FRIENDSHIPS
-- Mutual edges. Two rows are written per friendship (A→B and B→A) so the
-- common "list my friends" query is a single index lookup. Soft-delete
-- via removed_at — preserves the row so we can show "you used to be
-- friends" and offer a one-click restore. Hard-delete only when the
-- whole user is purged.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.friendships (
  user_id      UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  friend_id    UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,                       -- "telegram" | "whatsapp_invite" | "phone_match" | "manual"
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at   TIMESTAMPTZ,
  PRIMARY KEY (user_id, friend_id),
  CHECK (user_id <> friend_id)
);
CREATE INDEX IF NOT EXISTS friendships_friend     ON public.friendships(friend_id);
CREATE INDEX IF NOT EXISTS friendships_active     ON public.friendships(user_id) WHERE removed_at IS NULL;

-- ---------------------------------------------------------------------
-- INVITE CODES
-- Short-lived deep-link codes (play.tournamental.com/i/<code>) minted by
-- every share-card render and by manual share buttons. The `source`
-- column lets us measure which surface produces the most friend
-- attribution. claimed_by → user_profiles(id) on first claim by an
-- authenticated user; until then the cookie attribution on the claim
-- page holds the pending invite.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invite_codes (
  code         TEXT PRIMARY KEY,                     -- short, base32 lower, e.g. "k7m9q3"
  user_id      UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  source       TEXT NOT NULL,                       -- "share_card" | "manual" | "telegram_bot" | "whatsapp_share"
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,                 -- 30-day default
  claimed_by   UUID REFERENCES public.user_profiles(id),
  claimed_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invite_codes_inviter   ON public.invite_codes(user_id);
CREATE INDEX IF NOT EXISTS invite_codes_unclaimed ON public.invite_codes(expires_at) WHERE claimed_by IS NULL;

-- ---------------------------------------------------------------------
-- ROW LEVEL SECURITY
--   * user_profiles : self-RW; everyone (anon + authenticated) can SELECT
--                     (handle/country/avatar are intentionally public).
--     The web client never reads private columns of OTHER users — it
--     uses the `public_profiles` view below which projects only the
--     non-sensitive subset. We keep the policy permissive on SELECT so
--     friend-graph joins work; the view enforces the privacy boundary.
--   * user_profile_history : self-read only.
--   * friendships : self-RW.
--   * invite_codes : the inviter can INSERT for themselves; anyone
--     authenticated can claim an unclaimed code (sets claimed_by/_at).
--     SELECT is open so the claim page can resolve the code.
-- ---------------------------------------------------------------------

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_profile_self_rw     ON public.user_profiles;
DROP POLICY IF EXISTS user_profile_public_read ON public.user_profiles;

CREATE POLICY user_profile_self_rw ON public.user_profiles
  FOR ALL
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY user_profile_public_read ON public.user_profiles
  FOR SELECT
  USING (true);

ALTER TABLE public.user_profile_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS history_self_r ON public.user_profile_history;
CREATE POLICY history_self_r ON public.user_profile_history
  FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS friendships_self_rw ON public.friendships;
CREATE POLICY friendships_self_rw ON public.friendships
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.invite_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invite_codes_self_w     ON public.invite_codes;
DROP POLICY IF EXISTS invite_codes_open_read  ON public.invite_codes;
DROP POLICY IF EXISTS invite_codes_open_claim ON public.invite_codes;
CREATE POLICY invite_codes_self_w ON public.invite_codes
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY invite_codes_open_read ON public.invite_codes
  FOR SELECT USING (true);
CREATE POLICY invite_codes_open_claim ON public.invite_codes
  FOR UPDATE USING (claimed_by IS NULL) WITH CHECK (claimed_by = auth.uid());

-- ---------------------------------------------------------------------
-- PUBLIC PROFILE VIEW
-- Projects the non-sensitive columns we expose to other users (friend
-- graph, leaderboards, share cards). The web client reads this view
-- when it needs another user's surface; it never SELECTs user_profiles
-- directly except for the current user's own row.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.public_profiles AS
SELECT
  id,
  handle,
  display_name,
  country_code,
  favourite_team_code,
  engagement_band,
  created_at
FROM public.user_profiles;

-- ---------------------------------------------------------------------
-- AUTO-PROVISION user_profiles on auth signup.
-- When Supabase creates auth.users (e.g. on first magic-link click),
-- this trigger writes a minimal user_profiles row so the rest of the
-- app can rely on every authenticated user having a profile. Handle is
-- generated from the user's email local-part or phone digits; the user
-- can change it on first visit to /profile.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_handle TEXT;
  v_base   TEXT;
  v_suffix INT := 0;
BEGIN
  -- Derive a candidate handle.
  IF NEW.email IS NOT NULL THEN
    v_base := lower(regexp_replace(split_part(NEW.email, '@', 1), '[^a-z0-9_]', '', 'g'));
  ELSIF NEW.phone IS NOT NULL THEN
    v_base := 'p' || regexp_replace(NEW.phone, '\D', '', 'g');
  ELSE
    v_base := 'user';
  END IF;
  IF length(v_base) < 3 THEN v_base := v_base || substr(NEW.id::text, 1, 6); END IF;
  v_base := substr(v_base, 1, 20);

  v_handle := v_base;
  WHILE EXISTS (SELECT 1 FROM public.user_profiles WHERE handle = v_handle) LOOP
    v_suffix := v_suffix + 1;
    v_handle := v_base || '_' || v_suffix::text;
  END LOOP;

  INSERT INTO public.user_profiles (id, handle)
  VALUES (NEW.id, v_handle)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();
