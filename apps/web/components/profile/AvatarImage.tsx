"use client";

/**
 * Avatar image with fallback to a text initial.
 * Serves from /avatars/<userId>.jpg — the route handler returns the
 * file from data/avatars/ on every request so runtime uploads work.
 */

import { useState } from "react";

interface AvatarImageProps {
  userId: string;
  fallback: string;
  size?: number;
  className?: string;
}

export function AvatarImage({ userId, fallback, size = 32, className }: AvatarImageProps) {
  const [errored, setErrored] = useState(false);
  const src = `/avatars/${encodeURIComponent(userId)}.jpg`;

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
