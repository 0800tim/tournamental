/**
 * Supabase environment resolution.
 *
 * Public surface: read `NEXT_PUBLIC_SUPABASE_URL` and the anon key from
 * the bundle-time env. Server-only code can additionally read the
 * service-role key, the phone-hash salt, and the SMS-hook secret.
 *
 * When the public URL is unset we return `null` for the public config
 * so the rest of the app can branch to guest-mode. This keeps `pnpm dev`
 * working without a Supabase project provisioned.
 */

export interface SupabasePublicConfig {
  readonly url: string;
  readonly anonKey: string;
}

export interface SupabaseServerConfig extends SupabasePublicConfig {
  readonly serviceRoleKey: string;
  readonly phoneHashSalt: string;
  readonly jwtSecret: string;
  readonly smsHookSecret: string;
}

/**
 * Read public Supabase config from the env. Returns `null` when the
 * mandatory `NEXT_PUBLIC_SUPABASE_URL` is missing or empty so callers
 * can decide whether to gracefully fall back to guest-mode.
 */
export function readPublicConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

/**
 * Read server-only Supabase config. Throws if any required var is
 * missing, server routes that need this should fail loudly so we
 * notice misconfigured deploys.
 */
export function readServerConfig(): SupabaseServerConfig {
  const pub = readPublicConfig();
  if (!pub) {
    throw new Error(
      "Supabase public config missing (NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY)",
    );
  }
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const phoneHashSalt = process.env.SUPABASE_PHONE_HASH_SALT ?? "";
  const jwtSecret = process.env.SUPABASE_JWT_SECRET ?? "";
  const smsHookSecret = process.env.SUPABASE_SMS_HOOK_SECRET ?? "";
  if (!serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing");
  if (!phoneHashSalt) throw new Error("SUPABASE_PHONE_HASH_SALT missing");
  return {
    ...pub,
    serviceRoleKey,
    phoneHashSalt,
    jwtSecret,
    smsHookSecret,
  };
}

/** Convenience: is the auth surface available in the current env? */
export function isAuthAvailable(): boolean {
  return readPublicConfig() !== null;
}
