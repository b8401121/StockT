import React, { useCallback, useRef, useState } from "react";
import { invoke } from "../utils/platform";
import { calculateAllIndicators, OhlcvData } from "../utils/indicators";
import { calcTechScanScore, checkLandmineRisks, computeFundamentalScore, getFsGrade } from "../utils/analysis";
import { exportToHtmlFile } from "../utils/exportHtml";

interface ScanResult {
  symbol: string;
  name: string;
  score: string;
  numericScore: number;
  compositeScore?: number;
  desc: string;
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

function getSymbolsByMarket(market: string): string[] {
  if (!STOCK_DB.length) return ["2330.TW", "0050.TW", "2317.TW", "2412.TW", "2308.TW"];
  return STOCK_DB.filter((s) => {
    const code = s.symbol.split(".")[0];
    if (market === "ALL") return true;
    if (market === "TW") return s.symbol.endsWith(".TW");
    if (market === "TWO") return s.symbol.endsWith(".TWO");
    if (market === "00") return code.startsWith("00");
    if (market === "1A") { const n = parseInt(code); return n >= 1100 && n < 1700; }
    if (market === "1B") { const n = parseInt(code); return n >= 1700 && n < 2000; }
    if (market === "2A") { const n = parseInt(code); return n >= 2000 && n < 3000; }
    if (market === "3A") { const n = parseInt(code); return n >= 3000 && n < 3700; }
    if (market === "3B") { const n = parseInt(code); return n >= 3700 && n < 3900; }
    if (market === "4A") { const n = parseInt(code); return n >= 4100 && n < 5000; }
    if (market === "5A") { const n = parseInt(code); return n >= 5000 && n < 6000; }
    if (market === "6A") { const n = parseInt(code); return n >= 6000 && n < 7000; }
    if (market === "8A") { const n = parseInt(code); return n >= 8000; }
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
    const BATCH = (mode === "buy") ? 12 : 6;
    const scanResults: ScanResult[] = [];

    for (let i = 0; i < total; i += BATCH) {
      if (cancelRef.current) break;
      const chunk = symbols.slice(i, Math.min(i + BATCH, total));
      setProgressMsg(`掃描中... ${i + 1}~${Math.min(i + BATCH, total)} / ${total}`);
      setProgress(Math.floor((i / total) * 100));

      try {
        const isFull = mode === "landmine" || mode === "short" || mode === "value";
        const apiName = isFull ? "fetch_batch_stock_data_full" : "fetch_batch_stock_data";
        const apiArgs = isFull ? { symbols: chunk, range: "1y" } : { symbols: chunk };
        const dataList: any[] = await invoke(apiName, apiArgs);
        for (const data of dataList) {
          if (cancelRef.current) break;
          const ohlcv: OhlcvData = data.ohlcv;
          if (ohlcv.close.length < 20) continue;
          const ind = calculateAllIndicators(ohlcv);
          const n = ohlcv.close.length - 1;
          const { score, reasons, risks: techRisks } = calcTechScanScore(ind, n);
          const name = data.info.name || data.info.symbol;

          if (mode === "buy" && score >= 1 && reasons.length > 0) {
            scanResults.push({ symbol: data.info.symbol, name, score: `+${score.toFixed(1)}分`, numericScore: score, desc: reasons.join("、"), mode });
          } else if (mode === "value") {
            const fsResult = computeFundamentalScore(data.info);
            const fsScore = fsResult.score;
            // 基本面良好以上 (fsScore >= 4) 且技術面走弱 (score <= -0.5)
            if (fsScore >= 4 && score <= -0.5) {
              const passedItems = fsResult.passed.map(([label]) => label);
              const desc = `【價值尋寶】基本面良好為 ${getFsGrade(fsScore)}(分數:${fsScore})；但技術面線型偏弱(技術分:${score.toFixed(1)}分)${passedItems.length ? `。優秀指標: ${passedItems.join(", ")}` : ""}`;
              const composite = fsScore - score; // 分數差值越大，代表基本面越好且股價跌得越深（性價比越高）
              scanResults.push({
                symbol: data.info.symbol,
                name,
                score: `基本: ${fsScore} | 技術: ${score.toFixed(1)}`,
                numericScore: score,
                compositeScore: composite,
                desc,
                fundScore: fsScore,
                mode
              });
            }
          } else if (mode === "landmine") {
            const allRisks = checkLandmineRisks(ind, data.info, n);
            // 分開技術地雷與財務地雷
            const lmTechRisks = allRisks.filter(r =>
              r.startsWith("📉") || r.startsWith("😱") || r.startsWith("🧨") || r.startsWith("🌪️")
            );
            const lmFundRisks = allRisks.filter(r =>
              r.startsWith("💸") || r.startsWith("📛") || r.startsWith("🔴") ||
              r.startsWith("🩸") || r.startsWith("💧") || r.startsWith("💦") ||
              r.startsWith("🏗️") || r.startsWith("📊")
            );

            const fsResult = computeFundamentalScore(data.info);
            const fsScore = fsResult.score;
            if (fsScore <= -2) {
              const failedItems = fsResult.failed.map(([label]) => label);
              const fsDesc = `⚠️ 基本面評級：${getFsGrade(fsScore)}(分數:${fsScore})${failedItems.length ? `，異常：${failedItems.join("、")}` : ""}`;
              if (!lmFundRisks.includes(fsDesc)) lmFundRisks.push(fsDesc);
            }

            // techRisks 合併：calcTechScanScore 的結果 + checkLandmineRisks 的技術類
            const mergedTechRisks = [...techRisks, ...lmTechRisks];
            const totalRisks = mergedTechRisks.length + lmFundRisks.length;
            const composite = score + (fsScore < 0 ? fsScore * 2.0 : fsScore);
            if (score <= -1.5 || lmFundRisks.length >= 1 || totalRisks >= 2 || fsScore < 0) {
              const scoreStr = `綜合: ${composite.toFixed(1)}分`;
              const desc = [...mergedTechRisks, ...lmFundRisks].join("、");
              scanResults.push({
                symbol: data.info.symbol,
                name,
                score: scoreStr,
                numericScore: score,
                compositeScore: composite,
                desc,
                techRisks: mergedTechRisks,
                fundRisks: lmFundRisks,
                fundScore: fsScore,
                mode
              });
            }

          } else if (mode === "short") {
            const fsResult = computeFundamentalScore(data.info);
            const fsScore = fsResult.score;
            // 技術趨勢強 (score >= 0.5) 且基本面極差 (fsScore <= -2)
            if (score >= 0.5 && fsScore <= -2) {
              const failedItems = fsResult.failed.map(([label]) => label);
              const fsDesc = `【放空警示】基本面極差為 ${getFsGrade(fsScore)}(分數:${fsScore})；但股價線型強勢技術分為 +${score.toFixed(1)}分${failedItems.length ? `。異常指標: ${failedItems.join(", ")}` : ""}`;
              const composite = score - fsScore; // 差值越大，技術面越強而基本面越爛，越適合放空
              scanResults.push({
                symbol: data.info.symbol,
                name,
                score: `技術: +${score.toFixed(1)} | 基本: ${fsScore}`,
                numericScore: score,
                compositeScore: composite,
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
      await new Promise((r) => setTimeout(r, 50));
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
        <div className="scan-controls-row">
          <span className="scan-label">掃描範圍：</span>
          <select className="select-field" value={market} onChange={(e) => setMarket(e.target.value)} style={{ flex: 1 }}>
            {MARKETS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
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
                        <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>
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
                      <button className="btn btn-outline btn-sm" onClick={() => onAnalyze?.(r.symbol)}>
                        詳細分析
                      </button>
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
