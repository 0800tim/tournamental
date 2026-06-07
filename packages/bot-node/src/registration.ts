import { CentralClient } from "./central.js";
import type { Storage } from "./storage.js";
import type { NodeCredentials } from "./types.js";

export interface RegisterOptions {
  storage: Storage;
  central_base_url: string;
  operator_email: string;
  label?: string;
  client?: CentralClient;
}

export async function registerNode(
  opts: RegisterOptions,
): Promise<NodeCredentials> {
  const existing = opts.storage.loadCredentials();
  if (existing && existing.operator_email === opts.operator_email) {
    return existing;
  }
  const client =
    opts.client ?? new CentralClient({ base_url: opts.central_base_url });
  const { node_id, node_secret } = await client.register(
    opts.operator_email,
    opts.label,
  );
  const creds: NodeCredentials = {
    node_id,
    node_secret,
    operator_email: opts.operator_email,
    central_base_url: opts.central_base_url,
    registered_at_utc: Date.now(),
  };
  opts.storage.saveCredentials(creds);
  return creds;
}

export function loadNodeCredentials(storage: Storage): NodeCredentials | null {
  return storage.loadCredentials();
}
