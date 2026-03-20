const DAILY_LIMIT = 2000;
const PER_MINUTE_LIMIT = 600;

interface SiteQuota {
  dailyCount: number;
  dailyResetDate: string; // YYYY-MM-DD in UTC
  minuteTimestamps: number[]; // timestamps of calls within last 60s
}

const quotas = new Map<string, SiteQuota>();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function getQuota(siteUrl: string): SiteQuota {
  let quota = quotas.get(siteUrl);
  const today = todayUtc();

  if (!quota || quota.dailyResetDate !== today) {
    quota = { dailyCount: 0, dailyResetDate: today, minuteTimestamps: [] };
    quotas.set(siteUrl, quota);
  }

  // Prune minute timestamps older than 60s
  const cutoff = Date.now() - 60_000;
  quota.minuteTimestamps = quota.minuteTimestamps.filter((t) => t > cutoff);

  return quota;
}

export function trackInspection(siteUrl: string, count = 1): void {
  const quota = getQuota(siteUrl);
  quota.dailyCount += count;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    quota.minuteTimestamps.push(now);
  }
}

export function getRemainingQuota(siteUrl: string): {
  daily: { used: number; remaining: number; limit: number };
  perMinute: { used: number; remaining: number; limit: number };
} {
  const quota = getQuota(siteUrl);
  return {
    daily: {
      used: quota.dailyCount,
      remaining: Math.max(0, DAILY_LIMIT - quota.dailyCount),
      limit: DAILY_LIMIT,
    },
    perMinute: {
      used: quota.minuteTimestamps.length,
      remaining: Math.max(0, PER_MINUTE_LIMIT - quota.minuteTimestamps.length),
      limit: PER_MINUTE_LIMIT,
    },
  };
}

export function checkQuota(
  siteUrl: string,
  needed: number,
): { allowed: boolean; message?: string } {
  const quota = getQuota(siteUrl);

  if (quota.dailyCount + needed > DAILY_LIMIT) {
    return {
      allowed: false,
      message: `URL Inspection daily limit reached for ${siteUrl}. Limit resets at midnight UTC. ${quota.dailyCount}/${DAILY_LIMIT} calls used today.`,
    };
  }

  return { allowed: true };
}

/**
 * Wait until per-minute quota allows the next call.
 * Resolves immediately if under the limit.
 */
export async function waitForQuota(siteUrl: string): Promise<void> {
  const quota = getQuota(siteUrl);

  if (quota.minuteTimestamps.length < PER_MINUTE_LIMIT) return;

  // Wait until the oldest timestamp in the window expires
  const oldest = quota.minuteTimestamps[0];
  const waitMs = oldest + 60_000 - Date.now() + 50; // 50ms buffer
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

/**
 * Build a quota warning string if usage is high, or empty string.
 */
export function quotaWarning(siteUrl: string): string {
  const { daily } = getRemainingQuota(siteUrl);
  if (daily.used > DAILY_LIMIT * 0.8) {
    return `\n\n**Warning:** ${daily.used}/${daily.limit} URL Inspection calls used today. Limit resets at midnight UTC.`;
  }
  return "";
}
