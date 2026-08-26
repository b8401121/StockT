import React, { useCallback, useEffect, useState, useRef } from "react";
import { invoke } from "../utils/platform";
import { calculateAllIndicators, OhlcvData } from "../utils/indicators";
import { calcTechScanScore, checkLandmineRisks, computeFundamentalScore, getFsGrade, getTechRating } from "../utils/analysis";
import { getCachedStocks, subscribeStocks, StockEntry } from "../utils/stocks";
import { exportToHtmlFile } from "../utils/exportHtml";

interface PortfolioEntry {
  symbol: string;
  date: string;
  price: number;
  shares: number;
  sell_price: number;
}

interface PortfolioRow extends PortfolioEntry {
  category: string;
  name: string;
  current_price: number;
  pnl: number;
  pnl_pct: number;
  net_cost: number;
  buy_fee: number;
  sell_fee: number;
  tax: number;
  date_high_low: string;
  suggestion: string;
  tech_score: number;
  fs_grade: string;
  fs_score: number;
  origIdx: number;
}

interface PnlResult {
  net_cost: number;
  net_market_value: number;
  pnl: number;
  pnl_pct: number;
  buy_fee: number;
  sell_fee: number;
  tax: number;
}

// 自動分類
async function getCategoryBySym(sym: string): Promise<string> {
  try {
    return await invoke("get_category_by_symbol", { symbol: sym });
  } catch {
    return "自選/其他";
  }
}

