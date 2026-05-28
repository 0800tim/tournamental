"use client";

/**
 * InviteWizard - bulk invite UI for pool owners (and the Tournamental
 * admin once we wire the cross-app embed).
 *
 * Flow (single screen):
 *   1. Upload CSV (drag-drop or file picker), or paste from clipboard,
 *      or browse device contacts (Web Contacts API on supported
 *      mobile browsers).
 *   2. Preview table of parsed contacts, plus a "skipped" panel for
 *      rows we couldn't normalise.
 *   3. Compose the plain-text message (1000-char hard cap, live
 *      counter, variable helper chips).
 *   4. Choose channels (WhatsApp / Email).
 *   5. Confirm and send → POSTs to /api/v1/syndicates/[slug]/invites,
 *      then polls /[jobId] every 2s and shows live progress.
 *
 * Native share row underneath: WhatsApp / Messenger / Telegram / X /
 * Copy link. These use the system share sheet on mobile and per-app
 * deep links on desktop. They share the pool's public share URL with
 * no recipient context, so the recipient sees the standard public
 * join page (not a warm-invite).
 *
 * No external CSS — all inline-styled so this component can be lifted
 * into the admin app verbatim.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseInviteCsv,
  type InviteContact,
  type ParseResult,
} from "@/lib/invite/parse-csv";

export interface InviteWizardProps {
  readonly slug: string;
  readonly poolName: string;
  /** Public join URL (no warm-invite params). Used by the share row. */
  readonly shareUrl: string;
  /** Manage JWT bearer for /api/v1/syndicates/[slug]/invites. */
  readonly manageToken: string;
  /** Default country for phone normalisation. */
  readonly defaultCountry?: "NZ" | "AU" | "GB" | "US";
}

type Channel = "whatsapp" | "email";

interface JobStatus {
  job_id: string;
  status: "queued" | "running" | "paused" | "done" | "cancelled";
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  channels: string[];
  throttle_ms: number;
  created_at: string;
  updated_at: string;
}

const MAX_CHARS = 1000;
const DEFAULT_TEMPLATE =
  `Hi {{first_name}}, you're invited to our Tournamental pool: ` +
  `{{pool_name}}.\n\nIt's free to enter and quick - just tap the link, ` +
  `enter the code we WhatsApp you, then you're in. The pool closes ` +
  `when matches start so don't leave it.\n\n{{join_url}}\n\n` +
  `~ {{owner_name}}`;

const VAR_CHIPS = [
  { key: "first_name", label: "{{first_name}}" },
  { key: "pool_name", label: "{{pool_name}}" },
  { key: "owner_name", label: "{{owner_name}}" },
  { key: "join_url", label: "{{join_url}}" },
];

