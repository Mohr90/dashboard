import { config, hasApiKey } from "./config.js";
import { Collector } from "./collector.js";
import { fetchModels } from "./openrouter.js";
import { createDashboardServer } from "./server.js";
import { formatEur, formatPercent, formatTokens, formatUsd, parsePrice } from "./stats.js";
import { closeStore, getDb } from "./store.js";

type Command = "serve" | "snapshot" | "summary" | "models" | "help";

function usage(): string {
  return [
    "open-router-stats - Guthaben, Verbrauch und Modellpreise von OpenRouter",
    "",
    "Verwendung:  tsx src/cli.ts <befehl>",
    "",
    "Befehle:",
    "  serve            Web-Dashboard unter http://HOST:PORT starten (Standard)",
    "  snapshot         Einmal messen, in die Datenbank schreiben, JSON ausgeben",
    "  summary          Aktuelle Kennzahlen als Textbericht ausgeben",
    "  models [n]       Die n guenstigsten Modelle auflisten (Standard: 15)",
    "",
    "Konfiguration ueber .env (siehe .env.example).",
  ].join("\n");
}

async function cmdSnapshot(): Promise<number> {
  const collector = new Collector();
  getDb();
  try {
    const { keyInfo, credits, snapshot } = await collector.poll();
    const remaining = credits.total_credits - credits.total_usage;
    process.stdout.write(
      `${JSON.stringify(
        {
          recordedAt: new Date(snapshot.ts).toISOString(),
          key: {
            label: keyInfo.label,
            isManagementKey: Boolean(keyInfo.is_management_key),
            limit: keyInfo.limit,
            limitRemaining: keyInfo.limit_remaining,
            usageAllTime: keyInfo.usage,
            usageDaily: keyInfo.usage_daily,
            usageWeekly: keyInfo.usage_weekly,
            usageMonthly: keyInfo.usage_monthly,
          },
          account: {
            totalCredits: credits.total_credits,
            totalUsage: credits.total_usage,
            remainingUsd: Number(remaining.toFixed(6)),
          },
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  } finally {
    closeStore();
  }
}

async function cmdSummary(): Promise<number> {
  const collector = new Collector();
  getDb();
  try {
    const summary = await collector.summary();
    const lines = [
      `Stand:                 ${new Date(summary.generatedAt).toLocaleString("de-DE")}`,
      `Wechselkurs:           1 USD = ${summary.currency.eurPerUsd.toFixed(4)} EUR (${summary.currency.source})`,
      "",
      `Guthaben:              ${formatEur(summary.account.remainingEur)}  (${formatUsd(summary.account.remainingUsd)})`,
      `  gekauft:             ${formatUsd(summary.account.totalCredits)}`,
      `  verbraucht:          ${formatUsd(summary.account.totalUsage)}  (${formatPercent(summary.account.usedPercent)})`,
      "",
      `Key:                   ${summary.key.label ?? "unbenannt"}${summary.key.isManagementKey ? " [management]" : ""}`,
      `  Limit:               ${summary.key.limit === null ? "kein Limit" : formatUsd(summary.key.limit)} (${summary.key.limitReset ?? "kein Reset"})`,
      `  Limit-Rest:          ${summary.key.limitRemaining === null ? "n/a" : formatUsd(summary.key.limitRemaining)}`,
      `  heute / Woche:       ${formatUsd(summary.key.usageDaily)} / ${formatUsd(summary.key.usageWeekly)}`,
      `  Monat / gesamt:      ${formatUsd(summary.key.usageMonthly)} / ${formatUsd(summary.key.usageAllTime)}`,
      "",
      `Burn-Rate:             ${formatEur(summary.burn.perDayEur)}/Tag (${formatUsd(summary.burn.perDayUsd)}/Tag, Quelle: ${summary.burn.source})`,
      `Reicht noch:           ${summary.burn.daysRemaining === null ? "kein Verbrauch messbar" : `${summary.burn.daysRemaining} Tage`}`,
      `Leer voraussichtlich:  ${summary.burn.runsOutAt ? new Date(summary.burn.runsOutAt).toLocaleDateString("de-DE") : "n/a"}`,
      "",
      `Messpunkte:            ${summary.meta.snapshotCount}${summary.meta.historySince ? ` (seit ${new Date(summary.meta.historySince).toLocaleString("de-DE")})` : ""}`,
    ];
    if (summary.meta.lastError) lines.push(`Letzter Fehler:        ${summary.meta.lastError}`);
    process.stdout.write(`${lines.join("\n")}\n`);
    return 0;
  } finally {
    closeStore();
  }
}

async function cmdModels(limit: number): Promise<number> {
  const models = await fetchModels();
  const rows = models
    .filter((model) => parsePrice(model.pricing?.prompt) > 0 || parsePrice(model.pricing?.completion) > 0)
    .map((model) => ({
      model,
      score: parsePrice(model.pricing?.prompt) * 3 + parsePrice(model.pricing?.completion),
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);

  const header = `${'Modell'.padEnd(46)} ${'$/1M in'.padStart(9)} ${'$/1M out'.padStart(9)} ${'Kontext'.padStart(9)}`;
  const lines = [header, '-'.repeat(header.length)];
  for (const { model } of rows) {
    const inPrice = (parsePrice(model.pricing?.prompt) * 1_000_000).toFixed(3).padStart(9);
    const outPrice = (parsePrice(model.pricing?.completion) * 1_000_000).toFixed(3).padStart(9);
    const context = formatTokens(model.context_length ?? 0).padStart(9);
    lines.push(`${model.id.slice(0, 46).padEnd(46)} ${inPrice} ${outPrice} ${context}`);
  }
  process.stdout.write(`${lines.join('\n')}\n\n${models.length} Modelle insgesamt.\n`);
  return 0;
}

async function cmdServe(): Promise<number> {
  if (!hasApiKey()) {
    process.stderr.write('Warnung: OPENROUTER_API_KEY fehlt - das Dashboard startet, kann aber keine Daten laden.\n');
  }

  const collector = new Collector();
  getDb();
  const server = createDashboardServer(collector);

  collector.on('pollError', (error: Error) => {
    process.stderr.write(`Abfrage fehlgeschlagen: ${error.message}\n`);
  });

  collector.start();
  const { url } = await server.listen();

  process.stdout.write(
    [
      '',
      '  open-router-stats laeuft',
      `  Dashboard:      ${url}`,
      `  Abfrage:        alle ${config.pollSeconds}s`,
      `  Datenbank:      ${config.dbPath}`,
      `  Verlauf:        ${config.historyDays} Tage`,
      `  Management-Key: ${config.managementKey ? 'konfiguriert' : 'nicht gesetzt (nur Basis-Kennzahlen)'}`,
      '',
      '  Mit Strg+C beenden.',
      '',
    ].join('\n'),
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\n${signal} empfangen - beende...\n`);
    collector.stop();
    await server.close();
    closeStore();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await new Promise<void>(() => {});
  return 0;
}

async function main(): Promise<number> {
  const [rawCommand = 'serve', ...rest] = process.argv.slice(2);
  const command = (rawCommand === '--help' || rawCommand === '-h' ? 'help' : rawCommand) as Command;

  switch (command) {
    case 'serve':
      return cmdServe();
    case 'snapshot':
      return cmdSnapshot();
    case 'summary':
      return cmdSummary();
    case 'models': {
      const limit = Number(rest[0]);
      return cmdModels(Number.isFinite(limit) && limit > 0 ? Math.trunc(limit) : 15);
    }
    case 'help':
      process.stdout.write(`${usage()}\n`);
      return 0;
    default:
      process.stderr.write(`Unbekannter Befehl: ${rawCommand}\n\n${usage()}\n`);
      return 1;
  }
}

main()
  .then((code) => {
    if (code !== 0) process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(`Fehler: ${error instanceof Error ? error.message : String(error)}\n`);
    closeStore();
    process.exitCode = 1;
  });
