import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = "/run/media/sam/59AFFA8534FAE6A7/StockT";

const paperDir = path.join(rootDir, "backtest", "forward_paper_trading");
const ledgerDir = path.join(paperDir, "ledger");
const manifestFile = path.join(paperDir, "freeze_manifest.json");

function calculateSpearmanRankCorrelation(x, y) {
  const n = x.length;
  if (n < 3) return 0;
  function getRanks(arr) {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    sorted.forEach((item, rank) => { ranks[item.i] = rank + 1; });
    return ranks;
  }
  const rankX = getRanks(x);
  const rankY = getRanks(y);
  let dSquaredSum = 0;
  for (let i = 0; i < n; i++) {
    const d = rankX[i] - rankY[i];
    dSquaredSum += d * d;
  }
  return 1 - (6 * dSquaredSum) / (n * (n * n - 1));
}

async function runProspectiveEvaluator() {
  console.log("================================================================================");
  console.log(" 📊 StockT Prospective Paper Trading: Blind & Realized Performance Evaluator   ");
  console.log("================================================================================\n");

  if (!fs.existsSync(manifestFile)) {
    console.error("❌ Freeze Manifest missing. Run npm run paper:record first.");
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
  console.log(`📌 Active Freeze Manifest: ${manifest.manifest_id} (Locked on ${manifest.freeze_manifest_date})`);
  console.log(`📌 Model SHA-256:          ${manifest.model_hash}`);
  console.log(`📌 Evaluation Protocol:    T+1 Open -> T+20 Close (${manifest.evaluation_horizon_trading_days} Trading Days)`);
  console.log(`📌 Friction Accounting:    ${manifest.cost_friction_bps} bps (Commission + Tax + Slippage)\n`);

  const ledgerFiles = fs.readdirSync(ledgerDir).filter(f => f.endsWith(".json")).sort();
  console.log(`📁 Found ${ledgerFiles.length} Sealed Daily Ledger Records.\n`);

  const datasetPath = path.join(rootDir, "backtest", "dataset", "taiwan_equities_2018_2026.json");
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
  const benchmarkBars = dataset.benchmark_bars;

  const completedCohorts = [];
  const blindCohorts = [];

  for (const file of ledgerFiles) {
    const filePath = path.join(ledgerDir, file);
    const record = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const signalDate = record.signal_date;

    const sigIdx = benchmarkBars.findIndex(b => b.date === signalDate);
    if (sigIdx === -1) continue;

    const exitIdx = sigIdx + manifest.evaluation_horizon_trading_days;
    const elapsedTradingDays = benchmarkBars.length - 1 - sigIdx;

    // ──────────────────────────────────────────────────────────────────────────
    // BLIND EVALUATION MODE: If elapsed < 20 days, seal actual prices & PnL
    // ──────────────────────────────────────────────────────────────────────────
    if (exitIdx >= benchmarkBars.length) {
      blindCohorts.push({
        cohortDate: signalDate,
        blockSha: record.block_sha256.slice(0, 12) + "...",
        elapsed: `${elapsedTradingDays} / ${manifest.evaluation_horizon_trading_days} Days`,
        status: "🔒 LOCKED / WAITING (Predictions Sealed)",
        topPicks: record.top_picks.map(p => `${p.symbol} (#${p.rank})`).join(", "),
      });
      continue;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // COMPLETED COHORT: Full Realized Metric Evaluation
    // ──────────────────────────────────────────────────────────────────────────
    const benchEntry = benchmarkBars[sigIdx + 1];
    const benchExit = benchmarkBars[exitIdx];
    const benchReturnPct = ((benchExit.rawClose - benchEntry.rawOpen) / benchEntry.rawOpen) * 100;

    const fullCrossSection = record.full_cross_section;
    const realizedRows = [];

    for (const pred of fullCrossSection) {
      const bars = dataset.price_bars[pred.symbol];
      if (!bars) continue;

      const entryBar = bars.find(b => b.date === benchEntry.date);
      const exitBar = bars.find(b => b.date === benchExit.date);
      if (!entryBar || !exitBar) continue;

      const grossReturnPct = ((exitBar.rawClose - entryBar.rawOpen) / entryBar.rawOpen) * 100;
      const netReturnPct = grossReturnPct - (manifest.cost_friction_bps / 100);
      const excessReturnPct = grossReturnPct - benchReturnPct;

      realizedRows.push({
        rank: pred.rank,
        symbol: pred.symbol,
        name: pred.name,
        ensembleScore: pred.ensembleScore,
        grossReturnPct,
        netReturnPct,
        excessReturnPct,
      });
    }

    if (realizedRows.length >= 5) {
      const realizedRankIC = calculateSpearmanRankCorrelation(
        realizedRows.map(r => r.ensembleScore),
        realizedRows.map(r => r.excessReturnPct)
      );

      // Sort by prediction rank
      realizedRows.sort((a, b) => a.rank - b.rank);

      const topDecile = realizedRows.slice(0, Math.max(1, Math.floor(realizedRows.length * 0.10)));
      const bottomDecile = realizedRows.slice(-Math.max(1, Math.floor(realizedRows.length * 0.10)));

      const topDecileReturn = topDecile.reduce((a, b) => a + b.grossReturnPct, 0) / topDecile.length;
      const bottomDecileReturn = bottomDecile.reduce((a, b) => a + b.grossReturnPct, 0) / bottomDecile.length;
      const decileSpread = topDecileReturn - bottomDecileReturn;

      const top3Picks = realizedRows.slice(0, 3);
      const bottom3Picks = realizedRows.slice(-3);

      const longOnlyNetReturn = top3Picks.reduce((a, b) => a + b.netReturnPct, 0) / top3Picks.length;
      const shortSideReturn = bottom3Picks.reduce((a, b) => a + b.grossReturnPct, 0) / bottom3Picks.length;
      const longShortSpread = (top3Picks.reduce((a, b) => a + b.grossReturnPct, 0) / 3) - shortSideReturn;
      const hitRatePct = (top3Picks.filter(p => p.netReturnPct > 0).length / top3Picks.length) * 100;

      completedCohorts.push({
        signalDate,
        entryDate: benchEntry.date,
        exitDate: benchExit.date,
        realizedRankIC: Number(realizedRankIC.toFixed(4)),
        topDecileReturn: Number(topDecileReturn.toFixed(2)),
        bottomDecileReturn: Number(bottomDecileReturn.toFixed(2)),
        decileSpread: Number(decileSpread.toFixed(2)),
        longOnlyNetReturn: Number(longOnlyNetReturn.toFixed(2)),
        longShortSpread: Number(longShortSpread.toFixed(2)),
        benchmarkReturn: Number(benchReturnPct.toFixed(2)),
        netAlpha: Number((longOnlyNetReturn - benchReturnPct).toFixed(2)),
        hitRatePct: Number(hitRatePct.toFixed(1)),
      });
    }
  }

  // 1. Print Active Blind Cohorts Table
  if (blindCohorts.length > 0) {
    console.log("【1. Blind Incubation Cohorts (Hindsight-Free Protocol)】");
    console.log("┌─────────────┬────────────────┬─────────────────┬───────────────────────────────────────┐");
    console.log("│ Signal Date │ Sealed Block   │ Elapsed Days    │ Status / Top Picks (Blind)            │");
    console.log("├─────────────┼────────────────┼─────────────────┼───────────────────────────────────────┤");
    blindCohorts.forEach(c => {
      console.log(`│ ${c.cohortDate.padEnd(11)} │ ${c.blockSha.padEnd(14)} │ ${c.elapsed.padEnd(15)} │ ${c.status.padEnd(37)} │`);
    });
    console.log("└─────────────┴────────────────┴─────────────────┴───────────────────────────────────────┘\n");
  }

  // 2. Print Completed Realized Performance Table
  if (completedCohorts.length > 0) {
    console.log("【2. Completed Prospective Realized Cohorts (Full Metric Suite)】");
    console.log("┌─────────────┬─────────────┬────────────┬─────────────┬──────────────┬──────────────┬────────────┬──────────┐");
    console.log("│ Signal Date │ Exit Date   │ RealizedIC │ DecileSpread│ Long-Only Net│ Long-Short   │ Net Alpha  │ Hit Rate │");
    console.log("├─────────────┼─────────────┼────────────┼─────────────┼──────────────┼──────────────┼────────────┼──────────┤");
    completedCohorts.forEach(c => {
      console.log(
        `│ ${c.signalDate}  │ ${c.exitDate}  │ ${c.realizedRankIC >= 0 ? "+" : ""}${c.realizedRankIC.toFixed(4)} │ ${c.decileSpread >= 0 ? "+" : ""}${c.decileSpread.toFixed(2)}%     │ ${c.longOnlyNetReturn.toFixed(2).padStart(11)}% │ ${c.longShortSpread.toFixed(2).padStart(11)}% │ ${c.netAlpha.toFixed(2).padStart(9)}% │ ${c.hitRatePct.toFixed(1).padStart(7)}% │`
      );
    });
    console.log("└─────────────┴─────────────┴────────────┴─────────────┴──────────────┴──────────────┴────────────┴──────────┘\n");
  }
}

runProspectiveEvaluator().catch(console.error);
