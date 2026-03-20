import { getEnv } from "../config/env.js";
import { log } from "../utils/logger.js";
import { listSites, type SiteEntry } from "./gsc-api.js";

let _cachedSites: SiteEntry[] | null = null;

export async function getCachedSites(): Promise<SiteEntry[]> {
  if (_cachedSites) return _cachedSites;
  const res = await listSites();
  _cachedSites = res.siteEntry ?? [];
  log.debug(`Cached ${_cachedSites.length} properties`);
  return _cachedSites;
}

/** Invalidate the cached sites list (e.g., after adding/removing a site). */
export function invalidateSitesCache(): void {
  _cachedSites = null;
}

/**
 * Resolve a site_url parameter to a verified GSC property URL.
 * - If omitted, uses GOOGLE_GSC_PROPERTY env var
 * - If starts with sc-domain: or http, uses as-is
 * - If bare domain, fuzzy-matches against sites.list
 */
export async function resolveProperty(siteUrl?: string): Promise<string> {
  const env = getEnv();
  const input = siteUrl || env.GOOGLE_GSC_PROPERTY;

  if (!input) {
    throw new Error(
      "No property specified. Pass site_url parameter or set GOOGLE_GSC_PROPERTY env var.",
    );
  }

  // Already in correct format
  if (input.startsWith("sc-domain:") || input.startsWith("http")) {
    return input;
  }

  // Bare domain — fuzzy match
  const sites = await getCachedSites();
  const domain = input.toLowerCase().replace(/\/+$/, "");

  const matches: SiteEntry[] = [];
  for (const site of sites) {
    const url = site.siteUrl.toLowerCase();
    if (url === `sc-domain:${domain}`) {
      return site.siteUrl; // exact domain match, prefer this
    }
    if (
      url.includes(domain) ||
      url === `https://${domain}/` ||
      url === `http://${domain}/`
    ) {
      matches.push(site);
    }
  }

  if (matches.length === 1) return matches[0].siteUrl;

  if (matches.length > 1) {
    const list = matches.map((m) => `  - ${m.siteUrl} (${m.permissionLevel})`).join("\n");
    throw new Error(
      `Multiple properties match "${input}". Please specify the exact property URL:\n${list}`,
    );
  }

  throw new Error(
    `No property found matching "${input}". Run list_properties to see available properties.`,
  );
}
