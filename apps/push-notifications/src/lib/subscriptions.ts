/**
 * Subscription store — in-memory + JSONL on disk.
 *
 * Each subscription is keyed by (userId, channel). One user can have at
 * most one active subscription per channel. JSONL append-on-write means
 * the file grows over time but the in-memory map always reflects the most
 * recent record per (userId, channel) tuple — a `tombstone: true` record
 * marks a removal.
 *
 * Match-pick associations are also tracked here: a tiny `picks` map of
 * matchId → Set<userId>, so the kickoff_soon and match_result endpoints
 * can fan out to "everyone who picked this match". Picks are seeded via
 * `recordPick` (called by tests / future API integration); v0.1 makes no
 * assumption about who feeds them — when the Game service exists, it'll
 * call `POST /v1/picks/record`.
 */

import { promises as fs } from 'node:fs';
import { dirname } from 'node:path';
import type { WebPushSubscription } from './web-push.js';

export type Channel = 'web-push' | 'telegram' | 'sms' | 'whatsapp' | 'native';

export type NativePlatform = 'ios' | 'android';

export interface WebPushRecord {
  channel: 'web-push';
  userId: string;
  subscription: WebPushSubscription;
  consent: true;
  createdAt: string;
}

export interface TelegramRecord {
  channel: 'telegram';
  userId: string;
  telegramUserId: string;
  consent: true;
  createdAt: string;
}

export interface SmsRecord {
  channel: 'sms';
  userId: string;
  phone: string; // E.164
  consent: true;
  createdAt: string;
}

export interface WhatsAppRecord {
  channel: 'whatsapp';
  userId: string;
  phone: string; // E.164
  consent: true;
  createdAt: string;
}

/**
 * Native push subscription. The `token` is whatever the native plugin
 * surfaces — APNs device-token (iOS) or FCM registration token (Android).
 * One user can register one device per platform; later we'll widen to a
 * (userId, deviceId) tuple but v0.1 keeps the (userId, channel) shape.
 */
export interface NativeRecord {
  channel: 'native';
  userId: string;
  platform: NativePlatform;
  token: string;
  consent: true;
  createdAt: string;
}

export type SubscriptionRecord =
  | WebPushRecord
  | TelegramRecord
  | SmsRecord
  | WhatsAppRecord
  | NativeRecord;

export interface PickRecord {
  matchId: string;
  userId: string;
  /** "home_win" | "draw" | "away_win" — keeps result fan-out tightly typed. */
  outcome: 'home_win' | 'draw' | 'away_win';
  createdAt: string;
}

interface JsonlLine {
  type: 'subscription' | 'tombstone' | 'pick' | 'pick-tombstone';
  data: unknown;
}

export class SubscriptionStore {
  private readonly subs = new Map<string, SubscriptionRecord>();
  private readonly picks = new Map<string, Map<string, PickRecord>>();
  private filePath: string | null = null;

  /** Build a fresh in-memory store. Call `loadFromFile` after to hydrate. */
  static memory(): SubscriptionStore {
    return new SubscriptionStore();
  }

  async useFile(path: string): Promise<void> {
    this.filePath = path;
    await fs.mkdir(dirname(path), { recursive: true });
    await this.loadFromFile();
  }

  private subKey(userId: string, channel: Channel): string {
    return `${channel}:${userId}`;
  }

  private pickKey(matchId: string, userId: string): string {
    return `${matchId}:${userId}`;
  }

  async upsertWebPush(
    userId: string,
    subscription: WebPushSubscription,
  ): Promise<WebPushRecord> {
    const rec: WebPushRecord = {
      channel: 'web-push',
      userId,
      subscription,
      consent: true,
      createdAt: new Date().toISOString(),
    };
    this.subs.set(this.subKey(userId, 'web-push'), rec);
    await this.append({ type: 'subscription', data: rec });
    return rec;
  }

  async upsertTelegram(
    userId: string,
    telegramUserId: string,
  ): Promise<TelegramRecord> {
    const rec: TelegramRecord = {
      channel: 'telegram',
      userId,
      telegramUserId,
      consent: true,
      createdAt: new Date().toISOString(),
    };
    this.subs.set(this.subKey(userId, 'telegram'), rec);
    await this.append({ type: 'subscription', data: rec });
    return rec;
  }

  async upsertSms(userId: string, phone: string): Promise<SmsRecord> {
    const e164 = phone.startsWith('+') ? phone : `+${phone}`;
    const rec: SmsRecord = {
      channel: 'sms',
      userId,
      phone: e164,
      consent: true,
      createdAt: new Date().toISOString(),
    };
    this.subs.set(this.subKey(userId, 'sms'), rec);
    await this.append({ type: 'subscription', data: rec });
    return rec;
  }

