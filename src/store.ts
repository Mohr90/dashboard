import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import type { Snapshot } from "./stats.js";

export interface StoredSnapshot extends Snapshot {
  isManagementKey: boolean;
  isFreeTier: boolean;
}

interface SnapshotRow {
  ts: number;
  total_credits: number;
  total_usage: number;
  key_limit: number | null;
  key_limit_remaining: number | null;
  key_usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  is_management_key: number;
  is_free_tier: number;
}

let database: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (database) return database;
  mkdirSync(dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  try {
    db.prepare("PRAGMA journal_mode = WAL").get();
  } catch {
    // WAL is an optimisation, not a hard requirement.
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      ts INTEGER PRIMARY KEY,
      total_credits REAL NOT NULL,
      total_usage REAL NOT NULL,
      key_limit REAL,
      key_limit_remaining REAL,
      key_usage REAL NOT NULL DEFAULT 0,
      usage_daily REAL NOT NULL DEFAULT 0,
      usage_weekly REAL NOT NULL DEFAULT 0,
      usage_monthly REAL NOT NULL DEFAULT 0,
      is_management_key INTEGER NOT NULL DEFAULT 0,
      is_free_tier INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots(ts);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  database = db;
  return db;
}

function mapRow(row: SnapshotRow): StoredSnapshot {
  return {
    ts: Number(row.ts),
    totalCredits: Number(row.total_credits),
    totalUsage: Number(row.total_usage),
    keyLimit: row.key_limit === null ? null : Number(row.key_limit),
    keyLimitRemaining: row.key_limit_remaining === null ? null : Number(row.key_limit_remaining),
    keyUsage: Number(row.key_usage),
    usageDaily: Number(row.usage_daily),
    usageWeekly: Number(row.usage_weekly),
    usageMonthly: Number(row.usage_monthly),
    isManagementKey: Number(row.is_management_key) === 1,
    isFreeTier: Number(row.is_free_tier) === 1,
  };
}

export function insertSnapshot(snapshot: StoredSnapshot): void {
  getDb()
    .prepare(
      `INSERT INTO snapshots
         (ts, total_credits, total_usage, key_limit, key_limit_remaining, key_usage,
          usage_daily, usage_weekly, usage_monthly, is_management_key, is_free_tier)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ts) DO UPDATE SET
         total_credits = excluded.total_credits,
         total_usage = excluded.total_usage,
         key_limit = excluded.key_limit,
         key_limit_remaining = excluded.key_limit_remaining,
         key_usage = excluded.key_usage,
         usage_daily = excluded.usage_daily,
         usage_weekly = excluded.usage_weekly,
         usage_monthly = excluded.usage_monthly,
         is_management_key = excluded.is_management_key,
         is_free_tier = excluded.is_free_tier`,
    )
    .run(
      snapshot.ts,
      snapshot.totalCredits,
      snapshot.totalUsage,
      snapshot.keyLimit,
      snapshot.keyLimitRemaining,
      snapshot.keyUsage,
      snapshot.usageDaily,
      snapshot.usageWeekly,
      snapshot.usageMonthly,
      snapshot.isManagementKey ? 1 : 0,
      snapshot.isFreeTier ? 1 : 0,
    );
}

export function readSnapshots(sinceTs = 0, untilTs = Number.MAX_SAFE_INTEGER): StoredSnapshot[] {
  const rows = getDb()
    .prepare("SELECT * FROM snapshots WHERE ts >= ? AND ts <= ? ORDER BY ts ASC")
    .all(sinceTs, untilTs) as unknown as SnapshotRow[];
  return rows.map(mapRow);
}

export function latestSnapshot(): StoredSnapshot | null {
  const row = getDb().prepare("SELECT * FROM snapshots ORDER BY ts DESC LIMIT 1").get() as
    | SnapshotRow
    | undefined;
  return row ? mapRow(row) : null;
}

export function snapshotCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM snapshots").get() as { count: number } | undefined;
  return row ? Number(row.count) : 0;
}

export function oldestSnapshotTs(): number | null {
  const row = getDb().prepare("SELECT MIN(ts) AS ts FROM snapshots").get() as { ts: number | null } | undefined;
  return row && row.ts !== null ? Number(row.ts) : null;
}

/** Deletes snapshots older than the retention window to keep the DB small. */
export function pruneSnapshots(maxAgeDays: number, now = Date.now()): number {
  const cutoff = now - maxAgeDays * 86_400_000;
  const result = getDb().prepare("DELETE FROM snapshots WHERE ts < ?").run(cutoff);
  return Number(result.changes ?? 0);
}

export function setMeta(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), Date.now());
}

export function getMeta<T>(key: string): T | null {
  const row = getDb().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export function closeStore(): void {
  if (database) {
    database.close();
    database = null;
  }
}
