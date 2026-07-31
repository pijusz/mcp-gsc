import { getAuthHeaders } from "../auth/index.js";
import { log } from "../utils/logger.js";
import { encodeSiteUrl } from "../utils/property.js";

// Both surfaces live on searchconsole.googleapis.com. The webmasters/v3 paths
// are still the canonical flatPaths in the searchconsole v1 discovery doc, but
// the old www.googleapis.com host is an undocumented alias for an API that no
// longer appears in Google's discovery directory.
const WEBMASTERS_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
const SEARCHCONSOLE_BASE = "https://searchconsole.googleapis.com/v1";

interface FetchWithRetryOpts extends RequestInit {
  retries?: number;
  retryDelay?: number;
  timeout?: number;
}

export async function fetchWithRetry(
  url: string,
  { retries = 2, retryDelay = 1000, timeout = 30_000, ...init }: FetchWithRetryOpts = {},
): Promise<Response> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        const delay = retryDelay * 2 ** attempt;
        log.warn(
          `HTTP ${res.status} — retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`,
        );
        await sleep(delay);
        continue;
      }

      return res;
    } catch (err) {
      lastError = err as Error;
      if (attempt < retries) {
        const delay = retryDelay * 2 ** attempt;
        log.warn(
          `Fetch error — retrying in ${delay}ms (attempt ${attempt + 1}/${retries}):`,
          (err as Error).message,
        );
        await sleep(delay);
      }
    }
  }

  throw lastError ?? new Error("Fetch failed after retries");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiRequest<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const headers = await getAuthHeaders();
  const opts: FetchWithRetryOpts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetchWithRetry(url, opts);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GSC API error (${res.status}): ${text}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return {} as T;
}

// --- Sites ---

export interface SiteEntry {
  siteUrl: string;
  permissionLevel: string;
}

export interface SiteListResponse {
  siteEntry?: SiteEntry[];
}

export async function listSites(): Promise<SiteListResponse> {
  return apiRequest<SiteListResponse>(`${WEBMASTERS_BASE}/sites`);
}

export async function getSite(siteUrl: string): Promise<SiteEntry> {
  return apiRequest<SiteEntry>(`${WEBMASTERS_BASE}/sites/${encodeSiteUrl(siteUrl)}`);
}

export async function addSite(siteUrl: string): Promise<void> {
  await apiRequest<void>(`${WEBMASTERS_BASE}/sites/${encodeSiteUrl(siteUrl)}`, "PUT");
}

export async function deleteSite(siteUrl: string): Promise<void> {
  await apiRequest<void>(`${WEBMASTERS_BASE}/sites/${encodeSiteUrl(siteUrl)}`, "DELETE");
}

// --- Search Analytics ---

export interface SearchAnalyticsRequest {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  type?: string;
  dimensionFilterGroups?: {
    groupType?: string;
    filters: {
      dimension: string;
      operator: string;
      expression: string;
    }[];
  }[];
  rowLimit?: number;
  startRow?: number;
  dataState?: string;
  aggregationType?: string;
}

