<p align="center">
  <img src="logo.svg" alt="mcp-gsc" width="280" />
</p>

<h1 align="center">mcp-gsc</h1>

<p align="center">
  Google Search Console MCP server — query search analytics, inspect URLs, manage sitemaps & more via natural language.
  <br/>
  Built with Bun + TypeScript. Works with Claude, Cursor, and any MCP client.
</p>

---

## Quick Start

### 1. Get Credentials

You need OAuth client credentials from Google Cloud Console.

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a project (or select existing)
3. Enable the **Google Search Console API**:
   - APIs & Services → Library → search "Google Search Console API" → Enable
4. Configure **OAuth consent screen** (if not done):
   - APIs & Services → OAuth consent screen → External
   - Fill in app name + your email, add scope `https://www.googleapis.com/auth/webmasters`
5. Create credentials:
   - APIs & Services → Credentials → Create Credentials → **OAuth client ID**
   - Application type: **Desktop app** (allows localhost redirects automatically)
   - Download the JSON file

6. Set the credentials path:

```bash
export GOOGLE_GSC_CREDENTIALS_PATH=/path/to/credentials.json
```

7. Run setup to authorize:

```bash
npx mcp-gsc setup
```

This opens your browser for OAuth consent, saves a refresh token, verifies access to your GSC properties, and prints config snippets for your MCP client.

### 2. Add to Claude Code

```bash
claude mcp add gsc --scope user --transport stdio \
  -e GOOGLE_GSC_CREDENTIALS_PATH=/path/to/credentials.json \
  -- npx -y mcp-gsc@latest
```

That's it. Restart Claude Code and the tools are available.

