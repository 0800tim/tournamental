"use client";

/**
 * Avatar image with fallback to a text initial.
 *
 * Serves from /avatars/<userId>.jpg — the route handler returns the
 * file from data/avatars/ on every request so runtime uploads work.
 *
 * Live-refresh on self-upload (Tim 2026-06-03): the upload component
 * dispatches a `vt:avatar-updated` CustomEvent with the affected
 * userId after a successful POST. Every AvatarImage mounted on the
 * page listens for the event, and if the userId matches its own,
 * bumps a local counter that's appended as `?v=<n>` to the src. The
 * browser sees a different URL, fetches fresh, the page updates
 * without a reload.
 *
 * Why both the SW bypass + new cache headers AND this client
 * broadcast are needed: the cache changes ensure NEW visitors see
 * fresh content within ~60s of an upload. The broadcast ensures the
 * UPLOADER sees their own change immediately on the same page, even
 * though their browser has the old bitmap in its image-decoder cache
 * (which `no-store` doesn't always evict mid-session).
 */

import { useEffect, useState } from "react";

export const AVATAR_UPDATED_EVENT = "vt:avatar-updated";

export interface AvatarUpdatedDetail {
  /** The user id whose avatar changed. AvatarImage instances that don't
   * match this id ignore the event. */
  userId: string;
}

interface AvatarImageProps {
  userId: string;
  fallback: string;
  size?: number;
  className?: string;
}

export function AvatarImage({ userId, fallback, size = 32, className }: AvatarImageProps) {
  const [errored, setErrored] = useState(false);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<AvatarUpdatedDetail>).detail;
      if (!detail) return;
      if (detail.userId !== userId) return;
      // Clear any previous error state — a fresh upload might fix a
      // 404 (user had no avatar, now they do).
      setErrored(false);
      setVersion((v) => v + 1);
    };
    window.addEventListener(AVATAR_UPDATED_EVENT, onChange);
    return () => window.removeEventListener(AVATAR_UPDATED_EVENT, onChange);
  }, [userId]);

  // Pass the fallback initial to the /avatars/ route. When the user has
  // no uploaded photo on disk, the route returns a 200 SVG placeholder
  // rendering that initial on a deterministic colour, instead of a 404.
  // That keeps the browser console + Next dev overlay free of noise on
  // every render. Users who have uploaded a real photo are served the
  // JPEG; the `initial` param is ignored on that path.
  const initial = (fallback ?? "").trim().charAt(0);
  const initialQuery = initial ? `initial=${encodeURIComponent(initial)}` : "";
  const baseSrc = `/avatars/${encodeURIComponent(userId)}.jpg`;
  const src =
    version === 0
      ? initialQuery
        ? `${baseSrc}?${initialQuery}`
        : baseSrc
      : `${baseSrc}?v=${version}-${Date.now()}${initialQuery ? `&${initialQuery}` : ""}`;

  if (errored) {
    return <>{fallback}</>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={className}
      onError={() => setErrored(true)}
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        objectFit: "cover",
        display: "block",
      }}
    />
  );
}
