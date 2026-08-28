import React, { useState, useEffect, useCallback, useMemo } from "react";
import { User } from "firebase/auth";
import { subscribeWatchlist, saveWatchlistToCloud, loadWatchlistFromCloud } from "../utils/firebase";
import { getCachedStocks, subscribeStocks, StockEntry } from "../utils/stocks";
import { stockService } from "../services";
import twseFundamentals from "../utils/twse_mops_fundamentals.json";
import { evaluateAIAlpha, fmtFixed } from "../utils/aiAlphaModel";
import { mkMops, mkYahoo } from "../utils/platform";

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
  cashDividend: number;
  stockDividend: number;
  estGrossDividend: number;
  nhiPremium: number;
  bankFee: number;
  taxCredit85: number;
  estNetDividend: number;
  exType: string;
  buyLots: {
    id: string;
    date: string;
    price: number;
    shares: number;
    buyFee: number;
    isQualified: boolean;
    lotGrossDividend: number;
    note?: string;
  }[];
  exDate?: string;
  qualifiedShares: number;
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
  exDate?: string;
  realizedDividend?: number;
  isExQualified?: boolean;
  note?: string;
}

/** 自選觀察股 */
export interface ObservingStock {
  symbol: string;
  name: string;
  curPrice: number;
  remainingShares: number;
  cashDividend: number;
  stockDividend: number;
  exType: string;
  exDate?: string;
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
  const [viewTab, setViewTab] = useState<"unrealized" | "observing" | "realized" | "trades">("unrealized");

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

  // 初始即時價格預載入（從官方資料庫極速載入真實收盤價，避免等待或假數據）
  useEffect(() => {
    const initialPrices: Record<string, number> = {};
    for (const [code, fund] of Object.entries(twseFundamentals as Record<string, any>)) {
      if (fund?.close_price && Number(fund.close_price) > 0) {
        initialPrices[`${code}.TW`] = Number(fund.close_price);
        initialPrices[`${code}.TWO`] = Number(fund.close_price);
        initialPrices[code] = Number(fund.close_price);
      }
    }
    setPrices((prev) => ({ ...initialPrices, ...prev }));
  }, []);

