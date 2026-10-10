# open-router-stats

Live-Dashboard fuer dein **OpenRouter-Guthaben**: wie viel Geld noch uebrig ist,
wie schnell du verbrauchst und wie lange es noch reicht - plus ein Preisvergleich
ueber alle ~460 Modelle. Zusaetzlich ein **MCP-Server**, damit Cline/Claude den
Kontostand direkt im Chat abfragen kann.

## Features

**Guthaben & Verbrauch**
- Restguthaben in **EUR** und **USD** (USD->EUR-Kurs live von der EZB via Frankfurter)
- Key-Ausgabenlimit inkl. Restbetrag und Reset-Zyklus
- Verbrauch heute / Woche / Monat / gesamt
- **Burn-Rate** (durchschnittlich EUR/Tag) und Prognose "reicht noch X Tage" inkl. Datum
- Tagesverlauf-Chart (14 / 30 / 90 Tage): Balken = Verbrauch pro Tag, Linie = kumuliert

**Live**
- Server-Sent-Events: der Browser aktualisiert sich bei jeder Messung automatisch
- Button "Jetzt aktualisieren" fuer eine Messung auf Knopfdruck
- Fallback auf Polling, falls SSE nicht verfuegbar ist

**Modellvergleich**
- Kostenrechner: Input-Tokens, Output-Tokens und Request-Anzahl eingeben
- Ranking der guenstigsten Modelle fuer genau diesen Workload, in EUR und USD

**MCP-Server** (`src/mcp.ts`) mit 6 Tools: `openrouter_balance`, `openrouter_usage`,
`openrouter_burn_rate`, `openrouter_history`, `openrouter_model_prices`,
`openrouter_estimate_cost`.

## Wie der Verlauf entsteht

OpenRouter liefert ueber `GET /api/v1/credits` nur zwei Zahlen: gekaufte und
verbrauchte Credits insgesamt. Die Analytics-API (`/api/v1/analytics/*`) mit
Aufschluesselung nach Modell und Tag ist **Management-Keys** vorbehalten
(`403: Only management keys can access analytics`).

Deshalb schreibt das Dashboard in einem festen Intervall eigene Messpunkte in
eine lokale SQLite-Datei (`data/stats.db`) und rekonstruiert daraus den
Tagesverbrauch. Solange die Historie noch duenn ist, wird die Burn-Rate aus den
von der API gelieferten Zeitraeumen (`usage_weekly`, `usage_monthly`) abgeleitet;
die Quelle wird im Dashboard angezeigt (`history`, `api-week`, ...).

> Der Verlauf waechst ab dem ersten Start. Nach ein paar Tagen wird `history`
> zur bevorzugten Quelle und die Kurve genauer.

## Voraussetzungen

- Node.js **>= 22.5** (getestet mit v24) - nutzt `node:sqlite` und `fetch`
- Ein **OpenRouter API-Key** (ein Inferenz-Key genuegt)
- Optional: **Management-Key** unter https://openrouter.ai/settings/management-keys

## Installation

```bash
cd /home/steffen/Dokumente/open-router-stats
npm install
cp .env.example .env      # danach OPENROUTER_API_KEY eintragen
npm start
```

Danach im Browser oeffnen: **http://127.0.0.1:8787**

## Befehle

| Befehl | Zweck |
| --- | --- |
| `npm start` | Dashboard starten (`serve`) |
| `npm run dev` | Wie `start`, aber mit Auto-Reload bei Codeaenderungen |
| `npm run snapshot` | Einmal messen, in die DB schreiben, JSON ausgeben |
| `npm run summary` | Textbericht im Terminal |
| `npm run models` | Die guenstigsten Modelle auflisten (`npm run models -- 30`) |
| `npm run mcp` | MCP-Server ueber stdio starten |
| `npm test` | Unit-Tests der Rechen- und Formatierlogik |
| `npm run typecheck` | TypeScript-Pruefung ohne Build |

## Konfiguration (`.env`)

| Variable | Standard | Bedeutung |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | - | Pflicht. Key fuer `/key`, `/credits`, `/models` |
| `OPENROUTER_MANAGEMENT_KEY` | leer | Optional, schaltet die Analytics-API frei |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Bind-Adresse des Dashboards |
| `POLL_SECONDS` | `60` | Messintervall (Minimum 15) |
| `HISTORY_DAYS` | `90` | Angezeigter und behaltener Verlauf |
| `EUR_PER_USD_FALLBACK` | `0.89` | Kurs, falls die FX-API nicht erreichbar ist |
| `FX_REFRESH_HOURS` | `12` | Wie oft der Wechselkurs neu geladen wird |
| `DB_PATH` | `data/stats.db` | SQLite-Datei mit der Historie |

## HTTP-API

| Route | Beschreibung |
| --- | --- |
| `GET /api/summary?days=30` | Alle Kennzahlen inkl. Verlauf |
| `GET /api/history?days=30` | Nur die Tagesreihe |
| `GET /api/models?q=&limit=` | Modellkatalog mit Preisen pro 1M Tokens |
| `GET /api/compare?promptTokens=&completionTokens=&requests=` | Kostenranking |
| `GET /api/refresh` | Sofort eine neue Messung + Summary |
| `GET /api/stream` | SSE-Strom der Summaries |
| `GET /api/health` | Status, Version, Uptime |

## MCP in Cline/Claude einbinden

In `~/.cline/data/settings/cline_mcp_settings.json` ergaenzen:

```json
{
  "mcpServers": {
    "openrouter-stats": {
      "transport": {
        "type": "stdio",
        "command": "/home/steffen/Dokumente/open-router-stats/node_modules/.bin/tsx",
        "args": ["/home/steffen/Dokumente/open-router-stats/src/mcp.ts"]
      }
    }
  }
}
```

Der Key wird automatisch aus der `.env` im Projektordner geladen.

## Dauerbetrieb (systemd)

```bash
mkdir -p ~/.config/systemd/user
cp systemd/open-router-stats.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now open-router-stats
journalctl --user -u open-router-stats -f
```

## Sicherheit

- Das Dashboard bindet standardmaessig nur an `127.0.0.1` und hat **keine
  Authentifizierung** - nicht ohne Reverse-Proxy mit Auth nach aussen oeffnen.
- `.env` und `data/` stehen in `.gitignore` und werden nicht eingecheckt.

## Projektstruktur

```
src/config.ts       Konfiguration + .env-Laden
src/openrouter.ts   OpenRouter-API-Client (key, credits, models, analytics)
src/fx.ts           USD->EUR-Kurs inkl. Cache und Fallback
src/stats.ts        Reine Rechen- und Formatierlogik (getestet)
src/store.ts        SQLite-Historie (node:sqlite)
src/summary.ts      Baut das Summary-Objekt fuer UI, CLI und MCP
src/collector.ts    Polling, Persistenz, Events
src/server.ts       HTTP-Server, REST-API, SSE, Static-Serving
src/cli.ts          Einstiegspunkt (serve/snapshot/summary/models)
src/mcp.ts          MCP-Server mit 6 Tools
public/             Dashboard (Vanilla JS, eigenes SVG-Chart, keine CDN-Abhaengigkeit)
```

## Roadmap

- [ ] Management-Key-Modus: `/api/v1/analytics/query` fuer echten Verbrauch pro
      Modell und Tag (dann ohne eigene Historie)
- [ ] Top-Modelle nach Ausgaben im Dashboard
- [ ] Budget-Warnungen (z. B. Benachrichtigung unter 5 EUR)
- [ ] Export der Historie als CSV

## Lizenz

MIT
