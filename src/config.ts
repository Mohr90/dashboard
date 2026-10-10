import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the project root (folder that contains package.json). */
export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Load ".env" if present. Node >= 20.12 provides process.loadEnvFile().
const envFile = process.env.ENV_FILE ?? resolve(PROJECT_ROOT, ".env");
if (existsSync(envFile)) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // A malformed .env should never crash the app; missing values fall back.
  }
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== "" ? raw.trim() : fallback;
}

function readOptional(name: string): string | undefined {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== "" ? raw.trim() : undefined;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** Version reported by the HTTP API, the CLI and the MCP server. */
export const APP_VERSION = "0.1.0";

export interface Config {
  readonly projectRoot: string;
  readonly publicDir: string;
  readonly apiKey: string;
  readonly managementKey: string;
  readonly baseUrl: string;
  readonly fxUrl: string;
  readonly host: string;
  readonly port: number;
  readonly pollSeconds: number;
  readonly historyDays: number;
  readonly eurPerUsdFallback: number;
  readonly fxRefreshHours: number;
  readonly dbPath: string;
  readonly version: string;
}

export const config: Config = {
  projectRoot: PROJECT_ROOT,
  publicDir: resolve(PROJECT_ROOT, "public"),
  apiKey: readOptional("OPENROUTER_API_KEY") ?? "",
  managementKey: readOptional("OPENROUTER_MANAGEMENT_KEY") ?? "",
  baseUrl: readString("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").replace(/\/+$/, ""),
  fxUrl: readString("FX_URL", "https://api.frankfurter.dev/v1/latest"),
  host: readString("HOST", "127.0.0.1"),
  port: Math.trunc(readNumber("PORT", 8787)),
  // Never hammer the API: 15s is the hard floor.
  pollSeconds: Math.max(15, Math.trunc(readNumber("POLL_SECONDS", 60))),
  historyDays: Math.max(7, Math.trunc(readNumber("HISTORY_DAYS", 90))),
  eurPerUsdFallback: readNumber("EUR_PER_USD_FALLBACK", 0.89),
  fxRefreshHours: Math.max(1, readNumber("FX_REFRESH_HOURS", 12)),
  dbPath: resolve(PROJECT_ROOT, readString("DB_PATH", "data/stats.db")),
  version: APP_VERSION,
};

/** Key used for inference-scoped endpoints (/key, /models). */
export function inferenceKey(): string {
  return config.apiKey || config.managementKey;
}

/** Key used for account-scoped endpoints (/credits, /analytics). */
export function adminKey(): string {
  return config.managementKey || config.apiKey;
}

export function hasApiKey(): boolean {
  return Boolean(config.apiKey || config.managementKey);
}

export function usesManagementKey(): boolean {
  return Boolean(config.managementKey);
}

