"use strict";

// Clickjacking guard: a page framed by another site stays blank.
if (window.top !== window.self) document.documentElement.hidden = true;

// OpenRouter Dashboard runs entirely in the browser: data comes straight from
// openrouter.ai, history is kept in localStorage. All money values are USD.

const API = "https://openrouter.ai/api/v1";
const STORE_SNAP = "orstats.snapshots";
const STORE_MODELS = "orstats.models";
const STORE_KEY = "orstats.key";
const STORE_LANG = "orstats.lang";
const SNAPSHOT_LIMIT = 20000;
const SNAPSHOT_MAX_AGE_DAYS = 400;
const MODEL_HISTORY_DAYS = 400;
// Upper price bound of the sweet-spot box, USD per 1M tokens.
const PRICE_CAP = 1;

const $ = (id) => document.getElementById(id);

const state = {
  lang: "en",
  days: 30,
  metric: "intelligence",
  apiKey: "",
  credits: null,
  keyInfo: null,
  models: null,
  snapshots: [],
  modelHistory: {},
  activityError: null,
  timer: null,
  // null = fit the data, otherwise an explicit axis range set by zooming.
  view: null,
  autoView: null,
  plot: null,
  scatterArgs: null,
  banner: null,
  live: { on: false, key: null },
  lastUpdate: null,
  chartSig: null,
  modelsSig: null,
};

const LOCALES = { de: "de-DE", en: "en-US" };

const I18N = {
  de: {
    title: "OpenRouter Dashboard",
    "subtitle.nokey": "Kein API-Key hinterlegt.",
    "subtitle.stand": "Stand {time} - Preise in USD",
    live: "live",
    offline: "offline",
    "nokey.status": "kein Key",
    "error.status": "Fehler",
    refresh: "Aktualisieren",
    "refresh.busy": "Lade ...",
    "lang.label": "Sprache",
    "key.label": "OpenRouter API-Key",
    "key.save": "Speichern",
    "key.clear": "Entfernen",
    "key.remember": "dauerhaft merken",
    "key.note.session": "Der Key gilt nur fuer diese Browser-Sitzung. Nach dem Schliessen musst du ihn neu eintragen.",
    "key.note.persist": "Der Key bleibt in diesem Browser gespeichert (Klartext, siehe README).",
    "key.removed": "Key entfernt.",
    "tab.overview": "Guthaben",
    "tab.compare": "Modellvergleich",
    "today.label": "Heute verbraucht",
    "today.sub": "seit 00:00 UTC",
    "today.new": "neu",
    "today.tip": "Vergleich mit gestern zur gleichen UTC-Uhrzeit",
    "today.vs": "{arrow} {pct} % vs. gestern",
    "today.foot": "gestern {yesterday} · Woche {week}",
    "runway.label": "Reicht noch",
    "runway.hint": "Spanne: langsam (Ø Monat) bis schnell (Ø Woche / letzte 3 Tage)",
    "runway.between": "leer zwischen {a} und {b}",
    "runway.from": "ab {n}",
    "runway.never": "nie",
    "runway.used": "Guthaben aufgebraucht",
    "runway.noburn": "kein messbarer Verbrauch",
    "unit.days": "Tage",
    "unit.unlimited": "unbegrenzt",
    "unit.empty": "leer",
    "balance.label": "Restguthaben",
    "balance.bought": "von {total} gekauft",
    "balance.used": "{pct} aufgebraucht",
    "used.label": "Verbraucht gesamt",
    "burn.label": "Ø pro Tag",
    "burn.perday": "{amount}/Tag",
    "burn.basis": "Basis: {source}",
    "src.history": "lokale Historie ({n} Tage)",
    "src.week": "Wochenverbrauch",
    "src.month": "Monatsverbrauch",
    "src.today": "Tagesverbrauch",
    "month.label": "Diesen Monat",
    "month.source": "laut OpenRouter",
    "models.title": "Verbrauch nach Modell",
    "models.last30": "letzte 30 Tage",
    "models.total": "{amount} in den letzten 30 Tagen - {n} Modelle",
    "models.nokey": "braucht einen API-Key",
    "models.mgmt": "braucht einen Management-Key",
    "models.hint.nokey": "Key hinterlegen, dann erscheint hier der Verbrauch pro Modell.",
    "models.hint.mgmt":
      "Der Verbrauch pro Modell kommt vom Activity-Endpoint. Der braucht einen Management-Key (openrouter.ai/settings/management-keys) statt eines normalen Inferenz-Keys.",
    "models.empty": "Noch keine Modelldaten. Sie kommen beim nächsten Abruf.",
    "models.more": "{n} weitere",
    "key.card": "Key",
    "key.unnamed": "unbenannter Key",
    "key.named": "Key {label}",
    "badge.mgmt": "Management-Key",
    "badge.inference": "Inferenz-Key",
    "limit.none": "kein Limit",
    "limit.nolimit": "Dieser Key hat kein Ausgabenlimit",
    "limit.of": "von {amount}{reset}",
    "kv.today": "Heute",
    "kv.week": "Woche",
    "kv.month": "Monat",
    "kv.total": "Gesamt",
    "chart.label": "Tagesverbrauch",
    "chart.sum": "{amount} in {n} Tagen",
    "chart.bar": "Verbrauch pro Tag",
    "chart.line": "kumuliert",
    "chart.note": "Der Verlauf entsteht in diesem Browser: bei jedem Aufruf wird ein Messpunkt gespeichert. Er wächst also mit der Zeit.",
    "chart.empty": "Noch keine Daten.",
    "details.label": "Details",
    "details.points": "Messpunkte",
    "details.since": "Verlauf seit",
    "details.last": "Letzte Abfrage",
    "details.currency": "Alle Preise in",
    "details.currency.value": "USD ($)",
    "cmp.label": "Intelligenz vs. Preis",
    "cmp.loading": "Lade Modelldaten ...",
    "cmp.none": "Keine Modelldaten geladen.",
    "cmp.nodata": "Keine Daten.",
    "cmp.sub": "{n} Modelle mit {metric}-Score - Preis pro 1M Tokens, gemischt 3:1 (Input:Output)",
    "cmp.reset": "Zoom zurücksetzen",
    "cmp.hint": "Scrollen zoomt auf den Mauszeiger, ziehen verschiebt, Doppelklick setzt zurück.",
    "metric.intelligence": "Intelligenz",
    "metric.coding": "Coding",
    "metric.agentic": "Agentic",
    "scatter.free": "kostenlos",
    "scatter.xtitle": "Preis pro 1M Tokens, USD (log) – gemischt 3:1 in:out",
    "scatter.sweet": "SWEET SPOT",
    "scatter.sweet.sub": "beste Preis/Leistung",
    "scatter.sweet.cap": "bis {price} / 1M Tokens",
    "legend.sweet": "Sweet Spot – beste Preis/Leistung",
    "tip.blended": "Gemischt 3:1",
    "tip.context": "Kontext",
    "chip.title": "{name} - {metric} {score} - {price} pro 1M Tokens",
    "banner.nokey": "Kein API-Key hinterlegt - Guthaben und Verbrauch bleiben leer. Der Modellvergleich funktioniert auch ohne.",
    "banner.fail": "Abfrage fehlgeschlagen: {msg}.{hint}",
    "hint.401": " Der Key wurde von OpenRouter abgelehnt.",
    "hint.403": " Dieser Endpunkt braucht evtl. einen Management-Key.",
    footer:
      "Daten direkt von openrouter.ai. Preise pro 1M Tokens in USD, gemischt 3:1 (Input:Output). Benchmark-Scores von Artificial Analysis. Batch-Varianten sind ausgeblendet.",
  },
  en: {
    title: "OpenRouter Dashboard",
    "subtitle.nokey": "No API key set.",
    "subtitle.stand": "As of {time} - prices in USD",
    live: "live",
    offline: "offline",
    "nokey.status": "no key",
    "error.status": "Error",
    refresh: "Refresh",
    "refresh.busy": "Loading ...",
    "lang.label": "Language",
    "key.label": "OpenRouter API key",
    "key.save": "Save",
    "key.clear": "Remove",
    "key.remember": "remember on this device",
    "key.note.session": "The key is kept for this browser session only. You will need to enter it again after closing the tab.",
    "key.note.persist": "The key stays saved in this browser (plain text, see README).",
    "key.removed": "Key removed.",
    "tab.overview": "Balance",
    "tab.compare": "Model comparison",
    "today.label": "Spent today",
    "today.sub": "since 00:00 UTC",
    "today.new": "new",
    "today.tip": "Compared with yesterday at the same UTC time",
    "today.vs": "{arrow} {pct} % vs. yesterday",
    "today.foot": "yesterday {yesterday} · week {week}",
    "runway.label": "Runway",
    "runway.hint": "Range: slow (Ø per month) to fast (Ø per week / last 3 days)",
    "runway.between": "empty between {a} and {b}",
    "runway.from": "from {n}",
    "runway.never": "never",
    "runway.used": "Balance used up",
    "runway.noburn": "no measurable spend",
    "unit.days": "days",
    "unit.unlimited": "unlimited",
    "unit.empty": "empty",
    "balance.label": "Balance left",
    "balance.bought": "of {total} purchased",
    "balance.used": "{pct} used",
    "used.label": "Spent total",
    "burn.label": "Ø per day",
    "burn.perday": "{amount}/day",
    "burn.basis": "Based on: {source}",
    "src.history": "local history ({n} days)",
    "src.week": "weekly spend",
    "src.month": "monthly spend",
    "src.today": "today's spend",
    "month.label": "This month",
    "month.source": "per OpenRouter",
    "models.title": "Spend by model",
    "models.last30": "last 30 days",
    "models.total": "{amount} in the last 30 days - {n} models",
    "models.nokey": "needs an API key",
    "models.mgmt": "needs a management key",
    "models.hint.nokey": "Add a key and the spend per model will appear here.",
    "models.hint.mgmt":
      "Spend per model comes from the activity endpoint. It needs a management key (openrouter.ai/settings/management-keys), not a regular inference key.",
    "models.empty": "No model data yet. It arrives with the next refresh.",
    "models.more": "{n} more",
    "key.card": "Key",
    "key.unnamed": "unnamed key",
    "key.named": "Key {label}",
    "badge.mgmt": "Management key",
    "badge.inference": "Inference key",
    "limit.none": "no limit",
    "limit.nolimit": "This key has no spending limit",
    "limit.of": "of {amount}{reset}",
    "kv.today": "Today",
    "kv.week": "Week",
    "kv.month": "Month",
    "kv.total": "Total",
    "chart.label": "Daily spend",
    "chart.sum": "{amount} over {n} days",
    "chart.bar": "Spend per day",
    "chart.line": "cumulative",
    "chart.note": "The history builds up in this browser: every refresh stores a data point, so it grows over time.",
    "chart.empty": "No data yet.",
    "details.label": "Details",
    "details.points": "Data points",
    "details.since": "History since",
    "details.last": "Last fetch",
    "details.currency": "All prices in",
    "details.currency.value": "USD ($)",
    "cmp.label": "Intelligence vs. price",
    "cmp.loading": "Loading model data ...",
    "cmp.none": "No model data loaded.",
    "cmp.nodata": "No data.",
    "cmp.sub": "{n} models with a {metric} score - price per 1M tokens, blended 3:1 (input:output)",
    "cmp.reset": "Reset zoom",
    "cmp.hint": "Scroll to zoom at the cursor, drag to pan, double-click to reset.",
    "metric.intelligence": "Intelligence",
    "metric.coding": "Coding",
    "metric.agentic": "Agentic",
    "scatter.free": "free",
    "scatter.xtitle": "Price per 1M tokens, USD (log) – blended 3:1 in:out",
    "scatter.sweet": "SWEET SPOT",
    "scatter.sweet.sub": "best value",
    "scatter.sweet.cap": "up to {price} / 1M tokens",
    "legend.sweet": "Sweet spot – best value",
    "tip.blended": "Blended 3:1",
    "tip.context": "Context",
    "chip.title": "{name} - {metric} {score} - {price} per 1M tokens",
    "banner.nokey": "No API key set - balance and spend stay empty. The model comparison works without one.",
    "banner.fail": "Request failed: {msg}.{hint}",
    "hint.401": " OpenRouter rejected the key.",
    "hint.403": " This endpoint may need a management key.",
    footer:
      "Data straight from openrouter.ai. Prices per 1M tokens in USD, blended 3:1 (input:output). Benchmark scores from Artificial Analysis. Batch variants are hidden.",
  },
};

