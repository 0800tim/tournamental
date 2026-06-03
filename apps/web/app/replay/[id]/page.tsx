// MatchScene is client-only (Three.js needs a real DOM and WebGL
// context). Next 15 forbids `ssr: false` on `next/dynamic` inside a
// server component, so the dynamic-import lives in MatchSceneClient.
import { MatchScene } from "@/components/MatchSceneClient";

interface ReplayPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ src?: string }>;
}

/**
 * Replay route, same scene as /match/[id] but the source defaults to
 * the in-process synthetic AR-FR fixture so the route is self-contained
 * without a running producer. A real archive manifest URL can be passed
 * via `?src=...`.
 */
export default async function ReplayPage(props: ReplayPageProps) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const source = searchParams.src ?? "synthetic";
  return <MatchScene source={source} matchId={params.id} />;
}
