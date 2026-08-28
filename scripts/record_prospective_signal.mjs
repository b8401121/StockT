import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createServer } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = "/run/media/sam/59AFFA8534FAE6A7/StockT";

const paperDir = path.join(rootDir, "backtest", "forward_paper_trading");
const ledgerDir = path.join(paperDir, "ledger");
const chainFile = path.join(paperDir, "audit_chain.jsonl");
const manifestFile = path.join(paperDir, "freeze_manifest.json");

if (!fs.existsSync(ledgerDir)) fs.mkdirSync(ledgerDir, { recursive: true });

function computeFileSha256(filePath) {
  const content = fs.readFileSync(filePath, "utf-8");
  return crypto.createHash("sha256").update(content).digest("hex");
}

function canonicalJson(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

async function runProspectiveRecorder() {
  console.log("================================================================================");
  console.log(" 🔒 StockT Prospective Paper Trading: Immutable Daily Signal Ledger Engine      ");
  console.log("================================================================================\n");

  const mlModelPath = path.join(rootDir, "src", "utils", "mlTreeModel.ts");
  const aiAlphaPath = path.join(rootDir, "src", "utils", "aiAlphaModel.ts");

  const modelHash = crypto.createHash("sha256")
    .update(fs.readFileSync(mlModelPath, "utf-8"))
    .update(fs.readFileSync(aiAlphaPath, "utf-8"))
    .digest("hex");

  // 1. Ensure Model Freeze Manifest
  let manifest;
  if (fs.existsSync(manifestFile)) {
    manifest = JSON.parse(fs.readFileSync(manifestFile, "utf-8"));
    console.log(`📌 Active Freeze Manifest: ${manifest.manifest_id}`);
    console.log(`📌 Frozen Model SHA-256:  ${manifest.model_hash}`);
    if (manifest.model_hash !== modelHash) {
      console.warn(`⚠️ Warning: Model source code has changed since freeze date (${manifest.freeze_date})!`);
    } else {
      console.log(`✅ Model Hash Intact (Strictly Frozen on ${manifest.freeze_date})\n`);
    }
  } else {
    manifest = {
      manifest_id: `MANIFEST-FREEZE-${Date.now()}`,
      freeze_date: "2026-08-29",
      freeze_timestamp: new Date().toISOString(),
      model_hash: modelHash,
      feature_schema: [
        "momentum20", "momentum60", "momentum120",
        "ma20Bias", "ma60Bias", "ma120Bias", "ma240Bias", "volumeRatio",
        "roe", "pe", "pb", "dividendYield", "grossMargins", "profitMargins", "debtToEquity"
      ],
      ensemble_weights: {
        rule_heuristic_pct: 60,
        ml_decision_tree_pct: 40,
      },
      evaluation_horizon_trading_days: 20,
      cost_friction_bps: 63.5,
      status: "FROZEN_PROSPECTIVE_EVALUATION"
    };
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), "utf-8");
    console.log(`✅ Initialized and Frozen Manifest at: ${manifestFile}\n`);
  }

  // 2. Load Evaluation Module via Vite SSR
  const viteServer = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
  });
  const { evaluateAIAlpha } = await viteServer.ssrLoadModule(aiAlphaPath);
  const { evaluateMLModel } = await viteServer.ssrLoadModule(mlModelPath);
  await viteServer.close();

  // 3. Load Current Market Data
  const datasetPath = path.join(rootDir, "backtest", "dataset", "taiwan_equities_2018_2026.json");
  const dataset = JSON.parse(fs.readFileSync(datasetPath, "utf-8"));
  const symbols = Object.keys(dataset.price_bars);
  
  // Use today's latest date from dataset
  const todayDate = "2026-08-28";
  console.log(`📅 Recording Immutable Prospective Signals for Signal Date: [ ${todayDate} ]`);

  const dailyPredictions = [];

  for (const sym of symbols) {
    const bars = dataset.price_bars[sym];
    const snapshots = dataset.stock_info_snapshots[sym] || {};
    const histBars = bars.filter(b => b.date <= todayDate);
    if (histBars.length < 20) continue;

    const snapInfo = snapshots[todayDate] || {};
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

    const ruleRes = evaluateAIAlpha(snapInfo, curP, prevP, ohlcv);

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

    const mlFeatures = {
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
    };

    const mlRes = evaluateMLModel(mlFeatures);

    const ensembleScore = ruleRes.rawProbabilityPct * 0.60 + mlRes.mlWinProbabilityPct * 0.40;

    dailyPredictions.push({
      symbol: sym,
      name: snapInfo.name || sym,
      closingPrice: curP,
      ruleScore: Number(ruleRes.rawProbabilityPct.toFixed(2)),
      mlScore: Number(mlRes.mlWinProbabilityPct.toFixed(2)),
      ensembleScore: Number(ensembleScore.toFixed(2)),
      predictedWinRate: ruleRes.winRatePct,
      expectedAlphaPct: ruleRes.expectedAlphaPct,
      features: mlFeatures,
      convictionTier: ruleRes.convictionTier,
    });
  }

  dailyPredictions.sort((a, b) => b.ensembleScore - a.ensembleScore);
  dailyPredictions.forEach((item, idx) => { item.rank = idx + 1; });

  // 4. Compute Previous Hash in Audit Chain
  let previousBlockSha = "0000000000000000000000000000000000000000000000000000000000000000";
  if (fs.existsSync(chainFile)) {
    const lines = fs.readFileSync(chainFile, "utf-8").trim().split("\n").filter(Boolean);
    if (lines.length > 0) {
      const lastBlock = JSON.parse(lines[lines.length - 1]);
      previousBlockSha = lastBlock.block_sha256;
    }
  }

  const ledgerPayload = {
    signal_date: todayDate,
    timestamp: new Date().toISOString(),
    manifest_id: manifest.manifest_id,
    model_hash: modelHash,
    universe_count: dailyPredictions.length,
    previous_block_sha256: previousBlockSha,
    top_picks: dailyPredictions.slice(0, 3).map(p => ({
      rank: p.rank,
      symbol: p.symbol,
      name: p.name,
      ensembleScore: p.ensembleScore,
      predictedWinRate: p.predictedWinRate,
    })),
    full_cross_section: dailyPredictions,
  };

  const payloadString = canonicalJson(ledgerPayload);
  const blockSha256 = crypto.createHash("sha256").update(payloadString).digest("hex");
  ledgerPayload.block_sha256 = blockSha256;

  // 5. Save Immutable Ledger File
  const dailyLedgerFile = path.join(ledgerDir, `${todayDate}.json`);
  fs.writeFileSync(dailyLedgerFile, JSON.stringify(ledgerPayload, null, 2), "utf-8");

  // 6. Append to Cryptographic Audit Chain
  const chainRecord = {
    signal_date: todayDate,
    timestamp: ledgerPayload.timestamp,
    model_hash: modelHash,
    block_sha256: blockSha256,
    previous_block_sha256: previousBlockSha,
    top_picks: ledgerPayload.top_picks,
  };
  fs.appendFileSync(chainFile, JSON.stringify(chainRecord) + "\n", "utf-8");

  console.log("┌──────┬───────────┬──────────────┬───────────────┬────────────┬─────────────┐");
  console.log("│ Rank │ Symbol    │ Name         │ EnsembleScore │ Win Rate % │ Conviction  │");
  console.log("├──────┼───────────┼──────────────┼───────────────┼────────────┼─────────────┤");
  dailyPredictions.forEach(p => {
    console.log(
      `│ #${p.rank.toString().padStart(2)} │ ${p.symbol.padEnd(9)} │ ${p.name.padEnd(12)} │ ${p.ensembleScore.toFixed(2).padStart(13)} │ ${p.predictedWinRate.toFixed(1).padStart(10)}% │ ${p.convictionTier.padEnd(11)} │`
    );
  });
  console.log("└──────┴───────────┴──────────────┴───────────────┴────────────┴─────────────┘\n");

  console.log(`🔒 Immutable Ledger Block SHA: ${blockSha256}`);
  console.log(`📁 Saved to: ${dailyLedgerFile}`);
  console.log(`🔗 Audit Chain Appended: ${chainFile}\n`);
}

runProspectiveRecorder().catch(console.error);
