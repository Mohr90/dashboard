"use strict";

const $ = (id) => document.getElementById(id);

const state = {
  days: 30,
  summary: null,
  compareTimer: null,
  compareLoaded: false,
  pollTimer: null,
};

/* ------------------------------- formatting ------------------------------- */
function nf(value, digits) {
  return (Number.isFinite(value) ? value : 0).toLocaleString("de-DE", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}
const eur = (value, digits = 2) => `${nf(value, digits)} \u20AC`;
const usd = (value) => `$${nf(value, Math.abs(value) < 1 ? 4 : 2)}`;
const pct = (value) => `${nf(value, 1)} %`;
const axisNum = (value) => (value >= 1 ? `$${value.toFixed(2)}` : value > 0 ? `$${value.toFixed(3)}` : "$0");

function tokens(value) {
  if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value || 0));
}
function dateShort(value) {
  const d = new Date(value.length > 10 ? value : `${value}T00:00:00Z`);
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" });
}
function dateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

/* --------------------------------- banner --------------------------------- */
function showBanner(message, isError) {
  const el = $("banner");
  el.textContent = message;
  el.className = isError ? "banner error" : "banner";
  el.hidden = !message;
}

/* -------------------------------- overview -------------------------------- */
function renderSummary(s) {
  state.summary = s;

  setText("remaining-eur", eur(s.account.remainingEur));
  setText("remaining-usd", `${usd(s.account.remainingUsd)} verfuegbar`);
  const used = Math.max(0, Math.min(100, s.account.usedPercent));
  $("balance-bar").style.width = `${used}%`;
  setText("balance-foot", `${pct(used)} von ${usd(s.account.totalCredits)} aufgebraucht`);

  setText("used-total", usd(s.account.totalUsage));
  setText("used-sub", `von ${usd(s.account.totalCredits)} gekauft`);

  setText("today-eur", eur(s.key.usageDaily * s.currency.eurPerUsd));
  setText("today-sub", `${usd(s.key.usageDaily)} heute (UTC)`);

  setText("burn-eur", `${eur(s.burn.perDayEur)}/Tag`);
  setText("burn-sub", `${usd(s.burn.perDayUsd)}/Tag - Basis: ${burnSourceLabel(s.burn.source)}`);
  setText("burn-source", `${s.burn.windowDays} Tag(e) Fenster`);

  if (s.burn.daysRemaining === null) {
    setText("days-left", "unbegrenzt");
    setText("runs-out", "kein messbarer Verbrauch");
  } else {
    setText("days-left", `${nf(s.burn.daysRemaining, 1)} Tage`);
    setText("runs-out", s.burn.runsOutAt ? `leer ca. am ${new Date(s.burn.runsOutAt).toLocaleDateString("de-DE")}` : "-");
  }

  setText("key-label", s.key.label ? `Key ${s.key.label}` : "unbenannter Key");
  const badge = $("key-badge");
  badge.textContent = s.key.isManagementKey ? "Management-Key" : "Inferenz-Key";
  badge.className = `badge ${s.key.isManagementKey ? "ok" : ""}`;

  if (s.key.limit === null) {
    setText("limit-remaining", "kein Limit");
    setText("limit-sub", "Dieser Key hat kein Ausgabenlimit");
    $("limit-bar").style.width = "0%";
  } else {
    const remaining = s.key.limitRemaining ?? 0;
    const usedLimit = s.key.limit > 0 ? Math.max(0, Math.min(100, ((s.key.limit - remaining) / s.key.limit) * 100)) : 0;
    setText("limit-remaining", usd(remaining));
    setText("limit-sub", `von ${usd(s.key.limit)} (${s.key.limitReset ?? "kein Reset"})`);
    $("limit-bar").style.width = `${usedLimit}%`;
  }

  setText("k-today", usd(s.key.usageDaily));
  setText("k-week", usd(s.key.usageWeekly));
  setText("k-month", usd(s.key.usageMonthly));
  setText("k-total", usd(s.key.usageAllTime));

  setText("m-fx", `1 USD = ${nf(s.currency.eurPerUsd, 4)} EUR (${s.currency.source})`);
  setText("m-snapshots", String(s.meta.snapshotCount));
  setText("m-since", dateTime(s.meta.historySince));
  setText("m-lastpoll", dateTime(s.meta.lastPollAt));

  const spent = s.history.points.reduce((sum, p) => sum + p.spend, 0);
  setText("chart-sub", `${eur(spent * s.currency.eurPerUsd)} in ${s.history.days} Tagen`);
  setText(
    "subtitle",
    `Aktualisiert alle ${s.meta.pollSeconds}s - Stand ${dateTime(s.generatedAt)} - ${s.currency.source}`,
  );

  renderChart(s.history.points, s.currency.eurPerUsd);
  if (s.meta.lastError) showBanner(`Letzte Abfrage fehlgeschlagen: ${s.meta.lastError}`, true);
  else showBanner("", false);
}

