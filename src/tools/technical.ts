import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { inspectUrl, listSitemaps } from "../services/gsc-api.js";
import { resolveProperty } from "../services/property-resolver.js";
import {
  checkQuota,
  quotaWarning,
  trackInspection,
  waitForQuota,
} from "../services/rate-limiter.js";
import { readTool } from "../utils/register-tool.js";

export function registerTechnicalTools(server: McpServer) {
  readTool(
    server,
    "indexing_coverage",
    "Batch-inspect user-provided URLs and categorize by indexing status: indexed, not indexed, canonical mismatch, robots blocked, fetch error, other. Respects URL Inspection rate limits.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
      urls: z.array(z.string()).min(1).describe("URLs to check indexing status for"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);
      const urls = args.urls.slice(0, 50); // Cap at 50

      const quota = checkQuota(property, urls.length);
      if (!quota.allowed) {
        return {
          content: [{ type: "text", text: quota.message ?? "Rate limit exceeded" }],
          isError: true,
        };
      }

      const categories: Record<string, { url: string; detail: string }[]> = {
        INDEXED: [],
        NOT_INDEXED: [],
        CANONICAL_MISMATCH: [],
        ROBOTS_BLOCKED: [],
        FETCH_ERROR: [],
        ERROR: [],
        OTHER: [],
      };

      for (const url of urls) {
        await waitForQuota(property);

        try {
          const result = await inspectUrl(property, url);
          trackInspection(property); // Track after success
          const idx = result.inspectionResult?.indexStatusResult;

          if (!idx) {
            categories.OTHER.push({ url, detail: "No inspection data" });
            continue;
          }

          const verdict = idx.verdict as string | undefined;
          const coverage = idx.coverageState as string | undefined;
          const robots = idx.robotsTxtState as string | undefined;
          const fetchState = idx.pageFetchState as string | undefined;
          const googleCanonical = idx.googleCanonical as string | undefined;
          const userCanonical = idx.userCanonical as string | undefined;

          if (verdict === "PASS" || coverage === "Submitted and indexed") {
            categories.INDEXED.push({
              url,
              detail: `Last crawled: ${idx.lastCrawlTime ?? "unknown"}`,
            });
          } else if (robots === "DISALLOWED") {
            categories.ROBOTS_BLOCKED.push({
              url,
              detail: "Blocked by robots.txt",
            });
          } else if (
            googleCanonical &&
            userCanonical &&
            googleCanonical !== userCanonical
          ) {
            categories.CANONICAL_MISMATCH.push({
              url,
              detail: `Google canonical: ${googleCanonical}`,
            });
          } else if (
            fetchState &&
            fetchState !== "SUCCESSFUL" &&
            fetchState !== "PARTIAL"
          ) {
            categories.FETCH_ERROR.push({
              url,
              detail: `Fetch state: ${fetchState}`,
            });
          } else {
            categories.NOT_INDEXED.push({
              url,
              detail: coverage ?? verdict ?? "Unknown reason",
            });
          }
        } catch (err) {
          categories.ERROR.push({
            url,
            detail: (err as Error).message,
          });
        }
      }

      const lines = [
        `**Indexing Coverage Report for ${property}**`,
        `**URLs checked:** ${urls.length}\n`,
      ];

      for (const [status, items] of Object.entries(categories)) {
        if (items.length === 0) continue;
        lines.push(`### ${status} (${items.length})\n`);
        lines.push("| URL | Details |");
        lines.push("| --- | --- |");
        for (const item of items) {
          lines.push(`| ${item.url} | ${item.detail} |`);
        }
        lines.push("");
      }

      lines.push(quotaWarning(property));

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    },
  );

  readTool(
    server,
    "sitemap_health",
    "Analyze all sitemaps: error/warning patterns, submission freshness (days since last submitted), indexed vs submitted ratio per sitemap.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);
      const data = await listSitemaps(property);
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

      const now = Date.now();
      const rows = sitemaps.map((s) => {
        const daysSinceSubmit = s.lastSubmitted
          ? Math.round((now - new Date(s.lastSubmitted).getTime()) / 86400000)
          : null;

        let totalSubmitted = 0;
        let totalIndexed = 0;
        for (const c of s.contents ?? []) {
          totalSubmitted += Number(c.submitted) || 0;
          totalIndexed += Number(c.indexed) || 0;
        }

        const ratio =
          totalSubmitted > 0
            ? `${((totalIndexed / totalSubmitted) * 100).toFixed(0)}%`
            : "—";

        return {
          path: s.path,
          type: s.type ?? "—",
          is_index: s.isSitemapsIndex ? "Yes" : "No",
          errors: s.errors ?? "0",
          warnings: s.warnings ?? "0",
          days_since_submit: daysSinceSubmit !== null ? `${daysSinceSubmit}d` : "—",
          submitted: totalSubmitted,
          indexed: totalIndexed,
          indexed_ratio: ratio,
          status: s.isPending ? "PENDING" : "OK",
        };
      });

      // Summary stats
      const totalErrors = rows.reduce((s, r) => s + (Number(r.errors) || 0), 0);
      const totalWarnings = rows.reduce((s, r) => s + (Number(r.warnings) || 0), 0);
      const stale = rows.filter((r) => {
        const days = Number.parseInt(r.days_since_submit as string, 10);
        return !Number.isNaN(days) && days > 30;
      });

      const header = [
        `**Sitemap Health for ${property}**`,
        `**Total sitemaps:** ${sitemaps.length}`,
        `**Total errors:** ${totalErrors}`,
        `**Total warnings:** ${totalWarnings}`,
        `**Stale sitemaps (>30 days):** ${stale.length}\n`,
      ].join("\n");

      const lines = [header];
      lines.push(
        "| Path | Type | Index | Errors | Warnings | Freshness | Submitted | Indexed | Ratio |",
      );
      lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");

      for (const r of rows) {
        lines.push(
          `| ${r.path} | ${r.type} | ${r.is_index} | ${r.errors} | ${r.warnings} | ${r.days_since_submit} | ${r.submitted} | ${r.indexed} | ${r.indexed_ratio} |`,
        );
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    },
  );
}
