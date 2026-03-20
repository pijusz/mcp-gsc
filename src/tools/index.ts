import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Env } from "../config/env.js";
import { log } from "../utils/logger.js";
import { registerAnalyticsTools } from "./analytics.js";
import { registerExportTools } from "./export.js";
import { registerInspectionTools } from "./inspection.js";
import { registerReportingTools } from "./reporting.js";
import { registerSeoTools } from "./seo.js";
import { registerSitemapTools, registerSitemapWriteTools } from "./sitemaps.js";
import { registerSiteTools } from "./sites.js";
import { registerSiteWriteTools } from "./sites-write.js";
import { registerTechnicalTools } from "./technical.js";

export function registerAllTools(
  server: McpServer,
  env: Pick<Env, "GOOGLE_GSC_ENABLE_WRITES" | "GOOGLE_GSC_ENABLE_EXTENDED_TOOLS">,
): void {
  // Core tools (always registered)
  registerSiteTools(server);
  registerAnalyticsTools(server);
  registerSitemapTools(server);
  registerInspectionTools(server);
  registerExportTools(server);

  // Write tools (gated)
  if (env.GOOGLE_GSC_ENABLE_WRITES === "true") {
    registerSiteWriteTools(server);
    registerSitemapWriteTools(server);
    log.info("Write tools enabled");
  }

  // Extended tools (gated)
  if (env.GOOGLE_GSC_ENABLE_EXTENDED_TOOLS === "true") {
    registerReportingTools(server);
    registerSeoTools(server);
    registerTechnicalTools(server);
    log.info("Extended tools enabled");
  }
}