function burnSourceLabel(source) {
  switch (source) {
    case "history":
      return "lokale Historie";
    case "api-week":
      return "Wochenverbrauch";
    case "api-month":
      return "Monatsverbrauch";
    default:
      return "Tagesverbrauch";
  }
}

/* ---------------------------------- chart ---------------------------------- */
function renderChart(points, rate) {
  const host = $("chart");
  if (!points || points.length === 0) {
    host.innerHTML = '<p class="muted small">Noch keine Daten - der Verlauf waechst mit jedem Poll.</p>';
    return;
  }

  const width = Math.max(host.clientWidth || 680, 360);
  const height = 264;
  const pad = { top: 16, right: 58, bottom: 28, left: 56 };
  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;
  const maxSpend = Math.max(...points.map((p) => p.spend), 0.000001);
  const maxCum = Math.max(...points.map((p) => p.cumulative), 0.000001);
  const step = iw / points.length;
  const barW = Math.max(2, Math.min(step * 0.62, 34));

  const parts = [];
  parts.push(`<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}">`);
  parts.push('<defs><linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">');
  parts.push('<stop offset="0%" stop-color="#38bdf8"/><stop offset="100%" stop-color="#2563eb"/></linearGradient></defs>');

  const ticks = 4;
  for (let i = 0; i <= ticks; i += 1) {
    const y = pad.top + (ih / ticks) * i;
    parts.push(`<line class="grid" x1="${pad.left}" y1="${y.toFixed(1)}" x2="${pad.left + iw}" y2="${y.toFixed(1)}"/>`);
    parts.push(`<text class="axis" x="${pad.left - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${axisNum(maxSpend * (1 - i / ticks))}</text>`);
    parts.push(`<text class="axis axis-right" x="${pad.left + iw + 8}" y="${(y + 4).toFixed(1)}">${axisNum(maxCum * (1 - i / ticks))}</text>`);
  }

  points.forEach((point, index) => {
    const h = (point.spend / maxSpend) * ih;
    const x = pad.left + index * step + (step - barW) / 2;
    const y = pad.top + ih - h;
    const visible = point.spend > 0 ? Math.max(h, 1) : 0;
    parts.push(
      `<rect class="bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${visible.toFixed(1)}" rx="2">` +
        `<title>${point.date}: ${usd(point.spend)} (${eur(point.spend * rate)})</title></rect>`,
    );
  });

  const line = points
    .map((point, index) => {
      const x = pad.left + index * step + step / 2;
      const y = pad.top + ih - (point.cumulative / maxCum) * ih;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  parts.push(`<polyline class="line" points="${line}"/>`);

  const every = Math.max(1, Math.ceil(points.length / 9));
  points.forEach((point, index) => {
    if (index % every !== 0 && index !== points.length - 1) return;
    const x = pad.left + index * step + step / 2;
    parts.push(`<text class="axis" x="${x.toFixed(1)}" y="${height - 8}" text-anchor="middle">${dateShort(point.date)}</text>`);
  });

  parts.push("</svg>");
  host.innerHTML = parts.join("");
}

/* --------------------------------- compare -------------------------------- */
async function loadCompare() {
  const promptTokens = Number($("w-prompt").value) || 0;
  const completionTokens = Number($("w-completion").value) || 0;
  const requests = Number($("w-requests").value) || 0;
  const filter = $("w-filter").value.trim();
  const params = new URLSearchParams({ promptTokens, completionTokens, requests, limit: "40" });
  if (filter) params.set("models", filter);

  setText("compare-sub", "Lade Modellpreise ...");
  try {
    const response = await fetch(`/api/compare?${params.toString()}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    renderCompare(data);
  } catch (error) {
    setText("compare-sub", `Fehler: ${error.message}`);
  }
}

function renderCompare(data) {
  const body = $("compare-body");
  body.textContent = "";

  data.rows.forEach((row, index) => {
    const tr = document.createElement("tr");
    const cells = [
      String(index + 1),
      row.name,
      row.promptPerMillion.toFixed(3),
      row.completionPerMillion.toFixed(3),
      tokens(row.contextLength || 0),
      `${eur(row.costEur)} (${usd(row.costUsd)})`,
    ];

    cells.forEach((value, cellIndex) => {
      const td = document.createElement("td");
      td.textContent = value;
      if (cellIndex >= 2) td.className = "num";
      if (cellIndex === 1) {
        const strong = document.createElement("div");
        strong.textContent = row.name;
        const small = document.createElement("div");
        small.className = "id";
        small.textContent = row.id;
        td.textContent = "";
        td.append(strong, small);
      }
      if (cellIndex === 5 && index === 0) td.classList.add("cheap");
      tr.append(td);
    });
    body.append(tr);
  });

  const workload = data.workload;
  setText(
    "compare-sub",
    `${data.rows.length} von ${data.candidates} Modellen - Workload: ${tokens(workload.promptTokens)} in / ${tokens(workload.completionTokens)} out x ${workload.requests} Requests - Kurs 1 USD = ${nf(data.currency.eurPerUsd, 4)} EUR`,
  );
}

function scheduleCompare() {
  clearTimeout(state.compareTimer);
  state.compareTimer = setTimeout(loadCompare, 280);
}

/* ---------------------------------- live ---------------------------------- */
async function loadSummary(days) {
  const response = await fetch(`/api/summary?days=${days}`);
  const data = await response.json();
  if (!response.ok) {
    showBanner(data.error + (data.hint ? ` ${data.hint}` : ""), true);
    return;
  }
  renderSummary(data);
}

function setLive(isLive) {
  const pill = $("live-pill");
  pill.classList.toggle("is-live", isLive);
  setText("live-text", isLive ? "live" : "offline");
}

function connectStream() {
  const source = new EventSource("/api/stream");
  source.addEventListener("open", () => setLive(true));
  source.addEventListener("summary", (event) => {
    setLive(true);
    try {
      renderSummary(JSON.parse(event.data));
    } catch (error) {
      console.error("Summary konnte nicht gelesen werden", error);
    }
  });
  source.addEventListener("error", () => {
    setLive(false);
    source.close();
    // Fallback: keep polling so the dashboard stays usable.
    if (!state.pollTimer) {
      state.pollTimer = setInterval(() => void loadSummary(state.days).catch(() => {}), 60000);
    }
  });
}

/* --------------------------------- wiring --------------------------------- */
function initTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((other) => other.classList.remove("is-active"));
      document.querySelectorAll(".panel").forEach((panel) => panel.classList.remove("is-active"));
      tab.classList.add("is-active");
      $(`panel-${tab.dataset.tab}`).classList.add("is-active");
      if (tab.dataset.tab === "compare" && !state.compareLoaded) {
        state.compareLoaded = true;
        void loadCompare();
      }
    });
  });
}

function initRange() {
  document.querySelectorAll("#range button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("#range button").forEach((other) => other.classList.remove("is-active"));
      button.classList.add("is-active");
      state.days = Number(button.dataset.days) || 30;
      void loadSummary(state.days).catch((error) => showBanner(error.message, true));
    });
  });
}

function initRefresh() {
  $("refresh-btn").addEventListener("click", async () => {
    const button = $("refresh-btn");
    button.disabled = true;
    button.textContent = "Aktualisiere ...";
    try {
      const response = await fetch("/api/refresh");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      renderSummary(data);
    } catch (error) {
      showBanner(`Aktualisieren fehlgeschlagen: ${error.message}`, true);
    } finally {
      button.disabled = false;
      button.textContent = "Jetzt aktualisieren";
    }
  });
}

function initCompareForm() {
  ["w-prompt", "w-completion", "w-requests", "w-filter"].forEach((id) => {
    $(id).addEventListener("input", scheduleCompare);
  });
}

let resizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.summary) renderChart(state.summary.history.points, state.summary.currency.eurPerUsd);
  }, 180);
});

async function boot() {
  initTabs();
  initRange();
  initRefresh();
  initCompareForm();

  try {
    const health = await fetch("/api/health").then((response) => response.json());
    if (!health.hasApiKey) {
      showBanner("Kein OpenRouter-Key konfiguriert - bitte .env anlegen (siehe .env.example).", true);
    }
  } catch {
    /* health is optional */
  }

  await loadSummary(state.days).catch((error) => showBanner(error.message, true));
  connectStream();
}

void boot();
