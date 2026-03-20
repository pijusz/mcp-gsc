import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  deleteSitemap as deleteSitemapApi,
  getSitemap,
  listSitemaps,
  submitSitemap,
} from "../services/gsc-api.js";
import { resolveProperty } from "../services/property-resolver.js";

export function registerSitemapTools(server: McpServer) {
  server.tool(
    "list_sitemaps",
    "List all sitemaps for a property with status, type, indexed URL counts, errors/warnings.",
    {
      site_url: z
        .string()
        .optional()
        .describe("GSC property URL. Defaults to GOOGLE_GSC_PROPERTY env var."),
      sitemap_index: z
        .string()
        .optional()
        .describe(
          "Filter by parent sitemap index URL. Only returns sitemaps that are children of this index.",
        ),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);
      const data = await listSitemaps(property, args.sitemap_index);
      const sitemaps = data.sitemap ?? [];

      if (sitemaps.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No sitemaps found for this property.",
            },
          ],
        };
      }

      const lines = [
        `**${sitemaps.length} sitemaps for ${property}:**\n`,
        "| Path | Type | Last Submitted | Errors | Warnings |",
        "| --- | --- | --- | --- | --- |",
        ...sitemaps.map((s) => {
          const lastSubmitted = s.lastSubmitted
            ? new Date(s.lastSubmitted).toISOString().slice(0, 10)
            : "—";
          return `| ${s.path} | ${s.type ?? "—"} | ${lastSubmitted} | ${s.errors ?? "0"} | ${s.warnings ?? "0"} |`;
        }),
      ];

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );

  server.tool(
    "get_sitemap",
    "Get detailed info for a specific sitemap including content breakdown by type (web, image, video, etc.).",
    {
      site_url: z
        .string()
        .optional()
        .describe("GSC property URL. Defaults to GOOGLE_GSC_PROPERTY env var."),
      sitemap_url: z.string().describe("The full URL of the sitemap to inspect"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);
      const sitemap = await getSitemap(property, args.sitemap_url);
      return {
        content: [{ type: "text", text: JSON.stringify(sitemap, null, 2) }],
      };
    },
  );
}

export function registerSitemapWriteTools(server: McpServer) {
  server.tool(
    "submit_sitemap",
    "Submit a new sitemap URL for a property. The sitemap must be accessible at the provided URL.",
    {
      site_url: z
        .string()
        .optional()
        .describe("GSC property URL. Defaults to GOOGLE_GSC_PROPERTY env var."),
      sitemap_url: z.string().describe("The full URL of the sitemap to submit"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);
      await submitSitemap(property, args.sitemap_url);
      return {
        content: [
          {
            type: "text",
            text: `Sitemap submitted: ${args.sitemap_url}`,
          },
        ],
      };
    },
  );

  server.tool(
    "delete_sitemap",
    "Remove/unsubmit a sitemap from a property. This does not delete the sitemap file itself.",
    {
      site_url: z
        .string()
        .optional()
        .describe("GSC property URL. Defaults to GOOGLE_GSC_PROPERTY env var."),
      sitemap_url: z.string().describe("The full URL of the sitemap to remove"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);
      await deleteSitemapApi(property, args.sitemap_url);
      return {
        content: [
          {
            type: "text",
            text: `Sitemap removed: ${args.sitemap_url}`,
          },
        ],
      };
    },
  );
}
