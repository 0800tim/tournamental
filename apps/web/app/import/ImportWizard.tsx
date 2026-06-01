"use client";

/**
 * Client island for the bracket-import wizard. Three steps:
 *
 *   1. Pick source platform (Telegraph / ESPN / BBC / FIFA / Screenshot).
 *   2. Paste URL (or upload screenshot).
 *   3. Preview every parsed pick + confirm.
 *
 * Each step talks to /api/v1/imports/preview, then /commit on
 * confirm. Per-platform instructions for finding the public bracket
 * URL live alongside the source picker.
 *
 * Styling is inline + minimal so the wizard can drop into either the
 * main app shell or a standalone landing without restyling.
 */

import { useCallback, useState } from "react";

type Source = "telegraph" | "espn" | "bbc" | "fifa" | "screenshot-ai";

interface PreviewMatch {
  matchId: string | null;
  homeTeamCode: string | null;
  awayTeamCode: string | null;
  outcome: "home_win" | "draw" | "away_win" | null;
  alreadyKickedOff: boolean;
  raw: {
    homeTeamRaw: string;
    awayTeamRaw: string;
    predictedWinnerRaw: string;
    sourceTimestamp?: string;
  };
  warnings: string[];
}

interface PreviewResult {
  source: Source;
  sourceUrl: string;
  sourceUserHandle?: string;
  matches: PreviewMatch[];
  champion: { code: string | null; raw: string } | null;
  runnerUp: { code: string | null; raw: string } | null;
  stats: {
    total: number;
    resolvable: number;
    alreadyLocked: number;
    upcoming: number;
    unresolvable: number;
  };
}

const SOURCES: ReadonlyArray<{
  id: Source;
  name: string;
  hostHint: string;
  instructions: string;
}> = [
  {
    id: "telegraph",
    name: "Telegraph",
    hostHint: "telegraph.co.uk",
    instructions:
      "On your Telegraph predictor page, tap the share icon and copy the public link. Paste it below.",
  },
  {
    id: "espn",
    name: "ESPN",
    hostHint: "espn.com",
    instructions:
      "Open your ESPN World Cup bracket, tap Share, choose Copy Link. Paste it below.",
  },
  {
    id: "bbc",
    name: "BBC Predictor",
    hostHint: "bbc.com / bbc.co.uk",
    instructions:
      "On the BBC Sport Predictor share page, copy the URL from your address bar (it ends in /predictor/<your id>).",
  },
  {
    id: "fifa",
    name: "FIFA app",
    hostHint: "fifa.com",
    instructions:
      "In the FIFA app, tap Share on your predictor and copy the link. Paste below.",
  },
  {
    id: "screenshot-ai",
    name: "Other / Screenshot",
    hostHint: "Any platform",
    instructions:
      "Upload a single screenshot of your bracket from any other platform. We'll read it with vision AI.",
  },
];

type WizardStep = "pick-source" | "paste-url" | "previewing" | "preview-ready" | "committing" | "done";

