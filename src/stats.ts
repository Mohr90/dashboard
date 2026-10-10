import type { ModelPricing } from "./openrouter.js";

export const DAY_MS = 86_400_000;

/** One usage snapshot as stored in the local SQLite database. */
export interface Snapshot {
  /** Unix timestamp in milliseconds. */
  ts: number;
  totalCredits: number;
  totalUsage: number;
  keyLimit: number | null;
  keyLimitRemaining: number | null;
  keyUsage: number;
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
}

/** One bar in the daily spend chart. Dates are UTC (same as OpenRouter). */
export interface DailyPoint {
  /** YYYY-MM-DD */
  date: string;
  /** Spend of that day in USD. */
  spend: number;
  /** Sum of all shown days up to and including this one, in USD. */
  cumulative: number;
}

export function round(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Remaining account balance in USD. */
export function remainingUsd(totalCredits: number, totalUsage: number): number {
  return round(totalCredits - totalUsage, 6);
}

export function usdToEur(usd: number, eurPerUsd: number): number {
  return round(usd * eurPerUsd, 6);
}

export function utcDayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

/**
 * Aggregates snapshots into a per-day spend series.
 *
 * Spend per day = last known all-time usage of that day minus the last known
 * all-time usage before it. Pass snapshots that start slightly *before* the
 * requested window so the first day gets a correct baseline.
 */
export function dailySeries(snapshots: readonly Snapshot[], days: number, now: number = Date.now()): DailyPoint[] {
  const windowDays = Math.max(1, Math.trunc(days));
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const firstDayStart = todayStart - (windowDays - 1) * DAY_MS;

  const sorted = [...snapshots]
    .filter((snapshot) => Number.isFinite(snapshot.totalUsage) && snapshot.ts > 0)
    .sort((a, b) => a.ts - b.ts);

  // Baseline: the newest reading taken before the window starts.
  let previousTotal: number | null = null;
  for (const snapshot of sorted) {
    if (snapshot.ts < firstDayStart) previousTotal = snapshot.totalUsage;
    else break;
  }

  // Newest reading of each UTC day inside the window. The whole snapshot is
  // kept (not only the total) so the API's own "usage today" value can be used
  // when there is no earlier baseline to diff against.
  const lastSnapshotPerDay = new Map<string, Snapshot>();
  for (const snapshot of sorted) {
    if (snapshot.ts >= firstDayStart && snapshot.ts <= now) {
      const key = utcDayKey(snapshot.ts);
      const known = lastSnapshotPerDay.get(key);
      if (!known || snapshot.ts >= known.ts) lastSnapshotPerDay.set(key, snapshot);
    }
  }

  const points: DailyPoint[] = [];
  for (let index = 0; index < windowDays; index += 1) {
    const date = utcDayKey(firstDayStart + index * DAY_MS);
    const lastSnapshot = lastSnapshotPerDay.get(date);
    let spend = 0;
    if (lastSnapshot) {
      if (previousTotal !== null) {
        spend = Math.max(0, lastSnapshot.totalUsage - previousTotal);
      } else {
        // The collector has not been running long enough for a baseline yet,
        // so trust the daily counter OpenRouter reports for the current day.
        spend = Math.max(0, lastSnapshot.usageDaily);
      }
      previousTotal = lastSnapshot.totalUsage;
    }
    points.push({ date, spend: round(spend, 6), cumulative: 0 });
  }

  let cumulative = 0;
  for (const point of points) {
    cumulative += point.spend;
    point.cumulative = round(cumulative, 6);
  }
  return points;
}

export type BurnSource = "history" | "api-week" | "api-month" | "api-day";

export interface BurnRate {
  /** Average spend per day in USD. */
  perDay: number;
  source: BurnSource;
  /** Number of days the average is based on. */
  windowDays: number;
}

/**
 * Estimates the average spend per day. Prefers the locally recorded history
 * (most accurate), then falls back to the rolling windows the API reports.
 */
export function burnRate(input: {
  usageDaily: number;
  usageWeekly: number;
  usageMonthly: number;
  series: readonly DailyPoint[];
  now?: number;
}): BurnRate {
  const now = input.now ?? Date.now();

  const recent = input.series.slice(-7).filter((point) => point.spend > 0);
  if (recent.length >= 3) {
    const total = recent.reduce((sum, point) => sum + point.spend, 0);
    return { perDay: round(total / recent.length, 6), source: "history", windowDays: recent.length };
  }

  if (input.usageWeekly > 0) {
    return { perDay: round(input.usageWeekly / 7, 6), source: "api-week", windowDays: 7 };
  }

  const dayOfMonth = new Date(now).getUTCDate();
  if (input.usageMonthly > 0) {
    return { perDay: round(input.usageMonthly / dayOfMonth, 6), source: "api-month", windowDays: dayOfMonth };
  }

  return { perDay: round(input.usageDaily, 6), source: "api-day", windowDays: 1 };
}

/** How many days the remaining balance lasts at the current burn rate. */
export function daysRemaining(remaining: number, perDay: number): number | null {
  if (!Number.isFinite(remaining) || !Number.isFinite(perDay)) return null;
  if (remaining <= 0 || perDay <= 0) return null;
  return round(remaining / perDay, 2);
}

/** OpenRouter pricing values are USD per single token and usually strings. */
export function parsePrice(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export interface UsageEstimate {
  promptTokens: number;
  completionTokens: number;
  requests?: number;
}

/** Estimated cost in USD for a given amount of tokens on one model. */
export function estimateCostUsd(pricing: ModelPricing, usage: UsageEstimate): number {
  const prompt = parsePrice(pricing.prompt);
  const completion = parsePrice(pricing.completion);
  const perRequest = parsePrice(pricing.request);
  const total = usage.promptTokens * prompt + usage.completionTokens * completion + (usage.requests ?? 0) * perRequest;
  return round(total, 6);
}

// ---------------------------------------------------------------------------
// Formatting helpers (shared by the CLI and the MCP server)
// ---------------------------------------------------------------------------

function decimalsFor(value: number): number {
  const abs = Math.abs(value);
  if (abs >= 1) return 2;
  if (abs >= 0.1) return 3;
  if (abs >= 0.01) return 4;
  return 6;
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(decimalsFor(value))}`;
}

/** German number style, e.g. "23,14 EUR". */
export function formatEur(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${value.toFixed(decimalsFor(value)).replace(".", ",")} EUR`;
}

export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return "n/a";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "n/a";
  return `${value.toFixed(digits).replace(".", ",")} %`;
}
