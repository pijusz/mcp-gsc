# mcp-gsc — Google Search Console MCP Server Specification

## Overview

An MCP (Model Context Protocol) server for Google Search Console, built with Bun/TypeScript. Exposes read and write tools for GSC data via stdio transport. Published as `mcp-gsc` on npm.

**Stack**: Bun + TypeScript, `@modelcontextprotocol/sdk` + `zod` (2 runtime deps + `google-auth-library`)
**Pattern**: Follows mcp-gads/mcp-redtrack architecture exactly.

---

## Project Structure

```
mcp-gsc/
  src/
    index.ts                  — Entry point: CLI flags (--version, setup), stdio transport, startup preflight, update checker
    server.ts                 — Creates McpServer, registers tools based on env flags
    auth/
      index.ts                — Auth router: getAccessToken() + getAuthHeaders() (simpler than mcp-gads: no developer-token or login-customer-id, just Authorization: Bearer)
      oauth.ts                — OAuth2 flow (google-auth-library), token caching/refresh, deriveTokenPath()
      service-account.ts      — Service account JWT auth via GoogleAuth
      setup.ts                — Combined setup: prints config JSON for Claude Desktop/Cursor/Codex + runs OAuth consent flow + verifies auth
    config/
      env.ts                  — Zod-validated env config with custom .env loader (same pattern as mcp-gads, no dotenv dep)
    services/
      gsc-api.ts              — REST client: fetchWithRetry, all GSC API functions (see API Endpoints section)
      format.ts               — Response formatting: formatMarkdownTable, formatCsv
      rate-limiter.ts         — In-memory per-site rate tracking for URL Inspection API (2K/day limit)
      property-resolver.ts    — Auto-resolve property format (sc-domain: vs https://) from sites.list, in-memory cache
    tools/
      index.ts                — Barrel: registerAllTools(), conditionally registers extended/write tools
      sites.ts                — Site management tools (list_properties, get_property_details)
      analytics.ts            — Core search analytics tool
      sitemaps.ts             — Sitemap tools (list_sitemaps, get_sitemap)
      inspection.ts           — URL inspection tools (inspect_url, batch_inspect_urls)
      export.ts               — CSV export tool (auto-paginates internally)
      # Extended tools (gated by GOOGLE_GSC_ENABLE_EXTENDED_TOOLS)
      reporting.ts            — Period comparison, top movers, performance overview, device/country breakdown
      seo.ts                  — Quick wins, cannibalization, opportunity finder, position tracking, CTR anomalies
      technical.ts            — Indexing coverage report, sitemap health
    utils/
      logger.ts               — stderr-only logger with [mcp-gsc] prefix, DEBUG mode
      property.ts             — Property URL normalization helpers
  tests/
    unit/                     — Pure function tests
    tools/                    — Tool registration + handler tests
    integration/              — Spawns server process, sends JSON-RPC
  dist/                       — Build output
  .env.example                — Example env file with all variables documented
  .gitignore
  package.json
  tsconfig.json
  biome.json
  CLAUDE.md
  AGENTS.md
  README.md
  LICENSE
```

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_GSC_CREDENTIALS_PATH` | Yes | — | Path to OAuth client secrets JSON or service account key |
| `GOOGLE_GSC_TOKEN_PATH` | No | Derived from credentials path (`*_token.json`) | Path to cached OAuth token |
| `GOOGLE_GSC_PROPERTY` | No | — | Default GSC property URL (auto-resolved if bare domain) |
| `GOOGLE_GSC_ENABLE_WRITES` | No | `false` | Enable write tools (add_site, delete_site, submit_sitemap, delete_sitemap) |
| `GOOGLE_GSC_ENABLE_EXTENDED_TOOLS` | No | `false` | Enable composite/analytics tools (reporting, SEO, technical suites) |
| `GOOGLE_GSC_ENV_FILE` | No | `.env` | Custom path to .env file |
| `DEBUG` | No | — | Enable debug logging |

**No `AUTH_TYPE` env var** — auth method is auto-detected from the credentials file content (unlike mcp-gads). If the file contains `type: "service_account"`, service account auth is used. Otherwise, OAuth is assumed.

**No API version env var** — GSC API is stable at v1, unlike Google Ads which changes versions regularly.

---

## API Endpoints

GSC uses two base URLs depending on the resource:

| Resource | Base URL | Endpoints |
|---|---|---|
| Sites | `https://www.googleapis.com/webmasters/v3/` | `sites`, `sites/{siteUrl}` |
| Sitemaps | `https://www.googleapis.com/webmasters/v3/` | `sites/{siteUrl}/sitemaps`, `sites/{siteUrl}/sitemaps/{feedpath}` |
| Search Analytics | `https://www.googleapis.com/webmasters/v3/` | `sites/{siteUrl}/searchAnalytics/query` (POST) |
| URL Inspection | `https://searchconsole.googleapis.com/v1/` | `urlInspection/index:inspect` (POST) |

