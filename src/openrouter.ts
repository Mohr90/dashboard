import { config, inferenceKey, adminKey } from "./config.js";

const APP_TITLE = "open-router-stats";
const APP_REFERER = "https://github.com/Mohr90/open-router-stats";

/** Error thrown for any non-2xx response or network failure. */
export class OpenRouterError extends Error {
  readonly path: string;
  readonly status: number;
  readonly body: unknown;

  constructor(path: string, status: number, message: string, body: unknown) {
    super(`OpenRouter ${path} (HTTP ${status || "n/a"}): ${message}`);
    this.name = "OpenRouterError";
    this.path = path;
    this.status = status;
    this.body = body;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  /** Do not fail when no API key is configured (public endpoints like /models). */
  anonymousAllowed?: boolean;
}

function extractErrorMessage(body: unknown): string | null {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const error = record.error;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
    if (typeof record.message === "string") return record.message;
  }
  return null;
}

async function request<T>(path: string, apiKey: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, timeoutMs = 20_000, anonymousAllowed = false } = options;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-Title": APP_TITLE,
    "HTTP-Referer": APP_REFERER,
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (!anonymousAllowed) {
    throw new OpenRouterError(path, 401, "Kein API-Key konfiguriert - bitte OPENROUTER_API_KEY in .env setzen.", null);
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new OpenRouterError(path, 0, `Netzwerkfehler: ${message}`, null);
  }

  const text = await response.text();
  let parsed: unknown = text;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // Keep the raw text as the body.
    }
  }

  if (!response.ok) {
    const message = extractErrorMessage(parsed) ?? response.statusText ?? "Unbekannter Fehler";
    throw new OpenRouterError(path, response.status, message, parsed);
  }

  return parsed as T;
}

// ---------------------------------------------------------------------------
// Types (subset of the OpenRouter API this app consumes)
// ---------------------------------------------------------------------------

export interface FreeModelRequests {
  used: number;
  limit: number;
  remaining: number;
}

export interface KeyInfo {
  label: string | null;
  is_management_key?: boolean;
  is_provisioning_key?: boolean;
  /** Credit limit configured on this key, or null if unlimited. */
  limit: number | null;
  limit_reset: string | null;
  limit_remaining: number | null;
  include_byok_in_limit?: boolean;
  usage: number;
  usage_daily: number;
  usage_weekly: number;
  usage_monthly: number;
  byok_usage?: number;
  byok_usage_monthly?: number;
  is_free_tier: boolean;
  expires_at?: string | null;
  workspace_id?: string | null;
  free_model_daily_requests?: FreeModelRequests;
}

export interface CreditsInfo {
  total_credits: number;
  total_usage: number;
}

export interface ModelPricing {
  prompt?: string;
  completion?: string;
  request?: string;
  image?: string;
  web_search?: string;
  internal_reasoning?: string;
  input_cache_read?: string;
  input_cache_write?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  created?: number;
  context_length?: number | null;
  pricing: ModelPricing;
  description?: string;
  architecture?: {
    modality?: string;
    input_modalities?: string[];
    output_modalities?: string[];
  };
  top_provider?: {
    context_length?: number | null;
    max_completion_tokens?: number | null;
    is_moderated?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** GET /key - usage, limits and per-period consumption for the current key. */
export async function fetchKeyInfo(apiKey: string = inferenceKey()): Promise<KeyInfo> {
  const response = await request<{ data: KeyInfo }>("/key", apiKey);
  return response.data;
}

/** GET /credits - account-wide credits purchased and consumed. */
export async function fetchCredits(apiKey: string = adminKey()): Promise<CreditsInfo> {
  const response = await request<{ data: CreditsInfo }>("/credits", apiKey);
  return response.data;
}

let modelCache: { ts: number; data: ModelInfo[] } | null = null;

/** GET /models - public model catalog with pricing. Cached in memory. */
export async function fetchModels(maxAgeMs = 3_600_000): Promise<ModelInfo[]> {
  if (modelCache && Date.now() - modelCache.ts < maxAgeMs) return modelCache.data;
  const response = await request<{ data: ModelInfo[] }>("/models", inferenceKey(), {
    anonymousAllowed: true,
    timeoutMs: 30_000,
  });
  const data = Array.isArray(response.data) ? response.data : [];
  modelCache = { ts: Date.now(), data };
  return data;
}

// ---------------------------------------------------------------------------
// Analytics API - requires a management key (HTTP 403 for inference keys).
// ---------------------------------------------------------------------------

export interface AnalyticsQuery {
  metrics: string[];
  dimensions?: string[];
  granularity?: "day" | "week" | "month";
  time_range: { start: string; end: string };
  limit?: number;
  order_by?: { field: string; direction: "asc" | "desc" };
}

export interface AnalyticsResponse {
  data: {
    data: Array<Record<string, string | number>>;
    metadata?: { query_time_ms?: number; row_count?: number; truncated?: boolean };
  };
}

export function analyticsAvailable(): boolean {
  return Boolean(config.managementKey);
}

/** POST /analytics/query - requires a management key. */
export async function queryAnalytics(query: AnalyticsQuery): Promise<AnalyticsResponse> {
  return request<AnalyticsResponse>("/analytics/query", config.managementKey, {
    method: "POST",
    body: query,
    timeoutMs: 30_000,
  });
}

