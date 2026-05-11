"use client";

/**
 * "Join this pool" CTA + modal for the `/s/<slug>` syndicate landing.
 *
 * The modal posts the user's handle to a (mocked for now) backend
 * endpoint `/api/v1/syndicates/<slug>/join`. The parallel signup agent
 * (#70) will replace the mock with the real join flow + GHL contact
 * upsert. Until then, the modal optimistically closes on submit and
 * shows a confirmation toast.
 */

import { useCallback, useState } from "react";

export interface JoinSyndicateProps {
  readonly slug: string;
  readonly syndicateName: string;
}

export function JoinSyndicate({ slug, syndicateName }: JoinSyndicateProps) {
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!handle.trim()) return;
      setSubmitting(true);
      try {
        // Best-effort POST. The endpoint is a mock until #70 lands;
        // a 404 here is expected and silent.
        await fetch(`/api/v1/syndicates/${encodeURIComponent(slug)}/join`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handle: handle.trim() }),
        }).catch(() => undefined);
      } finally {
        setSubmitting(false);
        setDone(true);
        setTimeout(() => {
          setOpen(false);
          setDone(false);
          setHandle("");
        }, 1200);
      }
    },
    [handle, slug],
  );

  return (
    <>
      <button
        className="vt-share-cta"
        data-variant="primary"
        type="button"
        onClick={() => setOpen(true)}
      >
        Join this pool
      </button>
      {open ? (
        <div
          className="vt-share-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vt-share-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="vt-share-modal">
            <h2 className="vt-share-modal-title" id="vt-share-modal-title">
              Join {syndicateName}
            </h2>
            <p className="vt-share-modal-body">
              Pick a handle to enter the pool. You can build your bracket
              after you join.
            </p>
            <form
              onSubmit={onSubmit}
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <input
                type="text"
                className="vt-share-modal-input"
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="your_handle"
                autoFocus
                disabled={submitting || done}
                aria-label="Handle"
                maxLength={32}
                required
                pattern="[a-zA-Z0-9_]{2,32}"
              />
              <input
                type="hidden"
                name="slug"
                value={slug}
              />
              <div className="vt-share-modal-row">
                <button
                  type="button"
                  className="vt-share-cta"
                  data-variant="secondary"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="vt-share-cta"
                  data-variant="primary"
                  disabled={submitting || done}
                >
                  {done
                    ? "You're in"
                    : submitting
                      ? "Joining…"
                      : "Join pool"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
