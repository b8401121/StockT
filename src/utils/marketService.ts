import { isTauri } from "./platform";
import { invoke as tauriInvoke } from "@tauri-apps/api/core";

export interface MarketIndexMeta {
  symbol: string;
  name: string;
  category: "tw" | "us" | "asia" | "europe" | "macro";
  flag: string;
  description?: string;
  currency?: string;
  isRateOrVix?: boolean;
}

export interface MarketIndexQuote {
  symbol: string;
  name: string;
  category: "tw" | "us" | "asia" | "europe" | "macro";
  flag: string;
  price: number;
  previousClose: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  open: number;
  sparkline: number[];
  updatedAt: string;
  isRateOrVix?: boolean;
  status?: "live" | "cached" | "error";
}

export interface IndexHistoryData {
  timestamp: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export const GLOBAL_INDICES: MarketIndexMeta[] = [
  // 🇹🇼 台灣市場
  { symbol: "^TWII", name: "加權指數 (TAIEX)", category: "tw", flag: "🇹🇼", description: "台灣證券交易所發行量加權股價指數" },
  { symbol: "^TWOII", name: "櫃買指數 (TPEx)", category: "tw", flag: "🇹🇼", description: "台灣證券櫃檯買賣中心指數" },
  { symbol: "TSM", name: "台積電 ADR (TSMC)", category: "tw", flag: "🇹🇼", description: "台積電美股存託憑證 (台股重要先行指標)", currency: "USD" },
  
  // 🇺🇸 美國市場
  { symbol: "^GSPC", name: "標普 500 (S&P 500)", category: "us", flag: "🇺🇸", description: "美股大盤最具代表性之五百大企業指數" },
  { symbol: "^SOX", name: "費城半導體 (SOX)", category: "us", flag: "🇺🇸", description: "半導體產業晴雨表 (與台股高度連動)" },
  { symbol: "^IXIC", name: "那斯達克 (Nasdaq)", category: "us", flag: "🇺🇸", description: "科技股風向標指數" },
  { symbol: "^DJI", name: "道瓊工業 (Dow Jones)", category: "us", flag: "🇺🇸", description: "美股三十大藍籌工業股指數" },
  
  // 宏觀 / 風險指標
  { symbol: "^VIX", name: "恐慌指數 (VIX)", category: "macro", flag: "⚠️", description: "S&P 500 波動率指數 (<20 安全, >30 恐慌)", isRateOrVix: true },
  { symbol: "^TNX", name: "美國 10 年期公債殖利率", category: "macro", flag: "💵", description: "全球無風險利率與資金成本之基準錨", isRateOrVix: true },

  // 🌏 亞太市場
  { symbol: "^N225", name: "日經 225 (Nikkei)", category: "asia", flag: "🇯🇵", description: "日本東京證券交易所旗艦指數" },
  { symbol: "^KS11", name: "韓國綜合 (KOSPI)", category: "asia", flag: "🇰🇷", description: "韓國主要證券市場綜合指數" },
  { symbol: "^HSI", name: "香港恆生 (Hang Seng)", category: "asia", flag: "🇭🇰", description: "香港股市核心藍籌股代表指數" },
  { symbol: "000001.SS", name: "上證指數 (SSE)", category: "asia", flag: "🇨🇳", description: "上海證券交易所綜合股價指數" },

  // 🌍 歐洲市場
  { symbol: "^FTSE", name: "英國富時 100 (FTSE)", category: "europe", flag: "🇬🇧", description: "倫敦證券交易所百大企業代表指數" },
  { symbol: "^GDAXI", name: "德國 DAX 指數", category: "europe", flag: "🇩🇪", description: "法蘭克福證券交易所前四十大績優股" },
  { symbol: "^FCHI", name: "法國 CAC 40", category: "europe", flag: "🇫🇷", description: "巴黎泛歐交易所旗艦指數" },
];

function extractNum(m: any): number | null {
  if (m == null) return null;
  if (typeof m === "number") return isNaN(m) ? null : m;
  if (typeof m === "object" && "value" in m) {
    const v = m.value;
    return typeof v === "number" && !isNaN(v) ? v : null;
  }
  const n = Number(m);
  return isNaN(n) ? null : n;
}

const CACHED_INDEX_QUOTES = new Map<string, MarketIndexQuote>();

export async function fetchMarketIndices(): Promise<MarketIndexQuote[]> {
  // 1. 若在 Tauri 桌面端，直接呼叫 Rust 後端高效能平行批次抓取 (單一 IPC 通訊)
  if (isTauri()) {
    try {
      const items = await tauriInvoke<Array<{
        symbol: string;
        price: number;
        previous_close: number;
        change: number;
        change_pct: number;
        high: number;
        low: number;
        open: number;
        sparkline: number[];
      }>>("fetch_market_overview");

      if (Array.isArray(items) && items.length > 0) {
        const itemMap = new Map(items.map((it) => [it.symbol, it]));
        const timeStr = new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

        return GLOBAL_INDICES.map((meta) => {
          const found = itemMap.get(meta.symbol);
          if (found && found.price > 0) {
            const q: MarketIndexQuote = {
              symbol: meta.symbol,
              name: meta.name,
              category: meta.category,
              flag: meta.flag,
              price: found.price,
              previousClose: found.previous_close,
              change: found.change,
              changePct: found.change_pct,
              high: found.high,
              low: found.low,
              open: found.open,
              sparkline: found.sparkline,
              updatedAt: timeStr,
              isRateOrVix: meta.isRateOrVix,
              status: "live",
            };
            CACHED_INDEX_QUOTES.set(meta.symbol, q);
            return q;
          }
          return CACHED_INDEX_QUOTES.get(meta.symbol) || getEmptyErrorQuote(meta);
        });
      }
    } catch (e) {
      console.warn("[MarketService] tauri fetch_market_overview failed:", e);
    }
  }

  // 2. Web 瀏覽器端：使用受控並發隊列 (一次最多 3 檔並行，防止代理伺服器觸發 429 速率限制)
  const results: MarketIndexQuote[] = [];
  const chunkSize = 3;
  for (let i = 0; i < GLOBAL_INDICES.length; i += chunkSize) {
    const chunk = GLOBAL_INDICES.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map(async (meta) => {
        try {
          const q = await fetchSingleIndexQuote(meta);
          if (q && q.price > 0) {
            CACHED_INDEX_QUOTES.set(meta.symbol, q);
            return q;
          }
        } catch (e) {
          console.warn(`[MarketService] Failed to fetch ${meta.symbol}:`, e);
        }
        return CACHED_INDEX_QUOTES.get(meta.symbol) || getEmptyErrorQuote(meta);
      })
    );
    results.push(...chunkResults);
    if (i + chunkSize < GLOBAL_INDICES.length) {
      await new Promise((res) => setTimeout(res, 80));
    }
  }