/** Translates a key and fills {placeholders}. Falls back to English, then to the key. */
function t(key, vars = {}) {
  const text = I18N[state.lang]?.[key] ?? I18N.en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => (name in vars ? String(vars[name]) : `{${name}}`));
}
function locale() {
  return LOCALES[state.lang] ?? LOCALES.en;
}

/** Applies the current language to every element marked with data-i18n. */
function applyStaticText() {
  document.documentElement.lang = state.lang;
  document.title = t("title");
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  $("lang-select").value = state.lang;
}

function detectLanguage() {
  try {
    const saved = localStorage.getItem(STORE_LANG);
    if (saved === "de" || saved === "en") return saved;
  } catch {
    /* storage blocked - fall through to the browser language */
  }
  return (navigator.language || "en").toLowerCase().startsWith("de") ? "de" : "en";
}

function setLanguage(lang) {
  state.lang = lang;
  try {
    localStorage.setItem(STORE_LANG, lang);
  } catch {
    /* not persisted - fine for this visit */
  }
  applyStaticText();
  renderAll();
}

function nf(value, digits) {
  return (Number.isFinite(value) ? value : 0).toLocaleString(locale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
function usd(value, digits) {
  const d = digits ?? (Math.abs(value) < 1 ? 4 : 2);
  return `$${nf(value, d)}`;
}
function pct(value) {
  return `${nf(value, 1)} %`;
}
/** Prices span eight orders of magnitude, so the precision follows the value. */
function priceLabel(value) {
  if (!(value > 0)) return t("scatter.free");
  if (value >= 1) return usd(value, 2);
  if (value >= 0.01) return usd(value, 3);
  return usd(value, 4);
}
function tokens(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value || 0));
}
function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}
/** Escapes text that goes into innerHTML. Model names come from the API. */
function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}
function dayLabel(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
function dateTime(ms) {
  if (!ms) return "-";
  return new Date(ms).toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function showBanner(key, vars = {}, isError = false) {
  state.banner = key ? { key, vars, isError } : null;
  renderBanner();
}
function renderBanner() {
  const el = $("banner");
  const banner = state.banner;
  if (!banner) {
    el.hidden = true;
    return;
  }
  // Hint keys are resolved here so they follow the language switch too.
  const vars = { ...banner.vars };
  if (vars.hintKey) vars.hint = t(vars.hintKey);
  el.textContent = t(banner.key, vars);
  el.className = banner.isError ? "banner error" : "banner";
  el.hidden = false;
}

// Snapshots and model history use localStorage; if it is blocked, keep them in memory.
const memoryStore = new Map();
function readStore(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
  } catch {
    return memoryStore.has(key) ? memoryStore.get(key) : fallback;
  }
}
function writeStore(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    memoryStore.set(key, value);
  }
}

/**
 * The API key lives in sessionStorage (gone when the tab closes). Only with
 * "remember on this device" it is also written to localStorage.
 */
function safeStore(name) {
  try {
    const store = globalThis[name];
    store.setItem("__probe__", "1");
    store.removeItem("__probe__");
    return store;
  } catch {
    return null;
  }
}
const SESSION = safeStore("sessionStorage");
const LOCAL = safeStore("localStorage");

