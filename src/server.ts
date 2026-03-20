import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import pkg from "../package.json";
import {
  isExtendedToolsEnabledFromProcessEnv,
  isWritesEnabledFromProcessEnv,
} from "./config/env.js";
import { registerAllTools } from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "mcp-gsc",
    version: pkg.version,
  });

  registerAllTools(server, {
    GOOGLE_GSC_ENABLE_WRITES: isWritesEnabledFromProcessEnv() ? "true" : "false",
    GOOGLE_GSC_ENABLE_EXTENDED_TOOLS: isExtendedToolsEnabledFromProcessEnv()
      ? "true"
      : "false",
  });

  return server;
}
