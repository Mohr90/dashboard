import { EventEmitter } from "node:events";

import { config } from "./config.js";
import { getFxCache, getFxRate, type FxRate } from "./fx.js";
import { fetchCredits, fetchKeyInfo, type CreditsInfo, type KeyInfo } from "./openrouter.js";
import { DAY_MS, dailySeries, type DailyPoint } from "./stats.js";
import {
  getMeta,
  insertSnapshot,
  pruneSnapshots,
  readSnapshots,
  setMeta,
  type StoredSnapshot,
} from "./store.js";
import { buildSummary, type RuntimeInfo, type Summary } from "./summary.js";

export interface PollResult {
  keyInfo: KeyInfo;
  credits: CreditsInfo;
  snapshot: StoredSnapshot;
}

/**
 * Polls `/key` and `/credits` on a fixed interval, persists every reading and
 * emits `snapshot` / `summary` events so the web UI can update live.
 *
 * Emits: "snapshot" (StoredSnapshot), "summary" (Summary), "pollError" (Error).
 */
export class Collector extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private inflight: Promise<PollResult> | null = null;

  runtime: RuntimeInfo = {
    pollSeconds: config.pollSeconds,
    lastPollAt: null,
    lastError: null,
  };

  get isRunning(): boolean {
    return this.timer !== null;
  }

  /** Takes one measurement. Throws on API errors - the timer uses pollSafe(). */
  async poll(): Promise<PollResult> {
    const [keyInfo, credits] = await Promise.all([fetchKeyInfo(), fetchCredits()]);

    const snapshot: StoredSnapshot = {
      ts: Date.now(),
      totalCredits: Number(credits.total_credits ?? 0),
      totalUsage: Number(credits.total_usage ?? 0),
      keyLimit: keyInfo.limit ?? null,
      keyLimitRemaining: keyInfo.limit_remaining ?? null,
      keyUsage: Number(keyInfo.usage ?? 0),
      usageDaily: Number(keyInfo.usage_daily ?? 0),
      usageWeekly: Number(keyInfo.usage_weekly ?? 0),
      usageMonthly: Number(keyInfo.usage_monthly ?? 0),
      isManagementKey: Boolean(keyInfo.is_management_key),
      isFreeTier: Boolean(keyInfo.is_free_tier),
    };

    insertSnapshot(snapshot);
    this.runtime = { ...this.runtime, lastPollAt: new Date(snapshot.ts).toISOString(), lastError: null };
    return { keyInfo, credits, snapshot };
  }

  /** Takes one measurement and never throws; failures land in runtime.lastError. */
  async pollSafe(): Promise<PollResult | null> {
    if (this.inflight) return this.inflight.catch(() => null);

    const run = this.poll();
    this.inflight = run;
    try {
      return await run;
    } catch (error) {
      this.runtime = {
        ...this.runtime,
        lastError: error instanceof Error ? error.message : String(error),
      };
      return null;
    } finally {
      this.inflight = null;
    }
  }

  /**
   * Daily spend series for the last `days` days. Reads one extra day from the
   * database so the first day of the window has a baseline to diff against.
   */
  loadSeries(days: number, now: number = Date.now()): DailyPoint[] {
    const since = now - (days + 1) * DAY_MS;
    return dailySeries(readSnapshots(since), days, now);
  }

  /**
   * Builds the dashboard summary. Pass `pollResult` when a reading was just
   * taken to avoid two extra API round trips.
   */
  async summary(days: number = config.historyDays, pollResult?: PollResult): Promise<Summary> {
    const source: Pick<PollResult, "keyInfo" | "credits"> =
      pollResult ?? {
        keyInfo: await fetchKeyInfo(),
        credits: await fetchCredits(),
      };

    const persisted = getMeta<FxRate>("fx");
    const fx = await getFxRate({ seed: persisted ?? getFxCache() });
    if (fx !== persisted) setMeta("fx", fx);

    return buildSummary({
      keyInfo: source.keyInfo,
      credits: source.credits,
      fx,
      series: this.loadSeries(days),
      historyDays: days,
      runtime: this.runtime,
    });
  }

  /** Starts the interval. The first poll runs immediately. */
  start(): void {
    if (this.timer) return;

    // Keep the database bounded: two display windows (min. 180 days).
    pruneSnapshots(Math.max(config.historyDays * 2, 180));

    void this.tick();
    this.timer = setInterval(() => void this.tick(), config.pollSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const result = await this.pollSafe();
    if (!result) {
      // "error" would crash Node when unhandled, so use a dedicated event name.
      this.emit("pollError", new Error(this.runtime.lastError ?? "Abfrage fehlgeschlagen"));
      return;
    }

    try {
      this.emit("snapshot", result.snapshot);
      this.emit("summary", await this.summary(config.historyDays, result));
    } catch (error) {
      this.emit("pollError", error instanceof Error ? error : new Error(String(error)));
    }
  }
}
