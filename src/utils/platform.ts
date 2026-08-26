/**
 * Platform Compatibility Adapter (Tauri Desktop <-> Web / GitHub Pages)
 */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__)
  );
}

// 預設示範清單 (若 localStorage 為空時初始化使用)
const DEFAULT_WATCHLIST_DATA: Record<string, Array<{ symbol: string; date: string; price: number; shares: number; sell_price: number }>> = {
  "建造/資服/半導體": [
    { symbol: "2330.TW", date: "2026-05-13", price: 950.0, shares: 1000, sell_price: 0 },
    { symbol: "2454.TW", date: "2026-05-13", price: 1200.0, shares: 1000, sell_price: 0 },
    { symbol: "3030.TW", date: "2026-05-13", price: 318.5, shares: 1000, sell_price: 0 },
    { symbol: "3289.TWO", date: "2026-04-14", price: 0, shares: 0, sell_price: 0 },
    { symbol: "3416.TW", date: "2026-05-13", price: 0, shares: 0, sell_price: 0 },
    { symbol: "3563.TW", date: "2026-05-13", price: 0, shares: 0, sell_price: 0 },
  ],
  "ETF/指數基金": [
    { symbol: "0050.TW", date: "2026-05-13", price: 170.0, shares: 1000, sell_price: 0 },
    { symbol: "0056.TW", date: "2026-05-13", price: 38.5, shares: 2000, sell_price: 0 },
  ],
  "機械/電工/金融": [
    { symbol: "2308.TW", date: "2026-06-21", price: 350.0, shares: 1000, sell_price: 0 },
    { symbol: "2395.TW", date: "2026-05-13", price: 0, shares: 0, sell_price: 0 },
    { symbol: "2449.TW", date: "2026-05-13", price: 0, shares: 0, sell_price: 0 },
  ],
  "其他/小型股": [
    { symbol: "6419.TWO", date: "2026-05-14", price: 149.5, shares: 1000, sell_price: 0 },
    { symbol: "6146.TWO", date: "2026-05-14", price: 0, shares: 0, sell_price: 0 },
  ],
};

function getStoredWatchlistsIndex(): string[] {
  try {
    const raw = localStorage.getItem("stockt_watchlists_index");
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    }
  } catch (e) {
    console.warn(e);
  }
  return ["李山任的清單"];
}

function saveStoredWatchlistsIndex(lists: string[]) {
  try {
    localStorage.setItem("stockt_watchlists_index", JSON.stringify(lists));
  } catch (e) {
    console.warn(e);
  }
}

// 產生模擬/備用歷史 K 棒
function generateFallbackOhlcv(symbol: string, days = 250) {
  const list = [];
  const basePrice = symbol.includes("2330") ? 980 : symbol.includes("2454") ? 1220 : 100 + Math.random() * 80;
  let price = basePrice;
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000);
    const dateStr = d.toISOString().split("T")[0];
    const change = (Math.random() - 0.48) * (price * 0.03);
    const open = price;
    price = Math.max(1, price + change);
    const high = Math.max(open, price) + Math.random() * (price * 0.015);
    const low = Math.min(open, price) - Math.random() * (price * 0.015);
    const volume = Math.floor(1000000 + Math.random() * 5000000);
    list.push({
      date: dateStr,
      open,
      high,
      low,
      close: price,
      volume,
    });
  }
  return list;
}

/**
 * 跨平台 invoke 調度函式
 */
