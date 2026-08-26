import React, { useState, useEffect, useCallback } from "react";
import { User } from "firebase/auth";
import { subscribeWatchlist, saveWatchlistToCloud, loadWatchlistFromCloud } from "../utils/firebase";
import { getCachedStocks, subscribeStocks, StockEntry } from "../utils/stocks";

interface WatchlistTabProps {
  user: User | null;
  username: string;
  onAnalyze?: (sym: string) => void;
  isActive?: boolean;
}

export const WatchlistTab: React.FC<WatchlistTabProps> = ({ user, username, onAnalyze, isActive }) => {
  const [lists, setLists] = useState<Record<string, string[]>>({ "我的自選股": [] });
  const [activeList, setActiveList] = useState("我的自選股");
  const [newSymbol, setNewSymbol] = useState("");
  const [newListName, setNewListName] = useState("");
  const [showNewList, setShowNewList] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [stockDb, setStockDb] = useState<StockEntry[]>(getCachedStocks());

  useEffect(() => {
    return subscribeStocks((s) => setStockDb(s));
  }, []);

  // 實時監聽雲端資料 (Firestore onSnapshot + Tab切換 + 瀏覽器自訂事件)
  useEffect(() => {
    if (!user) return;

    const reloadData = () => {
      setLoading(true);
      loadWatchlistFromCloud(user.uid).then(({ lists: cloudLists }) => {
        if (cloudLists && Object.keys(cloudLists).length > 0) {
          setLists(cloudLists);
          setActiveList((prev) => (cloudLists[prev] ? prev : Object.keys(cloudLists)[0]));
        }
      }).catch(console.error).finally(() => setLoading(false));
    };

    // 每次切換到收藏頁面或載入時立即重新讀取
    if (isActive !== false) {
      reloadData();
    }

    // 監聽 Firestore 即時推送
    const unsub = subscribeWatchlist(user.uid, ({ lists: cloudLists }) => {
      if (cloudLists && Object.keys(cloudLists).length > 0) {
        setLists(cloudLists);
        setActiveList((prev) => (cloudLists[prev] ? prev : Object.keys(cloudLists)[0]));
      }
    });

    const handleCustomUpdate = (e: any) => {
      if (e.detail?.lists) {
        setLists(e.detail.lists);
        setActiveList((prev) => (e.detail.lists[prev] ? prev : Object.keys(e.detail.lists)[0]));
      } else {
        reloadData();
      }
    };

    window.addEventListener("stockt_watchlist_updated", handleCustomUpdate);
    return () => {
      unsub();
      window.removeEventListener("stockt_watchlist_updated", handleCustomUpdate);
    };
  }, [user, isActive]);

  // 儲存到雲端
  const saveToCloud = useCallback(async (updatedLists: Record<string, string[]>) => {
    if (!user) return;
    setSyncing(true);
    try {
      await saveWatchlistToCloud(user.uid, username, updatedLists);
      setSyncMsg({ type: "success", text: "✅ 已同步儲存！" });
    } catch (e) {
      setSyncMsg({ type: "error", text: "⚠️ 同步失敗，請稍後再試" });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 2500);
    }
  }, [user, username]);

  const currentSymbols = lists[activeList] ?? [];

  const addSymbol = async () => {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym || !activeList) return;
    // 解析正確代號格式 (如 2330 -> 2330.TW)
    const match = stockDb.find(s => s.symbol.split(".")[0] === sym || s.symbol === sym || s.name === sym);
    const finalSym = match ? match.symbol : (sym.includes(".") ? sym : `${sym}.TW`);

    if (currentSymbols.includes(finalSym)) { setNewSymbol(""); return; }
    const updated = { ...lists, [activeList]: [...currentSymbols, finalSym] };
    setLists(updated);
    setNewSymbol("");
    await saveToCloud(updated);
  };

  const removeSymbol = async (sym: string) => {
    const updated = { ...lists, [activeList]: currentSymbols.filter((s) => s !== sym) };
    setLists(updated);
    await saveToCloud(updated);
  };

  const createList = async () => {
    const name = newListName.trim();
    if (!name || lists[name]) return;
    const updated = { ...lists, [name]: [] };
    setLists(updated);
    setActiveList(name);
    setNewListName("");
    setShowNewList(false);
    await saveToCloud(updated);
  };

  const deleteList = async (name: string) => {
    if (Object.keys(lists).length <= 1) return;
    if (!window.confirm(`確定刪除清單「${name}」嗎？`)) return;
    const updated = { ...lists };
    delete updated[name];
    const firstKey = Object.keys(updated)[0];
    setLists(updated);
    setActiveList(firstKey);
    await saveToCloud(updated);
  };

  if (!user) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "16px", color: "var(--text-muted)" }}>
        <div style={{ fontSize: "3rem" }}>🔒</div>
        <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-secondary)" }}>請先登入帳號</div>
        <div style={{ fontSize: "0.88rem" }}>登入後即可使用個人收藏名單，並跨裝置同步</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", gap: "0", overflow: "hidden" }}>
      {/* 左側：清單選單 */}
      <div style={{
        width: "200px", minWidth: "160px", background: "rgba(255,255,255,0.03)",
        borderRight: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column",
        padding: "12px 8px", gap: "4px"
      }}>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "6px", padding: "0 4px" }}>
          📂 我的名單
        </div>
        {Object.keys(lists).map((name) => (
          <div key={name} style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            borderRadius: "8px", padding: "7px 10px",
            background: activeList === name ? "rgba(33, 150, 243, 0.15)" : "transparent",
            border: activeList === name ? "1px solid rgba(33,150,243,0.3)" : "1px solid transparent",
            cursor: "pointer"
          }} onClick={() => setActiveList(name)}>
            <span style={{ fontSize: "0.88rem", fontWeight: activeList === name ? 700 : 400, color: activeList === name ? "var(--accent-blue)" : "var(--text-secondary)" }}>
              ⭐ {name}
            </span>
            {Object.keys(lists).length > 1 && (
              <button onClick={(e) => { e.stopPropagation(); deleteList(name); }}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,82,82,0.5)", fontSize: "0.75rem", padding: "0 2px" }}>
                ✕
              </button>
            )}
          </div>
        ))}

        {/* 新增清單按鈕 */}
        {showNewList ? (
          <div style={{ display: "flex", gap: "4px", marginTop: "8px" }}>
            <input
              className="input-field"
              style={{ flex: 1, padding: "5px 7px", fontSize: "0.82rem" }}
              placeholder="新清單名稱"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createList(); if (e.key === "Escape") setShowNewList(false); }}
              autoFocus
            />
            <button onClick={createList} className="btn btn-primary" style={{ padding: "5px 8px", fontSize: "0.75rem" }}>✓</button>
          </div>
        ) : (
          <button onClick={() => setShowNewList(true)} style={{
            marginTop: "8px", background: "none", border: "1px dashed rgba(255,255,255,0.15)",
            borderRadius: "8px", color: "rgba(255,255,255,0.4)", padding: "6px", cursor: "pointer",
            fontSize: "0.82rem"
          }}>
            ＋ 新增名單
          </button>
        )}
      </div>

      {/* 右側：股票清單 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* 頂部操作列 */}
        <div style={{
          display: "flex", gap: "8px", alignItems: "center", padding: "10px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap"
        }}>
          <div style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text-primary)" }}>
            ⭐ {activeList}
            <span style={{ marginLeft: "8px", fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 400 }}>
              共 {currentSymbols.length} 檔
            </span>
          </div>
          <div style={{ flex: 1 }} />
          {syncMsg && (
            <span style={{
              fontSize: "0.8rem", padding: "4px 10px", borderRadius: "6px",
              background: syncMsg.type === "success" ? "rgba(76,175,80,0.15)" : "rgba(255,82,82,0.15)",
              color: syncMsg.type === "success" ? "#a5d6a7" : "#ff8a80",
              border: `1px solid ${syncMsg.type === "success" ? "rgba(76,175,80,0.3)" : "rgba(255,82,82,0.3)"}`
            }}>{syncMsg.text}</span>
          )}
          {syncing && <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>☁️ 同步中...</span>}
          {/* 新增股票欄 */}
          <input
            className="input-field"
            style={{ width: "140px", padding: "6px 10px", fontSize: "0.88rem" }}
            placeholder="代號/名稱，如 2330"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addSymbol(); }}
          />
          <button className="btn btn-primary" style={{ padding: "6px 14px", fontSize: "0.88rem" }} onClick={addSymbol}>
            ＋ 加入
          </button>
        </div>

        {/* 股票列表 */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
          {loading ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: "40px" }}>⏳ 載入雲端資料中...</div>
          ) : currentSymbols.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: "60px", lineHeight: 2 }}>
              <div style={{ fontSize: "2.5rem" }}>📋</div>
              <div>此清單尚無股票</div>
              <div style={{ fontSize: "0.82rem" }}>在上方輸入股票代號後按 Enter 加入，或在各分析/選股頁面點擊「⭐ 收藏」</div>
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ fontSize: "0.78rem", color: "var(--text-muted)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>代號</th>
                  <th style={{ textAlign: "left", padding: "8px 12px", fontWeight: 600 }}>股票名稱</th>
                  <th style={{ textAlign: "right", padding: "8px 12px", fontWeight: 600 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {currentSymbols.map((sym) => {
                  const code = sym.replace(/\.(TW|TWO)$/, "");
                  const match = stockDb.find(s => s.symbol === sym || s.symbol.split(".")[0] === code);
                  const stockName = match ? match.name : sym;

                  return (
                    <tr key={sym} style={{
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      transition: "background 0.15s"
                    }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      <td style={{ padding: "10px 12px", fontWeight: 700, color: "var(--accent-blue)", fontFamily: "monospace", fontSize: "0.95rem" }}>
                        {code}
                      </td>
                      <td style={{ padding: "10px 12px", color: "var(--text-primary)", fontWeight: 600, fontSize: "0.92rem" }}>
                        {stockName} <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 400 }}>({sym})</span>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right" }}>
                        <button
                          className="btn btn-outline"
                          style={{ padding: "4px 10px", fontSize: "0.78rem", marginRight: "6px" }}
                          onClick={() => onAnalyze?.(sym)}
                        >
                          📊 分析
                        </button>
                        <button
                          onClick={() => removeSymbol(sym)}
                          style={{
                            background: "rgba(255,82,82,0.1)", border: "1px solid rgba(255,82,82,0.2)",
                            color: "#ff8a80", borderRadius: "6px", padding: "4px 10px",
                            cursor: "pointer", fontSize: "0.78rem"
                          }}
                        >
                          🗑 移除
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
    </div>
  );
};
