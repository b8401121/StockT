import React, { useCallback, useEffect, useState, useRef } from "react";
import { invoke } from "../utils/platform";
import { calculateAllIndicators, OhlcvData } from "../utils/indicators";
import { calcTechScanScore, checkLandmineRisks, computeFundamentalScore, getFsGrade, getTechRating } from "../utils/analysis";
import { getCachedStocks, subscribeStocks, StockEntry } from "../utils/stocks";
import { exportToHtmlFile } from "../utils/exportHtml";
import {
  getLocalVaultUsers,
  saveUserVault,
  loadUserVault,
  getGitHubSyncConfig,
  saveGitHubSyncConfig,
  testGitHubConnection,
  VaultUser,
  GitHubSyncConfig,
} from "../utils/vault";

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

  // ─── 多用戶密碼保險箱與 GitHub 雲端同步狀態 ────────────────────────────
  const [currentUser, setCurrentUser] = useState<string | null>(() => sessionStorage.getItem("stockt_auth_user") || null);
  const [currentPassword, setCurrentPassword] = useState<string | null>(() => sessionStorage.getItem("stockt_auth_pass") || null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authPasswordConfirm, setAuthPasswordConfirm] = useState("");
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [vaultUsers, setVaultUsers] = useState<VaultUser[]>(() => getLocalVaultUsers());

  // GitHub 同步設定
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [githubConfig, setGithubConfig] = useState<GitHubSyncConfig>(() => getGitHubSyncConfig() || { token: "", repo: "b8401121/StockT", branch: "main" });
  const [githubSyncing, setGithubSyncing] = useState(false);
  const [githubSyncMsg, setGithubSyncMsg] = useState("");

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
      // 1. 若有登入的使用者，優先載入其解密的保險箱
      if (currentUser && currentPassword) {
        try {
          const { data } = await loadUserVault(currentUser, currentPassword);
          const cached = getCachedStocks();
          const { normalized } = normalizeWatchlist(data, cached);
          setWatchlist(normalized);
          setRows(generateOfflineRows(normalized, cached));
          await refreshPrices(normalized);
          return;
        } catch (e) {
          console.warn("User vault auto-load failed:", e);
        }
      }

      // 2. 否則載入本機未加密預設清單
      const lists: string[] = await invoke("list_watchlists");
      setAvailableLists(lists);
      const data: Record<string, PortfolioEntry[]> = await invoke("load_watchlist", { filename: currentList });
      
      const cached = getCachedStocks();
      const { normalized, changed } = normalizeWatchlist(data, cached);
      
      setWatchlist(normalized);
      setRows(generateOfflineRows(normalized, cached));
      
      await refreshPrices(normalized);
      
      if (changed) {
        await invoke("save_watchlist", { watchlist: normalized, filename: currentList });
      }
    } catch {
      setWatchlist({});
      setRows([]);
    }
  }, [currentList, currentUser, currentPassword, normalizeWatchlist]);

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
    if (currentUser && currentPassword) {
      saveUserVault(currentUser, currentPassword, watchlist, true).catch(console.warn);
    }
    await invoke("save_watchlist", { watchlist, filename: currentList });
    await recalculatePnLsForRows(rows);
  };

  const saveWatchlist = async (data: Record<string, PortfolioEntry[]>, shouldRefreshPrices = false) => {
    // 1. 若當前已登入加密使用者，自動端對端加密儲存並同步
    if (currentUser && currentPassword) {
      saveUserVault(currentUser, currentPassword, data, true).catch(console.warn);
    }
    await invoke("save_watchlist", { watchlist: data, filename: currentList });
    setWatchlist(data);
    if (shouldRefreshPrices) {
      await refreshPrices(data);
    } else {
      setRows(generateOfflineRows(data));
    }
  };

  // ─── 帳號登入 / 註冊 / 鎖定處理 ─────────────────────────────────────────────
  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!authUsername.trim() || !authPassword) {
      setAuthError("請輸入使用者名稱與密碼");
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    try {
      const { data } = await loadUserVault(authUsername.trim(), authPassword, true);
      const u = authUsername.trim();
      setCurrentUser(u);
      setCurrentPassword(authPassword);
      sessionStorage.setItem("stockt_auth_user", u);
      sessionStorage.setItem("stockt_auth_pass", authPassword);
      setWatchlist(data);
      setAuthModalOpen(false);
      setAuthPassword("");
      await refreshPrices(data);
    } catch (err: any) {
      setAuthError(String(err.message || err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleRegister = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const u = authUsername.trim();
    if (!u) { setAuthError("請輸入使用者名稱"); return; }
    if (!authPassword) { setAuthError("請設定保險箱密碼"); return; }
    if (authPassword !== authPasswordConfirm) { setAuthError("兩次輸入的密碼不一致"); return; }

    setAuthLoading(true);
    setAuthError("");
    try {
      const initialData = watchlist && Object.keys(watchlist).length > 0 ? watchlist : { "核心持股": [] };
      await saveUserVault(u, authPassword, initialData, true);
      setCurrentUser(u);
      setCurrentPassword(authPassword);
      sessionStorage.setItem("stockt_auth_user", u);
      sessionStorage.setItem("stockt_auth_pass", authPassword);
      setVaultUsers(getLocalVaultUsers());
      setWatchlist(initialData);
      setAuthModalOpen(false);
      setAuthPassword("");
      setAuthPasswordConfirm("");
      await refreshPrices(initialData);
      alert(`🎉 使用者【${u}】專屬加密保險箱建立成功！\n所有資料已使用 AES-GCM-256 端對端高強度加密。`);
    } catch (err: any) {
      setAuthError(String(err.message || err));
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLock = () => {
    sessionStorage.removeItem("stockt_auth_user");
    sessionStorage.removeItem("stockt_auth_pass");
    setCurrentUser(null);
    setCurrentPassword(null);
    setWatchlist({});
    setRows([]);
  };

  // 帳號密碼（用於未登入時在 GitHub 視窗中直接操作）
  const [modalUser, setModalUser] = useState("");
  const [modalPass, setModalPass] = useState("");

  const handleTestGitHub = async () => {
    if (!githubConfig.token.trim()) {
      setGithubSyncMsg("⚠️ 請先輸入 GitHub Token！");
      return;
    }
    setGithubSyncing(true);
    setGithubSyncMsg("⏳ 正在驗證 GitHub 連線與 Token 權限...");
    try {
      const res = await testGitHubConnection(githubConfig);
      saveGitHubSyncConfig(githubConfig);
      setGithubSyncMsg(`✅ ${res.message} (具備寫入權限)`);
    } catch (err: any) {
      setGithubSyncMsg(`❌ 連線失敗: ${err.message || err}`);
    } finally {
      setGithubSyncing(false);
    }
  };

  const handleSyncToGitHub = async () => {
    const userToSync = (currentUser || modalUser).trim();
    const passToSync = currentPassword || modalPass;

    if (!userToSync || !passToSync) {
      setGithubSyncMsg("⚠️ 請輸入保險箱使用者名稱與密碼！");
      return;
    }
    if (!githubConfig.token.trim() || !githubConfig.repo.trim()) {
      setGithubSyncMsg("⚠️ 請填寫 GitHub Token 與 倉庫名稱！");
      return;
    }

    setGithubSyncing(true);
    setGithubSyncMsg("⏳ 正在進行 AES-256 加密並推送至 GitHub...");
    try {
      saveGitHubSyncConfig(githubConfig);
      await saveUserVault(userToSync, passToSync, watchlist, true);
      
      // 若尚未登入則順便登入本機 Session
      if (!currentUser) {
        setCurrentUser(userToSync);
        setCurrentPassword(passToSync);
        sessionStorage.setItem("stockt_auth_user", userToSync);
        sessionStorage.setItem("stockt_auth_pass", passToSync);
      }

      setGithubSyncMsg(`🎉 成功同步！已安全加密並推送至【${githubConfig.repo.trim()}/vaults/${userToSync}.vault.json】！`);
      setTimeout(() => {
        setGithubModalOpen(false);
        setGithubSyncMsg("");
      }, 3000);
    } catch (err: any) {
      setGithubSyncMsg(`❌ 備份失敗: ${err.message || err}`);
    } finally {
      setGithubSyncing(false);
    }
  };

  const handleFetchFromGitHub = async () => {
    if (!authUsername.trim() || !authPassword) {
      setAuthError("請先輸入使用者名稱與密碼以進行雲端解密");
      return;
    }
    if (!githubConfig.token || !githubConfig.repo) {
      setGithubModalOpen(true);
      return;
    }
    setAuthLoading(true);
    setAuthError("");
    try {
      saveGitHubSyncConfig(githubConfig);
      const { data } = await loadUserVault(authUsername.trim(), authPassword, true);
      const u = authUsername.trim();
      setCurrentUser(u);
      setCurrentPassword(authPassword);
      sessionStorage.setItem("stockt_auth_user", u);
      sessionStorage.setItem("stockt_auth_pass", authPassword);
      setWatchlist(data);
      setAuthModalOpen(false);
      setAuthPassword("");
      await refreshPrices(data);
      alert(`🎉 成功從 GitHub 雲端還原並解密【${u}】的投資組合！`);
    } catch (err: any) {
      setAuthError(`雲端還原失敗: ${err.message || err}`);
    } finally {
      setAuthLoading(false);
    }
  };

  // ─── 匯出加密備份檔 (.vault.json) ───────────────────────────────────────────
  const exportVaultBackup = async () => {
    if (!currentUser || !currentPassword) {
      alert("請先登入解鎖您的專屬保險箱！");
      return;
    }
    try {
      const raw = localStorage.getItem(`stockt_vault_${currentUser}`);
      if (!raw) return;
      const filename = `${currentUser}_backup.vault.json`;
      await invoke("export_txt_file", { filename, content: raw });
      alert(`🔒 加密保險箱備份檔已匯出！\n檔案名稱: ${filename}\n他人即使取得該檔案，沒有您的密碼也無法解開。`);
    } catch (err) {
      alert(`匯出失敗: ${err}`);
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
      {/* 頂部隱私保險箱與用戶狀態列 */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: "14px", padding: "10px 14px",
        background: currentUser ? "rgba(77, 148, 255, 0.08)" : "rgba(255, 255, 255, 0.03)",
        border: `1px solid ${currentUser ? "rgba(77, 148, 255, 0.3)" : "rgba(255, 255, 255, 0.08)"}`,
        borderRadius: "10px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "1.1rem" }}>{currentUser ? "🛡️" : "🔒"}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.95rem", color: currentUser ? "var(--accent-blue)" : "var(--text-primary)" }}>
              {currentUser ? `【${currentUser}】專屬加密保險箱 (AES-256 已解鎖)` : "未解鎖加密保險箱"}
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {currentUser ? "持股資料已端對端加密儲存，可一鍵同步至 GitHub。" : "不同使用者資料互相隔離，請登入專屬帳號以存取個人持股。"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {currentUser ? (
            <>
              <button className="btn btn-outline btn-sm" onClick={() => setGithubModalOpen(true)} style={{ color: "#4caf50", borderColor: "rgba(76,175,80,0.4)" }}>
                ☁️ GitHub 集中同步
              </button>
              <button className="btn btn-outline btn-sm" onClick={exportVaultBackup} title="匯出本機 AES-256 加密存檔">
                📤 匯出加密備份
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => { setAuthTab("login"); setAuthModalOpen(true); }}>
                👥 切換用戶
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleLock}>
                🔒 鎖定保險箱
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-primary btn-sm" onClick={() => { setAuthTab("login"); setAuthModalOpen(true); }}>
                🔑 登入 / 解鎖保險箱
              </button>
              <button className="btn btn-success btn-sm" onClick={() => { setAuthTab("register"); setAuthModalOpen(true); }}>
                ✨ 建立新密碼保險箱
              </button>
            </>
          )}
        </div>
      </div>

      {/* 頂部名單切換工具列 */}
      <div style={{ display: "flex", gap: "10px", alignItems: "center", marginBottom: "16px", padding: "10px", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }}>
        <span style={{ color: "rgba(255,255,255,0.7)" }}>👤 自選股清單：</span>
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

      {/* 登入 / 註冊 密碼保險箱 Modal */}
      {authModalOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
          zIndex: 10000, display: "flex", justifyContent: "center", alignItems: "center"
        }} onClick={() => setAuthModalOpen(false)}>
          <div style={{
            background: "#161622", borderRadius: "14px", width: "420px", maxWidth: "90%",
            padding: "24px", display: "flex", flexDirection: "column", border: "1px solid rgba(255,255,255,0.15)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.8)", gap: "16px"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "1.4rem" }}>🔐</span>
                <h3 style={{ margin: 0, fontSize: "1.15rem" }}>專屬加密保險箱</h3>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setAuthModalOpen(false)}>✕</button>
            </div>

            {/* Tab 切換 */}
            <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.1)", gap: "10px" }}>
              <button
                className="btn btn-sm"
                style={{
                  background: authTab === "login" ? "rgba(77,148,255,0.2)" : "transparent",
                  color: authTab === "login" ? "var(--accent-blue)" : "var(--text-muted)",
                  border: "none", borderBottom: authTab === "login" ? "2px solid var(--accent-blue)" : "none",
                  borderRadius: "4px 4px 0 0", padding: "8px 16px"
                }}
                onClick={() => { setAuthTab("login"); setAuthError(""); }}
              >
                🔑 登入解鎖
              </button>
              <button
                className="btn btn-sm"
                style={{
                  background: authTab === "register" ? "rgba(76,175,80,0.2)" : "transparent",
                  color: authTab === "register" ? "#4caf50" : "var(--text-muted)",
                  border: "none", borderBottom: authTab === "register" ? "2px solid #4caf50" : "none",
                  borderRadius: "4px 4px 0 0", padding: "8px 16px"
                }}
                onClick={() => { setAuthTab("register"); setAuthError(""); }}
              >
                ✨ 註冊新保險箱
              </button>
            </div>

            {authError && (
              <div style={{ background: "rgba(255,82,82,0.15)", border: "1px solid rgba(255,82,82,0.3)", borderRadius: "6px", padding: "8px 12px", color: "#ff8a80", fontSize: "0.85rem" }}>
                ⚠️ {authError}
              </div>
            )}

            <form onSubmit={authTab === "login" ? handleLogin : handleRegister} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                  使用者名稱
                </label>
                {authTab === "login" && vaultUsers.length > 0 ? (
                  <div style={{ display: "flex", gap: "6px" }}>
                    <input
                      type="text" className="input-field" placeholder="輸入或選擇使用者名稱"
                      value={authUsername} onChange={e => setAuthUsername(e.target.value)}
                      style={{ flex: 1 }} required
                    />
                    <select
                      className="select-field"
                      onChange={e => e.target.value && setAuthUsername(e.target.value)}
                      style={{ width: "120px", fontSize: "0.8rem" }}
                    >
                      <option value="">快速選擇...</option>
                      {vaultUsers.map(u => <option key={u.username} value={u.username}>{u.username}</option>)}
                    </select>
                  </div>
                ) : (
                  <input
                    type="text" className="input-field" placeholder="例如: 小李 / Alice"
                    value={authUsername} onChange={e => setAuthUsername(e.target.value)}
                    style={{ width: "100%" }} required
                  />
                )}
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                  保險箱密碼
                </label>
                <input
                  type="password" className="input-field" placeholder="請輸入解密密碼"
                  value={authPassword} onChange={e => setAuthPassword(e.target.value)}
                  style={{ width: "100%" }} required
                />
              </div>

              {authTab === "register" && (
                <div>
                  <label style={{ display: "block", fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                    確認密碼
                  </label>
                  <input
                    type="password" className="input-field" placeholder="再次輸入密碼以確認"
                    value={authPasswordConfirm} onChange={e => setAuthPasswordConfirm(e.target.value)}
                    style={{ width: "100%" }} required
                  />
                </div>
              )}

              <div style={{ display: "flex", gap: "8px", marginTop: "10px" }}>
                <button type="submit" className={`btn ${authTab === "login" ? "btn-primary" : "btn-success"}`} style={{ flex: 1 }} disabled={authLoading}>
                  {authLoading ? <span className="loading-spinner" /> : (authTab === "login" ? "🔓 解鎖保險箱" : "🚀 建立並加密")}
                </button>
                {authTab === "login" && (
                  <button type="button" className="btn btn-outline" onClick={handleFetchFromGitHub} disabled={authLoading} title="從 GitHub 雲端倉庫還原檔案">
                    ☁️ 雲端還原
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GitHub 雲端集中同步設定 Modal */}
      {githubModalOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)",
          zIndex: 10000, display: "flex", justifyContent: "center", alignItems: "center"
        }} onClick={() => setGithubModalOpen(false)}>
          <div style={{
            background: "#161622", borderRadius: "14px", width: "480px", maxWidth: "90%",
            padding: "24px", display: "flex", flexDirection: "column", border: "1px solid rgba(255,255,255,0.15)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.8)", gap: "14px"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "1.4rem" }}>☁️</span>
                <h3 style={{ margin: 0, fontSize: "1.15rem" }}>GitHub 雲端集中同步</h3>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setGithubModalOpen(false)}>✕</button>
            </div>

            <div style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
              將您的專屬投資組合以 <b>AES-256 高強度加密後存入 GitHub</b>。任何人在 GitHub 上只能看到亂碼，唯有持有您密碼的裝置才能解密。
            </div>

            {githubSyncMsg && (
              <div style={{
                background: githubSyncMsg.includes("✅") || githubSyncMsg.includes("🎉") ? "rgba(76,175,80,0.15)" : githubSyncMsg.includes("⏳") ? "rgba(77,148,255,0.15)" : "rgba(255,82,82,0.15)",
                border: `1px solid ${githubSyncMsg.includes("✅") || githubSyncMsg.includes("🎉") ? "rgba(76,175,80,0.3)" : githubSyncMsg.includes("⏳") ? "rgba(77,148,255,0.3)" : "rgba(255,82,82,0.3)"}`,
                borderRadius: "6px", padding: "10px 14px", fontSize: "0.85rem", color: "#fff", lineHeight: 1.4
              }}>
                {githubSyncMsg}
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {/* 如果目前尚未解鎖登入，讓使用者直接在此輸入身分 */}
              {!currentUser && (
                <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ fontSize: "0.8rem", color: "var(--accent-blue)", fontWeight: 600 }}>👤 保險箱使用者身份驗證：</div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <input
                      type="text" className="input-field" placeholder="使用者名稱 (例: 小李)"
                      value={modalUser} onChange={e => setModalUser(e.target.value)}
                      style={{ flex: 1, fontSize: "0.85rem" }}
                    />
                    <input
                      type="password" className="input-field" placeholder="保險箱解密密碼"
                      value={modalPass} onChange={e => setModalPass(e.target.value)}
                      style={{ flex: 1, fontSize: "0.85rem" }}
                    />
                  </div>
                </div>
              )}

              {currentUser && (
                <div style={{ fontSize: "0.85rem", color: "#4caf50" }}>
                  👤 目前保險箱身分：<b>【{currentUser}】(已解鎖)</b>
                </div>
              )}

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <label style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
                    GitHub Personal Access Token (PAT)
                  </label>
                  <a
                    href="https://github.com/settings/tokens/new?scopes=repo&description=StockT-Portfolio-Sync"
                    target="_blank" rel="noreferrer"
                    style={{ fontSize: "0.75rem", color: "var(--accent-blue)", textDecoration: "none" }}
                  >
                    🔗 點此前建立 Token
                  </a>
                </div>
                <input
                  type="password" className="input-field" placeholder="請貼上 ghp_xxxxxxxxxxxxxx"
                  value={githubConfig.token} onChange={e => setGithubConfig({ ...githubConfig, token: e.target.value })}
                  style={{ width: "100%" }}
                />
                <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>建立 Token 時請務必勾選 <code>repo</code> 完整存取權限</span>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: "4px" }}>
                  GitHub 倉庫名稱 (Repository)
                </label>
                <input
                  type="text" className="input-field" placeholder="例如: b8401121/StockT"
                  value={githubConfig.repo} onChange={e => setGithubConfig({ ...githubConfig, repo: e.target.value })}
                  style={{ width: "100%" }}
                />
              </div>

              <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={handleTestGitHub} disabled={githubSyncing} style={{ padding: "8px 12px" }}>
                  🔍 測試連線
                </button>
                <button type="button" className="btn btn-primary" onClick={handleSyncToGitHub} style={{ flex: 1 }} disabled={githubSyncing}>
                  {githubSyncing ? <span className="loading-spinner" /> : "🚀 立即備份至 GitHub"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
