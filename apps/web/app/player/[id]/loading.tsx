/**
 * Skeleton state for `/player/[id]`. Pre-renders during navigation
 * transitions and serves immediately if Next.js can't satisfy the request
 * from the static cache.
 */

export default function PlayerPageLoading() {
  return (
    <main className="player-page" data-testid="player-page-loading">
      <div
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: "60vh",
          color: "#94a3b8",
        }}
      >
        Loading player…
      </div>
    </main>
  );
}
