import dynamic from "next/dynamic";

// MatchScene is client-only — Three.js needs a real DOM and WebGL context.
const MatchScene = dynamic(
  () => import("@/components/MatchScene").then((m) => m.MatchScene),
  { ssr: false },
);

interface MatchPageProps {
  params: { id: string };
  searchParams: { src?: string };
}

/**
 * Live demo route. By default we attach to a producer at
 * `NEXT_PUBLIC_VTORN_WS_URL` (defaults to ws://localhost:4001 — the
 * statsbomb-replay default) and fall back to the in-process synthetic
 * AR-FR fixture if no producer URL is reachable.
 *
 * The query-string `?src=ws://...` overrides the env var for one-off testing.
 */
export default function MatchPage({ params, searchParams }: MatchPageProps) {
  const explicit = searchParams.src;
  const envUrl = process.env.NEXT_PUBLIC_VTORN_WS_URL;
  const fallback = "synthetic";
  const source = explicit ?? envUrl ?? fallback;

  return <MatchScene source={source} matchId={params.id} />;
}
