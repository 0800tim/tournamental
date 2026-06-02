/**
 * Cloudflare purge-by-URL helper.
 *
 * Called fire-and-forget from upload routes after a user-uploaded asset
 * (avatar, pool logo, pool hero) is written to disk, so the edge cache
 * invalidates immediately rather than waiting for the (long) max-age to
 * elapse. Without this, an uploader sees the new image (because their
 * own browser fetches a versioned URL), but anyone else in the same
 * geo continues to see the stale CDN copy for hours.
 *
 * Configuration:
 *
 *   CLOUDFLARE_API_TOKEN   — scoped to "Cache Purge" + your zone
 *   CLOUDFLARE_ZONE_ID     — the zone ID for play.tournamental.com
 *   CLOUDFLARE_PURGE_HOSTS — comma-separated list of public hostnames to
 *                            include in the purge (e.g.
 *                            "play.tournamental.com,vtorn-dev.aiva.nz")
 *
 * When any of the three env vars is missing, the helper logs once and
 * becomes a no-op, so dev environments without CF credentials don't
 * crash and the upload still succeeds.
 *
 * Cloudflare's `/zones/<id>/purge_cache` endpoint accepts up to 30 URLs
 * per request. We always send absolute URLs (one per configured host
 * per path) since CF will only purge exact-match URLs.
 */

const ENDPOINT_TEMPLATE = "https://api.cloudflare.com/client/v4/zones/{zone}/purge_cache";

let warnedOnce = false;

function getConfig(): {
  token: string;
  zoneId: string;
  hosts: string[];
} | null {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const hostsRaw = process.env.CLOUDFLARE_PURGE_HOSTS;
  if (!token || !zoneId || !hostsRaw) {
    if (!warnedOnce) {
      warnedOnce = true;
      // eslint-disable-next-line no-console
      console.warn(
        "[cloudflare/purge] CLOUDFLARE_API_TOKEN / _ZONE_ID / _PURGE_HOSTS not set; purge is a no-op.",
      );
    }
    return null;
  }
  const hosts = hostsRaw
    .split(",")
    .map((h) => h.trim().replace(/^https?:\/\//, "").replace(/\/$/, ""))
    .filter(Boolean);
  if (hosts.length === 0) return null;
  return { token, zoneId, hosts };
}

/**
 * Purge the given paths from Cloudflare's cache. Each path is expanded
 * to a full URL per configured host. Returns a promise that resolves
 * even on failure (logged) so callers can safely fire-and-forget without
 * a try/catch.
 *
 * Example:
 *   void purgeCloudflare(["/avatars/u_abc.jpg", "/branding/my-pool/logo.webp"]);
 */
export async function purgeCloudflare(paths: readonly string[]): Promise<void> {
  if (paths.length === 0) return;
  const cfg = getConfig();
  if (!cfg) return;
  const files: string[] = [];
  for (const p of paths) {
    const normalised = p.startsWith("/") ? p : `/${p}`;
    for (const host of cfg.hosts) {
      files.push(`https://${host}${normalised}`);
    }
  }
  // Cloudflare allows max 30 URLs per call; chunk if we ever expand.
  const url = ENDPOINT_TEMPLATE.replace("{zone}", encodeURIComponent(cfg.zoneId));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ files }),
      // 5s ceiling — purge is best-effort and must never block the upload.
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // eslint-disable-next-line no-console
      console.warn(
        `[cloudflare/purge] non-2xx for ${files.length} url(s): ${res.status} ${text.slice(0, 200)}`,
      );
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[cloudflare/purge] threw:", err instanceof Error ? err.message : String(err));
  }
}
