# mcp-gsc

Google Search Console MCP server in Bun/TypeScript. See [AGENTS.md](AGENTS.md) for detailed guidelines.

## Quick reference

- **Runtime:** Bun (dev) / Node (built)
- **Entry:** `src/index.ts`
- **Build:** `bun run build` → `mcp-gsc` (standalone binary), `bun run build:npm` → `dist/index.js`
- **Test:** `bun test`
- **API:** Google Search Console API v1 (direct REST, no googleapis package)

## Key patterns

- All tools return `{ content: [{ type: "text", text }] }` — MCP tool response format
- `fetchWithRetry` in `services/gsc-api.ts` handles 429/5xx with exponential backoff
- Tabular responses use markdown tables, capped at 100 rows default / 500 max
- Write tools gated by `GOOGLE_GSC_ENABLE_WRITES=true`
- Extended tools gated by `GOOGLE_GSC_ENABLE_EXTENDED_TOOLS=true`
- Auth type auto-detected from credentials file (no AUTH_TYPE env var)
- Property format auto-resolved via `resolveProperty()` — accepts bare domains

## Prod testing (published package)

```bash
claude mcp add gsc --scope user --transport stdio \
  -e GOOGLE_GSC_CREDENTIALS_PATH=/abs/path/to/credentials.json \
  -- npx -y mcp-gsc@latest
```