function loadKey() {
  for (const store of [SESSION, LOCAL]) {
    try {
      const value = store?.getItem(STORE_KEY);
      if (value) return value;
    } catch {
      /* unreadable store - try the next one */
    }
  }
  return "";
}
function keyIsPersisted() {
  try {
    return Boolean(LOCAL?.getItem(STORE_KEY));
  } catch {
    return false;
  }
}
function saveKey(value, persist) {
  const put = (store, on) => {
    try {
      if (!store) return;
      if (on && value) store.setItem(STORE_KEY, value);
      else store.removeItem(STORE_KEY);
    } catch {
      /* storage full or blocked - the key lives in memory for this page */
    }
  };
  put(SESSION, true);
  put(LOCAL, persist);
}

function loadSnapshots() {
  try {
    const raw = JSON.parse(readStore(STORE_SNAP, "[]"));
    return Array.isArray(raw) ? raw.filter((s) => Number.isFinite(s?.t) && Number.isFinite(s?.usage)) : [];
  } catch {
    return [];
  }
}
function saveSnapshots(list) {
  const cutoff = Date.now() - SNAPSHOT_MAX_AGE_DAYS * 86400000;
  const pruned = list.filter((s) => s.t >= cutoff).slice(-SNAPSHOT_LIMIT);
  writeStore(STORE_SNAP, JSON.stringify(pruned));
  return pruned;
}
function recordSnapshot(usage) {
  const list = state.snapshots;
  const last = list[list.length - 1];
  // One point per minute is plenty; the usage figure only moves on spend.
  if (last && Date.now() - last.t < 60000 && last.usage === usage) return;
  list.push({ t: Date.now(), usage });
  state.snapshots = saveSnapshots(list);
}

/**
 * Daily spend from the snapshot log: each day's spend is the difference between
 * that day's last known total usage and the previous day's.
 */
function dailySeries(currentUsage, days) {
  const lastOfDay = new Map();
  for (const snap of state.snapshots) {
    const day = utcDay(snap.t);
    const seen = lastOfDay.get(day);
    if (!seen || snap.t > seen.t) lastOfDay.set(day, snap);
  }
  if (Number.isFinite(currentUsage)) {
    lastOfDay.set(utcDay(Date.now()), { t: Date.now(), usage: currentUsage });
  }

  const knownDays = [...lastOfDay.keys()].sort();
  const spendByDay = new Map();
  knownDays.forEach((day, index) => {
    const current = lastOfDay.get(day).usage;
    const previous = index > 0 ? lastOfDay.get(knownDays[index - 1]).usage : current;
    spendByDay.set(day, Math.max(0, current - previous));
  });

  const out = [];
  let cumulative = 0;
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = utcDay(Date.now() - i * 86400000);
    const spend = spendByDay.get(day) ?? 0;
    cumulative += spend;
    out.push({ date: day, spend, cumulative });
  }
  return out;
}