export function ImportWizard(): JSX.Element {
  const [step, setStep] = useState<WizardStep>("pick-source");
  const [source, setSource] = useState<Source | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [imageBase64, setImageBase64] = useState<{ data: string; mime: string; name: string } | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [committed, setCommitted] = useState<{
    committed: number;
    alreadyLocked: number;
    upcoming: number;
  } | null>(null);

  const reset = () => {
    setStep("pick-source");
    setSource(null);
    setSourceUrl("");
    setImageBase64(null);
    setPreview(null);
    setError(null);
    setErrorHint(null);
    setCommitted(null);
  };

  const submitPreview = useCallback(async () => {
    setError(null);
    setErrorHint(null);
    setStep("previewing");
    let body: Record<string, unknown>;
    if (source === "screenshot-ai") {
      if (!imageBase64) {
        setError("Please choose a screenshot first.");
        setStep("paste-url");
        return;
      }
      body = {
        source: "screenshot-ai",
        imageBase64: imageBase64.data,
        mimeType: imageBase64.mime,
      };
    } else {
      if (!source) {
        setError("Please pick a source platform first.");
        setStep("pick-source");
        return;
      }
      if (!sourceUrl.trim().startsWith("https://")) {
        setError("Please paste the full HTTPS URL of your bracket.");
        setStep("paste-url");
        return;
      }
      body = { source, sourceUrl: sourceUrl.trim() };
    }
    try {
      const res = await fetch("/api/v1/imports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as
        | PreviewResult
        | { error?: string; hint?: string; reason?: string };
      if (!res.ok) {
        const err = data as { error?: string; hint?: string };
        if (res.status === 401) {
          setError("You need to sign in first.");
          setErrorHint("Open Tournamental in this browser, sign in, then come back to this page.");
        } else {
          setError(err.error ?? "Couldn't parse the bracket.");
          setErrorHint(err.hint ?? null);
        }
        setStep("paste-url");
        return;
      }
      setPreview(data as PreviewResult);
      setStep("preview-ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setStep("paste-url");
    }
  }, [imageBase64, source, sourceUrl]);

  const submitCommit = useCallback(async () => {
    if (!preview || !source) return;
    setError(null);
    setErrorHint(null);
    setStep("committing");
    try {
      const res = await fetch("/api/v1/imports/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          sourceUrl: source === "screenshot-ai" ? "screenshot:upload" : sourceUrl.trim(),
          tournamentId: "fifa-wc-2026",
          preview,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        committed?: number;
        alreadyLocked?: number;
        upcoming?: number;
        error?: string;
        hint?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Couldn't save the imported picks.");
        setErrorHint(data.hint ?? null);
        setStep("preview-ready");
        return;
      }
      setCommitted({
        committed: data.committed ?? 0,
        alreadyLocked: data.alreadyLocked ?? 0,
        upcoming: data.upcoming ?? 0,
      });
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
      setStep("preview-ready");
    }
  }, [preview, source, sourceUrl]);

  const onFile = (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setError("Screenshot is over 5MB. Resize or compress and try again.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      if (comma < 0) {
        setError("Couldn't read that image.");
        return;
      }
      setImageBase64({
        data: result.slice(comma + 1),
        mime: file.type || "image/png",
        name: file.name,
      });
    };
    reader.readAsDataURL(file);
  };

  // ---- render ---------------------------------------------------

  if (step === "pick-source") {
    return (
      <section className="vt-import-step" aria-label="Pick a source platform">
        <h2 className="vt-import-step-h">Where's your existing bracket?</h2>
        <ul className="vt-import-sources">
          {SOURCES.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="vt-import-source-btn"
                onClick={() => {
                  setSource(s.id);
                  setStep("paste-url");
                }}
              >
                <span className="vt-import-source-name">{s.name}</span>
                <span className="vt-import-source-host">{s.hostHint}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const sourceMeta = SOURCES.find((s) => s.id === source);
  if (step === "paste-url" || step === "previewing") {
    return (
      <section className="vt-import-step" aria-label="Paste URL or upload screenshot">
        <button type="button" className="vt-import-back" onClick={reset}>
          ← Change source
        </button>
        <h2 className="vt-import-step-h">{sourceMeta?.name}</h2>
        <p className="vt-import-instruction">{sourceMeta?.instructions}</p>

        {source === "screenshot-ai" ? (
          <div className="vt-import-uploader">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
            {imageBase64 && (
              <p className="vt-import-uploaded">Loaded: {imageBase64.name}</p>
            )}
          </div>
        ) : (
          <label className="vt-import-url">
            <span>Your bracket URL</span>
            <input
              type="url"
              inputMode="url"
              placeholder={`https://${sourceMeta?.hostHint?.split(" ")[0] ?? ""}/...`}
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              autoFocus
            />
          </label>
        )}

        <button
          type="button"
          className="vt-import-primary"
          disabled={step === "previewing"}
          onClick={submitPreview}
        >
          {step === "previewing" ? "Parsing your bracket..." : "Preview my picks"}
        </button>
        {error && (
          <div className="vt-import-error" role="alert">
            <p>{error}</p>
            {errorHint && <p className="vt-import-error-hint">{errorHint}</p>}
          </div>
        )}
      </section>
    );
  }

  if (step === "preview-ready" || step === "committing") {
    if (!preview) return <div />;
    return (
      <section className="vt-import-step" aria-label="Preview parsed picks">
        <button type="button" className="vt-import-back" onClick={() => setStep("paste-url")}>
          ← Edit URL
        </button>
        <h2 className="vt-import-step-h">Confirm your picks</h2>
        <p className="vt-import-instruction">
          We found <strong>{preview.stats.resolvable}</strong> picks we can
          import.{" "}
          <strong>{preview.stats.alreadyLocked}</strong> are for matches that
          have already played (they lock in immediately and we credit any
          points). <strong>{preview.stats.upcoming}</strong> are for matches
          still to come, and you can change those at any time before each
          match's kickoff.
          {preview.stats.unresolvable > 0 && (
            <>
              {" "}
              <span className="vt-import-warning">
                {preview.stats.unresolvable} picks we couldn't reconcile to a
                match (knockout-stage cascade not yet wired or team name we
                don't recognise; shown below for your review).
              </span>
            </>
          )}
        </p>
        <ul className="vt-import-preview">
          {preview.matches.map((m, idx) => (
            <li
              key={idx}
              className={[
                "vt-import-preview-row",
                m.matchId ? "" : "vt-import-preview-warning",
                m.alreadyKickedOff ? "vt-import-preview-locked" : "",
              ].join(" ")}
            >
              <span className="vt-import-preview-teams">
                {m.raw.homeTeamRaw}{" "}
                {m.homeTeamCode && (
                  <code>{m.homeTeamCode}</code>
                )}{" "}
                vs {m.raw.awayTeamRaw}{" "}
                {m.awayTeamCode && (
                  <code>{m.awayTeamCode}</code>
                )}
              </span>
              <span className="vt-import-preview-pick">
                Pick: <strong>{m.raw.predictedWinnerRaw}</strong>
                {m.outcome && (
                  <em>
                    {" "}
                    →{" "}
                    {m.outcome === "home_win"
                      ? "Home win"
                      : m.outcome === "away_win"
                        ? "Away win"
                        : "Draw"}
                  </em>
                )}
              </span>
              {m.alreadyKickedOff && (
                <span className="vt-import-badge vt-import-badge-locked">
                  Already kicked off, will lock + score
                </span>
              )}
              {!m.matchId && (
                <span className="vt-import-badge vt-import-badge-warn">
                  Can't reconcile to a current match
                </span>
              )}
              {m.warnings.map((w, i) => (
                <span key={i} className="vt-import-row-warning">
                  {w}
                </span>
              ))}
            </li>
          ))}
        </ul>
        <button
          type="button"
          className="vt-import-primary"
          disabled={step === "committing" || preview.stats.resolvable === 0}
          onClick={submitCommit}
        >
          {step === "committing"
            ? "Saving to your bracket..."
            : `Save ${preview.stats.resolvable} picks to my Tournamental bracket`}
        </button>
        {error && (
          <div className="vt-import-error" role="alert">
            <p>{error}</p>
            {errorHint && <p className="vt-import-error-hint">{errorHint}</p>}
          </div>
        )}
      </section>
    );
  }

  if (step === "done" && committed) {
    return (
      <section className="vt-import-step" aria-label="Import complete">
        <h2 className="vt-import-step-h">All in.</h2>
        <p className="vt-import-instruction">
          {committed.committed} picks imported into your bracket.{" "}
          {committed.alreadyLocked > 0 &&
            `${committed.alreadyLocked} are locked from already-played matches and have been scored. `}
          {committed.upcoming > 0 &&
            `${committed.upcoming} are upcoming and you can change them on your bracket any time before each match's kickoff.`}
        </p>
        <a
          href="/world-cup-2026"
          className="vt-import-primary"
        >
          Open my bracket
        </a>
      </section>
    );
  }

  return <div />;
}
