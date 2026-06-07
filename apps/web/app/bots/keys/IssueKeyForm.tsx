"use client";

/**
 * /bots/keys, the client-side issuance form.
 *
 * Posts to /api/v1/bots/keys (which proxies to the game-service
 * /v1/bots/keys/issue endpoint with the session-resolved email).
 *
 * The plaintext key is shown ONCE on the response screen. The server
 * only persists the SHA-256 hash, so if the user navigates away
 * without copying the key, the only recourse is to issue a new one
 * and revoke the old.
 */

import { useState, type FormEvent } from "react";

interface IssueResponse {
  readonly api_key?: string;
  readonly key_id?: string;
  readonly label?: string;
  readonly created_at?: string;
  readonly error?: string;
}

export function IssueKeyForm(): JSX.Element {
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [response, setResponse] = useState<IssueResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!label.trim()) return;
    setSubmitting(true);
    setResponse(null);
    setCopied(false);
    try {
      const res = await fetch("/api/v1/bots/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim() }),
      });
      const data = (await res.json()) as IssueResponse;
      if (!res.ok) {
        setResponse({ error: data.error ?? `Server returned ${res.status}` });
      } else {
        setResponse(data);
      }
    } catch (err) {
      setResponse({
        error: err instanceof Error ? err.message : "Network error",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const copyKey = async () => {
    if (!response?.api_key) return;
    try {
      await navigator.clipboard.writeText(response.api_key);
      setCopied(true);
    } catch {
      /* clipboard blocked; user can select + copy manually */
    }
  };

  return (
    <section className="vt-keys-form-card" aria-label="Issue a new API key">
      <form className="vt-keys-form" onSubmit={submit}>
        <label className="vt-keys-label" htmlFor="bot-key-label">
          Label
          <span className="vt-keys-hint">
            A short name so you can tell your keys apart later. e.g.
            <em>chalk-swarm-01</em>, <em>claude-bot-prod</em>.
          </span>
        </label>
        <input
          id="bot-key-label"
          name="label"
          type="text"
          required
          maxLength={64}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="my-first-swarm"
          autoComplete="off"
          className="vt-keys-input"
          disabled={submitting}
        />
        <button
          type="submit"
          className="vt-keys-submit"
          disabled={submitting || !label.trim()}
        >
          {submitting ? "Issuing..." : "Issue key"}
        </button>
      </form>

      {response?.error && (
        <p role="alert" className="vt-keys-error">
          {response.error}
        </p>
      )}

      {response?.api_key && (
        <div className="vt-keys-result" role="status" aria-live="polite">
          <p className="vt-keys-result-headline">
            <strong>Copy this key now.</strong> Tournamental stores only
            the hash; we can&apos;t show it again.
          </p>
          <div className="vt-keys-result-row">
            <code className="vt-keys-result-key">{response.api_key}</code>
            <button
              type="button"
              className="vt-keys-copy"
              onClick={copyKey}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {response.label && (
            <p className="vt-keys-result-meta">
              Labelled <em>{response.label}</em>. Set{" "}
              <code>TOURNAMENTAL_API_KEY</code> in your <code>.env</code>{" "}
              and you&apos;re ready to call the SDK.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