Note: `siteUrl` must be URL-encoded in path params (e.g., `sc-domain:example.com` → `sc-domain%3Aexample.com`).

### `gsc-api.ts` exported functions

```
fetchWithRetry(url, opts)          — Exponential backoff on 429/5xx (2 retries, 1s base, 30s timeout)
listSites()                        — GET sites
getSite(siteUrl)                   — GET sites/{siteUrl}
addSite(siteUrl)                   — PUT sites/{siteUrl}
deleteSite(siteUrl)                — DELETE sites/{siteUrl}
querySearchAnalytics(siteUrl, params) — POST searchAnalytics/query
listSitemaps(siteUrl)              — GET sitemaps
getSitemap(siteUrl, feedpath)      — GET sitemaps/{feedpath}
submitSitemap(siteUrl, feedpath)   — PUT sitemaps/{feedpath}
deleteSitemap(siteUrl, feedpath)   — DELETE sitemaps/{feedpath}
inspectUrl(siteUrl, inspectionUrl) — POST urlInspection/index:inspect
```

---

## Authentication

### Two methods (auto-detected, no env var needed):

1. **OAuth 2.0 (default)**: Uses `google-auth-library` OAuth2Client. Token cached to disk at `*_token.json` (derived from credentials path). Auto-refreshed on expiry. Singleton client cached in-memory.
   - Scope: `https://www.googleapis.com/auth/webmasters` (full scope always — write access gated by tool registration, not auth scope)
   - Detection: credentials file has `installed` or `web` key

2. **Service Account**: Uses `google-auth-library` GoogleAuth with `keyFile`. Service account email must be manually added as a user in each GSC property.
   - Scope: same `webmasters` scope
   - Detection: credentials file has `type: "service_account"` key

### Auth headers (simpler than mcp-gads)

```ts
// GSC only needs Authorization header — no developer-token, no login-customer-id
async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}
```

### Setup Command

`npx mcp-gsc setup [credentials-path]` does everything in one flow:
1. Reads credentials file (defaults to `./credentials.json` or `GOOGLE_GSC_CREDENTIALS_PATH`)
2. Opens browser for OAuth consent (localhost callback on port 9876)
3. Exchanges auth code for tokens, saves to `*_token.json`
4. Verifies auth by calling `sites.list`
5. Reports success with number of accessible properties
6. Prints config JSON snippets for Claude Desktop, Cursor, and Codex CLI

---

## Startup Flow

1. CLI flag check (`--version` / `-v`, `setup [path]`)
2. `createServer()` — creates McpServer, registers tools based on env flags
3. Connect stdio transport
4. **Async preflight** (non-blocking, via `void runStartupPreflight()`):
   - Validate credentials file exists and is valid JSON
   - Validate token file exists (OAuth only)
   - Call `sites.list` to verify auth works and ≥1 property is accessible
   - If `GOOGLE_GSC_PROPERTY` is set, verify it exists in the property list
   - Log warnings (not errors) if any check fails — server keeps running
5. **Non-blocking update check** against `https://api.github.com/repos/pijusz/mcp-gsc/releases/latest` (3s timeout)

---

## Property Resolution

