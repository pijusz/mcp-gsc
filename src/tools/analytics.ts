import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  formatCtr,
  formatMarkdownTable,
  formatMetadata,
  formatPosition,
} from "../services/format.js";
import {
  querySearchAnalytics,
  type SearchAnalyticsRequest,
  type SearchAnalyticsRow,
} from "../services/gsc-api.js";
import { resolveProperty } from "../services/property-resolver.js";
import { extractBrandName } from "../utils/property.js";
import { readTool } from "../utils/register-tool.js";

const DIMENSIONS = [
  "query",
  "page",
  "country",
  "device",
  "date",
  "searchAppearance",
  "hour",
] as const;

const TYPES = ["web", "image", "video", "news", "discover", "googleNews"] as const;

const DATA_STATES = ["all", "final", "hourly_all"] as const;

const FILTER_OPERATORS = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "includingRegex",
  "excludingRegex",
] as const;

const FILTER_DIMENSIONS = [
  "query",
  "page",
  "country",
  "device",
  "searchAppearance",
] as const;

const dimensionFilterSchema = z
  .array(
    z.object({
      dimension: z.enum(FILTER_DIMENSIONS),
      operator: z.enum(FILTER_OPERATORS),
      expression: z
        .string()
        .describe(
          "Filter value. For country, use ISO 3166-1 alpha-3 codes (e.g., 'usa', 'gbr', 'deu') — NOT alpha-2",
        ),
    }),
  )
  .optional()
  .describe("Filters to apply to the query");

export function registerAnalyticsTools(server: McpServer) {
  readTool(
    server,
    "search_analytics",
    `Query Google Search Console search performance data (clicks, impressions, CTR, position) with filtering and grouping.

DIMENSIONS: query, page, country, device, date, searchAppearance, hour
- "hour" requires data_state="hourly_all" and is limited to the last 10 days
- "searchAppearance" CANNOT be combined with "query" or "page" (API restriction)

TYPE: web (default), image, video, news, discover, googleNews
- "discover" = Google Discover feed. "googleNews" = Google News tab (distinct from "news")

DATA STATE: Controls data freshness.
- "all" (default) includes recent incomplete data matching the GSC dashboard
- "final" returns only confirmed data with a 2-3 day lag, useful for stable reporting
- "hourly_all" enables hourly granularity but data may be incomplete for the current day

BRAND FILTER: Set to "brand_only" or "non_brand_only" to auto-filter queries by your domain name.

Country codes use ISO 3166-1 alpha-3 format (e.g., 'usa', 'gbr', 'deu') — NOT alpha-2.`,
    {
      site_url: z
        .string()
        .optional()
        .describe(
          "GSC property URL. Defaults to GOOGLE_GSC_PROPERTY env var. Accepts bare domain (auto-resolved).",
        ),
      start_date: z.string().describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().describe("End date in YYYY-MM-DD format"),
      dimensions: z
        .array(z.enum(DIMENSIONS))
        .optional()
        .describe("Dimensions to group results by"),
      type: z.enum(TYPES).optional().describe("Search type (default: web)"),
      data_state: z
        .enum(DATA_STATES)
        .optional()
        .describe("Data freshness (default: all)"),
      dimension_filters: dimensionFilterSchema,
      row_limit: z
        .number()
        .min(1)
        .max(25000)
        .optional()
        .describe(
          "Max rows to return (default: 100, max: 25000 — the Search Analytics API ceiling). Raise it to reach the long tail; large values produce large responses",
        ),
      start_row: z.number().min(0).optional().describe("0-based offset for pagination"),
      brand_filter: z
        .enum(["brand_only", "non_brand_only"])
        .optional()
        .describe(
          "Auto-filter queries by domain name. brand_only = queries containing your brand, non_brand_only = queries without",
        ),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);

      // Validate searchAppearance + query/page restriction
      if (args.dimensions?.includes("searchAppearance")) {
        if (args.dimensions.includes("query") || args.dimensions.includes("page")) {
          return {
            content: [
              {
                type: "text",
                text: 'Error: The "searchAppearance" dimension cannot be combined with "query" or "page" dimensions. This is a Google API restriction. Use searchAppearance alone or with date/country/device.',
              },
            ],
          };
        }
      }

      // Validate hour dimension requirements
      if (args.dimensions?.includes("hour")) {
        if (args.data_state && args.data_state !== "hourly_all") {
          return {
            content: [
              {
                type: "text",
                text: 'Error: The "hour" dimension requires data_state="hourly_all".',
              },
            ],
          };
        }
      }

      const rowLimit = args.row_limit ?? 100;

      // Build filters
      const filters = [...(args.dimension_filters ?? [])];

      // Brand filter
      if (args.brand_filter) {
        const brand = extractBrandName(property);
        filters.push({
          dimension: "query" as const,
          operator:
            args.brand_filter === "brand_only"
              ? ("includingRegex" as const)
              : ("excludingRegex" as const),
          expression: brand,
        });
      }

      const request: SearchAnalyticsRequest = {
        startDate: args.start_date,
        endDate: args.end_date,
        dimensions: args.dimensions,
        type: args.type,
        dataState: args.data_state ?? "all",
        rowLimit: Math.min(rowLimit, 25000),
        startRow: args.start_row ?? 0,
      };

      if (filters.length > 0) {
        request.dimensionFilterGroups = [
          {
            filters: filters.map((f) => ({
              dimension: f.dimension,
              operator: f.operator,
              expression: f.expression,
            })),
          },
        ];
      }

      if (args.dimensions?.includes("hour") && !args.data_state) {
        request.dataState = "hourly_all";
      }

      const data = await querySearchAnalytics(property, request);
      const rows = data.rows ?? [];

      if (rows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No search analytics data found for the specified parameters.",
            },
          ],
        };
      }

      const formatted = formatAnalyticsRows(rows, args.dimensions ?? []);
      const capped = formatted.slice(0, rowLimit);

      const meta = formatMetadata({
        property,
        startDate: args.start_date,
        endDate: args.end_date,
        returnedRows: capped.length,
        rowLimit,
        startRow: args.start_row ?? 0,
      });

      const columns = [
        ...(args.dimensions ?? []),
        "clicks",
        "impressions",
        "ctr",
        "position",
      ];
      const table = formatMarkdownTable(capped, columns);

      return {
        content: [{ type: "text", text: `${meta}\n\n${table}` }],
      };
    },
  );
}

export function formatAnalyticsRows(
  rows: SearchAnalyticsRow[],
  dimensions: readonly string[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    if (row.keys) {
      for (let i = 0; i < dimensions.length; i++) {
        obj[dimensions[i]] = row.keys[i] ?? "";
      }
    }
    obj.clicks = row.clicks;
    obj.impressions = row.impressions;
    obj.ctr = formatCtr(row.ctr);
    obj.position = formatPosition(row.position);
    return obj;
  });
}
