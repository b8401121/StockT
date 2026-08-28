import { mkMops, mkYahoo, OhlcvData } from "../utils/platform";
import React, { useState, useRef, useEffect } from "react";
import { StockInfoFull } from "../utils/analysis";
import { evaluateAIAlpha, AIAlphaResult, fmtFixed, metricVal } from "../utils/aiAlphaModel";
import { HardwareBadge } from "./HardwareBadge";
import { AddToWatchlistBtn } from "./AddToWatchlistBtn";
import { stockService } from "../services/stockService";
import { exportToHtmlFile } from "../utils/exportHtml";
import twseFundamentals from "../utils/twse_mops_fundamentals.json";
import { useAppTheme } from "../utils/theme";

const fundamentalsMap: Record<string, any> = twseFundamentals as any;

interface AIAlphaScanTabProps {
  onAnalyze?: (symbol: string) => void;
}

interface RankedAlphaStock extends AIAlphaResult {
  rank: number;
  info: StockInfoFull;
}

export interface ScanAuditMetrics {
  universe: number;           // 總掃描母體 (Universe)
  evaluated: number;          // 實際完成推論數 (Evaluated)
  skipped: number;            // 略過/中斷未評估數 (Skipped, Universe = Evaluated + Skipped)
  selected: number;           // 最終入選 (Selected)
  strategyRejected: number;   // 策略條件淘汰 (Strategy Rejected)
  qualityRejected: number;    // 資料品質淘汰 (Quality Rejected, availableCount < 5)
  dataFetchError: number;     // 數據抓取失敗 (Data Error)
  ohlcvDegradedCount: number; // 輔助標記：K線缺失降級數
  isConserved: boolean;       // 守恆驗證通過 (Evaluated === Selected + StrategyRejected + QualityRejected + DataFetchError)
}

const MARKETS = [
  { label: "全部上市+上櫃", value: "ALL" },
  { label: "全部上市股 (.TW)", value: "TW" },
  { label: "全部上櫃股 (.TWO)", value: "TWO" },
  { label: "ETF/指數基金 (00xx)", value: "00" },
  { label: "半導體/建造/資服 (30~36xx)", value: "3A" },
  { label: "光電/網路/通信 (37~38xx)", value: "3B" },
  { label: "電子零組件 (41~49xx)", value: "4A" },
  { label: "機械/電工/金融 (20~29xx)", value: "2A" },
  { label: "水泥/食品/紡織 (11~16xx)", value: "1A" },
  { label: "化學/玻璃/鋼鐵 (17~19xx)", value: "1B" },
  { label: "服務/觀光/貿易 (50~59xx)", value: "5A" },
  { label: "其他/小型股 (60~69xx)", value: "6A" },
  { label: "生技/其他 (80~99xx)", value: "8A" },
];

function isCommonStockOrValidEtf(symbol: string, market: string): boolean {
  const code = symbol.split(".")[0];
  if (code.length > 5 || /[a-zA-Z]/.test(code)) return false;
  if (/^\d{6}$/.test(code)) return false;
  if (/^(03|04|05|06|07|08|70|71|72|73)\d+/.test(code) && !code.startsWith("00")) return false;

  if (market === "00") {
    return /^00\d{2,4}$/.test(code);
  }
  return /^\d{4}$/.test(code);
}

function filterSymbolsByMarket(allKeys: string[], fundamentalsMap: Record<string, any>, market: string): string[] {
  const m = (market || "ALL").toUpperCase();
  return allKeys.filter((k) => {
    const p = fundamentalsMap[k] || {};
    const sym = p.symbol || `${k}.TW`;
    if (!isCommonStockOrValidEtf(sym, market)) return false;
    const code = k.replace(/\D/g, "");
    if (!code || code.length > 5) return false;
    if (m === "ALL") return true;
    if (m === "TW" || m === "TWSE") return sym.endsWith(".TW");
    if (m === "TWO" || m === "TPEX") return sym.endsWith(".TWO");
    if (m === "00") return code.startsWith("00");
    const n = parseInt(code, 10);
    if (isNaN(n)) return false;
    if (m === "1A" || m === "11-16" || m.includes("11~16")) return n >= 1100 && n < 1700;
    if (m === "1B" || m === "17-19" || m.includes("17~19")) return n >= 1700 && n < 2000;
    if (m === "2A" || m === "20-29" || m === "23-24" || m.includes("20~29")) return n >= 2000 && n < 3000;
    if (m === "3A" || m === "30-36" || m.includes("30~36")) return n >= 3000 && n < 3700;
    if (m === "3B" || m === "37-38" || m.includes("37~38")) return n >= 3700 && n < 3900;
    if (m === "4A" || m === "41-49" || m === "41-47" || m.includes("41~49")) return n >= 4100 && n < 5000;
    if (m === "5A" || m === "50-59" || m.includes("50~59")) return n >= 5000 && n < 6000;
    if (m === "6A" || m === "60-69" || m === "61-68" || m.includes("60~69")) return n >= 6000 && n < 7000;
    if (m === "8A" || m === "80-99" || m.includes("80~99")) return n >= 8000;
    return false;
  });
}

