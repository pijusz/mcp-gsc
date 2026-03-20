import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatCtr, formatMarkdownTable, formatPosition } from "../services/format.js";
import { querySearchAnalytics } from "../services/gsc-api.js";
import { resolveProperty } from "../services/property-resolver.js";

export function registerReportingTools(server: McpServer) {
  server.tool(
    "performance_overview",
    "Aggregate metrics (total clicks, impressions, avg CTR, avg position) plus a daily trend breakdown for a property. Single API call.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
      start_date: z.string().describe("Start date YYYY-MM-DD"),
      end_date: z.string().describe("End date YYYY-MM-DD"),
      type: z
        .enum(["web", "image", "video", "news", "discover", "googleNews"])
        .optional()
        .describe("Search type (default: web)"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);
      const data = await querySearchAnalytics(property, {
        startDate: args.start_date,
        endDate: args.end_date,
        dimensions: ["date"],
        type: args.type,
        dataState: "all",
        rowLimit: 25000,
      });

      const rows = data.rows ?? [];
      if (rows.length === 0) {
        return {
          content: [{ type: "text", text: "No data found." }],
        };
      }

      // Aggregate totals
      let totalClicks = 0;
      let totalImpressions = 0;
      let totalPosition = 0;
      for (const row of rows) {
        totalClicks += row.clicks;
        totalImpressions += row.impressions;
        totalPosition += row.position;
      }
      const avgCtr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
      const avgPosition = totalPosition / rows.length;

      const summary = [
        `**Performance Overview for ${property}**`,
        `**Period:** ${args.start_date} to ${args.end_date}\n`,
        `| Metric | Value |`,
        `| --- | --- |`,
        `| Total Clicks | ${totalClicks.toLocaleString()} |`,
        `| Total Impressions | ${totalImpressions.toLocaleString()} |`,
        `| Average CTR | ${formatCtr(avgCtr)} |`,
        `| Average Position | ${formatPosition(avgPosition)} |`,
        `| Days | ${rows.length} |`,
        "",
      ];

      const trend = rows.map((row) => ({
        date: row.keys?.[0] ?? "",
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: formatCtr(row.ctr),
        position: formatPosition(row.position),
      }));

      const table = formatMarkdownTable(
        trend,
        ["date", "clicks", "impressions", "ctr", "position"],
        "Daily Trend",
      );

      return {
        content: [{ type: "text", text: `${summary.join("\n")}\n${table}` }],
      };
    },
  );

  server.tool(
    "compare_periods",
    "Compare two date ranges with delta calculations (absolute change + percentage change) for each dimension value. Makes 2 API calls.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
      start_date_1: z.string().describe("Period 1 start date"),
      end_date_1: z.string().describe("Period 1 end date"),
      start_date_2: z.string().describe("Period 2 start date"),
      end_date_2: z.string().describe("Period 2 end date"),
      dimensions: z
        .array(z.enum(["query", "page", "country", "device"]))
        .optional()
        .describe("Dimensions to compare by (default: query)"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);
      const dims = args.dimensions ?? ["query"];

      const [data1, data2] = await Promise.all([
        querySearchAnalytics(property, {
          startDate: args.start_date_1,
          endDate: args.end_date_1,
          dimensions: dims,
          dataState: "all",
          rowLimit: 25000,
        }),
        querySearchAnalytics(property, {
          startDate: args.start_date_2,
          endDate: args.end_date_2,
          dimensions: dims,
          dataState: "all",
          rowLimit: 25000,
        }),
      ]);

      const map1 = new Map((data1.rows ?? []).map((r) => [r.keys?.join("|") ?? "", r]));
      const map2 = new Map((data2.rows ?? []).map((r) => [r.keys?.join("|") ?? "", r]));

      const allKeys = new Set([...map1.keys(), ...map2.keys()]);
      const compared: Record<string, unknown>[] = [];

      for (const key of allKeys) {
        const r1 = map1.get(key);
        const r2 = map2.get(key);
        const keys = key.split("|");

        const obj: Record<string, unknown> = {};
        for (let i = 0; i < dims.length; i++) {
          obj[dims[i]] = keys[i] ?? "";
        }

        const c1 = r1?.clicks ?? 0;
        const c2 = r2?.clicks ?? 0;
        const i1 = r1?.impressions ?? 0;
        const i2 = r2?.impressions ?? 0;

        obj.clicks_p1 = c1;
        obj.clicks_p2 = c2;
        obj.clicks_delta = c2 - c1;
        obj.clicks_pct = c1 > 0 ? `${(((c2 - c1) / c1) * 100).toFixed(1)}%` : "—";
        obj.impressions_p1 = i1;
        obj.impressions_p2 = i2;
        obj.impressions_delta = i2 - i1;

        compared.push(obj);
      }

      compared.sort(
        (a, b) => Math.abs(b.clicks_delta as number) - Math.abs(a.clicks_delta as number),
      );

      const capped = compared.slice(0, 100);
      const columns = [
        ...dims,
        "clicks_p1",
        "clicks_p2",
        "clicks_delta",
        "clicks_pct",
        "impressions_p1",
        "impressions_p2",
        "impressions_delta",
      ];

      const header = [
        `**Period Comparison for ${property}**`,
        `**Period 1:** ${args.start_date_1} to ${args.end_date_1}`,
        `**Period 2:** ${args.start_date_2} to ${args.end_date_2}`,
        `**Rows:** ${capped.length} of ${compared.length}\n`,
      ].join("\n");

      const table = formatMarkdownTable(capped, columns);
      return {
        content: [{ type: "text", text: `${header}\n${table}` }],
      };
    },
  );

  server.tool(
    "top_movers",
    "Biggest gains and drops in clicks/impressions/position between two periods. Period A = start_date to end_date. Period B = the comparison_days before start_date.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
      start_date: z.string().describe("Current period start date"),
      end_date: z.string().describe("Current period end date"),
      comparison_days: z
        .number()
        .default(28)
        .describe("Number of days for the comparison period before start_date"),
      metric: z
        .enum(["clicks", "impressions", "position"])
        .default("clicks")
        .describe("Metric to sort movers by"),
      limit: z.number().default(20).describe("Number of top movers to return"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);

      const startA = new Date(args.start_date);
      const endB = new Date(startA);
      endB.setDate(endB.getDate() - 1);
      const startB = new Date(endB);
      startB.setDate(startB.getDate() - args.comparison_days + 1);

      const fmt = (d: Date) => d.toISOString().slice(0, 10);

      const [dataA, dataB] = await Promise.all([
        querySearchAnalytics(property, {
          startDate: args.start_date,
          endDate: args.end_date,
          dimensions: ["query"],
          dataState: "all",
          rowLimit: 25000,
        }),
        querySearchAnalytics(property, {
          startDate: fmt(startB),
          endDate: fmt(endB),
          dimensions: ["query"],
          dataState: "all",
          rowLimit: 25000,
        }),
      ]);

      const mapA = new Map((dataA.rows ?? []).map((r) => [r.keys?.[0] ?? "", r]));
      const mapB = new Map((dataB.rows ?? []).map((r) => [r.keys?.[0] ?? "", r]));

      const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
      const movers: Record<string, unknown>[] = [];

      for (const key of allKeys) {
        const a = mapA.get(key);
        const b = mapB.get(key);
        const valA = a?.[args.metric] ?? 0;
        const valB = b?.[args.metric] ?? 0;
        const delta = (valA as number) - (valB as number);

        movers.push({
          query: key,
          current: valA,
          previous: valB,
          delta,
          pct:
            (valB as number) > 0
              ? `${((delta / (valB as number)) * 100).toFixed(1)}%`
              : "new",
        });
      }

      movers.sort((a, b) => Math.abs(b.delta as number) - Math.abs(a.delta as number));

      const gainers = movers.filter((m) => (m.delta as number) > 0).slice(0, args.limit);
      const decliners = movers
        .filter((m) => (m.delta as number) < 0)
        .slice(0, args.limit);

      const header = [
        `**Top Movers for ${property} (${args.metric})**`,
        `**Current:** ${args.start_date} to ${args.end_date}`,
        `**Previous:** ${fmt(startB)} to ${fmt(endB)}\n`,
      ].join("\n");

      const cols = ["query", "current", "previous", "delta", "pct"];
      const gainerTable = formatMarkdownTable(
        gainers,
        cols,
        `Top ${gainers.length} Gainers`,
      );
      const declinerTable = formatMarkdownTable(
        decliners,
        cols,
        `Top ${decliners.length} Decliners`,
      );

      return {
        content: [
          {
            type: "text",
            text: `${header}\n${gainerTable}\n\n${declinerTable}`,
          },
        ],
      };
    },
  );

  server.tool(
    "device_country_breakdown",
    "Performance breakdown by device type and/or country.",
    {
      site_url: z.string().optional().describe("GSC property URL"),
      start_date: z.string().describe("Start date YYYY-MM-DD"),
      end_date: z.string().describe("End date YYYY-MM-DD"),
      breakdown: z.enum(["device", "country", "both"]).describe("Breakdown type"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);
      const dims = args.breakdown === "both" ? ["device", "country"] : [args.breakdown];

      const data = await querySearchAnalytics(property, {
        startDate: args.start_date,
        endDate: args.end_date,
        dimensions: dims,
        dataState: "all",
        rowLimit: 25000,
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

      const columns = [...dims, "clicks", "impressions", "ctr", "position"];
      const table = formatMarkdownTable(rows.slice(0, 100), columns);

      return {
        content: [
          {
            type: "text",
            text: `**${args.breakdown} breakdown for ${property}**\n${args.start_date} to ${args.end_date}\n\n${table}`,
          },
        ],
      };
    },
  );
}
