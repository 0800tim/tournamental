"use client";

/**
 * <ApiKeysPage/> , the user-facing self-service API-key flow at
 * /profile/api-keys.
 *
 * Lifecycle:
 *   - Mount: wait for `useUser()` to resolve. If guest, show the
 *     SignupModal trigger and a one-line pitch. If authenticated,
 *     fetch the user's keys via the game-service.
 *   - Mint: POST /v1/me/api-keys, store the plaintext key in a local
 *     state slot so we can render it ONCE. The plaintext is cleared
 *     when the user dismisses the banner or navigates away (we
 *     deliberately do not persist it to localStorage).
 *   - Revoke / regenerate: hit the game-service, then refetch the list.
 *
 * Security invariants:
 *   - Plaintext keys are NEVER stored in localStorage / sessionStorage.
 *     They live in React state and a copy buffer only.
 *   - Plaintext keys are NEVER logged or sent to any analytics surface.
 *   - The keys table response omits `key_hash`; the page never even
 *     receives it.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { browserClient } from "@/lib/auth/supabase";
import { useUser } from "@/lib/auth/useUser";
import {
  listApiKeys,
  mintApiKey,
  regenerateApiKey,
  revokeApiKey,
  ALL_SCOPES,
  type MintedUserApiKey,
  type PublicUserApiKey,
} from "@/lib/api-keys/client";
import { SignupModal } from "./SignupModal";

type Tab = "curl" | "fetch" | "mcp";

export function ApiKeysPage() {
  const { status, user, loading } = useUser();
  const [showSignup, setShowSignup] = useState(false);

  if (loading) {
    return (
      <section className="vt-section">
        <h2 className="vt-section-title">Personal API keys</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>Loading…</p>
      </section>
    );
  }

  if (status === "guest" || status === "unconfigured") {
    return (
      <>
        <section className="vt-section">
          <h2 className="vt-section-title">Personal API keys</h2>
          <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
            Sign in to mint a personal key for the Tournamental REST API
            and the MCP server.
          </p>
          <button
            type="button"
            onClick={() => setShowSignup(true)}
            style={signInButtonStyle}
          >
            Sign In/Up
          </button>
        </section>
        <SignupModal open={showSignup} onClose={() => setShowSignup(false)} />
      </>
    );
  }

  if (!user) {
    return (
      <section className="vt-section">
        <h2 className="vt-section-title">Personal API keys</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
          We couldn&apos;t resolve your session. Try refreshing the page.
        </p>
      </section>
    );
  }

  return <ApiKeysEditor />;
}

function ApiKeysEditor() {
  const [keys, setKeys] = useState<readonly PublicUserApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [scopes, setScopes] = useState<readonly string[]>(ALL_SCOPES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fresh, setFresh] = useState<MintedUserApiKey | null>(null);
  const [tab, setTab] = useState<Tab>("curl");

  const refresh = useCallback(async () => {
    const sb = browserClient();
    if (!sb) return;
    const out = await listApiKeys(sb);
    if (out.ok) {
      setKeys(out.data);
      setError(null);
    } else {
      setError(humanize(out.code));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Clear the plaintext from memory when the user leaves the tab. This
  // is best-effort , the React state is already in-memory only, but
  // wiping the variable on `pagehide` cuts the window where a heap
  // dump or extension could read it.
  useEffect(() => {
    const onHide = () => setFresh(null);
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  const handleMint = async () => {
    const sb = browserClient();
    // Tim 2026-06-07 evening: silent exit was eating the failure when
    // Supabase env is not configured (vtorn-dev signs you in via SMS
    // OTP / Telegram, not Supabase). Surface it so the user sees
    // something instead of a dead button.
    if (!sb) {
      setError(
        "Supabase auth client is not initialised on this build. Try the new self-serve flow at /bots/keys instead, or ask Tim to set NEXT_PUBLIC_SUPABASE_URL on this environment.",
      );
      return;
    }
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Give your key a label so you can identify it later.");
      return;
    }
    setBusy(true);
    setError(null);
    const out = await mintApiKey(sb, { label: trimmed, scopes });
    setBusy(false);
    if (!out.ok) {
      setError(humanize(out.code, out.message));
      return;
    }
    setFresh(out.data);
    setLabel("");
    void refresh();
  };

  const handleRevoke = async (id: string) => {
    const sb = browserClient();
    if (!sb) return;
    setBusy(true);
    setError(null);
    const out = await revokeApiKey(sb, id);
    setBusy(false);
    if (!out.ok) {
      setError(humanize(out.code));
      return;
    }
    void refresh();
  };

  const handleRegenerate = async (id: string) => {
    const sb = browserClient();
    if (!sb) return;
    setBusy(true);
    setError(null);
    const out = await regenerateApiKey(sb, id);
    setBusy(false);
    if (!out.ok) {
      setError(humanize(out.code));
      return;
    }
    setFresh(out.data);
    void refresh();
  };

  const sampleKey = fresh?.key ?? "<your-key>";

  const codeSample = useMemo(() => {
    if (tab === "curl") return curlSnippet(sampleKey);
    if (tab === "fetch") return fetchSnippet(sampleKey);
    return mcpSnippet(sampleKey);
  }, [tab, sampleKey]);

  return (
    <>
      <section className="vt-section">
        <h2 className="vt-section-title">Personal API keys</h2>
        <p style={{ color: "var(--vt-fg-muted)", margin: 0, fontSize: 14 }}>
          Use these keys to authenticate writes to the Tournamental REST API
          and to act as a user-tier key against our MCP server. Every key is
          scoped to your account. We never show the plaintext after creation,
          so save it the moment you mint it.
        </p>
      </section>

      {fresh && <FreshKeyBanner minted={fresh} onDismiss={() => setFresh(null)} />}

      {error && (
        <section className="vt-section" role="alert" aria-live="polite">
          <p style={{ margin: 0, color: "#ff8888", fontSize: 14 }}>{error}</p>
        </section>
      )}

      <section className="vt-section">
        <h2 className="vt-section-title">Generate a new key</h2>
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            fontSize: 13,
            color: "var(--vt-fg-muted)",
          }}
        >
          Label
          <input
            className="auth-input"
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Claude Desktop , laptop"
            maxLength={80}
            disabled={busy}
          />
        </label>
        <fieldset
          style={{
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 10,
            padding: "10px 14px",
            margin: 0,
          }}
        >
          <legend style={{ fontSize: 12, color: "var(--vt-fg-muted)" }}>
            Scopes
          </legend>
          {ALL_SCOPES.map((s) => {
            const on = scopes.includes(s);
            return (
              <label
                key={s}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  padding: "4px 0",
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={busy}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setScopes((prev) => (prev.includes(s) ? prev : [...prev, s]));
                    } else {
                      setScopes((prev) => prev.filter((x) => x !== s));
                    }
                  }}
                />
                <code style={{ fontSize: 13 }}>{s}</code>
              </label>
            );
          })}
        </fieldset>
        <button
          type="button"
          onClick={() => void handleMint()}
          disabled={busy || !label.trim()}
          style={primaryButtonStyle}
        >
          {busy ? "Generating…" : "Generate key"}
        </button>
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">Your keys</h2>
        {loading ? (
          <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>Loading…</p>
        ) : keys.length === 0 ? (
          <p style={{ color: "var(--vt-fg-muted)", margin: 0 }}>
            You haven&apos;t minted any keys yet.
          </p>
        ) : (
          <KeysTable
            keys={keys}
            busy={busy}
            onRevoke={handleRevoke}
            onRegenerate={handleRegenerate}
          />
        )}
      </section>

      <section className="vt-section">
        <h2 className="vt-section-title">Code samples</h2>
        <div role="tablist" style={{ display: "flex", gap: 8 }}>
          {(["curl", "fetch", "mcp"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                ...tabButtonStyle,
                background:
                  tab === t ? "var(--vt-accent)" : "rgba(255,255,255,0.06)",
                color: tab === t ? "var(--vt-accent-on)" : "var(--vt-fg)",
              }}
            >
              {t === "mcp" ? "MCP config" : t}
            </button>
          ))}
        </div>
        <pre
          style={{
            margin: 0,
            padding: 16,
            background: "rgba(0,0,0,0.4)",
            borderRadius: 10,
            color: "var(--vt-fg)",
            fontSize: 12,
            overflowX: "auto",
            whiteSpace: "pre-wrap",
          }}
        >
          <code>{codeSample}</code>
        </pre>
      </section>

      <section className="vt-section">
        <p style={{ color: "var(--vt-fg-muted)", fontSize: 13, margin: 0 }}>
          More: <a href="https://tournamental.com/engineering">build on Tournamental</a>
          {" · "}<a href="/docs/53-mcp-server">MCP server (docs/53)</a>
          {" · "}<a href="https://tournamental.com/api">API portal</a>
        </p>
      </section>
    </>
  );
}

function FreshKeyBanner({
  minted,
  onDismiss,
}: {
  minted: MintedUserApiKey;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(minted.key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard rejected , user can still copy by hand from the text.
    }
  };
  return (
    <section
      className="vt-section"
      style={{
        border: "1px solid var(--vt-accent)",
        background: "rgba(60, 220, 160, 0.06)",
        borderRadius: 10,
      }}
    >
      <h2 className="vt-section-title" style={{ color: "var(--vt-accent)" }}>
        Copy this now. We will never show it again.
      </h2>
      <p style={{ color: "var(--vt-fg-muted)", margin: 0, fontSize: 13 }}>
        Label: <strong>{minted.label}</strong> · prefix{" "}
        <code>{minted.prefix}</code>
      </p>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <code
          style={{
            flex: "1 1 auto",
            padding: "10px 12px",
            background: "rgba(0,0,0,0.5)",
            borderRadius: 8,
            fontSize: 13,
            wordBreak: "break-all",
          }}
        >
          {minted.key}
        </code>
        <button type="button" onClick={() => void copy()} style={primaryButtonStyle}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={onDismiss} style={ghostButtonStyle}>
          Dismiss
        </button>
      </div>
    </section>
  );
}

function KeysTable({
  keys,
  busy,
  onRevoke,
  onRegenerate,
}: {
  keys: readonly PublicUserApiKey[];
  busy: boolean;
  onRevoke: (id: string) => void;
  onRegenerate: (id: string) => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--vt-fg-muted)" }}>
            <th style={thStyle}>Label</th>
            <th style={thStyle}>Prefix</th>
            <th style={thStyle}>Created</th>
            <th style={thStyle}>Last used</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr
              key={k.id}
              style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}
            >
              <td style={tdStyle}>{k.label}</td>
              <td style={{ ...tdStyle, fontFamily: "monospace", fontSize: 12 }}>
                {k.prefix}…
              </td>
              <td style={tdStyle}>
                {new Date(k.created_at).toLocaleDateString()}
              </td>
              <td style={tdStyle}>
                {k.last_used_at
                  ? new Date(k.last_used_at).toLocaleDateString()
                  : "—"}
              </td>
              <td style={tdStyle}>
                <span
                  style={{
                    color:
                      k.status === "active" ? "var(--vt-accent)" : "#ff8888",
                    fontWeight: 600,
                  }}
                >
                  {k.status}
                </span>
              </td>
              <td style={tdStyle}>
                {k.status === "active" ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRegenerate(k.id)}
                      style={smallButtonStyle}
                    >
                      Regenerate
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRevoke(k.id)}
                      style={{
                        ...smallButtonStyle,
                        color: "#ff8888",
                        borderColor: "rgba(255,136,136,0.4)",
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                ) : (
                  <span style={{ color: "var(--vt-fg-muted)" }}>—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- code samples ----------

function curlSnippet(key: string): string {
  return `curl https://tournamental.com/api/v1/bracket/submit \\
  -H "Authorization: Bearer ${key}" \\
  -H "content-type: application/json" \\
  -d '{ "tournament_id": "fifa-wc-2026", "user_id": "<your-user-id>", "bracket": {...} }'`;
}

function fetchSnippet(key: string): string {
  return `// Browser fetch , the same shape works from a Next.js route handler.
const res = await fetch("https://tournamental.com/api/v1/bracket/submit", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: "Bearer ${key}",
  },
  body: JSON.stringify({
    tournament_id: "fifa-wc-2026",
    user_id: "<your-user-id>",
    bracket: { /* ... */ },
  }),
});`;
}

function mcpSnippet(key: string): string {
  return `// ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "tournamental": {
      "command": "npx",
      "args": ["-y", "@tournamental/mcp"],
      "env": {
        "TOURNAMENTAL_USER_KEY": "${key}"
      }
    }
  }
}`;
}

// ---------- styles ----------

const signInButtonStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "10px 16px",
  borderRadius: 999,
  background: "var(--vt-accent)",
  color: "var(--vt-accent-on)",
  fontWeight: 700,
  border: 0,
  cursor: "pointer",
  fontSize: 14,
};

const primaryButtonStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "10px 16px",
  borderRadius: 8,
  background: "var(--vt-accent)",
  color: "var(--vt-accent-on)",
  fontWeight: 600,
  border: 0,
  cursor: "pointer",
  fontSize: 14,
};

const ghostButtonStyle: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  background: "rgba(255,255,255,0.06)",
  color: "var(--vt-fg)",
  fontWeight: 500,
  border: "1px solid rgba(255,255,255,0.12)",
  cursor: "pointer",
  fontSize: 14,
};

const smallButtonStyle: React.CSSProperties = {
  padding: "4px 10px",
  borderRadius: 6,
  background: "rgba(255,255,255,0.06)",
  color: "var(--vt-fg)",
  fontWeight: 500,
  border: "1px solid rgba(255,255,255,0.12)",
  cursor: "pointer",
  fontSize: 12,
};

const tabButtonStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: 999,
  fontWeight: 600,
  border: 0,
  cursor: "pointer",
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  padding: "8px 10px",
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  fontWeight: 600,
};

const tdStyle: React.CSSProperties = {
  padding: "10px",
  verticalAlign: "middle",
};

// ---------- helpers ----------

function humanize(code: string, message?: string): string {
  if (message) return message;
  switch (code) {
    case "no_session":
      return "Your session expired. Sign in again to manage keys.";
    case "invalid_label":
      return "Please give your key a label.";
    case "invalid_scopes":
      return "Pick at least one valid scope.";
    case "too_many_keys":
      return "You have hit the 25-key limit. Revoke an unused one first.";
    case "network_error":
      return "Couldn't reach the API. Check your connection and retry.";
    default:
      return `Something went wrong (${code}). Please try again.`;
  }
}
