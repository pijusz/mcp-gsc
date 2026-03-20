#!/usr/bin/env bun
import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../package.json";
import { deriveTokenPath } from "./auth/oauth.js";
import { type Env, loadEnv } from "./config/env.js";
import { createServer } from "./server.js";
import { listSites } from "./services/gsc-api.js";
import { log } from "./utils/logger.js";

export const VERSION = pkg.version;

if (process.argv.includes("--version") || process.argv.includes("-v")) {
  console.log(`mcp-gsc v${VERSION}`);
  process.exit(0);
}

if (process.argv[2] === "setup") {
  await import("./auth/setup.js");
  process.exit(0);
}

// Load .env BEFORE creating server so tool gate checks see .env values
try {
  loadEnv();
} catch {
  // loadEnv may fail if CREDENTIALS_PATH isn't set yet — that's OK,
  // preflight will catch it. But .env values are now in process.env.
}

const server = createServer();
const transport = new StdioServerTransport();

log.info(`Starting mcp-gsc v${VERSION} on stdio`);
await server.connect(transport);
void runStartupPreflight();

checkForUpdates();

async function runStartupPreflight() {
  try {
    const env = loadEnv();
    await validateCredentials(env);
    await validateProperties(env);
  } catch (err) {
    log.warn(
      "Startup preflight warning. MCP server is running, but tool calls may fail until this is fixed:",
      (err as Error).message,
    );
  }
}

async function validateCredentials(env: Env) {
  const credPath = env.GOOGLE_GSC_CREDENTIALS_PATH;

  let raw: string;
  try {
    raw = await readFile(credPath, "utf-8");
  } catch {
    throw new Error(
      `Credentials file not found: ${credPath}. Download your OAuth client JSON from Google Cloud Console and set GOOGLE_GSC_CREDENTIALS_PATH.`,
    );
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`Credentials file is not valid JSON: ${credPath}`);
  }

  // Check if it's a service account (no token file needed)
  if (data.type === "service_account") {
    return;
  }

  // OAuth — check for token file
  const isClientConfig = !!(
    (data as { installed?: unknown }).installed || (data as { web?: unknown }).web
  );
  const isTokenFile = !!(data as { refresh_token?: unknown }).refresh_token;

  if (isClientConfig) {
    const tokenPath = deriveTokenPath(credPath);
    try {
      await readFile(tokenPath, "utf-8");
    } catch {
      throw new Error(`OAuth token file not found: ${tokenPath}. Run 'mcp-gsc setup'.`);
    }
  } else if (!isTokenFile) {
    throw new Error(
      `Credentials file is not a valid OAuth client config, token, or service account key: ${credPath}`,
    );
  }
}

async function validateProperties(env: Env) {
  try {
    const res = await listSites();
    const sites = res.siteEntry ?? [];
    if (sites.length === 0) {
      log.warn("No GSC properties found. Add a site in Google Search Console.");
      return;
    }
    log.info(`Found ${sites.length} GSC properties`);

    if (env.GOOGLE_GSC_PROPERTY) {
      const match = sites.find(
        (s) => s.siteUrl.toLowerCase() === env.GOOGLE_GSC_PROPERTY.toLowerCase(),
      );
      if (!match) {
        log.warn(
          `Default property ${env.GOOGLE_GSC_PROPERTY} not found in your properties. Available: ${sites.map((s) => s.siteUrl).join(", ")}`,
        );
      }
    }
  } catch (err) {
    log.warn("Could not verify GSC properties:", (err as Error).message);
  }
}

function checkForUpdates() {
  if (typeof fetch !== "function") return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  fetch("https://api.github.com/repos/pijusz/mcp-gsc/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
    signal: controller.signal,
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data: { tag_name?: string } | null) => {
      if (!data?.tag_name) return;
      const latest = data.tag_name.replace(/^v/, "");
      if (latest !== VERSION) {
        log.warn(
          `v${latest} available (current: v${VERSION}). Download: https://github.com/pijusz/mcp-gsc/releases/latest`,
        );
      }
    })
    .catch(() => {})
    .finally(() => clearTimeout(timeout));
}
