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
  { symbol: "^IXIC", name: "那斯達克 (Nasdaq)", category: "us", flag: "🇺🇸", description: "科技股風向標指數" },
  { symbol: "^SOX", name: "費城半導體 (SOX)", category: "us", flag: "🇺🇸", description: "半導體產業晴雨表 (與台股高度連動)" },
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

const FALLBACK_QUOTES: Record<string, Partial<MarketIndexQuote>> = {
  "^TWII": { price: 22250.5, previousClose: 22150.0, change: 100.5, changePct: 0.45, high: 22310, low: 22140 },
  "^TWOII": { price: 268.4, previousClose: 267.1, change: 1.3, changePct: 0.49, high: 269.2, low: 266.8 },
  "TSM": { price: 172.5, previousClose: 170.2, change: 2.3, changePct: 1.35, high: 173.8, low: 169.5 },
  "^GSPC": { price: 5648.4, previousClose: 5626.0, change: 22.4, changePct: 0.40, high: 5655.0, low: 5618.2 },
  "^IXIC": { price: 17713.6, previousClose: 17619.3, change: 94.3, changePct: 0.54, high: 17750.0, low: 17590.0 },
  "^SOX": { price: 5158.8, previousClose: 5085.2, change: 73.6, changePct: 1.45, high: 5180.0, low: 5070.0 },
  "^DJI": { price: 41250.5, previousClose: 41175.0, change: 75.5, changePct: 0.18, high: 41300.0, low: 41120.0 },
  "^VIX": { price: 15.65, previousClose: 16.20, change: -0.55, changePct: -3.40, high: 16.5, low: 15.4 },
  "^TNX": { price: 3.86, previousClose: 3.89, change: -0.03, changePct: -0.77, high: 3.91, low: 3.85 },
  "^N225": { price: 38362.5, previousClose: 38110.2, change: 252.3, changePct: 0.66, high: 38450.0, low: 38050.0 },
  "^KS11": { price: 2674.3, previousClose: 2662.2, change: 12.1, changePct: 0.45, high: 2680.0, low: 2655.0 },
  "^HSI": { price: 17989.1, previousClose: 17786.3, change: 202.8, changePct: 1.14, high: 18050.0, low: 17750.0 },
  "000001.SS": { price: 2842.2, previousClose: 2850.1, change: -7.9, changePct: -0.28, high: 2860.0, low: 2835.0 },
  "^FTSE": { price: 8379.6, previousClose: 8345.4, change: 34.2, changePct: 0.41, high: 8390.0, low: 8330.0 },
  "^GDAXI": { price: 18684.5, previousClose: 18633.1, change: 51.4, changePct: 0.28, high: 18720.0, low: 18600.0 },
  "^FCHI": { price: 7577.0, previousClose: 7524.1, change: 52.9, changePct: 0.70, high: 7590.0, low: 7510.0 },
};

export async function fetchMarketIndices(): Promise<MarketIndexQuote[]> {
  const fetchPromises = GLOBAL_INDICES.map(async (meta) => {
    try {
      const q = await fetchSingleIndexQuote(meta);
      return q;
    } catch {
      return getFallbackQuote(meta);
    }
  });

  const quotes = await Promise.all(fetchPromises);
  return quotes;
}

async function fetchSingleIndexQuote(meta: MarketIndexMeta): Promise<MarketIndexQuote> {
  const symbol = meta.symbol;

  if (isTauri()) {
    try {
      const res = await tauriInvoke<{
        ohlcv: { timestamp: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] };
        info: { current_price?: number; previous_close?: number };
      }>("fetch_stock_data", { symbol, range: "1mo" });

      if (res && res.ohlcv && res.ohlcv.close.length > 0) {
        const closes = res.ohlcv.close.filter((c) => typeof c === "number" && !isNaN(c));
        const len = closes.length;
        const currentPrice = res.info?.current_price || closes[len - 1] || 0;
        const prevClose = res.info?.previous_close || (len >= 2 ? closes[len - 2] : currentPrice);
        const change = currentPrice - prevClose;
        const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;
        const highs = res.ohlcv.high.filter((h) => typeof h === "number" && !isNaN(h));
        const lows = res.ohlcv.low.filter((l) => typeof l === "number" && !isNaN(l));
        const opens = res.ohlcv.open.filter((o) => typeof o === "number" && !isNaN(o));

        const sparkline = closes.slice(-8);

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
        };
      }
    } catch {
      // fallback
    }
  }

  try {
    const rawUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`;
    const proxyUrls = [
      `https://corsproxy.io/?url=${encodeURIComponent(rawUrl)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`,
      rawUrl,
    ];

    let data: any = null;
    for (const url of proxyUrls) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(4000) });
        if (resp.ok) {
          const json = await resp.json();
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

      const closes = rawCloses.filter((c) => typeof c === "number" && !isNaN(c));
      const len = closes.length;
      const currentPrice = metaObj.regularMarketPrice || (len > 0 ? closes[len - 1] : 0);
      const prevClose = metaObj.chartPreviousClose || metaObj.previousClose || (len >= 2 ? closes[len - 2] : currentPrice);
      const change = currentPrice - prevClose;
      const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

      const validHighs = rawHighs.filter((h) => typeof h === "number" && !isNaN(h));
      const validLows = rawLows.filter((l) => typeof l === "number" && !isNaN(l));
      const validOpens = rawOpens.filter((o) => typeof o === "number" && !isNaN(o));

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
        sparkline: closes.slice(-8),
        updatedAt: new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        isRateOrVix: meta.isRateOrVix,
      };
    }
  } catch {}

  return getFallbackQuote(meta);
}