`property-resolver.ts` handles the complexity of GSC property formats:

1. If `GOOGLE_GSC_PROPERTY` env var is set, use it as default when tool's `site_url` param is omitted
2. When a tool receives a `site_url` parameter:
   - If it starts with `sc-domain:` or `http`, use as-is
   - If bare domain (e.g., `example.com`), call `sites.list` and fuzzy-match:
     - Prefer `sc-domain:example.com` if it exists
     - Fall back to `https://example.com/` or `http://example.com/`
     - If ambiguous (multiple matches), return all matches in the tool response and ask user to specify
3. Cache the `sites.list` result in-memory for the session (resets on server restart, avoids repeated API calls)

Exported function: `resolveProperty(siteUrl?: string): Promise<string>` — used by all tools.

---

## Response Format

All tools return `{ content: [{ type: "text", text }] }` — standard MCP tool response format.

Tabular data uses **markdown tables**. Every analytics response includes metadata header:

```
**Property:** sc-domain:example.com
**Date Range:** 2024-01-01 to 2024-01-28
**Rows Returned:** 100 of 15,234 total

| Query | Clicks | Impressions | CTR | Position |
|-------|--------|-------------|-----|----------|
| ...   | ...    | ...         | ... | ...      |

*100 rows shown. Use start_row/row_limit params or export_csv tool for full data.*
```

### Response capping

- Default: 100 rows per tool call
- Max: 500 rows per call (enforced server-side)
- Metadata always includes: `totalRows`, `returnedRows`, `hasMore`
- Non-tabular tools (inspect_url, property details) return `JSON.stringify(data, null, 2)`

### `format.ts` exports

```
formatMarkdownTable(rows, columns, title?)  — Renders markdown table with alignment
formatCsv(rows, columns)                    — Renders CSV string with proper escaping
```

---

## Date Range Parameters

All analytics tools accept:
- `start_date` (string, ISO format YYYY-MM-DD) — required
- `end_date` (string, ISO format YYYY-MM-DD) — required

No relative presets. The AI client knows today's date and can calculate.

Exception: `top_movers` also accepts `comparison_days` (default 28) — a convenience param that auto-computes the comparison period as the N days before `start_date`. If `start_date`/`end_date` define period A, period B is `(start_date - comparison_days)` to `(start_date - 1)`.

---

## Data Freshness

All analytics tools accept an optional `data_state` parameter:
- `"all"` (default) — includes today's incomplete data, matches GSC dashboard
- `"final"` — confirmed data only, 2-3 day lag
- `"hourly_all"` — hourly granularity with partial data (requires `hour` dimension)

Tool descriptions include clear documentation:
> `data_state`: Controls data freshness. "all" (default) includes recent incomplete data matching the GSC dashboard. "final" returns only confirmed data with a 2-3 day lag, useful for stable reporting. "hourly_all" enables hourly granularity but data may be incomplete for the current day — requires `hour` dimension, limited to last 10 days.

---

## Rate Limiting

### General API calls
`fetchWithRetry` with exponential backoff on 429/5xx (2 retries, 1s initial delay, 30s timeout). Same pattern as mcp-gads.

### URL Inspection API (special handling)

Two limits apply:
- **600 queries per minute** per site
- **2,000 queries per day** per site

`rate-limiter.ts` tracks both in-memory per-site:

**Daily tracking:**
- Counter per `siteUrl`, resets daily (midnight UTC)
- `batch_inspect_urls` counts each URL in the batch as 1 call (10 URLs = 10 calls consumed)
- Warns in response metadata when >80% of 2,000/day limit reached
- Returns error (blocks the API call) when daily limit reached:
  > "URL Inspection daily limit reached for {site}. Limit resets at midnight UTC. {count}/2000 calls used today."

**Per-minute tracking:**
- Sliding window counter per `siteUrl` (tracks timestamps of last 60s of calls)
- When approaching 600 QPM, automatically throttles with small delays between calls
- For `batch_inspect_urls`, inspections are serialized with throttling rather than parallel

