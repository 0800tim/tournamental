/**
 * Auth helpers for the Tournamental MCP server.
 *
 * The MCP server is a thin wrapper around `@tournamental/bot-sdk` so it
 * inherits the same `Authorization: Bearer tnm_<key>` model. The key is
 * read once from the environment at boot and injected into every tool
 * call. Operators set it via their MCP client config (see the README and
 * `example-claude-desktop-config.json`).
 *
 * NZ English throughout, no em-dashes.
 */

const ENV_KEY = "TOURNAMENTAL_API_KEY";
const ENV_BASE_URL = "TOURNAMENTAL_BASE_URL";
const DEFAULT_BASE_URL = "https://api.tournamental.com";

export interface McpAuthConfig {
  /** Bearer key issued via the /bots/keys page. */
  apiKey: string;
  /** API base URL the underlying SDK should call. */
  baseUrl: string;
}

/**
 * Read auth config from environment variables. Throws a clear, operator-
 * friendly error if the key is missing so users see a useful message in
 * their MCP client logs rather than a generic 401 later.
 */
export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): McpAuthConfig {
  const apiKey = (env[ENV_KEY] ?? "").trim();
  if (!apiKey) {
    throw new Error(
      `bot-mcp: ${ENV_KEY} is not set. Get a key at https://play.tournamental.com/bots/keys and add it to your MCP client config.`,
    );
  }
  if (apiKey.length < 8) {
    throw new Error(`bot-mcp: ${ENV_KEY} looks malformed (length < 8).`);
  }
  const baseUrl = (env[ENV_BASE_URL] ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return { apiKey, baseUrl };
}

export const ENV_VAR_NAMES = {
  apiKey: ENV_KEY,
  baseUrl: ENV_BASE_URL,
} as const;