  async upsertNative(
    userId: string,
    platform: NativePlatform,
    token: string,
  ): Promise<NativeRecord> {
    const rec: NativeRecord = {
      channel: 'native',
      userId,
      platform,
      token,
      consent: true,
      createdAt: new Date().toISOString(),
    };
    this.subs.set(this.subKey(userId, 'native'), rec);
    await this.append({ type: 'subscription', data: rec });
    return rec;
  }

  async upsertWhatsApp(
    userId: string,
    phone: string,
  ): Promise<WhatsAppRecord> {
    const e164 = phone.startsWith('+') ? phone : `+${phone}`;
    const rec: WhatsAppRecord = {
      channel: 'whatsapp',
      userId,
      phone: e164,
      consent: true,
      createdAt: new Date().toISOString(),
    };
    this.subs.set(this.subKey(userId, 'whatsapp'), rec);
    await this.append({ type: 'subscription', data: rec });
    return rec;
  }

  async remove(userId: string, channel: Channel): Promise<boolean> {
    const key = this.subKey(userId, channel);
    if (!this.subs.has(key)) return false;
    this.subs.delete(key);
    await this.append({
      type: 'tombstone',
      data: { userId, channel, removedAt: new Date().toISOString() },
    });
    return true;
  }

  getAllForUser(userId: string): SubscriptionRecord[] {
    const channels: Channel[] = [
      'web-push',
      'telegram',
      'sms',
      'whatsapp',
      'native',
    ];
    const out: SubscriptionRecord[] = [];
    for (const c of channels) {
      const r = this.subs.get(this.subKey(userId, c));
      if (r) out.push(r);
    }
    return out;
  }

  getWebPush(userId: string): WebPushRecord | undefined {
    return this.subs.get(this.subKey(userId, 'web-push')) as
      | WebPushRecord
      | undefined;
  }

  getTelegram(userId: string): TelegramRecord | undefined {
    return this.subs.get(this.subKey(userId, 'telegram')) as
      | TelegramRecord
      | undefined;
  }

  getSms(userId: string): SmsRecord | undefined {
    return this.subs.get(this.subKey(userId, 'sms')) as SmsRecord | undefined;
  }

  getWhatsApp(userId: string): WhatsAppRecord | undefined {
    return this.subs.get(this.subKey(userId, 'whatsapp')) as
      | WhatsAppRecord
      | undefined;
  }

  getNative(userId: string): NativeRecord | undefined {
    return this.subs.get(this.subKey(userId, 'native')) as
      | NativeRecord
      | undefined;
  }

  /** All users with at least one subscription. */
  allUserIds(): string[] {
    const seen = new Set<string>();
    for (const rec of this.subs.values()) seen.add(rec.userId);
    return [...seen];
  }

  // ---------- picks ----------

  async recordPick(
    matchId: string,
    userId: string,
    outcome: PickRecord['outcome'],
  ): Promise<PickRecord> {
    const rec: PickRecord = {
      matchId,
      userId,
      outcome,
      createdAt: new Date().toISOString(),
    };
    let bucket = this.picks.get(matchId);
    if (!bucket) {
      bucket = new Map();
      this.picks.set(matchId, bucket);
    }
    bucket.set(userId, rec);
    await this.append({ type: 'pick', data: rec });
    return rec;
  }

  picksForMatch(matchId: string): PickRecord[] {
    const bucket = this.picks.get(matchId);
    if (!bucket) return [];
    return [...bucket.values()];
  }

  // ---------- persistence ----------

  private async append(line: JsonlLine): Promise<void> {
    if (!this.filePath) return;
    await fs.appendFile(this.filePath, JSON.stringify(line) + '\n', 'utf8');
  }

  private async loadFromFile(): Promise<void> {
    if (!this.filePath) return;
    let raw = '';
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let parsed: JsonlLine;
      try {
        parsed = JSON.parse(line) as JsonlLine;
      } catch {
        continue;
      }
      if (parsed.type === 'subscription') {
        const rec = parsed.data as SubscriptionRecord;
        this.subs.set(this.subKey(rec.userId, rec.channel), rec);
      } else if (parsed.type === 'tombstone') {
        const t = parsed.data as { userId: string; channel: Channel };
        this.subs.delete(this.subKey(t.userId, t.channel));
      } else if (parsed.type === 'pick') {
        const rec = parsed.data as PickRecord;
        let bucket = this.picks.get(rec.matchId);
        if (!bucket) {
          bucket = new Map();
          this.picks.set(rec.matchId, bucket);
        }
        bucket.set(rec.userId, rec);
      } else if (parsed.type === 'pick-tombstone') {
        const t = parsed.data as { matchId: string; userId: string };
        const bucket = this.picks.get(t.matchId);
        bucket?.delete(t.userId);
      }
    }
  }

  /** Test-only helper. */
  _wipe(): void {
    this.subs.clear();
    this.picks.clear();
  }
}