export interface SearchAnalyticsRow {
  keys?: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SearchAnalyticsResponse {
  rows?: SearchAnalyticsRow[];
  responseAggregationType?: string;
}

export async function querySearchAnalytics(
  siteUrl: string,
  params: SearchAnalyticsRequest,
): Promise<SearchAnalyticsResponse> {
  return apiRequest<SearchAnalyticsResponse>(
    `${WEBMASTERS_BASE}/sites/${encodeSiteUrl(siteUrl)}/searchAnalytics/query`,
    "POST",
    params,
  );
}

// --- Sitemaps ---

export interface SitemapContent {
  type: string;
  submitted: string;
  indexed?: string;
}

export interface SitemapEntry {
  path: string;
  lastSubmitted?: string;
  lastDownloaded?: string;
  isPending?: boolean;
  isSitemapsIndex?: boolean;
  type?: string;
  warnings?: string;
  errors?: string;
  contents?: SitemapContent[];
}

export interface SitemapListResponse {
  sitemap?: SitemapEntry[];
}

export async function listSitemaps(
  siteUrl: string,
  sitemapIndex?: string,
): Promise<SitemapListResponse> {
  let url = `${WEBMASTERS_BASE}/sites/${encodeSiteUrl(siteUrl)}/sitemaps`;
  if (sitemapIndex) {
    url += `?sitemapIndex=${encodeURIComponent(sitemapIndex)}`;
  }
  return apiRequest<SitemapListResponse>(url);
}

export async function getSitemap(
  siteUrl: string,
  feedpath: string,
): Promise<SitemapEntry> {
  return apiRequest<SitemapEntry>(
    `${WEBMASTERS_BASE}/sites/${encodeSiteUrl(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
  );
}

export async function submitSitemap(siteUrl: string, feedpath: string): Promise<void> {
  await apiRequest<void>(
    `${WEBMASTERS_BASE}/sites/${encodeSiteUrl(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
    "PUT",
  );
}

export async function deleteSitemap(siteUrl: string, feedpath: string): Promise<void> {
  await apiRequest<void>(
    `${WEBMASTERS_BASE}/sites/${encodeSiteUrl(siteUrl)}/sitemaps/${encodeURIComponent(feedpath)}`,
    "DELETE",
  );
}

// --- URL Inspection ---

export interface UrlInspectionResult {
  inspectionResult?: {
    inspectionResultLink?: string;
    indexStatusResult?: {
      verdict?: string;
      coverageState?: string;
      robotsTxtState?: string;
      indexingState?: string;
      lastCrawlTime?: string;
      pageFetchState?: string;
      googleCanonical?: string;
      userCanonical?: string;
      crawledAs?: string;
      sitemap?: string[];
      referringUrls?: string[];
    };
    mobileUsabilityResult?: {
      verdict?: string;
      issues?: { issueType?: string; severity?: string; message?: string }[];
    };
    richResultsResult?: {
      verdict?: string;
      detectedItems?: {
        richResultType?: string;
        items?: { name?: string; issues?: unknown[] }[];
      }[];
    };
  };
}

export async function inspectUrl(
  siteUrl: string,
  inspectionUrl: string,
): Promise<UrlInspectionResult> {
  return apiRequest<UrlInspectionResult>(
    `${SEARCHCONSOLE_BASE}/urlInspection/index:inspect`,
    "POST",
    {
      inspectionUrl,
      siteUrl,
    },
  );
}

// --- Indexing API ---
//
// Separate host and OAuth scope from the rest of Search Console. Requires the
// Indexing API enabled on the Cloud project and the caller to be a verified
// *owner* of the property (not merely a full user).

const INDEXING_BASE = "https://indexing.googleapis.com/v3";

export interface UrlNotificationMetadata {
  url?: string;
  latestUpdate?: { url?: string; type?: string; notifyTime?: string };
  latestRemove?: { url?: string; type?: string; notifyTime?: string };
}

export interface PublishUrlNotificationResponse {
  urlNotificationMetadata?: UrlNotificationMetadata;
}

/** Rewrites the scope error, which is otherwise an opaque 403 for anyone whose token predates the indexing scope. */
function describeIndexingError(err: unknown): never {
  const msg = (err as Error).message ?? String(err);
  if (msg.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) {
    throw new Error(
      "Your saved credentials predate the Indexing API scope. Re-run `mcp-gsc setup` to re-authorise, then try again.",
    );
  }
  if (
    msg.includes("Indexing API has not been used") ||
    msg.includes("SERVICE_DISABLED")
  ) {
    throw new Error(
      "The Indexing API is not enabled on this Google Cloud project. Enable it at https://console.cloud.google.com/apis/library/indexing.googleapis.com and retry.",
    );
  }
  if (msg.includes("Permission denied") || msg.includes("does not own")) {
    throw new Error(
      "Permission denied. The Indexing API requires you to be a verified *owner* of the property in Search Console, not just a full user.",
    );
  }
  throw err;
}

export async function publishUrlNotification(
  url: string,
  type: "URL_UPDATED" | "URL_DELETED",
): Promise<PublishUrlNotificationResponse> {
  try {
    return await apiRequest<PublishUrlNotificationResponse>(
      `${INDEXING_BASE}/urlNotifications:publish`,
      "POST",
      { url, type },
    );
  } catch (err) {
    return describeIndexingError(err);
  }
}

export async function getUrlNotificationMetadata(
  url: string,
): Promise<UrlNotificationMetadata> {
  try {
    return await apiRequest<UrlNotificationMetadata>(
      `${INDEXING_BASE}/urlNotifications/metadata?url=${encodeURIComponent(url)}`,
    );
  } catch (err) {
    return describeIndexingError(err);
  }
}
