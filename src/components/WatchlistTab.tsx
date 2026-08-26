import React, { useState, useEffect, useCallback, useMemo } from "react";
import { User } from "firebase/auth";
import { subscribeWatchlist, saveWatchlistToCloud, loadWatchlistFromCloud } from "../utils/firebase";
import { getCachedStocks, subscribeStocks, StockEntry } from "../utils/stocks";
import { invoke } from "../utils/platform";

export interface PortfolioEntry {
  symbol: string;
  date: string;       // 購買日期
  price: number;      // 成交均價
  shares: number;     // 股數
  sell_price?: number;// 賣出價 (若已賣出)
}

export interface WatchlistTabProps {
  user: User | null;
  username: string;
  onAnalyze?: (sym: string) => void;
  isActive?: boolean;
}

export const WatchlistTab: React.FC<WatchlistTabProps> = ({ user, username, onAnalyze, isActive }) => {
  const [lists, setLists] = useState<Record<string, PortfolioEntry[]>>({ "我的自選股": [] });
  const [activeList, setActiveList] = useState("我的自選股");
  const [newSymbol, setNewSymbol] = useState("");
  const [newListName, setNewListName] = useState("");
  const [showNewList, setShowNewList] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshingPrices, setRefreshingPrices] = useState(false);

  // 交易成本設定
  const [deductFees, setDeductFees] = useState(true);
  const [feeDiscount, setFeeDiscount] = useState<number>(0.6); // 預設 6 折

  // 即時報價快取: symbol -> current_price
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [stockDb, setStockDb] = useState<StockEntry[]>(getCachedStocks());

  useEffect(() => {
    return subscribeStocks((s) => setStockDb(s));
  }, []);

  // 標準化資料結構 (支援字串轉物件)
  const normalizeLists = (rawLists: Record<string, any[]>): Record<string, PortfolioEntry[]> => {
    const normalized: Record<string, PortfolioEntry[]> = {};
    for (const [k, arr] of Object.entries(rawLists)) {
      normalized[k] = (arr || []).map((item) => {
        if (typeof item === "string") {
          return {
            symbol: item,
            date: new Date().toISOString().slice(0, 10),
            price: 0,
            shares: 0,
          };
        }
        return {
          symbol: item.symbol || "",
          date: item.date || new Date().toISOString().slice(0, 10),
          price: Number(item.price) || 0,
          shares: Number(item.shares) || 0,
          sell_price: item.sell_price ? Number(item.sell_price) : undefined,
        };
      });
    }
    return Object.keys(normalized).length > 0 ? normalized : { "我的自選股": [] };
  };

  // 刷新即時行情報價
  const fetchQuotes = useCallback(async (currentLists: Record<string, PortfolioEntry[]>) => {
    const allSymbols = Array.from(
      new Set(Object.values(currentLists).flatMap((items) => items.map((it) => it.symbol)).filter(Boolean))
    );
    if (allSymbols.length === 0) return;

    setRefreshingPrices(true);
    try {
      const dataList: any[] = await invoke("fetch_batch_stock_data", { symbols: allSymbols, range: "1mo" });
      const newPrices: Record<string, number> = {};
      for (const d of dataList) {
        if (d?.info?.symbol && d?.info?.current_price) {
          newPrices[d.info.symbol] = Number(d.info.current_price);
        }
      }
      setPrices((prev) => ({ ...prev, ...newPrices }));
    } catch (e) {
      console.warn("Fetch quotes error:", e);
    } finally {
      setRefreshingPrices(false);
    }
  }, []);

  // 雲端資料同步與監聽
  useEffect(() => {
    if (!user) return;

    const reloadData = () => {
      setLoading(true);
      loadWatchlistFromCloud(user.uid)
        .then(({ lists: cloudLists }) => {
          if (cloudLists && Object.keys(cloudLists).length > 0) {
            const norm = normalizeLists(cloudLists);
            setLists(norm);
            setActiveList((prev) => (norm[prev] ? prev : Object.keys(norm)[0]));
            fetchQuotes(norm);
          }
        })
        .catch(console.error)
        .finally(() => setLoading(false));
    };

    if (isActive !== false) {
      reloadData();
    }

    const unsub = subscribeWatchlist(user.uid, ({ lists: cloudLists }) => {
      if (cloudLists && Object.keys(cloudLists).length > 0) {
        const norm = normalizeLists(cloudLists);
        setLists(norm);
        setActiveList((prev) => (norm[prev] ? prev : Object.keys(norm)[0]));
        fetchQuotes(norm);
      }
    });

    const handleCustomUpdate = (e: any) => {
      if (e.detail?.lists) {
        const norm = normalizeLists(e.detail.lists);
        setLists(norm);
        setActiveList((prev) => (norm[prev] ? prev : Object.keys(norm)[0]));
        fetchQuotes(norm);
      } else {
        reloadData();
      }
    };

    window.addEventListener("stockt_watchlist_updated", handleCustomUpdate);
    return () => {
      unsub();
      window.removeEventListener("stockt_watchlist_updated", handleCustomUpdate);
    };
  }, [user, isActive, fetchQuotes]);

  // 儲存到雲端
  const saveToCloud = useCallback(async (updatedLists: Record<string, PortfolioEntry[]>) => {
    if (!user) return;
    setSyncing(true);
    try {
      await saveWatchlistToCloud(user.uid, username, updatedLists);
      setSyncMsg({ type: "success", text: "✅ 雲端已同步" });
    } catch (e) {
      setSyncMsg({ type: "error", text: "⚠️ 同步失敗" });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 2000);
    }
  }, [user, username]);

  const currentEntries = lists[activeList] ?? [];

  // 計算台股損益與成本
  const calculateEntryPnl = (entry: PortfolioEntry) => {
    const curPrice = prices[entry.symbol] || entry.price || 0;
    const rawCost = entry.price * entry.shares;
    const rawMarketValue = curPrice * entry.shares;

    if (entry.price <= 0 || entry.shares <= 0) {
      return {
        curPrice,
        marketValue: rawMarketValue,
        cost: rawCost,
        pnl: 0,
        pnlPct: 0,
        buyFee: 0,
        sellFee: 0,
        tax: 0,
      };
    }

    if (!deductFees) {
      const pnl = rawMarketValue - rawCost;
      const pnlPct = rawCost > 0 ? (pnl / rawCost) * 100 : 0;
      return {
        curPrice,
        marketValue: rawMarketValue,
        cost: rawCost,
        pnl,
        pnlPct,
        buyFee: 0,
        sellFee: 0,
        tax: 0,
      };
    }

    const feeRate = 0.001425 * feeDiscount;
    const buyFee = Math.max(Math.floor(rawCost * feeRate), 1);
    const sellFee = Math.max(Math.floor(rawMarketValue * feeRate), 1);
    const isEtf = entry.symbol.startsWith("00");
    const tax = Math.floor(rawMarketValue * (isEtf ? 0.001 : 0.003));

    const netCost = rawCost + buyFee;
    const netMarketValue = rawMarketValue - sellFee - tax;
    const pnl = netMarketValue - netCost;
    const pnlPct = netCost > 0 ? (pnl / netCost) * 100 : 0;

    return {
      curPrice,
      marketValue: rawMarketValue,
      cost: netCost,
      pnl,
      pnlPct,
      buyFee,
      sellFee,
      tax,
    };
  };

  // 總計數據
  const totals = useMemo(() => {
    let totalCost = 0;
    let totalMarketValue = 0;
    let totalPnl = 0;

    currentEntries.forEach((entry) => {
      const calc = calculateEntryPnl(entry);
      if (entry.shares > 0 && entry.price > 0) {
        totalCost += calc.cost;
        totalMarketValue += calc.marketValue;
        totalPnl += calc.pnl;
      }
    });

    const totalRoi = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
    return { totalCost, totalMarketValue, totalPnl, totalRoi };
  }, [currentEntries, prices, deductFees, feeDiscount]);

  // 新增股票
  const addSymbol = async () => {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym || !activeList) return;
    const match = stockDb.find((s) => s.symbol.split(".")[0] === sym || s.symbol === sym || s.name === sym);
    const finalSym = match ? match.symbol : sym.includes(".") ? sym : `${sym}.TW`;

    if (currentEntries.some((e) => e.symbol === finalSym)) {
      setNewSymbol("");
      return;
    }

    const newEntry: PortfolioEntry = {
      symbol: finalSym,
      date: new Date().toISOString().slice(0, 10),
      price: prices[finalSym] || 0,
      shares: 1000,
    };

    const updated = { ...lists, [activeList]: [...currentEntries, newEntry] };
    setLists(updated);
    setNewSymbol("");
    await saveToCloud(updated);
    fetchQuotes(updated);
  };

  // 刪除股票
  const removeEntry = async (idx: number) => {
    const updatedEntries = currentEntries.filter((_, i) => i !== idx);
    const updated = { ...lists, [activeList]: updatedEntries };
    setLists(updated);
    await saveToCloud(updated);
  };

  // 更新持股欄位
  const updateField = (idx: number, field: keyof PortfolioEntry, val: any) => {
    const updatedEntries = [...currentEntries];
    updatedEntries[idx] = { ...updatedEntries[idx], [field]: val };
    const updated = { ...lists, [activeList]: updatedEntries };
    setLists(updated);
  };

  // 儲存欄位變更到雲端
  const handleBlurSave = () => {
    saveToCloud(lists);
  };

  // 建立分類清單
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

  // 刪除分類清單
  const deleteList = async (name: string) => {
    if (Object.keys(lists).length <= 1) return;
    if (!window.confirm(`確定刪除分類「${name}」及其所有持股紀錄嗎？`)) return;
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
        <div style={{ fontSize: "0.88rem" }}>登入後即可使用個人專屬持股管理與雲端同步功能</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden", background: "#0d0f17" }}>
      {/* ─── 左側：分類名單選單 ────────────────────────────────────── */}
      <div style={{
        width: "210px", minWidth: "180px", background: "rgba(255,255,255,0.02)",
        borderRight: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column",
        padding: "14px 10px", gap: "6px"
      }}>
        <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginBottom: "4px", padding: "0 4px", fontWeight: 600 }}>
          📂 收藏與持股分類
        </div>
        {Object.keys(lists).map((name) => (
          <div
            key={name}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              borderRadius: "8px", padding: "8px 10px",
              background: activeList === name ? "rgba(33, 150, 243, 0.15)" : "transparent",
              border: activeList === name ? "1px solid rgba(33,150,243,0.35)" : "1px solid transparent",
              cursor: "pointer", transition: "all 0.15s ease"
            }}
            onClick={() => setActiveList(name)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
              <span>⭐</span>
              <span style={{
                fontSize: "0.88rem", fontWeight: activeList === name ? 700 : 400,
                color: activeList === name ? "var(--accent-blue)" : "var(--text-secondary)",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
              }}>
                {name}
              </span>
            </div>
            <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", background: "rgba(255,255,255,0.05)", padding: "2px 6px", borderRadius: "10px" }}>
              {lists[name]?.length || 0}
            </span>
            {Object.keys(lists).length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); deleteList(name); }}
                title="刪除此分類"
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,82,82,0.4)", fontSize: "0.75rem", padding: "0 2px", marginLeft: "4px" }}
              >
                ✕
              </button>
            )}
          </div>
        ))}

        {showNewList ? (
          <div style={{ display: "flex", gap: "4px", marginTop: "8px" }}>
            <input
              className="input-field"
              style={{ flex: 1, padding: "6px 8px", fontSize: "0.82rem" }}
              placeholder="分類名稱 (如: 核心持股)"
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createList(); if (e.key === "Escape") setShowNewList(false); }}
              autoFocus
            />
            <button onClick={createList} className="btn btn-primary" style={{ padding: "6px 10px", fontSize: "0.75rem" }}>✓</button>
          </div>
        ) : (
          <button
            onClick={() => setShowNewList(true)}
            style={{
              marginTop: "8px", background: "none", border: "1px dashed rgba(255,255,255,0.15)",
              borderRadius: "8px", color: "rgba(255,255,255,0.5)", padding: "8px", cursor: "pointer",
              fontSize: "0.82rem", transition: "all 0.2s"
            }}
          >
            ＋ 新增自選分類
          </button>
        )}
      </div>

      {/* ─── 右側：持股明細與資產儀表板 ───────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* 頂部資產總覽卡片 */}
        <div style={{
          display: "flex", alignItems: "center", gap: "16px", padding: "12px 18px",
          background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.08)", flexWrap: "wrap"
        }}>
          <div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>總投入成本</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--text-primary)" }}>
              ${totals.totalCost.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div style={{ width: "1px", height: "24px", background: "rgba(255,255,255,0.1)" }} />
          <div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>總持股市值</div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700, color: "var(--accent-blue)" }}>
              ${totals.totalMarketValue.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
            </div>
          </div>
          <div style={{ width: "1px", height: "24px", background: "rgba(255,255,255,0.1)" }} />
          <div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>總預估損益 / 總報酬率</div>
            <div style={{
              fontSize: "1.15rem", fontWeight: 700,
              color: totals.totalPnl > 0 ? "var(--accent-red)" : totals.totalPnl < 0 ? "var(--accent-green)" : "var(--text-primary)"
            }}>
              {totals.totalPnl > 0 ? "+" : ""}${totals.totalPnl.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}
              <span style={{ fontSize: "0.88rem", marginLeft: "6px", fontWeight: 600 }}>
                ({totals.totalRoi > 0 ? "+" : ""}{totals.totalRoi.toFixed(2)}%)
              </span>
            </div>
          </div>

          <div style={{ flex: 1 }} />

          {/* 手續費折讓設定 */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "0.8rem", color: "var(--text-muted)", background: "rgba(255,255,255,0.03)", padding: "6px 12px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.06)" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: "#fff" }}>
              <input type="checkbox" checked={deductFees} onChange={(e) => setDeductFees(e.target.checked)} />
              計算手續費/稅金
            </label>
            {deductFees && (
              <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span>折讓:</span>
                <input
                  type="number" step="0.05" min="0" max="1"
                  value={feeDiscount}
                  onChange={(e) => setFeeDiscount(parseFloat(e.target.value) || 0)}
                  style={{ width: "45px", padding: "2px 4px", fontSize: "0.78rem", background: "rgba(0,0,0,0.3)", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "4px" }}
                />
                <span>折</span>
              </div>
            )}
          </div>

          <button
            className="btn btn-outline btn-sm"
            onClick={() => fetchQuotes(lists)}
            disabled={refreshingPrices}
            style={{ fontSize: "0.8rem", padding: "6px 12px" }}
          >
            {refreshingPrices ? "🔄 刷新中..." : "🔄 刷新市價"}
          </button>
        </div>

        {/* 次操作列：快速新增與同步狀態 */}
        <div style={{
          display: "flex", gap: "10px", alignItems: "center", padding: "10px 18px",
          borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.15)"
        }}>
          <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--text-primary)" }}>
            ⭐ {activeList}
            <span style={{ marginLeft: "8px", fontSize: "0.78rem", color: "var(--text-muted)", fontWeight: 400 }}>
              (共 {currentEntries.length} 檔持股)
            </span>
          </div>

          <div style={{ flex: 1 }} />

          {syncMsg && (
            <span style={{
              fontSize: "0.8rem", padding: "3px 10px", borderRadius: "6px",
              background: syncMsg.type === "success" ? "rgba(76,175,80,0.15)" : "rgba(255,82,82,0.15)",
              color: syncMsg.type === "success" ? "#a5d6a7" : "#ff8a80",
              border: `1px solid ${syncMsg.type === "success" ? "rgba(76,175,80,0.3)" : "rgba(255,82,82,0.3)"}`
            }}>
              {syncMsg.text}
            </span>
          )}
          {syncing && <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>☁️ 雲端同步中...</span>}

          <input
            className="input-field"
            style={{ width: "150px", padding: "6px 10px", fontSize: "0.85rem" }}
            placeholder="代碼/名稱 (例 2330)"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addSymbol(); }}
          />
          <button className="btn btn-primary btn-sm" onClick={addSymbol}>
            ➕ 加入自選
          </button>
        </div>

        {/* ─── 持股明細表格 ────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "10px 18px" }}>
          {loading ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: "40px" }}>⏳ 載入雲端資料中...</div>
          ) : currentEntries.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-muted)", marginTop: "60px", lineHeight: 2 }}>
              <div style={{ fontSize: "3rem" }}>💼</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>此分類尚無持股紀錄</div>
              <div style={{ fontSize: "0.85rem" }}>
                可在上方輸入股票代號（例如 <b>2330</b> 或 <b>3217</b>）加入，或在各分析與選股頁面點擊「⭐ 收藏」！
              </div>
            </div>
          ) : (
            <table className="data-table" style={{ width: "100%", fontSize: "0.85rem" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>代碼</th>
                  <th style={{ textAlign: "left" }}>名稱</th>
                  <th style={{ textAlign: "center" }}>購買日期</th>
                  <th style={{ textAlign: "right" }}>成交均價</th>
                  <th style={{ textAlign: "right" }}>股數</th>
                  <th style={{ textAlign: "right" }}>即時市價</th>
                  <th style={{ textAlign: "right" }}>持股市值</th>
                  <th style={{ textAlign: "right" }}>總成本</th>
                  <th style={{ textAlign: "right" }}>預估損益</th>
                  <th style={{ textAlign: "right" }}>報酬率</th>
                  <th style={{ textAlign: "center" }}>手續費/稅</th>
                  <th style={{ textAlign: "center" }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {currentEntries.map((entry, idx) => {
                  const code = entry.symbol.replace(/\.(TW|TWO)$/, "");
                  const match = stockDb.find((s) => s.symbol === entry.symbol || s.symbol.split(".")[0] === code);
                  const stockName = match ? match.name : entry.symbol;
                  const calc = calculateEntryPnl(entry);

                  return (
                    <tr key={`${entry.symbol}-${idx}`}>
                      {/* 代碼 */}
                      <td style={{ fontWeight: 700, color: "var(--accent-blue)", fontFamily: "monospace" }}>
                        {code}
                      </td>
                      {/* 名稱 */}
                      <td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
                        {stockName}
                      </td>
                      {/* 購買日期 */}
                      <td style={{ textAlign: "center" }}>
                        <input
                          type="date"
                          value={entry.date || ""}
                          onChange={(e) => updateField(idx, "date", e.target.value)}
                          onBlur={handleBlurSave}
                          style={{
                            background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.1)",
                            color: "#fff", padding: "3px 6px", borderRadius: "4px", fontSize: "0.78rem"
                          }}
                        />
                      </td>
                      {/* 成交均價 */}
                      <td style={{ textAlign: "right" }}>
                        <input
                          type="number"
                          step="0.1"
                          placeholder="買進價"
                          value={entry.price || ""}
                          onChange={(e) => updateField(idx, "price", parseFloat(e.target.value) || 0)}
                          onBlur={handleBlurSave}
                          style={{
                            width: "75px", textAlign: "right",
                            background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.1)",
                            color: "#fff", padding: "3px 6px", borderRadius: "4px", fontSize: "0.85rem"
                          }}
                        />
                      </td>
                      {/* 股數 */}
                      <td style={{ textAlign: "right" }}>
                        <input
                          type="number"
                          step="100"
                          placeholder="股數"
                          value={entry.shares || ""}
                          onChange={(e) => updateField(idx, "shares", parseInt(e.target.value, 10) || 0)}
                          onBlur={handleBlurSave}
                          style={{
                            width: "75px", textAlign: "right",
                            background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.1)",
                            color: "#fff", padding: "3px 6px", borderRadius: "4px", fontSize: "0.85rem"
                          }}
                        />
                      </td>
                      {/* 即時市價 */}
                      <td style={{ textAlign: "right", fontWeight: 700, color: "var(--text-primary)" }}>
                        {calc.curPrice > 0 ? `$${calc.curPrice.toFixed(2)}` : "-"}
                      </td>
                      {/* 持股市值 */}
                      <td style={{ textAlign: "right", fontWeight: 600, color: "var(--accent-blue)" }}>
                        {calc.marketValue > 0 ? `$${calc.marketValue.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}` : "-"}
                      </td>
                      {/* 總成本 */}
                      <td style={{ textAlign: "right", color: "var(--text-secondary)" }}>
                        {calc.cost > 0 ? `$${calc.cost.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}` : "-"}
                      </td>
                      {/* 預估損益 */}
                      <td style={{
                        textAlign: "right", fontWeight: 700,
                        color: calc.pnl > 0 ? "var(--accent-red)" : calc.pnl < 0 ? "var(--accent-green)" : "var(--text-muted)"
                      }}>
                        {entry.shares > 0 && entry.price > 0 ? (
                          `${calc.pnl > 0 ? "+" : ""}$${calc.pnl.toLocaleString("zh-TW", { maximumFractionDigits: 0 })}`
                        ) : "-"}
                      </td>
                      {/* 報酬率 */}
                      <td style={{
                        textAlign: "right", fontWeight: 700,
                        color: calc.pnlPct > 0 ? "var(--accent-red)" : calc.pnlPct < 0 ? "var(--accent-green)" : "var(--text-muted)"
                      }}>
                        {entry.shares > 0 && entry.price > 0 ? (
                          `${calc.pnlPct > 0 ? "+" : ""}${calc.pnlPct.toFixed(2)}%`
                        ) : "-"}
                      </td>
                      {/* 手續費/稅金明細 */}
                      <td style={{ textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                        {deductFees && entry.shares > 0 && entry.price > 0 ? (
                          <span title={`買手續費: $${calc.buyFee} ｜ 賣手續費: $${calc.sellFee} ｜ 證交稅: $${calc.tax}`}>
                            $${calc.buyFee + calc.sellFee + calc.tax}
                          </span>
                        ) : "無"}
                      </td>
                      {/* 操作 */}
                      <td style={{ textAlign: "center" }}>
                        <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                          <button
                            className="btn btn-outline btn-sm"
                            style={{ padding: "3px 8px", fontSize: "0.75rem" }}
                            onClick={() => onAnalyze?.(entry.symbol)}
                          >
                            📊 分析
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            style={{ padding: "3px 8px", fontSize: "0.75rem" }}
                            onClick={() => removeEntry(idx)}
                          >
                            ✕
                          </button>
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
    </div>
  );
};
