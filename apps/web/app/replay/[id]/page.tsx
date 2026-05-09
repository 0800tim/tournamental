import dynamic from "next/dynamic";

const MatchScene = dynamic(
  () => import("@/components/MatchScene").then((m) => m.MatchScene),
  { ssr: false },
);

interface ReplayPageProps {
  params: { id: string };
  searchParams: { src?: string };
}

/**
 * Replay route — same scene as /match/[id] but the source defaults to
 * the in-process synthetic AR-FR fixture so the route is self-contained
 * without a running producer. A real archive manifest URL can be passed
 * via `?src=...`.
 */
export default function ReplayPage({ params, searchParams }: ReplayPageProps) {
  const source = searchParams.src ?? "synthetic";
  return <MatchScene source={source} matchId={params.id} />;
}
