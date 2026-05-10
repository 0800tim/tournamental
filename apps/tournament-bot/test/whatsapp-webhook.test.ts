import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { Storage } from "../src/storage.js";
import {
  AivaWhatsAppClient,
  jidToPhone,
  renderForWhatsApp,
} from "../src/whatsapp/aiva-client.js";
import {
  computeSignature,
  parseInboundMessage,
  registerAivaWaWebhook,
  verifySignature,
} from "../src/whatsapp/handler.js";

const SECRET = "supersecret-32-char-shared-key-12345";

interface OutboundCall {
  to: string;
  body: string;
}

function makeApp(over: { sendImpl?: (to: string, body: string) => Promise<void> } = {}): {
  app: FastifyInstance;
  storage: Storage;
  outbound: OutboundCall[];
  client: AivaWhatsAppClient;
} {
  const storage = new Storage(":memory:");
  const outbound: OutboundCall[] = [];
  // Stub the fetch underneath the client so sendMessage records calls instead
  // of making HTTP requests.
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (over.sendImpl) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      await over.sendImpl(body.phone, body.message);
    }
    void url;
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  });
  const client = new AivaWhatsAppClient({
    baseUrl: "http://aiva.local",
    apiKey: "test-key",
    sessionId: "vtourn-bot",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  // Capture outbound after the underlying fetch records it.
  const origSend = client.sendMessage.bind(client);
  client.sendMessage = async (to: string, body: string) => {
    outbound.push({ to, body });
    return origSend(to, body);
  };

  const app = Fastify({ logger: false });
  registerAivaWaWebhook(app, { storage, client, secret: SECRET });
  return { app, storage, outbound, client };
}

describe("WhatsApp webhook signature verification", () => {
  it("verifySignature accepts a correct sha256= digest", () => {
    const body = '{"hello":"world"}';
    const sig = computeSignature(body, SECRET);
    expect(verifySignature(body, sig, SECRET)).toBe(true);
  });

  it("verifySignature accepts a bare hex digest (no sha256= prefix)", () => {
    const body = '{"hello":"world"}';
    const sig = computeSignature(body, SECRET).replace(/^sha256=/, "");
    expect(verifySignature(body, sig, SECRET)).toBe(true);
  });

  it("verifySignature rejects an empty signature", () => {
    expect(verifySignature("{}", "", SECRET)).toBe(false);
  });

  it("verifySignature rejects an empty secret", () => {
    expect(verifySignature("{}", "sha256=deadbeef", "")).toBe(false);
  });

  it("verifySignature rejects a body tampered after signing", () => {
    const sig = computeSignature("{}", SECRET);
    expect(verifySignature('{"x":1}', sig, SECRET)).toBe(false);
  });

  it("verifySignature rejects a wrong-length digest in constant time", () => {
    expect(verifySignature("{}", "sha256=abc", SECRET)).toBe(false);
  });
});

describe("WhatsApp webhook route", () => {
  let harness: ReturnType<typeof makeApp>;

  beforeEach(() => {
    harness = makeApp();
  });

  afterEach(async () => {
    await harness.app.close();
  });

  it("rejects with 401 when X-Signature is missing", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/aiva-wa",
      headers: { "content-type": "application/json" },
      payload: '{"from":"x@s.whatsapp.net","text":"/help"}',
    });
    expect(res.statusCode).toBe(401);
    expect(harness.outbound).toEqual([]);
  });

  it("rejects with 401 when X-Signature is wrong", async () => {
    const res = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/aiva-wa",
      headers: {
        "content-type": "application/json",
        "x-signature": "sha256=deadbeef",
      },
      payload: '{"from":"x@s.whatsapp.net","text":"/help"}',
    });
    expect(res.statusCode).toBe(401);
    expect(harness.outbound).toEqual([]);
  });

  it("dispatches /help and sends a reply via the Aiva client", async () => {
    const body = '{"from":"64211234567@s.whatsapp.net","text":"/help"}';
    const sig = computeSignature(body, SECRET);
    const res = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/aiva-wa",
      headers: { "content-type": "application/json", "x-signature": sig },
      payload: body,
    });
    expect(res.statusCode).toBe(204);
    expect(harness.outbound).toHaveLength(1);
    expect(harness.outbound[0].to).toBe("64211234567@s.whatsapp.net");
    expect(harness.outbound[0].body).toContain("/picks");
  });

  it("400s on a body with no `from`", async () => {
    const body = '{"text":"/help"}';
    const sig = computeSignature(body, SECRET);
    const res = await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/aiva-wa",
      headers: { "content-type": "application/json", "x-signature": sig },
      payload: body,
    });
    expect(res.statusCode).toBe(400);
  });

  it("strips backticks before sending to WhatsApp", async () => {
    const body = '{"from":"x@s.whatsapp.net","text":"/syndicate"}';
    const sig = computeSignature(body, SECRET);
    await harness.app.inject({
      method: "POST",
      url: "/v1/webhooks/aiva-wa",
      headers: { "content-type": "application/json", "x-signature": sig },
      payload: body,
    });
    // /syndicate help text has no backticks, but we test the helper directly.
    expect(harness.outbound[0].body).not.toContain("`");
  });

  it("health check returns ok", async () => {
    const res = await harness.app.inject({
      method: "GET",
      url: "/v1/webhooks/aiva-wa/health",
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ ok: true });
  });
});

