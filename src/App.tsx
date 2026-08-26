import { useEffect, useState } from "react";
import { toggleFullscreen } from "./utils/platform";
import "./index.css";
import { AnalysisTab } from "./components/AnalysisTab";
import { ScannerTab } from "./components/ScannerTab";
import { FundamentalScanTab } from "./components/FundamentalScanTab";
import { HybridScanTab } from "./components/HybridScanTab";
import { loadStocks, updateStocks } from "./utils/stocks";

type TabId = "analysis" | "scanner" | "fundamental" | "hybrid";

const TABS: { id: TabId; label: string }[] = [
  { id: "analysis", label: "📊 個股分析" },
  { id: "scanner", label: "🤖 AI 智慧選股" },
  { id: "fundamental", label: "📋 基本面選股" },
  { id: "hybrid", label: "🎯 融合選股" },
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("analysis");
  const [analyzeTarget, setAnalyzeTarget] = useState<string>("");
  const [stockStatus, setStockStatus] = useState<string>("載入中...");
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  useEffect(() => {
    // 1. 全螢幕快速鍵監聽 (Alt+Enter 進入/退出)
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "Enter" || e.code === "Enter")) {
        e.preventDefault();
        await toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    // 2. 立即載入本地/內建股票庫
    loadStocks().then((stocks) => {
      setStockStatus(`已載入 ${stocks.length} 檔個股`);
      
      // 3. 背景更新最新股票清單 (約 10-20 秒)
      setIsUpdating(true);
      setStockStatus("正在背景更新股票清單...");
      updateStocks()
        .then((count) => {
          setIsUpdating(false);
          setStockStatus(`股票清單已更新 (共 ${count} 檔)`);
        })
        .catch((err) => {
          setIsUpdating(false);
          setStockStatus(`更新失敗，使用快取清單 (${stocks.length} 檔)`);
          console.error(err);
        });
    });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const handleAnalyze = (sym: string) => {
    setAnalyzeTarget(sym);
    setActiveTab("analysis");
  };

  return (
    <div className="app-root">
      {/* ── 頂部 Header ──────────────────────────────────────────────────────── */}
      <header className="app-header">
        <div className="app-title">⛰ 阿山股市終端機 v2.0</div>
        <nav className="header-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab-btn ${activeTab === t.id ? "active" : ""}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <button 
            onClick={async () => {
              await toggleFullscreen();
            }}
            style={{
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.2)",
              color: "white",
              padding: "4px 8px",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "0.8rem",
            }}
            title="全螢幕 (Alt+Enter)"
          >
            🔲
          </button>
          <div style={{
            fontSize: "0.75rem",
            padding: "4px 8px",
            borderRadius: "6px",
            background: isUpdating ? "rgba(235, 94, 40, 0.15)" : "rgba(255,255,255,0.05)",
            border: isUpdating ? "1px solid rgba(235, 94, 40, 0.3)" : "1px solid rgba(255,255,255,0.1)",
            color: isUpdating ? "#eb5e28" : "rgba(255,255,255,0.6)",
            display: "flex",
            alignItems: "center",
            gap: "6px",
            transition: "all 0.3s ease"
          }}>
            {isUpdating && (
              <span className="spinner-mini" style={{
                width: "10px",
                height: "10px",
                border: "2px solid currentColor",
                borderTopColor: "transparent",
                borderRadius: "50%",
                display: "inline-block",
                animation: "spin 1s linear infinite"
              }}></span>
            )}
            {stockStatus}
          </div>
        </div>
      </header>

      {/* ── 主內容 ───────────────────────────────────────────────────────────── */}
      <main className="app-main" style={{ position: "relative", height: "100%", width: "100%" }}>
        {/* 個股分析 */}
        <div style={{ display: activeTab === "analysis" ? "block" : "none", height: "100%", width: "100%" }}>
          <AnalysisTab
            initialSymbol={analyzeTarget}
          />
        </div>
        {/* AI 智慧選股 */}
        <div style={{ display: activeTab === "scanner" ? "block" : "none", height: "100%", width: "100%" }}>
          <ScannerTab onAnalyze={handleAnalyze} />
        </div>
        {/* 基本面選股 */}
        <div style={{ display: activeTab === "fundamental" ? "block" : "none", height: "100%", width: "100%" }}>
          <FundamentalScanTab onAnalyze={handleAnalyze} />
        </div>
        {/* 融合選股 */}
        <div style={{ display: activeTab === "hybrid" ? "block" : "none", height: "100%", width: "100%" }}>
          <HybridScanTab onAnalyze={handleAnalyze} />
        </div>
      </main>
    </div>
  );
}
