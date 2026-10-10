#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { APP_VERSION, config } from "./config.js";
import { Collector } from "./collector.js";
import { fetchModels } from "./openrouter.js";
import { estimateCostUsd, formatEur, formatPercent, formatTokens, formatUsd, parsePrice } from "./stats.js";
import { closeStore, getDb } from "./store.js";

/** stdout is reserved for the JSON-RPC protocol, so every log goes to stderr. */
function log(message: string): void {
  process.stderr.write(`[open-router-stats] ${message}\n`);
}

let collector: Collector | null = null;
function getCollector(): Collector {
  if (!collector) {
    getDb();
    collector = new Collector();
  }
  return collector;
}

/**
 * Always returns live data: takes a fresh measurement (also persisted to the
 * history database) and builds the summary from it.
 */
async function freshSummary() {
  const instance = getCollector();
  const result = await instance.pollSafe();
  return instance.summary(config.historyDays, result ?? undefined);
}

type ToolResult = { content: Array<{ type: "text"; text: string }> };
function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

const server = new McpServer({ name: "open-router-stats", version: APP_VERSION }, { capabilities: {} });

server.registerTool(
  "openrouter_balance",
  {
    title: "OpenRouter Guthaben",
    description:
      "Restguthaben des OpenRouter-Accounts in EUR und USD, inklusive gekaufter und verbrauchter Credits sowie dem Limit des verwendeten API-Keys.",
    inputSchema: {},
  },
  async () => {
    const s = await freshSummary();
    const lines = [
      `Restguthaben: ${formatEur(s.account.remainingEur)} (${formatUsd(s.account.remainingUsd)})`,
      `Gekauft: ${formatUsd(s.account.totalCredits)} | Verbraucht: ${formatUsd(s.account.totalUsage)} (${formatPercent(s.account.usedPercent)})`,
      `Key: ${s.key.label ?? "unbenannt"}${s.key.isManagementKey ? " [management]" : ""}`,
      s.key.limit === null
        ? "Key-Limit: keines (unbegrenzt)"
        : `Key-Limit: ${formatUsd(s.key.limit)} (${s.key.limitReset ?? "kein Reset"}), verbleibend ${s.key.limitRemaining === null ? "n/a" : formatUsd(s.key.limitRemaining)}`,
      `Wechselkurs: 1 USD = ${s.currency.eurPerUsd.toFixed(4)} EUR (${s.currency.source})`,
    ];
    return text(lines.join("\n"));
  },
);

server.registerTool(
  "openrouter_usage",
  {
    title: "OpenRouter Verbrauch",
    description: "Verbrauch des OpenRouter-Accounts: heute, diese Woche, diesen Monat und insgesamt (in USD).",
    inputSchema: {},
  },
  async () => {
    const s = await freshSummary();
    const lines = [
      `Heute:  ${formatUsd(s.key.usageDaily)} (${formatEur(s.key.usageDaily * s.currency.eurPerUsd)})`,
      `Woche:  ${formatUsd(s.key.usageWeekly)}`,
      `Monat:  ${formatUsd(s.key.usageMonthly)}`,
      `Gesamt: ${formatUsd(s.key.usageAllTime)}`,
      `Messpunkte in der lokalen Historie: ${s.meta.snapshotCount}`,
    ];
    if (s.key.freeModelRequests) {
      lines.push(
        `Free-Model-Requests heute: ${s.key.freeModelRequests.used}/${s.key.freeModelRequests.limit} (${s.key.freeModelRequests.remaining} offen)`,
      );
    }
    return text(lines.join("\n"));
  },
);

server.registerTool(
  "openrouter_burn_rate",
  {
    title: "OpenRouter Burn-Rate & Prognose",
    description:
      "Durchschnittlicher Verbrauch pro Tag und Prognose, wie lange das Restguthaben noch reicht (optional inkl. Verlaufskurve).",
    inputSchema: {
      days: z.number().int().min(7).max(365).optional().describe("Betrachteter Zeitraum in Tagen (Standard: konfigurierter Verlauf)"),
    },
  },
  async ({ days }) => {
    const instance = getCollector();
    const window = days ?? config.historyDays;
    const result = await instance.pollSafe();
    const s = await instance.summary(window, result ?? undefined);
    const lines = [
      `Ø Verbrauch: ${formatEur(s.burn.perDayEur)}/Tag (${formatUsd(s.burn.perDayUsd)}/Tag)`,
      `Basis: ${s.burn.source} ueber ${s.burn.windowDays} Tag(e)`,
      `Restguthaben: ${formatEur(s.account.remainingEur)}`,
      s.burn.daysRemaining === null
        ? "Prognose: kein messbarer Verbrauch - Guthaben reicht theoretisch unbegrenzt."
        : `Prognose: reicht noch ca. ${s.burn.daysRemaining} Tage (leer am ${s.burn.runsOutAt ? new Date(s.burn.runsOutAt).toLocaleDateString("de-DE") : "n/a"})`,
    ];
    const points = s.history.points.filter((p) => p.spend > 0);
    if (points.length > 0) {
      lines.push("", "Tagesverbrauch (USD):");
      for (const point of points.slice(-14)) {
        lines.push(`  ${point.date}: ${formatUsd(point.spend)}`);
      }
    }
    return text(lines.join("\n"));
  },
);

