import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  addSite as addSiteApi,
  deleteSite as deleteSiteApi,
} from "../services/gsc-api.js";
import { invalidateSitesCache } from "../services/property-resolver.js";

export function registerSiteWriteTools(server: McpServer) {
  server.tool(
    "add_site",
    "Add a new site to Google Search Console. The site must be verified separately after adding.",
    {
      site_url: z
        .string()
        .describe(
          "The site URL to add (e.g., 'sc-domain:example.com' or 'https://example.com/')",
        ),
    },
    async (args) => {
      await addSiteApi(args.site_url);
      invalidateSitesCache();
      return {
        content: [
          {
            type: "text",
            text: `Site added: ${args.site_url}\nNote: The site must be verified separately in Google Search Console.`,
          },
        ],
      };
    },
  );

  server.tool(
    "delete_site",
    "Remove a site from Google Search Console. This does not affect the site itself, only removes it from your GSC account.",
    {
      site_url: z.string().describe("The site URL to remove"),
    },
    async (args) => {
      await deleteSiteApi(args.site_url);
      invalidateSitesCache();
      return {
        content: [
          {
            type: "text",
            text: `Site removed: ${args.site_url}`,
          },
        ],
      };
    },
  );
}
