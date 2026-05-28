/**
 * System health snapshot. Pings each Tournamental service's healthz
 * endpoint with a tight timeout and renders latency + status. Server
 * component so the result is fresh on every page load; cache-control
 * is `no-store` via the route's `dynamic = "force-dynamic"` export.
 *
 * Why this page exists: when something on Tournamental looks broken,
 * the fastest path to "is it me or them" is this page. It's also a
 * one-screen "ack of life" for the broader product, which makes it
 * a comfortable home page once you start trusting it.
 */

import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface Probe {
  readonly name: string;
  readonly url: string;
  readonly purpose: string;
}

const PROBES: Probe[] = [
  {
    name: "play.tournamental.com",
    url: "https://play.tournamental.com/api/healthz",
    purpose: "Predict + share app (Next.js)",
  },
  {
    name: "game.tournamental.com",
    url: "https://game.tournamental.com/healthz",
    purpose: "Game service (Fastify, sqlite)",
  },
  {
    name: "auth.tournamental.com",
    url: "https://auth.tournamental.com/v1/auth/phone-registered?phone=%2B6421535832",
    purpose: "Auth-SMS (Fastify, sqlite)",
  },
  {
    name: "tournamental.com (marketing)",
    url: "https://tournamental.com/",
    purpose: "Marketing site (Astro)",
  },
  {
    name: "admin.tournamental.com",
    url: "https://admin.tournamental.com/login",
    purpose: "This dashboard (Next.js)",
  },
];

interface ProbeResult extends Probe {
  status: number | null;
  latency_ms: number | null;
  ok: boolean;
  error?: string;
}

async function probe(p: Probe): Promise<ProbeResult> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const res = await fetch(p.url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
      // Don't follow redirects so a 301 chain still counts as "alive".
      redirect: "manual",
    });
    clearTimeout(timer);
    const latency = Date.now() - started;
    // 200-299 → green; 301/302/304 → green (redirects are alive);
    // everything else (including 404 / 5xx / opaque) → red. Earlier
    // logic treated 4xx as alive which masked a real prod miss.
    const ok =
      (res.status >= 200 && res.status < 300) ||
      res.status === 301 ||
      res.status === 302 ||
      res.status === 304;
    return { ...p, status: res.status, latency_ms: latency, ok };
  } catch (err) {
    clearTimeout(timer);
    return {
      ...p,
      status: null,
      latency_ms: Date.now() - started,
      ok: false,
      error: err instanceof Error ? err.message : "unreachable",
    };
  }
}

export default async function SystemHealthPage() {
  await requireAuth();
  const results = await Promise.all(PROBES.map(probe));
  const total = results.length;
  const okCount = results.filter((r) => r.ok).length;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-display font-semibold">System health</h1>
        <p className="text-sm text-ink-200">
          One-click ack-of-life across every service. Refresh to re-probe.
          A red row means production is degraded.
        </p>
      </header>

      <section className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4">
        <div className="text-sm text-ink-200 mb-3">
          {okCount === total ? (
            <span className="text-emerald-400 font-medium">All {total} services healthy.</span>
          ) : (
            <span className="text-flame-400 font-medium">
              {okCount}/{total} services responding. Check the red rows below.
            </span>
          )}
        </div>
        <table className="w-full text-sm">
          <thead className="text-ink-200">
            <tr className="text-left">
              <th className="text-xs uppercase pb-2">Service</th>
              <th className="text-xs uppercase pb-2">Purpose</th>
              <th className="text-xs uppercase pb-2 text-right">Status</th>
              <th className="text-xs uppercase pb-2 text-right">Latency</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.name} className="border-t border-ink-700">
                <td className="py-2 font-mono text-xs">{r.name}</td>
                <td className="py-2 text-ink-200">{r.purpose}</td>
                <td className="py-2 text-right">
                  <span
                    className={`text-xs font-mono ${
                      r.ok ? "text-emerald-400" : "text-flame-400"
                    }`}
                  >
                    {r.status !== null ? r.status : (r.error ?? "down")}
                  </span>
                </td>
                <td className="py-2 text-right font-mono text-xs text-ink-200">
                  {r.latency_ms !== null ? `${r.latency_ms}ms` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 text-xs text-ink-200">
        <strong className="text-ink-50">Why a redirect counts as healthy.</strong>{" "}
        Some healthz endpoints redirect to a CDN-cached static asset. As long as
        the origin returns a 2xx or 3xx within the timeout, the service is up.
        Real 5xx responses or network timeouts are flagged red.
      </section>
    </div>
  );
}
