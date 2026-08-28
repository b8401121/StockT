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
  universe: number;
  evaluated: number;
  ohlcvFailed: number;
  qualityRejected: number;
  strategyRejected: number;
  selected: number;
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
  const cancelRef = useRef(false);

  useEffect(() => {
    return () => { cancelRef.current = true; };
  }, []);

  const startScan = async () => {
    cancelRef.current = false;
    setScanning(true);
    setHasScanned(true);
    setProgress(0);
    setProgressMsg("正在準備全市場 17 維多因子量化評估...");
    setResults([]);

    try {
      const allKeys = Object.keys(fundamentalsMap);
      const targetKeys = filterSymbolsByMarket(allKeys, fundamentalsMap, market);
      const total = targetKeys.length;

      const selectedStrat = STRATEGIES.find(s => s.id === strategy) || STRATEGIES[0];
      const matchedStocks: RankedAlphaStock[] = [];

      let runningAudit: ScanAuditMetrics = {
        universe: total,
        evaluated: 0,
        ohlcvFailed: 0,
        qualityRejected: 0,
        strategyRejected: 0,
        selected: 0,
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
        setProgressMsg(`正在進行 17 維多因子推論 ${i + 1}~${Math.min(i + BATCH_SIZE, total)} / ${total} 檔... (已精選 ${matchedStocks.length} 檔)`);

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

        for (const res of chunkResults) {
          if (res.status === "fulfilled") {
            const { aiResult, info, ohlcvMissing } = res.value;
            runningAudit.evaluated++;

            if (ohlcvMissing) {
              runningAudit.ohlcvFailed++;
            }

            if (aiResult.dataQuality.availableCount < 5) {
              runningAudit.qualityRejected++;
              continue;
            }

            if (selectedStrat.filterFn(aiResult, info)) {
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
        }

        const currentRanked = [...matchedStocks].sort((a, b) => 
          strategy === "landmine_risk" ? a.winRatePct - b.winRatePct : b.winRatePct - a.winRatePct
        );
        currentRanked.forEach((item, idx) => { item.rank = idx + 1; });
        setResults(currentRanked);
        setAuditMetrics({ ...runningAudit });

        await new Promise((r) => setTimeout(r, 0));
      }

      if (strategy === "landmine_risk") {
        matchedStocks.sort((a, b) => a.winRatePct - b.winRatePct);
      } else {
        matchedStocks.sort((a, b) => b.winRatePct - a.winRatePct);
      }

      matchedStocks.forEach((item, idx) => {
        item.rank = idx + 1;
      });

      setResults(matchedStocks);
      setProgress(100);
      setProgressMsg(`🎉 評估完成！共精選出 ${matchedStocks.length} 檔 17 維多因子即時標的`);
      setAuditMetrics({ ...runningAudit });
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
      const title = `StockT AI 17維多因子選股報告 - ${stratName}`;
      const filename = `ai_alpha_scan_${strategy}_${new Date().toISOString().slice(0, 10)}.html`;
      const htmlContent = await exportToHtmlFile(title, results, "aiAlpha");
      const savedPath = await stockService.exportTxtFile(filename, htmlContent);
      alert(`選股名單匯出成功！已產生精美網頁報告！\n已儲存至您的【下載】資料夾：\n${savedPath}`);
    } catch (err) {
      alert(`匯出失敗: ${err}`);
    }
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

        {auditMetrics && (
          <div style={{
            marginTop: "10px",
            background: isWarm ? "rgba(140, 110, 80, 0.08)" : "rgba(15, 23, 42, 0.6)",
            border: isWarm ? "1px solid rgba(140, 110, 80, 0.22)" : "1px solid rgba(124, 58, 237, 0.25)",
            borderRadius: "8px",
            padding: "8px 12px",
            fontSize: "0.76rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "8px"
          }}>
            <div style={{ fontWeight: 700, color: isWarm ? "#9a3412" : "#c084fc", display: "flex", alignItems: "center", gap: "4px" }}>
              <span>🔍 量化審計漏斗 (Scan Audit)：</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              <span>母體 (Universe)：<b>{auditMetrics.universe}</b></span>
              <span style={{ color: "var(--text-muted)" }}>➔</span>
              <span>推論 (Evaluated)：<b>{auditMetrics.evaluated}</b></span>
              <span style={{ color: "var(--text-muted)" }}>➔</span>
              <span style={{ color: isWarm ? "#b45309" : "#fbbf24" }}>K線缺失 (OHLCV Missing)：<b>{auditMetrics.ohlcvFailed}</b></span>
              <span style={{ color: "var(--text-muted)" }}>➔</span>
              <span style={{ color: "#f87171" }}>品質淘汰 (Quality Rejected)：<b>{auditMetrics.qualityRejected}</b></span>
              <span style={{ color: "var(--text-muted)" }}>➔</span>
              <span style={{ color: isWarm ? "#57534e" : "#94a3b8" }}>策略淘汰 (Strategy Rejected)：<b>{auditMetrics.strategyRejected}</b></span>
              <span style={{ color: "var(--text-muted)" }}>➔</span>
              <span style={{ color: isWarm ? "#15803d" : "#4ade80", fontWeight: 800 }}>最終入選 (Selected)：{auditMetrics.selected} 檔</span>
            </div>
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
                : "選擇掃描範圍與 AI 策略，點選「開始 AI 多因子量化掃描」執行全市場 17 維多因子評分與截面排名"}
            </div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: "50px" }}>排名</th>
                <th>代碼</th>
                <th>名稱</th>
                <th style={{ width: "95px" }}>資料完整度</th>
                <th style={{ width: "140px" }}>🧠 20日超額勝率</th>
                <th>預估超額 Alpha</th>
                <th>AI 置信評級</th>
                <th>17 維核心驅動因子</th>
                <th>PE / ROE</th>
                <th style={{ width: "130px" }}>17 因子明細</th>
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
                      <span className="badge" style={{
                        fontSize: "0.72rem",
                        backgroundColor: r.dataQuality.availableCount >= 16 ? "rgba(34, 197, 94, 0.2)" : r.dataQuality.availableCount >= 12 ? "rgba(59, 130, 246, 0.2)" : "rgba(245, 158, 11, 0.2)",
                        color: r.dataQuality.availableCount >= 16 ? (isWarm ? "#15803d" : "#4ade80") : r.dataQuality.availableCount >= 12 ? (isWarm ? "#0284c7" : "#60a5fa") : (isWarm ? "#b45309" : "#fbbf24"),
                        border: `1px solid ${r.dataQuality.availableCount >= 16 ? "rgba(34, 197, 94, 0.4)" : "rgba(59, 130, 246, 0.4)"}`,
                        fontWeight: 700
                      }}>
                        {r.dataQuality.availableCount}/17
                      </span>
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
                        🔍 展開 17 因子
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
                  🧠 {selectedStockForDetail.name} ({selectedStockForDetail.symbol.split(".")[0]}) 17 維真實多因子全景
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
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "6px"
              }}>
                <div>
                  <span style={{ color: isWarm ? "#57534e" : "#94a3b8" }}>資料品質可信度：</span>
                  <b style={{ color: selectedStockForDetail.dataQuality.overallScore >= 80 ? (isWarm ? "#15803d" : "#4ade80") : selectedStockForDetail.dataQuality.overallScore >= 50 ? (isWarm ? "#b45309" : "#facc15") : "#f87171" }}>
                    {selectedStockForDetail.dataQuality.overallScore} / 100
                  </b>
                  <span style={{ color: isWarm ? "#57534e" : "#94a3b8", marginLeft: "6px" }}>({selectedStockForDetail.dataQuality.availableCount}/{selectedStockForDetail.dataQuality.totalRequired} 指標完備)</span>
                </div>
                <div style={{ color: isWarm ? "#0284c7" : "#38bdf8" }}>
                  🧠 17 維多因子 Ensemble ｜ 引擎：<b>CPU/GPU 加速</b> ｜ 即時運算：<b>零人工假設</b>
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
