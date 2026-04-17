import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatCsv } from "../services/format.js";
import {
  querySearchAnalytics,
  type SearchAnalyticsRequest,
} from "../services/gsc-api.js";
import { resolveProperty } from "../services/property-resolver.js";
import { writeTool } from "../utils/register-tool.js";
import { formatAnalyticsRows } from "./analytics.js";

const MAX_ROWS_PER_REQUEST = 25000;

export function registerExportTools(server: McpServer) {
  writeTool(
    server,
    "export_csv",
    `Export search analytics data to a CSV file. Auto-paginates internally (25K rows per API call) to write the full dataset, bypassing the tool response row cap.

IMPORTANT: The GSC API has an absolute ceiling of 25,000 rows per query (sorted by impressions descending). For very large sites, this means the export will contain the top 25K query/page combinations, not the complete long tail. This is a Google API limitation, not a tool limitation.`,
    {
      site_url: z
        .string()
        .optional()
        .describe("GSC property URL. Defaults to GOOGLE_GSC_PROPERTY env var."),
      start_date: z.string().describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().describe("End date in YYYY-MM-DD format"),
      dimensions: z
        .array(z.enum(["query", "page", "country", "device", "date", "searchAppearance"]))
        .optional()
        .describe("Dimensions to include in the export"),
      type: z
        .enum(["web", "image", "video", "news", "discover", "googleNews"])
        .optional()
        .describe("Search type (default: web)"),
      dimension_filters: z
        .array(
          z.object({
            dimension: z.enum(["query", "page", "country", "device", "searchAppearance"]),
            operator: z.enum([
              "equals",
              "notEquals",
              "contains",
              "notContains",
              "includingRegex",
              "excludingRegex",
            ]),
            expression: z.string(),
          }),
        )
        .optional(),
      output_path: z
        .string()
        .optional()
        .describe("Output file path (defaults to ./gsc-export-{timestamp}.csv)"),
    },
    async (args) => {
      const property = await resolveProperty(args.site_url);
      const dims = args.dimensions ?? ["query"];
      const columns = [...dims, "clicks", "impressions", "ctr", "position"];

      let allRows: Record<string, unknown>[] = [];
      const startRow = 0;
      let hitCeiling = false;

      // Paginate through results
      while (true) {
        const request: SearchAnalyticsRequest = {
          startDate: args.start_date,
          endDate: args.end_date,
          dimensions: dims,
          type: args.type,
          dataState: "all",
          rowLimit: MAX_ROWS_PER_REQUEST,
          startRow,
        };

        if (args.dimension_filters?.length) {
          request.dimensionFilterGroups = [
            {
              filters: args.dimension_filters.map(
                (f: { dimension: string; operator: string; expression: string }) => ({
                  dimension: f.dimension,
                  operator: f.operator,
                  expression: f.expression,
                }),
              ),
            },
          ];
        }

        const data = await querySearchAnalytics(property, request);
        const rows = data.rows ?? [];

        if (rows.length === 0) break;

        const formatted = formatAnalyticsRows(rows, dims);
        allRows = allRows.concat(formatted);

        if (rows.length < MAX_ROWS_PER_REQUEST) break;

        // Hit the 25K ceiling
        hitCeiling = true;
        break;
      }

      if (allRows.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No data found for the specified parameters.",
            },
          ],
        };
      }

      const csv = formatCsv(allRows, columns);
      const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
      const filePath = resolve(args.output_path ?? `./gsc-export-${timestamp}.csv`);

      await writeFile(filePath, csv, "utf-8");

      const fileSizeKb = (Buffer.byteLength(csv) / 1024).toFixed(1);

      const lines = [
        `**CSV exported successfully**`,
        `**File:** ${filePath}`,
        `**Rows:** ${allRows.length}`,
        `**Size:** ${fileSizeKb} KB`,
        `**Columns:** ${columns.join(", ")}`,
      ];

      if (hitCeiling) {
        lines.push(
          "",
          `**Note:** Results hit the GSC API ceiling of ${MAX_ROWS_PER_REQUEST.toLocaleString()} rows (sorted by impressions descending). The long tail of queries/pages is not included. Use dimension_filters to narrow the scope for more complete data.`,
        );
      }

      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  );
}
