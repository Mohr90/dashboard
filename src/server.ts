import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

import { APP_VERSION, config, hasApiKey, usesManagementKey } from "./config.js";
import type { Collector } from "./collector.js";
import { getFxRate } from "./fx.js";
import { OpenRouterError, fetchModels, type ModelInfo } from "./openrouter.js";
import { estimateCostUsd, parsePrice, round, usdToEur } from "./stats.js";
import {
  clampDays,
  liveSummary,
  storedSummary,
  type RuntimeInfo,
  type Summary,
} from "./summary.js";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/** Trimmed model payload sent to the browser. Prices are USD per 1M tokens. */
export interface ModelRow {
  id: string;
  name: string;
  contextLength: number | null;
  promptPerMillion: number;
  completionPerMillion: number;
  requestPrice: number;
  modality: string | null;
  description: string | null;
}

export interface CompareRow extends ModelRow {
  costUsd: number;
  costEur: number;
  promptCostUsd: number;
  completionCostUsd: number;
}

interface HandlerContext {
  collector: Collector;
  sseClients: Set<ServerResponse>;
}

function toModelRow(model: ModelInfo): ModelRow {
  return {
    id: model.id,
    name: model.name,
    contextLength: model.context_length ?? null,
    promptPerMillion: round(parsePrice(model.pricing?.prompt) * 1_000_000, 4),
    completionPerMillion: round(parsePrice(model.pricing?.completion) * 1_000_000, 4),
    requestPrice: parsePrice(model.pricing?.request),
    modality: model.architecture?.modality ?? null,
    description: model.description ?? null,
  };
}

function queryInt(url: URL, name: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(name);
  if (raw === null) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload, null, 2));
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const relative = pathname === "/" ? "/index.html" : pathname;
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative);
  } catch {
    decoded = relative;
  }

  const target = resolve(config.publicDir, `.${decoded}`);
  if (target !== config.publicDir && !target.startsWith(config.publicDir + sep)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  try {
    const content = await readFile(target);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream",
      // Always fresh: the dashboard is a local dev tool.
      "Cache-Control": "no-store",
    });
    res.end(content);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Nicht gefunden");
  }
}

function handleError(error: unknown, res: ServerResponse): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (error instanceof OpenRouterError) {
    const isPermission = error.status === 403;
    sendJson(res, error.status === 429 ? 429 : 502, {
      error: error.message,
      status: error.status,
      hint: isPermission
        ? "Dieser Endpunkt braucht einen Management-Key (OPENROUTER_MANAGEMENT_KEY in .env)."
        : undefined,
    });
    return;
  }
  sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
}

function openStream(ctx: HandlerContext, req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");
  ctx.sseClients.add(res);

  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);

  void ctx.collector
    .summary()
    .then((summary) => res.write(`event: summary\ndata: ${JSON.stringify(summary)}\n\n`))
    .catch(() => res.write(`event: streamerror\ndata: ${JSON.stringify({ error: "Summary fehlgeschlagen" })}\n\n`));

  req.on("close", () => {
    clearInterval(heartbeat);
    ctx.sseClients.delete(res);
  });
}


function createHandler(ctx: HandlerContext) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A malformed request target (e.g. "//") makes `new URL` throw, so it must be
    // guarded - otherwise a single bad request would take the whole server down.
    let url: URL;
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    } catch {
      sendJson(res, 400, { error: "Ungueltige Anfrage-URL" });
      return;
    }
    const pathname = url.pathname;

    try {
      if (pathname.startsWith("/api/") && !hasApiKey()) {
        sendJson(res, 500, {
          error: "Kein OpenRouter-Key konfiguriert.",
          hint: "Bitte .env anlegen (siehe .env.example) und OPENROUTER_API_KEY setzen.",
        });
        return;
      }

      if (pathname === "/api/health") {
        sendJson(res, 200, {
          ok: true,
          version: APP_VERSION,
          uptimeSeconds: Math.round(process.uptime()),
          pollSeconds: config.pollSeconds,
          hasApiKey: hasApiKey(),
          managementKeyConfigured: usesManagementKey(),
        });
        return;
      }

      if (pathname === "/api/summary") {
        const days = queryInt(url, "days", config.historyDays, 7, 365);
        sendJson(res, 200, await ctx.collector.summary(days));
        return;
      }

      if (pathname === "/api/history") {
        const days = queryInt(url, "days", config.historyDays, 7, 365);
        sendJson(res, 200, { days, points: ctx.collector.loadSeries(days) });
        return;
      }

      if (pathname === "/api/models") {
        await handleModels(url, res);
        return;
      }

      if (pathname === "/api/compare") {
        await handleCompare(url, res);
        return;
      }

      if (pathname === "/api/refresh") {
        const result = await ctx.collector.pollSafe();
        if (!result) {
          sendJson(res, 502, { error: ctx.collector.runtime.lastError ?? "Abfrage fehlgeschlagen" });
          return;
        }
        sendJson(res, 200, await ctx.collector.summary(config.historyDays, result));
        return;
      }

      if (pathname === "/api/stream") {
        openStream(ctx, req, res);
        return;
      }

      if (pathname.startsWith("/api/")) {
        sendJson(res, 404, { error: `Unbekannter Endpunkt: ${pathname}` });
        return;
      }

      await serveStatic(pathname, res);
    } catch (error) {
      handleError(error, res);
    }
  };
}

