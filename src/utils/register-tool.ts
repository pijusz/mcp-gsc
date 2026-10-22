import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

const WRITE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export function readTool<Args extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Args,
  handler: ToolCallback<Args>,
) {
  return server.registerTool(
    name,
    { description, inputSchema, annotations: READ_ONLY },
    handler,
  );
}

/**
 * Registers a mutating tool. Defaults to the most cautious hints (destructive,
 * non-idempotent); pass `hints` to relax them for additive or repeat-safe calls
 * so clients don't prompt harder than the operation warrants.
 */
export function writeTool<Args extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: Args,
  handler: ToolCallback<Args>,
  hints: Partial<ToolAnnotations> = {},
) {
  return server.registerTool(
    name,
    { description, inputSchema, annotations: { ...WRITE, ...hints } },
    handler,
  );
}