Exported API:
```
trackInspection(siteUrl: string, count?: number): void
getRemainingQuota(siteUrl: string): { daily: { used, remaining, limit }, perMinute: { used, remaining, limit } }
checkQuota(siteUrl: string, needed: number): { allowed: boolean; message?: string }
waitForQuota(siteUrl: string): Promise<void>  — resolves when per-minute quota allows next call
```

---

## Tool Inventory

### Core Tools (always registered) — 8 tools

#### Sites (2)
| Tool | Description | Params |
|---|---|---|
| `list_properties` | List all GSC properties with permission levels and verification status | — |
| `get_property_details` | Get verification info, ownership, permissions for a specific property | `site_url` |

#### Search Analytics (1)
| Tool | Description | Key Params |
|---|---|---|
| `search_analytics` | Query search performance data (clicks, impressions, CTR, position) with filtering and grouping | `site_url?`, `start_date`, `end_date`, `dimensions[]?`, `type?`, `data_state?`, `dimension_filters[]?`, `row_limit?` (default 100, max 500), `start_row?`, `brand_filter?` |

**Dimensions** (7 total): `query`, `page`, `country`, `device`, `date`, `searchAppearance`, `hour`

- `hour` dimension requires `data_state: "hourly_all"` and is limited to the last 10 days
- `searchAppearance` **cannot be combined** with `query` or `page` dimensions (API restriction). If attempted, the tool returns an error explaining this limitation.

**`type` parameter** (replaces deprecated `searchType`): `web` (default), `image`, `video`, `news`, `discover`, `googleNews`

- `discover` = Google Discover feed performance
- `googleNews` = Google News tab (distinct from `news` which is web search news results)

**`brand_filter` parameter** (optional): `brand_only`, `non_brand_only`, or omitted for all queries.
When set, auto-applies a regex filter on the `query` dimension using the site's domain name (e.g., for `sc-domain:example.com`, filters by `includingRegex: "example"` or `excludingRegex: "example"`).

**`dimension_filters` schema:**
```ts
z.array(z.object({
  dimension: z.enum(["query", "page", "country", "device", "searchAppearance"]),
  operator: z.enum(["equals", "notEquals", "contains", "notContains", "includingRegex", "excludingRegex"]),
  expression: z.string().describe("For country dimension, use ISO 3166-1 alpha-3 codes (e.g., 'usa', 'gbr', 'deu') — NOT alpha-2 codes"),
})).optional()
```

#### Sitemaps (2)
| Tool | Description | Params |
|---|---|---|
| `list_sitemaps` | List all sitemaps with status, type, indexed URL counts, errors/warnings | `site_url?`, `sitemap_index?` (filter by parent sitemap index URL) |
| `get_sitemap` | Get detailed info for a specific sitemap including content breakdown by type | `site_url?`, `sitemap_url` |

#### URL Inspection (2)
| Tool | Description | Params |
|---|---|---|
| `inspect_url` | Inspect a URL's indexing status, crawl info, rich results, mobile usability, canonical URLs | `site_url?`, `url` |
| `batch_inspect_urls` | Inspect up to 10 URLs simultaneously. Returns categorized results (indexed, not indexed, issues). Each URL counts against the daily 2,000 inspection limit. | `site_url?`, `urls[]` (max 10) |

#### Export (1)
| Tool | Description | Params |
|---|---|---|
| `export_csv` | Export search analytics data to a CSV file. Auto-paginates internally (25K rows per API call) to write the full dataset, bypassing the tool response row cap. | `site_url?`, `start_date`, `end_date`, `dimensions[]?`, `search_type?`, `dimension_filters[]?`, `output_path?` (defaults to `./gsc-export-{timestamp}.csv`) |

The export tool:
1. Makes paginated `querySearchAnalytics` calls (startRow increments by 25,000)
2. Streams rows to a CSV file via `writeFile`
3. Returns only metadata in the tool response: file path, total rows exported, file size

**Important: 25K row ceiling is absolute.** The GSC API returns at most 25,000 rows per query, sorted by impressions descending. Even with pagination, you only get the top 25K. For very large sites with millions of query/page combinations, this means the export will never contain the complete long tail. The export tool documents this in its response metadata when the result hits exactly 25K rows.

