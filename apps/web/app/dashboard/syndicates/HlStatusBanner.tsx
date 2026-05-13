"use client";

/**
 * Admin-only banner that surfaces missing HighLevel env vars on the
 * syndicate dashboard. Non-admins see nothing (the endpoint responds
 * `{ admin: false }` and we silently return null).
 *
 * Renders a single line per missing env var so the operator can fix
 * exactly the wiring that isn't done, with the runbook link as a
 * single-click handoff.
 */

import { useEffect, useState } from "react";

interface HlStatus {
  ok: true;
  admin: true;
  hl_webhook_secret_set: boolean;
  hl_checkout_url_set: boolean;
  hl_agency_api_key_set: boolean;
  hl_main_location_id_set: boolean;
  all_configured: boolean;
}

interface NotAdminResponse {
  ok: true;
  admin: false;
}

type StatusResponse = HlStatus | NotAdminResponse;

const RUNBOOK_INTERNAL_PATH =
  "projects/tournamental-business/commercial/highlevel-setup-runbook.md";

export function HlStatusBanner(): JSX.Element | null {
  const [status, setStatus] = useState<HlStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/v1/admin/hl-status", {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!r.ok) return;
        const body = (await r.json()) as StatusResponse;
        if (cancelled) return;
        if (body.ok && body.admin) {
          setStatus(body);
        }
      } catch {
        /* silently ignore; not blocking the dashboard */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;
  if (status.all_configured) return null;
  if (dismissed) return null;

  const missing: string[] = [];
  if (!status.hl_webhook_secret_set) missing.push("HL_WEBHOOK_SECRET");
  if (!status.hl_checkout_url_set) missing.push("NEXT_PUBLIC_HL_CHECKOUT_URL");
  if (!status.hl_agency_api_key_set) missing.push("HL_AGENCY_API_KEY");
  if (!status.hl_main_location_id_set) missing.push("HL_MAIN_LOCATION_ID");

  return (
    <div className="vt-admin-banner" role="region" aria-label="HighLevel configuration warning">
      <div className="vt-admin-banner-body">
        <p className="vt-admin-banner-title">
          ⚠ Admin only: HighLevel premium pipeline is not fully wired
        </p>
        <p className="vt-admin-banner-meta">
          {missing.length} env var{missing.length === 1 ? "" : "s"} unset on this
          deployment. The premium-status webhook returns 503 and free-tier syndicates
          can&apos;t upgrade until you fix this.
        </p>
        <ul className="vt-admin-banner-list">
          {missing.map((name) => (
            <li key={name}>
              <code>{name}</code>
            </li>
          ))}
        </ul>
        <p className="vt-admin-banner-meta">
          Full setup walkthrough: <code>{RUNBOOK_INTERNAL_PATH}</code> in the
          tournamental-business private docs folder.
        </p>
      </div>
      <button
        type="button"
        className="vt-admin-banner-close"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss this banner"
      >
        ×
      </button>
    </div>
  );
}
