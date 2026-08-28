/**
 * Point-in-Time (PIT) Invariant Test Suite
 * 
 * Tests the 7 fundamental invariants required for institutional-grade backtesting:
 * 1. feature.availableAt > signalTimestamp -> Excluded (Look-ahead prevented)
 * 2. feature.availableAt <= signalTimestamp -> Included
 * 3. publishedAt > availableAt -> Invalid Causality Violation
 * 4. next_market_open over weekend/holiday -> Correctly resolves to Monday 09:00
 * 5. holding_period: 20 trading_days -> Traverses 20 trading days skipping holidays
 * 6. T Close signal -> Strictly cannot consume T+1 data
 * 7. T Close signal -> Execution timing must be >= T+1 09:00:00
 */

import { Metric } from "../platform";
import {
  nextTradingDay,
  nextMarketOpen,
  marketClose,
  validatePITMetric,
} from "../marketCalendar";
import { checkMetricAvailability } from "../pitValidator";

export function runPITInvariantTests(): { passed: number; failed: number; results: string[] } {
  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      passed++;
      results.push(`✅ PASS: ${testName}`);
    } else {
      failed++;
      results.push(`❌ FAIL: ${testName}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 1: feature.availableAt > signalTimestamp → Feature must be EXCLUDED
  // ──────────────────────────────────────────────────────────────────────────
  {
    const futureMetric: Metric<number> = {
      value: 0.22,
      source: "Yahoo Finance",
      period: "2024Q2",
      publishedAt: "2024-08-07T16:30:00+08:00",
      availableAt: "2024-08-08T09:00:00+08:00",
      availabilityPolicy: "next_market_open",
      fetchedAt: "2026-08-28T14:00:00Z",
    };
    // Signal evaluated on 2024-08-07 13:30 (before availableAt)
    const signalTs = "2024-08-07T13:30:00+08:00";
    const res = checkMetricAvailability(futureMetric, signalTs);
    assert(res.isAvailable === false, "TEST 1: Feature availableAt > signalTimestamp is excluded");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 2: feature.availableAt == signalTimestamp → Feature is INCLUDED
  // ──────────────────────────────────────────────────────────────────────────
  {
    const exactMetric: Metric<number> = {
      value: 15.5,
      source: "TWSE",
      period: "2024-08-07",
      publishedAt: "2024-08-07T13:30:00+08:00",
      availableAt: "2024-08-07T13:30:00+08:00",
      availabilityPolicy: "market_close",
      fetchedAt: "2026-08-28T14:00:00Z",
    };
    const signalTs = "2024-08-07T13:30:00+08:00";
    const res = checkMetricAvailability(exactMetric, signalTs);
    assert(res.isAvailable === true, "TEST 2: Feature availableAt == signalTimestamp is included");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 3: publishedAt > availableAt → INVALID (Causality Violation)
  // ──────────────────────────────────────────────────────────────────────────
  {
    const invalidMetric: Metric<number> = {
      value: 0.18,
      source: "Yahoo Finance",
      period: "2024Q2",
      publishedAt: "2024-08-15T10:00:00+08:00",
      availableAt: "2024-08-14T00:00:00+08:00", // published after available -> Impossible!
      fetchedAt: "2026-08-28T14:00:00Z",
    };
    const validation = validatePITMetric(invalidMetric);
    assert(validation.valid === false, "TEST 3: publishedAt > availableAt causes causality violation");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 4: next_market_open on Friday evening → Advances to Monday 09:00:00
  // ──────────────────────────────────────────────────────────────────────────
  {
    // 2024-08-09 is a Friday
    const fridayEvening = "2024-08-09T18:00:00+08:00";
    const nextOpen = nextMarketOpen(fridayEvening);
    // Next Monday is 2024-08-12
    assert(nextOpen === "2024-08-12T09:00:00+08:00", "TEST 4: Friday 18:00 next_market_open resolves to Monday 09:00");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 5: holding_period: 20 trading_days → Traverses trading days (not calendar days)
  // ──────────────────────────────────────────────────────────────────────────
  {
    // Start date 2024-08-01 (Thu)
    const startDate = "2024-08-01";
    const day20 = nextTradingDay(startDate, 20);
    // Counting 20 trading days across 4 weekends (and no holidays in Aug):
    // 20 trading days from Aug 1 -> Aug 29 (Thu)
    assert(day20 === "2024-08-29", `TEST 5: 20 trading days from 2024-08-01 reaches ${day20} (skipping 8 weekend days)`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 6: T Close signal → Strictly cannot consume T+1 data
  // ──────────────────────────────────────────────────────────────────────────
  {
    const mondayData: Metric<number> = {
      value: 100.0,
      source: "TWSE",
      period: "2024-08-12",
      publishedAt: "2024-08-12T13:30:00+08:00",
      availableAt: "2024-08-12T13:30:00+08:00",
      availabilityPolicy: "market_close",
      fetchedAt: "2026-08-28T14:00:00Z",
    };
    // Friday signal T Close
    const fridaySignalTs = "2024-08-09T13:30:00+08:00";
    const res = checkMetricAvailability(mondayData, fridaySignalTs);
    assert(res.isAvailable === false, "TEST 6: Friday signal strictly rejects Monday data");
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TEST 7: T Close signal → Execution timing must be >= T+1 09:00:00
  // ──────────────────────────────────────────────────────────────────────────
  {
    const signalDate = "2024-08-07";
    const signalTs = marketClose(signalDate); // 2024-08-07T13:30:00+08:00
    const nextOpenTs = nextMarketOpen(signalTs); // 2024-08-08T09:00:00+08:00
    
    const sigTime = new Date(signalTs).getTime();
    const execTime = new Date(nextOpenTs).getTime();
    
    assert(execTime > sigTime && nextOpenTs === "2024-08-08T09:00:00+08:00", "TEST 7: T Close (13:30) executes at T+1 Open (09:00)");
  }

  return { passed, failed, results };
}

// Direct execution when run as standalone script
if (typeof process !== "undefined" && process.argv && process.argv[1]?.includes("pitInvariants.test")) {
  const res = runPITInvariantTests();
  console.log("\n================ Point-in-Time Invariant Test Results ================");
  res.results.forEach(r => console.log(r));
  console.log("======================================================================");
  console.log(`Total: ${res.passed + res.failed} | Passed: ${res.passed} | Failed: ${res.failed}\n`);
  if (res.failed > 0) process.exit(1);
}
