import React, { useState, useEffect, useCallback, useMemo } from "react";
import { User } from "firebase/auth";
import { subscribeWatchlist, saveWatchlistToCloud, loadWatchlistFromCloud } from "../utils/firebase";
import { getCachedStocks, subscribeStocks, StockEntry } from "../utils/stocks";
import { invoke } from "../utils/platform";

/** 原始交易紀錄 */
export interface TradeRecord {
  id: string;             // 唯一交易 ID
  symbol: string;         // 股票代號 (如 2330.TW)
  name?: string;          // 股票名稱
  type: "BUY" | "SELL";   // 交易類型: 買進 / 賣出
  date: string;           // 交易日期 (YYYY-MM-DD)
  price: number;          // 成交單價
  shares: number;         // 成交股數
  note?: string;          // 備註
}

/** 未實現持股 */
export interface UnrealizedHolding {
  symbol: string;
  name: string;
  remainingShares: number;
  avgBuyPrice: number;
  curPrice: number;
  cost: number;
  marketValue: number;
  netMarketValue: number;
  pnl: number;
  roi: number;
  buyFee: number;
  estSellFee: number;
  estTax: number;
  buyLots: {
    id: string;
    date: string;
    price: number;
    shares: number;
    buyFee: number;
    note?: string;
  }[];
}

/** 已實現損益交易 */
export interface RealizedTrade {
  id: string;
  symbol: string;
  name: string;
  buyDate: string;
  sellDate: string;
  shares: number;
  buyPrice: number;
  sellPrice: number;
  cost: number;
  revenue: number;
  fee: number;
  tax: number;
  pnl: number;
  roi: number;
  note?: string;
}

export interface WatchlistTabProps {
  user: User | null;
  username: string;
  onAnalyze?: (sym: string) => void;
  isActive?: boolean;
}

