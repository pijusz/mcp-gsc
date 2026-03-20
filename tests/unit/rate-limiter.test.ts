import { beforeEach, describe, expect, test } from "bun:test";
import {
  checkQuota,
  getRemainingQuota,
  quotaWarning,
  trackInspection,
} from "../../src/services/rate-limiter";

// Note: rate limiter uses in-memory state, tests share state unless we use unique site URLs

describe("rate-limiter", () => {
  const site = `test-site-${Date.now()}`;

  test("starts with full quota", () => {
    const unique = `fresh-${Date.now()}`;
    const quota = getRemainingQuota(unique);
    expect(quota.daily.used).toBe(0);
    expect(quota.daily.remaining).toBe(2000);
    expect(quota.daily.limit).toBe(2000);
    expect(quota.perMinute.remaining).toBe(600);
  });

  test("tracks single inspection", () => {
    trackInspection(site);
    const quota = getRemainingQuota(site);
    expect(quota.daily.used).toBe(1);
    expect(quota.daily.remaining).toBe(1999);
  });

  test("tracks batch inspection", () => {
    const batchSite = `batch-${Date.now()}`;
    trackInspection(batchSite, 5);
    const quota = getRemainingQuota(batchSite);
    expect(quota.daily.used).toBe(5);
    expect(quota.daily.remaining).toBe(1995);
    expect(quota.perMinute.used).toBe(5);
  });

  test("checkQuota allows when under limit", () => {
    const ok = `ok-${Date.now()}`;
    const result = checkQuota(ok, 10);
    expect(result.allowed).toBe(true);
    expect(result.message).toBeUndefined();
  });

  test("checkQuota blocks when over daily limit", () => {
    const overSite = `over-${Date.now()}`;
    // Simulate near-limit
    trackInspection(overSite, 1995);
    const result = checkQuota(overSite, 10);
    expect(result.allowed).toBe(false);
    expect(result.message).toContain("daily limit reached");
  });

  test("quotaWarning returns empty when usage is low", () => {
    const low = `low-${Date.now()}`;
    trackInspection(low, 100);
    expect(quotaWarning(low)).toBe("");
  });

  test("quotaWarning returns warning when usage > 80%", () => {
    const high = `high-${Date.now()}`;
    trackInspection(high, 1700);
    const warning = quotaWarning(high);
    expect(warning).toContain("Warning");
    expect(warning).toContain("1700/2000");
  });
});