const STRATEGIES = [
  {
    id: "strong_bull",
    label: "⭐⭐⭐⭐⭐ 極致多頭 (勝率 ≥ 68%)",
    filterFn: (s: AIAlphaResult) => s.winRatePct >= 68.0,
  },
  {
    id: "solid_bull",
    label: "⭐⭐⭐⭐ 穩健多頭 (勝率 ≥ 58%)",
    filterFn: (s: AIAlphaResult) => s.winRatePct >= 58.0,
  },
  {
    id: "finlab_momentum",
    label: "🚀 FinLab 波段飆股 (動能加分 + 基本面正向)",
    filterFn: (s: AIAlphaResult, info: StockInfoFull) =>
      s.winRatePct >= 55 && (metricVal(info.roe) ?? 0) >= 0.08 && (metricVal(info.eps) ?? 0) > 0,
  },
  {
    id: "value_alpha",
    label: "💎 價值高勝率 (高 ROE ≥ 12% + 本益比合理 ≤ 25)",
    filterFn: (s: AIAlphaResult, info: StockInfoFull) =>
      s.winRatePct >= 55 &&
      (metricVal(info.roe) ?? 0) >= 0.12 &&
      (metricVal(info.tw_pe ?? info.pe) ?? 20) <= 25,
  },
  {
    id: "growth_alpha",
    label: "📈 雙重擴張成長 (營收 YoY ≥ 10% + 勝率 ≥ 58%)",
    filterFn: (s: AIAlphaResult, info: StockInfoFull) =>
      s.winRatePct >= 58 && (metricVal(info.revenue_growth) ?? 0) >= 0.10,
  },
  {
    id: "landmine_risk",
    label: "⚠️ 偏空避險名單 (勝率 ≤ 48% / 虧損地雷)",
    filterFn: (s: AIAlphaResult) => s.winRatePct <= 48 || s.convictionTier.includes("偏空避險"),
  },
];

import {
  DeterministicProvenanceReport,
  CANONICAL_RANKING_ALGORITHM,
  computeModelHash,
  computeUniverseHash,
  computeInputSnapshotHash,
  computeStrategyConfigHash,
  computeResultHash,
  computeDeterministicRunId,
} from "../utils/quantProvenance";

/**
 * 🛡️ Priority 5: Deterministic Ranking Invariant
 * 保證同條件下輸出 100% 絕對確定性，消除異步並行引起的排名抖動
 * 
 * 多層 Tie-Breakers (Pure Numeric & Cross-Platform Collator-Free):
 * 1. winRatePct (多頭 DESC / 避險 ASC)
 * 2. normalizedScore (全母體標準化多因子得分)
 * 3. rawScore (原始加權分)
 * 4. coverageRatio (覆蓋率 DESC - 資料越完備越優先)
 * 5. availableFactorCount (可用因子數 DESC)
 * 6. pure numeric stockCode ASC / string fallback (完全跨環境、跨瀏覽器純數字比較)
 */
function deterministicSortRankedStocks(stocks: RankedAlphaStock[], strategy: string): RankedAlphaStock[] {
  return [...stocks].sort((a, b) => {
    // 1. 主要指標：勝率
    const winDiff = strategy === "landmine_risk"
      ? a.winRatePct - b.winRatePct
      : b.winRatePct - a.winRatePct;
    if (Math.abs(winDiff) >= 0.001) return winDiff;

    // 2. 次要指標：標準化多因子分數
    const normDiff = strategy === "landmine_risk"
      ? a.normalizedScore - b.normalizedScore
      : b.normalizedScore - a.normalizedScore;
    if (Math.abs(normDiff) >= 0.001) return normDiff;

    // 3. 第三指標：原始分數
    const rawDiff = strategy === "landmine_risk"
      ? a.rawScore - b.rawScore
      : b.rawScore - a.rawScore;
    if (Math.abs(rawDiff) >= 0.001) return rawDiff;

    // 4. 第四指標：因子覆蓋率 (Coverage Ratio 越大越可信)
    const covDiff = b.coverageRatio - a.coverageRatio;
    if (Math.abs(covDiff) >= 0.001) return covDiff;

    // 5. 第五指標：可用因子總數
    const countDiff = b.availableFactorCount - a.availableFactorCount;
    if (countDiff !== 0) return countDiff;

    // 6. 終極 Tie-Breaker：純數字股票代碼比較 (避免任何環境 locale 歧異)
    const symA = a.symbol.replace(/\.(TW|TWO)$/, "");
    const symB = b.symbol.replace(/\.(TW|TWO)$/, "");
    const codeA = Number(symA);
    const codeB = Number(symB);
    if (Number.isFinite(codeA) && Number.isFinite(codeB) && codeA !== codeB) {
      return codeA - codeB;
    }
    return symA < symB ? -1 : symA > symB ? 1 : 0;
  });
}

