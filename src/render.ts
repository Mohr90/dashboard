import type { CostComparison, ModelSummary } from "./models.js";
import { formatEur, formatPercent, formatTokens, formatUsd, type UsageEstimate } from "./stats.js";
import type { Summary } from "./summary.js";

/**
 * Plain-text rendering shared by the CLI and the MCP server, so a chat answer
 * and a terminal report always look the same.
 */

const BURN_SOURCE_LABEL: Record<string, string> = {
  history: "lokale Historie",
  "api-week": "OpenRouter (7-Tage-Schnitt)",
  "api-month": "OpenRouter (Monats-Schnitt)",
  "api-day": "OpenRouter (heute)",
};

function burnSourceLabel(source: string): string {
  return BURN_SOURCE_LABEL[source] ?? source;
}

function dateOnly(iso: string | null): string {
  if (!iso) return "unbekannt";
  return new Date(iso).toLocaleDateString("de-DE", { dateStyle: "medium" });
}

function dateTime(iso: string | null): string {
  if (!iso) return "unbekannt";
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

function number(value: number, digits = 1): string {
  return value.toFixed(digits).replace(".", ",");
}

export function renderSummary(summary: Summary): string {
  const { account, key, burn, currency, meta } = summary;
  const lines: string[] = [];

  lines.push("OpenRouter - Guthaben & Verbrauch");
  lines.push("=================================");
  lines.push(`Guthaben:         ${formatUsd(account.remainingUsd)}  (${formatEur(account.remainingEur)})`);
  lines.push(`Gekauft:          ${formatUsd(account.totalCredits)}`);
  lines.push(`Verbraucht:       ${formatUsd(account.totalUsage)}  (${formatPercent(account.usedPercent)})`);
  lines.push("");
  lines.push("Verbrauch");
  lines.push(`  heute (UTC):    ${formatUsd(key.usageDaily)}`);
  lines.push(`  diese Woche:    ${formatUsd(key.usageWeekly)}`);
  lines.push(`  dieser Monat:   ${formatUsd(key.usageMonthly)}`);
  lines.push(`  insgesamt:      ${formatUsd(key.usageAllTime)}`);

  if (key.limit !== null) {
    lines.push("");
    lines.push("Key-Limit");
    lines.push(
      `  Limit:          ${formatUsd(key.limit)}${key.limitReset ? ` (Reset: ${key.limitReset})` : ""}`,
    );
    const restEur = key.limitRemainingEur === null ? "" : `  (${formatEur(key.limitRemainingEur)})`;
    lines.push(`  Rest:           ${formatUsd(key.limitRemaining ?? 0)}${restEur}`);
  }

  lines.push("");
  lines.push("Prognose");
  lines.push(
    `  Ø pro Tag:      ${formatUsd(burn.perDayUsd)}  (${formatEur(burn.perDayEur)}) Basis: ` +
      `${burnSourceLabel(burn.source)}, ${burn.windowDays} Tag(e)`,
  );
  if (burn.daysRemaining === null) {
    lines.push("  Reichweite:     nicht berechenbar (aktuell kein Verbrauch erkannt)");
  } else {
    lines.push(`  Reichweite:     ca. ${number(burn.daysRemaining)} Tage (bis ${dateOnly(burn.runsOutAt)})`);
  }

  lines.push("");
  lines.push(
    `Kurs: 1 USD = ${number(currency.eurPerUsd, 4)} EUR (${currency.source}${
      currency.asOf ? `, ${currency.asOf}` : ""
    })`,
  );
  lines.push(
    `Historie: ${meta.snapshotCount} Messpunkte seit ${dateOnly(meta.historySince)} | ` +
      `Poll alle ${meta.pollSeconds}s | letzte Messung ${dateTime(meta.lastPollAt)}`,
  );
  if (!meta.managementKeyConfigured) {
    lines.push(
      "Hinweis: kein Management-Key gesetzt - Verbrauch je Modell/Tag ist über die " +
        "Analytics-API nicht verfügbar, der Verlauf kommt aus der lokalen Datenbank.",
    );
  }
  if (meta.lastError) lines.push(`Letzter Fehler: ${meta.lastError}`);

  return lines.join("\n");
}

export function renderBalance(summary: Summary): string {
  const { account, burn } = summary;
  const reach =
    burn.daysRemaining === null
      ? "Reichweite: aktuell kein Verbrauch erkannt"
      : `Reichweite: ca. ${number(burn.daysRemaining)} Tage`;
  return [
    `Guthaben: ${formatUsd(account.remainingUsd)} (${formatEur(account.remainingEur)})`,
    `Verbraucht: ${formatUsd(account.totalUsage)} von ${formatUsd(account.totalCredits)} ` +
      `(${formatPercent(account.usedPercent)})`,
    `Ø ${formatUsd(burn.perDayUsd)}/Tag (${formatEur(burn.perDayEur)}) -> ${reach}`,
  ].join("\n");
}

export function renderBurn(summary: Summary): string {
  const { burn, account } = summary;
  return [
    `Ø Verbrauch: ${formatUsd(burn.perDayUsd)}/Tag (${formatEur(burn.perDayEur)})`,
    `Basis: ${burnSourceLabel(burn.source)}, ${burn.windowDays} Tag(e)`,
    `Restguthaben: ${formatUsd(account.remainingUsd)} (${formatEur(account.remainingEur)})`,
    burn.daysRemaining === null
      ? "Reichweite: nicht berechenbar"
      : `Reichweite: ca. ${number(burn.daysRemaining)} Tage (bis ${dateOnly(burn.runsOutAt)})`,
  ].join("\n");
}

export function renderHistory(summary: Summary): string {
  const points = summary.history.points;
  const active = points.filter((point) => point.spend > 0);
  const lines = [`Tagesverbrauch (UTC, letzte ${points.length} Tage, nur Tage mit Verbrauch):`];
  if (active.length === 0) {
    lines.push("  (noch keine Daten - der Collector sammelt ab dem ersten Start)");
    return lines.join("\n");
  }
  for (const point of active.slice(-30)) {
    lines.push(`  ${point.date}  ${formatUsd(point.spend).padStart(12)}`);
  }
  const total = active.reduce((sum, point) => sum + point.spend, 0);
  lines.push(`  Summe: ${formatUsd(total)} über ${active.length} Tag(e)`);
  return lines.join("\n");
}

export function describeUsage(usage: UsageEstimate): string {
  const parts = [
    `${formatTokens(usage.promptTokens)} Input-Tokens`,
    `${formatTokens(usage.completionTokens)} Output-Tokens`,
  ];
  if (usage.requests) parts.push(`${usage.requests} Requests`);
  return parts.join(" + ");
}

export function renderCostComparison(
  rows: readonly CostComparison[],
  usage: UsageEstimate,
  eurPerUsd: number,
): string {
  const lines = [`Kostenschätzung für ${describeUsage(usage)} (günstigste zuerst):`];
  if (rows.length === 0) {
    lines.push("  (keine Modelle gefunden)");
    return lines.join("\n");
  }
  const width = Math.max(...rows.map((row) => row.id.length), 10);
  for (const row of rows) {
    lines.push(
      `  ${row.id.padEnd(width)}  ${formatUsd(row.costUsd).padStart(11)}` +
        `  ${formatEur(row.costUsd * eurPerUsd).padStart(14)}` +
        `  (${formatUsd(row.promptPerMillion)}/M in, ${formatUsd(row.completionPerMillion)}/M out)`,
    );
  }
  return lines.join("\n");
}

export function renderModelPrices(models: readonly ModelSummary[]): string {
  const lines = ["Modellpreise (USD pro 1M Tokens):"];
  if (models.length === 0) {
    lines.push("  (keine Modelle gefunden)");
    return lines.join("\n");
  }
  const width = Math.max(...models.map((model) => model.id.length), 10);
  for (const model of models) {
    const context = model.contextLength ? formatTokens(model.contextLength) : "n/a";
    lines.push(
      `  ${model.id.padEnd(width)}  in ${formatUsd(model.promptPerMillion).padStart(9)}` +
        `  out ${formatUsd(model.completionPerMillion).padStart(9)}  Kontext ${context}`,
    );
  }
  return lines.join("\n");
}
