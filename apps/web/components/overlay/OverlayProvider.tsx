/**
 * OverlayProvider — owns the overlay stack and keeps it in lockstep with
 * the URL.
 *
 * Behaviour:
 * - On mount, parses the current `window.location.search` into the
 *   initial stack so a deep-link like
 *   `https://2026wc.vtourn.com/world-cup-2026?overlay=team&code=NZL`
 *   opens with the team overlay already on top.
 * - Every `open()/close()/replace()` mutates the stack AND pushes (or
 *   replaces) a history entry so the browser back button unwinds
 *   overlays before navigating away from the page.
 * - Listens to `popstate`: when the user hits back, re-parse the URL
 *   and snap the stack to whatever the URL now says (works in both
 *   directions — back unwinds, forward redoes).
 * - Locks body scroll while at least one overlay is open (mobile UX).
 *
 * The provider is intentionally *not* part of the next/navigation
 * router — it lives on plain `history` so the underlying page route
 * never changes. This is critical for SEO: a search engine that fetches
 * the deep-link gets HTML for the *underlying* page (with the overlay's
 * server-rendered shim slotted in via `OverlayServerShim`); the overlay
 * is purely an interaction layer on top.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { OverlayApi, OverlayFrame, OverlayKind } from "./types";
import { encodeOverlayUrl, parseOverlayUrl, stacksEqual } from "./url";

const OverlayContext = createContext<OverlayApi | null>(null);

interface OverlayProviderProps {
  readonly children: ReactNode;
  /**
   * Optional initial stack — only used during SSR / tests. In the
   * browser the provider always re-reads `location.search` on mount to
   * stay authoritative.
   */
  readonly initialStack?: readonly OverlayFrame[];
}

export function OverlayProvider(props: OverlayProviderProps) {
  const { children, initialStack = [] } = props;
  const [stack, setStack] = useState<readonly OverlayFrame[]>(initialStack);
  // Internal flag: when true, the next state mutation came from a
  // popstate (browser back/forward) and we MUST NOT push another
  // history entry — that would create an infinite loop.
  const skipNextPushRef = useRef<boolean>(false);

  // 1) On mount, hydrate the stack from the current URL. We can't do
  //    this during render because `window` is undefined on the server.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const fromUrl = parseOverlayUrl(window.location.search);
    if (!stacksEqual(fromUrl, stack)) {
      skipNextPushRef.current = true;
      setStack(fromUrl);
    }
    // Empty deps: only run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) Sync stack -> URL whenever it changes (and we're not handling a popstate).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (skipNextPushRef.current) {
      skipNextPushRef.current = false;
      return;
    }
    const targetSearch = encodeOverlayUrl(stack, window.location.search);
    const targetUrl =
      window.location.pathname + (targetSearch || "") + window.location.hash;
    if (targetUrl !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.pushState({ vtornOverlay: true }, "", targetUrl);
    }
  }, [stack]);

  // 3) Listen for popstate: re-snap the stack to whatever the URL now says.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onPop = (): void => {
      const next = parseOverlayUrl(window.location.search);
      if (!stacksEqual(next, stack)) {
        skipNextPushRef.current = true;
        setStack(next);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [stack]);

  // 4) Body scroll-lock while any overlay is open. We toggle a class on
  //    <body> rather than touching style directly so the page can opt
  //    out of locking (e.g. the bracket already has its own scroll
  //    container) by adjusting the global rule. The class itself sets
  //    `overflow: hidden` and `touch-action: none` on touch devices.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const cls = "vt-overlay-open";
    if (stack.length > 0) document.body.classList.add(cls);
    else document.body.classList.remove(cls);
    return () => document.body.classList.remove(cls);
  }, [stack.length]);

  const open = useCallback(
    (kind: OverlayKind, params: Record<string, string> = {}): void => {
      setStack((prev) => {
        // If the same kind is already on top with the same params, no-op.
        const top = prev[prev.length - 1];
        if (top && top.kind === kind) {
          const sameKeys =
            Object.keys(top.params).length === Object.keys(params).length &&
            Object.keys(params).every((k) => top.params[k] === params[k]);
          if (sameKeys) return prev;
          // Same kind, different params → replace, not stack.
          return [...prev.slice(0, -1), { kind, params }];
        }
        return [...prev, { kind, params }];
      });
    },
    [],
  );

  const close = useCallback((): void => {
    setStack((prev) => (prev.length === 0 ? prev : prev.slice(0, -1)));
  }, []);

  const closeAll = useCallback((): void => {
    setStack((prev) => (prev.length === 0 ? prev : []));
  }, []);

  const replace = useCallback(
    (kind: OverlayKind, params: Record<string, string> = {}): void => {
      // `replace` uses replaceState semantics: don't add a new history
      // entry. We achieve this by skipping the auto-push in (2) and
      // calling replaceState ourselves.
      skipNextPushRef.current = true;
      setStack((prev) => {
        const next: readonly OverlayFrame[] =
          prev.length === 0
            ? [{ kind, params }]
            : [...prev.slice(0, -1), { kind, params }];
        if (typeof window !== "undefined") {
          const search = encodeOverlayUrl(next, window.location.search);
          const url =
            window.location.pathname + (search || "") + window.location.hash;
          window.history.replaceState({ vtornOverlay: true }, "", url);
        }
        return next;
      });
    },
    [],
  );

  const api = useMemo<OverlayApi>(
    () => ({ stack, open, close, closeAll, replace }),
    [stack, open, close, closeAll, replace],
  );

  return <OverlayContext.Provider value={api}>{children}</OverlayContext.Provider>;
}

/**
 * `useOverlay()` — read or mutate the overlay stack.
 *
 * Throws when called outside an `<OverlayProvider>` so misuse fails
 * loudly in dev. Components that want to be optional can wrap in a
 * try/catch or use `useOptionalOverlay()` below.
 */
export function useOverlay(): OverlayApi {
  const ctx = useContext(OverlayContext);
  if (!ctx) {
    throw new Error("useOverlay() called outside <OverlayProvider>");
  }
  return ctx;
}

/**
 * `useOptionalOverlay()` — returns null when not inside a provider.
 * Useful for shared components that may render in pages that don't
 * carry the overlay system (so they fall back to plain navigation).
 */
export function useOptionalOverlay(): OverlayApi | null {
  return useContext(OverlayContext);
}
