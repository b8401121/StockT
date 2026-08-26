import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "../utils/platform";
import { calculateAllIndicators, OhlcvData } from "../utils/indicators";
import { calcTechScanScore, checkLandmineRisks, computeFundamentalScore, getFsGrade } from "../utils/analysis";

interface LandmineResult {
  symbol: string;
  name: string;
  techRisks: string[];
  fundRisks: string[];
  fsScore: number;
  techScore: number;
  compositeScore: number;
}

export const Watchlist: React.FC = () => {
  const [watchlist, setWatchlist] = useState<Record<string, string[]>>({});
  const [newSymbol, setNewSymbol] = useState("");
  const [newCategory, setNewCategory] = useState("預設清單");
  const [categories, setCategories] = useState<string[]>(["預設清單"]);

  // 地雷掃描
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [landmines, setLandmines] = useState<LandmineResult[]>([]);
  const [showScanModal, setShowScanModal] = useState(false);
  const cancelRef = useRef(false);

  useEffect(() => {
    loadWatchlist();
  }, []);

  const loadWatchlist = async () => {
    try {
      let data: Record<string, string[]>;
      try {
        data = await invoke("load_watchlist");
      } catch (err) {
        console.warn("Using mock watchlist");
        data = { "我的自選股": [] };
      }
      if (Object.keys(data).length === 0) {
        setWatchlist({ "我的自選股": [] });
      } else {
        setWatchlist(data);
        setCategories(Object.keys(data));
      }
    } catch (e) {
      console.error("Failed to load watchlist", e);
    }
  };

  const saveWatchlist = async (newList: Record<string, string[]>) => {
    try {
      try {
        await invoke("save_watchlist", { watchlist: newList });
      } catch (err) {
        console.warn("Mock saving watchlist");
      }
      setWatchlist(newList);
    } catch (e) {
      console.error("Failed to save watchlist", e);
    }
  };

  const addSymbol = () => {
    if (!newSymbol) return;
    const cat = newCategory || "預設清單";
    const current = watchlist[cat] || [];
    const sym = newSymbol.trim().toUpperCase();
    if (!current.includes(sym)) {
      const newList = { ...watchlist, [cat]: [...current, sym] };
      saveWatchlist(newList);
      if (!categories.includes(cat)) {
        setCategories([...categories, cat]);
      }
    }
    setNewSymbol("");
  };

  const removeSymbol = (cat: string, sym: string) => {
    const current = watchlist[cat] || [];
    const newList = { ...watchlist, [cat]: current.filter((s) => s !== sym) };
    saveWatchlist(newList);
  };

  // ── 地雷掃描邏輯（與 AI 智慧選股地雷警示完全一致）────────────────────────────
  const startLandmineScan = useCallback(async () => {
    const allSymbols = Object.values(watchlist).flat();
    if (!allSymbols.length) return;

    setScanning(true);
    setShowScanModal(true);
    setLandmines([]);
    cancelRef.current = false;
    setScanProgress(`準備掃描 ${allSymbols.length} 支自選股...`);

    const results: LandmineResult[] = [];
    const BATCH = 5;

    for (let i = 0; i < allSymbols.length; i += BATCH) {
      if (cancelRef.current) break;
      const chunk = allSymbols.slice(i, Math.min(i + BATCH, allSymbols.length));
      setScanProgress(`掃描中... ${i + 1}~${Math.min(i + BATCH, allSymbols.length)} / ${allSymbols.length}`);

      try {
        const dataList: any[] = await invoke("fetch_batch_stock_data_full", { symbols: chunk, range: "1y" });
        for (const data of dataList) {
          if (cancelRef.current) break;
          const ohlcv: OhlcvData = data.ohlcv;
          if (ohlcv.close.length < 20) continue;

          const ind = calculateAllIndicators(ohlcv);
          const n = ohlcv.close.length - 1;

          // ① 技術評分（與 ScannerTab 地雷模式完全相同）
          const { score, risks: techRisks } = calcTechScanScore(ind, n);

          // ② checkLandmineRisks 結果依 emoji 分類（技術 vs 財務）
          const allRisks = checkLandmineRisks(ind, data.info, n);
          const lmTechRisks = allRisks.filter(r =>
            r.startsWith("📉") || r.startsWith("😱") || r.startsWith("🧨") || r.startsWith("🌪️")
          );
          const lmFundRisks = allRisks.filter(r =>
            r.startsWith("💸") || r.startsWith("📛") || r.startsWith("🔴") ||
            r.startsWith("🩸") || r.startsWith("💧") || r.startsWith("💦") ||
            r.startsWith("🏗️") || r.startsWith("📊")
          );

          // ③ 基本面評分
          const fsResult = computeFundamentalScore(data.info);
          const fsScore = fsResult.score;
          if (fsScore <= -2) {
            const failedItems = fsResult.failed.map(([label]) => label);
            const fsDesc = `⚠️ 基本面評級：${getFsGrade(fsScore)}(分數:${fsScore})${failedItems.length ? `，異常：${failedItems.join("、")}` : ""}`;
            if (!lmFundRisks.includes(fsDesc)) lmFundRisks.push(fsDesc);
          }

          // ④ 合併技術訊號（同 ScannerTab）
          const mergedTechRisks = [...techRisks, ...lmTechRisks];
          const totalRisks = mergedTechRisks.length + lmFundRisks.length;
          const composite = score + (fsScore < 0 ? fsScore * 2.0 : fsScore);

          // ⑤ 門檻條件（與 ScannerTab 地雷模式完全相同）
          if (score <= -1.5 || lmFundRisks.length >= 1 || totalRisks >= 2 || fsScore < 0) {
            results.push({
              symbol: data.info.symbol,
              name: data.info.name || data.info.symbol,
              techRisks: mergedTechRisks,
              fundRisks: lmFundRisks,
              fsScore,
              techScore: score,
              compositeScore: composite,
            });
          }
        }
      } catch {}

      // 即時排序更新（財務地雷 > 雙重地雷 > 技術地雷）
      results.sort((a, b) => (a.compositeScore ?? 0) - (b.compositeScore ?? 0));
      setLandmines([...results]);
      await new Promise((r) => setTimeout(r, 50));
    }

    setScanProgress(`掃描完成！共發現 ${results.length} 支潛在地雷股`);
    setScanning(false);
  }, [watchlist]);


  const allSymbolCount = Object.values(watchlist).flat().length;

  return (
    <div style={{ padding: "20px" }}>
      <h2>自選股清單</h2>

      {/* 新增股票 */}
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
        <input
          value={newCategory}
          onChange={(e) => setNewCategory(e.currentTarget.value)}
          placeholder="分類 (預設清單)"
          style={inputStyle}
        />
        <input
          value={newSymbol}
          onChange={(e) => setNewSymbol(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && addSymbol()}
          placeholder="股票代號（如 2330.TW）"
          style={inputStyle}
        />
        <button onClick={addSymbol} style={buttonStyle}>新增</button>
        {allSymbolCount > 0 && (
          <button
            onClick={startLandmineScan}
            disabled={scanning}
            style={{
              ...buttonStyle,
              background: "linear-gradient(to bottom, #ff7043, #d32f2f)",
              border: "1px solid #b71c1c",
              display: "flex", alignItems: "center", gap: "6px"
            }}
          >
            {scanning ? "⏳ 掃描中..." : `⚠️ 地雷掃描（${allSymbolCount} 支）`}
          </button>
        )}
      </div>

      {/* 自選清單 */}
      {Object.entries(watchlist).map(([cat, symbols]) => (
        <div key={cat} style={cardStyle}>
          <h3 style={{ borderBottom: "1px solid rgba(255,255,255,0.2)", paddingBottom: "10px" }}>{cat}</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginTop: "10px" }}>
            {symbols.map((sym) => (
              <div key={sym} style={tagStyle}>
                {sym}
                <span onClick={() => removeSymbol(cat, sym)} style={{ marginLeft: "10px", cursor: "pointer", color: "#ff5252" }}>
                  ✖
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* 地雷掃描 Modal */}
      {showScanModal && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
          zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <div style={{
            background: "rgba(20,20,30,0.98)", border: "1px solid rgba(255,80,80,0.3)",
            borderRadius: "18px", padding: "28px", width: "min(800px, 95vw)",
            maxHeight: "85vh", overflowY: "auto",
            boxShadow: "0 0 40px rgba(255,80,80,0.2)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, color: "#ff7043" }}>⚠️ 自選股地雷掃描結果</h3>
              <div style={{ display: "flex", gap: "10px" }}>
                {scanning && (
                  <button onClick={() => { cancelRef.current = true; }} style={{ ...buttonStyle, background: "#555", border: "1px solid #888" }}>
                    停止
                  </button>
                )}
                <button onClick={() => setShowScanModal(false)} style={{ ...buttonStyle, background: "#333", border: "1px solid #666" }}>✕ 關閉</button>
              </div>
            </div>

            <div style={{ color: scanning ? "#ffab40" : "#a5d6a7", marginBottom: "16px", fontSize: "0.9rem" }}>
              {scanProgress}
            </div>

            {landmines.length === 0 && !scanning && (
              <div style={{ textAlign: "center", color: "#a5d6a7", padding: "40px 0" }}>
                ✅ 所有自選股均未發現明顯地雷！
              </div>
            )}

            {landmines.map((r) => {
              const isDouble = r.fundRisks.length > 0 && r.techRisks.length > 0;
              const isFundOnly = r.fundRisks.length > 0 && r.techRisks.length === 0;
              const borderColor = isDouble ? "#d50000" : isFundOnly ? "#ff5252" : "#ff7043";
              const badgeColor = isDouble ? "#d50000" : isFundOnly ? "#ff5252" : "#f57c00";
              const badgeText = isDouble ? "🔴 雙重地雷" : isFundOnly ? "⚠️ 基本面地雷" : "📉 技術地雷";

              return (
                <div key={r.symbol} style={{
                  background: "rgba(255,80,50,0.08)",
                  border: `1px solid ${borderColor}40`,
                  borderLeft: `4px solid ${borderColor}`,
                  borderRadius: "10px", padding: "14px 18px", marginBottom: "12px"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                    <div>
                      <span style={{ fontWeight: "bold", fontSize: "1.05rem" }}>{r.name}</span>
                      <span style={{ color: "#aaa", marginLeft: "10px", fontSize: "0.85rem" }}>{r.symbol}</span>
                    </div>
                    <span style={{
                      background: badgeColor, color: "#fff",
                      borderRadius: "6px", padding: "2px 10px", fontSize: "0.8rem", fontWeight: "bold"
                    }}>
                      {badgeText}
                    </span>
                  </div>

                  {r.fundRisks.length > 0 && (
                    <div style={{ marginBottom: "6px" }}>
                      <span style={{ color: "#ffab40", fontWeight: 600, fontSize: "0.82rem" }}>💰 財務面：</span>
                      {r.fundRisks.map((risk, i) => (
                        <div key={i} style={{ color: "#ffab40", fontSize: "0.85rem", marginBottom: "2px", paddingLeft: "12px" }}>• {risk}</div>
                      ))}
                    </div>
                  )}
                  {r.techRisks.length > 0 && (
                    <div>
                      <span style={{ color: "#ff8a65", fontWeight: 600, fontSize: "0.82rem" }}>📉 技術面：</span>
                      {r.techRisks.map((risk, i) => (
                        <div key={i} style={{ color: "#ff8a65", fontSize: "0.85rem", marginBottom: "2px", paddingLeft: "12px" }}>• {risk}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const inputStyle: React.CSSProperties = {
  padding: "10px",
  borderRadius: "8px",
  border: "1px solid rgba(160, 160, 160, 0.8)",
  background: "rgba(255, 255, 255, 0.85)",
  color: "#111",
  fontWeight: "bold",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: "8px",
  background: "linear-gradient(to bottom, #a6d1ff, #4d94ff)",
  border: "1px solid #2e7bff",
  color: "#fff",
  fontWeight: "bold",
  cursor: "pointer",
};

const cardStyle: React.CSSProperties = {
  background: "rgba(40, 40, 40, 0.6)",
  padding: "20px",
  borderRadius: "15px",
  border: "1px solid rgba(255,255,255,0.1)",
  marginBottom: "20px",
};

const tagStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.1)",
  padding: "5px 15px",
  borderRadius: "20px",
  display: "flex",
  alignItems: "center",
};