function loadModelHistory() {
  try {
    const raw = JSON.parse(readStore(STORE_MODELS, "{}"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/**
 * Activity rows are per day and per model endpoint. Days returned by the API
 * replace what is stored for that day; older days stay, so the history grows
 * beyond the 30 days the API itself returns.
 */
function mergeActivity(rows) {
  const byDay = {};
  for (const row of rows) {
    const day = String(row?.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const model = String(row.model ?? row.model_permaslug ?? "unknown");
    const spend = Number(row.usage) || 0;
    byDay[day] ??= {};
    byDay[day][model] = (byDay[day][model] ?? 0) + spend;
  }
  const cutoff = utcDay(Date.now() - MODEL_HISTORY_DAYS * 86400000);
  const store = { ...loadModelHistory(), ...byDay };
  for (const day of Object.keys(store)) if (day < cutoff) delete store[day];
  writeStore(STORE_MODELS, JSON.stringify(store));
  state.modelHistory = store;
}

async function apiGet(path, withKey) {
  const headers = { Accept: "application/json", "X-Title": "openrouter-dashboard" };
  if (withKey) {
    if (!state.apiKey) throw new Error(t("err.nokey"));
    headers.Authorization = `Bearer ${state.apiKey}`;
  }
  const response = await fetch(`${API}${path}`, { headers });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = body?.error?.message || body?.error || response.statusText || `HTTP ${response.status}`;
    const error = new Error(String(message));
    error.status = response.status;
    throw error;
  }
  return body;
}

function parsePrice(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** Runs a DOM update inside a View Transition where the browser supports it. */
function withTransition(update) {
  if (!document.startViewTransition || reduceMotion) {
    update();
    return;
  }
  document.startViewTransition(update);
}

function flash(el) {
  el.classList.remove("flash");
  void el.offsetWidth;
  el.classList.add("flash");
}

/** Counts a number up (or down) to its new value. An unchanged value stays still. */
function animateValue(id, to, format) {
  const el = $(id);
  if (!el) return;
  const hadValue = Number.isFinite(el._num);
  const from = hadValue ? el._num : 0;
  el._num = to;
  cancelAnimationFrame(el._raf);
  // Glow only on a real change at a later refresh, not on the first load.
  if (hadValue && from !== to) flash(el);
  if (from === to || reduceMotion) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / 900);
    const eased = 1 - (1 - progress) ** 3;
    el.textContent = format(from + (to - from) * eased);
    if (progress < 1) el._raf = requestAnimationFrame(tick);
  };
  el._raf = requestAnimationFrame(tick);
}

/** Sets a fixed text without counting. */
function setStatic(id, text) {
  const el = $(id);
  if (!el) return;
  cancelAnimationFrame(el._raf);
  el._num = undefined;
  el.textContent = text;
}

/** The ring shows the share of the purchased balance that is left (0-100). */
function setRing(percent) {
  const ring = $("ring-fg");
  if (ring) ring.style.strokeDashoffset = String(100 - Math.max(0, Math.min(100, percent)));
}

/**
 * Today against yesterday, fairly: yesterday is scaled to the same UTC time of
 * day, otherwise the comparison in the morning would always look like -80 %.
 */
function renderDelta(today, yesterday) {
  const el = $("today-delta");
  const dayFraction = (Date.now() % 86400000) / 86400000;
  const expected = yesterday * dayFraction;
  el.title = t("today.tip");
  if (expected <= 0) {
    el.textContent = t("today.new");
    el.className = "delta";
    return;
  }
  const change = ((today - expected) / expected) * 100;
  el.textContent = t("today.vs", { arrow: change >= 0 ? "▲" : "▼", pct: nf(Math.abs(change), 0) });
  el.className = `delta ${change > 5 ? "up" : change < -5 ? "down" : ""}`.trim();
}

/** Small area chart of the last days; the line draws itself in. */
function renderSpark(points) {
  const host = $("spark");
  if (!points.length || points.every((p) => p.spend === 0)) {
    host.innerHTML = "";
    return;
  }
  const w = 300;
  const h = 56;
  const max = Math.max(...points.map((p) => p.spend));
  const step = w / Math.max(1, points.length - 1);
  const xy = points.map((p, i) => [i * step, h - 6 - (p.spend / max) * (h - 14)]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;
  host.innerHTML =
    `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark-svg" aria-hidden="true">` +
    '<defs><linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1"><stop class="spark-a" offset="0%"/><stop class="spark-b" offset="100%"/></linearGradient></defs>' +
    `<path class="spark-area" d="${area}"/>` +
    `<path class="spark-line" pathLength="1" d="${line}"/></svg>`;
}

function renderOverview() {
  const credits = state.credits;
  const info = state.keyInfo;

  if (!credits) {
    ["remaining", "used-total", "today", "burn", "month"].forEach((id) => setStatic(id, "-"));
    setStatic("days-left", "-");
    setRing(0);
    renderSpark([]);
    return;
  }

  const total = credits.total_credits;
  const remaining = Math.max(0, total - credits.total_usage);
  const usedPercent = total > 0 ? Math.min(100, (credits.total_usage / total) * 100) : 0;
  const remainingPercent = total > 0 ? (remaining / total) * 100 : 0;

  animateValue("remaining", remaining, (v) => usd(v));
  setText("remaining-sub", t("balance.bought", { total: usd(total) }));
  $("balance-bar").style.width = `${usedPercent}%`;
  setText("balance-foot", t("balance.used", { pct: pct(usedPercent) }));
  setRing(remainingPercent);

  animateValue("used-total", credits.total_usage, (v) => usd(v));
  setText("used-sub", t("balance.bought", { total: usd(total) }));

  const daily = Number(info?.usage_daily) || 0;
  const weekly = Number(info?.usage_weekly) || 0;
  const monthly = Number(info?.usage_monthly) || 0;
  animateValue("today", daily, (v) => usd(v));
  animateValue("month", monthly, (v) => usd(v));

  const series = dailySeries(credits.total_usage, state.days);
  const week = dailySeries(credits.total_usage, 14);
  const yesterday = week.length > 1 ? week[week.length - 2].spend : 0;
  renderDelta(daily, yesterday);
  setText("today-foot", t("today.foot", { yesterday: usd(yesterday), week: usd(weekly) }));
  renderSpark(week);

  // Burn rate: prefer the local history once it covers a few days with spend.
  const active = series.filter((point) => point.spend > 0);
  let burnPerDay;
  let source;
  if (active.length >= 3) {
    burnPerDay = active.reduce((sum, point) => sum + point.spend, 0) / active.length;
    source = t("src.history", { n: active.length });
  } else if (weekly > 0) {
    burnPerDay = weekly / 7;
    source = t("src.week");
  } else if (monthly > 0) {
    burnPerDay = monthly / 30;
    source = t("src.month");
  } else {
    burnPerDay = daily;
    source = t("src.today");
  }
  animateValue("burn", burnPerDay, (v) => t("burn.perday", { amount: usd(v) }));
  setText("burn-sub", t("burn.basis", { source }));

  // Runway as a range. Slow = Ø per month, fast = the higher of Ø per week and
  // the last three days. Two honest ends instead of one guess.
  const last3Avg = series.slice(-3).reduce((sum, point) => sum + point.spend, 0) / 3;
  const slowBurn = monthly > 0 ? monthly / 30 : burnPerDay;
  const fastBurn = Math.max(weekly / 7, last3Avg, slowBurn);
  if (remaining > 0 && fastBurn > 0) {
    const fastDays = remaining / fastBurn;
    const slowDays = slowBurn > 0 ? remaining / slowBurn : Infinity;
    const endDate = (days) =>
      Number.isFinite(days) ? new Date(Date.now() + days * 86400000).toLocaleDateString(locale()) : t("runway.never");
    const similar = Number.isFinite(slowDays) && (slowDays - fastDays) / fastDays < 0.05;
    const label = !Number.isFinite(slowDays)
      ? t("runway.from", { n: nf(fastDays, 0) })
      : similar
        ? nf(fastDays, 0)
        : `${nf(fastDays, 0)}–${nf(slowDays, 0)}`;
    setStatic("days-left", label);
    setText("days-unit", t("unit.days"));
    setText("runs-out", t("runway.between", { a: endDate(fastDays), b: endDate(slowDays) }));
  } else {
    setStatic("days-left", remaining > 0 ? "∞" : "0");
    setText("days-unit", remaining > 0 ? t("unit.unlimited") : t("unit.empty"));
    setText("runs-out", burnPerDay > 0 ? t("runway.used") : t("runway.noburn"));
  }

  setText("key-label", info?.label ? t("key.named", { label: info.label }) : t("key.unnamed"));
  const badge = $("key-badge");
  const isMgmt = Boolean(info?.is_management_key);
  badge.textContent = isMgmt ? t("badge.mgmt") : t("badge.inference");
  badge.className = `badge ${isMgmt ? "ok" : ""}`;

  if (info && info.limit !== null && info.limit !== undefined) {
    const left = Number(info.limit_remaining) || 0;
    animateValue("limit-remaining", left, (v) => usd(v));
    const reset = info.limit_reset ? ` (${info.limit_reset})` : "";
    setText("limit-sub", t("limit.of", { amount: usd(Number(info.limit)), reset }));
  } else {
    setStatic("limit-remaining", t("limit.none"));
    setText("limit-sub", t("limit.nolimit"));
  }

  setText("k-today", usd(daily));
  setText("k-week", usd(weekly));
  setText("k-month", usd(monthly));
  setText("k-total", usd(Number(info?.usage) || 0));

  setText("m-snapshots", String(state.snapshots.length));
  setText("m-since", dateTime(state.snapshots[0]?.t));
  setText("m-lastpoll", dateTime(state.lastUpdate));

  const spent = series.reduce((sum, point) => sum + point.spend, 0);
  setText("chart-sub", t("chart.sum", { amount: usd(spent), n: state.days }));
  renderChart(series);
}

function renderChart(points) {
  const host = $("chart");
  if (!points.length) {
    host.innerHTML = `<p class="muted small">${esc(t("chart.empty"))}</p>`;
    return;
  }
  // Animate only when the data changed; the page refreshes every minute.
  const sig = points.map((p) => `${p.spend.toFixed(5)}|${p.cumulative.toFixed(5)}`).join(",");
  host.classList.toggle("no-anim", sig === state.chartSig);
  state.chartSig = sig;

  const width = Math.max(host.clientWidth || 640, 340);
  const height = 225;
  const pad = { top: 16, right: 58, bottom: 28, left: 52 };
  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;
  const maxSpend = Math.max(...points.map((p) => p.spend), 0.000001);
  const maxCum = Math.max(...points.map((p) => p.cumulative), 0.000001);
  const step = iw / points.length;
  const barW = Math.max(3, Math.min(step * 0.6, 26));
  const baseY = pad.top + ih;

  const coords = points.map((point, index) => ({
    x: pad.left + index * step + step / 2,
    y: pad.top + ih - (point.cumulative / maxCum) * ih,
  }));
  const linePath = coords.map((c, i) => `${i ? "L" : "M"}${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(" ");
  const first = coords[0];
  const last = coords[coords.length - 1];
  const areaPath = `${linePath} L${last.x.toFixed(1)} ${baseY} L${first.x.toFixed(1)} ${baseY} Z`;

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">`);
  parts.push(
    "<defs>" +
      '<linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1"><stop class="bar-grad-a" offset="0%"/><stop class="bar-grad-b" offset="100%"/></linearGradient>' +
      '<linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop class="area-a" offset="0%"/><stop class="area-b" offset="100%"/></linearGradient>' +
      "</defs>",
  );

  const ticks = 4;
  for (let i = 0; i <= ticks; i += 1) {
    const y = pad.top + (ih / ticks) * i;
    parts.push(`<line class="grid" x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + iw}" y2="${y.toFixed(1)}"/>`);
    parts.push(
      `<text class="axis" x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${usd(maxSpend * (1 - i / ticks), 2)}</text>`,
    );
    parts.push(
      `<text class="axis axis-right" x="${pad.left + iw + 8}" y="${(y + 4).toFixed(1)}">${usd(maxCum * (1 - i / ticks), 2)}</text>`,
    );
  }

  // Bars grow one after another; the delay is per column.
  points.forEach((point, index) => {
    const h = (point.spend / maxSpend) * ih;
    const x = pad.left + index * step + (step - barW) / 2;
    const visible = point.spend > 0 ? Math.max(h, 2) : 0;
    parts.push(
      `<rect class="col" style="animation-delay:${index * 22}ms" x="${x.toFixed(1)}" y="${(baseY - visible).toFixed(1)}" ` +
        `width="${barW.toFixed(1)}" height="${visible.toFixed(1)}" rx="3"><title>${point.date}: ${usd(point.spend)}</title></rect>`,
    );
  });

  parts.push(`<path class="area" d="${areaPath}"/>`);
  parts.push(`<path class="line" pathLength="1" d="${linePath}"/>`);
  parts.push(`<circle class="end-ping" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="6"/>`);
  parts.push(`<circle class="end-dot" cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="3"/>`);

  // X labels: every n-th day, but never the one right before the last label.
  const every = Math.max(1, Math.ceil(points.length / 9));
  points.forEach((point, index) => {
    const isLast = index === points.length - 1;
    if (index % every !== 0 && !isLast) return;
    if (!isLast && points.length - 1 - index < every * 0.6) return;
    const x = pad.left + index * step + step / 2;
    parts.push(
      `<text class="axis" x="${x.toFixed(1)}" y="${height - 8}" text-anchor="middle">${dayLabel(point.date)}</text>`,
    );
  });

  parts.push("</svg>");
  host.innerHTML = parts.join("");
}

/** Top models of the last 30 days from the local history; the rest is summed up. */
function renderModels() {
  const host = $("models");
  if (!state.apiKey) {
    setText("models-sub", t("models.nokey"));
    host.innerHTML = `<p class="muted small">${esc(t("models.hint.nokey"))}</p>`;
    return;
  }
  if (state.activityError === "needs-management") {
    setText("models-sub", t("models.mgmt"));
    host.innerHTML = `<p class="muted small">${esc(t("models.hint.mgmt"))}</p>`;
    return;
  }

  const cutoff = utcDay(Date.now() - 29 * 86400000);
  const totals = new Map();
  for (const [day, models] of Object.entries(state.modelHistory)) {
    if (day < cutoff) continue;
    for (const [model, spend] of Object.entries(models)) {
      totals.set(model, (totals.get(model) ?? 0) + spend);
    }
  }
  const rows = [...totals].filter(([, spend]) => spend > 0).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) {
    setText("models-sub", t("models.last30"));
    host.innerHTML = `<p class="muted small">${esc(t("models.empty"))}</p>`;
    return;
  }

  const sum = rows.reduce((acc, [, spend]) => acc + spend, 0);
  const items = rows.slice(0, 8).map(([model, spend]) => ({
    label: model.split("/").pop(),
    spend,
    color: providerColor(model.split("/")[0]),
  }));
  const restSpend = rows.slice(8).reduce((acc, [, spend]) => acc + spend, 0);
  if (restSpend > 0) {
    items.push({ label: t("models.more", { n: rows.length - 8 }), spend: restSpend, color: "#5b6078" });
  }

  const max = items[0].spend;
  const signature = items.map((item) => `${item.label}:${item.spend.toFixed(4)}`).join("|");
  host.classList.toggle("no-anim", signature === state.modelsSig);
  state.modelsSig = signature;

  host.innerHTML = items
    .map(
      (item, i) =>
        `<div class="model-row" style="animation-delay:${i * 60}ms">` +
        `<div class="model-name"><span>${esc(item.label)} <em>${nf((item.spend / sum) * 100, 0)} %</em></span><b>${usd(item.spend)}</b></div>` +
        `<div class="model-bar"><span style="width:${((item.spend / max) * 100).toFixed(1)}%;background:${esc(item.color)}"></span></div>` +
        "</div>",
    )
    .join("");
  setText("models-sub", t("models.total", { amount: usd(sum), n: rows.length }));
}

/** Fetches the per-model activity. A regular key gets a 403, shown as a hint. */
async function loadActivity() {
  try {
    const body = await apiGet("/activity", true);
    mergeActivity(Array.isArray(body?.data) ? body.data : []);
    state.activityError = null;
  } catch (error) {
    state.activityError = error.status === 403 || error.status === 401 ? "needs-management" : error.message;
  }
}

const METRIC_KEYS = { intelligence: "metric.intelligence", coding: "metric.coding", agentic: "metric.agentic" };

const PROVIDER_COLORS = {
  anthropic: "#e8a17c",
  openai: "#58c39a",
  google: "#6fb0e8",
  "meta-llama": "#9b8ce0",
  deepseek: "#e884b4",
  qwen: "#e0b84f",
  mistralai: "#f0946a",
  "x-ai": "#93a6bb",
  cohere: "#55c2b8",
  amazon: "#b596e8",
  microsoft: "#7fa6e8",
  nvidia: "#9cc653",
  moonshotai: "#e88787",
  "z-ai": "#55bdd6",
  minimax: "#bd8ce0",
  allenai: "#d6bd47",
  inclusionai: "#55c29e",
  "dots-studio": "#a8cf6a",
};

function providerColor(provider) {
  if (PROVIDER_COLORS[provider]) return PROVIDER_COLORS[provider];
  let hash = 0;
  for (const char of provider) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return `hsl(${hash} 46% 68%)`;
}
function prettyProvider(provider) {
  return provider.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
function shortModelName(name) {
  return name
    .replace(/^[^:]+:\s*/, "")
    .replace(/\s*\((free|beta|preview|alpha|experimental)\)\s*$/i, "")
    .trim();
}
function usdAxis(value) {
  if (value >= 100) return `$${Math.round(value)}`;
  if (value >= 10) return `$${value.toFixed(0)}`;
  if (value >= 1) return `$${value.toFixed(1)}`;
  if (value >= 0.1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  if (value >= 0.001) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(5)}`;
}
function metricLabel() {
  return t(METRIC_KEYS[state.metric]);
}

/** Rows from the catalogue with the blended 3:1 price per 1M tokens. */
function buildRows() {
  const metric = state.metric;
  return (state.models || [])
    .filter((model) => !model.id.includes(":batch"))
    .map((model) => {
      const aa = model.benchmarks?.artificial_analysis;
      const inPrice = parsePrice(model.pricing?.prompt) * 1_000_000;
      const outPrice = parsePrice(model.pricing?.completion) * 1_000_000;
      return {
        id: model.id,
        name: model.name,
        provider: model.id.split("/")[0] ?? "other",
        contextLength: model.context_length ?? 0,
        inPrice,
        outPrice,
        price: (3 * inPrice + outPrice) / 4,
        intelligence: aa?.intelligence_index ?? null,
        coding: aa?.coding_index ?? null,
        agentic: aa?.agentic_index ?? null,
      };
    })
    .filter((row) => Number.isFinite(row[metric]));
}

function paretoFrontier(rows) {
  const sorted = [...rows].sort((a, b) => a.price - b.price || b[state.metric] - a[state.metric]);
  const frontier = [];
  let best = -Infinity;
  for (const row of sorted) {
    const value = row[state.metric];
    if (value > best) {
      frontier.push(row);
      best = value;
    }
  }
  return frontier;
}

/**
 * The single best pick inside the sweet-spot box: the highest scoring model under
 * the price cap. Free models are excluded: they top any value ranking on paper,
 * but the free tier is rate limited, so they are not a real answer.
 */
function sweetSpot(frontier) {
  const inRange = frontier.filter((row) => row.price > 0 && row.price <= PRICE_CAP);
  if (inRange.length === 0) return null;
  return inRange.reduce((best, row) => (row[state.metric] > best[state.metric] ? row : best));
}

function renderCompare() {
  const rows = buildRows();
  const metric = state.metric;
  const label = metricLabel();

  if (rows.length === 0) {
    setText("compare-sub", t("cmp.none"));
    $("scatter").innerHTML = `<p class="muted small">${esc(t("cmp.nodata"))}</p>`;
    return;
  }

  const frontier = paretoFrontier(rows);
  const spot = sweetSpot(frontier);

  // Frontier as a compact chip strip, prices up front.
  const strip = $("frontier-strip");
  strip.textContent = "";
  [...frontier].reverse().forEach((row) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    if (spot && row.id === spot.id) chip.classList.add("is-sweet");
    const name = document.createElement("b");
    name.textContent = shortModelName(row.name);
    const score = document.createElement("em");
    score.textContent = nf(row[metric], 1);
    const price = document.createElement("i");
    price.textContent = priceLabel(row.price);
    chip.append(name, score, price);
    chip.title = t("chip.title", { name: row.name, metric: label, score: nf(row[metric], 1), price: priceLabel(row.price) });
    strip.append(chip);
  });

  setText("compare-sub", t("cmp.sub", { n: rows.length, metric: label }));

  state.scatterArgs = { rows, frontier, spot };
  renderScatter(rows, frontier, spot);
  renderLegend(rows);
  updateZoomControls();
}

function redrawScatter() {
  if (!state.scatterArgs) return;
  const { rows, frontier, spot } = state.scatterArgs;
  renderScatter(rows, frontier, spot);
  updateZoomControls();
}

function updateZoomControls() {
  const button = $("zoom-reset");
  if (button) button.hidden = !state.view;
}

function resetZoom() {
  state.view = null;
  redrawScatter();
}

/** Pointer position in SVG user units, independent of how the SVG is scaled. */
function toSvgPoint(event, geo) {
  const rect = $("scatter").getBoundingClientRect();
  const k = rect.width ? geo.width / rect.width : 1;
  return { x: (event.clientX - rect.left) * k, y: (event.clientY - rect.top) * k };
}

function insidePlot(p, geo) {
  return p.x >= geo.xLeft && p.x <= geo.xLeft + geo.plotW && p.y >= geo.pad.top && p.y <= geo.pad.top + geo.plotH;
}

/** Wheel zooms towards the cursor, dragging pans. Attached once, not per render. */
function initScatterZoom() {
  const host = $("scatter");
  let drag = null;
  let frame = null;

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      redrawScatter();
    });
  };

  host.addEventListener(
    "wheel",
    (event) => {
      const geo = state.plot;
      const view = state.view ?? state.autoView;
      if (!geo || !view) return;
      const p = toSvgPoint(event, geo);
      if (!insidePlot(p, geo)) return;
      event.preventDefault();

      const fx = (p.x - geo.xLeft) / geo.plotW;
      const fy = 1 - (p.y - geo.pad.top) / geo.plotH;
      const lxAt = view.lx0 + fx * (view.lx1 - view.lx0);
      const yAt = view.y0 + fy * (view.y1 - view.y0);
      const factor = Math.exp(event.deltaY * 0.0015);
      state.view = clampView({
        lx0: lxAt + (view.lx0 - lxAt) * factor,
        lx1: lxAt + (view.lx1 - lxAt) * factor,
        y0: yAt + (view.y0 - yAt) * factor,
        y1: yAt + (view.y1 - yAt) * factor,
      });
      schedule();
    },
    { passive: false },
  );

  host.addEventListener("pointerdown", (event) => {
    const geo = state.plot;
    const view = state.view ?? state.autoView;
    if (!geo || !view || event.button !== 0) return;
    const p = toSvgPoint(event, geo);
    if (!insidePlot(p, geo)) return;
    drag = { x: p.x, y: p.y, view: { ...view }, id: event.pointerId };
    host.classList.add("is-panning");
    try {
      host.setPointerCapture(event.pointerId);
    } catch {
      /* capture is a nicety, not a requirement */
    }
    event.preventDefault();
  });

  host.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const geo = state.plot;
    if (!geo) return;
    const p = toSvgPoint(event, geo);
    const dx = ((p.x - drag.x) / geo.plotW) * (drag.view.lx1 - drag.view.lx0);
    const dy = ((p.y - drag.y) / geo.plotH) * (drag.view.y1 - drag.view.y0);
    state.view = clampView({
      lx0: drag.view.lx0 - dx,
      lx1: drag.view.lx1 - dx,
      y0: drag.view.y0 + dy,
      y1: drag.view.y1 + dy,
    });
    schedule();
  });

  const endDrag = () => {
    if (!drag) return;
    try {
      host.releasePointerCapture(drag.id);
    } catch {
      /* already released */
    }
    drag = null;
    host.classList.remove("is-panning");
  };
  host.addEventListener("pointerup", endDrag);
  host.addEventListener("pointercancel", endDrag);

  host.addEventListener("dblclick", () => {
    if (state.view) resetZoom();
  });

  $("zoom-reset")?.addEventListener("click", resetZoom);
}

/** Axis ranges that fit the data: the view before any zoom. */
function autoView(rows, paid, metric) {
  const prices = paid.map((row) => row.price);
  const lx0 = prices.length ? Math.floor(Math.log10(Math.min(...prices))) : -5;
  const lx1 = prices.length ? Math.ceil(Math.log10(Math.max(...prices))) : 0;
  const values = rows.map((row) => row[metric]);
  const y1 = Math.ceil(Math.max(...values) / 5) * 5;
  const y0 = Math.max(0, Math.floor(Math.min(...values) / 5) * 5);
  return { lx0, lx1: Math.max(lx0 + 1, lx1), y0, y1: Math.max(y0 + 5, y1) };
}

/** Price ticks on a log axis: more mantissas once the range gets narrow. */
function priceTicks(lx0, lx1) {
  const span = lx1 - lx0;
  const mantissas = span > 3 ? [1] : span > 1.3 ? [1, 3] : [1, 1.5, 2, 3, 5, 7];
  const out = [];
  for (let exp = Math.floor(lx0) - 1; exp <= Math.ceil(lx1) + 1; exp += 1) {
    for (const m of mantissas) {
      const lv = Math.log10(m) + exp;
      if (lv >= lx0 - 1e-9 && lv <= lx1 + 1e-9) out.push(m * 10 ** exp);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Keeps a zoomed view within sane bounds and stops it collapsing to a point. */
function clampView(view) {
  const minX = 0.4;
  const minY = 4;
  let { lx0, lx1, y0, y1 } = view;
  if (lx1 - lx0 < minX) {
    const centre = (lx0 + lx1) / 2;
    lx0 = centre - minX / 2;
    lx1 = centre + minX / 2;
  }
  if (y1 - y0 < minY) {
    const centre = (y0 + y1) / 2;
    y0 = centre - minY / 2;
    y1 = centre + minY / 2;
  }
  if (lx0 < -7) {
    lx1 += -7 - lx0;
    lx0 = -7;
  }
  if (lx1 > 4) {
    lx0 -= lx1 - 4;
    lx1 = 4;
  }
  if (y0 < -5) {
    y1 += -5 - y0;
    y0 = -5;
  }
  if (y1 > 100) {
    y0 -= y1 - 100;
    y1 = 100;
  }
  return { lx0, lx1, y0, y1 };
}

function renderScatter(rows, frontier, spot) {
  const host = $("scatter");
  const tip = $("scatter-tip");
  tip.hidden = true;

  const metric = state.metric;
  const width = Math.max(host.clientWidth || 900, 420);
  const height = 540;
  const freeRows = rows.filter((row) => row.price <= 0);
  const paid = rows.filter((row) => row.price > 0);
  const freeBand = freeRows.length ? 62 : 0;
  const pad = { top: 26, right: 34, bottom: 58, left: 62 };
  const xLeft = pad.left + freeBand;
  const plotW = Math.max(80, width - pad.right - xLeft);
  const plotH = height - pad.top - pad.bottom;
  const freeX = pad.left + freeBand / 2;

  const freeOffsets = new Map();
  freeRows.forEach((row, index) => freeOffsets.set(row.id, pad.left + 11 + (index % 4) * 14));

  const auto = autoView(rows, paid, metric);
  state.autoView = auto;
  const view = state.view ?? auto;
  const yTop = view.y1;
  const yBottom = view.y0;
  const ySpan = Math.max(1e-6, yTop - yBottom);
  const lxSpan = Math.max(1e-6, view.lx1 - view.lx0);

  const yScale = (value) => pad.top + plotH - ((value - yBottom) / ySpan) * plotH;
  const xScale = (value) => xLeft + ((Math.log10(Math.max(value, 1e-12)) - view.lx0) / lxSpan) * plotW;
  const xTicks = priceTicks(view.lx0, view.lx1).map((value) => ({ value, x: xScale(value) }));
  const xFor = (row) => (row.price <= 0 ? freeOffsets.get(row.id) ?? freeX : xScale(row.price));

  // Geometry the zoom handlers need after the render.
  state.plot = { width, height, pad, xLeft, plotW, plotH };

  const frontierSet = new Set(frontier);
  const parts = [];
  parts.push(`<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img">`);
  parts.push(
    '<defs><linearGradient id="frontierGradient" x1="0" y1="1" x2="1" y2="0">' +
      '<stop class="frontier-grad-a" offset="0%"/><stop class="frontier-grad-b" offset="100%"/></linearGradient>' +
      '<linearGradient id="sweetGradient" x1="0" y1="0" x2="0" y2="1">' +
      '<stop class="sweet-grad-a" offset="0%"/><stop class="sweet-grad-b" offset="100%"/></linearGradient>' +
      // Zoomed content is clipped to the plot area, so it never spills over the axes.
      `<clipPath id="plotClip"><rect x="${pad.left}" y="${pad.top}" width="${plotW + freeBand}" height="${plotH}"/></clipPath>` +
      "</defs>",
  );

  const yStep = ySpan <= 12 ? 2 : ySpan <= 30 ? 5 : 10;
  for (let value = Math.ceil(yBottom / yStep) * yStep; value <= yTop + 1e-9; value += yStep) {
    const y = yScale(value);
    parts.push(`<line class="grid" x1="${xLeft}" y1="${y.toFixed(1)}" x2="${xLeft + plotW}" y2="${y.toFixed(1)}"/>`);
    parts.push(
      `<text class="axis" x="${pad.left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end">${nf(value, 0)}</text>`,
    );
  }

  if (freeBand) {
    parts.push(`<rect class="free-band" x="${pad.left}" y="${pad.top}" width="${freeBand}" height="${plotH}" rx="6"/>`);
    parts.push(
      `<line class="free-divider" x1="${pad.left + freeBand}" y1="${pad.top}" x2="${pad.left + freeBand}" y2="${pad.top + plotH}"/>`,
    );
    parts.push(
      `<text class="axis free-label" x="${freeX}" y="${pad.top + 13}" text-anchor="middle">${esc(t("scatter.free"))}</text>`,
    );
  }

  xTicks.forEach((tick) => {
    parts.push(
      `<line class="grid grid-v" x1="${tick.x.toFixed(1)}" y1="${pad.top}" x2="${tick.x.toFixed(1)}" y2="${pad.top + plotH}"/>`,
    );
    parts.push(
      `<text class="axis" x="${tick.x.toFixed(1)}" y="${pad.top + plotH + 18}" text-anchor="middle">${usdAxis(tick.value)}</text>`,
    );
  });

  // Everything below is clipped to the plot area.
  parts.push('<g clip-path="url(#plotClip)">');

  if (frontier.length > 1) {
    const path = frontier.map((point, index) => {
      const x = xFor(point);
      const y = yScale(point[metric]);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    });
    parts.push(`<path class="frontier" d="${path.join(" ")}"/>`);
  }

  // Sweet-spot box: the upper-left corner, below PRICE_CAP and close to the best
  // score available in that range. A fixed box, because the message is "stay in
  // this corner"; the expensive end of the frontier is nobody's idea of value.
  const inRange = frontier.filter((row) => row.price <= PRICE_CAP);
  if (inRange.length > 0) {
    const ceiling = Math.max(...inRange.map((row) => row[metric]));
    const margin = Math.max(4, (yTop - yBottom) * 0.14);
    const boxLeft = xLeft;
    const boxRight = Math.min(xScale(PRICE_CAP), xLeft + plotW);
    const boxTop = pad.top;
    const boxBottom = yScale(ceiling - margin);
    if (boxRight - boxLeft > 40 && boxBottom - boxTop > 30) {
      parts.push(
        `<rect class="sweet-band" x="${boxLeft.toFixed(1)}" y="${boxTop}" ` +
          `width="${(boxRight - boxLeft).toFixed(1)}" height="${(boxBottom - boxTop).toFixed(1)}" rx="8"/>`,
      );
      const lx = (boxLeft + 12).toFixed(1);
      parts.push(`<text class="sweet-band-label" x="${lx}" y="${(boxTop + 20).toFixed(1)}">${esc(t("scatter.sweet"))}</text>`);
      parts.push(`<text class="sweet-band-sub" x="${lx}" y="${(boxTop + 34).toFixed(1)}">${esc(t("scatter.sweet.sub"))}</text>`);
      parts.push(
        `<text class="sweet-band-cap" x="${(boxRight - 12).toFixed(1)}" y="${(boxTop + 20).toFixed(1)}" text-anchor="end">${esc(t("scatter.sweet.cap", { price: usd(PRICE_CAP, 2) }))}</text>`,
      );
    }
  }

  const ordered = [...rows].sort((a, b) => Number(frontierSet.has(a)) - Number(frontierSet.has(b)));
  ordered.forEach((row) => {
    const onFrontier = frontierSet.has(row);
    parts.push(
      `<circle class="dot${onFrontier ? " is-frontier" : ""}${spot && row.id === spot.id ? " is-sweet" : ""}" ` +
        `cx="${xFor(row).toFixed(1)}" cy="${yScale(row[metric]).toFixed(1)}" r="${onFrontier ? 5.4 : 4.4}" ` +
        `fill="${providerColor(row.provider)}" data-id="${esc(row.id)}">` +
        `<title>${esc(row.name)}</title></circle>`,
    );
  });

  // Labels: the frontier first, then the smartest models. Labels that do not fit
  // are dropped rather than clipped mid-word.
  const priority = [
    ...[...frontier].sort((a, b) => b[metric] - a[metric]),
    ...[...rows]
      .sort((a, b) => b[metric] - a[metric])
      .slice(0, 4)
      .filter((row) => !frontierSet.has(row)),
  ];
  const seen = new Set();
  const placed = [];
  priority.forEach((row) => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    const cx = xFor(row);
    const cy = yScale(row[metric]);
    const text = shortModelName(row.name);
    const boxW = text.length * 5.5 + 10;
    const slots = [
      [cx + 9, cy + 3.5],
      [cx - 9 - boxW, cy + 3.5],
      [cx + 9, cy - 8],
      [cx - 9 - boxW, cy - 8],
      [cx + 9, cy + 15],
      [cx - 9 - boxW, cy + 15],
    ];
    const free = slots.find(([lx, ly]) => {
      if (lx < pad.left + 2 || lx + boxW > xLeft + plotW - 2) return false;
      if (ly < pad.top + 9 || ly > pad.top + plotH + 6) return false;
      const rect = { x1: lx, y1: ly - 9, x2: lx + boxW, y2: ly + 3 };
      return !placed.some((box) => rect.x1 < box.x2 && rect.x2 > box.x1 && rect.y1 < box.y2 && rect.y2 > box.y1);
    });
    if (!free) return;
    placed.push({ x1: free[0], y1: free[1] - 9, x2: free[0] + boxW, y2: free[1] + 3 });
    parts.push(
      `<text class="dot-label${frontierSet.has(row) ? " is-frontier" : ""}" x="${free[0].toFixed(1)}" y="${free[1].toFixed(1)}">${esc(text)}</text>`,
    );
  });

  parts.push("</g>");

  parts.push(
    `<text class="axis axis-title" x="${(xLeft + plotW / 2).toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(t("scatter.xtitle"))}</text>`,
  );
  parts.push(
    `<text class="axis axis-title" transform="translate(14 ${(pad.top + plotH / 2).toFixed(1)}) rotate(-90)" text-anchor="middle">${esc(metricLabel())} Index</text>`,
  );

  parts.push("</svg>");
  host.innerHTML = parts.join("");

  const scale = host.clientWidth ? host.clientWidth / width : 1;
  host.querySelectorAll(".dot").forEach((dot) => {
    const row = rows.find((item) => item.id === dot.dataset.id);
    if (!row) return;
    dot.addEventListener("mouseenter", () => {
      tip.innerHTML =
        `<strong>${esc(shortModelName(row.name))}</strong>` +
        `<span class="tip-id">${esc(row.id)}</span>` +
        `<span class="tip-grid">` +
        `<em>${esc(metricLabel())}</em><b>${nf(row[state.metric], 1)}</b>` +
        `<em>${esc(t("tip.blended"))}</em><b>${priceLabel(row.price)}</b>` +
        `<em>Input / 1M</em><b>${usd(row.inPrice, 3)}</b>` +
        `<em>Output / 1M</em><b>${usd(row.outPrice, 3)}</b>` +
        `<em>${esc(t("tip.context"))}</em><b>${tokens(row.contextLength)}</b>` +
        `</span>`;
      const rect = host.getBoundingClientRect();
      tip.hidden = false;
      const px = Number(dot.getAttribute("cx")) * scale;
      const py = Number(dot.getAttribute("cy")) * scale;
      const tipW = tip.offsetWidth || 230;
      tip.style.left = `${Math.min(Math.max(8, px + 14), rect.width - tipW - 8)}px`;
      tip.style.top = `${Math.max(8, py - tip.offsetHeight - 12)}px`;
    });
    dot.addEventListener("mouseleave", () => {
      tip.hidden = true;
    });
  });
}

function renderLegend(rows) {
  const counts = new Map();
  rows.forEach((row) => counts.set(row.provider, (counts.get(row.provider) ?? 0) + 1));
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const parts = [`<span><i class="sw sw-spot"></i>${esc(t("legend.sweet"))}</span>`];
  top.forEach(([provider, count]) => {
    parts.push(
      `<span><i class="sw" style="background:${providerColor(provider)}"></i>${esc(prettyProvider(provider))} <em class="muted">${count}</em></span>`,
    );
  });
  $("scatter-legend").innerHTML = parts.join("");
}

function setLive(isLive, statusKey = null) {
  state.live = { on: isLive, key: statusKey };
  renderLive();
}
function renderLive() {
  $("live-pill").classList.toggle("is-live", state.live.on);
  setText("live-text", t(state.live.key ?? (state.live.on ? "live" : "offline")));
}

function renderSubtitle() {
  const text =
    state.credits && state.lastUpdate
      ? t("subtitle.stand", { time: dateTime(state.lastUpdate) })
      : t("subtitle.nokey");
  setText("subtitle", text);
}

function renderKeyNote() {
  setText("key-note", keyIsPersisted() ? t("key.note.persist") : t("key.note.session"));
}

/** Re-renders everything that contains translated text or numbers. */
function renderAll() {
  renderLive();
  renderBanner();
  renderSubtitle();
  renderKeyNote();
  renderOverview();
  renderCompare();
  renderModels();
  if (!$("refresh-btn").disabled) $("refresh-btn").textContent = t("refresh");
}

async function loadModels() {
  const body = await apiGet("/models", false);
  state.models = Array.isArray(body?.data) ? body.data : [];
}

async function refresh() {
  const button = $("refresh-btn");
  button.disabled = true;
  button.textContent = t("refresh.busy");
  try {
    await loadModels();
    if (state.apiKey) {
      const [credits, key] = await Promise.all([apiGet("/credits", true), apiGet("/key", true)]);
      state.credits = credits?.data ?? null;
      state.keyInfo = key?.data ?? null;
      if (state.credits) recordSnapshot(state.credits.total_usage);
      state.lastUpdate = Date.now();
      showBanner(null);
      await loadActivity();
      setLive(true);
    } else {
      setLive(false, "nokey.status");
      showBanner("banner.nokey");
    }
    renderOverview();
    renderCompare();
    renderModels();
    renderSubtitle();
  } catch (error) {
    setLive(false, "error.status");
    const hintKey = error.status === 401 ? "hint.401" : error.status === 403 ? "hint.403" : "";
    showBanner("banner.fail", { msg: error.message, hintKey }, true);
  } finally {
    button.disabled = false;
    button.textContent = t("refresh");
  }
}

function initTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.classList.contains("is-active")) return;
      withTransition(() => {
        document.querySelectorAll(".tab").forEach((other) => other.classList.remove("is-active"));
        document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("is-active"));
        tab.classList.add("is-active");
        $(`panel-${tab.dataset.tab}`).classList.add("is-active");
        if (tab.dataset.tab === "compare") renderCompare();
        else renderOverview();
      });
    });
  });
}

