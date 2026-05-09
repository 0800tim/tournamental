/**
 * Config parsing — env vars to typed StreamConfig.
 */

import { describe, it, expect } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  it("uses sensible defaults for an empty env", () => {
    const c = loadConfig({});
    expect(c.port).toBe(4002);
    expect(c.bind).toBe("0.0.0.0");
    expect(c.ringSeconds).toBe(60);
    expect(c.adminToken).toBe("");
    expect(c.maxConnsPerIp).toBe(100);
    expect(c.maxConnsTotal).toBe(5000);
    expect(c.producerUrls).toEqual(["ws://localhost:4001"]);
  });

  it("parses a comma-separated producer list", () => {
    const c = loadConfig({ STREAM_PRODUCER_URLS: "ws://a:1,ws://b:2 , ws://c:3" });
    expect(c.producerUrls).toEqual(["ws://a:1", "ws://b:2", "ws://c:3"]);
  });

  it("ignores empty list entries", () => {
    const c = loadConfig({ STREAM_PRODUCER_URLS: "ws://a:1,,ws://b:2," });
    expect(c.producerUrls).toEqual(["ws://a:1", "ws://b:2"]);
  });

  it("falls back to default when STREAM_PORT is non-numeric", () => {
    const c = loadConfig({ STREAM_PORT: "not-a-number" });
    expect(c.port).toBe(4002);
  });

  it("falls back to default when STREAM_PORT <= 0", () => {
    const c = loadConfig({ STREAM_PORT: "0" });
    expect(c.port).toBe(4002);
    const c2 = loadConfig({ STREAM_PORT: "-9" });
    expect(c2.port).toBe(4002);
  });

  it("respects valid overrides", () => {
    const c = loadConfig({
      STREAM_PORT: "5050",
      STREAM_BIND: "127.0.0.1",
      STREAM_RING_SECONDS: "30",
      STREAM_ADMIN_TOKEN: "tok",
      STREAM_MAX_CONNS_PER_IP: "10",
      STREAM_MAX_CONNS_TOTAL: "100",
      LOG_PRETTY: "1",
    });
    expect(c.port).toBe(5050);
    expect(c.bind).toBe("127.0.0.1");
    expect(c.ringSeconds).toBe(30);
    expect(c.adminToken).toBe("tok");
    expect(c.maxConnsPerIp).toBe(10);
    expect(c.maxConnsTotal).toBe(100);
    expect(c.logPretty).toBe(true);
  });
});
