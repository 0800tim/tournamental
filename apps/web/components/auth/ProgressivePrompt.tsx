/**
 * ProgressivePrompt — one-field inline prompt for the rich-profile
 * progressive-enrichment surface.
 *
 * Tim's bar: "small inline prompts at contextually relevant moments"
 * — e.g. after the first knockout pick is saved we ask which country
 * the user supports; after 3 visits we capture timezone; after a
 * share we ask for the age bucket.
 *
 * The component:
 *   - Reads a sticky "skip" flag from localStorage (the storage helper
 *     enforces a 14-day cooldown by default; completed prompts never
 *     re-show).
 *   - Renders nothing when the prompt was previously skipped/completed
 *     and the cooldown hasn't elapsed.
 *   - Calls the supplied `onConfirm` async fn with the new value;
 *     records "completed" on success, "skipped" on dismiss.
 *
 * The component is presentation-agnostic to the *kind* of input — it
 * accepts a child render fn that returns the controlled input plus a
 * "ready" boolean. That keeps the country picker / age picker /
 * timezone picker all wrappable in the same shell without coupling
 * them.
 */

"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  pushDataLayer,
  setPromptRecord,
  shouldShowPrompt,
} from "@/lib/user/storage";

import "./SignupModal.css"; // reuse the same tokens

export interface ProgressivePromptProps<T> {
  /** Stable name (e.g. "country-after-first-pick"). Keys the skip flag. */
  readonly name: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly ctaLabel?: string;
  readonly skipLabel?: string;
  /** Async confirm. Throws to keep the prompt open. */
  readonly onConfirm: (value: T) => Promise<void>;
  /**
   * Render the inner editable surface. Receives a `(value, ready)` setter
   * and returns the JSX; this keeps the wrapper agnostic to country vs
   * age vs timezone pickers.
   */
  readonly children: (api: {
    setValue: (v: T) => void;
    value: T | null;
  }) => ReactNode;
  /** Override cooldown (days) for the skip-stickiness. Default 14. */
  readonly cooldownDays?: number;
}

export function ProgressivePrompt<T>({
  name,
  title,
  subtitle,
  ctaLabel = "Save",
  skipLabel = "Not now",
  onConfirm,
  children,
  cooldownDays = 14,
}: ProgressivePromptProps<T>) {
  const [value, setValue] = useState<T | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!shouldShowPrompt(name, cooldownDays)) return;
    setVisible(true);
    pushDataLayer("tournamental.profile.prompt-shown", { prompt: name });
  }, [cooldownDays, name]);

  const onSkip = useCallback(() => {
    setPromptRecord(name, "skipped");
    pushDataLayer("tournamental.profile.prompt-skipped", { prompt: name });
    setVisible(false);
  }, [name]);

  const onSave = useCallback(async () => {
    if (value == null) return;
    setSubmitting(true);
    try {
      await onConfirm(value);
      setPromptRecord(name, "completed");
      pushDataLayer("tournamental.profile.prompt-completed", { prompt: name });
      setVisible(false);
    } catch {
      // keep the prompt visible so the user can retry
    } finally {
      setSubmitting(false);
    }
  }, [name, onConfirm, value]);

  if (!visible) return null;
  return (
    <div
      role="dialog"
      aria-labelledby={`pp-${name}-title`}
      className="vsm-card"
      style={{
        position: "relative",
        margin: "12px auto",
        boxShadow: "0 6px 24px rgba(0,0,0,0.32)",
      }}
    >
      <header className="vsm-header">
        <h3 id={`pp-${name}-title`} className="vsm-title">
          {title}
        </h3>
      </header>
      {subtitle ? <p className="vsm-hint">{subtitle}</p> : null}
      <section className="vsm-section">
        {children({ setValue, value })}
      </section>
      <div className="vsm-actions">
        <button
          type="button"
          className="vsm-btn vsm-btn-secondary"
          onClick={onSkip}
          disabled={submitting}
        >
          {skipLabel}
        </button>
        <button
          type="button"
          className="vsm-btn vsm-btn-primary"
          onClick={() => {
            void onSave();
          }}
          disabled={submitting || value == null}
        >
          {submitting ? "Saving…" : ctaLabel}
        </button>
      </div>
    </div>
  );
}
