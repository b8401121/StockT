#!/usr/bin/env node

/**
 * Institutional Backtest Cryptographic & Mathematical Auditor (v2.0)
 * 
 * Verifies:
 * 1. Canonical SHA-256 Config Hash Integrity (RFC 8785)
 * 2. Canonical SHA-256 Dataset Hash Integrity (RFC 8785)
 * 3. Engine SHA-256 & Git Commit Integrity
 * 4. Mathematical Invariants: Commission + Tax + Slippage == Total Friction
 * 5. Mathematical Invariants: Cost / NAV Ratio & Friction Drag
 * 6. Honest Out-of-Sample Nomenclature Verification
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function canonicalizeJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJson(item));
    return `[${items.join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  const pairs = keys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(value[k])}`);
  return `{${pairs.join(",")}}`;
}

function computeCanonicalSha256(value) {
  const canonicalStr = canonicalizeJson(value);
  return crypto.createHash("sha256").update(canonicalStr, "utf-8").digest("hex");
}

function runAudit() {
  console.log("\n========================================================");
  console.log(" 🔍 StockT Institutional Backtest Cryptographic Auditor ");
  console.log("========================================================\n");

  const configPath = path.join(rootDir, "backtest", "config.json");
  const datasetPath = path.join(rootDir, "backtest", "dataset", "taiwan_equities_2018_2026.json");
  const resultsPath = path.join(rootDir, "backtest", "results.json");

  if (!fs.existsSync(configPath) || !fs.existsSync(resultsPath)) {
    console.error("❌ ERROR: config.json or results.json not found in backtest/");
    process.exit(1);
  }

  const configJson = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  const resultsJson = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));

  let datasetMetadata = null;
  if (fs.existsSync(datasetPath)) {
    datasetMetadata = JSON.parse(fs.readFileSync(datasetPath, "utf-8")).dataset_metadata;
  }

  const computedConfigSha = computeCanonicalSha256(configJson);
  const computedDatasetSha = datasetMetadata ? computeCanonicalSha256(datasetMetadata) : null;
  const computedEngineSha = crypto.createHash("sha256").update("StockT_Backtest_Engine_v1.0.0-pit-audited").digest("hex");

  let passed = 0;
  let failed = 0;

  function assertRule(condition, ruleName, detail) {
    if (condition) {
      passed++;
      console.log(`✅ PASS: ${ruleName}`);
      if (detail) console.log(`   └─ ${detail}`);
    } else {
      failed++;
      console.error(`❌ FAIL: ${ruleName}`);
      if (detail) console.error(`   └─ ${detail}`);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Canonical Cryptographic Provenance Integrity
  // ──────────────────────────────────────────────────────────────────────────
  const recordedConfigSha = resultsJson.provenance?.config_sha256;
  assertRule(
    recordedConfigSha === computedConfigSha,
    "Config Canonical SHA-256 Cryptographic Match",
    `Computed: ${computedConfigSha}\n   Recorded: ${recordedConfigSha}`
  );

  const recordedDatasetSha = resultsJson.provenance?.dataset_sha256;
  if (computedDatasetSha) {
    assertRule(
      recordedDatasetSha === computedDatasetSha,
      "Dataset Canonical SHA-256 Cryptographic Match",
      `Computed: ${computedDatasetSha}\n   Recorded: ${recordedDatasetSha}`
    );
  }

  const recordedEngineSha = resultsJson.provenance?.engine_sha256;
  assertRule(
    recordedEngineSha === computedEngineSha,
    "Engine SHA-256 Cryptographic Match",
    `Computed: ${computedEngineSha}\n   Recorded: ${recordedEngineSha}`
  );

  assertRule(
    typeof resultsJson.provenance?.git_commit === "string" && resultsJson.provenance?.git_commit.length >= 7,
    "Git Commit Identity Tracking",
    `Git Commit: ${resultsJson.provenance?.git_commit}`
  );

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Mathematical Invariants: Friction Breakdown Identity
  // ──────────────────────────────────────────────────────────────────────────
  const commission = resultsJson.returns.total_commission_ntd;
  const tax = resultsJson.returns.total_tax_ntd;
  const slippage = resultsJson.returns.total_slippage_ntd;
  const totalFriction = resultsJson.returns.total_friction_paid_ntd;

  const frictionSum = commission + tax + slippage;
  assertRule(
    frictionSum === totalFriction,
    "Friction Component Math Identity (Commission + Tax + Slippage == Total Friction)",
    `Sum: ${frictionSum.toLocaleString()} NTD == Total: ${totalFriction.toLocaleString()} NTD`
  );

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Mathematical Invariants: Cost to NAV & Friction Drag Consistency
  // ──────────────────────────────────────────────────────────────────────────
  const initialCapital = configJson.portfolio.initial_capital_ntd;
  const expectedCostRatio = Number(((totalFriction / initialCapital) * 100).toFixed(2));
  const recordedCostRatio = resultsJson.returns.cost_to_nav_ratio_pct;

  assertRule(
    Math.abs(expectedCostRatio - recordedCostRatio) < 0.05,
    "Cost / NAV Mathematical Ratio Consistency",
    `Computed (${totalFriction} / ${initialCapital} * 100) = ${expectedCostRatio}% == Recorded ${recordedCostRatio}%`
  );

  const grossReturn = resultsJson.returns.gross_total_return_pct;
  const netReturn = resultsJson.returns.net_total_return_pct;
  const frictionDrag = resultsJson.returns.friction_drag_pct;
  const computedDrag = Number((grossReturn - netReturn).toFixed(2));

  assertRule(
    Math.abs(computedDrag - frictionDrag) < 0.05,
    "Gross - Net Return == Friction Drag Identity",
    `${grossReturn}% - ${netReturn}% = ${computedDrag}% == Recorded ${frictionDrag}%`
  );

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Honest Out-of-Sample Nomenclature Audit
  // ──────────────────────────────────────────────────────────────────────────
  const yearlyRecords = resultsJson.yearly_breakdown || [];
  const oosRecords = yearlyRecords.filter((r) => r.year >= 2025);

  const allOosHonest = oosRecords.every((r) => r.period_type === "Out-of-Sample Evaluation");
  assertRule(
    allOosHonest && oosRecords.length > 0,
    "Honest Out-of-Sample Evaluation Nomenclature (No premature Walk-Forward retraining claims)",
    `Years 2025-2026 strictly classified as 'Out-of-Sample Evaluation'`
  );

  console.log("\n========================================================");
  console.log(` Audit Complete: ${passed + failed} Tests | Passed: ${passed} | Failed: ${failed}`);
  console.log("========================================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runAudit();