async function handleModels(url: URL, res: ServerResponse): Promise<void> {
  const query = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const limit = queryInt(url, "limit", 400, 1, 1000);
  const all = await fetchModels();
  const models = all
    .map(toModelRow)
    .filter((row) =>
      query ? row.id.toLowerCase().includes(query) || row.name.toLowerCase().includes(query) : true,
    )
    .sort((a, b) => a.promptPerMillion - b.promptPerMillion || a.name.localeCompare(b.name))
    .slice(0, limit);
  sendJson(res, 200, { total: all.length, returned: models.length, models });
}

async function handleCompare(url: URL, res: ServerResponse): Promise<void> {
  const promptTokens = queryInt(url, "promptTokens", 2000, 0, 5_000_000);
  const completionTokens = queryInt(url, "completionTokens", 500, 0, 1_000_000);
  const requests = queryInt(url, "requests", 100, 0, 100_000);
  const limit = queryInt(url, "limit", 25, 1, 200);
  const filter = (url.searchParams.get("models") ?? "").trim().toLowerCase();

  const fx = await getFxRate();
  const all = await fetchModels();
  const selected = filter
    ? all.filter((model) => filter.split(",").some((needle) => model.id.toLowerCase().includes(needle.trim())))
    : all;

  const rows: CompareRow[] = selected
    .map((model) => {
      const base = toModelRow(model);
      const promptCostUsd = estimateCostUsd(model.pricing, { promptTokens, completionTokens: 0 });
      const completionCostUsd = estimateCostUsd(model.pricing, { promptTokens: 0, completionTokens });
      const requestCostUsd = requests * parsePrice(model.pricing?.request);
      const costUsd = round(promptCostUsd + completionCostUsd + requestCostUsd, 6);
      return {
        ...base,
        costUsd,
        costEur: usdToEur(costUsd, fx.eurPerUsd),
        promptCostUsd: round(promptCostUsd, 6),
        completionCostUsd: round(completionCostUsd, 6),
      };
    })
    .sort((a, b) => a.costUsd - b.costUsd)
    .slice(0, limit);

  sendJson(res, 200, {
    workload: { promptTokens, completionTokens, requests },
    currency: { eurPerUsd: fx.eurPerUsd, source: fx.source },
    candidates: selected.length,
    rows,
  });
}

export interface DashboardServer {
  url: string;
  listen(): Promise<{ url: string }>;
  close(): Promise<void>;
}

/** Wires the collector to an HTTP server that serves the dashboard and its API. */
export function createDashboardServer(collector: Collector): DashboardServer {
  const sseClients = new Set<ServerResponse>();
  const ctx: HandlerContext = { collector, sseClients };
  const handle = createHandler(ctx);

  const broadcast = (summary: Summary): void => {
    const payload = `event: summary\ndata: ${JSON.stringify(summary)}\n\n`;
    for (const client of [...sseClients]) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  };
  collector.on("summary", broadcast);

  const server = createServer((req, res) => {
    // Belt and braces: never let a rejected handler become an unhandled rejection.
    void handle(req, res).catch((error: unknown) => handleError(error, res));
  });

  const host = config.host === "0.0.0.0" || config.host === "::" ? "localhost" : config.host;
  const url = `http://${host}:${config.port}`;

  return {
    url,
    listen: () =>
      new Promise<{ url: string }>((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(config.port, config.host, () => resolvePromise({ url }));
      }),
    close: () =>
      new Promise<void>((resolvePromise) => {
        collector.off("summary", broadcast);
        for (const client of sseClients) client.end();
        sseClients.clear();
        server.close(() => resolvePromise());
      }),
  };
}