export const WatchlistTab: React.FC<WatchlistTabProps> = ({ user, username, onAnalyze, isActive }) => {
  // 分類名單 -> 交易紀錄陣列
  const [lists, setLists] = useState<Record<string, TradeRecord[]>>({ "我的自選股": [] });
  const [activeList, setActiveList] = useState("我的自選股");
  const [viewTab, setViewTab] = useState<"unrealized" | "realized" | "trades">("unrealized");

  // 即時市價快取
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [stockDb, setStockDb] = useState<StockEntry[]>(getCachedStocks());
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [_syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [_loading, setLoading] = useState(false);

  // 交易成本設定
  const [deductFees, setDeductFees] = useState(true);
  const [feeDiscount, setFeeDiscount] = useState<number>(1.0); // 預設 1.0 折 (法定標準費率 0.1425%)

  // 分類管理
  const [newListName, setNewListName] = useState("");
  const [showNewList, setShowNewList] = useState(false);

  // 交易錄入 Modal
  const [tradeModal, setTradeModal] = useState<{
    show: boolean;
    mode: "add" | "edit";
    record: TradeRecord;
  } | null>(null);
  const [modalAutocomplete, setModalAutocomplete] = useState<StockEntry[]>([]);

  // 展開買進批次詳情
  const [expandedSymbols, setExpandedSymbols] = useState<Record<string, boolean>>({});

  useEffect(() => {
    return subscribeStocks((s) => setStockDb(s));
  }, []);

  // 標準化資料結構 (支援舊版 PortfolioEntry 相容轉換)
  const normalizeLists = useCallback((rawLists: Record<string, any[]>): Record<string, TradeRecord[]> => {
    const normalized: Record<string, TradeRecord[]> = {};
    for (const [k, arr] of Object.entries(rawLists)) {
      normalized[k] = (arr || []).map((item, idx) => {
        if (typeof item === "string") {
          return {
            id: `legacy-${idx}-${Date.now()}`,
            symbol: item,
            name: stockDb.find((s) => s.symbol === item)?.name || "",
            type: "BUY",
            date: new Date().toISOString().slice(0, 10),
            price: 0,
            shares: 0,
          };
        }
        return {
          id: item.id || `trade-${idx}-${item.date || Date.now()}`,
          symbol: item.symbol || "",
          name: item.name || stockDb.find((s) => s.symbol === item.symbol)?.name || "",
          type: item.type === "SELL" ? "SELL" : "BUY",
          date: item.date || new Date().toISOString().slice(0, 10),
          price: Number(item.price) || 0,
          shares: Number(item.shares) || 0,
          note: item.note || "",
        };
      });
    }
    return Object.keys(normalized).length > 0 ? normalized : { "我的自選股": [] };
  }, [stockDb]);

  // 刷新即時行情報價
  const fetchQuotes = useCallback(async (currentLists: Record<string, TradeRecord[]>) => {
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
  }, [user, isActive, fetchQuotes, normalizeLists]);

  // 儲存到雲端
  const saveToCloud = useCallback(async (updatedLists: Record<string, TradeRecord[]>) => {
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

  const currentTrades = lists[activeList] ?? [];

  // ─── FIFO 損益會計核心計算 (未實現 + 已實現) ──────────────────────────
  const ledger = useMemo(() => {
    const feeRate = deductFees ? 0.001425 * feeDiscount : 0;

    // 依股票代號分組
    const bySymbol: Record<string, TradeRecord[]> = {};
    for (const t of currentTrades) {
      if (!t.symbol) continue;
      if (!bySymbol[t.symbol]) bySymbol[t.symbol] = [];
      bySymbol[t.symbol].push(t);
    }

    const unrealizedHoldings: UnrealizedHolding[] = [];
    const realizedTrades: RealizedTrade[] = [];

    for (const [symbol, symTrades] of Object.entries(bySymbol)) {
      const stockName = stockDb.find((s) => s.symbol === symbol)?.name || symTrades[0]?.name || symbol;
      const isEtf = symbol.startsWith("00");

      // 依日期升冪排序 (先進先出 FIFO)
      const sorted = [...symTrades].sort((a, b) => (a.date || "").localeCompare(b.date || ""));

      interface BuyLot {
        id: string;
        date: string;
        price: number;
        shares: number;
        buyFee: number;
        note?: string;
      }

      const buyLots: BuyLot[] = [];

      for (const trade of sorted) {
        const type = (trade.type || "BUY").toUpperCase();
        const shares = Number(trade.shares) || 0;
        const price = Number(trade.price) || 0;

        if (shares <= 0 || price <= 0) continue;

        if (type === "BUY") {
          const rawCost = price * shares;
          const buyFee = deductFees ? Math.max(Math.floor(rawCost * feeRate), 1) : 0;
          buyLots.push({
            id: trade.id || `${trade.date}-${Math.random()}`,
            date: trade.date,
            price,
            shares,
            buyFee,
            note: trade.note,
          });
        } else if (type === "SELL") {
          let sharesToSell = shares;
          const sellPrice = price;
          const rawRevenue = sellPrice * shares;
          const sellFee = deductFees ? Math.max(Math.floor(rawRevenue * feeRate), 1) : 0;
          const tax = deductFees ? Math.floor(rawRevenue * (isEtf ? 0.001 : 0.003)) : 0;

          while (sharesToSell > 0 && buyLots.length > 0) {
            const lot = buyLots[0];
            const matchShares = Math.min(sharesToSell, lot.shares);

            // 依比例分攤手續費
            const lotCostRatio = lot.shares > 0 ? matchShares / lot.shares : 1;
            const propBuyFee = Math.floor(lot.buyFee * lotCostRatio);
            const buyCost = matchShares * lot.price + propBuyFee;

            const sellRevenueRatio = shares > 0 ? matchShares / shares : 1;
            const propSellFee = Math.floor(sellFee * sellRevenueRatio);
            const propTax = Math.floor(tax * sellRevenueRatio);
            const netSellRevenue = matchShares * sellPrice - propSellFee - propTax;

            const pnl = netSellRevenue - buyCost;
            const roi = buyCost > 0 ? (pnl / buyCost) * 100 : 0;

            realizedTrades.push({
              id: `${trade.id}-${lot.id}`,
              symbol,
              name: stockName,
              buyDate: lot.date,
              sellDate: trade.date,
              shares: matchShares,
              buyPrice: lot.price,
              sellPrice,
              cost: buyCost,
              revenue: netSellRevenue,
              fee: propBuyFee + propSellFee,
              tax: propTax,
              pnl,
              roi,
              note: trade.note,
            });

            lot.shares -= matchShares;
            lot.buyFee -= propBuyFee;
            sharesToSell -= matchShares;

            if (lot.shares <= 0) {
              buyLots.shift();
            }
          }
        }
      }

      // 剩餘庫存 = 未實現持股
      if (buyLots.length > 0) {
        const remainingShares = buyLots.reduce((acc, l) => acc + l.shares, 0);
        const totalCost = buyLots.reduce((acc, l) => acc + (l.price * l.shares + l.buyFee), 0);
        const avgBuyPrice = remainingShares > 0 ? buyLots.reduce((acc, l) => acc + l.price * l.shares, 0) / remainingShares : 0;

        const curPrice = prices[symbol] || avgBuyPrice;
        const rawMarketValue = curPrice * remainingShares;
        const estSellFee = deductFees ? Math.max(Math.floor(rawMarketValue * feeRate), 1) : 0;
        const estTax = deductFees ? Math.floor(rawMarketValue * (isEtf ? 0.001 : 0.003)) : 0;
        const netMarketValue = rawMarketValue - estSellFee - estTax;
        const pnl = netMarketValue - totalCost;
        const roi = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

        unrealizedHoldings.push({
          symbol,
          name: stockName,
          remainingShares,
          avgBuyPrice,
          curPrice,
          cost: totalCost,
          marketValue: rawMarketValue,
          netMarketValue,
          pnl,
          roi,
          buyFee: buyLots.reduce((acc, l) => acc + l.buyFee, 0),
          estSellFee,
          estTax,
          buyLots,
        });
      }
    }

    // 總結統計
    const totalUnrealizedCost = unrealizedHoldings.reduce((acc, h) => acc + h.cost, 0);
    const totalMarketValue = unrealizedHoldings.reduce((acc, h) => acc + h.marketValue, 0);
    const totalUnrealizedPnl = unrealizedHoldings.reduce((acc, h) => acc + h.pnl, 0);
    const totalUnrealizedRoi = totalUnrealizedCost > 0 ? (totalUnrealizedPnl / totalUnrealizedCost) * 100 : 0;

    const totalRealizedCost = realizedTrades.reduce((acc, r) => acc + r.cost, 0);
    const totalRealizedRevenue = realizedTrades.reduce((acc, r) => acc + r.revenue, 0);
    const totalRealizedPnl = realizedTrades.reduce((acc, r) => acc + r.pnl, 0);
    const totalRealizedRoi = totalRealizedCost > 0 ? (totalRealizedPnl / totalRealizedCost) * 100 : 0;
    const winTrades = realizedTrades.filter((r) => r.pnl > 0).length;
    const winRate = realizedTrades.length > 0 ? (winTrades / realizedTrades.length) * 100 : 0;

    const grandTotalPnl = totalUnrealizedPnl + totalRealizedPnl;
    const totalCombinedCost = totalUnrealizedCost + totalRealizedCost;
    const grandTotalRoi = totalCombinedCost > 0 ? (grandTotalPnl / totalCombinedCost) * 100 : 0;

    return {
      unrealizedHoldings,
      realizedTrades: realizedTrades.reverse(), // 最新賣出放前面
      totals: {
        totalUnrealizedCost,
        totalMarketValue,
        totalUnrealizedPnl,
        totalUnrealizedRoi,
        totalRealizedCost,
        totalRealizedRevenue,
        totalRealizedPnl,
        totalRealizedRoi,
        winRate,
        grandTotalPnl,
        grandTotalRoi,
      },
    };
  }, [currentTrades, prices, deductFees, feeDiscount, stockDb]);

  // 浮動候選選單輸入與選擇
  const onModalStockInput = (val: string) => {
    if (!val.trim()) {
      setModalAutocomplete([]);
      if (tradeModal) {
        setTradeModal({
          ...tradeModal,
          record: { ...tradeModal.record, symbol: val, name: "" },
        });
      }
      return;
    }
    const q = val.trim().toUpperCase();
    const matched = stockDb
      .filter((s) => s.symbol.toUpperCase().startsWith(q) || s.symbol.split(".")[0].startsWith(q) || s.name.includes(q))
      .slice(0, 10);
    setModalAutocomplete(matched);

    const exact = stockDb.find((s) => s.symbol.split(".")[0] === q || s.name === val.trim());
    if (tradeModal) {
      setTradeModal({
        ...tradeModal,
        record: {
          ...tradeModal.record,
          symbol: val,
          name: exact ? exact.name : tradeModal.record.name,
          price: exact && prices[exact.symbol] ? prices[exact.symbol] : tradeModal.record.price,
        },
      });
    }
  };

  const selectModalStock = async (stock: StockEntry) => {
    setModalAutocomplete([]);
    let curP = prices[stock.symbol] || 0;
    if (!curP) {
      try {
        const data: any = await invoke("fetch_stock_data", { symbol: stock.symbol, range: "1mo" });
        if (data?.info?.current_price) {
          curP = Number(data.info.current_price);
          setPrices((prev) => ({ ...prev, [stock.symbol]: curP }));
        }
      } catch {}
    }
    if (tradeModal) {
      setTradeModal({
        ...tradeModal,
        record: {
          ...tradeModal.record,
          symbol: stock.symbol,
          name: stock.name,
          price: curP || tradeModal.record.price,
        },
      });
    }
  };

  // 開啟新增/編輯交易彈窗
  const openTradeModal = (
    type: "BUY" | "SELL" = "BUY",
    symbol = "",
    defaultPrice?: number,
    defaultShares?: number,
    existingRecord?: TradeRecord
  ) => {
    if (existingRecord) {
      setTradeModal({
        show: true,
        mode: "edit",
        record: { ...existingRecord },
      });
      return;
    }

    const cleanSym = symbol.trim().toUpperCase();
    const curP = prices[cleanSym] || defaultPrice || 0;
    setTradeModal({
      show: true,
      mode: "add",
      record: {
        id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        symbol: cleanSym,
        name: stockDb.find((s) => s.symbol === cleanSym)?.name || "",
        type,
        date: new Date().toISOString().slice(0, 10),
        price: curP,
        shares: defaultShares || 1000,
        note: "",
      },
    });
  };

  // 儲存交易紀錄
  const saveTradeRecord = async (record: TradeRecord) => {
    if (!record.symbol || record.price <= 0 || record.shares <= 0) return;

    let updatedTrades: TradeRecord[];
    if (tradeModal?.mode === "edit") {
      updatedTrades = currentTrades.map((t) => (t.id === record.id ? record : t));
    } else {
      updatedTrades = [...currentTrades, record];
    }

    const updatedLists = { ...lists, [activeList]: updatedTrades };
    setLists(updatedLists);
    setTradeModal(null);
    await saveToCloud(updatedLists);
    fetchQuotes(updatedLists);
  };

  // 刪除單筆交易紀錄
  const deleteTradeRecord = async (tradeId: string) => {
    if (!window.confirm("確定刪除此筆交易紀錄嗎？")) return;
    const updatedTrades = currentTrades.filter((t) => t.id !== tradeId);
    const updatedLists = { ...lists, [activeList]: updatedTrades };
    setLists(updatedLists);
    await saveToCloud(updatedLists);
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
    if (!window.confirm(`確定刪除分類「${name}」及其所有交易紀錄嗎？`)) return;
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
        <div style={{ fontSize: "3.5rem" }}>🔒</div>
        <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#ffffff" }}>請先登入帳號</div>
        <div style={{ fontSize: "0.92rem", color: "#94a3b8" }}>登入後即可享有個人化多筆買賣交易記帳、未實現/已實現損益即時試算與雲端即時同步功能</div>
      </div>
    );
  }

  const { totals, unrealizedHoldings, realizedTrades } = ledger;

  return (
    <div className="watchlist-container" style={{ display: "flex", height: "100%", width: "100%", overflow: "hidden", background: "#0b0e17" }}>
      {/* ─── 左側：分類名單選單 ────────────────────────────────────── */}
      <div className="watchlist-sidebar" style={{
        width: "210px", minWidth: "190px", background: "rgba(15, 20, 32, 0.95)",
        borderRight: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column",
        padding: "14px 10px", gap: "6px"
      }}>
        <div style={{ fontSize: "0.80rem", color: "#94a3b8", marginBottom: "6px", padding: "0 4px", fontWeight: 700 }}>
          📂 投資組合分類清單
        </div>
        {Object.keys(lists).map((name) => (
          <div
            key={name}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              borderRadius: "8px", padding: "8px 10px",
              background: activeList === name ? "rgba(37, 99, 235, 0.25)" : "transparent",
              border: activeList === name ? "1px solid rgba(96, 165, 250, 0.45)" : "1px solid transparent",
              cursor: "pointer", transition: "all 0.15s ease"
            }}
            onClick={() => setActiveList(name)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
              <span>⭐</span>
              <span style={{
                fontSize: "0.90rem", fontWeight: activeList === name ? 700 : 500,
                color: activeList === name ? "#ffffff" : "#cbd5e1",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
              }}>
                {name}
              </span>
            </div>
            {Object.keys(lists).length > 1 && (
              <button
                style={{
                  background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer",
                  fontSize: "0.8rem", padding: "2px 4px", borderRadius: "4px"
                }}
                title="刪除此分類"
                onClick={(e) => { e.stopPropagation(); deleteList(name); }}
              >
                ✕
              </button>
            )}
          </div>
        ))}

        {showNewList ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
            <input
              type="text"
              placeholder="輸入新清單名稱..."
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createList()}
              autoFocus
              style={{
                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px", padding: "6px 8px", color: "#fff", fontSize: "0.82rem", outline: "none"
              }}
            />
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                onClick={createList}
                style={{
                  flex: 1, padding: "4px", background: "var(--accent-blue)", border: "none",
                  borderRadius: "4px", color: "#fff", fontSize: "0.78rem", cursor: "pointer", fontWeight: 700
                }}
              >
                建立
              </button>
              <button
                onClick={() => { setShowNewList(false); setNewListName(""); }}
                style={{
                  flex: 1, padding: "4px", background: "rgba(255,255,255,0.1)", border: "none",
                  borderRadius: "4px", color: "#aaa", fontSize: "0.78rem", cursor: "pointer"
                }}
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowNewList(true)}
            style={{
              marginTop: "8px", padding: "7px 10px", background: "rgba(255,255,255,0.04)",
              border: "1px dashed rgba(255,255,255,0.15)", borderRadius: "6px",
              color: "#93c5fd", fontSize: "0.82rem", cursor: "pointer", display: "flex",
              alignItems: "center", justifyContent: "center", gap: "4px", fontWeight: 600
            }}
          >
            ＋ 新增分類清單
          </button>
        )}

        {/* 券商手續費折讓設定 */}
        <div style={{ marginTop: "auto", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "12px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ fontSize: "0.76rem", color: "#94a3b8", fontWeight: 600 }}>⚙️ 交易費率試算</div>
          <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "0.78rem", color: "#e2e8f0", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={deductFees}
              onChange={(e) => setDeductFees(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            扣除手續費與證交稅
          </label>
          {deductFees && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "0.76rem", color: "#cbd5e1" }}>
              <span>券商折讓:</span>
              <select
                value={feeDiscount}
                onChange={(e) => setFeeDiscount(Number(e.target.value))}
                style={{
                  background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.15)",
                  color: "#ffffff", borderRadius: "4px", padding: "2px 6px", fontSize: "0.76rem", outline: "none"
                }}
              >
                <option value={1}>無折讓 (1.0折)</option>
                <option value={0.6}>常見 6 折 (0.6)</option>
                <option value={0.38}>38 折 (0.38)</option>
                <option value={0.28}>28 折 (0.28)</option>
                <option value={0.2}>2 折 (0.20)</option>
                <option value={0}>免手續費 (0折)</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ─── 右側：主持股與交易明細區 ──────────────────────────────── */}
      <div className="watchlist-main-content" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        
        {/* 頂部總覽看板 */}
        <div className="watchlist-dashboard" style={{
          padding: "14px 20px", background: "linear-gradient(180deg, rgba(20, 26, 42, 0.95), rgba(13, 17, 27, 0.95))",
          borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", flexDirection: "column", gap: "10px", flexShrink: 0
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#ffffff", margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
                ⭐ {activeList}
              </h2>
              {syncMsg && (
                <span style={{ fontSize: "0.78rem", color: syncMsg.type === "success" ? "#4caf50" : "#ff5252", fontWeight: 700 }}>
                  {syncMsg.text}
                </span>
              )}
            </div>

            {/* 操作按鈕群 */}
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <button
                onClick={() => fetchQuotes(lists)}
                disabled={refreshingPrices}
                style={{
                  padding: "6px 12px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: "6px", color: "#ffffff", fontSize: "0.82rem", cursor: "pointer", display: "flex",
                  alignItems: "center", gap: "4px", fontWeight: 600
                }}
              >
                {refreshingPrices ? "🔄 刷新中..." : "🔄 刷新市價"}
              </button>
              <button
                onClick={() => openTradeModal("BUY")}
                style={{
                  padding: "6px 14px", background: "#2563eb", border: "1px solid #60a5fa",
                  borderRadius: "6px", color: "#ffffff", fontSize: "0.85rem", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: "4px", fontWeight: 700,
                  boxShadow: "0 2px 8px rgba(37,99,235,0.4)"
                }}
              >
                ➕ 新增買進/賣出交易
              </button>
            </div>
          </div>

          {/* 四大資產與損益卡片 */}
          <div className="watchlist-cards-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px" }}>
            {/* 1. 現有持股市值 */}
            <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "10px 14px" }}>
              <div style={{ fontSize: "0.76rem", color: "#94a3b8", fontWeight: 600, marginBottom: "2px" }}>💼 目前持股市值</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: "#ffffff" }}>
                NT$ {totals.totalMarketValue.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.72rem", color: "#cbd5e1", marginTop: "2px" }}>
                投入成本: NT$ {totals.totalUnrealizedCost.toLocaleString()}
              </div>
            </div>

            {/* 2. 未實現損益 */}
            <div style={{
              background: totals.totalUnrealizedPnl >= 0 ? "rgba(239, 68, 68, 0.08)" : "rgba(34, 197, 94, 0.08)",
              border: totals.totalUnrealizedPnl >= 0 ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(34, 197, 94, 0.3)",
              borderRadius: "8px", padding: "10px 14px"
            }}>
              <div style={{ fontSize: "0.76rem", color: "#94a3b8", fontWeight: 600, marginBottom: "2px" }}>📦 未實現損益 (現有庫存)</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: totals.totalUnrealizedPnl >= 0 ? "#ff5252" : "#4caf50" }}>
                {totals.totalUnrealizedPnl >= 0 ? "+" : ""}NT$ {totals.totalUnrealizedPnl.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.74rem", fontWeight: 700, color: totals.totalUnrealizedPnl >= 0 ? "#ff5252" : "#4caf50", marginTop: "2px" }}>
                報酬率: {totals.totalUnrealizedPnl >= 0 ? "+" : ""}{totals.totalUnrealizedRoi.toFixed(2)}%
              </div>
            </div>

            {/* 3. 已實現損益 */}
            <div style={{
              background: totals.totalRealizedPnl >= 0 ? "rgba(239, 68, 68, 0.08)" : "rgba(34, 197, 94, 0.08)",
              border: totals.totalRealizedPnl >= 0 ? "1px solid rgba(239, 68, 68, 0.3)" : "1px solid rgba(34, 197, 94, 0.3)",
              borderRadius: "8px", padding: "10px 14px"
            }}>
              <div style={{ fontSize: "0.76rem", color: "#94a3b8", fontWeight: 600, marginBottom: "2px" }}>🎯 已實現損益 (已平倉)</div>
              <div style={{ fontSize: "1.2rem", fontWeight: 800, color: totals.totalRealizedPnl >= 0 ? "#ff5252" : "#4caf50" }}>
                {totals.totalRealizedPnl >= 0 ? "+" : ""}NT$ {totals.totalRealizedPnl.toLocaleString()}
              </div>
              <div style={{ fontSize: "0.74rem", fontWeight: 700, color: totals.totalRealizedPnl >= 0 ? "#ff5252" : "#4caf50", marginTop: "2px" }}>
                已結算報酬率: {totals.totalRealizedPnl >= 0 ? "+" : ""}{totals.totalRealizedRoi.toFixed(2)}% (勝率 {totals.winRate.toFixed(0)}%)
              </div>
            </div>

            {/* 4. 總累積獲利 */}
            <div style={{
              background: totals.grandTotalPnl >= 0 ? "rgba(255, 82, 82, 0.14)" : "rgba(76, 175, 80, 0.14)",
              border: totals.grandTotalPnl >= 0 ? "1px solid rgba(255, 82, 82, 0.5)" : "1px solid rgba(76, 175, 80, 0.5)",
              borderRadius: "8px", padding: "10px 14px"
            }}>
              <div style={{ fontSize: "0.76rem", color: "#ffffff", fontWeight: 700, marginBottom: "2px" }}>
                📈 總累積獲利 (未實現 + 已實現)
              </div>
              <div style={{ fontSize: "1.25rem", fontWeight: 800, color: totals.grandTotalPnl >= 0 ? "#ff5252" : "#4caf50" }}>
                {totals.grandTotalPnl >= 0 ? "+" : ""}NT$ {totals.grandTotalPnl.toLocaleString()}
              </div>
              <div style={{
                fontSize: "0.82rem", fontWeight: 800,
                color: totals.grandTotalPnl >= 0 ? "#ff5252" : "#4caf50",
                marginTop: "3px", display: "flex", alignItems: "center", gap: "6px"
              }}>
                <span>總報酬率:</span>
                <span style={{
                  padding: "1px 6px", borderRadius: "4px",
                  background: totals.grandTotalPnl >= 0 ? "rgba(255,82,82,0.2)" : "rgba(76,175,80,0.2)",
                  border: totals.grandTotalPnl >= 0 ? "1px solid rgba(255,82,82,0.4)" : "1px solid rgba(76,175,80,0.4)"
                }}>
                  {totals.grandTotalPnl >= 0 ? "+" : ""}{totals.grandTotalRoi.toFixed(2)}%
                </span>
              </div>
              <div style={{ fontSize: "0.70rem", color: "#cbd5e1", marginTop: "4px" }}>
                未實現 {totals.totalUnrealizedPnl >= 0 ? "+" : ""}{totals.totalUnrealizedPnl.toLocaleString()} ｜ 已實現 {totals.totalRealizedPnl >= 0 ? "+" : ""}{totals.totalRealizedPnl.toLocaleString()}
              </div>
            </div>
          </div>
        </div>

        {/* ─── 次級分頁切換按鈕 ───────────────────────────────────── */}
        <div className="watchlist-tabs-bar" style={{
          display: "flex", alignItems: "center", gap: "8px", padding: "8px 20px",
          background: "rgba(15, 20, 32, 0.7)", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0,
          overflowX: "auto"
        }}>
          <button
            onClick={() => setViewTab("unrealized")}
            style={{
              padding: "7px 16px", borderRadius: "6px", border: "none", cursor: "pointer",
              fontSize: "0.88rem", fontWeight: 700,
              background: viewTab === "unrealized" ? "#2563eb" : "transparent",
              color: viewTab === "unrealized" ? "#ffffff" : "#94a3b8",
            }}
          >
            📈 未實現損益・持倉中 ({unrealizedHoldings.length})
          </button>
          <button
            onClick={() => setViewTab("realized")}
            style={{
              padding: "7px 16px", borderRadius: "6px", border: "none", cursor: "pointer",
              fontSize: "0.88rem", fontWeight: 700,
              background: viewTab === "realized" ? "#2563eb" : "transparent",
              color: viewTab === "realized" ? "#ffffff" : "#94a3b8",
            }}
          >
            🎯 已實現損益・已結算 ({realizedTrades.length})
          </button>
          <button
            onClick={() => setViewTab("trades")}
            style={{
              padding: "7px 16px", borderRadius: "6px", border: "none", cursor: "pointer",
              fontSize: "0.88rem", fontWeight: 700,
              background: viewTab === "trades" ? "#2563eb" : "transparent",
              color: viewTab === "trades" ? "#ffffff" : "#94a3b8",
            }}
          >
            📜 全部買賣流水帳 ({currentTrades.length})
          </button>
        </div>

        {/* ─── 內容表格區 ────────────────────────────────────────── */}
        <div className="watchlist-table-scroll" style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: "16px 20px" }}>
          
          {/* 1. 未實現損益表格 (現有庫存) */}
          {viewTab === "unrealized" && (
            <div>
              {unrealizedHoldings.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: "10px" }}>📦</div>
                  <div style={{ fontSize: "1.05rem", color: "#ffffff", fontWeight: 700 }}>目前尚無未實現持倉</div>
                  <div style={{ fontSize: "0.85rem", marginTop: "4px" }}>點擊上方「➕ 新增買進/賣出交易」開始記錄您的股票交易</div>
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.90rem" }}>
                  <thead>
                    <tr style={{ background: "rgba(30, 41, 59, 0.8)", borderBottom: "2px solid rgba(255,255,255,0.15)", color: "#ffffff" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>股票代號 / 名稱</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>剩餘持股</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>買進均價</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>即時市價</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>持股市值</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>總成本</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>預估未實現損益</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>報酬率</th>
                      <th style={{ padding: "10px 12px", textAlign: "center" }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unrealizedHoldings.map((h) => {
                      const isExpanded = !!expandedSymbols[h.symbol];
                      return (
                        <React.Fragment key={h.symbol}>
                          <tr style={{
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            background: "rgba(255,255,255,0.01)"
                          }}>
                            {/* 代號與名稱 */}
                            <td style={{ padding: "12px", fontWeight: 700, color: "#ffffff" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                <span style={{ color: "#38bdf8", cursor: "pointer" }} onClick={() => onAnalyze && onAnalyze(h.symbol)}>
                                  {h.name} ({h.symbol})
                                </span>
                                {h.buyLots.length > 1 && (
                                  <button
                                    onClick={() => setExpandedSymbols((p) => ({ ...p, [h.symbol]: !p[h.symbol] }))}
                                    style={{
                                      background: "rgba(56, 189, 248, 0.15)", border: "1px solid rgba(56, 189, 248, 0.4)",
                                      borderRadius: "4px", color: "#38bdf8", fontSize: "0.72rem", padding: "1px 6px",
                                      cursor: "pointer", fontWeight: 700
                                    }}
                                  >
                                    {isExpanded ? "收合" : `${h.buyLots.length}批買進 ▾`}
                                  </button>
                                )}
                              </div>
                            </td>

                            {/* 股數 */}
                            <td style={{ padding: "12px", textAlign: "right", color: "#ffffff", fontWeight: 700 }}>
                              {h.remainingShares.toLocaleString()} 股
                            </td>

                            {/* 均價 */}
                            <td style={{ padding: "12px", textAlign: "right", color: "#cbd5e1", fontWeight: 600 }}>
                              ${h.avgBuyPrice.toFixed(2)}
                            </td>

                            {/* 即時市價 */}
                            <td style={{ padding: "12px", textAlign: "right", color: "#ffffff", fontWeight: 800 }}>
                              ${h.curPrice.toFixed(2)}
                            </td>

                            {/* 市值 */}
                            <td style={{ padding: "12px", textAlign: "right", color: "#ffffff", fontWeight: 700 }}>
                              NT$ {h.marketValue.toLocaleString()}
                            </td>

                            {/* 成本 */}
                            <td style={{ padding: "12px", textAlign: "right", color: "#cbd5e1" }}>
                              NT$ {h.cost.toLocaleString()}
                            </td>

                            {/* 損益 */}
                            <td style={{
                              padding: "12px", textAlign: "right", fontWeight: 800,
                              color: h.pnl >= 0 ? "#ff5252" : "#4caf50"
                            }}>
                              {h.pnl >= 0 ? "+" : ""}NT$ {h.pnl.toLocaleString()}
                            </td>

                            {/* 報酬率 */}
                            <td style={{
                              padding: "12px", textAlign: "right", fontWeight: 800,
                              color: h.pnl >= 0 ? "#ff5252" : "#4caf50"
                            }}>
                              {h.pnl >= 0 ? "+" : ""}{h.roi.toFixed(2)}%
                            </td>

                            {/* 操作按鈕 */}
                            <td style={{ padding: "12px", textAlign: "center" }}>
                              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                                <button
                                  onClick={() => openTradeModal("BUY", h.symbol, h.curPrice)}
                                  title="加碼買進"
                                  style={{
                                    background: "rgba(37,99,235,0.2)", border: "1px solid rgba(96,165,250,0.4)",
                                    borderRadius: "4px", color: "#93c5fd", fontSize: "0.76rem", padding: "3px 8px",
                                    cursor: "pointer", fontWeight: 700
                                  }}
                                >
                                  ＋ 買進
                                </button>
                                <button
                                  onClick={() => openTradeModal("SELL", h.symbol, h.curPrice, h.remainingShares)}
                                  title="賣出平倉"
                                  style={{
                                    background: "rgba(220,38,38,0.2)", border: "1px solid rgba(248,113,113,0.4)",
                                    borderRadius: "4px", color: "#fca5a5", fontSize: "0.76rem", padding: "3px 8px",
                                    cursor: "pointer", fontWeight: 700
                                  }}
                                >
                                  💰 賣出
                                </button>
                                {onAnalyze && (
                                  <button
                                    onClick={() => onAnalyze(h.symbol)}
                                    title="前往個股分析"
                                    style={{
                                      background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                                      borderRadius: "4px", color: "#ffffff", fontSize: "0.76rem", padding: "3px 6px",
                                      cursor: "pointer"
                                    }}
                                  >
                                    🔍
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>

                          {/* 展開的多批次買進明細 */}
                          {isExpanded && (
                            <tr style={{ background: "rgba(15, 23, 42, 0.6)" }}>
                              <td colSpan={9} style={{ padding: "8px 24px" }}>
                                <div style={{ fontSize: "0.78rem", color: "#94a3b8", marginBottom: "4px", fontWeight: 700 }}>
                                  📦 買進明細批次 (FIFO 先進先出):
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                                  {h.buyLots.map((lot, lIdx) => (
                                    <div key={lot.id} style={{ display: "flex", gap: "16px", fontSize: "0.78rem", color: "#cbd5e1" }}>
                                      <span>第 {lIdx + 1} 批: <b>{lot.date}</b></span>
                                      <span>買價: <b style={{ color: "#ffffff" }}>${lot.price}</b></span>
                                      <span>庫存剩餘: <b style={{ color: "#38bdf8" }}>{lot.shares.toLocaleString()} 股</b></span>
                                      <span>手續費: ${lot.buyFee}</span>
                                      {lot.note && <span style={{ color: "#94a3b8" }}>({lot.note})</span>}
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* 2. 已實現損益表格 (已賣出結算) */}
          {viewTab === "realized" && (
            <div>
              {realizedTrades.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: "10px" }}>🎯</div>
                  <div style={{ fontSize: "1.05rem", color: "#ffffff", fontWeight: 700 }}>尚無已實現賣出平倉紀錄</div>
                  <div style={{ fontSize: "0.85rem", marginTop: "4px" }}>當您賣出股票時，系統會自動根據 FIFO 計算已實現獲利與投資報酬率</div>
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.90rem" }}>
                  <thead>
                    <tr style={{ background: "rgba(30, 41, 59, 0.8)", borderBottom: "2px solid rgba(255,255,255,0.15)", color: "#ffffff" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>賣出日期</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>股票代號 / 名稱</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>賣出股數</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>買進價格</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>賣出價格</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>淨賣出金額</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>手續費＋證交稅</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>已實現損益</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>報酬率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {realizedTrades.map((r) => (
                      <tr key={r.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <td style={{ padding: "12px", color: "#cbd5e1", fontWeight: 600 }}>{r.sellDate}</td>
                        <td style={{ padding: "12px", fontWeight: 700, color: "#ffffff" }}>
                          <span style={{ color: "#38bdf8", cursor: "pointer" }} onClick={() => onAnalyze && onAnalyze(r.symbol)}>
                            {r.name} ({r.symbol})
                          </span>
                        </td>
                        <td style={{ padding: "12px", textAlign: "right", color: "#ffffff", fontWeight: 700 }}>
                          {r.shares.toLocaleString()} 股
                        </td>
                        <td style={{ padding: "12px", textAlign: "right", color: "#cbd5e1" }}>
                          ${r.buyPrice.toFixed(2)}
                          <div style={{ fontSize: "0.72rem", color: "#94a3b8" }}>({r.buyDate})</div>
                        </td>
                        <td style={{ padding: "12px", textAlign: "right", color: "#ffffff", fontWeight: 800 }}>
                          ${r.sellPrice.toFixed(2)}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right", color: "#ffffff" }}>
                          NT$ {r.revenue.toLocaleString()}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right", color: "#94a3b8", fontSize: "0.82rem" }}>
                          ${r.fee + r.tax} (稅:${r.tax})
                        </td>
                        <td style={{
                          padding: "12px", textAlign: "right", fontWeight: 800,
                          color: r.pnl >= 0 ? "#ff5252" : "#4caf50"
                        }}>
                          {r.pnl >= 0 ? "+" : ""}NT$ {r.pnl.toLocaleString()}
                        </td>
                        <td style={{
                          padding: "12px", textAlign: "right", fontWeight: 800,
                          color: r.pnl >= 0 ? "#ff5252" : "#4caf50"
                        }}>
                          {r.pnl >= 0 ? "+" : ""}{r.roi.toFixed(2)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* 3. 全部交易明細清單 (流水帳) */}
          {viewTab === "trades" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <div style={{ fontSize: "0.88rem", color: "#94a3b8", fontWeight: 600 }}>
                  📝 共 {currentTrades.length} 筆原始買賣紀錄
                </div>
                <button
                  onClick={() => openTradeModal("BUY")}
                  style={{
                    padding: "5px 12px", background: "#2563eb", border: "none",
                    borderRadius: "6px", color: "#ffffff", fontSize: "0.80rem", cursor: "pointer", fontWeight: 700
                  }}
                >
                  ➕ 新增紀錄
                </button>
              </div>

              {currentTrades.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
                  尚無交易紀錄
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.90rem" }}>
                  <thead>
                    <tr style={{ background: "rgba(30, 41, 59, 0.8)", borderBottom: "2px solid rgba(255,255,255,0.15)", color: "#ffffff" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>交易日期</th>
                      <th style={{ padding: "10px 12px", textAlign: "center" }}>類型</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>股票代號 / 名稱</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>成交單價</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>股數</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>交易總額</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>備註</th>
                      <th style={{ padding: "10px 12px", textAlign: "center" }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentTrades.map((t) => (
                      <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                        <td style={{ padding: "10px 12px", color: "#cbd5e1" }}>{t.date}</td>
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          <span style={{
                            padding: "3px 8px", borderRadius: "4px", fontSize: "0.76rem", fontWeight: 700,
                            background: t.type === "BUY" ? "rgba(37,99,235,0.2)" : "rgba(220,38,38,0.2)",
                            color: t.type === "BUY" ? "#60a5fa" : "#f87171",
                            border: t.type === "BUY" ? "1px solid rgba(96,165,250,0.4)" : "1px solid rgba(248,113,113,0.4)"
                          }}>
                            {t.type === "BUY" ? "買進" : "賣出"}
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", fontWeight: 700, color: "#ffffff" }}>
                          {t.name || t.symbol} ({t.symbol})
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: "#ffffff", fontWeight: 700 }}>
                          ${t.price.toFixed(2)}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: "#ffffff", fontWeight: 700 }}>
                          {t.shares.toLocaleString()} 股
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: "#ffffff", fontWeight: 800 }}>
                          NT$ {(t.price * t.shares).toLocaleString()}
                        </td>
                        <td style={{ padding: "10px 12px", color: "#94a3b8", fontSize: "0.82rem" }}>
                          {t.note || "-"}
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "center" }}>
                          <div style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
                            <button
                              onClick={() => openTradeModal(t.type, t.symbol, t.price, t.shares, t)}
                              style={{
                                background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                                borderRadius: "4px", color: "#ffffff", fontSize: "0.74rem", padding: "2px 6px", cursor: "pointer"
                              }}
                            >
                              編輯
                            </button>
                            <button
                              onClick={() => deleteTradeRecord(t.id)}
                              style={{
                                background: "rgba(220,38,38,0.15)", border: "1px solid rgba(248,113,113,0.3)",
                                borderRadius: "4px", color: "#f87171", fontSize: "0.74rem", padding: "2px 6px", cursor: "pointer"
                              }}
                            >
                              刪除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

        </div>
      </div>

      {/* ─── 買進 / 賣出 交易彈窗 (Trade Modal) ────────────────────── */}
      {tradeModal && tradeModal.show && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, backdropFilter: "blur(6px)"
        }}>
          <div style={{
            background: "#161c2d", border: "1px solid rgba(96, 165, 250, 0.4)",
            borderRadius: "12px", padding: "24px", width: "420px", maxWidth: "90%",
            boxShadow: "0 10px 30px rgba(0,0,0,0.8)", display: "flex", flexDirection: "column", gap: "16px"
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "10px" }}>
              <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#ffffff" }}>
                {tradeModal.mode === "edit" ? "✏️ 編輯交易紀錄" : tradeModal.record.type === "BUY" ? "➕ 記錄買進股票" : "💰 記錄賣出股票"}
              </h3>
              <button
                onClick={() => setTradeModal(null)}
                style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: "1.2rem", cursor: "pointer" }}
              >
                ✕
              </button>
            </div>

            {/* 買進 / 賣出 類型切換 */}
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                onClick={() => setTradeModal({ ...tradeModal, record: { ...tradeModal.record, type: "BUY" } })}
                style={{
                  flex: 1, padding: "8px", borderRadius: "6px", border: "none", cursor: "pointer",
                  fontWeight: 700, fontSize: "0.90rem",
                  background: tradeModal.record.type === "BUY" ? "#2563eb" : "rgba(255,255,255,0.06)",
                  color: tradeModal.record.type === "BUY" ? "#ffffff" : "#94a3b8",
                }}
              >
                🟢 買進 (Buy)
              </button>
              <button
                type="button"
                onClick={() => setTradeModal({ ...tradeModal, record: { ...tradeModal.record, type: "SELL" } })}
                style={{
                  flex: 1, padding: "8px", borderRadius: "6px", border: "none", cursor: "pointer",
                  fontWeight: 700, fontSize: "0.90rem",
                  background: tradeModal.record.type === "SELL" ? "#dc2626" : "rgba(255,255,255,0.06)",
                  color: tradeModal.record.type === "SELL" ? "#ffffff" : "#94a3b8",
                }}
              >
                🔴 賣出 (Sell)
              </button>
            </div>

            {/* 股票代號與候選浮動視窗 */}
            <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "0.80rem", color: "#ffffff", fontWeight: 700 }}>
                股票代號或名稱 {tradeModal.record.name ? <span style={{ color: "#38bdf8", marginLeft: "4px" }}>({tradeModal.record.name})</span> : ""}
              </label>
              <input
                type="text"
                placeholder="例如 2330 或 台積電..."
                value={tradeModal.record.symbol}
                onChange={(e) => onModalStockInput(e.target.value)}
                autoComplete="off"
                style={{
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(96, 165, 250, 0.4)",
                  borderRadius: "6px", padding: "8px 12px", color: "#ffffff", fontSize: "0.95rem", outline: "none", fontWeight: 800
                }}
              />
              {/* 候選股票浮動選單 (Floating Autocomplete Dropdown) */}
              {modalAutocomplete.length > 0 && (
                <div
                  style={{
                    position: "absolute", top: "100%", left: 0, right: 0, zIndex: 2000,
                    marginTop: "4px", background: "#1e293b", border: "1px solid rgba(96, 165, 250, 0.5)",
                    borderRadius: "8px", maxHeight: "220px", overflowY: "auto",
                    boxShadow: "0 10px 25px rgba(0,0,0,0.85)"
                  }}
                >
                  {modalAutocomplete.map((s) => {
                    const curP = prices[s.symbol];
                    return (
                      <div
                        key={s.symbol}
                        onClick={() => selectModalStock(s)}
                        style={{
                          padding: "9px 12px", cursor: "pointer", fontSize: "0.88rem",
                          display: "flex", justifyContent: "space-between", alignItems: "center",
                          borderBottom: "1px solid rgba(255,255,255,0.06)", transition: "background 0.15s ease"
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(37,99,235,0.35)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <b style={{ color: "#38bdf8", fontSize: "0.92rem" }}>{s.symbol.split(".")[0]}</b>
                          <span style={{ color: "#ffffff", fontWeight: 600 }}>{s.name}</span>
                        </div>
                        {curP != null && curP > 0 && (
                          <span style={{ color: "#facc15", fontWeight: 700, fontSize: "0.85rem" }}>
                            ${curP.toFixed(2)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 交易日期 */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "0.80rem", color: "#ffffff", fontWeight: 700 }}>交易日期</label>
              <input
                type="date"
                value={tradeModal.record.date}
                onChange={(e) => setTradeModal({ ...tradeModal, record: { ...tradeModal.record, date: e.target.value } })}
                style={{
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                  borderRadius: "6px", padding: "8px 12px", color: "#ffffff", fontSize: "0.92rem", outline: "none", fontWeight: 700
                }}
              />
            </div>

            {/* 成交單價與股數 */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "0.80rem", color: "#ffffff", fontWeight: 700 }}>成交單價 (NT$)</label>
                <input
                  type="number"
                  step="any"
                  value={tradeModal.record.price || ""}
                  onChange={(e) => setTradeModal({ ...tradeModal, record: { ...tradeModal.record, price: parseFloat(e.target.value) || 0 } })}
                  style={{
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: "6px", padding: "8px 12px", color: "#ffffff", fontSize: "0.92rem", outline: "none", fontWeight: 800
                  }}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label style={{ fontSize: "0.80rem", color: "#ffffff", fontWeight: 700 }}>交易股數</label>
                <input
                  type="number"
                  step="1"
                  value={tradeModal.record.shares || ""}
                  onChange={(e) => setTradeModal({ ...tradeModal, record: { ...tradeModal.record, shares: parseInt(e.target.value, 10) || 0 } })}
                  style={{
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)",
                    borderRadius: "6px", padding: "8px 12px", color: "#ffffff", fontSize: "0.92rem", outline: "none", fontWeight: 800
                  }}
                />
              </div>
            </div>

            {/* 交易總額與手續費即時試算 */}
            <div style={{
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "6px", padding: "8px 12px", fontSize: "0.80rem", color: "#cbd5e1",
              display: "flex", justifyContent: "space-between"
            }}>
              <span>預估總金額:</span>
              <b style={{ color: "#ffffff", fontSize: "0.92rem" }}>
                NT$ {Math.round(tradeModal.record.price * tradeModal.record.shares).toLocaleString()}
              </b>
            </div>

            {/* 備註 (選填) */}
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label style={{ fontSize: "0.78rem", color: "#94a3b8" }}>備註 (選填)</label>
              <input
                type="text"
                placeholder="例如：第一批分批建倉、停損、波段操作..."
                value={tradeModal.record.note || ""}
                onChange={(e) => setTradeModal({ ...tradeModal, record: { ...tradeModal.record, note: e.target.value } })}
                style={{
                  background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "6px", padding: "6px 10px", color: "#cbd5e1", fontSize: "0.84rem", outline: "none"
                }}
              />
            </div>

            {/* 提交按鈕 */}
            <div style={{ display: "flex", gap: "10px", marginTop: "6px" }}>
              <button
                type="button"
                onClick={() => setTradeModal(null)}
                style={{
                  flex: 1, padding: "10px", background: "rgba(255,255,255,0.08)", border: "none",
                  borderRadius: "6px", color: "#cbd5e1", fontSize: "0.88rem", cursor: "pointer", fontWeight: 600
                }}
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  let sym = tradeModal.record.symbol.trim().toUpperCase();
                  const match = stockDb.find((s) => s.symbol.split(".")[0] === sym || s.name === sym || s.symbol === sym);
                  const finalSym = match ? match.symbol : sym.includes(".") ? sym : `${sym}.TW`;
                  saveTradeRecord({ ...tradeModal.record, symbol: finalSym });
                }}
                disabled={!tradeModal.record.symbol || tradeModal.record.price <= 0 || tradeModal.record.shares <= 0}
                style={{
                  flex: 1, padding: "10px",
                  background: tradeModal.record.type === "BUY" ? "#2563eb" : "#dc2626",
                  border: "none", borderRadius: "6px", color: "#ffffff", fontSize: "0.88rem",
                  cursor: "pointer", fontWeight: 800, boxShadow: "0 4px 12px rgba(0,0,0,0.4)"
                }}
              >
                確認儲存交易
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