  return results;
}

async function fetchSingleIndexQuote(meta: MarketIndexMeta): Promise<MarketIndexQuote> {
  const symbol = meta.symbol;

  // 1. Tauri 桌面端：調用 Rust 後端（無 CORS 限制，直連 Yahoo Finance）
  if (isTauri()) {
    try {
      const res = await tauriInvoke<{
        ohlcv: { timestamp: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] };
        info: { current_price?: any; previous_close?: any };
      }>("fetch_stock_data", { symbol, range: "1mo" });

      if (res && res.ohlcv && res.ohlcv.close.length > 0) {
        const closes = res.ohlcv.close.filter((c) => typeof c === "number" && !isNaN(c) && c > 0);
        const len = closes.length;
        
        const priceFromInfo = extractNum(res.info?.current_price);
        const prevFromInfo = extractNum(res.info?.previous_close);
        
        const currentPrice = priceFromInfo != null && priceFromInfo > 0 ? priceFromInfo : (len > 0 ? closes[len - 1] : 0);
        const prevClose = prevFromInfo != null && prevFromInfo > 0 ? prevFromInfo : (len >= 2 ? closes[len - 2] : currentPrice);
        const change = currentPrice - prevClose;
        const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

        const highs = res.ohlcv.high.filter((h) => typeof h === "number" && !isNaN(h) && h > 0);
        const lows = res.ohlcv.low.filter((l) => typeof l === "number" && !isNaN(l) && l > 0);
        const opens = res.ohlcv.open.filter((o) => typeof o === "number" && !isNaN(o) && o > 0);

        const sparkline = closes.slice(-10);

        return {
          symbol: meta.symbol,
          name: meta.name,
          category: meta.category,
          flag: meta.flag,
          price: currentPrice,
          previousClose: prevClose,
          change,
          changePct,
          high: highs[highs.length - 1] || currentPrice,
          low: lows[lows.length - 1] || currentPrice,
          open: opens[opens.length - 1] || currentPrice,
          sparkline,
          updatedAt: new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          isRateOrVix: meta.isRateOrVix,
          status: "live",
        };
      }
    } catch (err) {
      console.warn(`[Tauri] fetch_stock_data error for ${symbol}:`, err);
    }
  }

  // 2. Web 瀏覽器端：多組可靠代理輪替解碼
  try {
    const encSym = symbol.startsWith("^") ? "%5E" + symbol.slice(1) : symbol;
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encSym}?range=1mo&interval=1d`;
    const proxyUrls = [
      `https://corsproxy.org/?url=${encodeURIComponent(targetUrl)}`,
      `https://r.jina.ai/http://query1.finance.yahoo.com/v8/finance/chart/${encSym}?range=1mo&interval=1d`,
      targetUrl,
    ];

    let data: any = null;
    for (const url of proxyUrls) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(4500) });
        if (resp.ok) {
          const text = await resp.text();
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
              try { json = JSON.parse(match[0]); } catch {}
            }
          }
          if (json?.chart?.result?.[0]) {
            data = json.chart.result[0];
            break;
          }
        }
      } catch {}
    }

    if (data) {
      const metaObj = data.meta || {};
      const quoteObj = data.indicators?.quote?.[0] || {};
      const rawCloses: number[] = quoteObj.close || [];
      const rawHighs: number[] = quoteObj.high || [];
      const rawLows: number[] = quoteObj.low || [];
      const rawOpens: number[] = quoteObj.open || [];

      const closes = rawCloses.filter((c) => typeof c === "number" && !isNaN(c) && c > 0);
      const len = closes.length;
      const currentPrice = metaObj.regularMarketPrice ?? (len > 0 ? closes[len - 1] : 0);
      const prevClose = metaObj.chartPreviousClose ?? metaObj.previousClose ?? (len >= 2 ? closes[len - 2] : currentPrice);
      const change = currentPrice - prevClose;
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

      const validHighs = rawHighs.filter((h) => typeof h === "number" && !isNaN(h) && h > 0);
      const validLows = rawLows.filter((l) => typeof l === "number" && !isNaN(l) && l > 0);
      const validOpens = rawOpens.filter((o) => typeof o === "number" && !isNaN(o) && o > 0);

      return {
        symbol: meta.symbol,
        name: meta.name,
        category: meta.category,
        flag: meta.flag,
        price: currentPrice,
        previousClose: prevClose,
        change,
        changePct,
        high: validHighs[validHighs.length - 1] || currentPrice,
        low: validLows[validLows.length - 1] || currentPrice,
        open: validOpens[validOpens.length - 1] || currentPrice,
        sparkline: closes.slice(-10),
        updatedAt: new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        isRateOrVix: meta.isRateOrVix,
        status: "live",
      };
    }
  } catch (err) {
    console.warn(`[Web] Chart fetch error for ${symbol}:`, err);
  }

  return CACHED_INDEX_QUOTES.get(meta.symbol) || getEmptyErrorQuote(meta);
}

