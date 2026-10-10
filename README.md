# OpenRouter Stats

Live-Dashboard und MCP-Server für dein OpenRouter-Konto: **Wie viel Guthaben ist noch übrig (€ / $), wie viel verbrauche ich, wie lange reicht es noch – und welches Modell ist für meinen Workload am günstigsten?**

![Node](https://img.shields.io/badge/node-%3E%3D22.5-3ddc97)
![License](https://img.shields.io/badge/license-MIT-4f8cff)

---

## Was es kann

| Feature | Beschreibung |
|---|---|
| **Restguthaben** | Gekaufte minus verbrauchte Credits, in USD **und EUR** (Live-ECB-Kurs) |
| **Verbrauch** | Heute / diese Woche / dieser Monat / insgesamt, plus Key-Limit |
| **Verlauf** | Tagesverbrauch als Balkendiagramm + kumulierte Linie |
| **Burn-Rate & Prognose** | Ø Verbrauch/Tag und „reicht noch X Tage" inkl. Datum |
| **Live-Updates** | Das Dashboard aktualisiert sich selbst per Server-Sent-Events |
| **Modellvergleich** | Kostenrechner: Tokens + Requests eingeben → Ranking aller 450+ Modelle |
| **MCP-Server** | Du kannst das Kontingent direkt im Chat abfragen (Cline, Claude, …) |

---

## Schnellstart

```bash
cd ~/Dokumente/open-router-stats
npm install                       # einmalig

cp .env.example .env              # Key eintragen (siehe unten)
$EDITOR .env

npm start                         # startet das Dashboard
# -> http://127.0.0.1:8787
```

> Voraussetzung: **Node.js ≥ 22.5** (getestet mit Node 24). Es wird kein Build-Schritt
> und keine Datenbank-Installation benötigt – SQLite ist in Node eingebaut.

### API-Key eintragen

In der `.env`:

```ini
OPENROUTER_API_KEY=sk-or-v1-...           # Pflicht
OPENROUTER_MANAGEMENT_KEY=                # optional, siehe unten
```

* Ein **normaler Inferenz-Key** reicht für Guthaben (`/credits`), Limits und Verbrauch (`/key`).
* Ein **[Management-Key](https://openrouter.ai/settings/management-keys)** ist optional und
  schaltet zusätzlich die OpenRouter-Analytics-API frei. Ohne ihn schreibt dieses Tool den
  Verlauf selbst mit – das ist für „wie viel habe ich heute verbraucht" völlig ausreichend.
* Die `.env` ist per `.gitignore` ausgeschlossen und landet **nicht** im Repository.

---

## Befehle

```bash
npm start              # Dashboard + Collector (Standard-Port 8787)
npm run dev            # wie oben, aber mit Auto-Reload bei Codeänderungen
npm run summary        # Textbericht im Terminal (eine Live-Abfrage)
npm run snapshot       # eine Messung in die Datenbank schreiben, JSON ausgeben
npm run models 20      # die 20 günstigsten Modelle auflisten
npm run mcp            # MCP-Server über stdio starten
npm test               # Unit-Tests (Aggregation, Prognose, Preisrechnung)
npm run typecheck      # TypeScript-Prüfung ohne Build
```

---

## Live-Anzeige im Chat (MCP)

Der MCP-Server liefert dieselben Zahlen wie das Dashboard, aber direkt im Chat – z. B.
„Wie viel Guthaben habe ich noch?".

In der MCP-Konfiguration (Cline: `~/.cline/data/settings/cline_mcp_settings.json`,
Claude Desktop: `claude_desktop_config.json`):

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

Der API-Key wird aus der `.env` im Projektordner gelesen – in der MCP-Konfiguration selbst
stehen **keine** Zugangsdaten.

### Verfügbare MCP-Tools

| Tool | Zweck |
|---|---|
| `openrouter_balance` | Restguthaben in EUR/USD, Key-Limit |
| `openrouter_usage` | Verbrauch heute / Woche / Monat / gesamt |
| `openrouter_burn_rate` | Ø pro Tag + Prognose der Reichweite |
| `openrouter_history` | Tagesverbrauch aus der lokalen Historie |
| `openrouter_model_prices` | Modellsuche mit Preisen pro 1M Tokens |
| `openrouter_estimate_cost` | Kosten eines Workloads für ein Modell |

---

## HTTP-API

| Endpunkt | Beschreibung |
|---|---|
| `GET /api/health` | Status, Version, Uptime, Key-Konfiguration |
| `GET /api/summary?days=30` | Komplette Kennzahlen + Verlauf |
| `GET /api/history?days=30` | Nur die Tagesreihe |
| `GET /api/models?q=&limit=` | Modellkatalog mit Preisen |
| `GET /api/compare?promptTokens=&completionTokens=&requests=` | Kostenranking |
| `GET /api/refresh` | Sofort eine neue Messung erzwingen |
| `GET /api/stream` | SSE-Stream (Live-Updates) |

Der Server lauscht standardmäßig nur auf `127.0.0.1` und hat **keine Authentifizierung**.
Er gibt Kontodaten preis – also nicht ohne Reverse-Proxy mit Auth ins Internet stellen.

---

## Wie der Verlauf entsteht

Die OpenRouter-API liefert einem Inferenz-Key nur rollende Summen (`usage_daily`,
`usage_weekly`, …) plus die Gesamtsumme – **keine Historie**. Deshalb schreibt der Collector
bei jedem Poll (Standard: alle 60 s) einen Messpunkt in `data/stats.db` (SQLite, in Node
eingebaut). Der Tagesverbrauch ergibt sich aus zwei aufeinanderfolgenden Messpunkten.

Je länger das Tool läuft, desto genauer wird die Burn-Rate:

1. **Lokale Historie** (ab 3 Tagen mit Verbrauch) – genaueste Quelle
2. sonst `usage_weekly / 7`
3. sonst `usage_monthly / Tag des Monats`
4. sonst `usage_daily`

Alle Tageswerte sind **UTC**, genau wie bei OpenRouter. Alte Messpunkte werden automatisch
ausgedünnt (Behaltefrist = 2 × `HISTORY_DAYS`, mindestens 180 Tage).

---

## Konfiguration (`.env`)

| Variable | Standard | Bedeutung |
|---|---|---|
| `OPENROUTER_API_KEY` | – | Pflicht |
| `OPENROUTER_MANAGEMENT_KEY` | leer | optional, schaltet die Analytics-API frei |
| `HOST` / `PORT` | `127.0.0.1` / `8787` | Bind-Adresse |
| `POLL_SECONDS` | `60` | Abfrageintervall (Minimum 15) |
| `HISTORY_DAYS` | `90` | Angezeigter / behaltener Verlauf |
| `EUR_PER_USD_FALLBACK` | `0.89` | Kurs, falls die FX-API nicht erreichbar ist |
| `FX_REFRESH_HOURS` | `12` | Wechselkurs-Refresh |
| `DB_PATH` | `data/stats.db` | SQLite-Datei |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | für Tests / Proxys |
| `FX_URL` | `https://api.frankfurter.dev/v1/latest` | EZB-Kurse (kein Key nötig) |

---

## Automatisch starten (systemd, ohne root)

```bash
mkdir -p ~/.config/systemd/user
cp systemd/open-router-stats.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now open-router-stats
systemctl --user status open-router-stats     # Status prüfen
journalctl --user -u open-router-stats -f     # Logs live mitlesen
```

Der Dienst hält den Collector am Laufen und schreibt den Verlauf weiter, auch wenn kein
Browser offen ist.

---

## Projektstruktur

```
src/
  config.ts      .env, Pfade, Konstanten
  openrouter.ts  API-Client (/key, /credits, /models, /analytics)
  fx.ts          USD -> EUR (EZB/Frankfurter, gecacht)
  stats.ts       reine Rechenlogik: Tagesreihe, Burn-Rate, Prognose, Preisrechnung
  store.ts       SQLite-Persistenz (Snapshots + Meta)
  summary.ts     baut das Summary-Objekt für API, Dashboard und MCP
  collector.ts   Poll-Schleife, Events, Retention
  server.ts      HTTP-Server: REST, SSE, Static
  models.ts      Modellkatalog + Kostenvergleich
  render.ts      Textausgabe für CLI und MCP
  mcp.ts         MCP-Server (stdio) mit 6 Tools
  cli.ts         Einstiegspunkt (serve / snapshot / summary / models)
public/          Dashboard (HTML/CSS/Vanilla-JS, kein Build, keine CDN-Abhängigkeit)
test/            Unit-Tests für die Rechenlogik
```

---

## Grenzen & Hinweise

* Credits sind bei OpenRouter in **USD** – die EUR-Anzeige ist eine Umrechnung zum
  tagesaktuellen Kurs und keine Abrechnung.
* Ohne Management-Key gibt es keine Aufschlüsselung „Verbrauch pro Modell" direkt von
  OpenRouter. Der Modellvergleich rechnet deshalb mit den **Listenpreisen** und deinem
  eingegebenen Workload, nicht mit deinem tatsächlichen Verbrauch.
* `usage_daily` verwendet UTC-Tage – kurz nach Mitternacht UTC springt der Tageswert zurück.
* `POLL_SECONDS` unter 15 wird ignoriert, um die Rate-Limits zu schonen.

## Lizenz

MIT

