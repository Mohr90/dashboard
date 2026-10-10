import assert from "node:assert/strict";
import { test } from "node:test";

import {
  burnRate,
  dailySeries,
  daysRemaining,
  estimateCostUsd,
  formatEur,
  formatUsd,
  parsePrice,
  remainingUsd,
  usdToEur,
  type DailyPoint,
  type Snapshot,
} from "../src/stats.js";

const DAY = 86_400_000;
/** 2026-10-10T12:00:00Z */
const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);

function snapshot(ts: number, totalUsage: number): Snapshot {
  return {
    ts,
    totalCredits: 30,
    totalUsage,
    keyLimit: 10,
    keyLimitRemaining: 9,
    keyUsage: totalUsage,
    usageDaily: 0,
    usageWeekly: 0,
    usageMonthly: 0,
  };
}

test("remainingUsd subtracts usage from purchased credits", () => {
  assert.equal(remainingUsd(30, 6.861749373), 23.138251);
  assert.equal(remainingUsd(30, 30), 0);
  assert.equal(remainingUsd(0, 0), 0);
});

test("usdToEur converts with the given rate", () => {
  assert.equal(usdToEur(10, 0.89), 8.9);
  assert.equal(usdToEur(23.138251, 0.89238), 20.648112);
});

test("dailySeries diffs the all-time usage per UTC day and accumulates it", () => {
  const snapshots: Snapshot[] = [
    snapshot(Date.UTC(2026, 9, 7, 23, 0), 1), // baseline, before the window
    snapshot(Date.UTC(2026, 9, 8, 23, 0), 1.5),
    snapshot(Date.UTC(2026, 9, 9, 23, 0), 2),
    snapshot(Date.UTC(2026, 9, 10, 11, 0), 2.25),
  ];

  const series = dailySeries(snapshots, 3, NOW);
  assert.deepEqual(
    series.map((point) => point.date),
    ["2026-10-08", "2026-10-09", "2026-10-10"],
  );
  assert.deepEqual(
    series.map((point) => point.spend),
    [0.5, 0.5, 0.25],
  );
  assert.deepEqual(
    series.map((point) => point.cumulative),
    [0.5, 1, 1.25],
  );
});

test("dailySeries keeps the last reading of a day and never returns negative spend", () => {
  const snapshots: Snapshot[] = [
    snapshot(Date.UTC(2026, 9, 9, 23, 0), 5),
    // A late, lower reading (e.g. after a plan reset) must not produce -0.5.
    snapshot(Date.UTC(2026, 9, 10, 1, 0), 4.5),
    snapshot(Date.UTC(2026, 9, 10, 9, 0), 5.4),
  ];

  const series = dailySeries(snapshots, 1, NOW);
  assert.equal(series.length, 1);
  assert.equal(series[0]?.date, "2026-10-10");
  assert.equal(series[0]?.spend, 0.4);
});

test("dailySeries falls back to the API daily value when no baseline exists", () => {
  // Fresh install: only readings from today, so there is nothing to diff against.
  const fresh = { ...snapshot(Date.UTC(2026, 9, 10, 9, 0), 7), usageDaily: 0.25 };
  const series = dailySeries([fresh], 1, NOW);
  assert.equal(series.length, 1);
  assert.equal(series[0]?.date, "2026-10-10");
  assert.equal(series[0]?.spend, 0.25);
});

test("burnRate prefers the recorded history once three days have data", () => {
  const series: DailyPoint[] = [1, 1, 2, 2, 0].map((spend, index) => ({
    date: `2026-10-0${index + 1}`,
    spend,
    cumulative: 0,
  }));

  const rate = burnRate({ usageDaily: 9, usageWeekly: 70, usageMonthly: 300, series, now: NOW });
  assert.equal(rate.source, "history");
  assert.equal(rate.windowDays, 4); // only days with spend > 0 count
  assert.equal(rate.perDay, 1.5);
});

test("burnRate falls back to the API windows when history is thin", () => {
  const thin = dailySeries([], 7, NOW);

  const weekly = burnRate({ usageDaily: 0.5, usageWeekly: 7, usageMonthly: 10, series: thin, now: NOW });
  assert.equal(weekly.source, "api-week");
  assert.equal(weekly.perDay, 1);

  const monthly = burnRate({ usageDaily: 0.5, usageWeekly: 0, usageMonthly: 31, series: thin, now: NOW });
  assert.equal(monthly.source, "api-month");
  assert.equal(monthly.windowDays, 10); // day of month of NOW (UTC)
  assert.equal(monthly.perDay, 3.1);

  const daily = burnRate({ usageDaily: 0.25, usageWeekly: 0, usageMonthly: 0, series: thin, now: NOW });
  assert.equal(daily.source, "api-day");
  assert.equal(daily.perDay, 0.25);
});

test("daysRemaining projects the balance and handles edge cases", () => {
  assert.equal(daysRemaining(23.14, 1), 23.14);
  assert.equal(daysRemaining(10, 4), 2.5);
  assert.equal(daysRemaining(10, 0), null);
  assert.equal(daysRemaining(0, 1), null);
  assert.equal(daysRemaining(-1, 1), null);
  assert.equal(daysRemaining(10, Number.NaN), null);
});

test("parsePrice accepts OpenRouter's string prices", () => {
  assert.equal(parsePrice("0.000001"), 0.000001);
  assert.equal(parsePrice(0.000003), 0.000003);
  assert.equal(parsePrice("0"), 0);
  assert.equal(parsePrice("-1"), 0);
  assert.equal(parsePrice(undefined), 0);
  assert.equal(parsePrice(null), 0);
  assert.equal(parsePrice("abc"), 0);
});

test("estimateCostUsd adds prompt, completion and per-request fees", () => {
  const pricing = { prompt: "0.000001", completion: "0.0000027", request: "0.0001" };
  // 1M prompt tokens = $1, 1M completion tokens = $2.70, 10 requests = $0.001
  assert.equal(estimateCostUsd(pricing, { promptTokens: 1_000_000, completionTokens: 1_000_000, requests: 10 }), 3.701);
  assert.equal(estimateCostUsd(pricing, { promptTokens: 0, completionTokens: 0 }), 0);
  assert.equal(estimateCostUsd({}, { promptTokens: 1_000_000, completionTokens: 0 }), 0);
});

test("formatters use German number style for EUR", () => {
  assert.equal(formatUsd(23.138251), "$23.14");
  assert.equal(formatUsd(0.047606069), "$0.0476");
  assert.equal(formatEur(23.138251), "23,14 EUR");
  assert.equal(formatEur(0.047606069), "0,0476 EUR");
  assert.equal(formatUsd(Number.NaN), "n/a");
});
