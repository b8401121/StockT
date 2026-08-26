import React, { useRef, useState } from "react";
import { invoke } from "../utils/platform";
import { getFsGrade, StockInfoFull } from "../utils/analysis";
import { exportToHtmlFile } from "../utils/exportHtml";

interface FsResult {
  symbol: string;
  name: string;
  score: number;
  grade: string;
  reasons: string[];
  warnings: string[];
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

export const FundamentalScanTab: React.FC<{ onAnalyze?: (sym: string) => void }> = ({ onAnalyze }) => {
  const [market, setMarket] = useState("3A");
  const [minRoe, setMinRoe] = useState(10);
  const [minGm, setMinGm] = useState(20);
  const [minNm, setMinNm] = useState(5);
  const [maxPe, setMaxPe] = useState(40);
  const [maxPb, setMaxPb] = useState(10);
  const [minDy, setMinDy] = useState(0);
  const [minCr, setMinCr] = useState(1.0);
  const [maxDe, setMaxDe] = useState(300);
  const [minScore, setMinScore] = useState(4);
  const [fcfPositive, setFcfPositive] = useState(false);
  const [results, setResults] = useState<FsResult[]>([]);
  const [progress, setProgress] = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [scanning, setScanning] = useState(false);
  const cancelRef = useRef(false);

  const startScan = async () => {
    const symbols = getSymbolsByMarket(market);
    if (!symbols.length) return;
    setScanning(true); cancelRef.current = false;
    setResults([]); setProgress(0);
    const total = symbols.length;
    const BATCH = 8;
    const scanResults: FsResult[] = [];

    for (let i = 0; i < total; i += BATCH) {
      if (cancelRef.current) break;
      const chunk = symbols.slice(i, Math.min(i + BATCH, total));
      setProgressMsg(`基本面分析 ${i + 1}~${Math.min(i + BATCH, total)} / ${total}`);
      setProgress(Math.floor((i / total) * 100));

      try {
        const dataList: any[] = await invoke("fetch_batch_stock_data_full", { symbols: chunk, range: "3mo" });
        for (const data of dataList) {
          if (cancelRef.current) break;
          const info: StockInfoFull = data.info;
          const name = info.name || info.symbol;

          let score = 0;
          const reasons: string[] = [];
          const warnings: string[] = [];

          const roe = info.roe;
          if (roe != null) {
            if (roe < minRoe / 100) continue;
            reasons.push(`ROE ${(roe * 100).toFixed(1)}%✓`);
            score += (roe >= 0.15) ? 2 : 1;
          } else {
            warnings.push("ROE (無數據)");
          }

          const gm = info.gross_margins;
          if (gm != null) {
            if (gm < minGm / 100) continue;
            reasons.push(`毛利率 ${(gm * 100).toFixed(1)}%✓`);
            score += (gm >= 0.30) ? 1 : 0;
          } else {
            warnings.push("毛利率 (無數據)");
          }

          const nm = info.profit_margins;
          if (nm != null) {
            if (nm < minNm / 100) continue;
            reasons.push(`淨利率 ${(nm * 100).toFixed(1)}%✓`);
            score += (nm >= 0.10) ? 1 : 0;
          } else {
            warnings.push("淨利率 (無數據)");
          }

          const rg = info.revenue_growth;
          if (rg != null) {
            if (rg < -0.05) continue;
            reasons.push(`營收YoY ${(rg * 100).toFixed(1)}%✓`);
            score += (rg >= 0.10) ? 1 : 0;
          } else {
            warnings.push("營收YoY (無數據)");
          }

          const eg = info.earnings_growth;
          if (eg != null) {
            if (eg <= 0) continue;
            reasons.push(`盈餘成長 ${(eg * 100).toFixed(1)}%✓`);
            score += 1;
          }

          const eps = info.eps;
          if (eps != null) {
            if (eps <= 0) continue;
            reasons.push(`EPS ${eps.toFixed(2)}✓`);
            score += 1;
          } else {
            warnings.push("EPS (無數據)");
          }

          const pe = info.tw_pe ?? info.pe;
          if (pe != null && pe > 0) {
            if (pe > maxPe) continue;
            reasons.push(`PE ${pe.toFixed(1)}✓`);
            score += (pe > 5 && pe <= 20) ? 1 : 0;
          } else {
            warnings.push("PE (無數據)");
          }

          const pb = info.tw_pb ?? info.pb;
          if (pb != null) {
            if (pb > maxPb || pb < 0) continue;
            reasons.push(`PB ${pb.toFixed(2)}✓`);
            score += (pb <= 2) ? 1 : 0;
          } else {
            warnings.push("PB (無數據)");
          }

          const dy = info.tw_yield ?? info.dividend_yield ?? 0;
          if (dy < minDy / 100) continue;
          if (dy > 0) {
            reasons.push(`殖利率 ${(dy * 100).toFixed(1)}%✓`);
            score += (dy >= 0.04) ? 1 : 0;
          }

          const cr = info.current_ratio;
          if (cr != null) {
            if (cr < minCr) continue;
            reasons.push(`流動比率 ${cr.toFixed(2)}✓`);
            score += (cr >= 1.5) ? 1 : 0;
          } else {
            warnings.push("流動比 (無數據)");
          }

          const de = info.debt_to_equity;
          if (de != null) {
            if (de > maxDe) continue;
            reasons.push(`負債比 ${de.toFixed(0)}%✓`);
            score += (de <= 50) ? 1 : 0;
          } else {
            warnings.push("負債比 (無數據)");
          }

          const fcf = info.free_cashflow;
          if (fcf != null) {
            if (fcfPositive && fcf <= 0) continue;
            if (fcf > 0) {
              reasons.push("自由現金流✓");
              score += 2;
            } else {
              warnings.push("自由現金流負✗");
            }
          } else {
            if (fcfPositive) continue;
            warnings.push("自由現金 (無數據)");
          }

          if (score >= minScore) {
            scanResults.push({ symbol: info.symbol, name, score, grade: getFsGrade(score), reasons, warnings });
          }
        }
        scanResults.sort((a, b) => b.score - a.score);
        setResults([...scanResults]);
      } catch (err) {
        console.error("Batch scan error:", err);
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    setProgress(100);
    setProgressMsg(`掃描完成！共 ${scanResults.length} 檔入選`);
    setScanning(false);
  };

  const exportHtml = async () => {
    try {
      const title = `基本面選股結果 (最低評分門檻: ${minScore}分)`;
      const filename = `scan_fundamental.html`;
      const htmlContent = await exportToHtmlFile(title, results, "fundamental");
      const savedPath = await invoke("export_txt_file", { filename, content: htmlContent });
      alert(`選股名單匯出成功！已產生精美網頁檔案！\n已儲存至您的【下載】資料夾：\n${savedPath}`);
    } catch (err) {
      alert(`匯出失敗: ${err}`);
    }
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
        <div className="criteria-grid" style={{ padding: "8px 0" }}>
          {[
            { label: "ROE 最低 (%)", val: minRoe, set: setMinRoe },
            { label: "毛利率 最低 (%)", val: minGm, set: setMinGm },
            { label: "淨利率 最低 (%)", val: minNm, set: setMinNm },
            { label: "PE 上限", val: maxPe, set: setMaxPe },
            { label: "PB 上限", val: maxPb, set: setMaxPb },
            { label: "殖利率 最低 (%)", val: minDy, set: setMinDy },
            { label: "流動比率 最低", val: minCr, set: setMinCr, step: 0.1 },
            { label: "負債/權益比 上限 (%)", val: maxDe, set: setMaxDe },
            { label: "最低評分門檻", val: minScore, set: setMinScore },
          ].map(({ label, val, set, step }) => (
            <div className="criteria-item" key={label}>
              <span className="criteria-label">{label}</span>
              <input
                type="number"
                className="criteria-input"
                value={val}
                step={step ?? 1}
                onChange={(e) => set(parseFloat(e.target.value) || 0)}
              />
            </div>
          ))}
        </div>
        <div className="scan-controls-row">
          <button className="btn btn-primary" onClick={startScan} disabled={scanning}>🔍 開始基本面選股</button>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", fontSize: "0.85rem" }}>
            <input type="checkbox" checked={fcfPositive} onChange={e => setFcfPositive(e.target.checked)} />
            強制要求自由現金流為正
          </label>
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
            <div className="empty-icon">📊</div>
            <div className="empty-text">設定篩選條件後開始掃描</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>代碼</th><th>名稱</th><th>評分</th><th>評級</th><th>指標詳情（✔ 通過｜⚠ 未通過）</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={`${r.symbol}-${i}`}>
                  <td style={{ color: "var(--accent-blue)", fontWeight: 600 }}>{r.symbol.split(".")[0]}</td>
                  <td>{r.name}</td>
                  <td style={{ color: r.score >= 8 ? "#ff5252" : r.score >= 5 ? "#ff8a80" : "var(--accent-green)", fontWeight: 700 }}>{r.score > 0 ? "+" : ""}{r.score}</td>
                  <td><span className={`badge ${r.score >= 7 ? "badge-red" : r.score >= 4 ? "badge-amber" : "badge-green"}`}>{r.grade}</span></td>
                  <td style={{ fontSize: "0.75rem" }}>
                    <span style={{ color: "#ef9a9a" }}>{r.reasons.slice(0, 5).join(" | ")}</span>
                    {r.warnings.length > 0 && <span style={{ color: "#81c784" }}> ⚠ {r.warnings.slice(0, 2).join(", ")}</span>}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => onAnalyze?.(r.symbol)}>分析</button>
                      <button
                        className="btn btn-success btn-sm"
                        onClick={async () => {
                          const { addStockToUserWatchlist } = await import("../utils/watchlistHelper");
                          const res = await addStockToUserWatchlist(r.symbol, r.name);
                          alert(res.message);
                        }}
                        title="立即存入自選股清單"
                      >
                        ⭐+ 自選
                      </button>
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
