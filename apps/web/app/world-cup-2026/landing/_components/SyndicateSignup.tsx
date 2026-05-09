/**
 * Pre-launch syndicate signup form. POSTs to /api/syndicate/intent which
 * writes a JSON file under data/pre-signups/ for now (gitignored). When
 * the apps/api service ships, swap the endpoint to forward to it.
 *
 * Country picker: dropdown of WC2026 country codes (good enough to
 * group "office in Argentina" / "office in Australia" etc.).
 */

"use client";

import { useState, useMemo, type FormEvent } from "react";

import { allTeams } from "../_lib/groups";

type Status = "idle" | "submitting" | "success" | "error";

const SYNDICATE_KINDS = [
  { value: "friends", icon: "🍕", label: "Friends", help: "Mates' chat group, family group, your fantasy crew." },
  { value: "office", icon: "🏢", label: "Office", help: "Office sweepstakes — every desk picks a country." },
  { value: "public", icon: "🌍", label: "Public", help: "Anyone-can-join pool. Promote on socials." },
] as const;

type SyndicateKind = typeof SYNDICATE_KINDS[number]["value"];

export function SyndicateSignup({ defaultCountry }: { defaultCountry?: string }) {
  const teams = useMemo(() => allTeams(), []);
  const [kind, setKind] = useState<SyndicateKind>("friends");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string>("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Capture the form node up-front — React releases `e.currentTarget`
    // after the handler returns, so we can't rely on it after `await`.
    const formEl = e.currentTarget;
    setStatus("submitting");
    setMessage("");

    const fd = new FormData(formEl);
    const payload = {
      kind,
      syndicate_name: String(fd.get("syndicate_name") ?? "").trim(),
      your_name: String(fd.get("your_name") ?? "").trim(),
      email: String(fd.get("email") ?? "").trim(),
      telegram: String(fd.get("telegram") ?? "").trim() || null,
      country: String(fd.get("country") ?? "").trim(),
    };

    try {
      const res = await fetch("/api/syndicate/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? `HTTP ${res.status}`);
      }
      setStatus("success");
      setMessage(
        "You're in. We'll email an invite link before kickoff so you can rally your group.",
      );
      formEl.reset();
    } catch (err) {
      setStatus("error");
      setMessage(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  return (
    <div>
      <div className="wc-syn-cards" role="radiogroup" aria-label="Syndicate type">
        {SYNDICATE_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            className="wc-syn-card"
            data-kind={k.value}
            role="radio"
            aria-checked={kind === k.value}
            onClick={() => setKind(k.value)}
            style={{
              cursor: "pointer",
              borderColor: kind === k.value ? "var(--wc-amber)" : undefined,
              boxShadow: kind === k.value ? "0 0 0 2px rgba(251,191,36,0.18)" : undefined,
            }}
          >
            <span className="wc-syn-icon" aria-hidden="true">{k.icon}</span>
            <h3>{k.label}</h3>
            <p>{k.help}</p>
          </button>
        ))}
      </div>

      <form
        className="wc-form"
        onSubmit={onSubmit}
        data-testid="wc-syndicate-form"
        noValidate
      >
        <input type="hidden" name="kind" value={kind} />

        <div className="wc-form-row">
          <label htmlFor="syn-name">Syndicate name</label>
          <input
            id="syn-name"
            name="syndicate_name"
            placeholder="Mum's Fantasy Crew, Floor 3 Office Pool, …"
            required
            minLength={2}
            maxLength={80}
          />
        </div>

        <div className="wc-form-row-grid">
          <div className="wc-form-row">
            <label htmlFor="syn-your-name">Your name</label>
            <input
              id="syn-your-name"
              name="your_name"
              placeholder="Tim"
              required
              minLength={1}
              maxLength={80}
            />
          </div>
          <div className="wc-form-row">
            <label htmlFor="syn-email">Email</label>
            <input
              id="syn-email"
              type="email"
              name="email"
              placeholder="you@example.com"
              required
              maxLength={200}
            />
          </div>
        </div>

        <div className="wc-form-row-grid">
          <div className="wc-form-row">
            <label htmlFor="syn-telegram">Telegram (optional)</label>
            <input
              id="syn-telegram"
              name="telegram"
              placeholder="@your_handle"
              maxLength={64}
            />
          </div>
          <div className="wc-form-row">
            <label htmlFor="syn-country">Country</label>
            <select
              id="syn-country"
              name="country"
              defaultValue={defaultCountry ?? "NZL"}
            >
              {teams.map((t) => (
                <option key={t.code} value={t.code}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="submit"
          className="wc-btn wc-btn-primary"
          disabled={status === "submitting"}
          data-testid="wc-syndicate-submit"
        >
          {status === "submitting" ? "Reserving…" : "Reserve my syndicate"}
        </button>

        {status !== "idle" && status !== "submitting" && message && (
          <div
            className="wc-form-status"
            data-status={status}
            data-testid="wc-syndicate-status"
            role="status"
          >
            {message}
          </div>
        )}
      </form>
    </div>
  );
}
