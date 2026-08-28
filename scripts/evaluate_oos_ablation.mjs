import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = "/run/media/sam/59AFFA8534FAE6A7/StockT";

const datasetPath = path.join(rootDir, "backtest", "dataset", "taiwan_equities_2018_2026.json");
const configPath = path.join(rootDir, "backtest", "config.json");

if (!fs.existsSync(datasetPath) || !fs.existsSync(configPath)) {
  console.error("❌ Required dataset or config missing.");
  process.exit(1);
}

const datasetJson = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
const configJson = JSON.parse(fs.readFileSync(configPath, "utf-8"));

function calculateSpearmanRankCorrelation(x, y) {
  const n = x.length;
  if (n < 3) return 0;

  function getRanks(arr) {
    const sorted = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    sorted.forEach((item, rank) => {
      ranks[item.i] = rank + 1;
    });
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

async function runAblationStudy() {
  console.log("========================================================");
  console.log(" 🔬 StockT ML vs Rule vs Ensemble OOS Ablation Study    ");
  console.log("========================================================");
  console.log("📌 Dataset: taiwan_equities_2018_2026.json (PIT 56 MB)");
  console.log("📌 OOS Period: 2025-01-01 to 2026-08-28 (Locked Out-of-Sample)");
  console.log("📌 Transaction Costs: Commission 14.25 bps + Tax 30 bps + Slippage 5 bps\n");

  const viteServer = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });

  const { evaluateAIAlpha } = await viteServer.ssrLoadModule(
    path.join(rootDir, "src", "utils", "aiAlphaModel.ts")
  );
  const { evaluateMLModel } = await viteServer.ssrLoadModule(
    path.join(rootDir, "src", "utils", "mlTreeModel.ts")
  );
  await viteServer.close();

  const benchmarkBars = datasetJson.benchmark_bars;
  const symbols = Object.keys(datasetJson.price_bars);
  
  const oosTradingDays = benchmarkBars
    .filter(b => b.date >= "2025-01-01" && b.date <= "2026-08-28")
    .map(b => b.date);

  const cohortDates = [];
  for (let i = 0; i < oosTradingDays.length - 20; i += 20) {
    cohortDates.push(oosTradingDays[i]);
  }

  console.log(`📊 Evaluating ${cohortDates.length} OOS Cohorts across ${symbols.length} benchmark securities...\n`);

  const MIXTURES = [
    { id: "pure_rule", label: "Rule 100% (Heuristic Multi-Factor)", wRule: 1.0, wML: 0.0 },
    { id: "rule_80_ml_20", label: "Rule 80% / ML 20%", wRule: 0.8, wML: 0.2 },
    { id: "ensemble_60_40", label: "Rule 60% / ML 40% (StockT Default)", wRule: 0.6, wML: 0.4 },
    { id: "ensemble_50_50", label: "Rule 50% / ML 50% (Balanced)", wRule: 0.5, wML: 0.5 },
    { id: "rule_40_ml_60", label: "Rule 40% / ML 60%", wRule: 0.4, wML: 0.6 },
    { id: "rule_20_ml_80", label: "Rule 20% / ML 80%", wRule: 0.2, wML: 0.8 },
    { id: "pure_ml", label: "ML 100% (8-Tree GBDT + Ridge Interaction)", wRule: 0.0, wML: 1.0 },
  ];

  const results = [];

  for (const mix of MIXTURES) {
    const icList = [];
    const cohortReturns = [];
    const decileReturns = { top10: [], bottom10: [] };
    let cumulativeNetReturn = 0;
    let peakReturn = 0;
    let maxDrawdownPct = 0;
    let totalTrades = 0;
    let winTrades = 0;

    for (const signalDate of cohortDates) {
      const signalIdx = benchmarkBars.findIndex(b => b.date === signalDate);
      const exitIdx = signalIdx + 20;
      if (exitIdx >= benchmarkBars.length) continue;

      const benchEntry = benchmarkBars[signalIdx + 1]; // T+1 Open
      const benchExit = benchmarkBars[exitIdx];         // T+20 Close
      const benchReturnPct = ((benchExit.rawClose - benchEntry.rawOpen) / benchEntry.rawOpen) * 100;

      const stockPredictions = [];

      for (const sym of symbols) {
        const bars = datasetJson.price_bars[sym];
        const snapshots = datasetJson.stock_info_snapshots[sym] || {};
        
        const histBars = bars.filter(b => b.date <= signalDate);
        if (histBars.length < 20) continue;

        const snapInfo = snapshots[signalDate] || {};
        const curP = histBars[histBars.length - 1].rawClose;
        const prevP = histBars.length > 1 ? histBars[histBars.length - 2].rawClose : curP;

        const ohlcv = {
          timestamp: histBars.map(b => new Date(b.date).getTime() / 1000),
          open: histBars.map(b => b.rawOpen),
          high: histBars.map(b => b.rawHigh),
          low: histBars.map(b => b.rawLow),
          close: histBars.map(b => b.adjustedClose),
          volume: histBars.map(b => b.volume),
        };

        const ruleResult = evaluateAIAlpha(snapInfo, curP, prevP, ohlcv);
        
        // ML Features
        const c = ohlcv.close;
        const m20 = c.length >= 20 ? ((c[c.length - 1] - c[c.length - 20]) / c[c.length - 20]) : 0;
        const m60 = c.length >= 60 ? ((c[c.length - 1] - c[c.length - 60]) / c[c.length - 60]) : 0;
        const m120 = c.length >= 120 ? ((c[c.length - 1] - c[c.length - 120]) / c[c.length - 120]) : 0;
        const ma20 = c.length >= 20 ? (c.slice(-20).reduce((a, b) => a + b, 0) / 20) : null;
        const ma60 = c.length >= 60 ? (c.slice(-60).reduce((a, b) => a + b, 0) / 60) : null;
        const ma120 = c.length >= 120 ? (c.slice(-120).reduce((a, b) => a + b, 0) / 120) : null;
        const ma240 = c.length >= 240 ? (c.slice(-240).reduce((a, b) => a + b, 0) / 240) : null;
        const v5 = ohlcv.volume.slice(-5).reduce((a, b) => a + b, 0) / 5;
        const v20 = ohlcv.volume.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const vRatio = v20 > 0 ? v5 / v20 : 1.0;

        const mlResult = evaluateMLModel({
          momentum20: m20,
          momentum60: m60,
          momentum120: m120,
          ma20Bias: ma20 ? (curP - ma20) / ma20 : 0,
          ma60Bias: ma60 ? (curP - ma60) / ma60 : 0,
          ma120Bias: ma120 ? (curP - ma120) / ma120 : 0,
          ma240Bias: ma240 ? (curP - ma240) / ma240 : 0,
          volumeRatio: vRatio,
          roe: (snapInfo.roe?.value ?? 15.0) / 100,
          pe: snapInfo.pe?.value ?? 18.0,
          pb: snapInfo.pb?.value ?? 2.5,
          dividendYield: (snapInfo.dividend_yield?.value ?? 3.5) / 100,
          grossMargins: (snapInfo.gross_margins?.value ?? 30.0) / 100,
          profitMargins: (snapInfo.profit_margins?.value ?? 15.0) / 100,
          debtToEquity: snapInfo.debt_to_equity?.value ?? 45.0,
        });

        // Combined Score
        const combinedScore = ruleResult.rawProbabilityPct * mix.wRule + mlResult.mlWinProbabilityPct * mix.wML;

        // Actual Forward Return
        const entryBar = bars.find(b => b.date === benchEntry.date);
        const exitBar = bars.find(b => b.date === benchExit.date);
        if (!entryBar || !exitBar) continue;

        const actualGrossReturnPct = ((exitBar.rawClose - entryBar.rawOpen) / entryBar.rawOpen) * 100;
        const actualNetReturnPct = actualGrossReturnPct - 0.635;
        const actualExcessReturnPct = actualGrossReturnPct - benchReturnPct;

        stockPredictions.push({
          sym,
          combinedScore,
          actualNetReturnPct,
          actualExcessReturnPct,
        });
      }

      if (stockPredictions.length >= 5) {
        const scores = stockPredictions.map(s => s.combinedScore);
        const excessReturns = stockPredictions.map(s => s.actualExcessReturnPct);
        const ic = calculateSpearmanRankCorrelation(scores, excessReturns);
        icList.push(ic);

        stockPredictions.sort((a, b) => b.combinedScore - a.combinedScore);

        const topPicks = stockPredictions.slice(0, 3);
        const cohortAvgNetReturn = topPicks.reduce((a, b) => a + b.actualNetReturnPct, 0) / topPicks.length;
        cohortReturns.push(cohortAvgNetReturn);

        topPicks.forEach(t => {
          totalTrades++;
          if (t.actualNetReturnPct > 0) winTrades++;
        });

        decileReturns.top10.push(stockPredictions[0].actualNetReturnPct);
        decileReturns.bottom10.push(stockPredictions[stockPredictions.length - 1].actualNetReturnPct);

        cumulativeNetReturn += cohortAvgNetReturn;
        if (cumulativeNetReturn > peakReturn) peakReturn = cumulativeNetReturn;
        const dd = cumulativeNetReturn - peakReturn;
        if (dd < maxDrawdownPct) maxDrawdownPct = dd;
      }
    }

    const meanIC = icList.reduce((a, b) => a + b, 0) / icList.length;
    const stdIC = Math.sqrt(icList.reduce((a, b) => a + Math.pow(b - meanIC, 2), 0) / icList.length) || 0.01;
    const icir = meanIC / stdIC;

    const netTotalReturnPct = cumulativeNetReturn;
    const annualizedVol = Math.sqrt(252 / 20) * (Math.sqrt(cohortReturns.reduce((a, b) => a + Math.pow(b - (cumulativeNetReturn / cohortReturns.length), 2), 0) / cohortReturns.length) || 1.0);
    const sharpe = (netTotalReturnPct / Math.max(1, annualizedVol)).toFixed(2);
    const winRatePct = totalTrades > 0 ? (winTrades / totalTrades) * 100 : 0;

    const qTop10Mean = decileReturns.top10.reduce((a, b) => a + b, 0) / decileReturns.top10.length;
    const qBottom10Mean = decileReturns.bottom10.reduce((a, b) => a + b, 0) / decileReturns.bottom10.length;
    const decileSpread = qTop10Mean - qBottom10Mean;

    results.push({
      mixture: mix.label,
      rankIC: Number(meanIC.toFixed(4)),
      icir: Number(icir.toFixed(2)),
      netTotalReturnPct: Number(netTotalReturnPct.toFixed(2)),
      sharpeRatio: Number(sharpe),
      maxDrawdownPct: Number(maxDrawdownPct.toFixed(2)),
      winRatePct: Number(winRatePct.toFixed(1)),
      topDecileReturnPct: Number(qTop10Mean.toFixed(2)),
      bottomDecileReturnPct: Number(qBottom10Mean.toFixed(2)),
      decileSpreadPct: Number(decileSpread.toFixed(2)),
      decileMonotonic: qTop10Mean > qBottom10Mean,
    });
  }

  console.log("┌───────────────────────────────────────────────┬─────────┬──────┬────────────┬────────┬─────────┬──────────┬──────────────┐");
  console.log("│ Mixture Strategy Configuration                │ Rank IC │ ICIR │ Net Return │ Sharpe │ Max DD  │ Win Rate │ DecileSpread │");
  console.log("├───────────────────────────────────────────────┼─────────┼──────┼────────────┼────────┼─────────┼──────────┼──────────────┤");
  for (const r of results) {
    console.log(
      `│ ${r.mixture.padEnd(45)} │ ${r.rankIC >= 0 ? "+" : ""}${r.rankIC.toFixed(4)} │ ${r.icir.toFixed(2).padStart(4)} │ ${r.netTotalReturnPct.toFixed(2).padStart(9)}% │ ${r.sharpeRatio.toFixed(2).padStart(6)} │ ${r.maxDrawdownPct.toFixed(2).padStart(6)}% │ ${r.winRatePct.toFixed(1).padStart(7)}% │ ${r.decileSpreadPct >= 0 ? "+" : ""}${r.decileSpreadPct.toFixed(2).padStart(11)}% │`
    );
  }
  console.log("└───────────────────────────────────────────────┴─────────┴──────┴────────────┴────────┴─────────┴──────────┴──────────────┘\n");

  const outJsonPath = path.join(rootDir, "backtest", "oos_ablation_report.json");
  fs.writeFileSync(outJsonPath, JSON.stringify({
    metadata: {
      generatedAt: new Date().toISOString(),
      evaluationPeriod: "2025-01-01 to 2026-08-28 (Locked Out-of-Sample)",
      frictionBps: 63.5,
      benchmark: "TAIEX Synchronized T+1 to T+20",
    },
    ablationResults: results,
  }, null, 2), "utf-8");

  console.log(`✅ OOS Ablation Study JSON Report saved to: ${outJsonPath}`);
}

runAblationStudy().catch(console.error);
