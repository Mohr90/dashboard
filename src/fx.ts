import { config } from "./config.js";

export interface FxRate {
  eurPerUsd: number;
  source: string;
  /** Publication date of the rate (YYYY-MM-DD), if known. */
  asOf: string | null;
  fetchedAt: number;
}

let cached: FxRate | null = null;

/**
 * USD -> EUR rate from the ECB (via Frankfurter, no API key required).
 * Falls back to EUR_PER_USD_FALLBACK from .env when the service is unreachable.
 */
export async function fetchFxRate(): Promise<FxRate> {
  try {
    const response = await fetch(`${config.fxUrl}?base=USD&symbols=EUR`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { date?: string; rates?: Record<string, number> };
    const rate = body.rates?.EUR;
    if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
      return { eurPerUsd: rate, source: "frankfurter/ECB", asOf: body.date ?? null, fetchedAt: Date.now() };
    }
    throw new Error("Kein EUR-Kurs in der Antwort");
  } catch {
    return {
      eurPerUsd: config.eurPerUsdFallback,
      source: "fallback (.env)",
      asOf: null,
      fetchedAt: Date.now(),
    };
  }
}

/**
 * Cached accessor. Refreshes at most every FX_REFRESH_HOURS.
 * `seed` lets the store hand in a previously persisted rate after a restart.
 */
export async function getFxRate(options: { force?: boolean; seed?: FxRate | null } = {}): Promise<FxRate> {
  if (!cached && options.seed) cached = options.seed;

  const maxAgeMs = config.fxRefreshHours * 3_600_000;
  if (cached && !options.force && Date.now() - cached.fetchedAt < maxAgeMs) return cached;

  cached = await fetchFxRate();
  return cached;
}

export function setFxCache(rate: FxRate | null): void {
  cached = rate;
}

export function getFxCache(): FxRate | null {
  return cached;
}