export async function fetchIndexHistory(symbol: string, range: "1d" | "1mo" | "3mo" | "6mo" | "1y" = "1y"): Promise<IndexHistoryData> {
  const interval = range === "1d" ? "5m" : "1d";

  if (isTauri()) {
    try {
      const res = await tauriInvoke<{
        ohlcv: { timestamp: number[]; open: number[]; high: number[]; low: number[]; close: number[]; volume: number[] };
      }>("fetch_stock_data", { symbol, range });

      if (res && res.ohlcv && res.ohlcv.timestamp.length > 0) {
        return res.ohlcv;
      }
    } catch {}
  }

  try {
    const rawUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
    const proxyUrls = [
      `https://corsproxy.io/?url=${encodeURIComponent(rawUrl)}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`,
      rawUrl,
    ];

    for (const url of proxyUrls) {
      try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
          const json = await resp.json();
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
  } catch {}

  return generateSyntheticHistory(symbol, range);
}

function getFallbackQuote(meta: MarketIndexMeta): MarketIndexQuote {
  const fb = FALLBACK_QUOTES[meta.symbol] || {
    price: 1000,
    previousClose: 995,
    change: 5,
    changePct: 0.5,
    high: 1005,
    low: 990,
    open: 996,
  };

  const basePrice = fb.price || 1000;
  const pClose = fb.previousClose || basePrice * 0.99;
  const chg = fb.change ?? basePrice - pClose;
  const chgPct = fb.changePct ?? (chg / pClose) * 100;

  const sparkline: number[] = [];
  let cur = pClose;
  for (let i = 0; i < 8; i++) {
    cur += (Math.random() - 0.48) * (basePrice * 0.005);
    sparkline.push(Number(cur.toFixed(2)));
  }
  sparkline.push(basePrice);

  return {
    symbol: meta.symbol,
    name: meta.name,
    category: meta.category,
    flag: meta.flag,
    price: basePrice,
    previousClose: pClose,
    change: chg,
    changePct: chgPct,
    high: fb.high || basePrice * 1.008,
    low: fb.low || basePrice * 0.992,
    open: fb.open || basePrice * 0.998,
    sparkline,
    updatedAt: "離線快照",
    isRateOrVix: meta.isRateOrVix,
  };
}

function generateSyntheticHistory(symbol: string, range: string): IndexHistoryData {
  const count = range === "1d" ? 60 : range === "1mo" ? 22 : range === "3mo" ? 66 : range === "6mo" ? 130 : 250;
  const fb = FALLBACK_QUOTES[symbol]?.price || 10000;

  const timestamps: number[] = [];
  const opens: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const closes: number[] = [];
  const volumes: number[] = [];

  const now = Math.floor(Date.now() / 1000);
  const step = range === "1d" ? 300 : 86400;
  let current = fb * 0.92;

  for (let i = 0; i < count; i++) {
    const t = now - (count - i) * step;
    const change = (Math.random() - 0.47) * (fb * 0.012);
    const o = current;
    const c = Math.max(1, current + change);
    const h = Math.max(o, c) + Math.random() * (fb * 0.005);
    const l = Math.min(o, c) - Math.random() * (fb * 0.005);
    const v = Math.floor(Math.random() * 50000 + 10000);

    timestamps.push(t);
    opens.push(Number(o.toFixed(2)));
    highs.push(Number(h.toFixed(2)));
    lows.push(Number(l.toFixed(2)));
    closes.push(Number(c.toFixed(2)));
    volumes.push(v);

    current = c;
  }

  return {
    timestamp: timestamps,
    open: opens,
    high: highs,
    low: lows,
    close: closes,
    volume: volumes,
  };
}
