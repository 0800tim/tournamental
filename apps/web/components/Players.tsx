"use client";

import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import type { MatchStore } from "@vtorn/spec-client";
import { Player } from "./Player";

interface PlayersProps {
  store: StoreApi<MatchStore>;
}

/**
 * Render every player from MatchInit. We deliberately don't subscribe to
 * StateFrame updates here — each <Player/> reads from the store inside
 * useFrame, which avoids React reconciliation at 60 fps.
 */
export function Players({ store }: PlayersProps) {
  const init = useStore(store, (s) => s.init);
  if (!init) return null;
  const [home, away] = init.teams;
  return (
    <group>
      {home.players.map((p) => (
        <Player key={p.id} player={p} team="home" kit={home.kit} store={store} />
      ))}
      {away.players.map((p) => (
        <Player key={p.id} player={p} team="away" kit={away.kit} store={store} />
      ))}
    </group>
  );
}
