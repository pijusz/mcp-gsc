import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getSite, listSites } from "../services/gsc-api.js";
import { readTool } from "../utils/register-tool.js";

export function registerSiteTools(server: McpServer) {
  readTool(
    server,
    "list_properties",
    "List all Google Search Console properties you have access to, with permission levels and verification status.",
    {},
    async () => {
      const data = await listSites();
      const sites = data.siteEntry ?? [];

      if (sites.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No properties found. Add a site in Google Search Console first.",
            },
          ],
        };
      }

      const lines = [
        `**${sites.length} properties found:**\n`,
        "| Property | Permission |",
        "| --- | --- |",
        ...sites.map((s) => `| ${s.siteUrl} | ${s.permissionLevel} |`),
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  readTool(
    server,
    "get_property_details",
    "Get verification info, ownership, and permissions for a specific Google Search Console property.",
    {
      site_url: z
        .string()
        .describe(
          "The GSC property URL (e.g., 'sc-domain:example.com' or 'https://example.com/')",
        ),
    },
    async (args) => {
      const site = await getSite(args.site_url);
      return {
        content: [{ type: "text", text: JSON.stringify(site, null, 2) }],
      };
    },
  );
}
