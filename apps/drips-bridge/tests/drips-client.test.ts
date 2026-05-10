import { describe, expect, it } from 'vitest';
import {
  DRIPS_WEIGHT_TOTAL,
  MockDripsClient,
  RealDripsClient,
  makeDripsClient,
  payoutsToWeights,
} from '../src/lib/drips-client.js';

const A = '0x' + 'a'.repeat(40);
const B = '0x' + 'b'.repeat(40);
const C = '0x' + 'c'.repeat(40);

describe('payoutsToWeights', () => {
  it('returns weights summing to 1_000_000', () => {
    const weights = payoutsToWeights([
      { recipient: A, payoutUsd: 30 },
      { recipient: B, payoutUsd: 70 },
    ]);
    const total = weights.reduce((acc, w) => acc + w.weight, 0);
    expect(total).toBe(DRIPS_WEIGHT_TOTAL);
    const aw = weights.find((w) => w.recipient === A)!;
    expect(aw.weight).toBe(300_000);
  });

  it('reconciles rounding remainder to the largest recipient', () => {
    const weights = payoutsToWeights([
      { recipient: A, payoutUsd: 33.33 },
      { recipient: B, payoutUsd: 33.33 },
      { recipient: C, payoutUsd: 33.34 },
    ]);
    const total = weights.reduce((acc, w) => acc + w.weight, 0);
    expect(total).toBe(DRIPS_WEIGHT_TOTAL);
    // The recipient with the highest USD payout should be the largest weight.
    const sorted = [...weights].sort((x, y) => y.weight - x.weight);
    expect(sorted[0].recipient).toBe(C);
  });

  it('returns [] for empty input', () => {
    expect(payoutsToWeights([])).toEqual([]);
  });

  it('returns [] when total payouts are zero', () => {
    expect(
      payoutsToWeights([
        { recipient: A, payoutUsd: 0 },
        { recipient: B, payoutUsd: 0 },
      ]),
    ).toEqual([]);
  });
});

describe('MockDripsClient.setSplits', () => {
  it('returns a deterministic-looking tx hash', async () => {
    const client = new MockDripsClient({ now: () => 1234567890 });
    const res = await client.setSplits([{ recipient: A, weight: 1_000_000 }]);
    expect(res.ok).toBe(true);
    expect(res.backend).toBe('mock');
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(res.recipientCount).toBe(1);
  });

  it('rejects empty splits', async () => {
    const client = new MockDripsClient();
    await expect(client.setSplits([])).rejects.toThrow(/at least one/);
  });

  it('rejects total weight > DRIPS_WEIGHT_TOTAL', async () => {
    const client = new MockDripsClient();
    await expect(
      client.setSplits([
        { recipient: A, weight: 600_000 },
        { recipient: B, weight: 600_000 },
      ]),
    ).rejects.toThrow(/exceeds/);
  });

  it('rejects malformed recipient address', async () => {
    const client = new MockDripsClient();
    await expect(
      client.setSplits([{ recipient: 'not-an-address', weight: 1_000_000 }]),
    ).rejects.toThrow(/invalid recipient/);
  });

  it('rejects negative weights', async () => {
    const client = new MockDripsClient();
    await expect(
      client.setSplits([{ recipient: A, weight: -1 }]),
    ).rejects.toThrow(/>= 0/);
  });
});

describe('MockDripsClient.pushPayout', () => {
  it('returns deterministic tx hash with period+amount', async () => {
    const client = new MockDripsClient({ now: () => 1234567890 });
    const res = await client.pushPayout('d_abc', 1500);
    expect(res.ok).toBe(true);
    expect(res.backend).toBe('mock');
    expect(res.periodId).toBe('d_abc');
    expect(res.totalAmountUsd).toBe(1500);
    expect(res.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('rejects missing periodId', async () => {
    const client = new MockDripsClient();
    await expect(client.pushPayout('', 100)).rejects.toThrow(/periodId/);
  });

  it('rejects non-positive amount', async () => {
    const client = new MockDripsClient();
    await expect(client.pushPayout('d_a', 0)).rejects.toThrow(/> 0/);
    await expect(client.pushPayout('d_a', -100)).rejects.toThrow(/> 0/);
    await expect(client.pushPayout('d_a', NaN)).rejects.toThrow(/> 0/);
  });
});

describe('RealDripsClient', () => {
  it('throws on construction without required env', () => {
    expect(() => new RealDripsClient({})).toThrow(/rpcUrl/);
    expect(() =>
      new RealDripsClient({ rpcUrl: 'https://x' }),
    ).toThrow(/accountAddress/);
    expect(() =>
      new RealDripsClient({ rpcUrl: 'https://x', accountAddress: A }),
    ).toThrow(/privateKey/);
  });

  it('refuses to setSplits even when fully configured (audit gate)', async () => {
    const client = new RealDripsClient({
      rpcUrl: 'https://example',
      accountAddress: A,
      privateKey: '0x' + '1'.repeat(64),
      dripListId: '12345',
    });
    await expect(
      client.setSplits([{ recipient: B, weight: 1_000_000 }]),
    ).rejects.toThrow(/audit-gated/);
  });

  it('refuses to pushPayout even when fully configured (audit gate)', async () => {
    const client = new RealDripsClient({
      rpcUrl: 'https://example',
      accountAddress: A,
      privateKey: '0x' + '1'.repeat(64),
      dripListId: '12345',
    });
    await expect(client.pushPayout('d_a', 1)).rejects.toThrow(/audit-gated/);
  });
});

describe('makeDripsClient', () => {
  it('defaults to mock', () => {
    const c = makeDripsClient();
    expect(c.backend).toBe('mock');
  });

  it('honours explicit mock backend', () => {
    const c = makeDripsClient({ backend: 'mock' });
    expect(c.backend).toBe('mock');
  });
});