export const PortfolioTab: React.FC<{ onAnalyze?: (sym: string) => void }> = ({ onAnalyze }) => {
  const [watchlist, setWatchlist] = useState<Record<string, PortfolioEntry[]>>({});
  const [rows, setRows] = useState<PortfolioRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [addSym, setAddSym] = useState("");
  const [addCat, setAddCat] = useState("未分類");
  const [feeDiscount, setFeeDiscount] = useState<number>(0.6);
  const [deductFees, setDeductFees] = useState(true);
  
  const [stocks, setStocks] = useState<StockEntry[]>([]);
  useEffect(() => {
    return subscribeStocks(setStocks);
  }, []);

  const getNormalizedSymbol = useCallback((sym: string, stockList: StockEntry[] = stocks): string => {
    const targetSym = sym.trim().toUpperCase();
    const pureSym = targetSym.split(".")[0];
    
    // Prefer the provided stock list if available
    if (stockList.length > 0) {
      const match = stockList.find(s => s.symbol.split(".")[0] === pureSym);
      if (match) return match.symbol;
    }
    // Fallback to the full cached stock list (may include .TWO entries)
    const cached = getCachedStocks();
    const cachedMatch = cached.find(s => s.symbol.split(".")[0] === pureSym);
    if (cachedMatch) return cachedMatch.symbol;
    
    // If still not found, assume a TWSE listing
    if (!targetSym.includes(".")) {
      if (/^\d+$/.test(targetSym)) return `${targetSym}.TW`;
    }
    return targetSym;
  }, [stocks]);

  const normalizeWatchlist = useCallback((
    rawWatchlist: Record<string, PortfolioEntry[]>,
    stockList: StockEntry[]
  ): { normalized: Record<string, PortfolioEntry[]>; changed: boolean } => {
    let changed = false;
    const normalized: Record<string, PortfolioEntry[]> = {};
    
    for (const [cat, entries] of Object.entries(rawWatchlist)) {
      normalized[cat] = entries.map(entry => {
        const normSym = getNormalizedSymbol(entry.symbol, stockList);
        if (entry.symbol !== normSym) {
          changed = true;
          return { ...entry, symbol: normSym };
        }
        return entry;
      });
    }
    return { normalized, changed };
  }, [getNormalizedSymbol]);
  
  // 多名單管理
  const [availableLists, setAvailableLists] = useState<string[]>(["李山任的清單"]);
  const [currentList, setCurrentList] = useState<string>(() => localStorage.getItem("portfolio_current_list") || "李山任的清單");
  useEffect(() => {
    localStorage.setItem("portfolio_current_list", currentList);
  }, [currentList]);
  const [newListName, setNewListName] = useState("");
  const [importModalOpen, setImportModalOpen] = useState(false);

  // 排序與離線資料生成
  const [sortField, setSortField] = useState<keyof PortfolioRow | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);

  const handleSort = (field: keyof PortfolioRow) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(true);
    }
  };

  const generateOfflineRows = (data: Record<string, PortfolioEntry[]>, stockList: StockEntry[] = getCachedStocks()): PortfolioRow[] => {
    const offlineRows: PortfolioRow[] = [];
    const stockMap = new Map(stockList.map(s => [s.symbol, s.name]));
    for (const [cat, entries] of Object.entries(data)) {
      entries.forEach((entry, idx) => {
        let name = stockMap.get(entry.symbol);
        if (!name) {
          const pureSym = entry.symbol.split(".")[0].toUpperCase();
          const match = stockList.find(s => s.symbol.split(".")[0] === pureSym);
          name = match ? match.name : entry.symbol;
        }
        offlineRows.push({
          ...entry,
          category: cat,
          name,
          current_price: 0,
          pnl: 0,
          pnl_pct: 0,
          net_cost: entry.price * entry.shares,
          buy_fee: 0,
          sell_fee: 0,
          tax: 0,
          date_high_low: "-",
          suggestion: "-",
          tech_score: 0,
          fs_grade: "N/A",
          fs_score: 0,
          origIdx: idx
        });
      });
    }
    return offlineRows;
  };

  const sortedRows = React.useMemo(() => {
    if (!sortField) return rows;
    return [...rows].sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (valA === undefined || valA === null) return sortAsc ? 1 : -1;
      if (valB === undefined || valB === null) return sortAsc ? -1 : 1;

      if (typeof valA === "string" && typeof valB === "string") {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }

      return sortAsc ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
    });
  }, [rows, sortField, sortAsc]);

  // 地雷掃描狀態
  const [scanningLandmines, setScanningLandmines] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [landmineResults, setLandmineResults] = useState<{symbol:string, name:string, score:number, techRisks:string[], fundRisks:string[], fundScore?:number, compositeScore?:number}[] | null>(null);
  const cancelRef = useRef(false);

  // ─── 讀取持倉 ───────────────────────────────────────────────────────────────
  const loadWatchlist = useCallback(async () => {
    try {
      const lists: string[] = await invoke("list_watchlists");
      setAvailableLists(lists);
      const data: Record<string, PortfolioEntry[]> = await invoke("load_watchlist", { filename: currentList });
      
      const cached = getCachedStocks();
      const { normalized, changed } = normalizeWatchlist(data, cached);
      
      setWatchlist(normalized);
      setRows(generateOfflineRows(normalized, cached));
      
      // 載入時立即更新報價
      await refreshPrices(normalized);
      
      if (changed) {
        await invoke("save_watchlist", { watchlist: normalized, filename: currentList });
      }
    } catch {
      setWatchlist({});
      setRows([]);
    }
  }, [currentList, normalizeWatchlist]);

  useEffect(() => { loadWatchlist(); }, [loadWatchlist]);

  useEffect(() => {
    if (stocks.length > 0 && Object.keys(watchlist).length > 0) {
      const { normalized, changed } = normalizeWatchlist(watchlist, stocks);
      if (changed) {
        setWatchlist(normalized);
        setRows(generateOfflineRows(normalized, stocks));
        invoke("save_watchlist", { watchlist: normalized, filename: currentList }).catch(err => {
          console.error("Failed to save normalized watchlist:", err);
        });
        refreshPrices(normalized);
      }
    }
  }, [stocks]); // 僅在股票庫載入後自動正規化一次，不依賴 watchlist 以防無謂觸發

  // ─── 快速 PnL 計算 (只重新計算金額/手續費，不做網路 I/O，毫秒級反應) ───────────────────
  const recalculatePnLsForRows = useCallback(async (currentRows: PortfolioRow[]) => {
    const updated = await Promise.all(currentRows.map(async (row) => {
      let pnl = 0, pnlPct = 0, netCost = 0, buyFee = 0, sellFee = 0, tax = 0;
      const exitPrice = row.sell_price > 0 ? row.sell_price : row.current_price;
      if (row.price > 0 && row.shares > 0 && exitPrice > 0) {
        if (deductFees) {
          try {
            const result: PnlResult = await invoke("calculate_tw_pnl", {
              symbol: row.symbol,
              buyPrice: row.price,
              currentPrice: exitPrice,
              shares: row.shares,
              feeDiscount,
            });
            pnl = result.pnl;
            pnlPct = result.pnl_pct;
            netCost = result.net_cost;
            buyFee = result.buy_fee;
            sellFee = result.sell_fee;
            tax = result.tax;
          } catch {}
        } else {
          const rawCost = row.price * row.shares;
          const rawVal = exitPrice * row.shares;
          pnl = rawVal - rawCost;
          pnlPct = rawCost > 0 ? (pnl / rawCost) * 100 : 0;
          netCost = rawCost;
        }
      }
      return {
        ...row,
        pnl,
        pnl_pct: pnlPct,
        net_cost: netCost,
        buy_fee: buyFee,
        sell_fee: sellFee,
        tax,
      };
    }));
    setRows(updated);
  }, [feeDiscount, deductFees]);

  // 當手續費設定改變時，只重新計算 PnL，不觸發網路重新抓取
  useEffect(() => {
    if (rows.length > 0) {
      recalculatePnLsForRows(rows);
    }
  }, [feeDiscount, deductFees, rows.length, recalculatePnLsForRows]);

  // ─── 刷新報價與損益 (從網路獲取最新市價，較慢，僅在載入/手動刷新/新增個股時執行) ───────────────
  const refreshPrices = useCallback(async (targetWatchlist?: Record<string, PortfolioEntry[]>) => {
    setLoading(true);
    const activeWatchlist = targetWatchlist || watchlist;
    if (Object.keys(activeWatchlist).length === 0) {
      setLoading(false);
      return;
    }

    const cached = getCachedStocks();
    
    // 平坦化自選股項目以利平行化處理
    const tasks: { cat: string; entry: PortfolioEntry; idx: number }[] = [];
    for (const [cat, entries] of Object.entries(activeWatchlist)) {
      entries.forEach((entry, idx) => {
        tasks.push({ cat, entry, idx });
      });
    }

    try {
      const allRows = await Promise.all(tasks.map(async ({ cat, entry, idx }) => {
        let currentPrice = 0;
        let name = entry.symbol;
        const cachedStock = cached.find(s => s.symbol === entry.symbol || s.symbol.split(".")[0] === entry.symbol.split(".")[0]);
        if (cachedStock) name = cachedStock.name;
        let date_high_low = "-";
        let suggestion = "-";
        let tech_score = 0;
        let fs_grade = "N/A";
        let fs_score = 0;

        try {
          const data: any = await invoke("fetch_stock_data", { symbol: entry.symbol, range: "1y" });
          const ohlcv = data.ohlcv;
          const info = data.info;
          name = info.name || entry.symbol;

          if (ohlcv && ohlcv.close && ohlcv.close.length > 0) {
            currentPrice = ohlcv.close[ohlcv.close.length - 1] ?? 0;

            // 1. 購買日行情高低價計算
            if (entry.date && entry.date !== "-") {
              const targetTs = Math.floor(new Date(entry.date).getTime() / 1000);
              if (!isNaN(targetTs)) {
                let closestIdx = -1;
                let minDiff = Infinity;
                for (let tIdx = 0; tIdx < ohlcv.timestamp.length; tIdx++) {
                  const diff = ohlcv.timestamp[tIdx] - targetTs;
                  if (Math.abs(diff) < minDiff) {
                    minDiff = Math.abs(diff);
                    closestIdx = tIdx;
                  }
                }
                if (closestIdx !== -1 && minDiff <= 4 * 86400) {
                  const h = ohlcv.high[closestIdx];
                  const l = ohlcv.low[closestIdx];
                  if (h != null && l != null) {
                    date_high_low = `H:${h.toFixed(2)} / L:${l.toFixed(2)}`;
                  }
                }
              }
            }

            // 2. 技術分析建議
            if (ohlcv.close.length >= 20) {
              const ind = calculateAllIndicators(ohlcv);
              const lastIdx = ohlcv.close.length - 1;
              const { score } = calcTechScanScore(ind, lastIdx);
              tech_score = score;
              const rating = getTechRating(score);
              suggestion = `${rating} (${score > 0 ? "+" : ""}${score.toFixed(1)})`;
            }
          }

          // 3. 基本面評級
          if (info) {
            const fs = computeFundamentalScore(info);
            fs_score = fs.score;
            fs_grade = getFsGrade(fs.score);
          }
        } catch (err) {
          console.error("fetch_stock_data error in refreshPrices:", err);
        }

        let pnl = 0, pnlPct = 0, netCost = 0, buyFee = 0, sellFee = 0, tax = 0;
        const exitPrice = entry.sell_price > 0 ? entry.sell_price : currentPrice;
        if (entry.price > 0 && entry.shares > 0 && exitPrice > 0) {
          if (deductFees) {
            try {
              const result: PnlResult = await invoke("calculate_tw_pnl", {
                symbol: entry.symbol,
                buyPrice: entry.price,
                currentPrice: exitPrice,
                shares: entry.shares,
                feeDiscount,
              });
              pnl = result.pnl;
              pnlPct = result.pnl_pct;
              netCost = result.net_cost;
              buyFee = result.buy_fee;
              sellFee = result.sell_fee;
              tax = result.tax;
            } catch {}
          } else {
            const rawCost = entry.price * entry.shares;
            const rawVal = exitPrice * entry.shares;
            pnl = rawVal - rawCost;
            pnlPct = rawCost > 0 ? (pnl / rawCost) * 100 : 0;
            netCost = rawCost;
          }
        }

        return {
          ...entry,
          category: cat,
          name,
          current_price: currentPrice,
          pnl,
          pnl_pct: pnlPct,
          net_cost: netCost,
          buy_fee: buyFee,
          sell_fee: sellFee,
          tax,
          date_high_low,
          suggestion,
          tech_score,
          fs_grade,
          fs_score,
          origIdx: idx
        };
      }));

      setRows(allRows);
    } catch (e) {
      console.error("refreshPrices parallel error:", e);
    } finally {
      setLoading(false);
    }
  }, [feeDiscount, deductFees, watchlist]);

  // ─── 新增持倉 ───────────────────────────────────────────────────────────────
  const addEntry = async (symInput?: string) => {
    const targetSym = (symInput || addSym).trim().toUpperCase();
    if (!targetSym) return;

    const sym = getNormalizedSymbol(targetSym);

    // 檢查是否已經存在，詢問是否追加
    let existingCat = "";
    for (const [catName, items] of Object.entries(watchlist)) {
      if (items.some((it) => it.symbol === sym)) {
        existingCat = catName;
        break;
      }
    }

    if (existingCat) {
      if (!window.confirm(`「${sym}」已經存在於自選股的【${existingCat}】中。\n您要追加一筆新的購入紀錄嗎？`)) {
        return;
      }
    }

    const cat = addCat.trim() || await getCategoryBySym(sym);
    const newEntry: PortfolioEntry = {
      symbol: sym,
      date: new Date().toISOString().slice(0, 10),
      price: 0,
      shares: 0,
      sell_price: 0,
    };
    const newList = { ...watchlist };
    if (!newList[cat]) newList[cat] = [];
    newList[cat] = [...newList[cat], newEntry];
    await saveWatchlist(newList, true);
    setAddSym("");
    setAddCat("");
  };

  // ─── 刪除持倉 ───────────────────────────────────────────────────────────────
  const removeEntry = async (cat: string, idx: number) => {
    if (!window.confirm(`確定要從 ${cat} 移除此紀錄嗎？`)) {
      return;
    }
    const newList = { ...watchlist };
    newList[cat] = newList[cat].filter((_, i) => i !== idx);
    if (!newList[cat].length) delete newList[cat];
    await saveWatchlist(newList, false);
  };

  // ─── 刪除名單 ───────────────────────────────────────────────────────────────
  const deleteCurrentList = async () => {
    if (currentList === "watchlist" || currentList === "李山任的清單") {
      alert("預設自選單無法刪除！");
      return;
    }
    if (!window.confirm(`確定要永久刪除「${currentList}」的自選股清單嗎？`)) {
      return;
    }
    try {
      await invoke("delete_watchlist", { filename: currentList });
      alert(`已成功刪除【${currentList}】的清單`);
      setCurrentList("李山任的清單");
      loadWatchlist();
    } catch (err) {
      alert(`刪除失敗: ${err}`);
    }
  };

  // ─── 匯入他人收藏 ────────────────────────────────────────────────────────────
  const performImport = async (otherList: string) => {
    try {
      const otherData: Record<string, PortfolioEntry[]> = await invoke("load_watchlist", { filename: otherList });
      if (!otherData || Object.keys(otherData).length === 0) {
        alert(`「${otherList}」的清單是空的或無法讀取。`);
        return;
      }

      // 收集現有的所有代碼，避免重複匯入
      const existingSymbols = new Set<string>();
      for (const entries of Object.values(watchlist)) {
        for (const entry of entries) {
          existingSymbols.add(getNormalizedSymbol(entry.symbol, stocks));
        }
      }

      let importedCount = 0;
      const newList = { ...watchlist };

      for (const [cat, entries] of Object.entries(otherData)) {
        for (const entry of entries) {
          const sym = getNormalizedSymbol(entry.symbol, stocks);
          if (!sym) continue;

          if (!existingSymbols.has(sym)) {
            if (!newList[cat]) newList[cat] = [];
            newList[cat].push({ ...entry, symbol: sym });
            existingSymbols.add(sym);
            importedCount++;
          }
        }
      }

      if (importedCount > 0) {
        await saveWatchlist(newList, true);
        alert(`已成功從「${otherList}」的清單中匯入 ${importedCount} 個新自選股！`);
      } else {
        alert("所有自選股都已存在於您的清單中，未匯入任何新項目。");
      }
    } catch (err) {
      alert(`匯入失敗: ${err}`);
    }
  };

  // ─── 更新欄位 ───────────────────────────────────────────────────────────────
  // ─── 編輯欄位與即時流暢輸入 ───────────────────────────────────────────────────────
  const handleInputChange = (
    cat: string,
    idx: number,
    field: keyof PortfolioEntry,
    value: string
  ) => {
    // 1. 更新記憶體中的自選股狀態
    const newWatchlist = { ...watchlist };
    const entry = { ...newWatchlist[cat][idx] } as any;
    if (field === "price" || field === "shares" || field === "sell_price") {
      entry[field] = parseFloat(value) || 0;
    } else {
      entry[field] = value;
    }
    newWatchlist[cat][idx] = entry;
    setWatchlist(newWatchlist);

    // 2. 即時更新 rows 以驅動輸入框顯示，並在 JavaScript 中以毫秒級速度概算損益（不卡頓）
    const newRows = rows.map((row) => {
      if (row.category === cat && row.origIdx === idx) {
        const updatedRow = { ...row, [field]: entry[field] };
        
        // 快速估算損益以提供即時視覺回饋
        const exitPrice = updatedRow.sell_price > 0 ? updatedRow.sell_price : updatedRow.current_price;
        if (updatedRow.price > 0 && updatedRow.shares > 0 && exitPrice > 0) {
          if (deductFees) {
            const rawCost = updatedRow.price * updatedRow.shares;
            let feeBuy = Math.max(20, Math.floor(rawCost * 0.001425 * feeDiscount));
            if (feeDiscount === 0) feeBuy = 0;
            const netCost = rawCost + feeBuy;
            
            const rawVal = exitPrice * updatedRow.shares;
            let feeSell = Math.max(20, Math.floor(rawVal * 0.001425 * feeDiscount));
            if (feeDiscount === 0) feeSell = 0;
            const tax = Math.floor(rawVal * 0.003);
            
            const pnl = rawVal - netCost - feeSell - tax;
            const pnlPct = netCost > 0 ? (pnl / netCost) * 100 : 0;
            
            updatedRow.pnl = pnl;
            updatedRow.pnl_pct = pnlPct;
            updatedRow.net_cost = netCost;
          } else {
            const rawCost = updatedRow.price * updatedRow.shares;
            const rawVal = exitPrice * updatedRow.shares;
            updatedRow.pnl = rawVal - rawCost;
            updatedRow.pnl_pct = rawCost > 0 ? (updatedRow.pnl / rawCost) * 100 : 0;
            updatedRow.net_cost = rawCost;
          }
        } else {
          updatedRow.pnl = 0;
          updatedRow.pnl_pct = 0;
          updatedRow.net_cost = updatedRow.price * updatedRow.shares;
        }
        return updatedRow;
      }
      return row;
    });
    setRows(newRows);
  };

  const handleInputBlur = async () => {
    // 移開焦點或按下確認時，寫入硬碟並進行 Rust 精確損益運算
    await invoke("save_watchlist", { watchlist, filename: currentList });
    await recalculatePnLsForRows(rows);
  };

  const saveWatchlist = async (data: Record<string, PortfolioEntry[]>, shouldRefreshPrices = false) => {
    await invoke("save_watchlist", { watchlist: data, filename: currentList });
    setWatchlist(data);
    if (shouldRefreshPrices) {
      await refreshPrices(data);
    } else {
      setRows(generateOfflineRows(data));
    }
  };

  // ─── 統計數據 ────────────────────────────────────────────────────────────────
  const totalCost = rows.reduce((acc, r) => acc + r.net_cost, 0);
  const totalPnl = rows.reduce((acc, r) => acc + r.pnl, 0);
  const totalPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  // ─── 匯出 HTML (精美分享名單，不含敏感購買資料) ──────────────────────────────────
  const exportTxt = async () => {
    try {
      const title = `股市自選分享名單 (${currentList})`;
      const filename = `share_${currentList}.html`;
      const htmlContent = await exportToHtmlFile(title, rows, "portfolio");
      const savedPath = await invoke("export_txt_file", { filename, content: htmlContent });
      alert(`分享名單匯出成功！已產生精美網頁檔案！\n已儲存至您的【下載】資料夾：\n${savedPath}`);
    } catch (err) {
      alert(`匯出失敗: ${err}`);
    }
  };

  // ─── 掃描自選地雷 ─────────────────────────────────────────────────────────────
  const scanLandmines = async () => {
    const symbols = Array.from(new Set(rows.map(r => r.symbol)));
    if (!symbols.length) return;

    setScanningLandmines(true);
    cancelRef.current = false;
    setLandmineResults(null);
    setScanProgress(0);

    const total = symbols.length;
    const BATCH = 5;
    const results: {symbol:string, name:string, score:number, techRisks:string[], fundRisks:string[], fundScore?:number, compositeScore?:number}[] = [];

    for (let i = 0; i < total; i += BATCH) {
      if (cancelRef.current) break;
      const chunk = symbols.slice(i, Math.min(i + BATCH, total));
      setScanProgress(Math.floor((i / total) * 100));

      try {
        const dataList: any[] = await invoke("fetch_batch_stock_data_full", { symbols: chunk, range: "1y" });
        for (const data of dataList) {
          if (cancelRef.current) break;
          const ohlcv: OhlcvData = data.ohlcv;
          if (ohlcv.close.length < 20) continue;
          const ind = calculateAllIndicators(ohlcv);
          const n = ohlcv.close.length - 1;
          const { score, risks: techRisks } = calcTechScanScore(ind, n);
          const name = data.info.name || data.info.symbol;

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

          // 計算基本面分數
          const fsResult = computeFundamentalScore(data.info);
          const fsScore = fsResult.score;
          if (fsScore <= -2) {
            const failedItems = fsResult.failed.map(([label]) => label);
            const fsDesc = `⚠️ 基本面評級：${getFsGrade(fsScore)}(分數:${fsScore})${failedItems.length ? `，異常：${failedItems.join("、")}` : ""}`;
            if (!lmFundRisks.includes(fsDesc)) lmFundRisks.push(fsDesc);
          }

          // 合併技術訊號
          const mergedTechRisks = [...techRisks, ...lmTechRisks];
          const totalRisks = mergedTechRisks.length + lmFundRisks.length;
          const composite = score + (fsScore < 0 ? fsScore * 2.0 : fsScore);
          
          if (score <= -1.5 || lmFundRisks.length >= 1 || totalRisks >= 2 || fsScore < 0) {
            results.push({
              symbol: data.info.symbol,
              name,
              score,
              techRisks: mergedTechRisks,
              fundRisks: lmFundRisks,
              fundScore: fsScore,
              compositeScore: composite
            });
          }
        }
      } catch {}
      await new Promise(r => setTimeout(r, 500));
    }

    // 依照綜合分數排序，分數越低（越危險）排在越前面
    results.sort((a, b) => (a.compositeScore ?? 0) - (b.compositeScore ?? 0));
    
    setScanProgress(100);
    setScanningLandmines(false);
    setLandmineResults(results);
  };

  // 基本面評級彩色（對標 PyQt 版顏色）
  const fsGradeColor = (g: string) => {
    if (g.includes("S")) return "#ce93d8";  // 紫 - 頂級
    if (g.includes("A")) return "#4d94ff";  // 藍 - 優質
    if (g.includes("B")) return "#4caf50";  // 綠 - 良好
    if (g.includes("C")) return "#ffd740";  // 黃 - 普通
    if (g.includes("D")) return "#ffab40";  // 橙 - 偏弱
    if (g.includes("F")) return "#ff5252";  // 紅 - 危險
    return "var(--text-secondary)";
  };
  
  // 基本面分數 badge 背景色
  const fsGradeBg = (g: string) => {
    if (g.includes("S")) return "rgba(206,147,216,0.15)";
    if (g.includes("A")) return "rgba(77,148,255,0.15)";
    if (g.includes("B")) return "rgba(76,175,80,0.15)";
    if (g.includes("C")) return "rgba(255,215,64,0.12)";
    if (g.includes("D")) return "rgba(255,171,64,0.15)";
    if (g.includes("F")) return "rgba(255,82,82,0.15)";
    return "transparent";
  };

  return (
    <div className="portfolio-layout">
      {/* 頂部多名單管理工具列 */}
      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", padding: "10px", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }}>
        <span style={{ color: "rgba(255,255,255,0.7)" }}>👤 選擇帳戶自選股清單：</span>
        <select 
          className="select-field"
          value={currentList} 
          onChange={(e) => setCurrentList(e.target.value)}
          style={{ padding: "4px 28px 4px 8px", backgroundPosition: "right 6px center", fontSize: "0.85rem", border: "1px solid rgba(255,255,255,0.15)" }}
        >
          {availableLists.map(l => (
            <option key={l} value={l}>{l === "watchlist" ? "預設自選單" : l}</option>
          ))}
        </select>
        <button className="btn btn-danger btn-sm" onClick={deleteCurrentList}>🗑️ 刪除此清單</button>
        <button className="btn btn-outline btn-sm" onClick={() => setImportModalOpen(true)} style={{ background: "rgba(2, 136, 209, 0.15)", color: "#29b6f6", borderColor: "rgba(2, 136, 209, 0.3)" }}>📥 匯入他人收藏</button>
        <div style={{ width: "1px", height: "20px", background: "rgba(255,255,255,0.1)", margin: "0 8px" }} />
        <input 
          type="text" className="input-field" placeholder="新名單名稱" 
          value={newListName} onChange={(e) => setNewListName(e.target.value)}
          style={{ width: "150px", padding: "4px 8px" }} 
        />
        <button className="btn btn-outline btn-sm" onClick={() => {
          if (newListName.trim()) {
            const name = newListName.trim().replace(".json", "");
            if (!availableLists.includes(name)) setAvailableLists([...availableLists, name]);
            setCurrentList(name);
            setNewListName("");
            setWatchlist({});
          }
        }}>➕ 建立新名單</button>
      </div>

      {/* 交易成本設定 */}
      <div style={{ display: "flex", gap: "15px", alignItems: "center", marginBottom: "16px", padding: "10px", background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "8px", fontSize: "0.85rem" }}>
        <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
          <input 
            type="checkbox" 
            checked={deductFees} 
            onChange={(e) => setDeductFees(e.target.checked)} 
          />
          扣除台股手續費與稅金
        </label>
        {deductFees && (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span>手續費折扣:</span>
            <input 
              type="number" 
              className="criteria-input" 
              value={feeDiscount} 
              min={0} 
              max={1} 
              step={0.05}
              onChange={(e) => setFeeDiscount(parseFloat(e.target.value) || 0)} 
              style={{ width: "60px", padding: "2px 4px" }} 
            />
            <span style={{ color: "var(--text-muted)" }}>折 (如0.6為6折。無折填1，免收填0)</span>
          </div>
        )}
      </div>

      {/* 工具列 */}
      <div className="portfolio-toolbar">
        <input className="input-field" value={addSym} onChange={(e) => setAddSym(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addEntry()}
          placeholder="股票代碼" style={{ width: "130px" }} />
        <input className="input-field" value={addCat} onChange={(e) => setAddCat(e.target.value)}
          placeholder="分類名稱（可留空自動分類）" style={{ width: "200px" }} />
        <button className="btn btn-success" onClick={() => addEntry()}>➕ 新增</button>
        <button className="btn btn-primary" onClick={() => refreshPrices()} disabled={loading || scanningLandmines}>
          {loading ? <span className="loading-spinner" /> : "🔄 刷新報價"}
        </button>
        <button className="btn btn-warning" onClick={scanLandmines} disabled={scanningLandmines || loading}>
          {scanningLandmines ? `💣 掃描中 ${scanProgress}%` : "🚨 掃描自選地雷"}
        </button>
        <button className="btn btn-outline" onClick={exportTxt}>📤 匯出組合清單</button>
        <div style={{ flex: 1 }} />
        {rows.length > 0 && (
          <div style={{ textAlign: "right", fontSize: "0.85rem" }}>
            <span style={{ color: "var(--text-muted)" }}>投入成本：</span>
            <span style={{ fontWeight: 600 }}>{(totalCost ?? 0).toFixed(0)}</span>
            <span style={{ margin: "0 12px", color: "var(--text-muted)" }}>總損益：</span>
            <span style={{ fontWeight: 600, color: totalPnl > 0 ? "var(--accent-red)" : totalPnl < 0 ? "var(--accent-green)" : "inherit", fontSize: "1rem" }}>
              {(totalPnl ?? 0) > 0 ? "+" : ""}{(totalPnl ?? 0).toFixed(0)} ({(totalPct ?? 0) > 0 ? "+" : ""}{(totalPct ?? 0).toFixed(2)}%)
            </span>
          </div>
        )}
      </div>

      {/* 表格 */}
      <div className="portfolio-table-wrap">
        {Object.keys(watchlist).length === 0 ? (
          <div className="empty-state" style={{ height: "100%" }}>
            <div className="empty-icon">💼</div>
            <div className="empty-text">尚無持倉紀錄，點選「新增」加入股票</div>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ cursor: "pointer" }} onClick={() => handleSort("category")}>分類 {sortField === "category" ? (sortAsc ? "▲" : "▼") : ""}</th>
                <th style={{ cursor: "pointer" }} onClick={() => handleSort("symbol")}>代碼 {sortField === "symbol" ? (sortAsc ? "▲" : "▼") : ""}</th>
                <th style={{ cursor: "pointer" }} onClick={() => handleSort("name")}>名稱 {sortField === "name" ? (sortAsc ? "▲" : "▼") : ""}</th>
                <th style={{ cursor: "pointer" }} onClick={() => handleSort("date")}>購買日 {sortField === "date" ? (sortAsc ? "▲" : "▼") : ""}</th>
                <th style={{ cursor: "pointer" }} onClick={() => handleSort("date_high_low")}>購買日行情 {sortField === "date_high_low" ? (sortAsc ? "▲" : "▼") : ""}</th>
                <th style={{ cursor: "pointer" }} onClick={() => handleSort("price")}>買價 {sortField === "price" ? (sortAsc ? "▲" : "▼") : ""}</th>
                <th style={{ cursor: "pointer" }} onClick={() => handleSort("shares")}>股數 {sortField === "shares" ? (sortAsc ? "▲" : "▼") : ""}</th>
                <th style={{ cursor: "pointer" }} onClick={() => handleSort("current_price")}>現價 {sortField === "current_price" ? (sortAsc ? "▲" : "▼") : ""}</th>
                <th style={{ cursor: "pointer" }} onClick={() => handleSort("sell_price")}>賣出價 {sortField === "sell_price" ? (sortAsc ? "▲" : "▼") : ""}</th>
                <th style={{ cursor: "pointer" }} onClick={() => handleSort("pnl")}>損益 {sortField === "pnl" ? (sortAsc ? "▲" : "▼") : ""}</th>
                <th style={{ cursor: "pointer" }} onClick={() => handleSort("tech_score")}>線型建議 {sortField === "tech_score" ? (sortAsc ? "▲" : "▼") : ""}</th>
                <th style={{ cursor: "pointer" }} onClick={() => handleSort("fs_score")}>基本面 {sortField === "fs_score" ? (sortAsc ? "▲" : "▼") : ""}</th>
                <th>動作</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row, index) => (
                <tr key={`${row.category}-${row.symbol}-${row.origIdx}-${index}`}>
                  <td style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>{row.category}</td>
                  <td style={{ color: "var(--accent-blue)", fontWeight: 600 }}>{row.symbol.split(".")[0]}</td>
                  <td style={{ fontSize: "0.82rem" }}>{row.name}</td>
                  <td>
                    <input type="date" className="criteria-input" value={row.date}
                      onChange={(e) => handleInputChange(row.category, row.origIdx, "date", e.target.value)}
                      onBlur={handleInputBlur}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      style={{ width: "120px", fontSize: "0.78rem" }} />
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: "0.78rem" }}>{row.date_high_low}</td>
                  <td>
                    <input type="number" className="criteria-input" value={row.price || ""}
                      onChange={(e) => handleInputChange(row.category, row.origIdx, "price", e.target.value)}
                      onBlur={handleInputBlur}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      style={{ width: "80px" }} />
                  </td>
                  <td>
                    <input type="number" className="criteria-input" value={row.shares || ""}
                      onChange={(e) => handleInputChange(row.category, row.origIdx, "shares", e.target.value)}
                      onBlur={handleInputBlur}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      style={{ width: "70px" }} />
                  </td>
                  <td style={{ fontWeight: 600 }}>{row.current_price != null && !isNaN(row.current_price) ? row.current_price.toFixed(2) : "-"}</td>
                  <td>
                    <input type="number" className="criteria-input" value={row.sell_price || ""}
                      placeholder="未賣出"
                      onChange={(e) => handleInputChange(row.category, row.origIdx, "sell_price", e.target.value)}
                      onBlur={handleInputBlur}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      style={{ width: "80px" }} />
                  </td>
                  <td>
                    {row.price > 0 && row.shares > 0 ? (
                      <span style={{
                        color: (row.pnl ?? 0) > 0 ? "var(--accent-red)" : (row.pnl ?? 0) < 0 ? "var(--accent-green)" : "var(--text-primary)",
                        fontWeight: 600
                      }}>
                        {row.pnl_pct != null && !isNaN(row.pnl_pct) ? `${row.pnl_pct > 0 ? "+" : ""}${row.pnl_pct.toFixed(2)}%` : "-"} ({row.pnl != null && !isNaN(row.pnl) ? `${row.pnl > 0 ? "+" : ""}${row.pnl.toFixed(0)}` : "-"})
                      </span>
                    ) : "-"}
                  </td>
                  <td>
                    {row.suggestion !== "-" ? (
                      <span style={{
                        color: row.tech_score >= 1.5 ? "var(--accent-red)" : row.tech_score <= -1.5 ? "var(--accent-green)" : "var(--text-secondary)",
                        fontWeight: 600,
                        fontSize: "0.82rem"
                      }}>
                        {row.suggestion}
                      </span>
                    ) : "-"}
                  </td>
                  <td>
                    {row.fs_grade !== "N/A" ? (
                      <span style={{
                        display: "inline-flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "2px"
                      }}>
                        <span style={{
                          color: fsGradeColor(row.fs_grade),
                          background: fsGradeBg(row.fs_grade),
                          border: `1px solid ${fsGradeColor(row.fs_grade)}50`,
                          borderRadius: "4px",
                          padding: "1px 6px",
                          fontWeight: 700,
                          fontSize: "0.82rem"
                        }}>
                          {row.fs_grade}
                        </span>
                        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                          {row.fs_score > 0 ? "+" : ""}{row.fs_score}分
                        </span>
                      </span>
                    ) : "-"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => onAnalyze?.(row.symbol)}>分析</button>
                      <button className="btn btn-outline btn-sm" onClick={() => addEntry(row.symbol)} style={{ background: "rgba(76, 175, 80, 0.15)", color: "#81c784", borderColor: "rgba(76, 175, 80, 0.3)" }}>追加</button>
                      <button className="btn btn-danger btn-sm" onClick={() => removeEntry(row.category, row.origIdx)}>刪除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 掃描地雷結果 Modal */}
      {landmineResults !== null && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          zIndex: 9999, display: "flex", justifyContent: "center", alignItems: "center"
        }} onClick={() => setLandmineResults(null)}>
          <div style={{
            background: "#1a1a24", borderRadius: "12px", width: "500px", maxWidth: "90%",
            maxHeight: "80vh", display: "flex", flexDirection: "column", border: "1px solid rgba(255,255,255,0.1)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, color: "#ff5252" }}>💣 自選地雷掃描結果</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setLandmineResults(null)}>✕</button>
            </div>
            <div style={{ overflowY: "auto", padding: "16px" }}>
              {landmineResults.length === 0 ? (
                <div style={{ textAlign: "center", color: "#4caf50", padding: "20px" }}>
                  🎉 恭喜！目前自選單中沒有發現明顯技術面地雷風險的個股。
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ color: "rgba(255,255,255,0.7)", marginBottom: "8px" }}>
                    發現 {landmineResults.length} 檔個股存在風險信號，請謹慎評估：
                  </div>
                  {landmineResults.map(r => {
                    const isFundMine = r.fundScore !== undefined && r.fundScore < -2;
                    const isDoubleMine = isFundMine && (r.score <= -1);
                    return (
                      <div key={r.symbol} style={{
                        background: isDoubleMine ? "rgba(213,0,0,0.12)" : isFundMine ? "rgba(255,82,82,0.08)" : "rgba(255,152,0,0.06)",
                        borderLeft: `4px solid ${isDoubleMine ? "#d50000" : isFundMine ? "#ff5252" : "#ff9800"}`,
                        padding: "12px", borderRadius: "4px"
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                          <span style={{ fontWeight: "bold", fontSize: "1.05rem" }}>
                            {isDoubleMine ? "💥 " : isFundMine ? "💣 " : "⚠️ "}
                            {r.name} 
                            <span style={{ color: "var(--accent-blue)", fontSize: "0.9rem" }}>({r.symbol.split(".")[0]})</span>
                            {isDoubleMine && <span style={{ color: "#d50000", fontSize: "0.8rem", marginLeft: "8px", fontWeight: "bold" }}>[雙重地雷]</span>}
                            {!isDoubleMine && isFundMine && <span style={{ color: "#ff5252", fontSize: "0.8rem", marginLeft: "8px", fontWeight: "bold" }}>[基本面地雷]</span>}
                          </span>
                          <span style={{ color: r.compositeScore !== undefined && r.compositeScore < -3 ? "#ff1744" : "#ff8a65", fontWeight: "bold", fontSize: "0.85rem" }}>
                            綜合: {r.compositeScore != null ? r.compositeScore.toFixed(1) : "-"}分 (技術: {r.score != null ? r.score.toFixed(1) : "-"} | 基本: {r.fundScore ?? 0})
                          </span>
                        </div>
                        {r.techRisks.length > 0 && (
                          <div style={{ marginBottom: "4px" }}>
                            <span style={{ color: "#ff7043", fontSize: "0.8rem", fontWeight: 600 }}>📉 技術面：</span>
                            <span style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.85rem" }}>{r.techRisks.join("、")}</span>
                          </div>
                        )}
                        {r.fundRisks.length > 0 && (
                          <div style={{ marginBottom: "4px" }}>
                            <span style={{ color: "#ff9800", fontSize: "0.8rem", fontWeight: 600 }}>💰 財務面：</span>
                            <span style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.85rem" }}>{r.fundRisks.join(" | ")}</span>
                          </div>
                        )}
                        <div style={{ marginTop: "8px" }}>
                          <button className="btn btn-outline btn-sm" onClick={() => { setLandmineResults(null); onAnalyze?.(r.symbol); }}>
                            檢視詳細分析
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 匯入他人收藏 Modal */}
      {importModalOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          zIndex: 9999, display: "flex", justifyContent: "center", alignItems: "center"
        }} onClick={() => setImportModalOpen(false)}>
          <div style={{
            background: "#1a1a24", borderRadius: "12px", width: "400px", maxWidth: "90%",
            padding: "20px", display: "flex", flexDirection: "column", border: "1px solid rgba(255,255,255,0.1)",
            gap: "15px"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0, color: "#0288d1" }}>📥 匯入他人收藏</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setImportModalOpen(false)}>✕</button>
            </div>
            
            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.9rem" }}>
              請選擇要從哪位使用者的清單匯入收藏：
            </div>
            
            {availableLists.filter(l => l !== currentList).length === 0 ? (
              <div style={{ color: "var(--text-muted)", fontSize: "0.85rem", textAlign: "center", padding: "10px" }}>
                沒有找到其他使用者的自選股清單可以匯入。
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "200px", overflowY: "auto" }}>
                {availableLists.filter(l => l !== currentList).map(l => (
                  <button 
                    key={l}
                    className="btn btn-outline" 
                    style={{ justifyContent: "flex-start", width: "100%", padding: "8px 12px", textAlign: "left" }}
                    onClick={() => {
                      setImportModalOpen(false);
                      performImport(l);
                    }}
                  >
                    👤 {l === "watchlist" ? "預設自選單" : l}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
