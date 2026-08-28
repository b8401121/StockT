import React, { useState, useRef, useEffect } from "react";
import { StockInfoFull } from "../utils/analysis";
import { evaluateAIAlpha, AIAlphaResult } from "../utils/aiAlphaModel";
import { HardwareBadge } from "./HardwareBadge";
import { AddToWatchlistBtn } from "./AddToWatchlistBtn";
import twseFundamentals from "../utils/twse_mops_fundamentals.json";

const fundamentalsMap: Record<string, any> = twseFundamentals as any;

interface AIAlphaScanTabProps {
  onAnalyze?: (symbol: string) => void;
}

interface RankedAlphaStock extends AIAlphaResult {
  rank: number;
  info: StockInfoFull;
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
  return allKeys.filter((k) => {
    const p = fundamentalsMap[k] || {};
    const sym = p.symbol || `${k}.TW`;
    if (!isCommonStockOrValidEtf(sym, market)) return false;
    const code = k.replace(/\D/g, "");
    if (!code || code.length > 5) return false;
    if (market === "ALL") return true;
    if (market === "TW") return sym.endsWith(".TW");
    if (market === "TWO") return sym.endsWith(".TWO");
    if (market === "00") return code.startsWith("00");
    const n = parseInt(code, 10);
    if (isNaN(n)) return false;
    if (market === "1A") return n >= 1100 && n < 1700;
    if (market === "1B") return n >= 1700 && n < 2000;
    if (market === "2A") return n >= 2000 && n < 3000;
    if (market === "3A") return n >= 3000 && n < 3700;
    if (market === "3B") return n >= 3700 && n < 3900;
    if (market === "4A") return n >= 4100 && n < 5000;
    if (market === "5A") return n >= 5000 && n < 6000;
    if (market === "6A") return n >= 6000 && n < 7000;
    if (market === "8A") return n >= 8000;
    return false;
  });
}

const STRATEGIES = [
  { id: "strong_bull", label: "⭐⭐⭐⭐⭐ 極致多頭 (勝率 ≥ 78%)", filterFn: (s: AIAlphaResult) => s.winRatePct >= 78 },
  { id: "solid_bull", label: "⭐⭐⭐⭐ 穩健多頭 (勝率 ≥ 60%)", filterFn: (s: AIAlphaResult) => s.winRatePct >= 60 },
  { id: "finlab_momentum", label: "🚀 FinLab 波段飆股 (120日動能 + 站上年線)", filterFn: (s: AIAlphaResult, info: StockInfoFull) => (s.winRatePct >= 60 && (info.roe ?? 0) >= 0.10 && (info.eps ?? 0) > 0) },
  { id: "value_alpha", label: "💎 價值高勝率 (高ROE ≥ 15% + 低PE ≤ 20)", filterFn: (s: AIAlphaResult, info: StockInfoFull) => (s.winRatePct >= 60 && (info.roe ?? 0) >= 0.15 && (info.tw_pe ?? info.pe ?? 30) <= 20) },
  { id: "growth_alpha", label: "📈 雙重擴張成長 (營收YoY ≥ 15% + 勝率 ≥ 65%)", filterFn: (s: AIAlphaResult, info: StockInfoFull) => (s.winRatePct >= 65 && (info.revenue_growth ?? 0) >= 0.15) },
  { id: "landmine_risk", label: "⚠️ 偏空避險名單 (勝率 ≤ 35% / 虧損地雷)", filterFn: (s: AIAlphaResult) => s.winRatePct <= 35 },
];