export async function fetchIndexHistory(symbol: string, range: "1d" | "1mo" | "3mo" | "6mo" | "1y" = "1mo"): Promise<IndexHistoryData> {
  const interval = range === "1d" ? "5m" : "1d";

  if (isTauri()) {
    try {
      const res = await tauriInvoke<{
        ohlcv: { timestamp: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] };
      }>("fetch_stock_data", { symbol, range });

      if (res && res.ohlcv && res.ohlcv.timestamp.length > 0) {
        return res.ohlcv;
      }
    } catch (e) {
      console.warn(`[Tauri History] fetch_stock_data failed for ${symbol}:`, e);
    }
  }

  try {
    const encSym = symbol.startsWith("^") ? "%5E" + symbol.slice(1) : symbol;
    const targetUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encSym}?range=${range}&interval=${interval}`;
    const proxyUrls = [
      `https://r.jina.ai/http://query1.finance.yahoo.com/v8/finance/chart/${encSym}?range=${range}&interval=${interval}`,
      `https://corsproxy.org/?url=${encodeURIComponent(targetUrl)}`,
      targetUrl,
    ];

    for (const url of proxyUrls) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (resp.ok) {
          const text = await resp.text();
          let json: any = null;
          try {
            json = JSON.parse(text);
          } catch {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
              try { json = JSON.parse(match[0]); } catch {}
            }
          }
          const res = json?.chart?.result?.[0];
          if (res) {
            const timestamps: number[] = res.timestamp || [];
            const quote = res.indicators?.quote?.[0] || {};
            const opens: number[] = quote.open || [];
            const highs: number[] = quote.high || [];
            const lows: number[] = quote.low || [];
            const closes: number[] = quote.close || [];
            const volumes: number[] = quote.volume || [];

            const validTs: number[] = [];
            const validO: number[] = [];
            const validH: number[] = [];
            const validL: number[] = [];
            const validC: number[] = [];
            const validV: number[] = [];

            for (let i = 0; i < timestamps.length; i++) {
              if (
                timestamps[i] &&
                typeof closes[i] === "number" &&
                !isNaN(closes[i]) &&
                closes[i] > 0
              ) {
                validTs.push(timestamps[i]);
                validO.push(opens[i] || closes[i]);
                validH.push(highs[i] || closes[i]);
                validL.push(lows[i] || closes[i]);
                validC.push(closes[i]);
                validV.push(volumes[i] || 0);
              }
            }

            if (validTs.length > 0) {
              return {
                timestamp: validTs,
                open: validO,
                high: validH,
                low: validL,
                close: validC,
                volume: validV,
              };
            }
          }
        }
      } catch {}
    }
  } catch (e) {
    console.warn(`[Web History] Failed to fetch history for ${symbol}:`, e);
  }

  return {
    timestamp: [],
    open: [],
    high: [],
    low: [],
    close: [],
    volume: [],
  };
}

function getEmptyErrorQuote(meta: MarketIndexMeta): MarketIndexQuote {
  return {
    symbol: meta.symbol,
    name: meta.name,
    category: meta.category,
    flag: meta.flag,
    price: 0,
    previousClose: 0,
    change: 0,
    changePct: 0,
    high: 0,
    low: 0,
    open: 0,
    sparkline: [],
    updatedAt: "連線異常",
    isRateOrVix: meta.isRateOrVix,
    status: "error",
  };
}
