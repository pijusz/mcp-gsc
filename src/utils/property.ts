/**
 * URL-encode a siteUrl for use in API path parameters.
 * e.g. "sc-domain:example.com" → "sc-domain%3Aexample.com"
 *      "https://example.com/" → "https%3A%2F%2Fexample.com%2F"
 */
export function encodeSiteUrl(siteUrl: string): string {
  return encodeURIComponent(siteUrl);
}

/**
 * Extract bare domain from a GSC property URL.
 * "sc-domain:example.com" → "example.com"
 * "https://example.com/" → "example.com"
 * "https://sub.example.com/path/" → "sub.example.com"
 */
export function extractDomain(siteUrl: string): string {
  if (siteUrl.startsWith("sc-domain:")) {
    return siteUrl.slice("sc-domain:".length);
  }
  try {
    const url = new URL(siteUrl);
    return url.hostname;
  } catch {
    return siteUrl;
  }
}

/**
 * Extract a brand name from a domain for brand filtering.
 * "example.com" → "example"
 * "my-brand.co.uk" → "my-brand"
 */
export function extractBrandName(siteUrl: string): string {
  const domain = extractDomain(siteUrl);
  // Remove TLD and common SLDs
  const parts = domain.split(".");
  if (
    parts.length >= 3 &&
    ["co", "com", "org", "net"].includes(parts[parts.length - 2])
  ) {
    return parts[parts.length - 3];
  }
  return parts[0];
}
