import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

const envSchema = z.object({
  GOOGLE_GSC_CREDENTIALS_PATH: z
    .string()
    .min(1, "GOOGLE_GSC_CREDENTIALS_PATH is required"),
  GOOGLE_GSC_TOKEN_PATH: z.string().default(""),
  GOOGLE_GSC_PROPERTY: z.string().default(""),
  GOOGLE_GSC_ENABLE_WRITES: z.enum(["true", "false"]).default("false"),
  GOOGLE_GSC_ENABLE_EXTENDED_TOOLS: z.enum(["true", "false"]).default("true"),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;
let _dotenvLoaded = false;

function loadDotEnvIfPresent(): void {
  if (_dotenvLoaded) return;
  _dotenvLoaded = true;

  const envFile = process.env.GOOGLE_GSC_ENV_FILE || ".env";
  if (!existsSync(envFile)) return;

  let text: string;
  try {
    text = readFileSync(envFile, "utf-8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const withoutExport = line.startsWith("export ")
      ? line.slice("export ".length).trim()
      : line;
    const eq = withoutExport.indexOf("=");
    if (eq <= 0) continue;

    const key = withoutExport.slice(0, eq).trim();
    if (!key) continue;
    if (process.env[key] !== undefined) continue;

    let value = withoutExport.slice(eq + 1).trim();
    const hasQuotes =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (hasQuotes && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    process.env[key] = value.replace(/\\n/g, "\n");
  }
}

function formatEnvError(err: z.ZodError): string {
  const lines = err.issues.map((issue) => {
    const key = issue.path.join(".") || "unknown";
    return `- ${key}: ${issue.message}`;
  });
  return `Invalid environment configuration:\n${lines.join("\n")}`;
}

export function loadEnv(): Env {
  if (_env) return _env;
  loadDotEnvIfPresent();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(formatEnvError(parsed.error));
  }
  _env = parsed.data;
  return _env;
}

export function getEnv(): Env {
  if (!_env) return loadEnv();
  return _env;
}

export function isWritesEnabledFromProcessEnv(): boolean {
  return process.env.GOOGLE_GSC_ENABLE_WRITES === "true";
}

export function isExtendedToolsEnabledFromProcessEnv(): boolean {
  // Default is "true" — only disable if explicitly set to "false"
  return process.env.GOOGLE_GSC_ENABLE_EXTENDED_TOOLS !== "false";
}
