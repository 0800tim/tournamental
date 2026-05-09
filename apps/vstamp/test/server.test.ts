/**
 * End-to-end HTTP tests against an in-memory SQLite Fastify instance.
 *
 * Each test gets a fresh server via `freshServer()` so they don't leak DB
 * state into each other. better-sqlite3 supports `:memory:`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { sha256 } from '@noble/hashes/sha256';
import {
  bytesToHex,
  computeRootFromProof,
  hexToBytes,
  LEAF_PREFIX,
  NODE_PREFIX,
  concatBytes,
} from '../src/lib/merkle.js';
import { verifyHex } from '../src/lib/keys.js';
import { rootSigningMessage } from '../src/lib/receipts.js';

const ADMIN_TOKEN = 'test-admin-token-' + 'x'.repeat(48);
const PASSPHRASE = 'test-passphrase-' + 'y'.repeat(48);

const created: FastifyInstance[] = [];

async function freshServer() {
  const app = await buildServer({
    dbPath: ':memory:',
    adminToken: ADMIN_TOKEN,
    passphrase: PASSPHRASE,
    corsOrigins: ['http://localhost:3300'],
    logLevel: 'silent',
  });
  created.push(app);
  return app;
}

afterEach(async () => {
  while (created.length) {
    const app = created.pop()!;
    await app.close();
  }
});

describe('GET /', () => {
  it('returns service descriptor', async () => {
    const app = await freshServer();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.service).toBe('@vtorn/vstamp');
    expect(body.health).toBe('/healthz');
  });
});

describe('GET /healthz', () => {
  it('returns ok with tree_count and pubkey', async () => {
    const app = await freshServer();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.tree_count).toBe(0);
    expect(body.latest_root_age_seconds).toBe(null);
    expect(body.pubkey).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('POST /v1/vstamp/issue', () => {
  it('accepts valid issue and returns leaf+salt', async () => {
    const app = await freshServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/issue',
      payload: {
        bracket_canonical_json: { winner: 'ARG' },
        user_id: 'u_test',
        tournament_id: 'wc26',
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.leaf_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.salt).toMatch(/^[0-9a-f]{64}$/);
    expect(body.proof_pending).toBe(true);
    expect(body.day_bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('rejects missing fields', async () => {
    const app = await freshServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/issue',
      payload: { bracket_canonical_json: {} },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects float in bracket payload (canonicalisation rule)', async () => {
    const app = await freshServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/issue',
      payload: {
        bracket_canonical_json: { p: 0.5 },
        user_id: 'u',
        tournament_id: 't',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid_bracket');
  });
});

describe('POST /v1/vstamp/finalise', () => {
  it('requires admin token', async () => {
    const app = await freshServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/finalise/wc26',
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects wrong admin token', async () => {
    const app = await freshServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/finalise/wc26',
      headers: { Authorization: 'Bearer not-the-right-token' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects empty bucket', async () => {
    const app = await freshServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/finalise/wc26',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('empty_bucket');
  });

  it('finalises after issuing a leaf and is idempotent', async () => {
    const app = await freshServer();
    const issueRes = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/issue',
      payload: {
        bracket_canonical_json: { team: 'NZ' },
        user_id: 'u',
        tournament_id: 'tt',
      },
    });
    expect(issueRes.statusCode).toBe(200);
    const dayBucket = issueRes.json().day_bucket as string;

    const fin1 = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/finalise/tt',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { day_bucket: dayBucket },
    });
    expect(fin1.statusCode).toBe(200);
    const b1 = fin1.json();
    expect(b1.already_finalised).toBe(false);
    expect(b1.root_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(b1.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(b1.leaf_count).toBe(1);

    const fin2 = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/finalise/tt',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { day_bucket: dayBucket },
    });
    expect(fin2.statusCode).toBe(200);
    const b2 = fin2.json();
    expect(b2.already_finalised).toBe(true);
    expect(b2.root_hash).toBe(b1.root_hash);
    expect(b2.signature).toBe(b1.signature);
  });

  it('rejects further issues into a finalised bucket', async () => {
    const app = await freshServer();
    const issue = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/issue',
      payload: {
        bracket_canonical_json: { a: 1 },
        user_id: 'u',
        tournament_id: 'closed',
      },
    });
    const dayBucket = issue.json().day_bucket;

    await app.inject({
      method: 'POST',
      url: '/v1/vstamp/finalise/closed',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { day_bucket: dayBucket },
    });

    const issue2 = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/issue',
      payload: {
        bracket_canonical_json: { a: 2 },
        user_id: 'u2',
        tournament_id: 'closed',
      },
    });
    expect(issue2.statusCode).toBe(409);
    expect(issue2.json().error).toBe('bucket_already_finalised');
  });
});

describe('GET /v1/vstamp/proof', () => {
  it('returns 404 for unknown leaf', async () => {
    const app = await freshServer();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/vstamp/proof/${'a'.repeat(64)}`,
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 for malformed leaf hash', async () => {
    const app = await freshServer();
    const res = await app.inject({ method: 'GET', url: '/v1/vstamp/proof/not-hex' });
    expect(res.statusCode).toBe(400);
  });

  it('returns proof_pending: true while bucket unfinalised', async () => {
    const app = await freshServer();
    const issue = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/issue',
      payload: { bracket_canonical_json: { x: 1 }, user_id: 'u', tournament_id: 't' },
    });
    const leaf = issue.json().leaf_hash;
    const res = await app.inject({ method: 'GET', url: `/v1/vstamp/proof/${leaf}` });
    expect(res.statusCode).toBe(202);
    expect(res.json().proof_pending).toBe(true);
  });

  it('returns full proof + signed root once finalised', async () => {
    const app = await freshServer();
    const issue = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/issue',
      payload: { bracket_canonical_json: { x: 1 }, user_id: 'u', tournament_id: 't' },
    });
    const { leaf_hash, day_bucket } = issue.json();

    await app.inject({
      method: 'POST',
      url: '/v1/vstamp/finalise/t',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { day_bucket },
    });

    const res = await app.inject({ method: 'GET', url: `/v1/vstamp/proof/${leaf_hash}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.leaf_hash).toBe(leaf_hash);
    expect(Array.isArray(body.proof)).toBe(true);
    expect(body.root_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(body.pubkey).toMatch(/^[0-9a-f]{64}$/);
    expect(body.verification.hash).toBe('sha256');
    expect(body.verification.curve).toBe('ed25519');
    expect(res.headers['cache-control']).toContain('public');

    // Independent verification: re-derive the root from the leaf + proof
    // and verify the signature using only the data in the response.
    const computed = computeRootFromProof(body.leaf_hash, body.proof);
    expect(bytesToHex(computed)).toBe(body.root_hash);
    expect(verifyHex(body.pubkey, rootSigningMessage(body.root_hash), body.signature)).toBe(true);
  });
});

describe('GET /v1/vstamp/root/:tournament_id/:date', () => {
  it('404 when not finalised', async () => {
    const app = await freshServer();
    const res = await app.inject({ method: 'GET', url: '/v1/vstamp/root/foo/2026-05-10' });
    expect(res.statusCode).toBe(404);
  });

  it('400 on bad date', async () => {
    const app = await freshServer();
    const res = await app.inject({ method: 'GET', url: '/v1/vstamp/root/foo/not-a-date' });
    expect(res.statusCode).toBe(400);
  });

  it('returns signed root after finalise', async () => {
    const app = await freshServer();
    const issue = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/issue',
      payload: { bracket_canonical_json: { y: 1 }, user_id: 'u', tournament_id: 'tour' },
    });
    const { day_bucket } = issue.json();
    await app.inject({
      method: 'POST',
      url: '/v1/vstamp/finalise/tour',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { day_bucket },
    });
    const res = await app.inject({
      method: 'GET',
      url: `/v1/vstamp/root/tour/${day_bucket}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().leaf_count).toBe(1);
    expect(res.headers['cache-control']).toContain('public');
  });
});

describe('POST /v1/vstamp/verify', () => {
  it('valid:true for a real receipt round-trip', async () => {
    const app = await freshServer();
    // issue, finalise, fetch proof, then submit to verify
    const issue = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/issue',
      payload: { bracket_canonical_json: { v: 1 }, user_id: 'u', tournament_id: 'tv' },
    });
    const { leaf_hash, day_bucket } = issue.json();

    await app.inject({
      method: 'POST',
      url: '/v1/vstamp/finalise/tv',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { day_bucket },
    });

    const proofRes = await app.inject({ method: 'GET', url: `/v1/vstamp/proof/${leaf_hash}` });
    const p = proofRes.json();

    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/verify',
      payload: {
        leaf_hash: p.leaf_hash,
        proof: p.proof,
        claimed_root: p.root_hash,
        signature: p.signature,
        pubkey: p.pubkey,
      },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json()).toEqual({ valid: true });
  });

  it('valid:false reason root_mismatch for tampered proof', async () => {
    const app = await freshServer();
    const issue = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/issue',
      payload: { bracket_canonical_json: { v: 2 }, user_id: 'u', tournament_id: 'tv2' },
    });
    const { leaf_hash, day_bucket } = issue.json();
    await app.inject({
      method: 'POST',
      url: '/v1/vstamp/finalise/tv2',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { day_bucket },
    });
    const proofRes = await app.inject({ method: 'GET', url: `/v1/vstamp/proof/${leaf_hash}` });
    const p = proofRes.json();
    // tamper claimed_root
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/verify',
      payload: {
        leaf_hash: p.leaf_hash,
        proof: p.proof,
        claimed_root: '0'.repeat(64),
        signature: p.signature,
        pubkey: p.pubkey,
      },
    });
    expect(verifyRes.statusCode).toBe(200);
    expect(verifyRes.json().valid).toBe(false);
    expect(verifyRes.json().reason).toBe('root_mismatch');
  });

  it('valid:false reason signature_invalid for wrong pubkey', async () => {
    const app = await freshServer();
    const issue = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/issue',
      payload: { bracket_canonical_json: { v: 3 }, user_id: 'u', tournament_id: 'tv3' },
    });
    const { leaf_hash, day_bucket } = issue.json();
    await app.inject({
      method: 'POST',
      url: '/v1/vstamp/finalise/tv3',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      payload: { day_bucket },
    });
    const proofRes = await app.inject({ method: 'GET', url: `/v1/vstamp/proof/${leaf_hash}` });
    const p = proofRes.json();
    const verifyRes = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/verify',
      payload: {
        leaf_hash: p.leaf_hash,
        proof: p.proof,
        claimed_root: p.root_hash,
        signature: p.signature,
        pubkey: 'aa'.repeat(32),
      },
    });
    expect(verifyRes.json().valid).toBe(false);
    expect(verifyRes.json().reason).toBe('signature_invalid');
  });

  it('400 on malformed input', async () => {
    const app = await freshServer();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/vstamp/verify',
      payload: { leaf_hash: 'bad' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('persistence: signing key survives a restart', () => {
  it('reopens existing DB and re-uses the same pubkey', async () => {
    const path = `:memory:`;
    // For this we need a real file path because :memory: is per-connection.
    // Use a temp file.
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { rmSync } = await import('node:fs');
    const dbPath = join(tmpdir(), `vstamp-test-${Date.now()}-${Math.random()}.db`);

    const app1 = await buildServer({
      dbPath,
      adminToken: ADMIN_TOKEN,
      passphrase: PASSPHRASE,
      corsOrigins: [],
      logLevel: 'silent',
    });
    const h1 = await app1.inject({ method: 'GET', url: '/healthz' });
    const pubkey1 = h1.json().pubkey;
    await app1.close();

    const app2 = await buildServer({
      dbPath,
      adminToken: ADMIN_TOKEN,
      passphrase: PASSPHRASE,
      corsOrigins: [],
      logLevel: 'silent',
    });
    const h2 = await app2.inject({ method: 'GET', url: '/healthz' });
    const pubkey2 = h2.json().pubkey;
    await app2.close();

    expect(pubkey1).toBe(pubkey2);
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-shm`, { force: true });
    rmSync(`${dbPath}-wal`, { force: true });
    void path;
  });
});

describe('domain separation regression', () => {
  it('a malicious leaf cannot equal a node hash', () => {
    // Just a sanity assertion that the prefixes are different bytes,
    // mirroring the Merkle test but at the API layer's level of concern.
    expect(LEAF_PREFIX[0]).not.toBe(NODE_PREFIX[0]);
    const x = new TextEncoder().encode('payload');
    const lh = sha256(concatBytes(LEAF_PREFIX, x));
    const nh = sha256(concatBytes(NODE_PREFIX, x, x));
    expect(bytesToHex(lh)).not.toBe(bytesToHex(nh));
    // and the verifier never accepts non-32-byte input
    expect(() => hexToBytes('zz'.repeat(32))).toThrow();
  });
});
