import "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  ShapeOutput,
  ZodRawShapeCompat,
} from "@modelcontextprotocol/sdk/dist/esm/server/zod-compat.js";

declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  interface McpServer {
    tool<Args extends ZodRawShapeCompat>(
      name: string,
      description: string,
      paramsSchemaOrAnnotations: Args,
      cb: (args: ShapeOutput<Args>, extra: unknown) => unknown,
    ): unknown;
  }
}
