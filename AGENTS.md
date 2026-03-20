# Agent Guidelines for mcp-gsc

## Project Structure

```
src/
├── index.ts                  # Entry point (stdio transport + setup dispatch)
├── server.ts                 # McpServer creation + tool registration
├── auth/
│   ├── index.ts              # Auth router + getAuthHeaders() (just Bearer token)
│   ├── oauth.ts              # OAuth 2.0 token load/refresh
│   ├── service-account.ts    # Service account JWT auth
│   └── setup.ts              # Interactive credential + config helper
├── config/
│   └── env.ts                # Zod-validated env vars + .env file loading
├── services/
│   ├── gsc-api.ts            # Central REST client with retry logic
│   ├── format.ts             # Markdown table / CSV formatters
│   ├── rate-limiter.ts       # URL Inspection rate tracking (600 QPM + 2K/day)
│   └── property-resolver.ts  # Auto-resolve GSC property format
├── tools/
│   ├── index.ts              # Barrel: registers all tools on server
│   ├── sites.ts              # list_properties, get_property_details
│   ├── analytics.ts          # search_analytics (core)
│   ├── sitemaps.ts           # list_sitemaps, get_sitemap + write tools
│   ├── inspection.ts         # inspect_url, batch_inspect_urls
│   ├── export.ts             # export_csv
│   ├── sites-write.ts        # add_site, delete_site (gated)
│   ├── reporting.ts          # performance_overview, compare_periods, top_movers, device_country_breakdown
│   ├── seo.ts                # quick_wins, cannibalization, opportunity_finder, position_tracking, ctr_anomalies, content_decay, weekly_seo_report
│   └── technical.ts          # indexing_coverage, sitemap_health
└── utils/
    ├── logger.ts             # stderr-only logger
    └── property.ts           # URL encoding, domain extraction, brand name extraction
```

## Authentication

Two methods (auto-detected from credentials file):
- **OAuth 2.0** — Run `bun run setup` to authorize interactively
- **Service Account** — Auto-detected if credentials file has `type: "service_account"`

Auth headers are simpler than mcp-gads: just `Authorization: Bearer {token}`.

## API Endpoints

Two base URLs:
- `https://www.googleapis.com/webmasters/v3/` — Sites, Sitemaps, Search Analytics
- `https://searchconsole.googleapis.com/v1/` — URL Inspection

`siteUrl` must be URL-encoded in path params.

## GSC-Specific Gotchas

1. **searchAppearance dimension** cannot combine with query or page (API restriction)
2. **hour dimension** requires `dataState: "hourly_all"`, limited to last 10 days
3. **Country codes** are ISO 3166-1 alpha-3 (usa, gbr, deu) — NOT alpha-2
4. **`type` not `searchType`** — the deprecated field name was `searchType`
5. **25K row ceiling** is absolute even with pagination
6. **URL Inspection** has dual limits: 600 QPM + 2,000/day per site

## Adding New Tools

1. Create or edit a file in `src/tools/`
2. Export a `registerXTools(server: McpServer)` function
3. Use `server.tool(name, description, zodSchema, handler)`
4. Handler must return `{ content: [{ type: "text", text }] }`
5. Import and call registration in `src/tools/index.ts`

## Tool Gating

- Write tools gated by `GOOGLE_GSC_ENABLE_WRITES=true`
- Extended tools gated by `GOOGLE_GSC_ENABLE_EXTENDED_TOOLS=true`
- When disabled, tools aren't registered — invisible to AI clients