> Also works with `bunx mcp-gsc@latest` if you have [Bun](https://bun.sh/).
> Requires Node 22+ when running via `npx`.

### Claude Desktop / Cursor

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gsc": {
      "command": "npx",
      "args": ["-y", "mcp-gsc@latest"],
      "env": {
        "GOOGLE_GSC_CREDENTIALS_PATH": "/path/to/credentials.json"
      }
    }
  }
}
```

### Codex CLI

Add to `~/.codex/config.toml` (TOML, not JSON):

```toml
[mcp_servers.gsc]
command = "npx"
args = ["-y", "mcp-gsc@latest"]
startup_timeout_sec = 30
env = { GOOGLE_GSC_CREDENTIALS_PATH = "/path/to/credentials.json" }
```

> Codex defaults to a 10s startup timeout, which is often too short for a cold `npx` fetch. Bump `startup_timeout_sec` (30 is safe) or install the package globally (`npm i -g mcp-gsc`) and use `command = "mcp-gsc"` instead.

### Service Account (alternative)

For server-to-server auth without browser-based OAuth:

1. Create a service account in Google Cloud Console
2. Download the JSON key file
3. In Google Search Console, add the service account email as a **user** for each property
4. Point `GOOGLE_GSC_CREDENTIALS_PATH` to the key file — auth type is auto-detected

## Tools (25)

### Core Tools (always available)

#### Sites
| Tool | Description |
|------|-------------|
| `list_properties` | List all GSC properties with permission levels |
| `get_property_details` | Verification info, ownership, permissions for a property |

#### Search Analytics
| Tool | Description |
|------|-------------|
| `search_analytics` | Query search performance (clicks, impressions, CTR, position) with dimensions, filters, and brand segmentation |

Dimensions: `query`, `page`, `country`, `device`, `date`, `searchAppearance`, `hour`

Types: `web`, `image`, `video`, `news`, `discover`, `googleNews`

Note: `searchAppearance` cannot combine with `query` or `page`. `hour` requires `data_state="hourly_all"` (last 10 days only). Country codes are ISO 3166-1 alpha-3 (`usa`, `gbr`, `deu`).

#### Sitemaps
| Tool | Description |
|------|-------------|
| `list_sitemaps` | List sitemaps with status, type, indexed counts, errors |
| `get_sitemap` | Detailed sitemap info with content breakdown |

#### URL Inspection
| Tool | Description |
|------|-------------|
| `inspect_url` | URL indexing status, crawl info, rich results, canonicals |
| `batch_inspect_urls` | Inspect up to 10 URLs at once with categorized results |

Rate limits: 600/minute + 2,000/day per site (tracked automatically).

#### Export
| Tool | Description |
|------|-------------|
| `export_csv` | Export full search analytics to CSV file (auto-paginates, up to 25K rows) |

### Extended Tools (disabled by default)

Enable with `GOOGLE_GSC_ENABLE_EXTENDED_TOOLS=true`:

#### Reporting Suite
| Tool | Description |
|------|-------------|
| `performance_overview` | Aggregate metrics + daily trend breakdown |
| `compare_periods` | Compare two date ranges with delta calculations |
| `top_movers` | Biggest gains and drops between periods |
| `device_country_breakdown` | Performance by device and/or country |

#### SEO Suite
| Tool | Description |
|------|-------------|
| `quick_wins` | High-impression, low-CTR queries in striking distance (position 4-20) |
| `cannibalization` | Multiple pages competing for the same query |
| `opportunity_finder` | Emerging queries, growing impressions with low CTR, declining performers |
| `position_tracking` | Position changes over time for specific queries/pages |
| `ctr_anomalies` | Queries with abnormal CTR relative to position |
| `content_decay` | Pages/queries with impressions dropping >50% from historical peak |
| `weekly_seo_report` | All-in-one report: overview + quick wins + top movers |

#### Technical SEO Suite
| Tool | Description |
|------|-------------|
| `indexing_coverage` | Batch URL inspection with categorized indexing status |
| `sitemap_health` | Sitemap error patterns, freshness, indexed vs submitted ratio |

### Write Tools (disabled by default)

Enable with `GOOGLE_GSC_ENABLE_WRITES=true`:

| Tool | Description |
|------|-------------|
| `add_site` | Add a new site to GSC |
| `delete_site` | Remove a site from GSC |
| `submit_sitemap` | Submit a new sitemap |
| `delete_sitemap` | Remove/unsubmit a sitemap |
| `request_indexing` | Ask Google to crawl a URL via the Indexing API |
| `get_indexing_status` | When a URL was last submitted for indexing |

> **Indexing API prerequisites.** The last two use a different Google API to the
> rest of this server, so they need three things the other tools don't:
>
> 1. **Re-run `mcp-gsc setup`** — credentials created before this feature lack
>    the `auth/indexing` scope. The tools say so explicitly if yours do.
> 2. **Enable the Indexing API** on your Google Cloud project —
>    [console.cloud.google.com/apis/library/indexing.googleapis.com](https://console.cloud.google.com/apis/library/indexing.googleapis.com)
> 3. **Be a verified _owner_** of the property in Search Console. Full-user
>    access is not enough.
>
> Google officially supports the Indexing API only for pages carrying
> `JobPosting` or `BroadcastEvent` structured data, with a default quota of
> 200 URLs/day. It requests a crawl — it never guarantees indexing.

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `GOOGLE_GSC_CREDENTIALS_PATH` | Yes | — | Path to OAuth client JSON or service account key |
| `GOOGLE_GSC_TOKEN_PATH` | No | Derived | Path to cached OAuth token (default: `*_token.json` next to credentials) |
| `GOOGLE_GSC_PROPERTY` | No | — | Default property URL (e.g., `sc-domain:example.com`). Accepts bare domains. |
| `GOOGLE_GSC_ENABLE_WRITES` | No | `false` | Enable write tools |
| `GOOGLE_GSC_ENABLE_EXTENDED_TOOLS` | No | `false` | Enable extended analytics tools (13 extra) |
| `GOOGLE_GSC_ENV_FILE` | No | `.env` | Path to .env file |
| `DEBUG` | No | — | Enable debug logging |

**Property resolution:** You can pass bare domains like `example.com` — the server auto-resolves to `sc-domain:example.com` or `https://example.com/` by matching against your verified properties.

## Examples

Ask your AI assistant:

- "Show me my top 10 queries this month"
- "Find quick wins for example.com"
- "Which pages have declining traffic over the last 3 months?"
- "Check if these URLs are indexed: url1, url2, url3"
- "Compare this week's performance to last week"
- "Export all search analytics data to CSV for the last 28 days"
- "Run a weekly SEO report for my site"
- "Find keyword cannibalization issues"

## Future Tool Ideas

- Content gap analysis (requires competitor data integration)
- Core Web Vitals integration (via PageSpeed Insights API)
- Multi-property comparison
- Search appearance deep analysis
- Integration with Google Analytics for conversion data
- Automated reporting schedules

## Updates

**Using `npx @latest`** (recommended): You always get the latest version.

**Using a binary**: The server checks for new releases on startup and logs to stderr if outdated.

```bash
mcp-gsc --version
```

## Development

Requires [Bun](https://bun.sh/).

```bash
git clone https://github.com/pijusz/mcp-gsc.git
cd mcp-gsc
bun install
bun test           # tests
bun run build      # standalone binary
bun run inspect    # MCP Inspector
bun run check      # biome format + lint
```

## License

MIT
