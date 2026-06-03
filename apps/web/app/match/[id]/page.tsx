import { RouteEvent } from "@/components/analytics/RouteEvent";
import { AppShell } from "@/components/shell";
// MatchScene is client-only (Three.js needs a real DOM and WebGL
// context). Next 15 forbids `ssr: false` on `next/dynamic` inside a
// server component, so the dynamic-import lives in MatchSceneClient.
import { MatchScene } from "@/components/MatchSceneClient";

interface MatchPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ src?: string; manifest?: string }>;
}

const ARFR_DEFAULT_MANIFEST =
  "/data/arfr-stream/fifa-wc-2022-final-arg-fra-2022-12-18.ndjson.gz";

/**
 * Live demo route. Resolution order for the stream source:
 *
 *   1. `?src=...` query string (live producer, raw URL).
 *   2. `?manifest=...` query string (canned NDJSON path; .gz auto-detected).
 *   3. `NEXT_PUBLIC_VTORN_WS_URL` env var (live producer override).
 *   4. **For AR-FR demo:** if the match id starts with `fifa-wc-2022-final`
 *      AND nothing above is set, auto-use the bundled manifest.
 *   5. In-process synthetic AR-FR fixture.
 *
 * The page is wrapped in `<AppShell variant="canvas">` so the renderer
 * canvas stays full-bleed under a translucent app-bar; the bottom nav
 * is hidden so the renderer keeps the full viewport.
 */
export default async function MatchPage(props: MatchPageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const { src, manifest } = searchParams;
  const envUrl = process.env.NEXT_PUBLIC_VTORN_WS_URL;
  const isArFrDemo = params.id.startsWith("fifa-wc-2022-final");

  let source: string;
  if (src) source = src;
  else if (manifest) source = manifest;
  else if (envUrl) source = envUrl;
  else if (isArFrDemo) source = ARFR_DEFAULT_MANIFEST;
  else source = "synthetic";

  return (
    <AppShell
      title="Match"
      variant="canvas"
      showBottomNav={false}
    >
      <RouteEvent
        name="match.opened"
        payload={{ match_id: params.id, source }}
      />
      <MatchScene source={source} matchId={params.id} />
    </AppShell>
  );
}
