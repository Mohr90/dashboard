import { config } from "./config.js";
import { getFxCache, getFxRate, type FxRate } from "./fx.js";
import { fetchCredits, fetchKeyInfo, type CreditsInfo, type KeyInfo } from "./openrouter.js";
import {
  DAY_MS,
  burnRate,
  dailySeries,
  daysRemaining,
  remainingUsd,
  round,
  usdToEur,
  type BurnSource,
  type DailyPoint,
} from "./stats.js";
import { latestSnapshot, oldestSnapshotTs, readSnapshots, snapshotCount, type StoredSnapshot } from "./store.js";

export interface SummaryCurrency {
  eurPerUsd: number;
  source: string;
  asOf: string | null;
}

export interface SummaryAccount {
  totalCredits: number;
  totalUsage: number;
  remainingUsd: number;
  remainingEur: number;
  usedPercent: number;
}

export interface SummaryKey {
  label: string | null;
  isManagementKey: boolean;
  isFreeTier: boolean;
  limit: number | null;
  limitReset: string | null;
  limitRemaining: number | null;
  limitRemainingEur: number | null;
  usageAllTime: number;
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
  byokUsageMonthly: number;
  freeModelRequests: { used: number; limit: number; remaining: number } | null;
}

export interface SummaryBurn {
  perDayUsd: number;
  perDayEur: number;
  source: BurnSource;
  windowDays: number;
  daysRemaining: number | null;
  runsOutAt: string | null;
}

export interface SummaryMeta {
  snapshotCount: number;
  historySince: string | null;
  pollSeconds: number;
  lastPollAt: string | null;
  lastError: string | null;
  managementKeyConfigured: boolean;
}

export interface Summary {
  generatedAt: string;
  currency: SummaryCurrency;
  account: SummaryAccount;
  key: SummaryKey;
  burn: SummaryBurn;
  history: { days: number; points: DailyPoint[] };
  meta: SummaryMeta;
}

export interface RuntimeInfo {
  pollSeconds: number;
  lastPollAt: string | null;
  lastError: string | null;
}

export const DEFAULT_RUNTIME: RuntimeInfo = {
  pollSeconds: config.pollSeconds,
  lastPollAt: null,
  lastError: null,
};

export function buildSummary(input: {
  keyInfo: KeyInfo;
  credits: CreditsInfo;
  fx: FxRate;
  series: DailyPoint[];
  historyDays: number;
  runtime?: RuntimeInfo;
  now?: number;
}): Summary {
  const now = input.now ?? Date.now();
  const runtime = input.runtime ?? DEFAULT_RUNTIME;
  const rate = input.fx.eurPerUsd;

  const totalCredits = Number(input.credits.total_credits ?? 0);
  const totalUsage = Number(input.credits.total_usage ?? 0);
  const remaining = remainingUsd(totalCredits, totalUsage);
  const usedPercent = totalCredits > 0 ? round((totalUsage / totalCredits) * 100, 2) : 0;

  const keyInfo = input.keyInfo;
  const usageDaily = Number(keyInfo.usage_daily ?? 0);
  const usageWeekly = Number(keyInfo.usage_weekly ?? 0);
  const usageMonthly = Number(keyInfo.usage_monthly ?? 0);

  const burn = burnRate({
    usageDaily,
    usageWeekly,
    usageMonthly,
    series: input.series,
    now,
  });
  const left = daysRemaining(remaining, burn.perDay);
  const runsOutAt = left !== null ? new Date(now + left * DAY_MS).toISOString() : null;

  const keyLimitRemaining =
    keyInfo.limit_remaining === null || keyInfo.limit_remaining === undefined
      ? null
      : Number(keyInfo.limit_remaining);

  return {
    generatedAt: new Date().toISOString(),
    currency: { eurPerUsd: rate, source: input.fx.source, asOf: input.fx.asOf },
    account: {
      totalCredits: round(totalCredits, 6),
      totalUsage: round(totalUsage, 6),
      remainingUsd: remaining,
      remainingEur: usdToEur(remaining, rate),
      usedPercent,
    },
    key: {
      label: keyInfo.label ?? null,
      isManagementKey: Boolean(keyInfo.is_management_key),
      isFreeTier: Boolean(keyInfo.is_free_tier),
      limit: keyInfo.limit === null || keyInfo.limit === undefined ? null : Number(keyInfo.limit),
      limitReset: keyInfo.limit_reset ?? null,
      limitRemaining: keyLimitRemaining,
      limitRemainingEur: keyLimitRemaining === null ? null : usdToEur(keyLimitRemaining, rate),
      usageAllTime: round(Number(keyInfo.usage ?? 0), 6),
      usageDaily: round(usageDaily, 6),
      usageWeekly: round(usageWeekly, 6),
      usageMonthly: round(usageMonthly, 6),
      byokUsageMonthly: round(Number(keyInfo.byok_usage_monthly ?? 0), 6),
      freeModelRequests: keyInfo.free_model_daily_requests ?? null,
    },
    burn: {
      perDayUsd: burn.perDay,
      perDayEur: usdToEur(burn.perDay, rate),
      source: burn.source,
      windowDays: burn.windowDays,
      daysRemaining: left,
      runsOutAt,
    },
    history: { days: input.historyDays, points: input.series },
    meta: {
      snapshotCount: snapshotCount(),
      historySince: isoOrNull(oldestSnapshotTs()),
      pollSeconds: runtime.pollSeconds,
      lastPollAt: runtime.lastPollAt,
      lastError: runtime.lastError,
      managementKeyConfigured: Boolean(config.managementKey),
    },
  };
}

