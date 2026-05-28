/**
 * Broadcast client UI.
 *
 * Three columns on wide screens, stacked on mobile:
 *   1. Pool picker (search + multi-select with select-all-by-filter)
 *   2. Playbook picker / custom-body editor
 *   3. Preview pane (calls the API in dry-run mode after each
 *      meaningful change, debounced)
 *
 * The confirm flow:
 *   - "Send for real" toggle (off by default).
 *   - Submit button label + colour reflect dry-run vs live.
 *   - Live submit pops <ConfirmDialog> with a typed-confirm phrase.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import type {
  BroadcastChannel,
  PlaybookTemplate,
  RenderedBroadcast,
} from "@/lib/broadcast";

export interface PoolSummary {
  slug: string;
  name: string;
  members: number;
  isPublic: boolean;
  ownerHandle: string | null;
  tier: string;
}

interface PlaybookForClient {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
  defaultChannels: BroadcastChannel[];
  body: string;
}

export interface BroadcastClientProps {
  pools: PoolSummary[];
  playbooks: PlaybookForClient[] | PlaybookTemplate[];
}

interface DryRunResponse {
  dryRun: true;
  count: number;
  messages: RenderedBroadcast[];
  missing: string[];
}

interface LiveResponse {
  dryRun: false;
  count: number;
  results: {
    slug: string;
    channel: BroadcastChannel;
    status: "sent" | "skipped" | "failed" | "not_implemented_yet";
    reason?: string;
  }[];
  missing: string[];
  notice?: string;
}

const SOURCE_TEMPLATE = "template" as const;
const SOURCE_CUSTOM = "custom" as const;
type Source = typeof SOURCE_TEMPLATE | typeof SOURCE_CUSTOM;

export function BroadcastClient({ pools, playbooks }: BroadcastClientProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const recommended = playbooks.find((p) => p.recommended) ?? playbooks[0];
  const [source, setSource] = useState<Source>(
    playbooks.length > 0 ? SOURCE_TEMPLATE : SOURCE_CUSTOM,
  );
  const [templateId, setTemplateId] = useState<string>(
    recommended?.id ?? "",
  );
  const [customBody, setCustomBody] = useState<string>("");
  const [channels, setChannels] = useState<Set<BroadcastChannel>>(
    new Set(recommended?.defaultChannels ?? (["whatsapp"] as BroadcastChannel[])),
  );

  const [sendForReal, setSendForReal] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<DryRunResponse | null>(null);
  const [liveResult, setLiveResult] = useState<LiveResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filteredPools = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return pools;
    return pools.filter(
      (p) =>
        p.name.toLowerCase().includes(term) ||
        p.slug.toLowerCase().includes(term) ||
        (p.ownerHandle ?? "").toLowerCase().includes(term),
    );
  }, [pools, search]);

  const togglePool = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };
  const selectAllFiltered = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of filteredPools) next.add(p.slug);
      return next;
    });
  };
  const clearSelected = () => setSelected(new Set());

  const toggleChannel = (c: BroadcastChannel) => {
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  const buildPayload = useCallback(
    (dryRun: boolean) => ({
      slugs: Array.from(selected),
      templateId: source === SOURCE_TEMPLATE ? templateId : undefined,
      customBody: source === SOURCE_CUSTOM ? customBody : undefined,
      channels: Array.from(channels),
      dryRun,
    }),
    [selected, source, templateId, customBody, channels],
  );

  // Debounced dry-run preview. Refires when any input changes.
  useEffect(() => {
    if (selected.size === 0 || channels.size === 0) {
      setPreview(null);
      return;
    }
    if (source === SOURCE_TEMPLATE && !templateId) {
      setPreview(null);
      return;
    }
    if (source === SOURCE_CUSTOM && customBody.trim().length === 0) {
      setPreview(null);
      return;
    }
    const handle = setTimeout(async () => {
      setError(null);
      try {
        const r = await fetch("/api/admin/broadcast", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildPayload(true)),
        });
        if (!r.ok) {
          const j = (await r.json().catch(() => ({}))) as { error?: string };
          setPreview(null);
          setError(j.error ?? `HTTP ${r.status}`);
          return;
        }
        const data = (await r.json()) as DryRunResponse;
        setPreview(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "request failed");
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [buildPayload, selected.size, channels.size, source, templateId, customBody]);

  const onSubmit = async () => {
    if (!sendForReal) {
      // Just refresh the preview; nothing to send.
      return;
    }
    setConfirmOpen(true);
  };

  const doLiveSend = async () => {
    setBusy(true);
    setError(null);
    setLiveResult(null);
    try {
      const r = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(false)),
      });
      const j = (await r.json()) as LiveResponse | { error: string };
      if (!r.ok) {
        setError((j as { error: string }).error ?? `HTTP ${r.status}`);
      } else {
        setLiveResult(j as LiveResponse);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "request failed");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };

  const canSubmit =
    selected.size > 0 &&
    channels.size > 0 &&
    ((source === SOURCE_TEMPLATE && templateId.length > 0) ||
      (source === SOURCE_CUSTOM && customBody.trim().length > 0));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {/* ---------------- Column 1: pool picker ---------------- */}
      <section
        aria-label="Pool picker"
        className="rounded-lg ring-1 ring-ink-700 bg-ink-800 flex flex-col"
      >
        <header className="px-4 py-3 border-b border-ink-700 flex items-center justify-between">
          <h2 className="text-sm uppercase tracking-wider text-ink-200">
            Pools ({selected.size} / {pools.length})
          </h2>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={selectAllFiltered}
              className="text-accent-400 hover:underline"
            >
              Select filtered
            </button>
            <button
              type="button"
              onClick={clearSelected}
              className="text-ink-200 hover:text-ink-50"
            >
              Clear
            </button>
          </div>
        </header>
        <div className="p-3 border-b border-ink-700">
          <input
            type="search"
            placeholder="Search name / slug / owner"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-ink-900 border border-ink-700 rounded px-2 py-1.5 text-sm text-ink-50 focus:outline-none focus:ring-2 focus:ring-accent-500"
          />
        </div>
        <ul className="overflow-y-auto max-h-[60vh] divide-y divide-ink-700">
          {filteredPools.map((p) => {
            const isOn = selected.has(p.slug);
            return (
              <li key={p.slug}>
                <label className="flex items-start gap-3 px-4 py-2 cursor-pointer hover:bg-ink-700/40">
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={() => togglePool(p.slug)}
                    className="mt-1 accent-accent-500"
                    aria-label={`Select ${p.name}`}
                  />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink-50 truncate">
                      {p.name}
                    </span>
                    <span className="block text-xs text-ink-200">
                      <span className="font-mono">{p.slug}</span>
                      {" · "}
                      {p.members} member{p.members === 1 ? "" : "s"}
                      {p.ownerHandle ? ` · ${p.ownerHandle}` : ""}
                      {" · "}
                      <span
                        className={
                          p.isPublic ? "text-accent-400" : "text-ink-500"
                        }
                      >
                        {p.isPublic ? "public" : "private"}
                      </span>
                    </span>
                  </span>
                </label>
              </li>
            );
          })}
          {filteredPools.length === 0 && (
            <li className="px-4 py-6 text-sm text-ink-500 text-center">
              No pools match the search.
            </li>
          )}
        </ul>
      </section>

      {/* ---------------- Column 2: template + channels ---------------- */}
      <section
        aria-label="Message composer"
        className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 flex flex-col gap-4"
      >
        <div>
          <h2 className="text-sm uppercase tracking-wider text-ink-200 mb-2">
            Message source
          </h2>
          <div className="flex gap-2 text-sm">
            <button
              type="button"
              onClick={() => setSource(SOURCE_TEMPLATE)}
              disabled={playbooks.length === 0}
              className={`px-3 py-1.5 rounded text-sm ${
                source === SOURCE_TEMPLATE
                  ? "bg-accent-600 text-ink-50"
                  : "bg-ink-700 text-ink-200 hover:bg-ink-600"
              } disabled:opacity-40`}
            >
              Playbook
            </button>
            <button
              type="button"
              onClick={() => setSource(SOURCE_CUSTOM)}
              className={`px-3 py-1.5 rounded text-sm ${
                source === SOURCE_CUSTOM
                  ? "bg-accent-600 text-ink-50"
                  : "bg-ink-700 text-ink-200 hover:bg-ink-600"
              }`}
            >
              Custom markdown
            </button>
          </div>
        </div>

        {source === SOURCE_TEMPLATE && (
          <div className="flex flex-col gap-2">
            {playbooks.length === 0 && (
              <p className="text-xs text-ink-500">
                No playbooks found in data/playbooks/.
              </p>
            )}
            {playbooks.map((p) => {
              const on = templateId === p.id;
              return (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setTemplateId(p.id)}
                  className={`text-left rounded p-3 ring-1 transition-colors ${
                    on
                      ? "bg-accent-700/30 ring-accent-500"
                      : "bg-ink-900/60 ring-ink-700 hover:ring-ink-500"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-ink-50">{p.name}</span>
                    {p.recommended && (
                      <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-accent-600/30 text-accent-400">
                        recommended
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-200 mt-1">{p.description}</p>
                  <p className="text-[10px] uppercase tracking-wider text-ink-500 mt-1">
                    Default channels:{" "}
                    {p.defaultChannels.join(", ")}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {source === SOURCE_CUSTOM && (
          <div>
            <label
              htmlFor="custom-body"
              className="block text-xs uppercase tracking-wider text-ink-200 mb-1"
            >
              Markdown body
            </label>
            <textarea
              id="custom-body"
              rows={12}
              value={customBody}
              onChange={(e) => setCustomBody(e.target.value)}
              placeholder={`Hi {{owner_handle}},\n\nYour pool {{pool_name}} for {{tournament}} ...`}
              className="w-full bg-ink-900 border border-ink-700 rounded p-2 text-sm text-ink-50 font-mono focus:outline-none focus:ring-2 focus:ring-accent-500"
            />
            <p className="text-[10px] uppercase tracking-wider text-ink-500 mt-1">
              Variables: {"{{pool_name}}"}, {"{{owner_handle}}"},{" "}
              {"{{tournament}}"}, {"{{member_count}}"}
            </p>
          </div>
        )}

        <div>
          <h2 className="text-sm uppercase tracking-wider text-ink-200 mb-2">
            Channels
          </h2>
          <div className="flex gap-3 text-sm">
            {(["whatsapp", "email"] as const).map((c) => {
              const on = channels.has(c);
              return (
                <label
                  key={c}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded cursor-pointer ring-1 ${
                    on
                      ? "bg-accent-700/30 ring-accent-500 text-ink-50"
                      : "bg-ink-900/60 ring-ink-700 text-ink-200 hover:ring-ink-500"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleChannel(c)}
                    className="accent-accent-500"
                  />
                  <span className="capitalize">{c}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="border-t border-ink-700 pt-4 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={sendForReal}
              onChange={(e) => setSendForReal(e.target.checked)}
              className="accent-danger-500"
            />
            <span className={sendForReal ? "text-danger-400" : "text-ink-200"}>
              Send for real (otherwise dry-run only)
            </span>
          </label>
          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={onSubmit}
            className={`px-4 py-1.5 rounded text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed ${
              sendForReal
                ? "bg-danger-600 hover:bg-danger-500 text-ink-50"
                : "bg-accent-600 hover:bg-accent-500 text-ink-50"
            }`}
          >
            {busy ? "Working..." : sendForReal ? "Send broadcast" : "Refresh preview"}
          </button>
        </div>
      </section>

      {/* ---------------- Column 3: preview / result ---------------- */}
      <section
        aria-label="Preview"
        className="rounded-lg ring-1 ring-ink-700 bg-ink-800 p-4 flex flex-col gap-3 max-h-[80vh] overflow-y-auto"
      >
        <h2 className="text-sm uppercase tracking-wider text-ink-200">
          {liveResult ? "Send result" : "Preview (dry-run)"}
        </h2>

        {error && (
          <p
            role="alert"
            className="text-xs text-danger-400 bg-danger-600/10 ring-1 ring-danger-600/40 rounded p-2"
          >
            Error: {error}
          </p>
        )}

        {liveResult && (
          <div className="text-xs space-y-2">
            {liveResult.notice && (
              <p className="text-amber-300 bg-amber-600/10 ring-1 ring-amber-600/40 rounded p-2">
                {liveResult.notice}
              </p>
            )}
            <p className="text-ink-200">
              {liveResult.count} message(s) processed.
            </p>
            <ul className="divide-y divide-ink-700 ring-1 ring-ink-700 rounded">
              {liveResult.results.map((r, i) => (
                <li key={`${r.slug}-${r.channel}-${i}`} className="px-3 py-2">
                  <span className="font-mono text-ink-200">{r.slug}</span>
                  {" · "}
                  <span className="capitalize">{r.channel}</span>
                  {" · "}
                  <span
                    className={
                      r.status === "sent"
                        ? "text-accent-400"
                        : r.status === "skipped"
                          ? "text-ink-500"
                          : "text-amber-300"
                    }
                  >
                    {r.status}
                  </span>
                  {r.reason && (
                    <span className="text-ink-500"> ({r.reason})</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {!liveResult && !preview && !error && (
          <p className="text-xs text-ink-500">
            Pick at least one pool, a template (or write a custom body), and
            one channel to see a preview.
          </p>
        )}

        {!liveResult && preview && (
          <div className="text-xs space-y-3">
            <p className="text-ink-200">
              {preview.count} message(s) ready. Nothing will send until you
              tick "Send for real" and confirm.
            </p>
            {preview.missing.length > 0 && (
              <p className="text-amber-300">
                Missing pools (skipped): {preview.missing.join(", ")}
              </p>
            )}
            {preview.messages.map((m) => (
              <article
                key={m.slug}
                className="ring-1 ring-ink-700 rounded p-3 bg-ink-900/50"
              >
                <header className="flex items-baseline justify-between mb-2">
                  <span className="text-ink-50 text-sm">{m.poolName}</span>
                  <span className="text-[10px] uppercase tracking-wider text-ink-500">
                    {m.channels.join(", ") || "no channel"}
                  </span>
                </header>
                {m.skippedChannels.length > 0 && (
                  <p className="text-[10px] text-amber-300 mb-1">
                    Cannot send:{" "}
                    {m.skippedChannels
                      .map((s) => `${s.channel} (${s.reason})`)
                      .join(", ")}
                  </p>
                )}
                <p className="text-[10px] uppercase tracking-wider text-ink-500 mb-1">
                  Subject: <span className="normal-case text-ink-200">{m.subject}</span>
                </p>
                <pre className="whitespace-pre-wrap text-ink-100 font-mono text-[11px] leading-relaxed">
                  {m.body}
                </pre>
              </article>
            ))}
          </div>
        )}
      </section>

      {confirmOpen && (
        <ConfirmDialog
          title="Send broadcast for real?"
          body={`This will attempt to deliver ${selected.size} message(s) across ${channels.size} channel(s). Audit entries are written either way.\n\nHeads-up: live send is currently a no-op (auth-sms has no broadcast endpoint yet). Each recipient will be audited as not_implemented_yet.`}
          confirmPhrase="SEND"
          confirmLabel="Send broadcast"
          destructive
          onConfirm={doLiveSend}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