### Write Tools (gated by `GOOGLE_GSC_ENABLE_WRITES`) — 4 tools

All write tool descriptions start with a warning prefix.

| Tool | Description | Params |
|---|---|---|
| `add_site` | Add a new site to GSC. The site must be verified separately. | `site_url` |
| `delete_site` | Remove a site from GSC. This does not affect the site itself, only removes it from your GSC account. | `site_url` |
| `submit_sitemap` | Submit a new sitemap URL for a property | `site_url?`, `sitemap_url` |
| `delete_sitemap` | Remove/unsubmit a sitemap from a property | `site_url?`, `sitemap_url` |

### Extended Tools (gated by `GOOGLE_GSC_ENABLE_EXTENDED_TOOLS`) — 13 tools

#### Reporting Suite (4)
| Tool | Description | Key Params |
|---|---|---|
| `performance_overview` | Aggregate metrics (total clicks, impressions, avg CTR, avg position) + daily trend breakdown for a property. Single API call with `date` dimension. | `site_url?`, `start_date`, `end_date`, `search_type?` |
| `compare_periods` | Compare two date ranges with delta calculations (absolute change + percentage change) for each dimension value. Makes 2 API calls. | `site_url?`, `start_date_1`, `end_date_1`, `start_date_2`, `end_date_2`, `dimensions[]?` |
| `top_movers` | Biggest gains and drops in clicks/impressions/position between two periods. Period A = `start_date` to `end_date`. Period B = the `comparison_days` before `start_date`. Makes 2 API calls, computes deltas, sorts by absolute change. | `site_url?`, `start_date`, `end_date`, `comparison_days?` (default 28), `metric?` (clicks/impressions/position, default clicks), `limit?` (default 20) |
| `device_country_breakdown` | Performance breakdown by device type and/or country | `site_url?`, `start_date`, `end_date`, `breakdown` (device/country/both) |

#### SEO Suite (7)
| Tool | Description | Key Params |
|---|---|---|
| `quick_wins` | Find high-impression, low-CTR queries in striking distance. Queries search_analytics with `query` dimension, filters server-side by thresholds. | `site_url?`, `start_date`, `end_date`, `min_impressions?` (default 100), `max_ctr?` (default 0.05), `min_position?` (default 4), `max_position?` (default 20) |
| `cannibalization` | Detect keyword cannibalization — multiple pages ranking for the same query. Queries with `query` + `page` dimensions, groups by query, flags queries with 2+ pages. | `site_url?`, `start_date`, `end_date`, `mode?` (default `click_weighted` — factors in click distribution; `position` — simple overlap detection), `min_impressions?` (default 50) |
| `opportunity_finder` | Find queries with improving impressions but low clicks, new emerging queries, and declining performers. Makes 2 API calls (current period vs previous), computes deltas. | `site_url?`, `start_date`, `end_date`, `comparison_days?` (default 28) |
| `position_tracking` | Track position changes for specific queries or pages over time. Uses `date` dimension + query/page filters. Returns daily/weekly averages. | `site_url?`, `start_date`, `end_date`, `queries[]?`, `pages[]?`, `granularity?` (daily/weekly, default daily) |
| `ctr_anomalies` | Detect queries/pages with abnormally low or high CTR relative to their position. Uses expected CTR curves per position bucket (1-3, 4-10, 11-20, etc.) and flags deviations. | `site_url?`, `start_date`, `end_date`, `min_impressions?` (default 100) |
| `content_decay` | Detect pages/queries where impressions have dropped >50% comparing recent period to historical peak within the 16-month API window. Makes 2+ API calls to compare periods. | `site_url?`, `start_date`, `end_date`, `decay_threshold?` (default 0.5 = 50% drop), `dimension?` (query/page, default page), `min_impressions?` (default 200) |
| `weekly_seo_report` | All-in-one SEO report: runs performance overview + quick wins + top movers + indexing issues summary. Makes 4-6 API calls, returns a combined markdown report with sections. | `site_url?`, `start_date`, `end_date`, `comparison_days?` (default 7) |

