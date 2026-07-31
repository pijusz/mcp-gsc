import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getUrlNotificationMetadata,
  publishUrlNotification,
} from "../services/gsc-api.js";
import { readTool, writeTool } from "../utils/register-tool.js";

/** Default Indexing API quota, surfaced in output so the model can pace batches. */
const DAILY_QUOTA = 200;

function formatNotifyTime(iso?: string): string {
  if (!iso) return "unknown";
  return iso.replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

export function registerIndexingTools(server: McpServer) {
  writeTool(
    server,
    "request_indexing",
    [
      "Ask Google to crawl a URL (or that it has been removed) via the Indexing API.",
      "Google officially supports this only for pages with JobPosting or BroadcastEvent structured data — other page types are not guaranteed to be picked up, and this never guarantees indexing.",
      `Requires being a verified owner of the property, the Indexing API enabled on your Cloud project, and re-running 'mcp-gsc setup' if your credentials predate the indexing scope. Default quota is ${DAILY_QUOTA} URLs/day.`,
    ].join(" "),
    {
      url: z
        .string()
        .url()
        .describe("Full URL to notify Google about, e.g. 'https://example.com/jobs/123'"),
      type: z
        .enum(["URL_UPDATED", "URL_DELETED"])
        .default("URL_UPDATED")
        .describe(
          "URL_UPDATED for new or changed pages; URL_DELETED for pages you have removed",
        ),
    },
    async (args) => {
      const res = await publishUrlNotification(args.url, args.type);
      const meta = res.urlNotificationMetadata;
      const latest =
        args.type === "URL_DELETED" ? meta?.latestRemove : meta?.latestUpdate;

      return {
        content: [
          {
            type: "text",
            text: [
              `Submitted ${args.type} for ${args.url}`,
              `Google recorded it at: ${formatNotifyTime(latest?.notifyTime)}`,
              "",
              "This is a request to crawl, not a guarantee of indexing. Use inspect_url to check the actual index status later.",
            ].join("\n"),
          },
        ],
      };
    },
  );

  readTool(
    server,
    "get_indexing_status",
    "Show when a URL was last submitted to the Indexing API, for both updates and removals. This reports your own notification history — it does not say whether Google actually indexed the page (use inspect_url for that).",
    {
      url: z
        .string()
        .url()
        .describe("Full URL previously submitted via request_indexing"),
    },
    async (args) => {
      const meta = await getUrlNotificationMetadata(args.url);
      const lines = [`Indexing notifications for ${args.url}`, ""];

      if (!meta.latestUpdate && !meta.latestRemove) {
        lines.push("No notifications have been submitted for this URL.");
      } else {
        if (meta.latestUpdate) {
          lines.push(
            `Last update requested: ${formatNotifyTime(meta.latestUpdate.notifyTime)}`,
          );
        }
        if (meta.latestRemove) {
          lines.push(
            `Last removal requested: ${formatNotifyTime(meta.latestRemove.notifyTime)}`,
          );
        }
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