export const AIAlphaScanTab: React.FC<AIAlphaScanTabProps> = ({ onAnalyze }) => {
  const [market, setMarket] = useState("3A");
  const [strategy, setStrategy] = useState("strong_bull");
  const [scanning, setScanning] = useState(false);
  const [hasScanned, setHasScanned] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [results, setResults] = useState<RankedAlphaStock[]>([]);
  const [selectedStockForDetail, setSelectedStockForDetail] = useState<RankedAlphaStock | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    return () => { cancelRef.current = true; };
  }, []);

  const startScan = async () => {
    cancelRef.current = false;
    setScanning(true);
    setHasScanned(true);
    setProgress(0);
    setProgressMsg("正在進行全市場 17 維神經網路 AI 推論...");
    setResults([]);

    try {
      const allKeys = Object.keys(fundamentalsMap);
      const targetKeys = filterSymbolsByMarket(allKeys, fundamentalsMap, market);

      const total = targetKeys.length;
      setProgressMsg(`正在調用硬體加速單元推論 ${total} 檔標的之 17 維神經網路...`);

      const selectedStrat = STRATEGIES.find(s => s.id === strategy) || STRATEGIES[0];
      const evaluatedList: RankedAlphaStock[] = [];

      for (let i = 0; i < total; i++) {
        if (cancelRef.current) break;
        const key = targetKeys[i];
        const p = fundamentalsMap[key] || {};
        const symbol = p.symbol || `${key}.TW`;

        const curP = p.close_price || p.current_price || p.c || 0;
        const prevP = p.previous_close || (p.close_price && p.change != null ? p.close_price - p.change : curP);

        const info: StockInfoFull = {
          symbol,
          name: p.name || p.n || key,
          current_price: curP,
          previous_close: prevP,
          pe: p.pe,
          tw_pe: p.tw_pe ?? p.pe,
          pb: p.pb,
          dividend_yield: p.dividend_yield ?? (p.dividend_yield_pct ? p.dividend_yield_pct / 100 : null),
          eps: p.eps,
          roe: p.roe,
          profit_margins: p.profit_margins,
          gross_margins: p.gross_margins,
          operating_margins: p.operating_margins,
          revenue_growth: p.revenue_growth,
          earnings_growth: p.earnings_growth,
          debt_to_equity: p.debt_to_equity,
          current_ratio: p.current_ratio,
          quick_ratio: p.quick_ratio,
          free_cashflow: p.free_cashflow,
          operating_cashflow: p.operating_cashflow,
          market_cap: p.market_cap,
        };

        const aiResult = evaluateAIAlpha(info, curP, prevP);

        if (selectedStrat.filterFn(aiResult, info)) {
          evaluatedList.push({
            ...aiResult,
            rank: 0,
            info,
          });
        }

        if (i % 60 === 0 || i === total - 1) {
          setProgress(Math.round(((i + 1) / total) * 100));
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      if (strategy === "landmine_risk") {
        evaluatedList.sort((a, b) => a.winRatePct - b.winRatePct);
      } else {
        evaluatedList.sort((a, b) => b.winRatePct - a.winRatePct);
      }

      evaluatedList.forEach((item, idx) => {
        item.rank = idx + 1;
      });

      setResults(evaluatedList);
      setProgress(100);
      setProgressMsg(`推論完成！共精選出 ${evaluatedList.length} 檔標的`);
    } catch (e: any) {
      setProgressMsg(`推論錯誤: ${e.message}`);
    } finally {
      setScanning(false);
    }
  };

  const stopScan = () => {
    cancelRef.current = true;
    setScanning(false);
    setProgressMsg("已停止推論");
  };

  const exportHtml = () => {
    if (results.length === 0) return;
    const stratObj = STRATEGIES.find(s => s.id === strategy);
    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>StockT CPU 內建 AI 多因子選股名單 (${stratObj?.label})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; background: #0f172a; color: #f8fafc; }
    h1 { color: #c084fc; border-bottom: 2px solid #8b5cf6; padding-bottom: 8px; font-size: 1.5rem; }
    .meta { color: #94a3b8; font-size: 0.85rem; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.88rem; }
    th { background: #1e293b; color: #e2e8f0; padding: 10px; text-align: left; border: 1px solid #334155; }
    td { padding: 10px; border: 1px solid #334155; }
    tr:nth-child(even) { background: rgba(30, 41, 59, 0.5); }
    .badge-win { background: #dc2626; color: white; padding: 3px 8px; border-radius: 4px; font-weight: bold; }
    .badge-tier { background: #8b5cf6; color: white; padding: 3px 8px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>🧠 StockT CPU 內建 AI 多因子選股清單</h1>
  <div class="meta">策略：${stratObj?.label} ｜ 產生時間：${new Date().toLocaleString()} ｜ 精選數量：${results.length} 檔</div>
  <table>
    <thead>
      <tr>
        <th>排名</th><th>代碼</th><th>名稱</th><th>20日超額勝率</th><th>預估超額 Alpha</th><th>AI 置信評級</th><th>PE / ROE</th><th>核心加分因子</th>
      </tr>
    </thead>
    <tbody>
      ${results.map(r => `
        <tr>
          <td><b>#${r.rank}</b></td>
          <td><b>${r.symbol.split(".")[0]}</b></td>
          <td>${r.name}</td>
          <td><span class="badge-win">${r.winRatePct.toFixed(1)}%</span></td>
          <td style="color:#38bdf8; font-weight:bold;">${r.expectedAlphaPct >= 0 ? '+' : ''}${r.expectedAlphaPct.toFixed(1)}%</td>
          <td><span class="badge-tier">${r.convictionTier}</span></td>
          <td>PE: ${r.info.tw_pe?.toFixed(1) ?? r.info.pe?.toFixed(1) ?? "-"} | ROE: ${r.info.roe != null ? (r.info.roe * 100).toFixed(1) + "%" : "-"}</td>
          <td>${r.positiveDrivers.join("、") || r.riskDrivers.join("、")}</td>
        </tr>
      `).join("")}
    </tbody>
  </table>
</body>
</html>`;

    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `StockT_AI多因子選股_${strategy}_${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="scan-layout">
      {/* 控制列 */}
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
            🧠 開始 AI 多因子推論
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
      </div>

      {/* 結果清單 */}
      <div className="scan-table-wrap">
        {results.length === 0 && !scanning ? (
          <div className="empty-state" style={{ height: "100%" }}>
            <div className="empty-icon">{hasScanned ? "🔍" : "🧠"}</div>
            <div className="empty-text">
              {hasScanned
                ? "在此產業範圍中目前無符合該篩選標準之標的，建議可切換至【🚀 FinLab 波段飆股】或【⭐⭐⭐⭐ 穩健多頭】查看更多優質標的！"
                : "選擇掃描範圍與 AI 策略，點選「開始 AI 多因子推論」執行全市場 17 維神經網路運算"}
            </div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: "50px" }}>排名</th>
                <th>代碼</th>
                <th>名稱</th>
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
                const isTopWin = r.winRatePct >= 78;
                const winColor = r.winRatePct >= 78 ? "#ff5252" : r.winRatePct >= 60 ? "#ffd740" : "#4caf50";

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
                      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ flex: 1, height: "6px", background: "rgba(255,255,255,0.1)", borderRadius: "3px", overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${r.winRatePct}%`, background: winColor }} />
                        </div>
                        <span style={{ fontWeight: 800, color: winColor, minWidth: "46px", textAlign: "right" }}>
                          {r.winRatePct.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td style={{ fontWeight: 700, color: r.expectedAlphaPct >= 0 ? "#38bdf8" : "#94a3b8" }}>
                      {r.expectedAlphaPct >= 0 ? "+" : ""}{r.expectedAlphaPct.toFixed(1)}%
                    </td>
                    <td>
                      <span className="badge" style={{
                        backgroundColor: isTopWin ? "rgba(239, 68, 68, 0.2)" : "rgba(168, 85, 247, 0.2)",
                        color: isTopWin ? "#f87171" : "#c084fc",
                        border: `1px solid ${isTopWin ? "rgba(239, 68, 68, 0.4)" : "rgba(168, 85, 247, 0.4)"}`,
                        fontWeight: 600
                      }}>
                        {r.convictionTier}
                      </span>
                    </td>
                    <td style={{ fontSize: "0.78rem" }}>
                      {r.positiveDrivers.length > 0 ? (
                        <span style={{ color: "#4ade80" }}>{r.positiveDrivers.slice(0, 2).join("、")}</span>
                      ) : (
                        <span style={{ color: "#f87171" }}>{r.riskDrivers.slice(0, 2).join("、")}</span>
                      )}
                    </td>
                    <td style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
                      <div>PE: <b style={{ color: "var(--text-primary)" }}>{r.info.tw_pe?.toFixed(1) ?? r.info.pe?.toFixed(1) ?? "-"}</b></div>
                      <div>ROE: <b style={{ color: (r.info.roe ?? 0) >= 0.15 ? "var(--accent-red)" : "var(--text-primary)" }}>{r.info.roe != null ? (r.info.roe * 100).toFixed(1) + "%" : "-"}</b></div>
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

      {/* 17 維多因子明細彈出視窗 (Modal) */}
      {selectedStockForDetail && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.75)",
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
              backgroundColor: "#1e1b4b",
              border: "1px solid #7c3aed",
              borderRadius: "12px",
              padding: "20px",
              width: "100%",
              maxWidth: "680px",
              maxHeight: "85vh",
              overflowY: "auto",
              boxShadow: "0 10px 30px rgba(0,0,0,0.5)"
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(124, 58, 237, 0.4)", paddingBottom: "10px", marginBottom: "14px" }}>
              <div>
                <span style={{ fontSize: "1.2rem", fontWeight: 800, color: "#f3e8ff" }}>
                  🧠 {selectedStockForDetail.name} ({selectedStockForDetail.symbol.split(".")[0]}) 17 維神經網路因子全景
                </span>
                <div style={{ fontSize: "0.82rem", color: "#c084fc", marginTop: "2px" }}>
                  20 日超額勝率：<b>{selectedStockForDetail.winRatePct.toFixed(1)}%</b> ｜ 評級：<b>{selectedStockForDetail.convictionTier}</b> ｜ 預估 Alpha：<b>{selectedStockForDetail.expectedAlphaPct >= 0 ? '+' : ''}{selectedStockForDetail.expectedAlphaPct.toFixed(1)}%</b>
                </div>
              </div>
              <button
                onClick={() => setSelectedStockForDetail(null)}
                style={{ background: "transparent", border: "none", color: "#cbd5e1", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {selectedStockForDetail.allFactors.map((f) => {
                const isPos = f.status === "positive";
                const isNeg = f.status === "negative";
                const statusBg = isPos ? "rgba(34, 197, 94, 0.15)" : isNeg ? "rgba(239, 68, 68, 0.18)" : "rgba(148, 163, 184, 0.1)";
                const statusBorder = isPos ? "rgba(34, 197, 94, 0.4)" : isNeg ? "rgba(239, 68, 68, 0.4)" : "rgba(148, 163, 184, 0.25)";
                const statusColor = isPos ? "#4ade80" : isNeg ? "#f87171" : "#94a3b8";
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
                      <span style={{ fontWeight: 700, color: "#f8fafc" }}>
                        {icon} {f.name} <span style={{ fontSize: "0.72rem", color: "#a5b4fc", fontWeight: 400 }}>({f.category})</span>
                      </span>
                      <span style={{ fontWeight: 800, color: statusColor, fontSize: "0.9rem" }}>
                        {f.valueDisplay}
                      </span>
                    </div>
                    <div style={{ fontSize: "0.75rem", color: "#cbd5e1", display: "flex", justifyContent: "space-between" }}>
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
