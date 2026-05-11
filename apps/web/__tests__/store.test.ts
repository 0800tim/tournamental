import { describe, expect, it } from "vitest";
import { createMatchStore, syntheticArFrSource, buildArFrMessages } from "@tournamental/spec-client";
import type { Message } from "@tournamental/spec";

describe("MatchStore + synthetic AR-FR stream", () => {
  it("ends with the canonical 3-3 / 4-2 scoreline", () => {
    const store = createMatchStore();
    const messages: Message[] = buildArFrMessages();
    for (const m of messages) {
      store.getState().applyMessage(m);
    }
    const s = store.getState();
    expect(s.score.home).toBe(3);
    expect(s.score.away).toBe(3);
    expect(s.shootout.home).toBe(4);
    expect(s.shootout.away).toBe(2);
    expect(s.shootout.ended).toBe(true);
  });

  it("includes a kickoff event and a match_end event", () => {
    const messages = buildArFrMessages();
    const types = new Set(messages.map((m) => m.type));
    expect(types.has("event.kickoff")).toBe(true);
    expect(types.has("event.match_end")).toBe(true);
    expect(types.has("event.penalty_shootout_start")).toBe(true);
    expect(types.has("event.penalty_shootout_end")).toBe(true);
  });

  it("emits at least 5,000 state frames so the renderer has dense input", () => {
    const messages = buildArFrMessages();
    const stateCount = messages.filter((m) => m.type === "state").length;
    // 1 frame/sec for ~7,200s of regulation+ET.
    expect(stateCount).toBeGreaterThan(5000);
  });
});

describe("syntheticArFrSource", () => {
  it("starts with status='synthetic' and emits init synchronously", async () => {
    const store = createMatchStore();
    const source = syntheticArFrSource({ tickMs: 5 });
    source.start(
      (m) => store.getState().applyMessage(m),
      (s) => store.getState().setStatus(s),
    );

    expect(store.getState().status).toBe("synthetic");
    // init is drained synchronously inside start().
    expect(store.getState().init).not.toBeNull();

    source.stop();
  });
});