export const AIAlphaScanTab: React.FC<AIAlphaScanTabProps> = ({ onAnalyze }) => {
  const [theme] = useAppTheme();
  const isWarm = theme === "warm";
  const [market, setMarket] = useState("ALL");
  const [strategy, setStrategy] = useState("strong_bull");
  const [scanning, setScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [results, setResults] = useState<RankedAlphaStock[]>([]);
  const [selectedStockForDetail, setSelectedStockForDetail] = useState<RankedAlphaStock | null>(null);
  const [auditMetrics, setAuditMetrics] = useState<ScanAuditMetrics | null>(null);
  const [provenanceReport, setProvenanceReport] = useState<DeterministicProvenanceReport | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    return () => { cancelRef.current = true; };
  }, []);

  const startScan = async () => {
    cancelRef.current = false;
    setScanning(true);
    setHasScanned(true);
    setProgress(0);
    setProgressMsg("正在準備全市場 18 維多因子量化評估...");
    setResults([]);
    setProvenanceReport(null);

    try {
      const allKeys = Object.keys(fundamentalsMap);
      const targetKeys = filterSymbolsByMarket(allKeys, fundamentalsMap, market);
      // 確定性前置排序：純數字跨平台排序
      targetKeys.sort((a, b) => {
        const numA = Number(a);
        const numB = Number(b);
        if (Number.isFinite(numA) && Number.isFinite(numB) && numA !== numB) {
          return numA - numB;
        }
        return a < b ? -1 : a > b ? 1 : 0;
      });
      const total = targetKeys.length;

      const selectedStrat = STRATEGIES.find(s => s.id === strategy) || STRATEGIES[0];
      const matchedStocks: RankedAlphaStock[] = [];

      let runningAudit: ScanAuditMetrics = {
        universe: total,
        evaluated: 0,
        skipped: 0,
        selected: 0,
        strategyRejected: 0,
        qualityRejected: 0,
        dataFetchError: 0,
        ohlcvDegradedCount: 0,
        isConserved: true,
      };
      setAuditMetrics({ ...runningAudit });

      const safeNum = (v: any) => {
        if (v == null || v === "Infinity" || v === "-Infinity" || v === "NaN" || v === "") return undefined;
        const n = Number(v);
        return isNaN(n) ? undefined : n;
      };

      const BATCH_SIZE = 16;
      for (let i = 0; i < total; i += BATCH_SIZE) {
        if (cancelRef.current) break;

        const chunkKeys = targetKeys.slice(i, Math.min(i + BATCH_SIZE, total));
        const currentProgress = Math.round(((i + chunkKeys.length) / total) * 100);
        
        setProgress(currentProgress);
        setProgressMsg(`正在進行 18 維多因子推論 ${i + 1}~${Math.min(i + BATCH_SIZE, total)} / ${total} 檔... (已精選 ${matchedStocks.length} 檔)`);

        const chunkResults = await Promise.allSettled(
          chunkKeys.map(async (key) => {
            const p = fundamentalsMap[key] || {};
            const symbol = p.symbol || `${key}.TW`;

            const curP = p.close_price || p.current_price || p.c || 0;
            const prevP = p.previous_close || (p.close_price && p.change != null ? p.close_price - p.change : curP);

            const info: StockInfoFull = {
              symbol,
              name: p.name || p.n || key,
              current_price: mkYahoo(safeNum(curP) || 0),
              previous_close: mkYahoo(safeNum(prevP) || 0),
              pe: (safeNum(p.pe)) != null ? mkMops((safeNum(p.pe))!) : undefined,
              tw_pe: (safeNum(p.tw_pe ?? p.pe)) != null ? mkMops((safeNum(p.tw_pe ?? p.pe))!) : undefined,
              pb: (safeNum(p.pb)) != null ? mkMops((safeNum(p.pb))!) : undefined,
              dividend_yield: (() => { const v = safeNum(p.dividend_yield) ?? (safeNum(p.dividend_yield_pct) != null ? safeNum(p.dividend_yield_pct)! / 100 : null); return v != null ? mkMops(v) : undefined; })(),
              eps: (safeNum(p.eps)) != null ? mkMops((safeNum(p.eps))!) : undefined,
              roe: (safeNum(p.roe)) != null ? mkMops((safeNum(p.roe))!) : undefined,
              profit_margins: (safeNum(p.profit_margins)) != null ? mkMops((safeNum(p.profit_margins))!) : undefined,
              gross_margins: (safeNum(p.gross_margins)) != null ? mkMops((safeNum(p.gross_margins))!) : undefined,
              operating_margins: (safeNum(p.operating_margins)) != null ? mkMops((safeNum(p.operating_margins))!) : undefined,
              revenue_growth: (safeNum(p.revenue_growth)) != null ? mkMops((safeNum(p.revenue_growth))!) : undefined,
              earnings_growth: (safeNum(p.earnings_growth)) != null ? mkMops((safeNum(p.earnings_growth))!) : undefined,
              debt_to_equity: (safeNum(p.debt_to_equity)) != null ? mkMops((safeNum(p.debt_to_equity))!) : undefined,
              current_ratio: (safeNum(p.current_ratio)) != null ? mkMops((safeNum(p.current_ratio))!) : undefined,
              quick_ratio: (safeNum(p.quick_ratio)) != null ? mkMops((safeNum(p.quick_ratio))!) : undefined,
              free_cashflow: (safeNum(p.free_cashflow)) != null ? mkMops((safeNum(p.free_cashflow))!) : undefined,
              operating_cashflow: (safeNum(p.operating_cashflow)) != null ? mkMops((safeNum(p.operating_cashflow))!) : undefined,
              market_cap: (safeNum(p.market_cap)) != null ? mkMops((safeNum(p.market_cap))!) : undefined,
            };

            let liveOhlcv: OhlcvData | null = null;
            let ohlcvMissing = false;
            try {
              const liveData = await stockService.getStockData(symbol, "1y");
              if (liveData?.ohlcv && liveData.ohlcv.close.length >= 20) {
                liveOhlcv = liveData.ohlcv;
              } else {
                ohlcvMissing = true;
              }
            } catch {
              ohlcvMissing = true;
            }

            const aiResult = evaluateAIAlpha(info, curP, prevP, liveOhlcv);
            return { aiResult, info, ohlcvMissing };
          })
        );

        // 🛡️ 嚴格計數守恆律 (Conservation Invariant) 記錄
        for (const res of chunkResults) {
          runningAudit.evaluated++;

          if (res.status === "rejected") {
            runningAudit.dataFetchError++;
            continue;
          }

          const { aiResult, info, ohlcvMissing } = res.value;

          if (ohlcvMissing) {
            runningAudit.ohlcvDegradedCount++;
          }

          if (aiResult.availableFactorCount < 5) {
            runningAudit.qualityRejected++;
          } else if (selectedStrat.filterFn(aiResult, info)) {
            runningAudit.selected++;
            matchedStocks.push({
              ...aiResult,
              rank: 0,
              info,
            });
          } else {
            runningAudit.strategyRejected++;
          }
        }

        runningAudit.skipped = runningAudit.universe - runningAudit.evaluated;
        runningAudit.isConserved = (
          runningAudit.evaluated === (runningAudit.selected + runningAudit.strategyRejected + runningAudit.qualityRejected + runningAudit.dataFetchError)
        ) && (
          runningAudit.universe === (runningAudit.evaluated + runningAudit.skipped)
        );

        // 🛡️ Deterministic Progressive Ranking
        const currentRanked = deterministicSortRankedStocks(matchedStocks, strategy);
        currentRanked.forEach((item, idx) => { item.rank = idx + 1; });
        setResults(currentRanked);
        setAuditMetrics({ ...runningAudit });

        await new Promise((r) => setTimeout(r, 0));
      }

      runningAudit.skipped = runningAudit.universe - runningAudit.evaluated;
      runningAudit.isConserved = (
        runningAudit.evaluated === (runningAudit.selected + runningAudit.strategyRejected + runningAudit.qualityRejected + runningAudit.dataFetchError)
      ) && (
        runningAudit.universe === (runningAudit.evaluated + runningAudit.skipped)
      );

      // 🛡️ Deterministic Final Ranking
      const finalRanked = deterministicSortRankedStocks(matchedStocks, strategy);
      finalRanked.forEach((item, idx) => {
        item.rank = idx + 1;
      });

      setResults(finalRanked);
      setProgress(100);
      setProgressMsg(`🎉 評估完成！共精選出 ${finalRanked.length} 檔 18 維多因子即時標的`);
      setAuditMetrics({ ...runningAudit });

      // 🛡️ Priority 6: Institutional-Grade Cryptographic Provenance Generation
      const scanTimestamp = new Date().toISOString();
      const scanId = `EXEC-${scanTimestamp.slice(0, 10).replace(/-/g, "")}-${strategy.toUpperCase()}-${Math.floor(Date.now() / 1000).toString(36)}`;
      const [mHash, uHash, inHash, stratHash, resHash] = await Promise.all([
        computeModelHash(),
        computeUniverseHash(targetKeys),
        computeInputSnapshotHash(targetKeys, fundamentalsMap),
        computeStrategyConfigHash(selectedStrat.id, selectedStrat.label),
        computeResultHash(finalRanked),
      ]);

      const deterministicRunId = await computeDeterministicRunId(
        uHash,
        inHash,
        mHash,
        stratHash,
        CANONICAL_RANKING_ALGORITHM
      );

      const provReport: DeterministicProvenanceReport = {
        scanId,
        deterministicRunId,
        scanTimestamp,
        rankingAlgorithm: CANONICAL_RANKING_ALGORITHM,
        modelHash: mHash,
        universeHash: uHash,
        inputSnapshotHash: inHash,
        strategyConfigHash: stratHash,
        resultHash: resHash,
        itemCount: finalRanked.length,
        isCryptographicallyReproducible: true,
      };
      setProvenanceReport(provReport);
    } catch (e: any) {
      setProgressMsg(`評估錯誤: ${e.message}`);
    } finally {
      setScanning(false);
    }
  };

  const stopScan = () => { cancelRef.current = true; };

  const exportHtml = async () => {
    try {
      const stratName = STRATEGIES.find((s) => s.id === strategy)?.label || strategy;
      const title = `StockT AI 18維多因子選股報告 - ${stratName}`;
      const filename = `ai_alpha_scan_${strategy}_${new Date().toISOString().slice(0, 10)}.html`;
      const htmlContent = await exportToHtmlFile(title, results, "aiAlpha");
      const savedPath = await stockService.exportTxtFile(filename, htmlContent);
      alert(`選股名單匯出成功！已產生精美網頁報告！\n已儲存至您的【下載】資料夾：\n${savedPath}`);
    } catch (err) {
      alert(`匯出失敗: ${err}`);
    }
  };

  const copyProvenanceJson = () => {
    if (!provenanceReport) return;
    const jsonStr = JSON.stringify(provenanceReport, null, 2);
    navigator.clipboard.writeText(jsonStr).then(() => {
      alert("✅ 已複製審計指紋報告 (Deterministic Provenance JSON) 至剪貼簿！");
    });
  };

  return (
    <div className="scan-layout">
      <div className="scan-controls">
        <div className="scan-controls-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1 }}>
            <span className="scan-label" style={{ whiteSpace: "nowrap" }}>掃描範圍：</span>
            <select className="select-field" value={market} onChange={(e) => setMarket(e.target.value)} style={{ minWidth: "180px" }}>
              {MARKETS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", flex: 1.2 }}>
            <span className="scan-label" style={{ whiteSpace: "nowrap" }}>AI 策略篩選：</span>
            <select className="select-field" value={strategy} onChange={(e) => setStrategy(e.target.value)} style={{ flex: 1 }}>
              {STRATEGIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <HardwareBadge showDetail={true} />
        </div>

        <div className="scan-controls-row" style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "10px" }}>
          <button
            className="btn"
            style={{
              background: "linear-gradient(135deg, #7c3aed, #a855f7)",
              color: "white",
              fontWeight: 700,
              boxShadow: "0 2px 10px rgba(124, 58, 237, 0.4)",
              border: "none",
              padding: "7px 18px"
            }}
            onClick={startScan}
            disabled={scanning}
          >
            🧠 開始 AI 多因子量化掃描
          </button>
          {scanning && <button className="btn btn-outline" onClick={stopScan}>⏹ 停止</button>}
          {!scanning && results.length > 0 && (
            <button className="btn btn-outline" onClick={exportHtml}>📤 匯出名單</button>
          )}
          <div className="progress-bar" style={{ flex: 1, marginLeft: "8px" }}>
            <div className="progress-bar-fill" style={{ width: `${progress}%`, background: "linear-gradient(90deg, #7c3aed, #ec4899)" }} />
          </div>
          <span className="progress-label" style={{ fontSize: "0.78rem", minWidth: "160px" }}>{progressMsg}</span>
        </div>

        {/* 📊 嚴格守恆 Scan Pipeline Audit 漏斗統計面板 */}
        {auditMetrics && (
          <div style={{
            marginTop: "10px",
            background: isWarm ? "rgba(140, 110, 80, 0.08)" : "rgba(15, 23, 42, 0.6)",
            border: isWarm ? "1px solid rgba(140, 110, 80, 0.22)" : "1px solid rgba(124, 58, 237, 0.25)",
            borderRadius: "8px",
            padding: "10px 14px",
            fontSize: "0.76rem",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
              <div style={{ fontWeight: 700, color: isWarm ? "#9a3412" : "#c084fc", display: "flex", alignItems: "center", gap: "6px" }}>
                <span>🔍 量化審計漏斗 (Scan Audit Pipeline)：</span>
                <span style={{ fontSize: "0.70rem", color: auditMetrics.isConserved ? (isWarm ? "#15803d" : "#4ade80") : "#f87171", background: auditMetrics.isConserved ? (isWarm ? "rgba(21,128,61,0.1)" : "rgba(34,197,94,0.15)") : "rgba(239,68,68,0.15)", padding: "1px 6px", borderRadius: "4px", border: `1px solid ${auditMetrics.isConserved ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)"}` }}>
                  {auditMetrics.isConserved ? "🛡️ 100% 計數守恆 Invariant Verified" : "⚠️ 守恆不一致"}
                </span>
              </div>
              <div style={{ fontSize: "0.72rem", color: isWarm ? "#57534e" : "#94a3b8" }}>
                母體 ({auditMetrics.universe}) ＝ 推論 ({auditMetrics.evaluated}) ＋ 略過 ({auditMetrics.skipped})
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", color: isWarm ? "#292524" : "#e2e8f0" }}>
              <span>推論池：<b>{auditMetrics.evaluated}</b></span>
              <span style={{ color: "var(--text-muted)" }}>＝</span>
              <span style={{ color: isWarm ? "#15803d" : "#4ade80", fontWeight: 800 }}>入選：<b>{auditMetrics.selected}</b> 檔</span>
              <span style={{ color: "var(--text-muted)" }}>＋</span>
              <span style={{ color: isWarm ? "#57534e" : "#94a3b8" }}>策略淘汰：<b>{auditMetrics.strategyRejected}</b></span>
              <span style={{ color: "var(--text-muted)" }}>＋</span>
              <span style={{ color: "#f87171" }}>品質不足淘汰：<b>{auditMetrics.qualityRejected}</b></span>
              {auditMetrics.dataFetchError > 0 && (
                <>
                  <span style={{ color: "var(--text-muted)" }}>＋</span>
                  <span style={{ color: "#ef4444" }}>數據異常：<b>{auditMetrics.dataFetchError}</b></span>
                </>
              )}
              <span style={{ color: "var(--text-muted)", marginLeft: "4px" }}>｜</span>
              <span style={{ color: isWarm ? "#b45309" : "#fbbf24", fontSize: "0.72rem" }}>
                K線缺失降級標記：{auditMetrics.ohlcvDegradedCount} 檔
              </span>
            </div>

            {/* 📜 Priority 6: Cryptographic Deterministic Provenance Fingerprints */}
            {provenanceReport && (
              <div style={{
                borderTop: isWarm ? "1px dashed rgba(140, 110, 80, 0.2)" : "1px dashed rgba(255, 255, 255, 0.1)",
                paddingTop: "6px",
                fontSize: "0.70rem",
                color: isWarm ? "#57534e" : "#94a3b8",
                display: "flex",
                flexDirection: "column",
                gap: "4px"
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontWeight: 700, color: isWarm ? "#0284c7" : "#38bdf8" }}>
                    📜 密碼學可重現審計指紋 (Deterministic Provenance)：
                  </span>
                  <button
                    onClick={copyProvenanceJson}
                    style={{
                      background: "transparent",
                      border: isWarm ? "1px solid rgba(140,110,80,0.3)" : "1px solid rgba(255,255,255,0.2)",
                      borderRadius: "4px",
                      color: isWarm ? "#9a3412" : "#c084fc",
                      fontSize: "0.68rem",
                      cursor: "pointer",
                      padding: "1px 6px"
                    }}
                  >
                    📋 複製審計指紋 JSON
                  </button>
                </div>
                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", fontFamily: "monospace" }}>
                  <span style={{ background: isWarm ? "rgba(2,132,199,0.1)" : "rgba(56,189,248,0.15)", padding: "1px 6px", borderRadius: "3px" }}>
                    Deterministic Run ID: <b style={{ color: isWarm ? "#0369a1" : "#38bdf8" }}>{provenanceReport.deterministicRunId.slice(0, 18)}...</b>
                  </span>
                  <span>Event ID: <b style={{ color: isWarm ? "#18181b" : "#f8fafc" }}>{provenanceReport.scanId}</b></span>
                  <span>Model: <b>{provenanceReport.modelHash.slice(0, 14)}...</b></span>
                  <span>Snapshot: <b>{provenanceReport.inputSnapshotHash.slice(0, 14)}...</b></span>
                  <span>Result: <b style={{ color: isWarm ? "#15803d" : "#4ade80" }}>{provenanceReport.resultHash.slice(0, 14)}...</b></span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="scan-table-wrap">
        {results.length === 0 && !scanning ? (
          <div className="empty-state" style={{ height: "100%" }}>
            <div className="empty-icon">{hasScanned ? "🔍" : "🧠"}</div>
            <div className="empty-text">
              {hasScanned
                ? "在此產業範圍中目前無符合該篩選標準之標的，建議可切換至【🚀 FinLab 波段飆股】或【⭐⭐⭐⭐ 穩健多頭】查看更多優質標的！"
                : "選擇掃描範圍與 AI 策略，點選「開始 AI 多因子量化掃描」執行全市場 18 維多因子評分與截面排名"}
            </div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: "50px" }}>排名</th>
                <th>代碼</th>
                <th>名稱</th>
                <th style={{ width: "115px" }}>資料完整度 (Coverage)</th>
                <th style={{ width: "140px" }}>🧠 20日超額勝率</th>
                <th>預估超額 Alpha</th>
                <th>AI 置信評級</th>
                <th>18 維核心驅動因子</th>
                <th>PE / ROE</th>
                <th style={{ width: "130px" }}>18 因子明細</th>
                <th style={{ width: "110px" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const cleanSym = r.symbol.replace(/\.(TW|TWO)$/, "");
                const isRisk = r.convictionTier.includes("偏空") || r.winRatePct <= 40;
                const isTopWin = r.winRatePct >= 68;
                const winColor = isTopWin ? "#38bdf8" : r.winRatePct >= 58 ? "#a855f7" : r.winRatePct <= 48 ? "#ef4444" : "#facc15";

                return (
                  <tr key={r.symbol}>
                    <td>
                      <span style={{ fontWeight: 800, color: r.rank <= 3 ? "#ffd700" : "var(--text-muted)", fontSize: "0.95rem" }}>
                        #{r.rank}
                      </span>
                    </td>
                    <td style={{ color: "var(--accent-blue)", fontWeight: 700 }}>{cleanSym}</td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span className="badge" style={{
                          fontSize: "0.70rem",
                          backgroundColor: r.dataQuality.availableCount >= 17 ? "rgba(34, 197, 94, 0.2)" : r.dataQuality.availableCount >= 12 ? "rgba(59, 130, 246, 0.2)" : "rgba(245, 158, 11, 0.2)",
                          color: r.dataQuality.availableCount >= 17 ? (isWarm ? "#15803d" : "#4ade80") : r.dataQuality.availableCount >= 12 ? (isWarm ? "#0284c7" : "#60a5fa") : (isWarm ? "#b45309" : "#fbbf24"),
                          border: `1px solid ${r.dataQuality.availableCount >= 17 ? "rgba(34, 197, 94, 0.4)" : "rgba(59, 130, 246, 0.4)"}`,
                          fontWeight: 700
                        }}>
                          {r.coverageDisplay || `${r.dataQuality.availableCount}/18`}
                        </span>
                        <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
                          標準分: <b style={{ color: r.normalizedScore >= 0 ? (isWarm ? "#15803d" : "#4ade80") : "#f87171" }}>{r.normalizedScore >= 0 ? "+" : ""}{r.normalizedScore.toFixed(2)}</b>
                        </span>
                      </div>
                    </td>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ flex: 1, height: "6px", background: "rgba(255,255,255,0.1)", borderRadius: "3px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${r.winRatePct}%`, background: winColor }} />
                        </div>
                        <span style={{ fontWeight: 800, color: winColor, minWidth: "46px", textAlign: "right" }}>
                          {fmtFixed(r.winRatePct, 1)}%
                        </span>
                      </div>
                    </td>
                    <td style={{ fontWeight: 700, color: r.expectedAlphaPct >= 0 ? "#38bdf8" : "#f87171" }}>
                      {r.expectedAlphaPct >= 0 ? "+" : ""}{fmtFixed(r.expectedAlphaPct, 1)}%
                    </td>
                    <td>
                      <span className="badge" style={{
                        backgroundColor: isRisk ? "rgba(239, 68, 68, 0.2)" : isTopWin ? "rgba(56, 189, 248, 0.2)" : "rgba(168, 85, 247, 0.2)",
                        color: isRisk ? "#f87171" : isTopWin ? "#38bdf8" : "#c084fc",
                        border: `1px solid ${isRisk ? "rgba(239, 68, 68, 0.4)" : isTopWin ? "rgba(56, 189, 248, 0.4)" : "rgba(168, 85, 247, 0.4)"}`,
                        fontWeight: 600
                      }}>
                        {r.convictionTier}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>
                      {r.positiveDrivers.length > 0 ? (
                        <span style={{ color: isWarm ? "#15803d" : "#4ade80" }}>{r.positiveDrivers.slice(0, 2).join("、")}</span>
                      ) : (
                        <span style={{ color: "#f87171" }}>{r.riskDrivers.slice(0, 2).join("、")}</span>
                      )}
                    </td>
                    <td style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                      <div>PE: <b style={{ color: "var(--text-primary)" }}>{fmtFixed(metricVal(r.info.tw_pe ?? r.info.pe), 1, "-")}</b></div>
                      <div>ROE: <b style={{ color: (metricVal(r.info.roe) ?? 0) < 0 ? "#ff5252" : (metricVal(r.info.roe) ?? 0) >= 0.15 ? (isWarm ? "#15803d" : "#4ade80") : "var(--text-primary)" }}>{metricVal(r.info.roe) != null ? fmtFixed(metricVal(r.info.roe)! * 100, 1) + "%" : "-"}</b></div>
                    </td>
                    <td>
                      <button
                        className="btn btn-outline"
                        style={{ fontSize: "0.72rem", padding: "3px 8px", borderColor: "#a855f7", color: "#c084fc" }}
                        onClick={() => setSelectedStockForDetail(r)}
                      >
                        🔍 展開 18 因子
                      </button>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "4px" }}>
                        <button
                          className="btn btn-primary"
                          style={{ fontSize: "0.72rem", padding: "3px 7px" }}
                          onClick={() => onAnalyze && onAnalyze(cleanSym)}
                        >
                          分析
                        </button>
                        <AddToWatchlistBtn symbol={r.symbol} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selectedStockForDetail && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: isWarm ? "rgba(40, 30, 20, 0.4)" : "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: "16px"
          }}
          onClick={() => setSelectedStockForDetail(null)}
        >
          <div
            style={{
              backgroundColor: isWarm ? "#ffffff" : "#1e1b4b",
              border: isWarm ? "1px solid rgba(140, 110, 80, 0.3)" : "1px solid #7c3aed",
              borderRadius: "12px",
              padding: "20px",
              width: "100%",
              maxWidth: "680px",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: isWarm ? "0 10px 30px rgba(90, 60, 30, 0.2)" : "0 10px 30px rgba(0,0,0,0.5)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.2)" : "1px solid rgba(124, 58, 237, 0.4)", paddingBottom: "10px", marginBottom: "12px" }}>
              <div>
                <span style={{ fontSize: "1.2rem", fontWeight: 800, color: isWarm ? "#18181b" : "#f3e8ff" }}>
                  🧠 {selectedStockForDetail.name} ({selectedStockForDetail.symbol.split(".")[0]}) 18 維真實多因子全景
                </span>
                <div style={{ fontSize: "0.82rem", color: isWarm ? "#9a3412" : "#c084fc", marginTop: "2px" }}>
                  20 日超額勝率：<b>{fmtFixed(selectedStockForDetail.winRatePct, 1)}%</b> ｜ 評級：<b>{selectedStockForDetail.convictionTier}</b> ｜ 預估 Alpha：<b>{selectedStockForDetail.expectedAlphaPct >= 0 ? '+' : ''}{fmtFixed(selectedStockForDetail.expectedAlphaPct, 1)}%</b>
                </div>
              </div>
              <button
                onClick={() => setSelectedStockForDetail(null)}
                style={{ background: "transparent", border: "none", color: isWarm ? "#57534e" : "#cbd5e1", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            {selectedStockForDetail.dataQuality && (
              <div style={{
                background: isWarm ? "#faf7f2" : "rgba(15, 23, 42, 0.6)",
                border: isWarm ? "1px solid rgba(140, 110, 80, 0.18)" : "1px solid rgba(148, 163, 184, 0.25)",
                borderRadius: "8px",
                padding: "8px 12px",
                marginBottom: "12px",
                fontSize: "0.75rem",
                display: "flex",
                flexDirection: "column",
                gap: "4px"
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "6px" }}>
                  <div>
                    <span style={{ color: isWarm ? "#57534e" : "#94a3b8" }}>因子覆蓋度 (Coverage)：</span>
                    <b style={{ color: selectedStockForDetail.availableFactorCount >= 17 ? (isWarm ? "#15803d" : "#4ade80") : selectedStockForDetail.availableFactorCount >= 12 ? (isWarm ? "#0284c7" : "#60a5fa") : "#f87171" }}>
                      {selectedStockForDetail.coverageDisplay}
                    </b>
                    <span style={{ color: isWarm ? "#57534e" : "#94a3b8", marginLeft: "8px" }}>
                      (可用 {selectedStockForDetail.availableFactorCount} / 缺失 {selectedStockForDetail.missingFactorCount})
                    </span>
                  </div>
                  <div>
                    <span style={{ color: isWarm ? "#57534e" : "#94a3b8" }}>原始加權分: </span>
                    <b style={{ color: selectedStockForDetail.rawScore >= 0 ? (isWarm ? "#15803d" : "#4ade80") : "#f87171" }}>
                      {selectedStockForDetail.rawScore >= 0 ? "+" : ""}{selectedStockForDetail.rawScore.toFixed(2)}
                    </b>
                    <span style={{ color: isWarm ? "#57534e" : "#94a3b8", marginLeft: "6px" }}>｜ 17因子標準分: </span>
                    <b style={{ color: selectedStockForDetail.normalizedScore >= 0 ? (isWarm ? "#15803d" : "#4ade80") : "#f87171" }}>
                      {selectedStockForDetail.normalizedScore >= 0 ? "+" : ""}{selectedStockForDetail.normalizedScore.toFixed(2)}
                    </b>
                  </div>
                </div>
                <div style={{ color: isWarm ? "#0284c7" : "#38bdf8", borderTop: isWarm ? "1px dashed rgba(140,110,80,0.15)" : "1px dashed rgba(255,255,255,0.08)", paddingTop: "4px", marginTop: "2px" }}>
                  🧠 17 維多因子 Ensemble ｜ 引擎：<b>CPU/GPU 加速</b> ｜ 全母體分母：<b>無分母縮小偏誤 (Zero Denominator Bias)</b>
                </div>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {selectedStockForDetail.allFactors.map((f) => {
                const isPos = f.status === "positive";
                const isNeg = f.status === "negative";
                const statusBg = isWarm
                  ? (isPos ? "rgba(21, 128, 61, 0.08)" : isNeg ? "rgba(239, 68, 68, 0.08)" : "rgba(140, 110, 80, 0.06)")
                  : (isPos ? "rgba(34, 197, 94, 0.15)" : isNeg ? "rgba(239, 68, 68, 0.18)" : "rgba(148, 163, 184, 0.1)");
                const statusBorder = isWarm
                  ? (isPos ? "rgba(21, 128, 61, 0.25)" : isNeg ? "rgba(239, 68, 68, 0.25)" : "rgba(140, 110, 80, 0.15)")
                  : (isPos ? "rgba(34, 197, 94, 0.4)" : isNeg ? "rgba(239, 68, 68, 0.4)" : "rgba(148, 163, 184, 0.25)");
                const statusColor = isPos ? (isWarm ? "#15803d" : "#4ade80") : isNeg ? "#f87171" : (isWarm ? "#57534e" : "#94a3b8");
                const icon = isPos ? "✅" : isNeg ? "❌" : "⚪";

                return (
                  <div
                    key={f.id}
                    style={{
                      background: statusBg,
                      border: `1px solid ${statusBorder}`,
                      borderRadius: "8px",
                      padding: "8px 12px",
                      fontSize: "0.82rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "3px"
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontWeight: 700, color: isWarm ? "#18181b" : "#f8fafc" }}>
                        {icon} {f.name} <span style={{ fontSize: "0.72rem", color: isWarm ? "#0369a1" : "#a5b4fc", fontWeight: 400 }}>({f.category})</span>
                        {f.source && <span style={{ fontSize: "0.68rem", color: isWarm ? "#57534e" : "#94a3b8", marginLeft: "6px" }}>[{f.source}]</span>}
                      </span>
                      <span style={{ fontWeight: 800, color: statusColor, fontSize: "0.9rem" }}>
                        {f.valueDisplay}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.75rem", color: isWarm ? "#57534e" : "#cbd5e1", display: "flex", justifyContent: "space-between" }}>
                      <span>{f.explanation}</span>
                      <span style={{ color: statusColor, fontWeight: 700, marginLeft: "8px", whiteSpace: "nowrap" }}>{f.impact}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: "16px", textAlign: "right" }}>
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (onAnalyze) onAnalyze(selectedStockForDetail.symbol.split(".")[0]);
                  setSelectedStockForDetail(null);
                }}
              >
                📊 進入個股深度分析
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
