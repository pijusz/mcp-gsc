import { readFileSync } from "node:fs";
import { getEnv } from "../config/env.js";
import { getOAuthAccessToken } from "./oauth.js";
import { getServiceAccountAccessToken } from "./service-account.js";

let _authType: "oauth" | "service_account" | null = null;

function detectAuthType(): "oauth" | "service_account" {
  if (_authType) return _authType;

  const env = getEnv();
  try {
    const raw = readFileSync(env.GOOGLE_GSC_CREDENTIALS_PATH, "utf-8");
    const data = JSON.parse(raw);
    _authType = data.type === "service_account" ? "service_account" : "oauth";
  } catch {
    _authType = "oauth";
  }
  return _authType;
}

export async function getAccessToken(): Promise<string> {
  const authType = detectAuthType();
  if (authType === "service_account") {
    return getServiceAccountAccessToken();
  }
  return getOAuthAccessToken();
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await getAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}