  // 標準化資料結構 (支援舊版 PortfolioEntry 相容轉換與代號標準化)
  const normalizeLists = useCallback((rawLists: Record<string, any[]>): Record<string, TradeRecord[]> => {
    const normalized: Record<string, TradeRecord[]> = {};
    for (const [k, arr] of Object.entries(rawLists)) {
      normalized[k] = (arr || []).map((item, idx) => {
        const rawSym = (typeof item === "string" ? item : item.symbol || "").trim().toUpperCase();
        const matched = stockDb.find((s) => s.symbol === rawSym || s.symbol.split(".")[0] === rawSym.split(".")[0]);
        const cleanSym = matched ? matched.symbol : (rawSym.includes(".") ? rawSym : `${rawSym}.TW`);
        const stockName = matched?.name || (typeof item === "object" ? item.name : "") || cleanSym;

        if (typeof item === "string") {
          return {
            id: `legacy-${idx}-${Date.now()}`,
            symbol: cleanSym,
            name: stockName,
            type: "BUY",
            date: new Date().toISOString().slice(0, 10),
            price: 0,
            shares: 0,
          };
        }
        return {
          id: item.id || `trade-${idx}-${item.date || Date.now()}`,
          symbol: cleanSym,
          name: stockName,
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

  // 刷新即時行情報價（真實連線查詢每檔自選股最新市價）
  const fetchQuotes = useCallback(async (currentLists: Record<string, TradeRecord[]>) => {
    const allSymbols = Array.from(
      new Set(Object.values(currentLists).flatMap((items) => items.map((it) => it.symbol)).filter(Boolean))
    );
    if (allSymbols.length === 0) return;

    setRefreshingPrices(true);
    try {
      const promises = allSymbols.map(async (sym) => {
        try {
          const d = await stockService.getStockData(sym, "1mo");
          if (d?.info?.symbol && d?.info?.current_price) {
            return { symbol: d.info.symbol, rawSym: sym, price: Number(d.info.current_price?.value) };
          }
        } catch {}
        return null;
      });

      const settled = await Promise.allSettled(promises);
      const newPrices: Record<string, number> = {};
      for (const res of settled) {
        if (res.status === "fulfilled" && res.value) {
          newPrices[res.value.symbol] = res.value.price;
          newPrices[res.value.rawSym] = res.value.price;
          const code = res.value.symbol.split(".")[0];
          newPrices[code] = res.value.price;
          newPrices[`${code}.TW`] = res.value.price;
          newPrices[`${code}.TWO`] = res.value.price;
        }
      }
      if (Object.keys(newPrices).length > 0) {
        setPrices((prev) => ({ ...prev, ...newPrices }));
      }
    } catch (e) {
      console.warn("Fetch quotes error:", e);
    } finally {
      setRefreshingPrices(false);
    }
  }, []);

  // 雲端與本機資料同步與監聽
  useEffect(() => {
    const reloadData = () => {
      if (user) {
        setLoading(true);
        loadWatchlistFromCloud(user.uid)
          .then(async ({ lists: cloudLists }) => {
            let merged: Record<string, any[]> = cloudLists && Object.keys(cloudLists).length > 0 ? { ...cloudLists } : { "我的自選股": [] };
            // 合併訪客暫存清單
            try {
              const guestRaw = localStorage.getItem("stockt_guest_watchlist");
              if (guestRaw) {
                const guestLists = JSON.parse(guestRaw);
                for (const [k, arr] of Object.entries(guestLists)) {
                  if (!merged[k]) merged[k] = [];
                  for (const item of (arr as any[])) {
                    const sym = typeof item === "string" ? item : item?.symbol;
                    if (sym && !merged[k].some((it: any) => (typeof it === "string" ? it === sym : it?.symbol === sym))) {
                      merged[k].push(item);
                    }
                  }
                }
                localStorage.removeItem("stockt_guest_watchlist");
                await saveWatchlistToCloud(user.uid, username, merged);
              }
            } catch (e) {
              console.warn("Merge guest watchlist error:", e);
            }

            const norm = normalizeLists(merged);
            setLists(norm);
            setActiveList((prev) => (norm[prev] ? prev : Object.keys(norm)[0]));
            fetchQuotes(norm);
          })
          .catch(console.error)
          .finally(() => setLoading(false));
      } else {
        // 未登入時讀取本機暫存
        try {
          const guestRaw = localStorage.getItem("stockt_guest_watchlist");
          if (guestRaw) {
            const guestLists = JSON.parse(guestRaw);
            const norm = normalizeLists(guestLists);
            setLists(norm);
            setActiveList((prev) => (norm[prev] ? prev : Object.keys(norm)[0]));
            fetchQuotes(norm);
          }
        } catch (e) {
          console.warn("Load guest watchlist error:", e);
        }
      }
    };

    if (isActive !== false) {
      reloadData();
    }

    let unsub = () => {};
    if (user) {
      unsub = subscribeWatchlist(user.uid, ({ lists: cloudLists }) => {
        if (cloudLists && Object.keys(cloudLists).length > 0) {
          const norm = normalizeLists(cloudLists);
          setLists(norm);
          setActiveList((prev) => (norm[prev] ? prev : Object.keys(norm)[0]));
          fetchQuotes(norm);
        }
      });
    }

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
  }, [user, username, isActive, fetchQuotes, normalizeLists]);

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

            const coCode = symbol.split(".")[0];
            const fund = (twseFundamentals as Record<string, any>)[coCode];
            const exDate = fund?.ex_dividend_date || null;
            const cashDiv = fund?.cash_dividend != null ? Number(fund.cash_dividend) : 0;
            // 持有期間涵蓋除息日判斷：買進日 < 除息日 且 賣出日 >= 除息日
            const isExQualified = !!(exDate && cashDiv > 0 && lot.date < exDate && trade.date >= exDate);
            const realizedDividend = isExQualified ? Math.round(cashDiv * matchShares) : 0;

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
              exDate: exDate || undefined,
              realizedDividend,
              isExQualified,
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

      // 剩餘庫存 = 未實現持股 (僅包含實際持倉 > 0 股的股票)
      if (buyLots.length > 0) {
        const remainingShares = buyLots.reduce((acc, l) => acc + l.shares, 0);
        const totalCost = buyLots.reduce((acc, l) => acc + (l.price * l.shares + l.buyFee), 0);
        const avgBuyPrice = remainingShares > 0 ? buyLots.reduce((acc, l) => acc + l.price * l.shares, 0) / remainingShares : 0;

        const curPrice = prices[symbol] || avgBuyPrice || 0;
        const rawMarketValue = curPrice * remainingShares;
        const estSellFee = deductFees && remainingShares > 0 ? Math.max(Math.floor(rawMarketValue * feeRate), 1) : 0;
        const estTax = deductFees && remainingShares > 0 ? Math.floor(rawMarketValue * (isEtf ? 0.001 : 0.003)) : 0;
        const netMarketValue = rawMarketValue - estSellFee - estTax;
        const pnl = remainingShares > 0 ? netMarketValue - totalCost : 0;
        const roi = totalCost > 0 ? (pnl / totalCost) * 100 : 0;

        const coCode = symbol.split(".")[0];
        const fund = (twseFundamentals as Record<string, any>)[coCode];
        const cashDiv = fund?.cash_dividend != null ? Number(fund.cash_dividend) : 0;
        const stockDiv = fund?.stock_dividend != null ? Number(fund.stock_dividend) : 0;
        const exDate = fund?.ex_dividend_date || null;
        const exType = stockDiv > 0 && cashDiv > 0 ? "除權息" : stockDiv > 0 ? "除權" : cashDiv > 0 ? "除息" : "無配息";

        // 依據各批次買進日期，驗證持有時間是否涵蓋除息日 (買進日 < 除息日)
        const enrichedLots = buyLots.map((lot) => {
          const isQualified = !!(exDate && cashDiv > 0 && lot.date < exDate);
          const lotGrossDividend = isQualified ? Math.round(cashDiv * lot.shares) : 0;
          return {
            ...lot,
            isQualified,
            lotGrossDividend,
          };
        });

        const qualifiedShares = enrichedLots.filter((l) => l.isQualified).reduce((acc, l) => acc + l.shares, 0);
        const estGrossDividend = enrichedLots.reduce((acc, l) => acc + l.lotGrossDividend, 0);
        
        // 單筆股利達 20,000 元扣 2.11% 二代健保補充保費
        const nhiPremium = estGrossDividend >= 20000 ? Math.floor(estGrossDividend * 0.0211) : 0;
        const bankFee = estGrossDividend > 0 ? 10 : 0;
        const taxCredit85 = Math.min(Math.floor(estGrossDividend * 0.085), 80000);
        const estNetDividend = Math.max(estGrossDividend - nhiPremium - bankFee, 0);

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
          cashDividend: cashDiv,
          stockDividend: stockDiv,
          estGrossDividend,
          nhiPremium,
          bankFee,
          taxCredit85,
          estNetDividend,
          exType,
          exDate: exDate || undefined,
          qualifiedShares,
          buyLots: enrichedLots,
        });
      }
    }

    // 自選觀察股名單（當前清單中的所有自選追蹤與收藏股票）
    const observingStocks: ObservingStock[] = [];
    const seenObserving = new Set<string>();

    for (const [symbol, symTrades] of Object.entries(bySymbol)) {
      if (!symbol || seenObserving.has(symbol)) continue;
      seenObserving.add(symbol);

      const stockName = stockDb.find((s) => s.symbol === symbol || s.symbol.split(".")[0] === symbol.split(".")[0])?.name || symTrades[0]?.name || symbol;
      const coCode = symbol.split(".")[0];
      const fund = (twseFundamentals as Record<string, any>)[coCode];
      const cashDiv = fund?.cash_dividend != null ? Number(fund.cash_dividend) : 0;
      const stockDiv = fund?.stock_dividend != null ? Number(fund.stock_dividend) : 0;
      const exDate = fund?.ex_dividend_date || null;
      const exType = stockDiv > 0 && cashDiv > 0 ? "除權息" : stockDiv > 0 ? "除權" : cashDiv > 0 ? "除息" : "無配息";
      const note = symTrades.find((t) => t.note)?.note || "";
      const holding = unrealizedHoldings.find((h) => h.symbol === symbol);
      const remainingShares = holding ? holding.remainingShares : 0;

      observingStocks.push({
        symbol,
        name: stockName,
        curPrice: prices[symbol] || 0,
        remainingShares,
        cashDividend: cashDiv,
        stockDividend: stockDiv,
        exType,
        exDate: exDate || undefined,
        note,
      });
    }

    // 排序
    unrealizedHoldings.sort((a, b) => a.symbol.localeCompare(b.symbol));
    observingStocks.sort((a, b) => {
      // 0股觀察中與有持倉均按代號排序
      return a.symbol.localeCompare(b.symbol);
    });

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

    const totalGrossDividends = unrealizedHoldings.reduce((acc, h) => acc + h.estGrossDividend, 0);
    const totalNhiPremium = unrealizedHoldings.reduce((acc, h) => acc + h.nhiPremium, 0);
    const totalTaxCredit85 = Math.min(unrealizedHoldings.reduce((acc, h) => acc + h.taxCredit85, 0), 80000);
    const totalNetDividends = unrealizedHoldings.reduce((acc, h) => acc + h.estNetDividend, 0);
    const grandTotalPnl = totalUnrealizedPnl + totalRealizedPnl + totalNetDividends;
    const totalCombinedCost = totalUnrealizedCost + totalRealizedCost;
    const grandTotalRoi = totalCombinedCost > 0 ? (grandTotalPnl / totalCombinedCost) * 100 : 0;

    return {
      unrealizedHoldings,
      observingStocks,
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
        totalGrossDividends,
        totalNhiPremium,
        totalTaxCredit85,
        totalNetDividends,
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
        const data = await stockService.getStockData(stock.symbol, "1mo");
        if (data?.info?.current_price) {
          curP = Number(data.info.current_price?.value);
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

  // 移除該股的所有交易紀錄（適用於取消收藏或清除已平倉觀察股）
  const removeSymbolFromWatchlist = async (symbol: string) => {
    const stockName = stockDb.find((s) => s.symbol === symbol)?.name || symbol;
    if (!window.confirm(`確定要從自選清單中移除【${stockName} (${symbol})】嗎？`)) return;
    const updatedTrades = currentTrades.filter((t) => t.symbol !== symbol);
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

  const hasAnyRecords = Object.values(lists).some((arr) => arr.length > 0);

  if (!user && !hasAnyRecords) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "16px", color: "var(--text-muted)" }}>
        <div style={{ fontSize: "3.5rem" }}>🔒</div>
        <div style={{ fontSize: "1.2rem", fontWeight: 700, color: "#ffffff" }}>請先登入帳號</div>
        <div style={{ fontSize: "0.92rem", color: "#94a3b8" }}>登入後即可享有個人化自選股收藏、多筆買賣交易記帳與跨裝置即時同步功能</div>
      </div>
    );
  }

  const { totals, unrealizedHoldings, observingStocks, realizedTrades } = ledger;

  const exportObservingPdf = () => {
    if (observingStocks.length === 0) return;

    const reportDate = new Date().toLocaleString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });

    const rows = observingStocks.map((s, idx) => {
      const coId = s.symbol.split(".")[0];
      const fund = (twseFundamentals as Record<string, any>)[coId] || {};
      
      const pe = fund.pe != null ? fmtFixed(fund.pe, 1) : "-";
      const pb = fund.pb != null ? fmtFixed(fund.pb, 1) : "-";
      const roe = fund.roe != null ? `${fmtFixed(Number(fund.roe) * 100, 1)}%` : "-";
      const roeNum = fund.roe != null ? Number(fund.roe) : null;
      const roeColor = roeNum != null && roeNum < 0 ? "#dc2626" : roeNum != null && roeNum >= 0.15 ? "#16a34a" : "#1e293b";
      
      const revGrowth = fund.revenue_growth != null ? `${fmtFixed(Number(fund.revenue_growth) * 100, 1)}%` : "-";
      const revNum = fund.revenue_growth != null ? Number(fund.revenue_growth) : null;
      const revColor = revNum != null && revNum < 0 ? "#dc2626" : revNum != null && revNum >= 0.15 ? "#16a34a" : "#1e293b";

      const curPrice = s.curPrice > 0 ? `$${s.curPrice.toFixed(2)}` : "-";
      const cashDiv = s.cashDividend > 0 ? `${s.cashDividend.toFixed(2)} 元` : (fund.cash_dividend ? `${Number(fund.cash_dividend).toFixed(2)} 元` : "無配息");
      const exDate = s.exDate || fund.ex_dividend_date || "尚待公告";
      const yieldPct = fund.yield_pct != null ? `${fmtFixed(fund.yield_pct, 2)}%` : (s.curPrice > 0 && s.cashDividend > 0 ? `${((s.cashDividend / s.curPrice) * 100).toFixed(2)}%` : "-");

      const _wm = (v: number | null | undefined) => v != null ? mkMops(v) : null;
      const stockInfoFull = {
        symbol: s.symbol,
        name: s.name,
        current_price: s.curPrice ? mkYahoo(s.curPrice) : null,
        previous_close: s.curPrice ? mkYahoo(s.curPrice) : null,
        pe: _wm(fund.pe),
        pb: _wm(fund.pb),
        dividend_yield: _wm(fund.yield_pct),
        eps: _wm(fund.eps),
        roe: _wm(fund.roe),
        revenue_growth: _wm(fund.revenue_growth),
        earnings_growth: _wm(fund.earnings_growth),
        operating_margins: _wm(fund.operating_margin),
        profit_margins: _wm(fund.profit_margin),
        debt_to_equity: _wm(fund.debt_to_equity),
        current_ratio: _wm(fund.current_ratio),
        quick_ratio: _wm(fund.quick_ratio),
      };
      const aiAlpha = evaluateAIAlpha(stockInfoFull, s.curPrice || 100, s.curPrice || 100);
      const isAiBull = aiAlpha.winRatePct >= 70;
      const isAiRisk = aiAlpha.winRatePct <= 40 || aiAlpha.convictionTier.includes("偏空");
      const aiColor = isAiBull ? "#0284c7" : isAiRisk ? "#dc2626" : "#475569";

      return `
        <tr>
          <td style="text-align:center; font-weight:bold; color:#64748b;">${idx + 1}</td>
          <td><b style="color:#0284c7; font-size:1.02rem;">${coId}</b></td>
          <td><b style="font-size:1.02rem;">${s.name}</b></td>
          <td style="text-align:right;"><b style="font-size:1.05rem;">${curPrice}</b></td>
          <td style="text-align:center;">PE: <b>${pe}</b> / PB: <b>${pb}</b></td>
          <td style="text-align:right;">
            <b style="color:#b45309;">${yieldPct}</b>
            <div style="font-size:0.75rem; color:#64748b;">${cashDiv} (${exDate})</div>
          </td>
          <td style="text-align:right;">
            <div style="color:${roeColor}; font-weight:700;">ROE: ${roe}</div>
            <div style="color:${revColor}; font-size:0.75rem;">營收YoY: ${revGrowth}</div>
          </td>
          <td style="text-align:center;">
            <span style="display:inline-block; padding:2px 8px; border-radius:4px; font-weight:bold; background:${isAiBull ? '#e0f2fe' : isAiRisk ? '#fee2e2' : '#f1f5f9'}; color:${aiColor}; border:1px solid ${isAiBull ? '#bae6fd' : isAiRisk ? '#fca5a5' : '#cbd5e1'};">
              ${aiAlpha.winRatePct.toFixed(1)}% (${aiAlpha.convictionTier})
            </span>
          </td>
          <td style="font-size:0.80rem; color:#475569;">
            ${s.note || (aiAlpha.positiveDrivers[0] || aiAlpha.riskDrivers[0] || "-")}
          </td>
        </tr>
      `;
    }).join("");

    const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>StockT 自選觀察名單市場報告 (${activeList})</title>
  <style>
    @page {
      size: A4 landscape;
      margin: 12mm 15mm;
    }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .no-print { display: none !important; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang TC", "Microsoft JhengHei", Roboto, sans-serif;
      margin: 0;
      padding: 20px;
      color: #1e293b;
      background: #ffffff;
      line-height: 1.4;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 2px solid #0284c7;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .title-area h1 {
      margin: 0 0 4px 0;
      font-size: 1.55rem;
      color: #0369a1;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .meta-badge {
      font-size: 0.82rem;
      color: #64748b;
    }
    .notice {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left: 4px solid #0284c7;
      padding: 8px 14px;
      border-radius: 4px;
      font-size: 0.80rem;
      color: #475569;
      margin-bottom: 16px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.86rem;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      padding: 9px 10px;
      text-align: left;
      font-weight: 700;
      border: 1px solid #cbd5e1;
    }
    td {
      padding: 8px 10px;
      border: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    tr:nth-child(even) {
      background: #f8fafc;
    }
    .footer {
      margin-top: 20px;
      border-top: 1px solid #e2e8f0;
      padding-top: 8px;
      font-size: 0.75rem;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
    }
    .action-bar {
      margin-bottom: 16px;
      display: flex;
      gap: 12px;
    }
    .btn-print {
      background: #0284c7;
      color: white;
      border: none;
      padding: 8px 18px;
      border-radius: 6px;
      font-weight: bold;
      cursor: pointer;
      font-size: 0.92rem;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
  </style>
</head>
<body>
  <div class="no-print action-bar">
    <button class="btn-print" onclick="window.print()">🖨️ 列印 / 另存為 PDF</button>
  </div>

  <div class="header">
    <div class="title-area">
      <h1>⭐ StockT 自選觀察名單市場報告 — ${activeList}</h1>
      <div class="meta-badge">匯出時間：${reportDate} ｜ 觀察標的：共 ${observingStocks.length} 檔</div>
    </div>
    <div style="text-align: right; font-size: 0.80rem; color: #64748b;">
      <div>StockT 股市分析終端機</div>
      <div style="font-weight: bold; color: #0284c7;">公開市場基本面與 AI 多因子綜合評估</div>
    </div>
  </div>

  <div class="notice">
    🔒 <b>隱私與中立聲明：</b> 本報告僅呈現公開市場行情、基本面財務指標與 AI 多因子模型推論數據，<b>嚴格不包含任何個人持股數量、進場均價、買賣交易紀錄或投資成本損益</b>。
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 32px; text-align: center;">#</th>
        <th style="width: 75px;">代碼</th>
        <th style="width: 100px;">股票名稱</th>
        <th style="width: 85px; text-align: right;">即時市價</th>
        <th style="width: 125px; text-align: center;">估值 (PE / PB)</th>
        <th style="width: 135px; text-align: right;">殖利率 / 股利</th>
        <th style="width: 130px; text-align: right;">基本面獲利</th>
        <th style="width: 160px; text-align: center;">AI 20日勝率與評級</th>
        <th>觀察重點 / 備註</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="footer">
    <div>資料來源：臺灣證券交易所 (TWSE)、公開資訊觀測站 (MOPS) 及 StockT 內建 AI 引擎</div>
    <div>StockT Terminal &copy; 2026. All market data for analytical reference only.</div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 400);
    };
  </script>
</body>
</html>`;

    const printWin = window.open("", "_blank");
    if (printWin) {
      printWin.document.open();
      printWin.document.write(htmlContent);
      printWin.document.close();
    } else {
      const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `StockT_自選觀察名單_${activeList}_${new Date().toISOString().slice(0, 10)}.html`;
      a.click();
    }
  };

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
          {totals.totalGrossDividends > 0 && (
            <div style={{
              background: "linear-gradient(90deg, rgba(234, 179, 8, 0.18), rgba(202, 138, 4, 0.08))",
              border: "1px solid rgba(234, 179, 8, 0.4)", borderRadius: "8px", padding: "10px 14px",
              display: "flex", flexDirection: "column", gap: "6px", fontSize: "0.84rem", color: "#fef08a"
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span style={{ fontSize: "1.1rem" }}>🎁</span>
                  <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#ffffff" }}>目前持股除權息與股利稅務試算：</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                  <span>股利毛額: <b style={{ color: "#facc15" }}>NT$ {totals.totalGrossDividends.toLocaleString()}</b></span>
                  <span>健保補充保費(2.11%): <b style={{ color: totals.totalNhiPremium > 0 ? "#f87171" : "#4ade80" }}>-{totals.totalNhiPremium.toLocaleString()} 元</b></span>
                  <span>8.5%抵減稅額(可退稅): <b style={{ color: "#38bdf8" }}>+{totals.totalTaxCredit85.toLocaleString()} 元</b></span>
                  <span style={{
                    background: "rgba(250, 204, 21, 0.2)", border: "1px solid rgba(250, 204, 21, 0.5)",
                    borderRadius: "6px", padding: "2px 8px", color: "#facc15", fontWeight: 800
                  }}>
                    預估實收淨額: NT$ {totals.totalNetDividends.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}
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
                📈 總累積獲利 (未實現 + 已實現 + 股利)
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
                未實現 {totals.totalUnrealizedPnl >= 0 ? "+" : ""}{totals.totalUnrealizedPnl.toLocaleString()} ｜ 已實現 {totals.totalRealizedPnl >= 0 ? "+" : ""}{totals.totalRealizedPnl.toLocaleString()} ｜ 股息 +NT$ {totals.totalNetDividends.toLocaleString()}
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
            onClick={() => setViewTab("observing")}
            style={{
              padding: "7px 16px", borderRadius: "6px", border: "none", cursor: "pointer",
              fontSize: "0.88rem", fontWeight: 700,
              background: viewTab === "observing" ? "#2563eb" : "transparent",
              color: viewTab === "observing" ? "#ffffff" : "#94a3b8",
            }}
          >
            ⭐ 收藏觀察名單 ({observingStocks.length})
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
            📜 全部買賣流水帳 ({currentTrades.filter(t => t.price > 0).length})
          </button>
        </div>

        {/* ─── 內容表格區 ────────────────────────────────────────── */}
        <div className="watchlist-table-scroll" style={{ flex: 1, overflowY: "auto", overflowX: "auto", padding: "16px 20px" }}>
          
          {/* 1. 未實現損益表格 (現有庫存部位) */}
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
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>現金股利 / 配股</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>預估股利 (實收淨額 / 毛額)</th>
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

                            {/* 每股現金股利與除權息性質 */}
                            <td style={{ padding: "12px", textAlign: "right" }}>
                              <div style={{ fontWeight: 700, color: "#facc15" }}>
                                {h.cashDividend > 0 ? `${h.cashDividend.toFixed(2)} 元` : "無"}
                              </div>
                              <div style={{ fontSize: "0.72rem", color: h.stockDividend > 0 ? "#a855f7" : "#94a3b8", marginTop: "1px" }}>
                                {h.exType}{h.stockDividend > 0 ? ` (配股${h.stockDividend}元)` : ""}
                              </div>
                            </td>

                            {/* 預估可領現金股利總額 */}
                            <td style={{ padding: "12px", textAlign: "right" }}>
                              {h.estGrossDividend > 0 ? (
                                <div>
                                  <div style={{ fontWeight: 800, color: "#facc15", fontSize: "0.92rem" }}>
                                    NT$ {h.estNetDividend.toLocaleString()}
                                  </div>
                                  <div style={{ fontSize: "0.72rem", color: "#94a3b8", marginTop: "1px" }}>
                                    毛額 ${h.estGrossDividend.toLocaleString()}
                                    {h.nhiPremium > 0 ? (
                                      <span style={{ color: "#f87171", marginLeft: "4px" }}>(扣健保 ${h.nhiPremium})</span>
                                    ) : (
                                      <span style={{ color: "#4ade80", marginLeft: "4px" }}>(免扣健保)</span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: "0.68rem", color: "#38bdf8", marginTop: "1px" }}>
                                    ✓ 符除息日 {h.exDate}
                                  </div>
                                </div>
                              ) : h.cashDividend > 0 ? (
                                <div>
                                  <span style={{ color: "#94a3b8", fontSize: "0.80rem" }}>0 元</span>
                                  <div style={{ fontSize: "0.68rem", color: "#f87171", marginTop: "1px" }}>
                                    除息後買進 (除息日 {h.exDate})
                                  </div>
                                </div>
                              ) : (
                                <span style={{ color: "#94a3b8" }}>無配息</span>
                              )}
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
                                      background: "rgba(168, 85, 247, 0.2)", border: "1px solid rgba(192, 132, 252, 0.4)",
                                      borderRadius: "4px", color: "#d8b4fe", fontSize: "0.76rem", padding: "3px 8px",
                                      cursor: "pointer", fontWeight: 700
                                    }}
                                  >
                                    🔍 分析
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
                                      {lot.isQualified ? (
                                        <span style={{ color: "#4ade80", fontWeight: 700 }}>✓ 跨越除息日 (可領 ${lot.lotGrossDividend} 元)</span>
                                      ) : (
                                        <span style={{ color: "#94a3b8" }}>✗ 除息後建倉 (無配息)</span>
                                      )}
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

          {/* 2. 自選觀察名單 (純收藏・無持倉部位) */}
          {viewTab === "observing" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
                <div style={{ fontSize: "0.88rem", color: "#94a3b8", fontWeight: 600 }}>
                  ⭐ 共 {observingStocks.length} 檔自選觀察股
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  {observingStocks.length > 0 && (
                    <button
                      onClick={exportObservingPdf}
                      title="匯出純觀察報告（不含任何個人買賣與持倉損益）"
                      style={{
                        padding: "5px 12px", background: "rgba(168, 85, 247, 0.2)", border: "1px solid rgba(192, 132, 252, 0.4)",
                        borderRadius: "6px", color: "#d8b4fe", fontSize: "0.80rem", cursor: "pointer", fontWeight: 700,
                        display: "flex", alignItems: "center", gap: "5px"
                      }}
                    >
                      📄 匯出純觀察報告 (PDF)
                    </button>
                  )}
                  <button
                    onClick={() => openTradeModal("BUY")}
                    style={{
                      padding: "5px 12px", background: "#2563eb", border: "none",
                      borderRadius: "6px", color: "#ffffff", fontSize: "0.80rem", cursor: "pointer", fontWeight: 700
                    }}
                  >
                    ➕ 新增自選交易
                  </button>
                </div>
              </div>

              {observingStocks.length === 0 ? (
                <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
                  <div style={{ fontSize: "2.5rem", marginBottom: "10px" }}>⭐</div>
                  <div style={{ fontSize: "1.05rem", color: "#ffffff", fontWeight: 700 }}>目前尚無自選觀察股</div>
                  <div style={{ fontSize: "0.85rem", marginTop: "4px" }}>在選股雷達或個股分析頁點擊「⭐ 收藏」，即可將潛力股票加入此觀察清單！</div>
                </div>
              ) : (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.90rem" }}>
                  <thead>
                    <tr style={{ background: "rgba(30, 41, 59, 0.8)", borderBottom: "2px solid rgba(255,255,255,0.15)", color: "#ffffff" }}>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>股票代號 / 名稱</th>
                      <th style={{ padding: "10px 12px", textAlign: "center" }}>持股狀態</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>即時市價</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>每股現金股利</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>除權息性質 / 日期</th>
                      <th style={{ padding: "10px 12px", textAlign: "left" }}>備註</th>
                      <th style={{ padding: "10px 12px", textAlign: "center" }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {observingStocks.map((s) => (
                      <tr key={s.symbol} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.01)" }}>
                        <td style={{ padding: "12px", fontWeight: 700, color: "#ffffff" }}>
                          <span style={{ color: "#38bdf8", cursor: "pointer" }} onClick={() => onAnalyze && onAnalyze(s.symbol)}>
                            {s.name} ({s.symbol})
                          </span>
                        </td>
                        <td style={{ padding: "12px", textAlign: "center" }}>
                          {s.remainingShares > 0 ? (
                            <span style={{
                              padding: "2px 8px", borderRadius: "4px",
                              background: "rgba(56, 189, 248, 0.15)", border: "1px solid rgba(56, 189, 248, 0.4)",
                              color: "#38bdf8", fontSize: "0.76rem", fontWeight: 700
                            }}>
                              持倉 {s.remainingShares.toLocaleString()} 股
                            </span>
                          ) : (
                            <span style={{
                              padding: "2px 8px", borderRadius: "4px",
                              background: "rgba(255, 255, 255, 0.06)",
                              color: "#94a3b8", fontSize: "0.76rem"
                            }}>
                              觀察中
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right", color: "#ffffff", fontWeight: 800 }}>
                          ${s.curPrice > 0 ? s.curPrice.toFixed(2) : "-"}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right", color: "#facc15", fontWeight: 700 }}>
                          {s.cashDividend > 0 ? `${s.cashDividend.toFixed(2)} 元` : "無"}
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          <div style={{ fontSize: "0.82rem", color: s.stockDividend > 0 ? "#a855f7" : "#cbd5e1" }}>
                            {s.exType}{s.stockDividend > 0 ? ` (配股${s.stockDividend}元)` : ""}
                          </div>
                          {s.exDate && (
                            <div style={{ fontSize: "0.72rem", color: "#38bdf8", marginTop: "2px" }}>
                              除息日 {s.exDate}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "12px", color: "#94a3b8", fontSize: "0.82rem" }}>
                          {s.note || "-"}
                        </td>
                        <td style={{ padding: "12px", textAlign: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "6px" }}>
                            <button
                              onClick={() => openTradeModal("BUY", s.symbol, s.curPrice)}
                              title={s.remainingShares > 0 ? "加碼買進" : "買進建倉"}
                              style={{
                                background: "rgba(37,99,235,0.2)", border: "1px solid rgba(96,165,250,0.4)",
                                borderRadius: "4px", color: "#93c5fd", fontSize: "0.76rem", padding: "3px 8px",
                                cursor: "pointer", fontWeight: 700
                              }}
                            >
                              {s.remainingShares > 0 ? "＋ 加碼" : "➕ 買進"}
                            </button>
                            {onAnalyze && (
                              <button
                                onClick={() => onAnalyze(s.symbol)}
                                title="前往個股分析"
                                style={{
                                  background: "rgba(168, 85, 247, 0.2)", border: "1px solid rgba(192, 132, 252, 0.4)",
                                  borderRadius: "4px", color: "#d8b4fe", fontSize: "0.76rem", padding: "3px 8px",
                                  cursor: "pointer", fontWeight: 700
                                }}
                              >
                                🔍 分析
                              </button>
                            )}
                            <button
                              onClick={() => removeSymbolFromWatchlist(s.symbol)}
                              title="從自選清單移除"
                              style={{
                                background: "rgba(220,38,38,0.15)", border: "1px solid rgba(248,113,113,0.3)",
                                borderRadius: "4px", color: "#f87171", fontSize: "0.76rem", padding: "3px 8px",
                                cursor: "pointer", fontWeight: 700
                              }}
                            >
                              🗑️ 移除
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
                      <th style={{ padding: "10px 12px", textAlign: "center" }}>操作</th>
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
                        <td style={{ padding: "12px", textAlign: "center" }}>
                          {onAnalyze && (
                            <button
                              onClick={() => onAnalyze(r.symbol)}
                              title="前往個股分析"
                              style={{
                                background: "rgba(168, 85, 247, 0.2)", border: "1px solid rgba(192, 132, 252, 0.4)",
                                borderRadius: "4px", color: "#d8b4fe", fontSize: "0.76rem", padding: "3px 8px",
                                cursor: "pointer", fontWeight: 700
                              }}
                            >
                              🔍 分析
                            </button>
                          )}
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
                            {onAnalyze && (
                              <button
                                onClick={() => onAnalyze(t.symbol)}
                                title="前往個股分析"
                                style={{
                                  background: "rgba(168, 85, 247, 0.2)", border: "1px solid rgba(192, 132, 252, 0.4)",
                                  borderRadius: "4px", color: "#d8b4fe", fontSize: "0.74rem", padding: "2px 6px",
                                  cursor: "pointer", fontWeight: 700
                                }}
                              >
                                🔍 分析
                              </button>
                            )}
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
