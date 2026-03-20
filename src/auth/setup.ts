#!/usr/bin/env bun
import { exec } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { OAuth2Client } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/webmasters"];
const REDIRECT_PORT = 9876;
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/callback`;

async function main() {
  console.log("\n  mcp-gsc — Setup\n");

  const credPath =
    process.argv[3] ?? process.env.GOOGLE_GSC_CREDENTIALS_PATH ?? "./credentials.json";
  const absPath = resolve(credPath);

  let clientId: string;
  let clientSecret: string;

  try {
    const raw = await readFile(absPath, "utf-8");
    const data = JSON.parse(raw);

    // Check if service account
    if (data.type === "service_account") {
      console.log(`  Service account detected: ${absPath}`);
      console.log("  No OAuth setup needed for service accounts.\n");
      printConfigSnippets(absPath);
      return;
    }

    const config = data.installed ?? data.web;
    if (config) {
      clientId = config.client_id;
      clientSecret = config.client_secret;
      console.log(`  Using client config from: ${absPath}`);
    } else {
      throw new Error("not a client config");
    }
  } catch {
    clientId = process.env.GOOGLE_GSC_CLIENT_ID ?? "";
    clientSecret = process.env.GOOGLE_GSC_CLIENT_SECRET ?? "";

    if (!clientId || !clientSecret) {
      console.error(
        "  Error: Could not find OAuth client config.\n" +
          "  Either place a credentials.json with 'installed' config,\n" +
          "  or set GOOGLE_GSC_CLIENT_ID and GOOGLE_GSC_CLIENT_SECRET env vars.\n",
      );
      process.exit(1);
    }
    console.log("  Using client ID/secret from environment variables");
  }

  const oauthClient = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauthClient.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    prompt: "consent",
  });

  console.log(`\n  Opening browser for authorization...\n`);
  console.log(`  If it doesn't open automatically, visit:\n  ${authUrl}\n`);

  const openCmd =
    process.platform === "darwin"
      ? `open ${JSON.stringify(authUrl)}`
      : process.platform === "win32"
        ? `start "" ${JSON.stringify(authUrl)}`
        : `xdg-open ${JSON.stringify(authUrl)}`;

  try {
    exec(openCmd);
  } catch {}

  const code = await new Promise<string>((res, reject) => {
    const srv = createServer((req, resp) => {
      const url = new URL(req.url ?? "/", `http://localhost:${REDIRECT_PORT}`);

      if (url.pathname === "/callback") {
        const authCode = url.searchParams.get("code");
        if (authCode) {
          resp.writeHead(200, { "Content-Type": "text/html" });
          resp.end(
            "<html><body><h2>Authorization successful!</h2><p>You can close this tab.</p></body></html>",
          );
          srv.close();
          res(authCode);
        } else {
          const error = url.searchParams.get("error") ?? "No code received";
          resp.writeHead(400, { "Content-Type": "text/html" });
          resp.end(`<html><body><h2>Error: ${error}</h2></body></html>`);
          srv.close();
          reject(new Error(error));
        }
      }
    });

    srv.listen(REDIRECT_PORT, () => {
      console.log(`  Waiting for callback on port ${REDIRECT_PORT}...`);
    });

    setTimeout(() => {
      srv.close();
      reject(new Error("Authorization timed out after 5 minutes"));
    }, 5 * 60_000);
  });

  console.log("  Exchanging authorization code for tokens...");
  const { tokens } = await oauthClient.getToken(code);

  // Respect GOOGLE_GSC_TOKEN_PATH if set, otherwise derive from credentials path
  const tokenPath =
    process.env.GOOGLE_GSC_TOKEN_PATH || absPath.replace(/\.json$/i, "_token.json");
  if (tokenPath === absPath) {
    console.error("  Error: Credentials path must end with .json");
    process.exit(1);
  }

  const tokenData = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_type: tokens.token_type ?? "Bearer",
    expiry_date: tokens.expiry_date,
    client_id: clientId,
    client_secret: clientSecret,
  };

  await mkdir(dirname(tokenPath), { recursive: true });
  await writeFile(tokenPath, JSON.stringify(tokenData, null, 2));
  console.log(`\n  Token saved to: ${tokenPath}`);

  // Verify by listing sites
  console.log("  Verifying access...");
  oauthClient.setCredentials(tokens);

  try {
    const res = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
      },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        siteEntry?: { siteUrl: string }[];
      };
      const count = data.siteEntry?.length ?? 0;
      console.log(`  Access verified! Found ${count} properties.\n`);
    } else {
      console.log("  Warning: Could not verify access. You may need to re-run setup.\n");
    }
  } catch {
    console.log("  Warning: Could not verify access. You may need to re-run setup.\n");
  }

  printConfigSnippets(absPath);
}

function printConfigSnippets(credPath: string) {
  console.log("  Add to your MCP client config:\n");

  console.log("  Claude Desktop / Cursor (claude_desktop_config.json):");
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          gsc: {
            command: "npx",
            args: ["-y", "mcp-gsc@latest"],
            env: {
              GOOGLE_GSC_CREDENTIALS_PATH: credPath,
            },
          },
        },
      },
      null,
      4,
    )
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
  );

  console.log("\n  Claude Code CLI:");
  console.log(
    `  claude mcp add gsc -e GOOGLE_GSC_CREDENTIALS_PATH=${credPath} -- npx -y mcp-gsc@latest`,
  );

  console.log("\n  Setup complete!\n");
}

try {
  await main();
} catch (err) {
  console.error("  Setup failed:", (err as Error).message);
  process.exit(1);
}
