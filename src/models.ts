import { fetchModels } from "./openrouter.js";
import { estimateCostUsd, parsePrice, round, type UsageEstimate } from "./stats.js";

/** Flattened, comparison-friendly view of an OpenRouter model. */
export interface ModelSummary {
  id: string;
  name: string;
  contextLength: number | null;
  /** USD per 1M prompt tokens. */
  promptPerMillion: number;
  /** USD per 1M completion tokens. */
  completionPerMillion: number;
  /** USD per 1M cached prompt tokens (0 when not offered). */
  cacheReadPerMillion: number;
  /** USD per request, if the model charges per call. */
  requestPrice: number;
  isFree: boolean;
  modality: string | null;
  created: number | null;
}

export type ModelSort = "price" | "completion" | "context" | "name" | "newest";

export interface ListModelsOptions {
  query?: string;
  limit?: number;
  sort?: ModelSort;
}

function toSummary(model: {
  id: string;
  name: string;
  created?: number;
  context_length?: number | null;
  pricing: { prompt?: string; completion?: string; request?: string; input_cache_read?: string };
  architecture?: { modality?: string };
}): ModelSummary {
  const promptPerMillion = round(parsePrice(model.pricing?.prompt) * 1_000_000, 4);
  const completionPerMillion = round(parsePrice(model.pricing?.completion) * 1_000_000, 4);
  return {
    id: model.id,
    name: model.name,
    contextLength: model.context_length ?? null,
    promptPerMillion,
    completionPerMillion,
    cacheReadPerMillion: round(parsePrice(model.pricing?.input_cache_read) * 1_000_000, 4),
    requestPrice: round(parsePrice(model.pricing?.request), 6),
    isFree: promptPerMillion === 0 && completionPerMillion === 0,
    modality: model.architecture?.modality ?? null,
    created: model.created ?? null,
  };
}

const SORTERS: Record<ModelSort, (a: ModelSummary, b: ModelSummary) => number> = {
  price: (a, b) => a.promptPerMillion - b.promptPerMillion || a.completionPerMillion - b.completionPerMillion,
  completion: (a, b) => a.completionPerMillion - b.completionPerMillion || a.promptPerMillion - b.promptPerMillion,
  context: (a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0),
  name: (a, b) => a.name.localeCompare(b.name, "de"),
  newest: (a, b) => (b.created ?? 0) - (a.created ?? 0),
};

/** Model catalog with per-million prices, ready for the comparison table. */
export async function listModels(options: ListModelsOptions = {}): Promise<{ total: number; models: ModelSummary[] }> {
  const sort: ModelSort = options.sort ?? "price";
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 100), 1), 2000);
  const query = options.query?.trim().toLowerCase() ?? "";

  const all = await fetchModels();
  let models = all.map(toSummary);

  if (query) {
    models = models.filter(
      (model) => model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query),
    );
  }

  models.sort(SORTERS[sort] ?? SORTERS.price);
  return { total: models.length, models: models.slice(0, limit) };
}

/** Looks up a single model by id or name (exact first, then substring). */
export async function findModel(idOrName: string): Promise<ModelSummary | null> {
  const needle = idOrName.trim().toLowerCase();
  if (!needle) return null;
  const all = (await fetchModels()).map(toSummary);
  return (
    all.find((model) => model.id.toLowerCase() === needle) ??
    all.find((model) => model.name.toLowerCase() === needle) ??
    all.find((model) => model.id.toLowerCase().includes(needle)) ??
    all.find((model) => model.name.toLowerCase().includes(needle)) ??
    null
  );
}

/** One row of the "which model is cheapest for my workload" comparison. */
export interface CostComparison {
  id: string;
  name: string;
  contextLength: number | null;
  isFree: boolean;
  promptPerMillion: number;
  completionPerMillion: number;
  requestPrice: number;
  /** Estimated cost in USD for the supplied workload. */
  costUsd: number;
}

/**
 * Ranks models by the estimated cost of a concrete workload.
 *
 * With a workload (tokens > 0) the cheapest model wins; without one the
 * catalogue is ordered by list price as a fallback.
 */
export async function compareModels(
  options: ListModelsOptions & UsageEstimate,
): Promise<{ total: number; usage: UsageEstimate; rows: CostComparison[] }> {
  const usage: UsageEstimate = {
    promptTokens: Math.max(0, Math.trunc(options.promptTokens)),
    completionTokens: Math.max(0, Math.trunc(options.completionTokens)),
    requests: Math.max(0, Math.trunc(options.requests ?? 0)),
  };
  const sort: ModelSort = options.sort ?? "price";
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 500);
  const query = options.query?.trim().toLowerCase() ?? "";

  const all = (await fetchModels()).map(toSummary);
  const filtered = query
    ? all.filter(
        (model) => model.id.toLowerCase().includes(query) || model.name.toLowerCase().includes(query),
      )
    : all;

  const rows: CostComparison[] = filtered.map((model) => ({
    id: model.id,
    name: model.name,
    contextLength: model.contextLength,
    isFree: model.isFree,
    promptPerMillion: model.promptPerMillion,
    completionPerMillion: model.completionPerMillion,
    requestPrice: model.requestPrice,
    costUsd: estimateCostUsd(
      {
        prompt: String(model.promptPerMillion / 1_000_000),
        completion: String(model.completionPerMillion / 1_000_000),
        request: String(model.requestPrice),
      },
      usage,
    ),
  }));

  const hasWorkload = usage.promptTokens > 0 || usage.completionTokens > 0;
  if (hasWorkload) {
    rows.sort((a, b) => a.costUsd - b.costUsd || a.name.localeCompare(b.name, "de"));
  } else if (sort === "completion") {
    rows.sort((a, b) => a.completionPerMillion - b.completionPerMillion || a.promptPerMillion - b.promptPerMillion);
  } else if (sort === "context") {
    rows.sort((a, b) => (b.contextLength ?? 0) - (a.contextLength ?? 0));
  } else if (sort === "name") {
    rows.sort((a, b) => a.name.localeCompare(b.name, "de"));
  } else {
    rows.sort((a, b) => a.promptPerMillion - b.promptPerMillion || a.completionPerMillion - b.completionPerMillion);
  }

  return { total: rows.length, usage, rows: rows.slice(0, limit) };
}