export function InviteWizard({
  slug,
  poolName,
  shareUrl,
  manageToken,
  defaultCountry = "NZ",
}: InviteWizardProps): JSX.Element {
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [csvFilename, setCsvFilename] = useState<string | null>(null);
  const [body, setBody] = useState<string>(DEFAULT_TEMPLATE);
  const [channels, setChannels] = useState<Set<Channel>>(
    () => new Set<Channel>(["whatsapp", "email"]),
  );
  const [throttleMs, setThrottleMs] = useState<number>(1000);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [recentJobs, setRecentJobs] = useState<JobStatus[]>([]);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  // ---- CSV parsing ----------------------------------------------------
  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const result = parseInviteCsv(text, { defaultCountryCode: defaultCountry });
      setParsed(result);
      setCsvFilename(file.name);
    };
    reader.onerror = () => setError("Couldn't read that file.");
    reader.readAsText(file);
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // ---- Web Contacts API ----------------------------------------------
  const hasContactsApi =
    typeof navigator !== "undefined" &&
    // @ts-expect-error - Contact Picker API is experimental
    typeof navigator.contacts?.select === "function";

  const browseContacts = async () => {
    if (!hasContactsApi) {
      setError("Contact picker isn't available on this device. Try CSV upload.");
      return;
    }
    try {
      // @ts-expect-error - Contact Picker API is experimental
      const picked = (await navigator.contacts.select(["name", "tel", "email"], {
        multiple: true,
      })) as Array<{
        name?: string[];
        tel?: string[];
        email?: string[];
      }>;
      const lines = ["first_name,email,phone"];
      for (const p of picked) {
        const name = p.name?.[0] ?? "";
        const tel = p.tel?.[0] ?? "";
        const email = p.email?.[0] ?? "";
        const firstName = name.split(/\s+/)[0] ?? "";
        const esc = (s: string) => (/[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
        lines.push([esc(firstName), esc(email), esc(tel)].join(","));
      }
      const text = lines.join("\n");
      const result = parseInviteCsv(text, { defaultCountryCode: defaultCountry });
      setParsed(result);
      setCsvFilename(`device-contacts-${picked.length}.csv`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open contacts.");
    }
  };

  // ---- Composer helpers ----------------------------------------------
  const charsUsed = body.length;
  const charsLeft = MAX_CHARS - charsUsed;
  const hasUrl = body.includes("{{join_url}}");

  const insertVar = (token: string) => {
    const el = textRef.current;
    if (!el) {
      setBody((b) => b + token);
      return;
    }
    const s = el.selectionStart ?? body.length;
    const e = el.selectionEnd ?? body.length;
    const next = body.slice(0, s) + token + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = s + token.length;
      el.setSelectionRange(pos, pos);
    });
  };

  // ---- Submit ---------------------------------------------------------
  const submit = async () => {
    if (!parsed || parsed.contacts.length === 0) {
      setError("Upload a CSV with at least one contact first.");
      return;
    }
    if (channels.size === 0) {
      setError("Pick at least one channel.");
      return;
    }
    if (body.trim().length === 0) {
      setError("The message can't be empty.");
      return;
    }
    if (body.length > MAX_CHARS) {
      setError(`Message is over ${MAX_CHARS} characters.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${manageToken}`,
        },
        body: JSON.stringify({
          message_body: body,
          channels: Array.from(channels),
          throttle_ms: throttleMs,
          contacts: parsed.contacts.map((c) => ({
            first_name: c.firstName,
            last_name: c.lastName,
            email: c.email,
            phone_e164: c.phoneE164,
          })),
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Server returned ${res.status}`);
        return;
      }
      const j = (await res.json()) as { job_id: string; total: number };
      // Start polling.
      setJob({
        job_id: j.job_id,
        status: "running",
        total: j.total,
        sent: 0,
        failed: 0,
        skipped: 0,
        channels: Array.from(channels),
        throttle_ms: throttleMs,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Job polling ----------------------------------------------------
  useEffect(() => {
    if (!job) return;
    if (job.status === "done" || job.status === "cancelled") return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/v1/syndicates/${encodeURIComponent(slug)}/invites/${encodeURIComponent(job.job_id)}`,
          {
            headers: { Authorization: `Bearer ${manageToken}` },
            cache: "no-store",
          },
        );
        if (!res.ok) return;
        const j = (await res.json()) as { job: JobStatus };
        setJob(j.job);
      } catch {
        /* swallow; next tick retries */
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [job?.job_id, job?.status, manageToken, slug]);

  // ---- Initial load of recent jobs -----------------------------------
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/invites`, {
          headers: { Authorization: `Bearer ${manageToken}` },
          cache: "no-store",
        });
        if (!res.ok) return;
        const j = (await res.json()) as { jobs: JobStatus[] };
        setRecentJobs(j.jobs);
      } catch {
        /* ignore */
      }
    })();
  }, [slug, manageToken]);

  const control = async (action: "pause" | "resume" | "cancel") => {
    if (!job) return;
    await fetch(
      `/api/v1/syndicates/${encodeURIComponent(slug)}/invites/${encodeURIComponent(job.job_id)}/control`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${manageToken}`,
        },
        body: JSON.stringify({ action }),
      },
    );
  };

  // ---- Share row ------------------------------------------------------
  const shareText = `Join our Tournamental pool ${poolName}: ${shareUrl}`;
  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  const shareNative = async () => {
    if (!canNativeShare) return;
    try {
      await navigator.share({ title: poolName, text: shareText, url: shareUrl });
    } catch {
      /* user dismissed */
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <header>
        <h2 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>
          Invite contacts
        </h2>
        <p style={{ fontSize: 13, color: "#a3a3ad", margin: "4px 0 0" }}>
          Upload a CSV of contacts (first name, email, phone). We will send
          each person a personalised invite with a one-tap join link. Their
          phone / email get pre-filled, so all they do is enter the 6-digit
          code we WhatsApp them and they are in.
        </p>
      </header>

      {/* ------- CSV upload + contacts browse + share row ------- */}
      <section
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "1fr 1fr",
        }}
      >
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          style={{
            border: "1px dashed rgba(220,169,75,0.5)",
            borderRadius: 10,
            padding: 16,
            background: "rgba(255,255,255,0.02)",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ fontSize: 13, color: "#a3a3ad" }}>
            Drop a CSV file here, or
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
            }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={btnPrimary}
            >
              Choose CSV
            </button>
            {hasContactsApi && (
              <button type="button" onClick={browseContacts} style={btnSecondary}>
                Browse device contacts
              </button>
            )}
          </div>
          <div style={{ fontSize: 12, color: "#787880" }}>
            Headers we read: first_name / email / phone (or mobile / msisdn /
            whatsapp). Headerless CSVs are read as first_name, email, phone.
          </div>
          {csvFilename && (
            <div style={{ fontSize: 12, color: "#dca94b" }}>
              Loaded {csvFilename} - {parsed?.contacts.length ?? 0} valid,{" "}
              {parsed?.skipped.length ?? 0} skipped
            </div>
          )}
        </div>

        <div
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: 16,
            background: "rgba(255,255,255,0.02)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 13, color: "#a3a3ad" }}>
            Or share the pool link directly
          </div>
          <div style={{ fontSize: 11, color: "#787880", wordBreak: "break-all" }}>
            {shareUrl}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            {canNativeShare && (
              <button type="button" onClick={shareNative} style={btnPrimary}>
                Share...
              </button>
            )}
            <a
              href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
              target="_blank"
              rel="noreferrer"
              style={btnChip}
            >
              WhatsApp
            </a>
            <a
              href={`https://www.messenger.com/new?text=${encodeURIComponent(shareText)}`}
              target="_blank"
              rel="noreferrer"
              style={btnChip}
            >
              Messenger
            </a>
            <a
              href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent("Join our pool " + poolName)}`}
              target="_blank"
              rel="noreferrer"
              style={btnChip}
            >
              Telegram
            </a>
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
              target="_blank"
              rel="noreferrer"
              style={btnChip}
            >
              X
            </a>
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== "undefined" && navigator.clipboard) {
                  void navigator.clipboard.writeText(shareUrl);
                }
              }}
              style={btnChip}
            >
              Copy link
            </button>
          </div>
        </div>
      </section>

      {/* ------- Preview ------- */}
      {parsed && (
        <section
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 10,
            padding: 12,
            background: "rgba(255,255,255,0.02)",
          }}
        >
          <div style={{ fontSize: 13, color: "#a3a3ad", marginBottom: 8 }}>
            Preview ({parsed.contacts.length} contacts)
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ textAlign: "left", color: "#a3a3ad" }}>
                  <th style={th}>#</th>
                  <th style={th}>First name</th>
                  <th style={th}>Email</th>
                  <th style={th}>Phone</th>
                </tr>
              </thead>
              <tbody>
                {parsed.contacts.slice(0, 50).map((c, i) => (
                  <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={td}>{i + 1}</td>
                    <td style={td}>{c.firstName ?? "-"}</td>
                    <td style={td}>{c.email ?? "-"}</td>
                    <td style={td}>{c.phoneE164 ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {parsed.contacts.length > 50 && (
              <p style={{ fontSize: 12, color: "#787880", marginTop: 6 }}>
                + {parsed.contacts.length - 50} more (preview capped)
              </p>
            )}
          </div>
          {parsed.skipped.length > 0 && (
            <details style={{ marginTop: 12, fontSize: 12 }}>
              <summary style={{ cursor: "pointer", color: "#e58a4b" }}>
                {parsed.skipped.length} rows skipped
              </summary>
              <ul style={{ marginTop: 6, paddingLeft: 16, color: "#a3a3ad" }}>
                {parsed.skipped.slice(0, 20).map((s, i) => (
                  <li key={i}>
                    Row {s.row}: {s.reason} - {s.raw.slice(0, 80)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* ------- Composer ------- */}
      <section
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <label style={{ fontSize: 13, color: "#a3a3ad" }}>Message</label>
          <span
            style={{
              fontSize: 12,
              color: charsLeft < 0 ? "#e26a6a" : charsLeft < 100 ? "#e58a4b" : "#787880",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {charsUsed} / {MAX_CHARS}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
          {VAR_CHIPS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => insertVar(v.label)}
              style={btnChip}
            >
              {v.label}
            </button>
          ))}
        </div>
        <textarea
          ref={textRef}
          value={body}
          onChange={(e) => setBody(e.target.value.slice(0, MAX_CHARS + 100))}
          rows={8}
          style={{
            width: "100%",
            background: "rgba(0,0,0,0.25)",
            color: "#ffffff",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: 10,
            fontFamily: "system-ui, sans-serif",
            fontSize: 14,
            resize: "vertical",
          }}
        />
        {!hasUrl && (
          <div style={{ fontSize: 12, color: "#e58a4b" }}>
            Tip: include {"{{join_url}}"} so the recipient sees the link, or
            we will append it automatically.
          </div>
        )}
      </section>

      {/* ------- Channels + throttle ------- */}
      <section style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "center" }}>
        <label style={lblToggle}>
          <input
            type="checkbox"
            checked={channels.has("whatsapp")}
            onChange={(e) => {
              setChannels((c) => {
                const next = new Set(c);
                if (e.target.checked) next.add("whatsapp");
                else next.delete("whatsapp");
                return next;
              });
            }}
          />
          <span>WhatsApp</span>
        </label>
        <label style={lblToggle}>
          <input
            type="checkbox"
            checked={channels.has("email")}
            onChange={(e) => {
              setChannels((c) => {
                const next = new Set(c);
                if (e.target.checked) next.add("email");
                else next.delete("email");
                return next;
              });
            }}
          />
          <span>Email</span>
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#a3a3ad" }}>
          Throttle
          <select
            value={throttleMs}
            onChange={(e) => setThrottleMs(Number(e.target.value))}
            style={selectBox}
          >
            <option value={2000}>1 msg / 2s (safest)</option>
            <option value={1000}>1 msg / s</option>
            <option value={500}>2 msgs / s</option>
            <option value={250}>4 msgs / s</option>
          </select>
        </label>
      </section>

      {error && <div style={errorBox}>{error}</div>}

      {/* ------- Send ------- */}
      <section style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !parsed || parsed.contacts.length === 0}
          style={{
            ...btnPrimary,
            opacity: submitting || !parsed?.contacts.length ? 0.5 : 1,
            cursor: submitting || !parsed?.contacts.length ? "not-allowed" : "pointer",
          }}
        >
          {submitting
            ? "Queuing..."
            : `Send ${parsed?.contacts.length ?? 0} invite${parsed?.contacts.length === 1 ? "" : "s"}`}
        </button>
      </section>

      {/* ------- Live job progress ------- */}
      {job && (
        <section
          style={{
            border: "1px solid rgba(220,169,75,0.3)",
            borderRadius: 10,
            padding: 12,
            background: "rgba(220,169,75,0.06)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <strong style={{ fontSize: 14 }}>
              Job {job.job_id.slice(-6)} - {job.status}
            </strong>
            <span style={{ fontSize: 13, color: "#a3a3ad" }}>
              {job.sent + job.failed + job.skipped} / {job.total}
            </span>
          </div>
          <div
            style={{
              height: 6,
              borderRadius: 4,
              background: "rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${job.total > 0 ? ((job.sent + job.failed + job.skipped) / job.total) * 100 : 0}%`,
                background: "#dca94b",
                transition: "width 0.3s ease",
              }}
            />
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 12, color: "#a3a3ad" }}>
            <span>sent: {job.sent}</span>
            <span>failed: {job.failed}</span>
            <span>skipped: {job.skipped}</span>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            {job.status === "running" && (
              <button type="button" onClick={() => control("pause")} style={btnSecondary}>
                Pause
              </button>
            )}
            {job.status === "paused" && (
              <button type="button" onClick={() => control("resume")} style={btnSecondary}>
                Resume
              </button>
            )}
            {(job.status === "running" || job.status === "paused" || job.status === "queued") && (
              <button type="button" onClick={() => control("cancel")} style={btnDanger}>
                Cancel
              </button>
            )}
          </div>
        </section>
      )}

      {/* ------- Recent jobs ------- */}
      {recentJobs.length > 0 && (
        <section style={{ fontSize: 12, color: "#a3a3ad" }}>
          <details>
            <summary style={{ cursor: "pointer" }}>
              Recent invite jobs ({recentJobs.length})
            </summary>
            <ul style={{ marginTop: 6, paddingLeft: 16 }}>
              {recentJobs.map((j) => (
                <li key={j.job_id}>
                  {new Date(j.created_at).toLocaleString()} - {j.status} -{" "}
                  {j.sent}/{j.total} sent ({j.failed} failed)
                </li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  background: "#dca94b",
  color: "#111",
  border: "none",
  borderRadius: 8,
  padding: "8px 14px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  background: "transparent",
  color: "#ffffff",
  border: "1px solid rgba(255,255,255,0.2)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
};
const btnDanger: React.CSSProperties = {
  background: "transparent",
  color: "#e26a6a",
  border: "1px solid rgba(226,106,106,0.4)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 13,
  cursor: "pointer",
};
const btnChip: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)",
  color: "#ffffff",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  fontFamily: "ui-monospace, SFMono-Regular, monospace",
  cursor: "pointer",
  textDecoration: "none",
  whiteSpace: "nowrap",
};
const lblToggle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 14,
  color: "#ffffff",
  cursor: "pointer",
};
const selectBox: React.CSSProperties = {
  background: "rgba(0,0,0,0.25)",
  color: "#ffffff",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: "4px 8px",
  fontSize: 13,
};
const errorBox: React.CSSProperties = {
  background: "rgba(226,106,106,0.1)",
  border: "1px solid rgba(226,106,106,0.4)",
  borderRadius: 8,
  padding: "8px 12px",
  fontSize: 13,
  color: "#e26a6a",
};
const th: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
const td: React.CSSProperties = {
  padding: "6px 8px",
  color: "#ffffff",
};