export async function invoke<T = any>(cmd: string, args: Record<string, any> = {}): Promise<T> {
  if (isTauri()) {
    return tauriInvoke<T>(cmd, args);
  }

  // ─── Web Fallback 邏輯 ───────────────────────────────────────────────
  switch (cmd) {
    case "get_stock_list": {
      try {
        const res = await fetch("./taiwan_stocks.json");
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) return list as unknown as T;
        }
      } catch {
        // ignore
      }
      return [
        { symbol: "2330.TW", name: "台積電" },
        { symbol: "2317.TW", name: "鴻海" },
        { symbol: "2454.TW", name: "聯發科" },
        { symbol: "2308.TW", name: "台達電" },
        { symbol: "0050.TW", name: "元大台灣50" },
        { symbol: "0056.TW", name: "元大高股息" },
        { symbol: "3030.TW", name: "德律" },
        { symbol: "3289.TWO", name: "宜特" },
        { symbol: "3416.TW", name: "融程電" },
        { symbol: "3563.TW", name: "牧德" },
        { symbol: "6419.TWO", name: "京晨科" },
        { symbol: "6146.TWO", name: "頎邦" },
      ] as unknown as T;
    }

    case "update_stock_list": {
      return { status: "ok", count: 2000 } as unknown as T;
    }

    case "open_url": {
      if (args?.url) {
        window.open(args.url, "_blank");
      }
      return undefined as unknown as T;
    }

    case "list_watchlists": {
      return getStoredWatchlistsIndex() as unknown as T;
    }

    case "load_watchlist": {
      const filename = args?.filename || "李山任的清單";
      const key = `stockt_watchlist_${filename}`;
      const raw = localStorage.getItem(key);
      if (raw) {
        try {
          return JSON.parse(raw) as T;
        } catch {
          // ignore
        }
      }
      if (filename === "李山任的清單" || filename === "watchlist") {
        localStorage.setItem(key, JSON.stringify(DEFAULT_WATCHLIST_DATA));
        return DEFAULT_WATCHLIST_DATA as unknown as T;
      }
      return {} as unknown as T;
    }

    case "save_watchlist": {
      const filename = args?.filename || "李山任的清單";
      const key = `stockt_watchlist_${filename}`;
      localStorage.setItem(key, JSON.stringify(args?.data || {}));
      const idx = getStoredWatchlistsIndex();
      if (!idx.includes(filename)) {
        idx.push(filename);
        saveStoredWatchlistsIndex(idx);
      }
      return undefined as unknown as T;
    }

    case "delete_watchlist": {
      const filename = args?.filename;
      if (filename) {
        localStorage.removeItem(`stockt_watchlist_${filename}`);
        const idx = getStoredWatchlistsIndex().filter((x) => x !== filename);
        saveStoredWatchlistsIndex(idx.length > 0 ? idx : ["李山任的清單"]);
      }
      return undefined as unknown as T;
    }

    case "get_category_by_symbol": {
      const sym = (args?.symbol || "").split(".")[0];
      if (sym.startsWith("00")) return "ETF/指數基金" as unknown as T;
      const num = parseInt(sym, 10);
      if (num >= 1100 && num <= 1699) return "水泥/食品/紡織" as unknown as T;
      if (num >= 1700 && num <= 1999) return "化學/玻璃/鋼鐵" as unknown as T;
      if (num >= 2000 && num <= 2999) return "機械/電工/金融" as unknown as T;
      if (num >= 3000 && num <= 3699) return "半導體/建造/資服" as unknown as T;
      if (num >= 3700 && num <= 3899) return "光電/網路/通信" as unknown as T;
      if (num >= 4100 && num <= 4999) return "電子零組件" as unknown as T;
      if (num >= 5000 && num <= 5999) return "服務/觀光/貿易" as unknown as T;
      if (num >= 6000 && num <= 6999) return "其他/小型股" as unknown as T;
      if (num >= 8000 && num <= 9999) return "生技/其他" as unknown as T;
      return "自選/其他" as unknown as T;
    }

    case "calculate_tw_pnl": {
      const symbol = args.symbol || "";
      const buyPrice = args.buy_price || 0;
      const currentPrice = args.current_price || 0;
      const shares = args.shares || 0;
      const feeDiscount = args.fee_discount ?? 0.6;

      if (buyPrice <= 0 || shares <= 0 || currentPrice <= 0) {
        return {
          net_cost: 0,
          net_market_value: 0,
          pnl: 0,
          pnl_pct: 0,
          buy_fee: 0,
          sell_fee: 0,
          tax: 0,
        } as unknown as T;
      }

      const rawCost = buyPrice * shares;
      const rawValue = currentPrice * shares;
      const cleanSym = symbol.split(".")[0];
      const isTw = symbol.endsWith(".TW") || symbol.endsWith(".TWO") || /^\d+$/.test(cleanSym);

      if (!isTw) {
        const pnl = rawValue - rawCost;
        const pnlPct = rawCost > 0 ? (pnl / rawCost) * 100 : 0;
        return {
          net_cost: rawCost,
          net_market_value: rawValue,
          pnl,
          pnl_pct: pnlPct,
          buy_fee: 0,
          sell_fee: 0,
          tax: 0,
        } as unknown as T;
      }

      let buyFee = feeDiscount === 0 ? 0 : Math.floor(rawCost * 0.001425 * feeDiscount);
      if (buyFee < 20 && rawCost > 0 && feeDiscount > 0) buyFee = 20;

      let sellFee = feeDiscount === 0 ? 0 : Math.floor(rawValue * 0.001425 * feeDiscount);
      if (sellFee < 20 && rawValue > 0 && feeDiscount > 0) sellFee = 20;

      const isEtf = cleanSym.startsWith("00");
      const taxRate = isEtf ? 0.001 : 0.003;
      const tax = Math.floor(rawValue * taxRate);

      const netCost = rawCost + buyFee;
      const netMarketValue = rawValue - sellFee - tax;
      const pnl = netMarketValue - netCost;
      const pnlPct = netCost > 0 ? (pnl / netCost) * 100 : 0;

      return {
        net_cost: netCost,
        net_market_value: netMarketValue,
        pnl,
        pnl_pct: pnlPct,
        buy_fee: buyFee,
        sell_fee: sellFee,
        tax,
      } as unknown as T;
    }

    case "export_txt_file": {
      const filename = args?.filename || "export.html";
      const content = args?.content || "";
      const blob = new Blob([content], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return filename as unknown as T;
    }

    case "fetch_stock_data": {
      const symbol = args.symbol || "2330.TW";
      try {
        const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`;
        const res = await fetch(proxyUrl, { cache: "no-cache" });
        if (res.ok) {
          const json = await res.json();
          const result = json?.chart?.result?.[0];
          if (result) {
            const meta = result.meta || {};
            const quote = result.indicators?.quote?.[0] || {};
            const timestamps: number[] = result.timestamp || [];
            const opens: number[] = quote.open || [];
            const highs: number[] = quote.high || [];
            const lows: number[] = quote.low || [];
            const closes: number[] = quote.close || [];
            const volumes: number[] = quote.volume || [];

            const ohlcv = [];
            for (let i = 0; i < timestamps.length; i++) {
              if (closes[i] !== null && closes[i] !== undefined) {
                const d = new Date(timestamps[i] * 1000);
                ohlcv.push({
                  date: d.toISOString().split("T")[0],
                  open: opens[i] ?? closes[i],
                  high: highs[i] ?? closes[i],
                  low: lows[i] ?? closes[i],
                  close: closes[i],
                  volume: volumes[i] ?? 0,
                });
              }
            }

            if (ohlcv.length > 0) {
              const last = ohlcv[ohlcv.length - 1];
              const prevClose = meta.chartPreviousClose || meta.previousClose || (ohlcv.length > 1 ? ohlcv[ohlcv.length - 2].close : last.close);
              const change = last.close - prevClose;
              const changePct = prevClose ? (change / prevClose) * 100 : 0;

              return {
                symbol,
                name: symbol,
                current_price: last.close,
                previous_close: prevClose,
                change,
                change_percent: changePct,
                volume: last.volume,
                currency: meta.currency || "TWD",
                market_cap: null,
                pe_ratio: null,
                pb_ratio: null,
                dividend_yield: null,
                fifty_two_week_high: meta.fiftyTwoWeekHigh || null,
                fifty_two_week_low: meta.fiftyTwoWeekLow || null,
                data: ohlcv,
              } as unknown as T;
            }
          }
        }
      } catch (err) {
        console.warn("Proxy fetch failed, using fallback data for web:", err);
      }

      // Fallback data
      const data = generateFallbackOhlcv(symbol);
      const last = data[data.length - 1];
      const prev = data[data.length - 2];
      return {
        symbol,
        name: symbol,
        current_price: last.close,
        previous_close: prev.close,
        change: last.close - prev.close,
        change_percent: ((last.close - prev.close) / prev.close) * 100,
        volume: last.volume,
        currency: "TWD",
        market_cap: null,
        pe_ratio: 18.5,
        pb_ratio: 2.1,
        dividend_yield: 3.5,
        fifty_two_week_high: last.close * 1.2,
        fifty_two_week_low: last.close * 0.8,
        data,
      } as unknown as T;
    }

    case "fetch_tw_fundamentals":
    case "fetch_detailed_fundamentals": {
      return {
        symbol: args.symbol || "",
        roe: 18.5,
        roa: 12.0,
        gross_margin: 52.4,
        operating_margin: 41.2,
        net_profit_margin: 38.6,
        eps: 38.5,
        pe_ratio: 22.4,
        pb_ratio: 4.8,
        debt_to_equity: 42.1,
        current_ratio: 210.0,
        quick_ratio: 180.0,
        dividend_yield: 2.8,
        fcf: 250000000,
      } as unknown as T;
    }

    case "fetch_batch_stock_data":
    case "fetch_batch_stock_data_full": {
      const symbols: string[] = args.symbols || [];
      const results: Record<string, any> = {};
      for (const s of symbols) {
        const dummyOhlcv = generateFallbackOhlcv(s, 60);
        const last = dummyOhlcv[dummyOhlcv.length - 1];
        const prev = dummyOhlcv[dummyOhlcv.length - 2];
        results[s] = {
          symbol: s,
          name: s,
          current_price: last.close,
          previous_close: prev.close,
          change: last.close - prev.close,
          change_percent: ((last.close - prev.close) / prev.close) * 100,
          volume: last.volume,
          currency: "TWD",
          data: dummyOhlcv,
        };
      }
      return results as unknown as T;
    }

    case "fetch_news": {
      return [] as unknown as T;
    }

    default:
      console.warn(`[Web Adapter] Unhandled command: ${cmd}`, args);
      return null as unknown as T;
  }
}

/**
 * 跨平台全螢幕控制
 */
export async function toggleFullscreen(): Promise<boolean> {
  if (isTauri()) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      const isFull = await win.isFullscreen();
      const nextFull = !isFull;
      await win.setFullscreen(nextFull);
      await win.setDecorations(!nextFull);
      return nextFull;
    } catch (e) {
      console.error("Tauri fullscreen error:", e);
      return false;
    }
  }

  // Web Fullscreen API
  try {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
      return true;
    } else {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
      return false;
    }
  } catch (e) {
    console.error("Web fullscreen error:", e);
    return false;
  }
}
