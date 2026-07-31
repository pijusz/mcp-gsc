import { describe, expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllTools } from "../../src/tools/index";

describe("tool registration", () => {
  test("registers core tools (8) when no flags set", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerAllTools(server, {
      GOOGLE_GSC_ENABLE_WRITES: "false",
      GOOGLE_GSC_ENABLE_EXTENDED_TOOLS: "false",
    });

    const tools = (server as any)._registeredTools;
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("list_properties");
    expect(toolNames).toContain("get_property_details");
    expect(toolNames).toContain("search_analytics");
    expect(toolNames).toContain("list_sitemaps");
    expect(toolNames).toContain("get_sitemap");
    expect(toolNames).toContain("inspect_url");
    expect(toolNames).toContain("batch_inspect_urls");
    expect(toolNames).toContain("export_csv");
    expect(toolNames.length).toBe(8);
  });

  test("registers write tools when enabled", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerAllTools(server, {
      GOOGLE_GSC_ENABLE_WRITES: "true",
      GOOGLE_GSC_ENABLE_EXTENDED_TOOLS: "false",
    });

    const tools = (server as any)._registeredTools;
    const toolNames = Object.keys(tools);

    expect(toolNames).toContain("add_site");
    expect(toolNames).toContain("delete_site");
    expect(toolNames).toContain("submit_sitemap");
    expect(toolNames).toContain("delete_sitemap");
    expect(toolNames).toContain("request_indexing");
    expect(toolNames).toContain("get_indexing_status");
    expect(toolNames.length).toBe(14); // 8 core + 4 write + 2 indexing
  });

  test("registers extended tools when enabled", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerAllTools(server, {
      GOOGLE_GSC_ENABLE_WRITES: "false",
      GOOGLE_GSC_ENABLE_EXTENDED_TOOLS: "true",
    });

    const tools = (server as any)._registeredTools;
    const toolNames = Object.keys(tools);

    // Reporting suite
    expect(toolNames).toContain("performance_overview");
    expect(toolNames).toContain("compare_periods");
    expect(toolNames).toContain("top_movers");
    expect(toolNames).toContain("device_country_breakdown");

    // SEO suite
    expect(toolNames).toContain("quick_wins");
    expect(toolNames).toContain("cannibalization");
    expect(toolNames).toContain("opportunity_finder");
    expect(toolNames).toContain("position_tracking");
    expect(toolNames).toContain("ctr_anomalies");
    expect(toolNames).toContain("content_decay");
    expect(toolNames).toContain("weekly_seo_report");

    // Technical suite
    expect(toolNames).toContain("indexing_coverage");
    expect(toolNames).toContain("sitemap_health");

    expect(toolNames.length).toBe(21); // 8 core + 13 extended
  });

  test("registers all tools when all flags enabled", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerAllTools(server, {
      GOOGLE_GSC_ENABLE_WRITES: "true",
      GOOGLE_GSC_ENABLE_EXTENDED_TOOLS: "true",
    });

    const tools = (server as any)._registeredTools;
    const toolNames = Object.keys(tools);
    expect(toolNames.length).toBe(27); // 8 core + 4 write + 2 indexing + 13 extended
  });
});
