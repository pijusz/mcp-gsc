import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { inspectUrl } from "../services/gsc-api.js";
import { resolveProperty } from "../services/property-resolver.js";
import {
  checkQuota,
  quotaWarning,
  trackInspection,
  waitForQuota,
} from "../services/rate-limiter.js";
import { readTool } from "../utils/register-tool.js";

export function registerInspectionTools(server: McpServer) {
  readTool(
    server,
    "inspect_url",
    "Inspect a URL's indexing status, crawl info, rich results, mobile usability, and canonical URLs. Counts against the daily 2,000 and per-minute 600 URL Inspection limits.",
    {
      site_url: z
        .string()
        .optional()
        .describe("GSC property URL. Defaults to GOOGLE_GSC_PROPERTY env var."),
      url: z.string().describe("The URL to inspect"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);

      const quota = checkQuota(property, 1);
      if (!quota.allowed) {
        return {
          content: [{ type: "text", text: quota.message ?? "Rate limit exceeded" }],
          isError: true,
        };
      }

      await waitForQuota(property);

      const result = await inspectUrl(property, args.url);
      trackInspection(property); // Track after success, not before
      const warning = quotaWarning(property);
      const text = JSON.stringify(result, null, 2) + warning;

      return { content: [{ type: "text", text }] };
    },
  );

  readTool(
    server,
    "batch_inspect_urls",
    "Inspect up to 10 URLs simultaneously. Returns categorized results (indexed, not indexed, issues). Each URL counts against the daily 2,000 and per-minute 600 URL Inspection limits.",
    {
      site_url: z
        .string()
        .optional()
        .describe("GSC property URL. Defaults to GOOGLE_GSC_PROPERTY env var."),
      urls: z.array(z.string()).min(1).max(10).describe("URLs to inspect (max 10)"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);

      const quota = checkQuota(property, args.urls.length);
      if (!quota.allowed) {
        return {
          content: [{ type: "text", text: quota.message ?? "Rate limit exceeded" }],
          isError: true,
        };
      }

      const results: {
        url: string;
        status: string;
        details: Record<string, unknown>;
      }[] = [];

      // Serialize inspections with throttling for per-minute limit
      for (const url of args.urls) {
        await waitForQuota(property);

        try {
          const result = await inspectUrl(property, url);
          trackInspection(property); // Track after success
          const idx = result.inspectionResult?.indexStatusResult;
          results.push({
            url,
            status: categorizeStatus(idx),
            details: {
              verdict: idx?.verdict,
              coverageState: idx?.coverageState,
              indexingState: idx?.indexingState,
              lastCrawlTime: idx?.lastCrawlTime,
              pageFetchState: idx?.pageFetchState,
              googleCanonical: idx?.googleCanonical,
              robotsTxtState: idx?.robotsTxtState,
            },
          });
        } catch (err) {
          results.push({
            url,
            status: "ERROR",
            details: { error: (err as Error).message },
          });
        }
      }

      // Group by status
      const groups: Record<string, typeof results> = {};
      for (const r of results) {
        if (!groups[r.status]) groups[r.status] = [];
        groups[r.status].push(r);
      }

      const lines: string[] = [
        `**Batch inspection of ${args.urls.length} URLs for ${property}:**\n`,
      ];

      for (const [status, items] of Object.entries(groups)) {
        lines.push(`### ${status} (${items.length})\n`);
        lines.push("| URL | Details |");
        lines.push("| --- | --- |");
        for (const item of items) {
          const detail = Object.entries(item.details)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          lines.push(`| ${item.url} | ${detail} |`);
        }
        lines.push("");
      }

      const warning = quotaWarning(property);
      return {
        content: [{ type: "text", text: lines.join("\n") + warning }],
      };
    },
  );
}

function categorizeStatus(idx?: Record<string, unknown>): string {
  if (!idx) return "UNKNOWN";
  const verdict = idx.verdict as string | undefined;
  const coverageState = idx.coverageState as string | undefined;
  const robotsTxtState = idx.robotsTxtState as string | undefined;

  if (verdict === "PASS") return "INDEXED";
  if (robotsTxtState === "DISALLOWED") return "ROBOTS_BLOCKED";
  if (coverageState === "Submitted and indexed") return "INDEXED";
  if (coverageState?.includes("not indexed")) return "NOT_INDEXED";
  if (idx.googleCanonical && idx.googleCanonical !== idx.userCanonical) {
    return "CANONICAL_MISMATCH";
  }
  const fetchState = idx.pageFetchState as string | undefined;
  if (fetchState && fetchState !== "SUCCESSFUL" && fetchState !== "PARTIAL") {
    return "FETCH_ERROR";
  }
  if (verdict === "FAIL" || verdict === "EXCLUDED") return "NOT_INDEXED";
  return "OTHER";
}