function initKeybar() {
  const input = $("api-key");
  const persist = $("remember-key");
  input.value = state.apiKey;
  persist.checked = keyIsPersisted();
  renderKeyNote();

  let saveTimer = null;
  input.addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      state.apiKey = input.value.trim();
      saveKey(state.apiKey, persist.checked);
    }, 400);
  });

  const apply = () => {
    clearTimeout(saveTimer);
    state.apiKey = input.value.trim();
    saveKey(state.apiKey, persist.checked);
    renderKeyNote();
    void refresh();
  };
  $("save-key").addEventListener("click", apply);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") apply();
  });

  persist.addEventListener("change", () => {
    saveKey(state.apiKey, persist.checked);
    renderKeyNote();
  });

  $("clear-key").addEventListener("click", () => {
    clearTimeout(saveTimer);
    state.apiKey = "";
    input.value = "";
    saveKey("", false);
    state.credits = null;
    state.keyInfo = null;
    state.modelHistory = loadModelHistory();
    state.activityError = null;
    renderOverview();
    renderModels();
    renderKeyNote();
    showBanner("key.removed");
  });
}

function initRange() {
  document.querySelectorAll("#range button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.classList.contains("is-active")) return;
      withTransition(() => {
        document.querySelectorAll("#range button").forEach((other) => other.classList.remove("is-active"));
        button.classList.add("is-active");
        state.days = Number(button.dataset.days) || 30;
        renderOverview();
      });
    });
  });
}

