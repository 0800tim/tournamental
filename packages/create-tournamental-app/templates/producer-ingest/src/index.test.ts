import { describe, it, expect } from "vitest";

import factory from "./index";

const ctx = {} as never;

describe("__PKG_DISPLAY__", () => {
  it("emits a spec-conformant match.init on start", async () => {
    const { ingestSource } = factory(ctx);
    const pushed: unknown[] = [];
    const subscriber = {
      push: (m: unknown) => pushed.push(m),
      paused: false,
      end() {},
    };
    const session = await ingestSource.start(
      { matchId: "test-1", timeScale: 1 },
      subscriber,
    );
    await session.dispose();

    expect(pushed.length).toBeGreaterThanOrEqual(1);
    const init = pushed[0] as { type: string; match_id: string; spec_version: string };
    expect(init.type).toBe("match.init");
    expect(init.match_id).toBe("test-1");
    expect(init.spec_version).toBe("0.1.1");
  });
});
