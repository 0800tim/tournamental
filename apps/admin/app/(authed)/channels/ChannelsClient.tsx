"use client";

import { useState } from "react";

interface ChannelState {
  readonly available: boolean;
  readonly reason: string | null;
}

interface ChannelsResponse {
  readonly whatsapp: ChannelState;
  readonly email: ChannelState;
  readonly sms: ChannelState;
  readonly telegram: ChannelState;
}

export function ChannelsClient({
  initialState,
}: {
  initialState: ChannelsResponse | null;
}) {
  const [state, setState] = useState<ChannelsResponse | null>(initialState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonInput, setReasonInput] = useState("");

  if (!state) {
    return (
      <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 text-sm text-ink-200">
        Could not reach auth-sms. The channel state is unknown right
        now; the modal will fall back to showing every channel until
        this page can read it again.
      </div>
    );
  }

  const wa = state.whatsapp;

  const flipWhatsApp = async (next: boolean) => {
    setBusy(true);
    setError(null);
    const reason = reasonInput.trim() || (next ? "admin re-enabled" : "admin disabled");
    try {
      const r = await fetch("/api/admin/channels/whatsapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next, reason }),
      });
      const body = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        enabled?: boolean;
        reason?: string;
        error?: string;
      };
      if (!r.ok || !body.ok) {
        setError(`Flip failed: ${body.error ?? r.status}`);
        return;
      }
      setState({
        ...state,
        whatsapp: {
          available: body.enabled ?? next,
          reason: body.reason ?? reason,
        },
      });
      setReasonInput("");
    } catch (e) {
      setError(`Network error: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 flex flex-col gap-4">
      {error ? (
        <div role="alert" className="text-xs text-danger-500">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-sm text-ink-50">whatsapp</div>
          <div className="text-xs text-ink-200">
            Personal WhatsApp via Baileys. Disable before high-traffic
            moments to avoid Meta flagging the account.
          </div>
          <div className="text-xs mt-1">
            <span className={wa.available ? "text-success-500" : "text-danger-500"}>
              {wa.available ? "AVAILABLE" : "DISABLED"}
            </span>
            {wa.reason ? (
              <span className="text-ink-200"> · {wa.reason}</span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => flipWhatsApp(!wa.available)}
          disabled={busy}
          className={`px-3 py-2 rounded font-semibold text-sm ${
            wa.available
              ? "bg-danger-600 hover:bg-danger-500 text-white"
              : "bg-success-600 hover:bg-success-500 text-white"
          } disabled:opacity-50`}
        >
          {busy
            ? "Flipping..."
            : wa.available
              ? "Disable WhatsApp"
              : "Enable WhatsApp"}
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-200">
          Optional reason (logged with the flip)
        </span>
        <input
          type="text"
          value={reasonInput}
          onChange={(e) => setReasonInput(e.target.value)}
          maxLength={200}
          placeholder="e.g. TV breakfast slot 08:00-09:00"
          className="px-3 py-2 rounded bg-ink-900 ring-1 ring-ink-700 text-sm"
        />
      </label>

      <div className="text-xs text-ink-200 border-t border-ink-700 pt-3">
        <div className="font-semibold text-ink-50 mb-1">Other channels</div>
        <ul className="space-y-1">
          <li>
            email: {state.email.available ? "available" : "disabled"}
          </li>
          <li>sms: {state.sms.available ? "available" : "disabled"}</li>
          <li>
            telegram: {state.telegram.available ? "available" : "disabled"}
          </li>
        </ul>
        <div className="mt-2 italic">
          Email / SMS / Telegram aren't sender-rate-limited the same
          way and don't expose a flip yet. Add when needed.
        </div>
      </div>
    </div>
  );
}
