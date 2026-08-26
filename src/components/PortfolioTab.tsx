import React, { useCallback, useEffect, useState, useRef } from "react";
import { invoke } from "../utils/platform";
import { calculateAllIndicators, OhlcvData } from "../utils/indicators";
import { calcTechScanScore, checkLandmineRisks, computeFundamentalScore, getFsGrade, getTechRating } from "../utils/analysis";
import { getCachedStocks, subscribeStocks, StockEntry } from "../utils/stocks";
import { exportToHtmlFile } from "../utils/exportHtml";
import {
  saveUserVault,
  loadUserVault,
  getGitHubSyncConfig,
  saveGitHubSyncConfig,
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

  const [currentUser, setCurrentUser] = useState<string | null>(() => sessionStorage.getItem("stockt_auth_user"));
  const [currentPassword, setCurrentPassword] = useState<string | null>(() => sessionStorage.getItem("stockt_auth_pass"));

  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [githubConfig, setGithubConfig] = useState<GitHubSyncConfig>(() => getGitHubSyncConfig() || { token: "", repo: "b8401121/StockT", branch: "main" });
  const [githubSyncing, setGithubSyncing] = useState(false);
  const [githubSyncMsg, setGithubSyncMsg] = useState("");

  const [stocks, setStocks] = useState<StockEntry[]>([]);
  useEffect(() => {
    return subscribeStocks(setStocks);
  }, []);

  useEffect(() => {
    const checkAuth = () => {
      const u = sessionStorage.getItem("stockt_auth_user");
      const p = sessionStorage.getItem("stockt_auth_pass");
      setCurrentUser(u);
      setCurrentPassword(p);
    };
    checkAuth();
  }, []);

  const getNormalizedSymbol = useCallback((sym: string, stockList: StockEntry[] = stocks): string => {
    const targetSym = sym.trim().toUpperCase();
    const pureSym = targetSym.split(".")[0];
    
    if (stockList.length > 0) {
      const match = stockList.find(s => s.symbol.split(".")[0] === pureSym);
      if (match) return match.symbol;
    }
    const cached = getCachedStocks();
    const cachedMatch = cached.find(s => s.symbol.split(".")[0] === pureSym);
    if (cachedMatch) return cachedMatch.symbol;
    
    if (!targetSym.includes(".")) {
      if (/^\d+$/.test(targetSym)) return targetSym + ".TW";
    }
    return targetSym;
  }, [stocks]);

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

  const [scanningLandmines, setScanningLandmines] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [landmineResults, setLandmineResults] = useState<{symbol:string, name:string, score:number, techRisks:string[], fundRisks:string[], fundScore?:number, compositeScore?:number}[] | null>(null);
  const cancelRef = useRef(false);

  const loadPortfolio = useCallback(async () => {
    const u = currentUser || sessionStorage.getItem("stockt_auth_user");
    const p = currentPassword || sessionStorage.getItem("stockt_auth_pass");

    if (u && p) {
      try {
        const { data } = await loadUserVault(u, p, true);
        const cached = getCachedStocks();
        setWatchlist(data);
        setRows(generateOfflineRows(data, cached));
        await refreshPrices(data);
        return;
      } catch (err) {
        console.warn("User vault load error:", err);
      }
    } else {
      try {
        const data: Record<string, PortfolioEntry[]> = await invoke("load_watchlist", { filename: "我的自選股" });
        const cached = getCachedStocks();
        setWatchlist(data);
        setRows(generateOfflineRows(data, cached));
        await refreshPrices(data);
      } catch {
        setWatchlist({});
        setRows([]);
      }
    }
  }, [currentUser, currentPassword]);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

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
  }, [deductFees, feeDiscount]);

  useEffect(() => {
    if (rows.length > 0) {
      recalculatePnLsForRows(rows);
    }
  }, [deductFees, feeDiscount]);

  const refreshPrices = useCallback(async (targetWatchlist?: Record<string, PortfolioEntry[]>) => {
    const listToFetch = targetWatchlist || watchlist;
    const symbols = Array.from(new Set(Object.values(listToFetch).flat().map((e) => e.symbol)));
    if (!symbols.length) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const dataList: any[] = await invoke("fetch_batch_stock_data_full", { symbols, range: "1y" });
      const dataMap = new Map<string, any>();
      for (const d of dataList) {
        if (d && d.info && d.info.symbol) {
          dataMap.set(d.info.symbol, d);
          dataMap.set(d.info.symbol.split(".")[0], d);
        }
      }

      const cached = getCachedStocks();
      const stockMap = new Map(cached.map(s => [s.symbol, s.name]));

      const entriesList: { cat: string; entry: PortfolioEntry; idx: number }[] = [];
      for (const [cat, items] of Object.entries(listToFetch)) {
        items.forEach((entry, idx) => {
          entriesList.push({ cat, entry, idx });
        });
      }

      const allRows: PortfolioRow[] = await Promise.all(entriesList.map(async ({ cat, entry, idx }) => {
        const d = dataMap.get(entry.symbol) || dataMap.get(entry.symbol.split(".")[0]);
        let currentPrice = 0;
        let name = stockMap.get(entry.symbol) || "";
        if (!name) {
          const pureSym = entry.symbol.split(".")[0].toUpperCase();
          const match = cached.find(s => s.symbol.split(".")[0] === pureSym);
          name = match ? match.name : (d?.info?.name || entry.symbol);
        }
        let date_high_low = "-";
        let suggestion = "-";
        let tech_score = 0;
        let fs_grade = "N/A";
        let fs_score = 0;

        if (d) {
          currentPrice = d.info?.current_price ?? 0;
          if (d.ohlcv) {
            const ind = calculateAllIndicators(d.ohlcv);
            const n = d.ohlcv.close.length - 1;
            const scanRes = calcTechScanScore(ind, n);
            tech_score = scanRes.score;
            suggestion = getTechRating(scanRes.score);
            
            if (entry.date) {
              const targetDate = entry.date.replace(/-/g, "");
              const ts = d.ohlcv.timestamp;
              let matchIdx = -1;
              for (let i = 0; i < ts.length; i++) {
                const dateStr = new Date(ts[i] * 1000).toISOString().slice(0, 10).replace(/-/g, "");
                if (dateStr >= targetDate) {
                  matchIdx = i;
                  break;
                }
              }
              if (matchIdx !== -1) {
                const h = d.ohlcv.high[matchIdx];
                const l = d.ohlcv.low[matchIdx];
                if (h && l) date_high_low = `${l.toFixed(2)} ~ ${h.toFixed(2)}`;
              }
            }
          }
          if (d.info) {
            const fs = computeFundamentalScore(d.info);
            fs_score = fs.score;
            fs_grade = getFsGrade(fs.score);
          }
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
      console.error("refreshPrices error:", e);
    } finally {
      setLoading(false);
    }
  }, [feeDiscount, deductFees, watchlist]);

  const saveWatchlistData = async (data: Record<string, PortfolioEntry[]>, shouldRefresh = false) => {
    const u = currentUser || sessionStorage.getItem("stockt_auth_user");
    const p = currentPassword || sessionStorage.getItem("stockt_auth_pass");

    if (u && p) {
      await saveUserVault(u, p, data, true);
    } else {
      await invoke("save_watchlist", { watchlist: data, filename: "我的自選股" });
    }

    setWatchlist(data);
    if (shouldRefresh) {
      await refreshPrices(data);
    } else {
      setRows(generateOfflineRows(data));
    }
  };

  const addEntry = async () => {
    const targetSym = addSym.trim().toUpperCase();
    if (!targetSym) {
      alert("請輸入股票代碼 (例如: 2330 或 3217)");
      return;
    }

    const sym = getNormalizedSymbol(targetSym);

    let existingCat = "";
    for (const [catName, items] of Object.entries(watchlist)) {
      if (items.some((it) => it.symbol === sym)) {
        existingCat = catName;
        break;
      }
    }

    if (existingCat) {
      if (!window.confirm(`「${sym}」已經存在於【${existingCat}】中。\n您要追加一筆新的買入紀錄嗎？`)) {
        return;
      }
    }

    const cat = addCat.trim() === "未分類" || !addCat.trim() ? await getCategoryBySym(sym) : addCat.trim();
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

    await saveWatchlistData(newList, true);
    setAddSym("");
    setAddCat("未分類");
  };

  const removeEntry = async (cat: string, idx: number) => {
    if (!window.confirm(`確定要從【${cat}】移除此筆紀錄嗎？`)) {
      return;
    }
    const newList = { ...watchlist };
    newList[cat] = newList[cat].filter((_, i) => i !== idx);
    if (!newList[cat].length) delete newList[cat];
    await saveWatchlistData(newList, true);
  };

  const clearAllHoldings = async () => {
    if (!window.confirm("確定要清空您的所有自選股持倉嗎？此動作將移除所有股票紀錄。")) {
      return;
    }
    const emptyList = {};
    await saveWatchlistData(emptyList, false);
    setWatchlist({});
    setRows([]);
    alert("✅ 您的專屬自選股已全部清空！");
  };

  const handleInputChange = (cat: string, idx: number, field: keyof PortfolioEntry, value: string) => {
    const entry = { ...watchlist[cat][idx] };
    if (field === "price" || field === "shares" || field === "sell_price") {
      entry[field] = parseFloat(value) || 0;
    } else {
      (entry as any)[field] = value;
    }

    const updatedWatchlist = { ...watchlist };
    updatedWatchlist[cat][idx] = entry;
    setWatchlist(updatedWatchlist);

    const newRows = rows.map((row) => {
      if (row.category === cat && row.origIdx === idx) {
        const updatedRow = { ...row, [field]: entry[field] };
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
    await saveWatchlistData(watchlist, false);
    await recalculatePnLsForRows(rows);
  };

  const handleManualSyncToGitHub = async () => {
    if (!currentUser || !currentPassword) {
      alert("請先登入個人帳號！");
      return;
    }
    if (!githubConfig.token.trim()) {
      setGithubModalOpen(true);
      return;
    }

    setGithubSyncing(true);
    setGithubSyncMsg("⏳ 正在加密並推送至 GitHub...");
    try {
      saveGitHubSyncConfig(githubConfig);
      await saveUserVault(currentUser, currentPassword, watchlist, true);
      setGithubSyncMsg(`🎉 成功同步！已安全加密並推送至【${githubConfig.repo.trim()}/vaults/${currentUser}.vault.json】！`);
      setTimeout(() => {
        setGithubModalOpen(false);
        setGithubSyncMsg("");
      }, 2500);
    } catch (err: any) {
      setGithubSyncMsg(`❌ 同步失敗: ${err.message || err}`);
    } finally {
      setGithubSyncing(false);
    }
  };

  const exportTxt = async () => {
    try {
      const title = `股市自選分享名單 (${currentUser ? currentUser + " 的專屬組合" : "自選股"})`;
      const filename = `share_${currentUser || "watchlist"}.html`;
      const htmlContent = await exportToHtmlFile(title, rows, "portfolio");
      const savedPath = await invoke("export_txt_file", { filename, content: htmlContent });
      alert(`分享名單匯出成功！已產生精美網頁檔案！\n已儲存至您的【下載】資料夾：\n${savedPath}`);
    } catch (err) {
      alert(`匯出失敗: ${err}`);
    }
  };

  const exportVaultBackup = async () => {
    if (!currentUser) {
      alert("請先登入個人專屬保險箱！");
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

          const allRisks = checkLandmineRisks(ind, data.info, n);
          const lmTechRisks = allRisks.filter(r =>
            r.startsWith("📉") || r.startsWith("😱") || r.startsWith("🧨") || r.startsWith("🌪️")
          );
          const lmFundRisks = allRisks.filter(r =>
            r.startsWith("💸") || r.startsWith("📛") || r.startsWith("🔴") ||
            r.startsWith("🩸") || r.startsWith("💧") || r.startsWith("💦") ||
            r.startsWith("🏗️") || r.startsWith("📊")
          );

          const fsResult = computeFundamentalScore(data.info);
          const fsScore = fsResult.score;
          if (fsScore <= -2) {
            const failedItems = fsResult.failed.map(([label]) => label);
            const fsDesc = `⚠️ 基本面評級：${getFsGrade(fsScore)}(分數:${fsScore})${failedItems.length ? `，異常：${failedItems.join("、")}` : ""}`;
            if (!lmFundRisks.includes(fsDesc)) lmFundRisks.push(fsDesc);
          }

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

    results.sort((a, b) => (a.compositeScore ?? 0) - (b.compositeScore ?? 0));
    setScanProgress(100);
    setScanningLandmines(false);
    setLandmineResults(results);
  };

  const totalCost = rows.reduce((acc, r) => acc + r.net_cost, 0);
  const totalPnl = rows.reduce((acc, r) => acc + r.pnl, 0);
  const totalPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  return (
    <div className="portfolio-layout">
      {/* 頂部身分與 GitHub 雲端同步列 */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: "14px", padding: "12px 16px",
        background: currentUser ? "rgba(77, 148, 255, 0.08)" : "rgba(255, 255, 255, 0.03)",
        border: `1px solid ${currentUser ? "rgba(77, 148, 255, 0.3)" : "rgba(255, 255, 255, 0.08)"}`,
        borderRadius: "10px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "1.3rem" }}>{currentUser ? "🛡️" : "👤"}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "1rem", color: currentUser ? "var(--accent-blue)" : "var(--text-primary)" }}>
              {currentUser ? `【${currentUser}】的專屬加密自選股` : "訪客自選股 (未登入)"}
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              {currentUser ? "持股資料已使用 AES-256 加密儲存，並自動同步至 GitHub 倉庫。" : "不同使用者互相隔離，請由頂部登入您的個人帳號。"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {currentUser && (
            <>
              <button className="btn btn-outline btn-sm" onClick={() => setGithubModalOpen(true)} style={{ color: "#4caf50", borderColor: "rgba(76,175,80,0.4)" }}>
                ☁️ GitHub 雲端同步設定
              </button>
              <button className="btn btn-outline btn-sm" onClick={exportVaultBackup} title="匯出本機 AES-256 加密存檔">
                📤 匯出加密備份
              </button>
            </>
          )}
          <button className="btn btn-outline btn-sm" onClick={clearAllHoldings} style={{ color: "#ff8a80", borderColor: "rgba(255,82,82,0.3)" }}>
            🧹 一鍵清空持股
          </button>
        </div>
      </div>

      {/* 交易成本設定 */}
      <div style={{ display: "flex", gap: "15px", alignItems: "center", marginBottom: "14px", padding: "8px 12px", background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: "8px", fontSize: "0.85rem" }}>
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
        <input
          className="input-field"
          value={addSym}
          onChange={(e) => setAddSym(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addEntry()}
          placeholder="股票代碼 (例: 2330 / 3217)"
          style={{ width: "160px" }}
        />
        <input
          className="input-field"
          value={addCat}
          onChange={(e) => setAddCat(e.target.value)}
          placeholder="分類名稱 (可留空自動分類)"
          style={{ width: "180px" }}
        />
        <button className="btn btn-success" onClick={addEntry}>
          ➕ 新增持倉
        </button>
        <button className="btn btn-primary" onClick={() => refreshPrices()} disabled={loading || scanningLandmines}>
          {loading ? <span className="loading-spinner" /> : "🔄 刷新報價"}
        </button>
        <button className="btn btn-warning" onClick={scanLandmines} disabled={scanningLandmines || loading}>
          {scanningLandmines ? `💣 掃描中 ${scanProgress}%` : "🚨 掃描自選地雷"}
        </button>
        <button className="btn btn-outline" onClick={exportTxt}>
          📤 匯出分享名單
        </button>

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
          <div className="empty-state" style={{ height: "100%", padding: "60px 20px" }}>
            <div className="empty-icon" style={{ fontSize: "3rem", marginBottom: "12px" }}>💼</div>
            <div className="empty-text" style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "6px" }}>
              {currentUser ? `【${currentUser}】目前尚無持股紀錄` : "目前尚無自選股紀錄"}
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
              請於上方輸入股票代碼（例如 <b>2330</b> 或 <b>3217</b>）並點擊「➕ 新增持倉」，或在「個股分析」頁面點擊「⭐ 加入自選股」！
            </div>
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
                          fontWeight: 700,
                          fontSize: "0.82rem",
                          color: row.fs_score >= 4 ? "var(--accent-red)" : row.fs_score <= -2 ? "var(--accent-green)" : "var(--text-primary)"
                        }}>
                          {row.fs_grade}
                        </span>
                        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                          ({row.fs_score > 0 ? "+" : ""}{row.fs_score}分)
                        </span>
                      </span>
                    ) : "-"}
                  </td>
                  <td>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button className="btn btn-outline btn-sm" onClick={() => onAnalyze?.(row.symbol)}>分析</button>
                      <button className="btn btn-danger btn-sm" onClick={() => removeEntry(row.category, row.origIdx)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* GitHub 同步 Modal */}
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
                <h3 style={{ margin: 0, fontSize: "1.15rem" }}>GitHub 跨裝置雲端同步</h3>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setGithubModalOpen(false)}>✕</button>
            </div>

            <div style={{ fontSize: "0.82rem", color: "rgba(255,255,255,0.7)", lineHeight: 1.5 }}>
              將【<b>{currentUser}</b>】的專屬自選股以 <b>AES-256 高強度加密存入 GitHub</b>。在其他電腦只要輸入同一個帳號密碼，就能自動下載還原！
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
                    🔗 點此前往建立 Token
                  </a>
                </div>
                <input
                  type="password" className="input-field" placeholder="請貼上 ghp_xxxxxxxxxxxxxx"
                  value={githubConfig.token} onChange={e => setGithubConfig({ ...githubConfig, token: e.target.value })}
                  style={{ width: "100%" }}
                />
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
                <button type="button" className="btn btn-primary" onClick={handleManualSyncToGitHub} style={{ flex: 1 }} disabled={githubSyncing}>
                  {githubSyncing ? <span className="loading-spinner" /> : "🚀 立即備份並同步至 GitHub"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
    </div>
  );
};
