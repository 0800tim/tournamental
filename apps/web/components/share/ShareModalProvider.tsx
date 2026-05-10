/**
 * Share-modal context + provider.
 *
 * The sibling bracket-tabs agent owns the bracket page header and the
 * floating "Save & Share" mobile button. To avoid colliding on those
 * files we expose a hook: any client component below the provider can
 * call `useShareModal().open(payload)` and the modal mounts itself.
 *
 * Usage:
 *
 *   // app/world-cup-2026/layout.tsx (or higher)
 *   <ShareModalProvider>
 *     {children}
 *   </ShareModalProvider>
 *
 *   // Inside a button somewhere in the bracket page:
 *   const { open } = useShareModal();
 *   <button onClick={() => open({ bracketId, handle, ... })}>Share</button>
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { BracketSharePayload } from "@/lib/share/payload";

import { ShareModal } from "./ShareModal";

export interface ShareModalApi {
  readonly isOpen: boolean;
  readonly payload: BracketSharePayload | null;
  open(payload: BracketSharePayload): void;
  close(): void;
}

const NULL_API: ShareModalApi = {
  isOpen: false,
  payload: null,
  open: () => {},
  close: () => {},
};

const ShareModalContext = createContext<ShareModalApi>(NULL_API);

export interface ShareModalProviderProps {
  readonly children: ReactNode;
  /** Optional explicit origin for SSR (e.g. tests). */
  readonly origin?: string;
}

export function ShareModalProvider({ children, origin }: ShareModalProviderProps) {
  const [payload, setPayload] = useState<BracketSharePayload | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback((next: BracketSharePayload) => {
    setPayload(next);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const api = useMemo<ShareModalApi>(
    () => ({ isOpen, payload, open, close }),
    [isOpen, payload, open, close],
  );

  return (
    <ShareModalContext.Provider value={api}>
      {children}
      <ShareModal open={isOpen} payload={payload} onClose={close} origin={origin} />
    </ShareModalContext.Provider>
  );
}

/** Hook that any descendant can call to open / close the share modal. */
export function useShareModal(): ShareModalApi {
  return useContext(ShareModalContext);
}
