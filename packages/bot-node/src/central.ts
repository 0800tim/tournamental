import { request } from "undici";

import type {
  CommitPayload,
  LeaderboardPayload,
  NodeCredentials,
} from "./types.js";

export interface CentralClientOptions {
  base_url: string;
  node_id?: string;
  node_secret?: string;
  /** Inject a fetch-like for tests. Defaults to undici.request. */
  fetcher?: typeof request;
}

export interface RegistrationResponse {
  node_id: string;
  node_secret: string;
}

export class CentralClient {
  private readonly base_url: string;
  private readonly node_id?: string;
  private readonly node_secret?: string;
  private readonly fetcher: typeof request;

  constructor(opts: CentralClientOptions) {
    this.base_url = opts.base_url.replace(/\/+$/, "");
    this.node_id = opts.node_id;
    this.node_secret = opts.node_secret;
    this.fetcher = opts.fetcher ?? request;
  }

  static fromCredentials(
    creds: NodeCredentials,
    fetcher?: typeof request,
  ): CentralClient {
    return new CentralClient({
      base_url: creds.central_base_url,
      node_id: creds.node_id,
      node_secret: creds.node_secret,
      fetcher,
    });
  }

  async register(operatorEmail: string, label?: string): Promise<RegistrationResponse> {
    const body = JSON.stringify({ operator_email: operatorEmail, label });
    const res = await this.fetcher(`${this.base_url}/v1/nodes/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    const data = (await res.body.json()) as Partial<RegistrationResponse>;
    if (res.statusCode >= 400 || !data.node_id || !data.node_secret) {
      throw new Error(
        `register failed: ${res.statusCode} ${JSON.stringify(data)}`,
      );
    }
    return { node_id: data.node_id, node_secret: data.node_secret };
  }

  async commit(payload: CommitPayload): Promise<{ ok: true; central_received_at: number }> {
    this.requireCreds();
    const res = await this.fetcher(`${this.base_url}/v1/nodes/commit`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.node_secret}`,
        "x-node-id": this.node_id!,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.body.json()) as {
      ok?: boolean;
      central_received_at?: number;
      error?: string;
    };
    if (res.statusCode >= 400 || !data.ok) {
      throw new Error(`commit failed: ${res.statusCode} ${data.error ?? "unknown"}`);
    }
    return { ok: true, central_received_at: data.central_received_at ?? Date.now() };
  }

  async reportLeaderboard(
    payload: LeaderboardPayload,
  ): Promise<{ ok: true; central_received_at: number }> {
    this.requireCreds();
    const res = await this.fetcher(`${this.base_url}/v1/nodes/leaderboard`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.node_secret}`,
        "x-node-id": this.node_id!,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.body.json()) as {
      ok?: boolean;
      central_received_at?: number;
      error?: string;
    };
    if (res.statusCode >= 400 || !data.ok) {
      throw new Error(
        `leaderboard failed: ${res.statusCode} ${data.error ?? "unknown"}`,
      );
    }
    return { ok: true, central_received_at: data.central_received_at ?? Date.now() };
  }

  private requireCreds(): void {
    if (!this.node_id || !this.node_secret) {
      throw new Error("CentralClient missing node_id / node_secret");
    }
  }
}
