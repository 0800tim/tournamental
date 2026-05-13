/**
 * Avatar URL helpers — single source of truth for "where does a user's
 * avatar live on the web". The bytes are stored at
 * `public/avatars/<userId>.webp` (see app/api/v1/profile/avatar/route.ts)
 * and served via Next's static handler, so the URL is deterministic.
 *
 * `DEFAULT_AVATAR_DATA_URI` is a 96×96 silhouette inlined as a data URI
 * so the share card / member tiles never flash a broken-image placeholder
 * for users who haven't uploaded one yet. The asset is intentionally
 * neutral (initial-only with a soft gradient backdrop) so it reads as
 * "not uploaded yet" rather than "an actual person".
 */

export function avatarUrlFor(userId: string): string {
  return `/avatars/${userId}.webp`;
}

export const DEFAULT_AVATAR_DATA_URI =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#26314a"/>' +
      '<stop offset="1" stop-color="#0f1422"/>' +
      "</linearGradient></defs>" +
      '<rect width="96" height="96" rx="48" fill="url(#g)"/>' +
      '<circle cx="48" cy="38" r="14" fill="#94a3b8" opacity="0.6"/>' +
      '<path d="M16 88c4-18 18-26 32-26s28 8 32 26z" fill="#94a3b8" opacity="0.55"/>' +
      "</svg>",
  );
