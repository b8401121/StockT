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
  console.log(" 📊 StockT Prospective Paper Trading: 20-Day Cohort Realized Evaluation Engine   ");
  console.log("================================================================================\n");

  if (!fs.existsSync(manifestFile)) {
    console.error("❌ Freeze Manifest missing. Run npm run paper:record first.");
    process.exit(1);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
  console.log(`📌 Active Freeze Manifest: ${manifest.manifest_id} (Frozen on ${manifest.freeze_date})`);
  console.log(`📌 Model SHA-256:          ${manifest.model_hash}`);
  console.log(`📌 Horizon:                ${manifest.evaluation_horizon_trading_days} Trading Days (T+1 Open to T+20 Close)\n`);

  const ledgerFiles = fs.readdirSync(ledgerDir).filter(f => f.endsWith(".json")).sort();
  console.log(`📁 Found ${ledgerFiles.length} Immutable Daily Ledger Records.\n`);

  const datasetPath = path.join(rootDir, "backtest", "dataset", "taiwan_equities_2018_2026.json");
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
  const benchmarkBars = dataset.benchmark_bars;

  const evaluatedCohorts = [];

  for (const file of ledgerFiles) {
    const filePath = path.join(ledgerDir, file);
    const record = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const signalDate = record.signal_date;

    const sigIdx = benchmarkBars.findIndex(b => b.date === signalDate);
    if (sigIdx === -1) continue;

    const exitIdx = sigIdx + manifest.evaluation_horizon_trading_days;
    if (exitIdx >= benchmarkBars.length) {
      console.log(`⏳ Cohort [ ${signalDate} ]: Still active (Elapsed: ${benchmarkBars.length - 1 - sigIdx} / ${manifest.evaluation_horizon_trading_days} trading days)`);
      continue;
    }

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
      const rankIC = calculateSpearmanRankCorrelation(
        realizedRows.map(r => r.ensembleScore),
        realizedRows.map(r => r.excessReturnPct)
      );

      const top3Picks = realizedRows.slice(0, 3);
      const realizedNetReturn = top3Picks.reduce((a, b) => a + b.netReturnPct, 0) / top3Picks.length;
      const realizedExcessReturn = top3Picks.reduce((a, b) => a + b.excessReturnPct, 0) / top3Picks.length;

      evaluatedCohorts.push({
        signalDate,
        entryDate: benchEntry.date,
        exitDate: benchExit.date,
        benchmarkReturnPct: Number(benchReturnPct.toFixed(2)),
        realizedNetReturnPct: Number(realizedNetReturn.toFixed(2)),
        realizedExcessAlphaPct: Number(realizedExcessReturn.toFixed(2)),
        realizedRankIC: Number(rankIC.toFixed(4)),
        topPicks: top3Picks.map(p => `${p.symbol} (+${p.netReturnPct.toFixed(1)}%)`),
      });
    }
  }

  if (evaluatedCohorts.length > 0) {
    console.log("\n【Completed Prospective Cohorts Performance】");
    console.table(evaluatedCohorts);
  } else {
    console.log("\n💡 Note: All recorded prospective cohorts are currently in active incubation.");
    console.log("   As new daily trading bars arrive, this evaluator will automatically compute verified Realized PnL!");
  }
}

runProspectiveEvaluator().catch(console.error);
