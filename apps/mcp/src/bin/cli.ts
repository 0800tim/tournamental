#!/usr/bin/env node
/**
 * tournamental-mcp - Model Context Protocol server for Tournamental.
 *
 *   tournamental-mcp                       # stdio (default)
 *   tournamental-mcp --mode=http           # HTTP+SSE on :3395
 *   tournamental-mcp --mode=http --port=4000
 *   tournamental-mcp --version
 *   tournamental-mcp --help
 *
 * Stdio mode is the default because that's what local MCP clients
 * (Claude Desktop / Cursor / Windsurf / Continue) spawn. HTTP mode
 * is for hosted deployments behind Cloudflare Tunnel.
 *
 * Apache-2.0.
 */

import { startStdio } from '../transports/stdio.js';
import { startHttp } from '../transports/http.js';
import { SERVER_INFO } from '../server.js';

interface CliArgs {
  mode: 'stdio' | 'http';
  port?: number;
  bind?: string;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { mode: 'stdio', help: false, version: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--help' || arg === '-h') out.help = true;
    else if (arg === '--version' || arg === '-v') out.version = true;
    else if (arg === '--mode=stdio') out.mode = 'stdio';
    else if (arg === '--mode=http') out.mode = 'http';
    else if (arg.startsWith('--port=')) out.port = Number(arg.slice('--port='.length));
    else if (arg.startsWith('--bind=')) out.bind = arg.slice('--bind='.length);
    else if (arg.startsWith('--')) {
      process.stderr.write(`unknown flag: ${arg}\n`);
      process.exit(2);
    }
  }
  return out;
}

function printHelp(): void {
  process.stdout.write(
    `${SERVER_INFO.name} v${SERVER_INFO.version}\n\n` +
      `Usage: tournamental-mcp [--mode=stdio|http] [--port=N] [--bind=ADDR]\n\n` +
      `Modes:\n` +
      `  --mode=stdio       (default) JSON-RPC over stdin/stdout. For Claude\n` +
      `                     Desktop / Cursor / Windsurf / Continue.\n` +
      `  --mode=http        HTTP + SSE on $MCP_PORT (default 3395). For hosted use.\n\n` +
      `Env:\n` +
      `  TOURNAMENTAL_USER_KEY     stdio user-tier auth (per-user API key)\n` +
      `  TOURNAMENTAL_ADMIN_KEY    stdio admin-tier auth\n` +
      `  TOURNAMENTAL_ADMIN_IPS    HTTP admin IP allowlist (comma-separated)\n` +
      `  GAME_BASE_URL             upstream game-service base URL (default 127.0.0.1:3360)\n` +
      `  MCP_PORT                  HTTP port (default 3395)\n` +
      `  MCP_BIND                  HTTP bind address (default 0.0.0.0)\n` +
      `  MCP_AUDIT_PATH            JSONL audit-log path (default ./data/mcp-audit.jsonl)\n` +
      `  MCP_CORS_ORIGINS          CSV allow-list for HTTP CORS\n\n` +
      `Docs: https://github.com/0800tim/tournamental/tree/main/apps/mcp\n`,
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help) {
    printHelp();
    return;
  }
  if (args.version) {
    process.stdout.write(`${SERVER_INFO.version}\n`);
    return;
  }
  if (args.mode === 'stdio') {
    await startStdio();
    return;
  }
  await startHttp({ port: args.port, bind: args.bind });
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? (err as Error).message}\n`);
  process.exit(1);
});
