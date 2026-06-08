/**
 * Shared scaffolding for Tournamental MCP tools.
 *
 * Every tool is exposed as a `ToolDefinition`. The exported `registerTool`
 * helper applies them uniformly to an `McpServer` instance and also produces
 * a shape we can unit-test without spinning up the full transport.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { TournamentalApiClient } from "../api-client.js";
import { BotApiError } from "../api-client.js";

/**
 * Local alias for the MCP `CallToolResult` shape. Re-typed here so the
 * tool definitions stay readable; structurally equivalent to the SDK type.
 */
export type McpTextResponse = CallToolResult;

/**
 * A Tournamental MCP tool. Generic over its Zod input shape so callers get
 * fully-typed `args` when implementing `handler`.
 */
export interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  handler: (
    args: z.infer<z.ZodObject<Shape>>,
    client: TournamentalApiClient,
  ) => Promise<McpTextResponse>;
}

/** Wrap a JSON-serialisable payload as an MCP text response. */
export function ok(payload: unknown): McpTextResponse {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/** Wrap an error as an MCP text response with `isError = true`. */
export function fail(err: unknown): McpTextResponse {
  if (err instanceof BotApiError) {
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            { error: err.message, status: err.status, body: err.body },
            null,
            2,
          ),
        },
      ],
      isError: true,
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ error: message }, null, 2),
      },
    ],
    isError: true,
  };
}

/**
 * Register a Tournamental tool against an `McpServer` and wire error
 * handling so a thrown SDK error always becomes a structured MCP error
 * response, never a transport-level crash.
 */
export function registerTool<Shape extends z.ZodRawShape>(
  server: McpServer,
  tool: ToolDefinition<Shape>,
  client: TournamentalApiClient,
): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    // The MCP SDK calls back with (parsedArgs, extra). We only need
    // parsedArgs here; the extra field carries cancellation + auth metadata
    // that tools currently don't use.
    (async (args: unknown, _extra: unknown) => {
      try {
        return await tool.handler(
          args as z.infer<z.ZodObject<Shape>>,
          client,
        );
      } catch (err) {
        return fail(err);
      }
    }) as Parameters<typeof server.registerTool>[2],
  );
}
