/**
 * Cohort Timing & Taiwan Market Calendar Invariant Test Suite
 * 
 * Verifies:
 * 1. Friday Signal (13:30) -> Monday Entry (09:00)
 * 2. 20 Trading Days Cohort Traversal (skipping weekends)
 * 3. Lunar New Year Multi-day Closure Handling
 * 4. Typhoon Closure Skip Handling
 * 5. Consecutive Market Holidays
 */

import { nextTradingDay } from "../marketCalendar";

export function runCohortTimingTests(): { passed: number; failed: number; results: string[] } {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      passed++;
      results.push(`✅ PASS: ${testName}`);
    } else {
      failed++;
      results.push(`❌ FAIL: ${testName} - ${detail || ""}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: Friday Signal -> Next Trading Day Entry is Monday
  // ──────────────────────────────────────────────────────────────────────────
  {
    // 2024-08-02 is a Friday
    const fridaySignal = "2024-08-02";
    const entryDate = nextTradingDay(fridaySignal, 1);
    assert(entryDate === "2024-08-05", "Friday signal advances to Monday entry", `Got ${entryDate}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: 20 Trading Days Exact Count (Normal Month)
  // ──────────────────────────────────────────────────────────────────────────
  {
    // 2024-08-01 (Thu) + 1 trading day = 2024-08-02 (Fri entry)
    // 20 trading days from 2024-08-02:
    // Aug 2 (1), Aug 5-9 (5), Aug 12-16 (5), Aug 19-23 (5), Aug 26-29 (4) -> Aug 29 is Day 20
    const entryDate = "2024-08-02";
    const exitDate = nextTradingDay(entryDate, 19); // 20th day is 19 steps forward
    assert(exitDate === "2024-08-29", "20 trading days traversal reaches Day 20 (2024-08-29)", `Got ${exitDate}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: Lunar New Year Multi-Day Closure
  // ──────────────────────────────────────────────────────────────────────────
  {
    // 2024 Lunar New Year closed from 2024-02-06 to 2024-02-14
    // Last trading day before CNY was 2024-02-05 (Mon)
    // First trading day after CNY was 2024-02-15 (Thu)
    const beforeCNY = "2024-02-05";
    const afterCNY = nextTradingDay(beforeCNY, 1);
    assert(afterCNY === "2024-02-15", "Next trading day after CNY closure skips holidays to 2024-02-15", `Got ${afterCNY}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: Typhoon Day Closure Skip
  // ──────────────────────────────────────────────────────────────────────────
  {
    // 2024-10-02 & 2024-10-03 were typhoon holidays in Taiwan
    // 2024-10-01 (Tue) -> next trading day is 2024-10-04 (Fri)
    const beforeTyphoon = "2024-10-01";
    const afterTyphoon = nextTradingDay(beforeTyphoon, 1);
    assert(afterTyphoon === "2024-10-04", "Typhoon holidays 10/02-10/03 correctly skipped to 2024-10-04", `Got ${afterTyphoon}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: Consecutive Holiday Period (Tomb Sweeping + Children's Day)
  // ──────────────────────────────────────────────────────────────────────────
  {
    // 2024-04-03 (Wed) -> 04-04 (Thu holiday) -> 04-05 (Fri holiday) -> 04-06/07 weekend -> 2024-04-08 (Mon)
    const beforeTomb = "2024-04-03";
    const nextOpen = nextTradingDay(beforeTomb, 1);
    assert(nextOpen === "2024-04-08", "Consecutive holiday (Tomb Sweeping) correctly skips to Monday 2024-04-08", `Got ${nextOpen}`);
  }

  return { passed, failed, results };
}

// Standalone execution
if (typeof process !== "undefined" && process.argv && process.argv[1]?.includes("cohortTiming.test")) {
  const res = runCohortTimingTests();
  console.log("\n================ Cohort Timing Test Results ================");
  res.results.forEach(r => console.log(r));
  console.log("============================================================");
  console.log(`Total: ${res.passed + res.failed} | Passed: ${res.passed} | Failed: ${res.failed}\n`);
  if (res.failed > 0) process.exit(1);
}