server.registerTool(
  "openrouter_history",
  {
    title: "OpenRouter Verlauf",
    description: "Taeglicher Verbrauch aus der lokal mitgeschriebenen Historie (UTC-Tage).",
    inputSchema: {
      days: z.number().int().min(1).max(365).optional().describe("Anzahl der Tage (Standard 30)"),
    },
  },
  async ({ days }) => {
    const instance = getCollector();
    const window = days ?? 30;
    const series = instance.loadSeries(window);
    const total = series.reduce((sum, point) => sum + point.spend, 0);
    const lines = [`Zeitraum: letzte ${window} Tage`, `Summe: ${formatUsd(total)}`, ""];
    for (const point of series) {
      lines.push(`${point.date}  ${formatUsd(point.spend)}`);
    }
    return text(lines.join("\n"));
  },
);

server.registerTool(
  "openrouter_model_prices",
  {
    title: "OpenRouter Modellpreise",
    description: "Sucht Modelle im OpenRouter-Katalog und listet ihre Preise pro 1M Tokens (USD).",
    inputSchema: {
      query: z.string().optional().describe("Suchbegriff, z. B. claude, gpt, gemini"),
      limit: z.number().int().min(1).max(100).optional().describe("Maximale Anzahl Treffer (Standard 15)"),
    },
  },
  async ({ query, limit }) => {
    const models = await fetchModels();
    const needle = (query ?? "").trim().toLowerCase();
    const rows = models
      .filter((model) =>
        needle ? model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle) : true,
      )
      .map((model) => ({
        id: model.id,
        context: model.context_length ?? 0,
        prompt: parsePrice(model.pricing?.prompt) * 1_000_000,
        completion: parsePrice(model.pricing?.completion) * 1_000_000,
      }))
      .sort((a, b) => a.prompt - b.prompt)
      .slice(0, limit ?? 15);

    const lines = [`${models.length} Modelle im Katalog, ${rows.length} Treffer:`, ""];
    for (const row of rows) {
      lines.push(
        `${row.id}  ->  $${row.prompt.toFixed(3)}/1M in, $${row.completion.toFixed(3)}/1M out, Kontext ${formatTokens(row.context)}`,
      );
    }
    return text(lines.join("\n"));
  },
);

server.registerTool(
  "openrouter_estimate_cost",
  {
    title: "OpenRouter Kostenschaetzung",
    description:
      "Schaetzt die Kosten eines Workloads (Tokens und Requests) fuer ein bestimmtes Modell und vergleicht sie mit dem Restguthaben.",
    inputSchema: {
      modelId: z.string().describe("Modell-ID, z. B. anthropic/claude-sonnet-4.5"),
      promptTokens: z.number().int().min(0).describe("Input-Tokens pro Request"),
      completionTokens: z.number().int().min(0).describe("Output-Tokens pro Request"),
      requests: z.number().int().min(1).optional().describe("Anzahl Requests (Standard 1)"),
    },
  },
  async ({ modelId, promptTokens, completionTokens, requests }) => {
    const count = requests ?? 1;
    const models = await fetchModels();
    const needle = modelId.trim().toLowerCase();
    const model =
      models.find((entry) => entry.id.toLowerCase() === needle) ??
      models.find((entry) => entry.id.toLowerCase().includes(needle));

    if (!model) {
      return text(`Kein Modell gefunden fuer "${modelId}". Nutze openrouter_model_prices fuer die Suche.`);
    }

    const perRequestUsd = estimateCostUsd(model.pricing, { promptTokens, completionTokens });
    const totalUsd = estimateCostUsd(model.pricing, { promptTokens, completionTokens, requests: count });
    const s = await freshSummary();
    const rate = s.currency.eurPerUsd;

    const lines = [
      `Modell: ${model.id}`,
      `Workload: ${formatTokens(promptTokens)} Input- und ${formatTokens(completionTokens)} Output-Tokens x ${count} Requests`,
      `Preis: $${(parsePrice(model.pricing?.prompt) * 1_000_000).toFixed(3)}/1M in, $${(parsePrice(model.pricing?.completion) * 1_000_000).toFixed(3)}/1M out`,
      "",
      `Kosten pro Request: ${formatUsd(perRequestUsd)} (${formatEur(perRequestUsd * rate)})`,
      `Kosten gesamt:      ${formatUsd(totalUsd)} (${formatEur(totalUsd * rate)})`,
      `Restguthaben:       ${formatEur(s.account.remainingEur)} - das entspricht ${s.account.remainingUsd > 0 && totalUsd > 0 ? Math.floor(s.account.remainingUsd / totalUsd) : "unbegrenzt"} solcher Workloads.`,
    ];
    return text(lines.join("\n"));
  },
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`MCP-Server bereit (stdio). Verlauf: ${config.dbPath}`);
}

function shutdown(): void {
  closeStore();
}
process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

main().catch((error: unknown) => {
  log(`Start fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
