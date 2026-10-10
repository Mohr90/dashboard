import assert from "node:assert/strict";
import { test } from "node:test";

import {
  burnRate,
  dailySeries,
  daysRemaining,
  estimateCostUsd,
  formatEur,
  formatPercent,
  formatTokens,
  formatUsd,
  parsePrice,
  remainingUsd,
  round,
  usdToEur,
  utcDayKey,
  type DailyPoint,
  type Snapshot,
} from "../src/stats.js";

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0); // 10.10.2026, 12:00 UTC

function snap(ts: number, totalUsage: number): Snapshot {
  return {
    ts,
    totalCredits: 30,
    totalUsage,
    keyLimit: 10,
    keyLimitRemaining: 5,
    keyUsage: totalUsage,
    usageDaily: 0,
    usageWeekly: 0,
    usageMonthly: 0,
  };
}

function point(date: string, spend: number): DailyPoint {
  return { date, spend, cumulative: 0 };
}

test("round und remainingUsd rechnen stabil", () => {
  assert.equal(round(0.7999999999999998, 6), 0.8);
  assert.equal(round(3.14159, 2), 3.14);
  assert.equal(round(2.98765, 3), 2.988);
  assert.equal(remainingUsd(30, 7.015204), 22.984796);
  assert.equal(usdToEur(10, 0.89238), 8.9238);
});

test("utcDayKey liefert das UTC-Datum", () => {
  assert.equal(utcDayKey(Date.UTC(2026, 9, 10, 23, 59, 59)), "2026-10-10");
  assert.equal(utcDayKey(Date.UTC(2026, 9, 11, 0, 0, 1)), "2026-10-11");
});

test("dailySeries bildet Tagesverbrauch und Kumulation aus Snapshots", () => {
  const snapshots = [
    snap(Date.UTC(2026, 9, 7, 23, 0, 0), 5.0), // Baseline vor dem Fenster
    snap(Date.UTC(2026, 9, 8, 10, 0, 0), 5.5),
    snap(Date.UTC(2026, 9, 8, 23, 0, 0), 5.8),
    snap(Date.UTC(2026, 9, 9, 12, 0, 0), 6.1),
    snap(Date.UTC(2026, 9, 9, 20, 0, 0), 6.4),
    snap(Date.UTC(2026, 9, 10, 9, 0, 0), 7.0),
  ];

  const series = dailySeries(snapshots, 3, NOW);

  assert.deepEqual(
    series.map((entry) => entry.date),
    ["2026-10-08", "2026-10-09", "2026-10-10"],
  );
  assert.deepEqual(
    series.map((entry) => entry.spend),
    [0.8, 0.6, 0.6],
  );
  assert.deepEqual(
    series.map((entry) => entry.cumulative),
    [0.8, 1.4, 2.0],
  );
});

test("dailySeries lehnt fallende Werte ab und fuellt Luecken mit 0", () => {
  const snapshots = [
    snap(Date.UTC(2026, 9, 7, 23, 0, 0), 5.0),
    snap(Date.UTC(2026, 9, 8, 23, 0, 0), 5.4),
    // 09.10. fehlt komplett
    snap(Date.UTC(2026, 9, 10, 9, 0, 0), 5.2), // Reset/geringerer Wert
  ];

  const series = dailySeries(snapshots, 3, NOW);
  assert.deepEqual(
    series.map((entry) => entry.spend),
    [0.4, 0, 0],
  );
});

test("burnRate bevorzugt die lokale Historie ab drei Tagen mit Verbrauch", () => {
  const series = [point("2026-10-08", 1), point("2026-10-09", 2), point("2026-10-10", 3)];
  const result = burnRate({ usageDaily: 0.9, usageWeekly: 7, usageMonthly: 30, series, now: NOW });

  assert.equal(result.source, "history");
  assert.equal(result.windowDays, 3);
  assert.equal(result.perDay, 2);
});

test("burnRate faellt auf Woche, Monat und Tag zurueck", () => {
  const empty: DailyPoint[] = [];

  const week = burnRate({ usageDaily: 0.4, usageWeekly: 1.4, usageMonthly: 3, series: empty, now: NOW });
  assert.equal(week.source, "api-week");
  assert.equal(week.perDay, 0.2);

  const month = burnRate({ usageDaily: 0.4, usageWeekly: 0, usageMonthly: 3, series: empty, now: NOW });
  assert.equal(month.source, "api-month");
  assert.equal(month.windowDays, 10); // 10.10. -> 10. Tag des Monats
  assert.equal(month.perDay, 0.3);

  const day = burnRate({ usageDaily: 0.4, usageWeekly: 0, usageMonthly: 0, series: empty, now: NOW });
  assert.equal(day.source, "api-day");
  assert.equal(day.perDay, 0.4);
});

test("daysRemaining liefert null ohne Verbrauch", () => {
  assert.equal(daysRemaining(20, 0.5), 40);
  assert.equal(daysRemaining(20, 0), null);
  assert.equal(daysRemaining(0, 0.5), null);
});

test("parsePrice versteht Strings, Zahlen und Unbrauchbares", () => {
  assert.equal(parsePrice("0.000003"), 0.000003);
  assert.equal(parsePrice(0.5), 0.5);
  assert.equal(parsePrice(undefined), 0);
  assert.equal(parsePrice("-1"), 0);
  assert.equal(parsePrice("keine Zahl"), 0);
});

test("estimateCostUsd rechnet Tokens und Requests zusammen", () => {
  const pricing = { prompt: "0.000001", completion: "0.000002", request: "0.0001" };
  const cost = estimateCostUsd(pricing, {
    promptTokens: 1_000_000,
    completionTokens: 500_000,
    requests: 100,
  });
  assert.equal(cost, 2.01);
});

test("formatierende Helfer nutzen deutsches Format", () => {
  assert.equal(formatUsd(1.5), "$1.50");
  assert.equal(formatUsd(0.05), "$0.0500");
  assert.equal(formatEur(20.511172), "20,51 EUR");
  assert.equal(formatPercent(23.384), "23,4 %");
  assert.equal(formatTokens(262144), "262.1k");
  assert.equal(formatTokens(1_500_000), "1.50M");
  assert.equal(formatTokens(742), "742");
});
