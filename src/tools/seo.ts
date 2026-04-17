import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatCtr, formatMarkdownTable, formatPosition } from "../services/format.js";
import { querySearchAnalytics } from "../services/gsc-api.js";
import { resolveProperty } from "../services/property-resolver.js";
import { readTool } from "../utils/register-tool.js";

export function registerSeoTools(server: McpServer) {
  readTool(
    server,
    "quick_wins",
    "Find high-impression, low-CTR queries in striking distance (position 4-20). These are opportunities to improve rankings and CTR with small content or SEO tweaks.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
      start_date: z.string().describe("Start date YYYY-MM-DD"),
      end_date: z.string().describe("End date YYYY-MM-DD"),
      min_impressions: z.number().default(100).describe("Minimum impressions threshold"),
      max_ctr: z.number().default(0.05).describe("Maximum CTR threshold (0.05 = 5%)"),
      min_position: z.number().default(4).describe("Minimum average position"),
      max_position: z.number().default(20).describe("Maximum average position"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);

      const data = await querySearchAnalytics(property, {
        startDate: args.start_date,
        endDate: args.end_date,
        dimensions: ["query"],
        dataState: "all",
        rowLimit: 25000,
      });

      const wins = (data.rows ?? [])
        .filter(
          (r) =>
            r.impressions >= args.min_impressions &&
            r.ctr <= args.max_ctr &&
            r.position >= args.min_position &&
            r.position <= args.max_position,
        )
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 100)
        .map((r) => ({
          query: r.keys?.[0] ?? "",
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: formatCtr(r.ctr),
          position: formatPosition(r.position),
          potential_clicks: Math.round(r.impressions * 0.05 - r.clicks),
        }));

      if (wins.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No quick wins found with the specified thresholds.",
            },
          ],
        };
      }

      const header = [
        `**Quick Wins for ${property}**`,
        `**Period:** ${args.start_date} to ${args.end_date}`,
        `**Thresholds:** impressions >= ${args.min_impressions}, CTR <= ${(args.max_ctr * 100).toFixed(0)}%, position ${args.min_position}-${args.max_position}`,
        `**Found:** ${wins.length} opportunities\n`,
      ].join("\n");

      const table = formatMarkdownTable(wins, [
        "query",
        "clicks",
        "impressions",
        "ctr",
        "position",
        "potential_clicks",
      ]);

      return {
        content: [{ type: "text", text: `${header}\n${table}` }],
      };
    },
  );

  readTool(
    server,
    "cannibalization",
    "Detect keyword cannibalization — multiple pages ranking for the same query. Uses query + page dimensions to find overlap.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
      start_date: z.string().describe("Start date YYYY-MM-DD"),
      end_date: z.string().describe("End date YYYY-MM-DD"),
      mode: z
        .enum(["click_weighted", "position"])
        .default("click_weighted")
        .describe(
          "click_weighted factors in click distribution; position is simple overlap detection",
        ),
      min_impressions: z
        .number()
        .default(50)
        .describe("Minimum impressions per query-page pair"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);

      const data = await querySearchAnalytics(property, {
        startDate: args.start_date,
        endDate: args.end_date,
        dimensions: ["query", "page"],
        dataState: "all",
        rowLimit: 25000,
      });

      // Group by query
      const queryMap = new Map<
        string,
        {
          page: string;
          clicks: number;
          impressions: number;
          position: number;
        }[]
      >();

      for (const row of data.rows ?? []) {
        if (row.impressions < args.min_impressions) continue;
        const query = row.keys?.[0] ?? "";
        const page = row.keys?.[1] ?? "";
        const list = queryMap.get(query) ?? [];
        list.push({
          page,
          clicks: row.clicks,
          impressions: row.impressions,
          position: row.position,
        });
        queryMap.set(query, list);
      }

      // Filter to queries with 2+ pages
      const cannibalized: Record<string, unknown>[] = [];

      for (const [query, pages] of queryMap) {
        if (pages.length < 2) continue;
        pages.sort((a, b) => b.clicks - a.clicks);

        if (args.mode === "click_weighted") {
          const totalClicks = pages.reduce((s, p) => s + p.clicks, 0);
          const topPageClicks = pages[0].clicks;
          // Only flag if clicks are split (top page < 80% of total)
          if (totalClicks > 0 && topPageClicks / totalClicks >= 0.8) continue;
        }

        for (const page of pages) {
          cannibalized.push({
            query,
            page: page.page,
            clicks: page.clicks,
            impressions: page.impressions,
            position: formatPosition(page.position),
          });
        }
      }

      if (cannibalized.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No keyword cannibalization detected (mode: ${args.mode}).`,
            },
          ],
        };
      }

      const uniqueQueries = new Set(cannibalized.map((r) => r.query as string)).size;
      const header = [
        `**Keyword Cannibalization for ${property}**`,
        `**Period:** ${args.start_date} to ${args.end_date}`,
        `**Mode:** ${args.mode}`,
        `**Found:** ${uniqueQueries} queries with multiple competing pages\n`,
      ].join("\n");

      const table = formatMarkdownTable(cannibalized.slice(0, 200), [
        "query",
        "page",
        "clicks",
        "impressions",
        "position",
      ]);

      return {
        content: [{ type: "text", text: `${header}\n${table}` }],
      };
    },
  );

  readTool(
    server,
    "opportunity_finder",
    "Find queries with improving impressions but low clicks, new emerging queries, and declining performers. Makes 2 API calls to compare periods.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
      start_date: z.string().describe("Current period start date"),
      end_date: z.string().describe("Current period end date"),
      comparison_days: z
        .number()
        .default(28)
        .describe("Days for previous comparison period"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);

      const startCurrent = new Date(args.start_date);
      const endPrev = new Date(startCurrent);
      endPrev.setDate(endPrev.getDate() - 1);
      const startPrev = new Date(endPrev);
      startPrev.setDate(startPrev.getDate() - args.comparison_days + 1);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const [current, previous] = await Promise.all([
        querySearchAnalytics(property, {
          startDate: args.start_date,
          endDate: args.end_date,
          dimensions: ["query"],
          dataState: "all",
          rowLimit: 25000,
        }),
        querySearchAnalytics(property, {
          startDate: fmt(startPrev),
          endDate: fmt(endPrev),
          dimensions: ["query"],
          dataState: "all",
          rowLimit: 25000,
        }),
      ]);

      const prevMap = new Map((previous.rows ?? []).map((r) => [r.keys?.[0] ?? "", r]));
      const currMap = new Map((current.rows ?? []).map((r) => [r.keys?.[0] ?? "", r]));

      const emerging: Record<string, unknown>[] = [];
      const growing: Record<string, unknown>[] = [];
      const declining: Record<string, unknown>[] = [];

      for (const [query, curr] of currMap) {
        const prev = prevMap.get(query);

        if (!prev) {
          // New query
          if (curr.impressions >= 50) {
            emerging.push({
              query,
              clicks: curr.clicks,
              impressions: curr.impressions,
              position: formatPosition(curr.position),
            });
          }
        } else {
          const impDelta = curr.impressions - prev.impressions;
          const impPct = prev.impressions > 0 ? impDelta / prev.impressions : 0;

          if (impPct > 0.2 && curr.ctr < 0.03 && curr.impressions >= 100) {
            growing.push({
              query,
              impressions_current: curr.impressions,
              impressions_previous: prev.impressions,
              impressions_change: `+${(impPct * 100).toFixed(0)}%`,
              clicks: curr.clicks,
              ctr: formatCtr(curr.ctr),
              position: formatPosition(curr.position),
            });
          }
        }
      }

      for (const [query, prev] of prevMap) {
        const curr = currMap.get(query);
        if (!curr && prev.impressions >= 100) {
          declining.push({
            query,
            previous_impressions: prev.impressions,
            previous_clicks: prev.clicks,
            status: "disappeared",
          });
        } else if (curr) {
          const impDelta = curr.impressions - prev.impressions;
          const impPct = prev.impressions > 0 ? impDelta / prev.impressions : 0;
          if (impPct < -0.3 && prev.impressions >= 100) {
            declining.push({
              query,
              impressions_current: curr.impressions,
              impressions_previous: prev.impressions,
              impressions_change: `${(impPct * 100).toFixed(0)}%`,
              clicks: curr.clicks,
              status: "declining",
            });
          }
        }
      }

      const sections: string[] = [
        `**Opportunity Finder for ${property}**`,
        `**Current:** ${args.start_date} to ${args.end_date}`,
        `**Previous:** ${fmt(startPrev)} to ${fmt(endPrev)}\n`,
      ];

      if (emerging.length > 0) {
        sections.push(
          formatMarkdownTable(
            emerging.slice(0, 30),
            ["query", "clicks", "impressions", "position"],
            `Emerging Queries (${emerging.length} new)`,
          ),
        );
      }

      if (growing.length > 0) {
        sections.push(
          formatMarkdownTable(
            growing.slice(0, 30),
            [
              "query",
              "impressions_current",
              "impressions_previous",
              "impressions_change",
              "clicks",
              "ctr",
              "position",
            ],
            `Growing Impressions, Low CTR (${growing.length})`,
          ),
        );
      }

      if (declining.length > 0) {
        sections.push(
          formatMarkdownTable(
            declining.slice(0, 30),
            [
              "query",
              "impressions_current",
              "impressions_previous",
              "impressions_change",
              "status",
            ],
            `Declining Queries (${declining.length})`,
          ),
        );
      }

      if (emerging.length === 0 && growing.length === 0 && declining.length === 0) {
        sections.push("No significant opportunities or declines detected.");
      }

      return {
        content: [{ type: "text", text: sections.join("\n\n") }],
      };
    },
  );

  readTool(
    server,
    "position_tracking",
    "Track position changes for specific queries or pages over time. Uses date dimension with query/page filters. Returns daily or weekly averages.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
      start_date: z.string().describe("Start date YYYY-MM-DD"),
      end_date: z.string().describe("End date YYYY-MM-DD"),
      queries: z.array(z.string()).optional().describe("Queries to track"),
      pages: z.array(z.string()).optional().describe("Pages to track"),
      granularity: z
        .enum(["daily", "weekly"])
        .default("daily")
        .describe("Aggregation granularity"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);

      if (!args.queries?.length && !args.pages?.length) {
        return {
          content: [
            {
              type: "text",
              text: "Provide at least one query or page to track.",
            },
          ],
        };
      }

      const filters: {
        dimension: string;
        operator: string;
        expression: string;
      }[] = [];
      const dims = ["date"];

      if (args.queries?.length) {
        dims.push("query");
        if (args.queries.length === 1) {
          filters.push({
            dimension: "query",
            operator: "equals",
            expression: args.queries[0],
          });
        } else {
          const regex = args.queries
            .map((q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|");
          filters.push({
            dimension: "query",
            operator: "includingRegex",
            expression: `^(${regex})$`,
          });
        }
      }

      if (args.pages?.length) {
        dims.push("page");
        if (args.pages.length === 1) {
          filters.push({
            dimension: "page",
            operator: "equals",
            expression: args.pages[0],
          });
        } else {
          const regex = args.pages
            .map((p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|");
          filters.push({
            dimension: "page",
            operator: "includingRegex",
            expression: `^(${regex})$`,
          });
        }
      }

      const data = await querySearchAnalytics(property, {
        startDate: args.start_date,
        endDate: args.end_date,
        dimensions: dims,
        dataState: "all",
        rowLimit: 25000,
        dimensionFilterGroups: filters.length > 0 ? [{ filters }] : undefined,
      });

      const rows = (data.rows ?? []).map((row) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < dims.length; i++) {
          obj[dims[i]] = row.keys?.[i] ?? "";
        }
        obj.clicks = row.clicks;
        obj.impressions = row.impressions;
        obj.ctr = formatCtr(row.ctr);
        obj.position = formatPosition(row.position);
        return obj;
      });

      let outputRows = rows;

      if (args.granularity === "weekly" && rows.length > 0) {
        // Group by ISO week + entity (query/page)
        const entityDims = dims.filter((d) => d !== "date");
        const weekMap = new Map<
          string,
          { clicks: number; impressions: number; position: number; count: number }
        >();

        for (const row of rows) {
          const date = new Date(row.date as string);
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          const entityKey = entityDims.map((d) => row[d] ?? "").join("|");
          const key = `${weekStart.toISOString().slice(0, 10)}|${entityKey}`;

          const agg = weekMap.get(key) ?? {
            clicks: 0,
            impressions: 0,
            position: 0,
            count: 0,
          };
          agg.clicks += Number(row.clicks) || 0;
          agg.impressions += Number(row.impressions) || 0;
          agg.position += Number.parseFloat(String(row.position)) || 0;
          agg.count += 1;
          weekMap.set(key, agg);
        }

        outputRows = [];
        for (const [key, agg] of weekMap) {
          const parts = key.split("|");
          const weekDate = parts[0];
          const obj: Record<string, unknown> = { date: weekDate };
          for (let i = 0; i < entityDims.length; i++) {
            obj[entityDims[i]] = parts[i + 1] ?? "";
          }
          obj.clicks = agg.clicks;
          obj.impressions = agg.impressions;
          obj.ctr = formatCtr(agg.impressions > 0 ? agg.clicks / agg.impressions : 0);
          obj.position = formatPosition(agg.position / agg.count);
          outputRows.push(obj);
        }

        // Sort by date then entity
        outputRows.sort((a, b) => {
          const dateCompare = String(a.date).localeCompare(String(b.date));
          if (dateCompare !== 0) return dateCompare;
          return String(a[entityDims[0]] ?? "").localeCompare(
            String(b[entityDims[0]] ?? ""),
          );
        });
      }

      const columns = [...dims, "clicks", "impressions", "ctr", "position"];
      const granLabel = args.granularity === "weekly" ? " (weekly)" : "";
      const table = formatMarkdownTable(
        outputRows.slice(0, 200),
        columns,
        `Position Tracking${granLabel}`,
      );

      return {
        content: [
          {
            type: "text",
            text: `**Position Tracking for ${property}**\n${args.start_date} to ${args.end_date}\n\n${table}`,
          },
        ],
      };
    },
  );

  readTool(
    server,
    "ctr_anomalies",
    "Detect queries/pages with abnormally low or high CTR relative to their position. Uses expected CTR curves per position bucket and flags deviations.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
      start_date: z.string().describe("Start date YYYY-MM-DD"),
      end_date: z.string().describe("End date YYYY-MM-DD"),
      min_impressions: z
        .number()
        .default(100)
        .describe("Minimum impressions to consider"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);

      const data = await querySearchAnalytics(property, {
        startDate: args.start_date,
        endDate: args.end_date,
        dimensions: ["query"],
        dataState: "all",
        rowLimit: 25000,
      });

      // Expected CTR by position bucket (industry averages)
      const expectedCtr = (pos: number): number => {
        if (pos <= 1) return 0.3;
        if (pos <= 2) return 0.15;
        if (pos <= 3) return 0.1;
        if (pos <= 5) return 0.06;
        if (pos <= 10) return 0.03;
        if (pos <= 20) return 0.015;
        return 0.005;
      };

      const anomalies: Record<string, unknown>[] = [];

      for (const row of data.rows ?? []) {
        if (row.impressions < args.min_impressions) continue;
        const expected = expectedCtr(row.position);
        const ratio = row.ctr / expected;

        // Flag if CTR is < 50% or > 200% of expected
        if (ratio < 0.5 || ratio > 2.0) {
          anomalies.push({
            query: row.keys?.[0] ?? "",
            clicks: row.clicks,
            impressions: row.impressions,
            actual_ctr: formatCtr(row.ctr),
            expected_ctr: formatCtr(expected),
            position: formatPosition(row.position),
            anomaly:
              ratio < 0.5
                ? `LOW (${(ratio * 100).toFixed(0)}% of expected)`
                : `HIGH (${(ratio * 100).toFixed(0)}% of expected)`,
          });
        }
      }

      anomalies.sort((a, b) => (b.impressions as number) - (a.impressions as number));

      if (anomalies.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No significant CTR anomalies detected.",
            },
          ],
        };
      }

      const low = anomalies.filter((a) => (a.anomaly as string).startsWith("LOW"));
      const high = anomalies.filter((a) => (a.anomaly as string).startsWith("HIGH"));

      const cols = [
        "query",
        "clicks",
        "impressions",
        "actual_ctr",
        "expected_ctr",
        "position",
        "anomaly",
      ];

      const sections = [
        `**CTR Anomalies for ${property}**`,
        `**Period:** ${args.start_date} to ${args.end_date}`,
        `**Found:** ${low.length} low CTR, ${high.length} high CTR anomalies\n`,
      ];

      if (low.length > 0) {
        sections.push(
          formatMarkdownTable(
            low.slice(0, 50),
            cols,
            `Low CTR (${low.length} — potential title/snippet issues)`,
          ),
        );
      }

      if (high.length > 0) {
        sections.push(
          formatMarkdownTable(
            high.slice(0, 50),
            cols,
            `High CTR (${high.length} — strong title/brand queries)`,
          ),
        );
      }

      return {
        content: [{ type: "text", text: sections.join("\n\n") }],
      };
    },
  );

  readTool(
    server,
    "content_decay",
    "Detect pages/queries where impressions have dropped significantly compared to their historical peak within the 16-month API window.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
      start_date: z.string().describe("Recent period start date YYYY-MM-DD"),
      end_date: z.string().describe("Recent period end date YYYY-MM-DD"),
      decay_threshold: z
        .number()
        .default(0.5)
        .describe("Decay threshold (0.5 = 50% drop from peak)"),
      dimension: z
        .enum(["query", "page"])
        .default("page")
        .describe("Analyze by query or page"),
      min_impressions: z
        .number()
        .default(200)
        .describe("Minimum peak impressions to consider"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);

      // Get historical peak (use a wider window)
      const recentStart = new Date(args.start_date);
      const historicalStart = new Date(recentStart);
      historicalStart.setMonth(historicalStart.getMonth() - 6);
      const historicalEnd = new Date(recentStart);
      historicalEnd.setDate(historicalEnd.getDate() - 1);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const [recentData, historicalData] = await Promise.all([
        querySearchAnalytics(property, {
          startDate: args.start_date,
          endDate: args.end_date,
          dimensions: [args.dimension],
          dataState: "all",
          rowLimit: 25000,
        }),
        querySearchAnalytics(property, {
          startDate: fmt(historicalStart),
          endDate: fmt(historicalEnd),
          dimensions: [args.dimension],
          dataState: "all",
          rowLimit: 25000,
        }),
      ]);

      const histMap = new Map(
        (historicalData.rows ?? []).map((r) => [r.keys?.[0] ?? "", r]),
      );
      const recentMap = new Map(
        (recentData.rows ?? []).map((r) => [r.keys?.[0] ?? "", r]),
      );

      const decayed: Record<string, unknown>[] = [];

      for (const [key, hist] of histMap) {
        if (hist.impressions < args.min_impressions) continue;
        const recent = recentMap.get(key);
        const recentImpressions = recent?.impressions ?? 0;

        // Normalize by period length
        const recentDays =
          (new Date(args.end_date).getTime() - new Date(args.start_date).getTime()) /
            86400000 +
          1;
        const histDays =
          (historicalEnd.getTime() - historicalStart.getTime()) / 86400000 + 1;
        const recentDaily = recentImpressions / recentDays;
        const histDaily = hist.impressions / histDays;

        const dropPct = histDaily > 0 ? 1 - recentDaily / histDaily : 0;

        if (dropPct >= args.decay_threshold) {
          decayed.push({
            [args.dimension]: key,
            peak_daily_impressions: Math.round(histDaily),
            current_daily_impressions: Math.round(recentDaily),
            decay: `-${(dropPct * 100).toFixed(0)}%`,
            peak_clicks_daily: Math.round(hist.clicks / histDays),
            current_clicks_daily: Math.round((recent?.clicks ?? 0) / recentDays),
          });
        }
      }

      decayed.sort(
        (a, b) =>
          (b.peak_daily_impressions as number) - (a.peak_daily_impressions as number),
      );

      if (decayed.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No content decay detected above ${(args.decay_threshold * 100).toFixed(0)}% threshold.`,
            },
          ],
        };
      }

      const columns = [
        args.dimension,
        "peak_daily_impressions",
        "current_daily_impressions",
        "decay",
        "peak_clicks_daily",
        "current_clicks_daily",
      ];

      const header = [
        `**Content Decay for ${property}**`,
        `**Recent:** ${args.start_date} to ${args.end_date}`,
        `**Historical:** ${fmt(historicalStart)} to ${fmt(historicalEnd)}`,
        `**Threshold:** ${(args.decay_threshold * 100).toFixed(0)}% drop`,
        `**Found:** ${decayed.length} decaying ${args.dimension === "page" ? "pages" : "queries"}\n`,
      ].join("\n");

      const table = formatMarkdownTable(decayed.slice(0, 100), columns);

      return {
        content: [{ type: "text", text: `${header}\n${table}` }],
      };
    },
  );

  readTool(
    server,
    "weekly_seo_report",
    "All-in-one SEO report: runs performance overview + quick wins + top movers + indexing issues summary. Returns a combined markdown report.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
      start_date: z.string().describe("Report period start date"),
      end_date: z.string().describe("Report period end date"),
      comparison_days: z.number().default(7).describe("Days for comparison period"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);

      const startCurrent = new Date(args.start_date);
      const endPrev = new Date(startCurrent);
      endPrev.setDate(endPrev.getDate() - 1);
      const startPrev = new Date(endPrev);
      startPrev.setDate(startPrev.getDate() - args.comparison_days + 1);
      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      // Fetch all data in parallel
      const [overview, prevOverview, queryData, prevQueryData] = await Promise.all([
        querySearchAnalytics(property, {
          startDate: args.start_date,
          endDate: args.end_date,
          dimensions: ["date"],
          dataState: "all",
          rowLimit: 25000,
        }),
        querySearchAnalytics(property, {
          startDate: fmt(startPrev),
          endDate: fmt(endPrev),
          dimensions: ["date"],
          dataState: "all",
          rowLimit: 25000,
        }),
        querySearchAnalytics(property, {
          startDate: args.start_date,
          endDate: args.end_date,
          dimensions: ["query"],
          dataState: "all",
          rowLimit: 25000,
        }),
        querySearchAnalytics(property, {
          startDate: fmt(startPrev),
          endDate: fmt(endPrev),
          dimensions: ["query"],
          dataState: "all",
          rowLimit: 25000,
        }),
      ]);

      const sections: string[] = [
        `# Weekly SEO Report for ${property}`,
        `**Period:** ${args.start_date} to ${args.end_date}`,
        `**Comparison:** ${fmt(startPrev)} to ${fmt(endPrev)}\n`,
      ];

      // --- Performance Overview ---
      const currRows = overview.rows ?? [];
      const prevRows = prevOverview.rows ?? [];

      const sum = (rows: typeof currRows, field: "clicks" | "impressions") =>
        rows.reduce((s, r) => s + r[field], 0);
      const avg = (rows: typeof currRows, field: "ctr" | "position") =>
        rows.length > 0 ? rows.reduce((s, r) => s + r[field], 0) / rows.length : 0;

      const currClicks = sum(currRows, "clicks");
      const prevClicks = sum(prevRows, "clicks");
      const currImpressions = sum(currRows, "impressions");
      const prevImpressions = sum(prevRows, "impressions");
      const currCtr = avg(currRows, "ctr");
      const prevCtr = avg(prevRows, "ctr");
      const currPos = avg(currRows, "position");
      const prevPos = avg(prevRows, "position");

      const delta = (curr: number, prev: number) => {
        if (prev === 0) return "—";
        const pct = ((curr - prev) / prev) * 100;
        return pct >= 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
      };

      sections.push("## Performance Overview\n");
      sections.push("| Metric | Current | Previous | Change |");
      sections.push("| --- | --- | --- | --- |");
      sections.push(
        `| Clicks | ${currClicks.toLocaleString()} | ${prevClicks.toLocaleString()} | ${delta(currClicks, prevClicks)} |`,
      );
      sections.push(
        `| Impressions | ${currImpressions.toLocaleString()} | ${prevImpressions.toLocaleString()} | ${delta(currImpressions, prevImpressions)} |`,
      );
      sections.push(
        `| CTR | ${formatCtr(currCtr)} | ${formatCtr(prevCtr)} | ${delta(currCtr, prevCtr)} |`,
      );
      sections.push(
        `| Position | ${formatPosition(currPos)} | ${formatPosition(prevPos)} | ${delta(prevPos, currPos)} |`,
      );

      // --- Quick Wins ---
      const wins = (queryData.rows ?? [])
        .filter(
          (r) =>
            r.impressions >= 100 && r.ctr <= 0.05 && r.position >= 4 && r.position <= 20,
        )
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 10);

      if (wins.length > 0) {
        sections.push("\n## Quick Wins (Top 10)\n");
        sections.push("| Query | Clicks | Impressions | CTR | Position |");
        sections.push("| --- | --- | --- | --- | --- |");
        for (const w of wins) {
          sections.push(
            `| ${w.keys?.[0]} | ${w.clicks} | ${w.impressions} | ${formatCtr(w.ctr)} | ${formatPosition(w.position)} |`,
          );
        }
      }

      // --- Top Movers ---
      const currQMap = new Map((queryData.rows ?? []).map((r) => [r.keys?.[0] ?? "", r]));
      const prevQMap = new Map(
        (prevQueryData.rows ?? []).map((r) => [r.keys?.[0] ?? "", r]),
      );

      const movers: {
        query: string;
        delta: number;
        current: number;
        previous: number;
      }[] = [];
      for (const [q, curr] of currQMap) {
        const prev = prevQMap.get(q);
        const d = curr.clicks - (prev?.clicks ?? 0);
        movers.push({
          query: q,
          delta: d,
          current: curr.clicks,
          previous: prev?.clicks ?? 0,
        });
      }
      movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      const topGainers = movers.filter((m) => m.delta > 0).slice(0, 5);
      const topDecliners = movers.filter((m) => m.delta < 0).slice(0, 5);

      if (topGainers.length > 0) {
        sections.push("\n## Top Gainers\n");
        sections.push("| Query | Current Clicks | Previous | Change |");
        sections.push("| --- | --- | --- | --- |");
        for (const g of topGainers) {
          sections.push(`| ${g.query} | ${g.current} | ${g.previous} | +${g.delta} |`);
        }
      }

      if (topDecliners.length > 0) {
        sections.push("\n## Top Decliners\n");
        sections.push("| Query | Current Clicks | Previous | Change |");
        sections.push("| --- | --- | --- | --- |");
        for (const d of topDecliners) {
          sections.push(`| ${d.query} | ${d.current} | ${d.previous} | ${d.delta} |`);
        }
      }

      return {
        content: [{ type: "text", text: sections.join("\n") }],
      };
    },
  );
}
