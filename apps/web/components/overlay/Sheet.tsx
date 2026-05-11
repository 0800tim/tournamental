/**
 * Sheet, bottom-sheet on mobile, modal card on desktop.
 *
 * Features:
 *  - Backdrop scrim. Clicking the scrim closes the sheet.
 *  - ARIA `role="dialog"` + `aria-modal="true"`. Initial focus moves to
 *    the close button so keyboard users have an immediate exit.
 *  - Escape key closes.
 *  - Drag-down gesture closes (mobile). We track `pointermove` on the
 *    handle and drag the sheet's translateY in real time; when the
 *    drag exceeds 80 px or the velocity is high enough, we call
 *    `onClose()`.
 *  - On desktop (≥ 768 px) the sheet renders as a centred modal card
 *    instead of a bottom-sheet.
 *  - Hand-rolled CSS animation: framer-motion is not in the bundle yet
 *    and we don't want to add it for a single use site.
 *
 * The component is *content-agnostic*. The overlay-system caller
 * decides what goes inside (a TeamOverlay, MatchOverlay, etc.).
 */

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

export interface SheetProps {
  /** Required for screen readers; rendered visually as the sheet header
   * unless the consumer also passes `headerSlot`. */
  readonly title: string;
  /** Additional header content rendered to the right of the title (e.g.
   * a "View full page" button). */
  readonly headerSlot?: ReactNode;
  readonly children: ReactNode;
  readonly onClose: () => void;
  /**
   * Optional id for tests / a11y wiring (`aria-labelledby`). When omitted
   * a stable id is generated from the title slug.
   */
  readonly idHint?: string;
  /** Stack depth, used to render multi-overlay backdrops at slightly
   * different z so the topmost is visually dominant. */
  readonly depth?: number;
  /** Disable drag-down gesture (e.g. for a sheet that contains a
   * carousel that swallows pointer events). */
  readonly noDragClose?: boolean;
}

const DRAG_DISMISS_PX = 80;
const DRAG_DISMISS_VELOCITY = 0.6; // px/ms

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "sheet";
}

export function Sheet(props: SheetProps) {
  const {
    title,
    headerSlot,
    children,
    onClose,
    idHint,
    depth = 0,
    noDragClose,
  } = props;

  const id = idHint ?? `vt-sheet-${slugify(title)}`;
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  // Drag state lives in refs so we don't re-render on every pointermove.
  const dragStateRef = useRef<{
    startY: number;
    lastY: number;
    lastT: number;
    pointerId: number;
  } | null>(null);
  const [translateY, setTranslateY] = useState<number>(0);

  // Initial focus → close button. Done in an effect so SSR doesn't
  // attempt DOM access.
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  // Escape closes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Trap focus inside the sheet when tabbing. Light implementation -
  // forwards Tab from the last focusable to the first and Shift+Tab the
  // other way. Sufficient for the small content we render.
  const onSheetKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== "Tab") return;
    const root = sheetRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute("inert"));
    if (focusables.length === 0) return;
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onBackdropClick = useCallback((): void => {
    onClose();
  }, [onClose]);

  // Drag-down: we only attach pointer listeners to the handle (the
  // small grab-bar at the top of the sheet). Tracking on the whole
  // sheet would interfere with scrolling its content.
  const onHandlePointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (noDragClose) return;
    if (e.pointerType === "mouse") return; // mouse users have the close button
    // setPointerCapture is missing on some test environments (jsdom).
    const target = e.target as HTMLElement & {
      setPointerCapture?: (id: number) => void;
    };
    target.setPointerCapture?.(e.pointerId);
    dragStateRef.current = {
      startY: e.clientY,
      lastY: e.clientY,
      lastT: e.timeStamp,
      pointerId: e.pointerId,
    };
  };

  const onHandlePointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dy = Math.max(0, e.clientY - s.startY);
    setTranslateY(dy);
    s.lastY = e.clientY;
    s.lastT = e.timeStamp;
  };

  const onHandlePointerUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    dragStateRef.current = null;
    const dy = Math.max(0, e.clientY - s.startY);
    const dt = Math.max(1, e.timeStamp - s.lastT + 16); // guard ÷0
    const velocity = dy / dt; // px/ms, rough, but enough to catch flicks
    if (dy >= DRAG_DISMISS_PX || velocity >= DRAG_DISMISS_VELOCITY) {
      onClose();
    } else {
      setTranslateY(0);
    }
  };

  return (
    <div
      className={`vt-overlay-shell vt-overlay-depth-${depth}`}
      data-overlay-shell=""
      data-overlay-depth={depth}
    >
      <button
        type="button"
        className="vt-overlay-backdrop"
        aria-label="Close overlay"
        onClick={onBackdropClick}
        tabIndex={-1}
        data-overlay-backdrop=""
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="vt-overlay-sheet"
        style={{ transform: translateY ? `translateY(${translateY}px)` : undefined }}
        onKeyDown={onSheetKeyDown}
        data-overlay-sheet=""
      >
        <div
          className="vt-overlay-handle"
          aria-hidden="true"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
        >
          <span className="vt-overlay-handle-bar" />
        </div>
        <header className="vt-overlay-header">
          <h2 id={`${id}-title`} className="vt-overlay-title">
            {title}
          </h2>
          <div className="vt-overlay-header-slot">{headerSlot}</div>
          <button
            ref={closeBtnRef}
            type="button"
            className="vt-overlay-close"
            aria-label="Close"
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path
                d="M6 6L18 18M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div className="vt-overlay-body" data-overlay-body="">
          {children}
        </div>
      </div>
    </div>
  );
}
