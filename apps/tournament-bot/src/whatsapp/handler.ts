// POST /v1/webhooks/aiva-wa — inbound WhatsApp from the Aiva gateway.
//
// The gateway POSTs each inbound message as JSON. We HMAC-verify the body
// against AIVA_WEBHOOK_SECRET *before* parsing, then normalise into the
// dispatcher contract.
//
// Expected body shape (Aiva gateway):
//
//   {
//     "session_id": "tournamental-bot",
//     "from": "64211234567@s.whatsapp.net",
//     "message": { "text": "/help" },          // or "body"/"text" at top level
//     "timestamp": 1715300000000
//   }
//
// We're tolerant on the location of the text field because the Aiva
// gateway has shifted its inbound shape twice in the last quarter.
//
// Outbound replies go through `AivaWhatsAppClient.sendMessage`. If the
// dispatcher returns multiple replies we send them sequentially (the
// gateway rate-limits per-jid bursts).

import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { dispatch } from "../lib/dispatch.js";
import type { Storage } from "../storage.js";
import { AivaWhatsAppClient, renderForWhatsApp } from "./aiva-client.js";

export interface AivaWaWebhookOpts {
  storage: Storage;
  client: AivaWhatsAppClient;
  /** Shared secret used to HMAC-verify inbound bodies. */
  secret: string;
  /** Optional fetch override for downstream API calls (odds, leaderboard). */
  fetch?: typeof fetch;
  /** Optional path override; defaults to /v1/webhooks/aiva-wa. */
  path?: string;
}

export function registerAivaWaWebhook(
  app: FastifyInstance,
  opts: AivaWaWebhookOpts,
): void {
  const path = opts.path ?? "/v1/webhooks/aiva-wa";

  // We need the raw body for signature verification. Fastify parses JSON
  // by default and discards the raw bytes; register a content parser that
  // keeps both.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      try {
        const parsed = body.length === 0 ? {} : JSON.parse(body as string);
        // Stash the raw string on the request for the route handler.
        (parsed as { __raw?: string }).__raw = body as string;
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.post(path, async (req: FastifyRequest, reply: FastifyReply) => {
    const supplied = req.headers["x-signature"];
    const sig = Array.isArray(supplied) ? supplied[0] : supplied;
    const rawBody =
      (req.body as { __raw?: string } | undefined)?.__raw ?? "";

    if (!verifySignature(rawBody, sig ?? "", opts.secret)) {
      reply.code(401).send({ error: "bad_signature" });
      return;
    }

    const inbound = parseInboundMessage(req.body);
    if (!inbound) {
      reply.code(400).send({ error: "bad_payload" });
      return;
    }

    let replies;
    try {
      replies = await dispatch(
        {
          source: "whatsapp",
          sourceId: inbound.from,
          text: inbound.text,
        },
        { storage: opts.storage, fetch: opts.fetch },
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[aiva-wa] dispatch failed", err);
      reply.code(500).send({ error: "dispatch_failed" });
      return;
    }

    for (const r of replies) {
      const outbound = renderForWhatsApp(r.text);
      const result = await opts.client.sendMessage(inbound.from, outbound);
      if (!result.ok) {
        // eslint-disable-next-line no-console
        console.warn("[aiva-wa] outbound send failed", {
          status: result.status,
          error: result.error,
        });
      }
    }

    reply.code(204).send();
  });

  app.get("/v1/webhooks/aiva-wa/health", async () => ({ ok: true }));
}

// ---- helpers ------------------------------------------------------------

export interface InboundWaMessage {
  from: string;
  text: string;
}

export function parseInboundMessage(
  body: unknown,
): InboundWaMessage | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const from =
    (typeof b.from === "string" && b.from) ||
    (typeof b.jid === "string" && b.jid) ||
    "";
  if (!from) return null;
  const msgObj = b.message;
  let text = "";
  if (typeof b.text === "string") text = b.text;
  else if (typeof b.body === "string") text = b.body;
  else if (msgObj && typeof msgObj === "object") {
    const m = msgObj as Record<string, unknown>;
    if (typeof m.text === "string") text = m.text;
    else if (typeof m.body === "string") text = m.body;
    else if (typeof m.conversation === "string") text = m.conversation;
  }
  if (typeof text !== "string") return null;
  return { from, text };
}

/**
 * Constant-time HMAC-SHA256 verification. Accepts either a raw hex digest
 * or a `sha256=<hex>` prefix to match GitHub's webhook convention which
 * other Aiva consumers also use.
 */
export function verifySignature(
  rawBody: string,
  supplied: string,
  secret: string,
): boolean {
  if (!secret || !supplied) return false;
  const stripped = supplied.startsWith("sha256=")
    ? supplied.slice("sha256=".length)
    : supplied;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("hex");
  if (expected.length !== stripped.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, "hex"),
      Buffer.from(stripped, "hex"),
    );
  } catch {
    return false;
  }
}

export function computeSignature(rawBody: string, secret: string): string {
  return (
    "sha256=" +
    crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")
  );
}
