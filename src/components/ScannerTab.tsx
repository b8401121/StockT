import { AddToWatchlistBtn } from "./AddToWatchlistBtn";
import React, { useCallback, useRef, useState } from "react";
import { invoke } from "../utils/platform";
import { calculateAllIndicators, OhlcvData } from "../utils/indicators";
import { calcTechScanScore, computeFundamentalScore, getFsGrade } from "../utils/analysis";
import { exportToHtmlFile } from "../utils/exportHtml";
import { evaluateAIAlpha } from "../utils/aiAlphaModel";
import { HardwareBadge } from "./HardwareBadge";

interface ScanResult {
  symbol: string;
  name: string;
  score: string;
  numericScore: number;
  compositeScore?: number;
  desc: string;
  aiWinRate?: number;
  aiConviction?: string;
  techRisks?: string[];
  fundRisks?: string[];
  fundScore?: number;
  mode: "buy" | "value" | "landmine" | "short";
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

import { getCachedStocks, subscribeStocks, StockEntry } from "../utils/stocks";

let STOCK_DB: StockEntry[] = getCachedStocks();
subscribeStocks((stocks) => {
  STOCK_DB = stocks;
});

function isCommonStockOrValidEtf(symbol: string, market: string): boolean {
  const code = symbol.split(".")[0];
  // 排除權證 (6碼數字、含英文字母、或 03/04/05/06/07/08/70/71/72/73 開頭之衍生性商品)
  if (code.length > 5 || /[a-zA-Z]/.test(code)) return false;
  if (/^\d{6}$/.test(code)) return false;
  if (/^(03|04|05|06|07|08|70|71|72|73)\d+/.test(code) && !code.startsWith("00")) return false;

  if (market === "00") {
    return /^00\d{2,4}$/.test(code);
  }
  // 純 4 碼上市/上櫃現貨個股
  return /^\d{4}$/.test(code);
}

function getSymbolsByMarket(market: string): string[] {
  if (!STOCK_DB.length) return ["2330.TW", "0050.TW", "2317.TW", "2412.TW", "2308.TW"];
  return STOCK_DB.filter((s) => {
    if (!isCommonStockOrValidEtf(s.symbol, market)) return false;
    const code = s.symbol.split(".")[0];
    if (market === "ALL") return true;
    if (market === "TW") return s.symbol.endsWith(".TW");
    if (market === "TWO") return s.symbol.endsWith(".TWO");
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
  }).map((s) => s.symbol);
}

export const ScannerTab: React.FC<{ onAnalyze?: (sym: string) => void }> = ({ onAnalyze }) => {
  const [market, setMarket] = useState("3A");
  const [results, setResults] = useState<ScanResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [scanning, setScanning] = useState(false);
  const cancelRef = useRef(false);

  const startScan = useCallback(async (mode: "buy" | "value" | "landmine" | "short") => {
    const symbols = getSymbolsByMarket(market);
    if (!symbols.length) return;

    setScanning(true);
    cancelRef.current = false;
    setResults([]);
    setProgress(0);

    const total = symbols.length;
    const BATCH = 32;
    const scanResults: ScanResult[] = [];

    for (let i = 0; i < total; i += BATCH) {
      if (cancelRef.current) break;
      const chunk = symbols.slice(i, Math.min(i + BATCH, total));
      setProgressMsg(`正在即時掃描分析 ${i + 1}~${Math.min(i + BATCH, total)} / ${total} 檔...`);
      setProgress(Math.floor((i / total) * 100));
      await new Promise((r) => setTimeout(r, 25));

      try {
        const isFull = mode === "landmine" || mode === "short" || mode === "value";
        const apiName = isFull ? "fetch_batch_stock_data_full" : "fetch_batch_stock_data";
        const apiArgs = isFull ? { symbols: chunk, range: "1y" } : { symbols: chunk };
        const dataList: any[] = await invoke(apiName, apiArgs);
        for (const data of dataList) {
          if (cancelRef.current) break;
          const ohlcv: OhlcvData = data.ohlcv;
          const name = data.info.name || data.info.symbol;
          const curP = data.info.current_price || 0;
          const prevP = data.info.previous_close || curP;
          const changePct = prevP > 0 ? ((curP - prevP) / prevP) * 100 : 0;

          const aiAlpha = evaluateAIAlpha(data.info, curP, prevP);

          if (mode === "buy") {
            let score = 0;
            const reasons: string[] = [];
            if (ohlcv && ohlcv.close.length >= 20) {
              const ind = calculateAllIndicators(ohlcv);
              const n = ohlcv.close.length - 1;
              const techRes = calcTechScanScore(ind, n);
              score = techRes.score;
              reasons.push(...techRes.reasons);
            } else {
              if (changePct >= 3.0) { score += 2.0; reasons.push(`強勢起漲 +${changePct.toFixed(2)}%`); }
              else if (changePct >= 1.0) { score += 1.0; reasons.push(`盤面走揚 +${changePct.toFixed(2)}%`); }
              else if (changePct > 0) { score += 0.5; reasons.push(`收紅上漲`); }
              const fs = computeFundamentalScore(data.info);
              if (fs.score >= 3) { score += 1.0; reasons.push("基本面優良"); }
            }

            if (score >= 1.5 && reasons.length >= 1) {
              scanResults.push({
                symbol: data.info.symbol,
                name,
                score: `+${score.toFixed(1)}分`,
                numericScore: score,
                aiWinRate: aiAlpha.winRatePct,
                aiConviction: aiAlpha.convictionTier,
                desc: reasons.join("、"),
                mode
              });
            }
          } else if (mode === "value") {
            const fsResult = computeFundamentalScore(data.info);
            const fsScore = fsResult.score;
            let techScore = 0;
            if (ohlcv && ohlcv.close.length >= 20) {
              const ind = calculateAllIndicators(ohlcv);
              const n = ohlcv.close.length - 1;
              const techRes = calcTechScanScore(ind, n);
              techScore = techRes.score;
            } else {
              techScore = changePct < 0 ? -1.0 : 0.5;
            }

            if (fsScore >= 3) {
              const passedItems = fsResult.passed.map(([label]) => label);
              const desc = `【價值尋寶】基本面評級為 ${getFsGrade(fsScore)}(分數:${fsScore})；優秀指標: ${passedItems.slice(0, 3).join(", ")}`;
              const composite = fsScore - techScore;
              scanResults.push({
                symbol: data.info.symbol,
                name,
                score: `基本: ${fsScore} | 技術: ${techScore.toFixed(1)}`,
                numericScore: techScore,
                compositeScore: composite,
                aiWinRate: aiAlpha.winRatePct,
                aiConviction: aiAlpha.convictionTier,
                desc,
                fundScore: fsScore,
                mode
              });
            }
          } else if (mode === "landmine") {
            const fsResult = computeFundamentalScore(data.info);
            const fsScore = fsResult.score;
            const lmFundRisks: string[] = [];
            if (fsScore <= -1) {
              const failedItems = fsResult.failed.map(([, reason]) => reason);
              lmFundRisks.push(`財務警示：${getFsGrade(fsScore)}(分數:${fsScore}) ${failedItems.slice(0, 2).join("、")}`);
            }
            if (data.info.roe != null && data.info.roe < 0) lmFundRisks.push(`ROE為負(${(data.info.roe * 100).toFixed(1)}%)`);
            if (data.info.profit_margins != null && data.info.profit_margins < 0) lmFundRisks.push(`淨利虧損(${(data.info.profit_margins * 100).toFixed(1)}%)`);
            if (data.info.debt_to_equity != null && data.info.debt_to_equity > 250) lmFundRisks.push(`高負債比(${data.info.debt_to_equity.toFixed(0)}%)`);

            if (lmFundRisks.length >= 1) {
              scanResults.push({
                symbol: data.info.symbol,
                name,
                score: `地雷風險: ${lmFundRisks.length}項`,
                numericScore: -lmFundRisks.length,
                compositeScore: -lmFundRisks.length,
                aiWinRate: aiAlpha.winRatePct,
                aiConviction: aiAlpha.convictionTier,
                desc: lmFundRisks.join("、"),
                techRisks: [],
                fundRisks: lmFundRisks,
                fundScore: fsScore,
                mode
              });
            }
          } else if (mode === "short") {
            const fsResult = computeFundamentalScore(data.info);
            const fsScore = fsResult.score;
            if (changePct > 0 && fsScore <= -1) {
              const failedItems = fsResult.failed.map(([label]) => label);
              const fsDesc = `【放空警示】基本面評級為 ${getFsGrade(fsScore)}(分數:${fsScore})；股價逆勢上漲 +${changePct.toFixed(1)}%${failedItems.length ? `。異常指標: ${failedItems.join(", ")}` : ""}`;
              const composite = 1.0 - fsScore;
              scanResults.push({
                symbol: data.info.symbol,
                name,
                score: `技術: +1.0 | 基本: ${fsScore}`,
                numericScore: 1.0,
                compositeScore: composite,
                aiWinRate: aiAlpha.winRatePct,
                aiConviction: aiAlpha.convictionTier,
                desc: fsDesc,
                fundScore: fsScore,
                mode
              });
            }
          }
        }
        
        // 依照分數排序結果
        if (mode === "landmine") {
          scanResults.sort((a, b) => (a.compositeScore ?? 0) - (b.compositeScore ?? 0));
        } else if (mode === "value" || mode === "short") {
          scanResults.sort((a, b) => (b.compositeScore ?? 0) - (a.compositeScore ?? 0)); // 放空和價值模式按綜合評分降序排序，最符合條件的排最前
        } else {
          scanResults.sort((a, b) => b.numericScore - a.numericScore);
        }
        setResults([...scanResults]);
      } catch {}
      
    }

    setProgress(100);
    setProgressMsg(`掃描完成！共找到 ${scanResults.length} 檔`);
    setScanning(false);
  }, [market]);

  const stopScan = () => { cancelRef.current = true; };

  const exportHtml = async () => {
    try {
      const modeName = results[0]?.mode === "buy" ? "多頭掃描" : results[0]?.mode === "value" ? "價值尋寶" : results[0]?.mode === "landmine" ? "地雷警示" : "放空機會";
      const title = `AI 智慧選股 - ${modeName}結果`;
      const filename = `scan_${results[0]?.mode || "results"}.html`;
      const htmlContent = await exportToHtmlFile(title, results, "scanner");
      const savedPath = await invoke("export_txt_file", { filename, content: htmlContent });
      alert(`選股名單匯出成功！已產生精美網頁檔案！\n已儲存至您的【下載】資料夾：\n${savedPath}`);
    } catch (err) {
      alert(`匯出失敗: ${err}`);
    }
  };

  const badgeMode = (r: ScanResult) => {
    if (r.mode === "buy") return <span className="badge badge-green">多頭</span>;
    if (r.mode === "value") return <span className="badge badge-blue">價值</span>;
    if (r.mode === "short") return <span className="badge" style={{ backgroundColor: "#ab47bc", color: "#ffffff", fontWeight: "bold" }}>📉 放空機會</span>;
    const isFundMine = r.fundScore !== undefined && r.fundScore < -2;
    const isDoubleMine = isFundMine && (r.numericScore <= -1.5);
    if (isDoubleMine) return <span className="badge" style={{ backgroundColor: "#d50000", color: "#ffffff", fontWeight: "bold" }}>💥 雙重地雷</span>;
    if (isFundMine) return <span className="badge" style={{ backgroundColor: "#ff5252", color: "#ffffff", fontWeight: "bold" }}>💣 基本地雷</span>;
    return <span className="badge badge-red">⚠️ 技術地雷</span>;
  };

  return (
    <div className="scan-layout">
      <div className="scan-controls">
        <div className="scan-controls-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", flex: 1, marginRight: "12px" }}>
            <span className="scan-label">掃描範圍：</span>
            <select className="select-field" value={market} onChange={(e) => setMarket(e.target.value)} style={{ flex: 1 }}>
              {MARKETS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <HardwareBadge showDetail={true} />
        </div>
        <div className="scan-controls-row">
          <button className="btn btn-success" onClick={() => startScan("buy")} disabled={scanning}>📈 多頭掃描</button>
          <button className="btn btn-primary" onClick={() => startScan("value")} disabled={scanning}>💎 價值尋寶</button>
          <button className="btn btn-danger" onClick={() => startScan("landmine")} disabled={scanning}>⚠️ 地雷警示</button>
          <button className="btn" style={{ backgroundColor: "#ab47bc", color: "white" }} onClick={() => startScan("short")} disabled={scanning}>📉 放空機會</button>
          {scanning && <button className="btn btn-outline" onClick={stopScan}>⏹ 停止</button>}
          {!scanning && results.length > 0 && (
            <button className="btn btn-outline" onClick={exportHtml}>📤 匯出精美名單</button>
          )}
          <div className="progress-bar" style={{ marginLeft: "8px" }}>
            <div className="progress-bar-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="progress-label">{progressMsg}</span>
        </div>
      </div>

      <div className="scan-table-wrap">
        {results.length === 0 && !scanning ? (
          <div className="empty-state" style={{ height: "100%" }}>
            <div className="empty-icon">🔍</div>
            <div className="empty-text">選擇掃描範圍，點選上方按鈕開始選股</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>模式</th>
                <th>代碼</th>
                <th>名稱</th>
                <th>🧠 AI 勝率</th>
                <th>評分</th>
                <th>訊號摘要</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => {
                const isFundMine = r.fundScore !== undefined && r.fundScore < -2;
                const isDoubleMine = isFundMine && (r.numericScore <= -1.5);
                const isShort = r.mode === "short";
                const isValue = r.mode === "value";
                const rowBg = isDoubleMine 
                  ? "rgba(213, 0, 0, 0.08)" 
                  : isFundMine 
                  ? "rgba(255, 82, 82, 0.05)" 
                  : isShort
                  ? "rgba(171, 71, 188, 0.08)"
                  : isValue
                  ? "rgba(33, 150, 243, 0.08)"
                  : undefined;
                return (
                  <tr key={`${r.symbol}-${i}`} style={rowBg ? { backgroundColor: rowBg } : undefined}>
                    <td>{badgeMode(r)}</td>
                    <td style={{ color: "var(--accent-blue)", fontWeight: 600 }}>{r.symbol.split(".")[0]}</td>
                    <td>{r.name}</td>
                    <td>
                      {r.aiWinRate !== undefined ? (
                        <div>
                          <span style={{ fontWeight: 700, color: r.aiWinRate >= 75 ? "#ff5252" : r.aiWinRate >= 50 ? "#ffd740" : "#4caf50" }}>
                            {r.aiWinRate.toFixed(1)}%
                          </span>
                          <div style={{ fontSize: "0.70rem", color: "var(--text-muted)" }}>{r.aiConviction}</div>
                        </div>
                      ) : (
                        <span style={{ color: "var(--text-muted)" }}>-</span>
                      )}
                    </td>
                    <td>
                      {r.mode === "landmine" && r.compositeScore !== undefined ? (
                        <>
                          <span style={{ color: (r.compositeScore ?? 0) < -3 ? "#ff1744" : "#ff7043", fontWeight: 700 }}>
                            綜合: {r.compositeScore != null && !isNaN(r.compositeScore) ? r.compositeScore.toFixed(1) : "-"}分
                          </span>
                          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "2px" }}>
                            技術: {r.numericScore != null && !isNaN(r.numericScore) ? r.numericScore.toFixed(1) : "-"} | 基本: {r.fundScore ?? 0} ({getFsGrade(r.fundScore ?? 0)})
                          </div>
                        </>
                      ) : r.mode === "short" && r.compositeScore !== undefined ? (
                        <>
                          <span style={{ color: "#ab47bc", fontWeight: 700 }}>
                            放空評估: +{r.compositeScore != null && !isNaN(r.compositeScore) ? r.compositeScore.toFixed(1) : "-"}
                          </span>
                          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "2px" }}>
                            技術: +{r.numericScore != null && !isNaN(r.numericScore) ? r.numericScore.toFixed(1) : "-"} | 基本: {r.fundScore ?? 0} ({getFsGrade(r.fundScore ?? 0)})
                          </div>
                        </>
                      ) : r.mode === "value" && r.compositeScore !== undefined ? (
                        <>
                          <span style={{ color: "var(--accent-blue)", fontWeight: 700 }}>
                            尋寶指數: +{r.compositeScore != null && !isNaN(r.compositeScore) ? r.compositeScore.toFixed(1) : "-"}
                          </span>
                          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "2px" }}>
                            基本: {r.fundScore ?? 0} ({getFsGrade(r.fundScore ?? 0)}) | 技術: {r.numericScore != null && !isNaN(r.numericScore) ? r.numericScore.toFixed(1) : "-"}
                          </div>
                        </>
                      ) : (
                        <span style={{ color: r.numericScore >= 0 ? "var(--accent-red)" : "var(--accent-green)", fontWeight: 600 }}>
                          {r.score}
                        </span>
                      )}
                    </td>
                    <td style={{ fontSize: "0.8rem" }}>
                      {r.mode === "landmine" ? (
                        <>
                          {r.techRisks && r.techRisks.length > 0 && (
                            <div style={{ marginBottom: "4px" }}>
                              <span style={{ color: "#ff7043", fontWeight: 600 }}>📉 技術面：</span>
                              <span style={{ color: "#ff7043" }}>{r.techRisks.join("、")}</span>
                            </div>
                          )}
                          {r.fundRisks && r.fundRisks.length > 0 && (
                            <div>
                              <span style={{ color: "#ffab40", fontWeight: 600 }}>💰 財務面：</span>
                              <span style={{ color: "#ffab40" }}>{r.fundRisks.join(" | ")}</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <span style={{ color: "var(--text-secondary)" }}>{r.desc}</span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button className="btn btn-outline btn-sm" onClick={() => onAnalyze?.(r.symbol)}>
                          詳細分析
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
    </div>
  );
};