function isoOrNull(ts: number | null): string | null {
  return ts === null ? null : new Date(ts).toISOString();
}

export function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 30;
  return Math.min(Math.max(Math.trunc(days), 1), 365);
}

/** Daily spend series derived from the locally stored snapshots. */
export function seriesFromStore(days: number, now: number = Date.now()): DailyPoint[] {
  const since = now - (days + 1) * DAY_MS;
  return dailySeries(readSnapshots(since, now), days, now);
}

/** Live summary: pulls fresh data from OpenRouter and merges it with local history. */
export async function liveSummary(days = 30, runtime: RuntimeInfo = DEFAULT_RUNTIME): Promise<Summary> {
  const historyDays = clampDays(days);
  const [keyInfo, credits, fx] = await Promise.all([fetchKeyInfo(), fetchCredits(), getFxRate()]);
  return buildSummary({
    keyInfo,
    credits,
    fx,
    series: seriesFromStore(historyDays),
    historyDays,
    runtime,
  });
}

function snapshotToKeyInfo(snapshot: StoredSnapshot): KeyInfo {
  return {
    label: null,
    is_management_key: snapshot.isManagementKey,
    limit: snapshot.keyLimit,
    limit_reset: null,
    limit_remaining: snapshot.keyLimitRemaining,
    usage: snapshot.keyUsage,
    usage_daily: snapshot.usageDaily,
    usage_weekly: snapshot.usageWeekly,
    usage_monthly: snapshot.usageMonthly,
    is_free_tier: snapshot.isFreeTier,
  };
}

/** Last known summary from the local database - works without network access. */
export function storedSummary(days = 30, runtime: RuntimeInfo = DEFAULT_RUNTIME): Summary | null {
  const snapshot = latestSnapshot();
  if (!snapshot) return null;
  const historyDays = clampDays(days);
  const fx = getFxCache() ?? {
    eurPerUsd: config.eurPerUsdFallback,
    source: "fallback (.env)",
    asOf: null,
    fetchedAt: Date.now(),
  };
  return buildSummary({
    keyInfo: snapshotToKeyInfo(snapshot),
    credits: { total_credits: snapshot.totalCredits, total_usage: snapshot.totalUsage },
    fx,
    series: seriesFromStore(historyDays, snapshot.ts),
    historyDays,
    runtime,
    now: snapshot.ts,
  });
}