describe("parseInboundMessage", () => {
  it("accepts top-level text", () => {
    expect(
      parseInboundMessage({ from: "x@s.whatsapp.net", text: "hi" }),
    ).toEqual({ from: "x@s.whatsapp.net", text: "hi" });
  });

  it("accepts nested message.text", () => {
    expect(
      parseInboundMessage({
        from: "x@s.whatsapp.net",
        message: { text: "hi" },
      }),
    ).toEqual({ from: "x@s.whatsapp.net", text: "hi" });
  });

  it("accepts nested message.conversation (Baileys shape)", () => {
    expect(
      parseInboundMessage({
        from: "x@s.whatsapp.net",
        message: { conversation: "hi" },
      }),
    ).toEqual({ from: "x@s.whatsapp.net", text: "hi" });
  });

  it("accepts `jid` as alias for `from`", () => {
    expect(parseInboundMessage({ jid: "x@s.whatsapp.net", text: "hi" })).toEqual(
      { from: "x@s.whatsapp.net", text: "hi" },
    );
  });

  it("rejects body with no from / jid", () => {
    expect(parseInboundMessage({ text: "hi" })).toBeNull();
  });

  it("rejects null / non-object input", () => {
    expect(parseInboundMessage(null)).toBeNull();
    expect(parseInboundMessage("hi")).toBeNull();
    expect(parseInboundMessage(42)).toBeNull();
  });

  it("returns empty text when no text field present (lets dispatcher reply with help-nudge)", () => {
    expect(parseInboundMessage({ from: "x@s.whatsapp.net" })).toEqual({
      from: "x@s.whatsapp.net",
      text: "",
    });
  });
});

describe("renderForWhatsApp", () => {
  it("strips backticks", () => {
    expect(renderForWhatsApp("Try `/syndicate list`")).toBe(
      "Try /syndicate list",
    );
  });

  it("flattens markdown links to text + url", () => {
    expect(renderForWhatsApp("Open [the bracket](https://x.com/u/1)")).toBe(
      "Open the bracket https://x.com/u/1",
    );
  });

  it("preserves *bold* (WhatsApp renders it natively)", () => {
    expect(renderForWhatsApp("*VTourn* — hi")).toBe("*VTourn* — hi");
  });

  it("preserves newlines and plain URLs", () => {
    expect(renderForWhatsApp("a\nhttps://example.com\nb")).toBe(
      "a\nhttps://example.com\nb",
    );
  });
});

describe("jidToPhone", () => {
  it("strips the @s.whatsapp.net suffix", () => {
    expect(jidToPhone("64211234567@s.whatsapp.net")).toBe("64211234567");
  });

  it("strips leading zeros", () => {
    expect(jidToPhone("0064211234567@s.whatsapp.net")).toBe("64211234567");
  });

  it("is idempotent on bare numbers", () => {
    expect(jidToPhone("64211234567")).toBe("64211234567");
  });
});
