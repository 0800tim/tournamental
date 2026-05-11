/**
 * Unit tests for the ElevenLabs realtime stream client.
 *
 * Tests stub-mode short-circuit + real-mode message dispatch using a
 * mock WebSocket constructor.
 */
import { describe, expect, it, vi } from "vitest";
import {
  getSignedWss,
  openCommentaryStream,
} from "@/lib/audio/elevenlabs-stream";

describe("getSignedWss", () => {
  it("calls the sign endpoint with POST", async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        url: "wss://example/test",
        voiceId: "v1",
        expiresAt: Date.now() + 60_000,
        signed: true,
      }),
    }));
    const r = await getSignedWss({}, fakeFetch as unknown as typeof fetch);
    expect(fakeFetch).toHaveBeenCalledWith("/api/commentary/sign", {
      method: "POST",
    });
    expect(r.signed).toBe(true);
  });

  it("throws when the sign endpoint 5xxs", async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    }));
    await expect(
      getSignedWss({}, fakeFetch as unknown as typeof fetch),
    ).rejects.toThrow(/sign failed: 503/);
  });
});

describe("openCommentaryStream, stub mode", () => {
  it("emits stub + final without opening a websocket", async () => {
    const events: string[] = [];
    const handle = await openCommentaryStream(
      {
        url: "stub://commentary",
        voiceId: "stub-voice",
        expiresAt: 0,
        signed: false,
      },
      (msg) => events.push(msg.kind),
    );

    // Wait for queued microtasks.
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["stub", "final"]);
    handle.close(); // no-op
    handle.sendText("hello"); // no-op
  });
});

describe("openCommentaryStream, real mode", () => {
  it("dispatches binary frames as audio", async () => {
    const events: Array<{ kind: string; size?: number }> = [];

    class MockWS {
      readyState = 1;
      binaryType = "blob" as BinaryType;
      onmessage?: (ev: MessageEvent) => void;
      onerror?: () => void;
      onclose?: () => void;
      sentTexts: string[] = [];
      constructor(public url: string) {}
      close() {
        this.onclose?.();
      }
      send(payload: string) {
        this.sentTexts.push(payload);
      }
      simulate(data: ArrayBuffer | string) {
        this.onmessage?.({ data } as MessageEvent);
      }
    }

    const ws: MockWS[] = [];
    const ctor = function (url: string) {
      const inst = new MockWS(url);
      ws.push(inst);
      return inst;
    } as unknown as typeof WebSocket;

    const handle = await openCommentaryStream(
      {
        url: "wss://example/test",
        voiceId: "v",
        expiresAt: Date.now() + 60_000,
        signed: true,
      },
      (msg) => {
        if (msg.kind === "audio") {
          events.push({ kind: msg.kind, size: msg.data.byteLength });
        } else {
          events.push({ kind: msg.kind });
        }
      },
      { WebSocketImpl: ctor },
    );

    expect(ws.length).toBe(1);
    const buf = new ArrayBuffer(64);
    ws[0].simulate(buf);
    expect(events.find((e) => e.kind === "audio")).toEqual({
      kind: "audio",
      size: 64,
    });

    handle.sendText("hello");
    expect(ws[0].sentTexts).toEqual([JSON.stringify({ text: "hello" })]);

    // Server-side error frame.
    ws[0].simulate(JSON.stringify({ type: "error", message: "boom" }));
    expect(events.find((e) => e.kind === "error")).toEqual({
      kind: "error",
    });

    handle.close();
    expect(events.find((e) => e.kind === "final")).toEqual({ kind: "final" });
  });
});