#### Technical SEO Suite (2)
| Tool | Description | Key Params |
|---|---|---|
| `indexing_coverage` | Batch-inspect user-provided URLs, categorize by indexing status: indexed, not indexed, canonical mismatch, robots blocked, fetch error, other. Respects rate limiter. | `site_url?`, `urls[]` |
| `sitemap_health` | Analyze all sitemaps: error/warning patterns, submission freshness (days since last submitted), indexed vs submitted ratio per sitemap. | `site_url?` |

**Total: 8 core + 4 write + 13 extended = 25 tools**

---

## Dependencies

### Runtime
- `@modelcontextprotocol/sdk` (^1.12.1) — MCP server framework (McpServer, StdioServerTransport)
- `zod` (^3.24.4) — Schema validation for env config and tool input parameters
- `google-auth-library` (^9.15.1) — OAuth2Client, GoogleAuth for service accounts

### Dev
- `@biomejs/biome` (^2.4.4) — Linting/formatting
- `@types/bun` (^1.2.9) — Bun type definitions
- `typescript` (^5.8.3) — Type checking (`tsc --noEmit`)

No `googleapis` package — use direct REST calls via native `fetch`. Keeps the dependency tree small (3 runtime deps, same approach as mcp-gads).

---

## Build & Distribution

```json
{
  "scripts": {
    "dev": "bun src/index.ts",
    "build": "bun build src/index.ts --compile --outfile=mcp-gsc",
    "build:npm": "bun build src/index.ts --bundle --target node --outfile dist/index.js && node -e \"const f='dist/index.js';require('fs').writeFileSync(f,require('fs').readFileSync(f,'utf8').replace('#!/usr/bin/env bun','#!/usr/bin/env node'))\"",
    "prepublishOnly": "bun run build:npm",
    "test": "bun test",
    "typecheck": "tsc --noEmit",
    "setup": "bun run src/auth/setup.ts",
    "inspect": "bunx @modelcontextprotocol/inspector bun src/index.ts",
    "format": "biome format --write .",
    "lint": "biome check .",
    "check": "biome check --write ."
  }
}
```

- **Dev**: `bun run dev` (runs src/index.ts directly)
- **Binary**: `bun build --compile` → standalone `mcp-gsc` executable
- **npm**: `bun build --bundle --target node` → `dist/index.js` with node shebang rewrite
- **Package**: Published as `mcp-gsc` on npm, supports `npx mcp-gsc`
- **MCP Inspector**: `bun run inspect` for local debugging

---

## Testing Strategy

Three tiers (same as mcp-sanity-images):

1. **Unit tests** (`tests/unit/`):
   - `property-resolver.test.ts` — bare domain matching, sc-domain preference, ambiguity handling
   - `format.test.ts` — markdown table rendering, CSV escaping, edge cases
   - `rate-limiter.test.ts` — counter tracking, daily reset, quota check, batch counting
   - `env.test.ts` — Zod validation, .env parsing, defaults

2. **Tool tests** (`tests/tools/`):
   - Register tools on McpServer, verify correct tools registered per env config
   - Call tool handlers with mocked API responses, verify markdown table output
   - Test error handling (invalid property, auth failure, rate limit)

3. **Integration tests** (`tests/integration/`):
   - Spawn actual server process with `Bun.spawn`
   - Send JSON-RPC `initialize` and `tools/list` messages over stdin
   - Verify response format and tool count matches env config

Test runner: `bun:test`

---

## Config Files

