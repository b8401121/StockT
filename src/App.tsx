import { useEffect, useState } from "react";
import { User } from "firebase/auth";
import { toggleFullscreen } from "./utils/platform";
import { onAuthChange, logoutUser } from "./utils/firebase";
import "./index.css";
import { AuthScreen } from "./components/AuthScreen";
import { AnalysisTab } from "./components/AnalysisTab";
import { ScannerTab } from "./components/ScannerTab";
import { FundamentalScanTab } from "./components/FundamentalScanTab";
import { HybridScanTab } from "./components/HybridScanTab";
import { AIAlphaScanTab } from "./components/AIAlphaScanTab";
import { WatchlistTab } from "./components/WatchlistTab";
import { HardwareBadge } from "./components/HardwareBadge";
import { loadStocks, updateStocks } from "./utils/stocks";

type TabId = "analysis" | "scanner" | "fundamental" | "hybrid" | "ai_alpha" | "watchlist";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>("analysis");
  const [visitedTabs, setVisitedTabs] = useState<Set<TabId>>(() => new Set(["analysis"]));
  const [analyzeTarget, setAnalyzeTarget] = useState<string>("");
  const [stockStatus, setStockStatus] = useState<string>("載入中...");
  const [isUpdating, setIsUpdating] = useState<boolean>(false);

  // 帳號狀態
  const [authUser, setAuthUser] = useState<User | null | undefined>(undefined); // undefined = 初始化中
  const [username, setUsername] = useState<string>("");
  const [isGuest, setIsGuest] = useState<boolean>(false);

  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    setVisitedTabs((prev) => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  };

  // 監聽 Firebase 登入狀態
  useEffect(() => {
    const unsub = onAuthChange((user) => {
      setAuthUser(user);
      if (!user) setUsername("");
    });
    return unsub;
  }, []);

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "Enter" || e.code === "Enter")) {
        e.preventDefault();
        await toggleFullscreen();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    loadStocks().then((stocks) => {
      setStockStatus(`已載入 ${stocks.length} 檔個股`);
      setIsUpdating(true);
      setStockStatus("正在背景更新股票清單...");
      updateStocks().then((count) => {
        setIsUpdating(false);
        setStockStatus(`股票清單已更新 (共 ${count} 檔)`);
      }).catch(() => {
        setIsUpdating(false);
        setStockStatus(`更新失敗，使用快取清單`);
      });
    });
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleAnalyze = (symbol: string) => {
    setAnalyzeTarget(symbol);
    handleTabChange("analysis");
  };

  const handleLoginSuccess = (uname: string) => {
    setUsername(uname);
    setIsGuest(false);
  };

  const handleGuestMode = () => {
    setIsGuest(true);
  };

  const handleLogout = async () => {
    await logoutUser();
    setAuthUser(null);
    setUsername("");
    setIsGuest(false);
  };

  // 初始化中（等待 Firebase 回應）
  if (authUser === undefined) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#0d0f17", color: "rgba(255,255,255,0.5)", fontSize: "0.9rem" }}>
        ⏳ 初始化中...
      </div>
    );
  }

  // 未登入且非訪客模式 → 顯示登入畫面
  if (!authUser && !isGuest) {
    return <AuthScreen onLoginSuccess={handleLoginSuccess} onGuestMode={handleGuestMode} />;
  }

  const isLoggedIn = !!authUser;
  const TABS: { id: TabId; label: string; requireLogin?: boolean }[] = [
    { id: "analysis", label: "📊 個股分析" },
    { id: "ai_alpha", label: "🧠 AI 多因子選股" },
    { id: "hybrid", label: "🎯 融合選股" },
    { id: "scanner", label: "🤖 突破與動能選股" },
    { id: "fundamental", label: "📋 財報基本面選股" },
    { id: "watchlist", label: "⭐ 我的收藏", requireLogin: true },
  ];

  return (
    <div className="app-root">
      <header className="app-header">
        <div className="app-title">⛰ 阿山股市終端機 v2.0</div>
        <nav className="header-tabs">
          {TABS.map((t) => {
            if (t.requireLogin && !isLoggedIn) return null;
            return (
              <button
                key={t.id}
                className={`tab-btn ${activeTab === t.id ? "active" : ""}`}
                onClick={() => handleTabChange(t.id)}
              >
                {t.label}
              </button>
            );
          })}
        </nav>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {/* 用戶資訊 / 登出 */}
          {isLoggedIn ? (
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.6)", padding: "4px 8px", background: "rgba(255,255,255,0.05)", borderRadius: "6px" }}>
                👤 {username || "用戶"}
              </span>
              <button
                onClick={handleLogout}
                style={{
                  background: "rgba(255,82,82,0.12)", border: "1px solid rgba(255,82,82,0.3)",
                  color: "#ff8a80", borderRadius: "6px", padding: "4px 10px",
                  cursor: "pointer", fontSize: "0.78rem"
                }}
              >
                登出
              </button>
            </div>
          ) : (
            <span style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.35)", padding: "4px 8px" }}>
              👀 訪客模式
            </span>
          )}
          {/* 硬體 AI 加速狀態徽章 */}
          <HardwareBadge showDetail={true} />

          {/* 全螢幕按鈕 */}
          <button
            onClick={async () => await toggleFullscreen()}
            style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)", color: "white", padding: "4px 8px", borderRadius: "4px", cursor: "pointer", fontSize: "0.8rem" }}
            title="全螢幕 (Alt+Enter)"
          >
            🔲
          </button>
          <div style={{
            fontSize: "0.75rem", padding: "4px 8px", borderRadius: "6px",
            background: isUpdating ? "rgba(235,94,40,0.15)" : "rgba(255,255,255,0.05)",
            border: isUpdating ? "1px solid rgba(235,94,40,0.3)" : "1px solid rgba(255,255,255,0.1)",
            color: isUpdating ? "#eb5e28" : "rgba(255,255,255,0.6)",
          }}>
            {stockStatus}
          </div>
        </div>
      </header>

      <main className="app-main" style={{ position: "relative", height: "100%", width: "100%" }}>
        {visitedTabs.has("analysis") && (
          <div style={{ display: activeTab === "analysis" ? "block" : "none", height: "100%", width: "100%" }}>
            <AnalysisTab initialSymbol={analyzeTarget} />
          </div>
        )}
        {visitedTabs.has("ai_alpha") && (
          <div style={{ display: activeTab === "ai_alpha" ? "block" : "none", height: "100%", width: "100%" }}>
            <AIAlphaScanTab onAnalyze={handleAnalyze} />
          </div>
        )}
        {visitedTabs.has("hybrid") && (
          <div style={{ display: activeTab === "hybrid" ? "block" : "none", height: "100%", width: "100%" }}>
            <HybridScanTab onAnalyze={handleAnalyze} />
          </div>
        )}
        {visitedTabs.has("scanner") && (
          <div style={{ display: activeTab === "scanner" ? "block" : "none", height: "100%", width: "100%" }}>
            <ScannerTab onAnalyze={handleAnalyze} />
          </div>
        )}
        {visitedTabs.has("fundamental") && (
          <div style={{ display: activeTab === "fundamental" ? "block" : "none", height: "100%", width: "100%" }}>
            <FundamentalScanTab onAnalyze={handleAnalyze} />
          </div>
        )}
        {isLoggedIn && visitedTabs.has("watchlist") && (
          <div style={{ display: activeTab === "watchlist" ? "flex" : "none", height: "100%", width: "100%" }}>
            <WatchlistTab user={authUser} username={username} onAnalyze={handleAnalyze} isActive={activeTab === "watchlist"} />
          </div>
        )}
      </main>
    </div>
  );
}
