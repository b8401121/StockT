import { AddToWatchlistBtn } from "./AddToWatchlistBtn";
import React, { useRef, useState } from "react";
import { invoke } from "../utils/platform";
import { calculateAllIndicators, OhlcvData } from "../utils/indicators";
import { computeFundamentalScore, getFsGrade, getTechRating, calcTechScanScore, StockInfoFull } from "../utils/analysis";
import { exportToHtmlFile } from "../utils/exportHtml";

interface HybridResult {
  symbol: string;
  name: string;
  fsScore: number;
  fsGrade: string;
  techScore: number;
  techRating: string;
  hybridScore: number;
  pe: string;
  roe: string;
}

import { getCachedStocks, subscribeStocks, StockEntry } from "../utils/stocks";

let STOCK_DB: StockEntry[] = getCachedStocks();
subscribeStocks((stocks) => {
  STOCK_DB = stocks;
});

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

export const HybridScanTab: React.FC<{ onAnalyze?: (sym: string) => void }> = ({ onAnalyze }) => {
  const [market, setMarket] = useState("3A");
  const [results, setResults] = useState<HybridResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [scanning, setScanning] = useState(false);
  const cancelRef = useRef(false);

  const hybridScoreColor = (s: number) => {
    if (s >= 5) return "var(--accent-red)";
    if (s >= 2) return "#ef9a9a";
    if (s <= -3) return "var(--accent-green)";
    return "var(--text-secondary)";
  };

  const startScan = async () => {
    const symbols = getSymbolsByMarket(market);
    if (!symbols.length) return;
    setScanning(true); cancelRef.current = false;
    setResults([]); setProgress(0);

    const total = symbols.length;
    const BATCH = 32;
    const scanResults: HybridResult[] = [];

    for (let i = 0; i < total; i += BATCH) {
      if (cancelRef.current) break;
      const chunk = symbols.slice(i, Math.min(i + BATCH, total));
      setProgressMsg(`正在即時進行基本面+技術面雙維度融合評估 ${i + 1}~${Math.min(i + BATCH, total)} / ${total} 檔...`);
      setProgress(Math.floor((i / total) * 100));
      await new Promise((r) => setTimeout(r, 45));

      try {
        const dataList: any[] = await invoke("fetch_batch_stock_data_full", { symbols: chunk, range: "1y" });
        for (const data of dataList) {
          if (cancelRef.current) break;
          const info: StockInfoFull = data.info;
          const ohlcv: OhlcvData = data.ohlcv;
          const name = info.name || info.symbol;

          // 1. 基本面評分 (官方財報 12 項財務指標)
          const fs = computeFundamentalScore(info);
          const fsGrade = getFsGrade(fs.score);

          // 2. 技術面動能評分
          let techScore = 0;
          if (ohlcv && ohlcv.close.length >= 20) {
            const ind = calculateAllIndicators(ohlcv);
            const n = ohlcv.close.length - 1;
            const { score } = calcTechScanScore(ind, n);
            techScore = score;
          } else {
            const curP = info.current_price || 0;
            const prevP = info.previous_close || curP;
            const changePct = prevP > 0 ? ((curP - prevP) / prevP) * 100 : 0;
            if (changePct >= 3.0) techScore += 2.0;
            else if (changePct >= 1.0) techScore += 1.0;
            else if (changePct > 0) techScore += 0.5;
            else if (changePct <= -3.0) techScore -= 2.0;
            else if (changePct <= -1.0) techScore -= 1.0;
          }
          const techRating = getTechRating(techScore);

          // 3. 雙維度融合評分 (基本面權重 60% + 技術面權重 40%)
          const hybridScore = Number((fs.score * 0.6 + techScore * 0.4).toFixed(1));

          // 嚴格優選品質：基本面評級良好 (fs.score >= 3)、ROE >= 5%、無重大虧損且綜合分數達標
          const roeVal = info.roe ?? 0.08;
          if (fs.score >= 3 && roeVal >= 0.05 && hybridScore >= 1.5) {
            scanResults.push({
              symbol: info.symbol,
              name,
              fsScore: fs.score,
              fsGrade,
              techScore,
              techRating,
              hybridScore,
              pe: info.tw_pe ?? info.pe ? (info.tw_pe ?? info.pe)!.toFixed(1) : "N/A",
              roe: info.roe ? `${(info.roe * 100).toFixed(1)}%` : "N/A",
            });
          }
        }
        scanResults.sort((a, b) => b.hybridScore - a.hybridScore);
        setResults([...scanResults]);
      } catch (err) {
        console.error("Batch scan error:", err);
      }
    }

    setProgress(100);
    setProgressMsg(`掃描完成！共挑選出 ${scanResults.length} 檔高分優質標的`);
    setScanning(false);
  };

  const exportHtml = async () => {
    try {
      const title = `融合智慧選股排名結果 (基本面 60% + 技術面 40%)`;
      const filename = `scan_hybrid.html`;
      const htmlContent = await exportToHtmlFile(title, results, "hybrid");
      const savedPath = await invoke("export_txt_file", { filename, content: htmlContent });
      alert(`選股名單匯出成功！已產生精美網頁檔案！\n已儲存至您的【下載】資料夾：\n${savedPath}`);
    } catch (err) {
      alert(`匯出失敗: ${err}`);
    }
  };

  return (
    <div className="scan-layout">
      <div className="scan-controls">
        <div style={{ marginBottom: "6px", color: "var(--text-muted)", fontSize: "0.82rem" }}>
          🎯 融合智慧選股 — 基本面佔 60%、技術面佔 40%，取兩者精華進行綜合排名
        </div>
        <div className="scan-controls-row">
          <span className="scan-label">掃描範圍：</span>
          <select className="select-field" value={market} onChange={(e) => setMarket(e.target.value)} style={{ marginRight: "8px" }}>
            {MARKETS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <button className="btn btn-primary" style={{ background: "linear-gradient(135deg, #7b1fa2, #4a148c)" }} onClick={startScan} disabled={scanning}>
            🎯 開始融合選股
          </button>
          {scanning && <button className="btn btn-outline" onClick={() => { cancelRef.current = true; }}>⏹ 停止</button>}
          {!scanning && results.length > 0 && (
            <button className="btn btn-outline" onClick={exportHtml}>📤 匯出精美名單</button>
          )}
          <div className="progress-bar"><div className="progress-bar-fill" style={{ width: `${progress}%` }} /></div>
          <span className="progress-label">{progressMsg}</span>
        </div>
      </div>

      <div className="scan-table-wrap">
        {results.length === 0 && !scanning ? (
          <div className="empty-state" style={{ height: "100%" }}>
            <div className="empty-icon">🎯</div>
            <div className="empty-text">融合選股將結合基本面與技術面，綜合評分排名</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>代碼</th><th>名稱</th>
                <th>綜合推薦指數</th>
                <th>基本面評等</th><th>基本分</th>
                <th>技術面建議</th>
                <th>PE / ROE</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.symbol}-${i}`}>
                  <td style={{ color: "var(--accent-blue)", fontWeight: 600 }}>{r.symbol.split(".")[0]}</td>
                  <td>{r.name}</td>
                  <td style={{ color: hybridScoreColor(r.hybridScore), fontWeight: 700, fontSize: "1rem" }}>
                    {(() => {
                      const score = r.hybridScore ?? 0;
                      const stars = Math.max(1, Math.min(5, Math.floor(score / 2) + 2));
                      return <span title={`綜合分數: ${r.hybridScore != null && !isNaN(r.hybridScore) ? r.hybridScore.toFixed(2) : "-"}`}>
                        {'★'.repeat(stars)}{'☆'.repeat(5 - stars)} ({score > 0 ? '+' : ''}{r.hybridScore != null && !isNaN(r.hybridScore) ? r.hybridScore.toFixed(1) : "-"})
                      </span>;
                    })()}
                  </td>
                  <td>
                    <span className={`badge ${r.fsScore >= 7 ? "badge-red" : r.fsScore >= 4 ? "badge-amber" : r.fsScore >= 1 ? "badge-blue" : "badge-green"}`}>
                      {r.fsGrade}
                    </span>
                  </td>
                  <td style={{ color: hybridScoreColor(r.fsScore) }}>{(r.fsScore ?? 0) > 0 ? "+" : ""}{r.fsScore ?? 0}</td>
                  <td style={{ color: (r.techScore ?? 0) >= 1.5 ? "var(--accent-red)" : (r.techScore ?? 0) <= -1.5 ? "var(--accent-green)" : "var(--text-secondary)", fontWeight: 600 }}>
                    {r.techRating} ({(r.techScore ?? 0) > 0 ? '+' : ''}{r.techScore != null && !isNaN(r.techScore) ? r.techScore.toFixed(1) : "-"})
                  </td>
                  <td style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>PE: {r.pe}</td>
                  <td style={{ color: "var(--text-secondary)", fontSize: "0.85rem" }}>ROE: {r.roe}</td>
                  <td>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => onAnalyze?.(r.symbol)}>分析</button>
                      <AddToWatchlistBtn symbol={r.symbol} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
