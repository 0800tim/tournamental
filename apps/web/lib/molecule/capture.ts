/**
 * Client-side capture helper for the molecule pyramid.
 *
 * Pulls the user's exact WebGL camera pose out of the R3F canvas via
 * `canvas.toDataURL('image/png')`, builds a server-composable
 * prediction-card payload from the cascaded bracket, POSTs both to
 * `/api/share/molecule-capture`, and returns the composed PNG `Blob`.
 *
 * The capture itself is synchronous and zero-cost (one GPU readback);
 * `preserveDrawingBuffer: true` on the `<Canvas gl>` makes it work
 * without a manual render pass. All composition (header, podium, path
 * pills, QR, wordmark) happens server-side so the client bundle stays
 * inside the 10 kB budget called out in the brief.
 *
 * No DOM mutation; safe to call from a button handler in any client
 * component. SSR-safe: every browser-only path is guarded so this
 * file is import-clean from server components too.
 */

import type { CascadedBracket, Tournament } from "@tournamental/bracket-engine";

import type { CanvasCardSize } from "@tournamental/social-cards";

const CAPTURE_ENDPOINT = "/api/share/molecule-capture";

export interface CaptureChampion {
  readonly code: string;
  readonly name: string;
  readonly kit?: { readonly primary?: string | null } | null;
}

export interface CapturePathEntry {
  readonly stage: "r16" | "qf" | "sf" | "tp" | "final";
  readonly teamCode: string;
  readonly teamName: string;
}

export interface CaptureInput {
  readonly size?: CanvasCardSize;
  readonly shareGuid: string;
  readonly handle?: string | null;
  readonly tournamentName?: string;
  readonly champion?: CaptureChampion | null;
  readonly runnerUp?: CaptureChampion | null;
  readonly thirdPlace?: CaptureChampion | null;
  readonly knockoutPath?: ReadonlyArray<CapturePathEntry>;
}

export interface CaptureResult {
  /** Composed PNG as a `Blob` (image/png). */
  readonly blob: Blob;
  /** Object URL pointing at `blob`; caller must `URL.revokeObjectURL` it. */
  readonly objectUrl: string;
  /** Suggested filename for download fallback. */
  readonly filename: string;
}

/**
 * Find the molecule WebGL canvas in the DOM. We use the class hook
 * `.molecule-canvas` (declared in molecule.css + set on the R3F
 * `<Canvas>` element) so this helper doesn't have to import any of the
 * scene component graph.
 */
export function findMoleculeCanvas(): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const root = document.querySelector(".molecule-canvas");
  if (!root) return null;
  // R3F mounts the WebGL canvas as a child of its className target.
  if (root instanceof HTMLCanvasElement) return root;
  const inner = root.querySelector("canvas");
  return inner instanceof HTMLCanvasElement ? inner : null;
}

/**
 * Compose the user's pose with the prediction card. Throws on canvas
 * not found or server failure — callers should `try/catch` and surface a
 * toast.
 */
export async function captureAndCompose(
  input: CaptureInput,
): Promise<CaptureResult> {
  const canvas = findMoleculeCanvas();
  if (!canvas) throw new Error("molecule canvas not found");

  // toDataURL needs preserveDrawingBuffer:true (set in MoleculeScene
  // via the <Canvas gl> prop). Otherwise the WebGL buffer is cleared
  // before we can read it back and we get a transparent PNG.
  let captureDataUrl: string;
  try {
    captureDataUrl = canvas.toDataURL("image/png");
  } catch {
    throw new Error("canvas read failed (preserveDrawingBuffer missing?)");
  }

  const res = await fetch(CAPTURE_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      captureDataUrl,
      size: input.size ?? "landscape",
      shareGuid: input.shareGuid,
      handle: input.handle ?? null,
      tournamentName: input.tournamentName ?? "FIFA WC 2026",
      champion: input.champion ?? null,
      runnerUp: input.runnerUp ?? null,
      thirdPlace: input.thirdPlace ?? null,
      knockoutPath: input.knockoutPath ?? [],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`compose failed: HTTP ${res.status} ${detail}`);
  }
  const blob = await res.blob();

  const slug =
    (input.champion?.code ?? "molecule").toLowerCase().replace(/[^a-z0-9]+/g, "-") ||
    "molecule";
  const filename = `tournamental-molecule-${slug}.png`;

  const objectUrl = URL.createObjectURL(blob);
  return { blob, objectUrl, filename };
}

/**
 * Attempt the native share-sheet with the composed image. Falls back to
 * a clipboard copy + download path when Web Share Level 2 (`files`) is
 * unavailable (most desktop browsers).
 *
 * Returns the share path that ran:
 *   "shared"      — navigator.share completed successfully.
 *   "cancelled"   — navigator.share threw a user-cancellation (still success-ish).
 *   "downloaded"  — fell back to <a download> + clipboard write.
 *   "copied"      — only the URL ended up on the clipboard (no download UI).
 */
export type ShareOutcome = "shared" | "cancelled" | "downloaded" | "copied";

export async function shareCapture(args: {
  result: CaptureResult;
  shareUrl: string;
  title: string;
  text: string;
}): Promise<ShareOutcome> {
  const { result, shareUrl, title, text } = args;
  const file = new File([result.blob], result.filename, { type: "image/png" });

  // Level-2 Web Share with a file payload — iOS Safari + Android Chrome.
  // `canShare({ files })` is the canonical capability probe; calling
  // `share` without checking can throw NotAllowedError silently.
  const nav = typeof navigator !== "undefined" ? navigator : null;
  if (
    nav &&
    typeof nav.canShare === "function" &&
    typeof nav.share === "function" &&
    nav.canShare({ files: [file] })
  ) {
    try {
      await nav.share({ files: [file], title, text, url: shareUrl });
      return "shared";
    } catch (err) {
      // AbortError on user cancel is fine; anything else fall through
      // to the download path.
      if (err instanceof Error && err.name === "AbortError") {
        return "cancelled";
      }
    }
  }

  // Desktop fallback — download the PNG and copy the share URL.
  triggerDownload(result.objectUrl, result.filename);
  await safeClipboardCopy(shareUrl);
  return "downloaded";
}

function triggerDownload(href: string, filename: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function safeClipboardCopy(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined") return false;
    if (!navigator.clipboard) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
