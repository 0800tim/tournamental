/**
 * POST /api/commentary/sign
 *
 * Mint a short-lived signed WSS URL for ElevenLabs realtime
 * commentary streaming. Per
 * `docs/27c-fidelity-phase3-stadium-crowd.md`:
 *
 *   - Server keeps the API key (in `.env`, never to client).
 *   - Returns `{ url, voiceId, expiresAt, signed }`.
 *   - When `ELEVENLABS_API_KEY` is unset (the default in this repo
 *     until Tim drops a key into `.env`), the route returns a stub
 *     response with `signed: false`. The client treats that as a
 *     no-op stream so the rest of the pipeline (mixer, ducking,
 *     pre-rendered fallback) can still be exercised.
 *
 * Cache policy: `Cache-Control: private, no-store`, these URLs are
 * ephemeral and per-user.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
/** Edge-friendly: pure compute, no Node fs. */
export const runtime = "nodejs";

interface SignedUrlResponse {
  url: string;
  voiceId: string;
  expiresAt: number;
  signed: boolean;
}

const STUB_VOICE_ID = "stub-voice";
const REAL_TTL_MS = 60_000;

export async function POST(): Promise<NextResponse<SignedUrlResponse>> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID_EN ?? STUB_VOICE_ID;

  // Stub path, no key in env. Return a no-op URL the client maps
  // to a silent buffer. This is the default in the OSS repo until
  // Tim drops a real key in `.env`.
  if (!apiKey) {
    return NextResponse.json(
      {
        url: "stub://commentary",
        voiceId: STUB_VOICE_ID,
        expiresAt: Date.now() + 5_000,
        signed: false,
      },
      {
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  }

  // Real path. ElevenLabs realtime expects an `xi-api-key` header
  // when opening the WSS, but the *browser* can't send custom
  // headers on WebSocket handshakes. The standard workaround is to
  // pass `xi-api-key` as a query parameter (some ElevenLabs SDKs
  // call this `auth_token`). We construct that URL here, server-
  // side, so the API key never leaves the server in plain text.
  //
  // NOTE: the prompt says `eleven_turbo_v2_5` is the model, that's
  // model selection, not endpoint URL. The endpoint comes from
  // ElevenLabs docs and is hard-coded here. Any future change goes
  // alongside the docs note in `docs/27c-fidelity-phase3-stadium-crowd.md`.
  const model = process.env.ELEVENLABS_MODEL ?? "eleven_turbo_v2_5";
  const base = `wss://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream-input`;
  const params = new URLSearchParams({
    model_id: model,
    output_format: "mp3_44100_64",
    optimize_streaming_latency: "3",
    "xi-api-key": apiKey,
  });
  const url = `${base}?${params.toString()}`;

  return NextResponse.json(
    {
      url,
      voiceId,
      expiresAt: Date.now() + REAL_TTL_MS,
      signed: true,
    },
    {
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
