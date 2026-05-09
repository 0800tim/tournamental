import { afterAll, describe, expect, it } from "vitest";

import { makeServer } from "./helpers.js";

describe("game-service / healthz", () => {
  const built = makeServer();
  afterAll(async () => {
    const { app } = await built;
    await app.close();
  });

  it("GET /healthz returns ok=true with db=up", async () => {
    const { app } = await built;
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe("up");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("GET / returns service descriptor", async () => {
    const { app } = await built;
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.service).toBe("@vtorn/game");
    expect(body.health).toBe("/healthz");
  });
});