function initMetric() {
  document.querySelectorAll("#metric button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.classList.contains("is-active")) return;
      withTransition(() => {
        document.querySelectorAll("#metric button").forEach((other) => other.classList.remove("is-active"));
        button.classList.add("is-active");
        state.metric = button.dataset.metric || "intelligence";
        // A new metric means a new y range, so a zoomed view no longer fits.
        state.view = null;
        renderCompare();
      });
    });
  });
}

function initLanguage() {
  const select = $("lang-select");
  select.addEventListener("change", () => setLanguage(select.value));
}

/** Re-renders the charts when the window size changes; debounced. */
function initResize() {
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderOverview();
      renderCompare();
    }, 180);
  });
}

function boot() {
  state.lang = detectLanguage();
  state.apiKey = loadKey();
  state.snapshots = loadSnapshots();
  state.modelHistory = loadModelHistory();
  applyStaticText();
  initLanguage();
  initTabs();
  initKeybar();
  initRange();
  initMetric();
  initScatterZoom();
  initResize();
  $("refresh-btn").addEventListener("click", () => void refresh());
  renderLive();
  renderSubtitle();
  renderKeyNote();
  void refresh();
  // Keep the numbers fresh while the page is open, but not in background tabs.
  state.timer = setInterval(() => {
    if (!document.hidden) void refresh();
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void refresh();
  });
}

void boot();