### tsconfig.json
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "types": ["bun-types"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

### biome.json
Same as mcp-gads: 2-space indent, double quotes, semicolons, trailing commas, line width 90, recommended lint rules, relaxed for tests (noExplicitAny off, useLiteralKeys off, useTemplate off).

### .gitignore
```
node_modules/
dist/
*.tgz
.DS_Store
.env
.env.local
.env.*
!.env.example
credentials.json
*_token.json
mcp-gsc-*
mcp-gsc
```

### package.json metadata
```json
{
  "name": "mcp-gsc",
  "version": "0.1.0",
  "description": "Google Search Console MCP server — query search analytics, inspect URLs, manage sitemaps & more via natural language",
  "type": "module",
  "bin": { "mcp-gsc": "dist/index.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "keywords": ["mcp", "google-search-console", "gsc", "seo", "ai", "claude", "model-context-protocol", "bun"],
  "author": "pijusz",
  "license": "MIT",
  "engines": { "node": ">=18" }
}
```

---

## README Structure

1. Logo + title + badges (npm version, license)
2. One-line description
3. Features list
4. Quick start (`npx mcp-gsc setup`)
5. Configuration (env vars table)
6. Tools reference (grouped by category: Core, Write, Extended)
7. Authentication guide (OAuth + Service Account)
8. Examples (common AI prompts like "Show me my top 10 queries this month", "Find quick wins for example.com")
9. **Future Tool Ideas** section:
   - Content gap analysis (requires competitor data integration)
   - Core Web Vitals integration (via PageSpeed Insights API)
   - Automated reporting schedules
   - Multi-property comparison
   - Search appearance deep analysis
   - Integration with Google Analytics for conversion data
10. Development (contributing, building, testing)
11. License (MIT)

---

## Key Design Decisions

1. **Full OAuth scope, tool-gated writes** — simpler auth flow, security via tool registration not auth scope
2. **Auto-detect auth type from credentials file** — no `AUTH_TYPE` env var needed (improvement over mcp-gads)
3. **Auto-resolve property format** — fuzzy match bare domains against sites.list, session-cached
4. **Default property env var** — `GOOGLE_GSC_PROPERTY` so most users set once, never pass per-call
5. **Markdown tables** — better rendering in AI clients than ASCII tables (differs from mcp-gads)
6. **100 row default cap, 500 max** — prevents context window overflow
7. **CSV export with internal auto-pagination** — export tool paginates through 25K-row API pages internally, writes full dataset to file, returns only metadata to context
8. **Proactive URL Inspection rate tracking** — in-memory counter per-site, warn at 80%, block at limit. Batch tool counts each URL individually.
9. **Stateless, 16-month window** — no local data caching, keep it simple
10. **Combined setup + auth command** — one command prints config JSON AND runs OAuth flow AND verifies (enhancement over mcp-gads which only does auth)
11. **start_date + end_date everywhere** — no relative presets, AI knows today's date. `comparison_days` on `top_movers`/`opportunity_finder` is the only convenience param.
12. **Data freshness as documented param** — "all" default, tool descriptions explain the tradeoff clearly
13. **Cannibalization: both modes** — `click_weighted` default (more actionable), `position` mode available
14. **searchAppearance as dimension** — not a separate tool, available in main `search_analytics` tool's dimensions
15. **Single property per call** — AI composes multi-property workflows itself
16. **User provides URLs for inspection** — no automatic URL sourcing from sitemaps/analytics
17. **No `googleapis` package** — direct REST calls via native fetch, same as mcp-gads
18. **Simpler auth headers than mcp-gads** — GSC needs only `Authorization: Bearer`, no developer-token or login-customer-id
19. **`type` not `searchType`** — uses the non-deprecated API field name, adds `discover` and `googleNews` values
20. **searchAppearance dimension restriction enforced** — cannot combine with `query` or `page`; tool validates and returns clear error
21. **Country codes documented as alpha-3** — `usa`, `gbr`, `deu` not `us`, `gb`, `de` — noted in filter descriptions to prevent common mistakes
22. **Dual rate limiting for URL Inspection** — tracks both 600 QPM and 2,000/day limits with sliding window + daily counter
23. **25K row ceiling documented** — export tool warns when result hits 25K (the absolute API maximum regardless of pagination)
24. **Brand vs non-brand filter** — `brand_filter` param auto-applies regex based on domain name, saves manual filter construction
25. **Content decay detection** — compares recent period to historical peak within 16-month window, high-value analysis not in competitors
26. **Weekly SEO report composite** — single tool that runs overview + quick wins + top movers + issues for quick health checks
