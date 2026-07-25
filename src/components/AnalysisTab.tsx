import React, { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChartPanel } from "./Chart";
import { calculateAllIndicators, OhlcvData } from "../utils/indicators";
import {
  getAnalysisSuggestions,
  checkLandmineRisks,
  computeFundamentalScore,
  StockInfoFull,
} from "../utils/analysis";

import { getCachedStocks, subscribeStocks, StockEntry } from "../utils/stocks";

// ─── 股票資料庫 (taiwan_stocks.json) ─────────────────────────────────────────
let STOCK_DB: StockEntry[] = getCachedStocks();
subscribeStocks((stocks) => {
  STOCK_DB = stocks;
});

// ─── 輔助函數 ─────────────────────────────────────────────────────────────────
const pct = (v?: number | null) => (v != null && !isNaN(v) ? `${(v * 100).toFixed(2)}%` : "N/A");
const pctColor = (v?: number | null) => {
  if (v == null || isNaN(v)) return "inherit";
  return v >= 0 ? "var(--accent-green)" : "var(--accent-red)";
};
const fmtNum = (v?: number | null) => {
  if (v == null) return "N/A";
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)}億`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(2)}萬`;
  return v.toFixed(2);
};
const fmtPrice = (v?: number | null) =>
  v != null && !isNaN(v) ? v.toFixed(2) : "N/A";
const n2s = (v?: number | null) =>
  v != null && !isNaN(v) ? v.toFixed(2) : "N/A";

function resolveSymbol(input: string): string {
  const q = input.trim().split(" ")[0].toUpperCase();
  if (/^\d+$/.test(q)) {
    const match = STOCK_DB.find((s) => s.symbol.split(".")[0] === q);
    return match ? match.symbol : `${q}.TW`;
  }
  if (q.includes(".")) return q;
  // 名稱搜尋
  const match = STOCK_DB.find(
    (s) => s.name.includes(input.trim()) || s.symbol.includes(q)
  );
  return match ? match.symbol : q;
}

// ─── 英文自動翻譯為繁中 ──────────────────────────────────────────────────────────
const translateText = async (text: string): Promise<string> => {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=${encodeURIComponent(text)}`;
    const resp = await fetch(url);
    if (resp.ok) {
      const json = await resp.json();
      if (json && json[0]) {
        return json[0].map((item: any) => item[0]).join("");
      }
    }
  } catch (e) {
    console.error("translation error:", e);
  }
  return text;
};

// ─── 指標詳細解說字典 ──────────────────────────────────────────────────────────
const METRIC_EXPLANATIONS: Record<string, { label: string, explanation: string }> = {
  "ROE": {
    label: "股東權益報酬率 (ROE)",
    explanation: "反映公司利用股東資金創造獲利的能力。計算公式為「稅後淨利 / 股東權益」。數值越高代表公司的資本利用效率越好。巴菲特特別看重此指標，通常大於 15% 為優秀，大於 10% 為良好。"
  },
  "毛利率": {
    label: "營業毛利率 (Gross Margin)",
    explanation: "反映公司產品或服務扣除直接生產成本後的基本獲利能力。計算公式為「(營業收入 - 營業成本) / 營業收入」。毛利率高低通常代表公司產品的附加價值或市場定價權，高於 30% 為優秀，高於 20% 為合格。"
  },
  "淨利率": {
    label: "稅後淨利率 (Net Profit Margin)",
    explanation: "反映公司每一元營業收入最終能為股東留下的淨利潤比例。計算公式為「稅後淨利 / 營業收入」。綜合體現了公司產品定價、經營成本控制與利息稅務的管理能力，高於 10% 為優秀，高於 5% 為合格。"
  },
  "EPS": {
    label: "每股盈餘 (Earnings Per Share)",
    explanation: "每一股發行在外的股票所能分到的淨利潤，是衡量公司獲利能力的關鍵指標。計算公式為「稅後淨利 / 已發行股數」。持續增長的 EPS 是推動股價上漲最核心的動力。"
  },
  "營收YoY": {
    label: "營收年增率 (Revenue Growth YoY)",
    explanation: "當期營業收入與去年同期相比的成長率。反映公司業務拓展速度與市場份額的擴張狀況。如果持續呈現負值，需警惕產品競爭力下滑或市場萎縮危機，高於 10% 代表成長強勁。"
  },
  "盈餘YoY": {
    label: "盈餘年增率 (Earnings Growth YoY)",
    explanation: "當期淨利與去年同期相比的成長率。比營收 YoY 更直接反映最終獲利的實質成長。若營收成長但盈餘衰退，可能是毛利下滑或營運費用失控所致，通常大於 10% 代表成長健康。"
  },
  "PE": {
    label: "本益比 (Price-to-Earnings Ratio)",
    explanation: "估算投資回本年數的指標。計算公式為「目前股價 / 每股盈餘(EPS)」。代表投資人為獲取每一元盈餘所付出的股價代價。一般合理區間在 5~20 之間，低於此區間代表股價便宜，但須注意是否為衰退型陷阱。"
  },
  "PB": {
    label: "股價淨值比 (Price-to-Book Ratio)",
    explanation: "股價相對於每股淨值的倍數。計算公式為「目前股價 / 每股淨值」。常用於評估資產導向型公司或金融股。通常小於 2 代表股價相對淨值較便宜，小於 1 則為折價，但須防範持續虧損的價值陷阱。"
  },
  "殖利率": {
    label: "現金股利殖利率 (Dividend Yield)",
    explanation: "預期投資現金股利回報率。計算公式為「每股現金股利 / 目前股價」。高於 4% 通常被認為是優質的高息股，適合長期存股族，但須注意公司配息是否健康，避免「賺了股息，賠了價差」。"
  },
  "流動比率": {
    label: "流動比率 (Current Ratio)",
    explanation: "衡量公司一年內償還短期債務的能力。計算公式為「流動資產 / 流動負債」。通常大於 2.0 代表短期償債能力非常安全；若低於 1.0 則須警惕短期資金鏈吃緊或債務逾期風險。"
  },
  "速動比率": {
    label: "速動比率 (Quick Ratio)",
    explanation: "比流動比率更嚴格的短期償債能力指標，扣除了存貨及預付款項等變現較慢的資產。計算公式為「(流動資產 - 存貨 - 預付款項) / 流動負債」。理想狀況為大於 1.0，低於此數值代表公司變現償債壓力較高。"
  },
  "負債/權益比": {
    label: "負債對權益比率 (Debt-to-Equity Ratio)",
    explanation: "衡量公司財務槓桿與長期財務安全性的指標。計算公式為「總負債 / 股東權益」。一般低於 50% 屬極低風險，低於 150% 為合理，若大於 300% 則代表高度依賴舉債，財務風險相當高。"
  },
  "自由現金流": {
    label: "自由現金流 (Free Cash Flow)",
    explanation: "營運活動帶來的現金流入扣除必要資本支出後，真正可由公司自由支配的現金。是檢驗公司獲利真實性與發放股利、償還債務能力的金標準，持續正值代表財務極其健全。"
  },
  "營業現金流": {
    label: "營業活動現金流 (Operating Cash Flow)",
    explanation: "公司因核心營運業務活動而產生的現金流入與流出。如果一家公司 EPS 帳面上為正值，但營業現金流長期為負，代表可能存在大量呆帳或存貨積壓，獲利僅是紙上富貴。"
  },
  "營業利益率": {
    label: "營業利益率 (Operating Margin)",
    explanation: "公司扣除直接生產成本與營業費用（如管理、銷售、研發費用等）後的利潤率。反映公司本業的經營獲利能力。計算公式為「營業利益 / 營業收入」。"
  },
  "市值": {
    label: "公司市值 (Market Capitalization)",
    explanation: "公司的總市場價值。計算公式為「目前股價 * 發行在外總股數」。反映了市場對這家公司總體價值的評估。"
  },
  "所屬產業": {
    label: "所屬產業 (Sector)",
    explanation: "該公司在市場中所歸屬的行業類別。有助於與同行業其他公司進行橫向比較估值與財務表現。"
  }
};

// ─── 主元件 ───────────────────────────────────────────────────────────────────
interface Props { initialSymbol?: string; }
export const AnalysisTab: React.FC<Props> = ({ initialSymbol }) => {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [ohlcv, setOhlcv] = useState<OhlcvData | null>(null);
  const [info, setInfo] = useState<StockInfoFull | null>(null);
  const [news, setNews] = useState<{ title: string; link: string }[]>([]);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<{ title: string; desc: string; color: string }[]>([]);
  const [techScore, setTechScore] = useState(0);
  const [risks, setRisks] = useState<string[]>([]);
  const [stockDb, setStockDb] = useState<StockEntry[]>(STOCK_DB);
  const [autocomplete, setAutocomplete] = useState<typeof STOCK_DB>([]);
  const [searchModalItems, setSearchModalItems] = useState<StockEntry[]>([]);
  
  // 基本面 Modal
  const [showFundModal, setShowFundModal] = useState(false);
  const [fundData, setFundData] = useState<any>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [fundTab, setFundTab] = useState<"income" | "balance" | "cashflow">("income");
  const [fundFreq, setFundFreq] = useState<"annual" | "quarterly">("quarterly");
  const inputRef = useRef<HTMLInputElement>(null);

  // 指標解說 Modal 狀態
  const [selectedMetric, setSelectedMetric] = useState<{
    name: string;
    label: string;
    explanation: string;
    result?: string;
    isPassed?: boolean;
    isFailed?: boolean;
  } | null>(null);

  const showMetricExplanation = (name: string) => {
    const exp = METRIC_EXPLANATIONS[name] || { label: name, explanation: "目前尚無此指標之詳細說明。" };
    let result: string | undefined;
    let isPassed = false;
    let isFailed = false;
    
    if (fs) {
      const pMatch = fs.passed.find(([l]) => l === name);
      if (pMatch) {
        result = pMatch[1];
        isPassed = true;
      } else {
        const fMatch = fs.failed.find(([l]) => l === name);
        if (fMatch) {
          result = fMatch[1];
          isFailed = true;
        } else if (fs.na.includes(name)) {
          result = "資料不足，無法對此指標進行診斷評估。";
        }
      }
    }
    
    setSelectedMetric({
      name,
      label: exp.label,
      explanation: exp.explanation,
      result,
      isPassed,
      isFailed
    });
  };

  const ind = ohlcv ? calculateAllIndicators(ohlcv) : null;

  // 訂閱股票清單更新
  useEffect(() => {
    return subscribeStocks((stocks) => {
      setStockDb(stocks);
    });
  }, []);

  // 若由其他頁籤傳入代碼，自動分析
  useEffect(() => {
    if (initialSymbol && initialSymbol.trim()) {
      setQuery(initialSymbol);
      doAnalysis(initialSymbol);
    }
  }, [initialSymbol]);

  // 自動完成
  const onInput = (v: string) => {
    setQuery(v);
    if (v.length < 1) { setAutocomplete([]); return; }
    const q = v.trim().toLowerCase();
    const matched = stockDb.filter(
      (s) => s.name.toLowerCase().includes(q) || s.symbol.toLowerCase().includes(q) || s.symbol.split(".")[0].startsWith(q)
    );
    // 排序：完全符合 > 字首符合 > 模糊包含
    matched.sort((a, b) => {
      const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
      const aCode = a.symbol.split(".")[0];
      const bCode = b.symbol.split(".")[0];
      const aExact = an === q || aCode === q;
      const bExact = bn === q || bCode === q;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      const aPrefix = an.startsWith(q) || aCode.startsWith(q);
      const bPrefix = bn.startsWith(q) || bCode.startsWith(q);
      if (aPrefix && !bPrefix) return -1;
      if (!aPrefix && bPrefix) return 1;
      return 0;
    });
    setAutocomplete(matched.slice(0, 50));
  };

  const doAnalysis = useCallback(async (sym?: string) => {
    let target = sym;
    if (!target) {
      const v = query.trim().toLowerCase();
      if (!v) return;
      const exactMatch = stockDb.find(s => s.symbol.split(".")[0].toLowerCase() === v || s.symbol.toLowerCase() === v || s.name.toLowerCase() === v);
      if (exactMatch) {
        target = exactMatch.symbol;
      } else {
        const matches = stockDb.filter(
          (s) => s.name.toLowerCase().includes(v) || s.symbol.toLowerCase().includes(v) || s.symbol.split(".")[0].startsWith(v)
        );
        // 排序：完全符合 > 字首符合 > 模糊包含，確保個股排在權證前面
        matches.sort((a, b) => {
          const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
          const aCode = a.symbol.split(".")[0];
          const bCode = b.symbol.split(".")[0];
          const aExact = an === v || aCode === v;
          const bExact = bn === v || bCode === v;
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;
          const aPrefix = an.startsWith(v) || aCode.startsWith(v);
          const bPrefix = bn.startsWith(v) || bCode.startsWith(v);
          if (aPrefix && !bPrefix) return -1;
          if (!aPrefix && bPrefix) return 1;
          return 0;
        });
        if (matches.length === 1) {
          target = matches[0].symbol;
        } else if (matches.length > 1 && matches.length <= 100) {
          setSearchModalItems(matches);
          setAutocomplete([]);
          return;
        } else {
          target = resolveSymbol(query);
        }
      }
    }

    if (!target) return;
    setSearchModalItems([]);
    setLoading(true);
    setError("");
    setAutocomplete([]);
    try {
      const data: any = await invoke("fetch_stock_data", { symbol: target, range: "1y" });
      const stockOhlcv: OhlcvData = data.ohlcv;
      const stockInfo: StockInfoFull = { ...data.info };

      setOhlcv(stockOhlcv);
      setInfo(stockInfo);

      // 檢測是否為英文說明，若無中文則自動翻譯
      if (stockInfo.long_business_summary && !/[\u4e00-\u9fa5]/.test(stockInfo.long_business_summary)) {
        translateText(stockInfo.long_business_summary).then(translated => {
          setInfo(prev => prev ? { ...prev, long_business_summary: translated } : prev);
        });
      }

      // 計算技術指標
      const indicators = calculateAllIndicators(stockOhlcv);
      const lastN = stockOhlcv.timestamp.length - 1;
      const { signals, score } = getAnalysisSuggestions(indicators, lastN);
      const riskList = checkLandmineRisks(indicators, stockInfo, lastN);

      setSuggestions(signals);
      setTechScore(score);
      setRisks(riskList);

      // 抓新聞
      const searchName = stockInfo.name || target.split(".")[0];
      invoke("fetch_news", { query: searchName })
        .then((n: any) => setNews(n))
        .catch(() => {});
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") doAnalysis();
  };

  const fetchFundamentals = async () => {
    if (!info) return;
    setFundLoading(true);
    setShowFundModal(true);
    setFundData(null);
    try {
      const data = await invoke("fetch_detailed_fundamentals", { symbol: info.symbol });
      setFundData(data);
    } catch (e) {
      console.error(e);
      setFundData({ error: String(e) });
    } finally {
      setFundLoading(false);
    }
  };

  const addToWatchlist = async () => {
    if (!info) return;
    try {
      const cat = await invoke<string>("get_category_by_symbol", { symbol: info.symbol });
      const filename = localStorage.getItem("portfolio_current_list") || "李山任的清單";
      const listData = await invoke<Record<string, any[]>>("load_watchlist", { filename });
      
      let exists = false;
      for (const entries of Object.values(listData)) {
        if (entries.some((e: any) => e.symbol === info.symbol)) {
          exists = true;
          break;
        }
      }
      
      if (exists) {
        if (!window.confirm(`「${info.symbol}」已經存在於自選股中。\n您要追加一筆新的購入紀錄嗎？`)) {
          return;
        }
      }
      
      const newEntry = {
        symbol: info.symbol,
        date: new Date().toISOString().slice(0, 10),
        price: 0,
        shares: 0,
        sell_price: 0
      };
      
      const updatedList = { ...listData };
      if (!updatedList[cat]) updatedList[cat] = [];
      updatedList[cat].push(newEntry);
      
      await invoke("save_watchlist", { watchlist: updatedList, filename });
      alert(`已成功將「${info.name || info.symbol}」存入自選名單【${cat}】中！`);
    } catch (e) {
      alert(`存入失敗: ${e}`);
    }
  };

  // ── 基本面評分
  const fs = info ? computeFundamentalScore(info) : null;
  const fsScore = fs?.score ?? 0;
  const fsGrade = (() => {
    if (fsScore >= 10) return { label: "S 頂級", color: "#ce93d8", bg: "rgba(206,147,216,0.1)", border: "rgba(206,147,216,0.4)" };
    if (fsScore >= 7) return { label: "A 優質", color: "#90caf9", bg: "rgba(144,202,249,0.1)", border: "rgba(144,202,249,0.4)" };
    if (fsScore >= 4) return { label: "B 良好", color: "#81c784", bg: "rgba(129,199,132,0.1)", border: "rgba(129,199,132,0.4)" };
    if (fsScore >= 1) return { label: "C 普通", color: "#ffd740", bg: "rgba(255,215,64,0.1)", border: "rgba(255,215,64,0.4)" };
    if (fsScore >= -2) return { label: "D 偏弱", color: "#ffab40", bg: "rgba(255,171,64,0.1)", border: "rgba(255,171,64,0.4)" };
    return { label: "F 危險", color: "#ef9a9a", bg: "rgba(239,154,154,0.1)", border: "rgba(239,154,154,0.4)" };
  })();

  // ── 技術建議
  const finalScore = techScore - risks.length;
  const advice = (() => {
    if (finalScore >= 3) return { title: "🚀 強力買進 (Strong Buy)", color: "#81c784", bg: "rgba(76,175,80,0.08)", border: "rgba(76,175,80,0.35)" };
    if (finalScore >= 1) return { title: "📈 偏多進場 (Bullish)", color: "#a5d6a7", bg: "rgba(76,175,80,0.05)", border: "rgba(76,175,80,0.2)" };
    if (finalScore <= -3) return { title: "💀 建議賣出 (Sell)", color: "#ef9a9a", bg: "rgba(255,82,82,0.08)", border: "rgba(255,82,82,0.4)" };
    if (finalScore <= -1) return { title: "📉 偏空觀望 (Bearish)", color: "#ffab40", bg: "rgba(255,171,64,0.08)", border: "rgba(255,171,64,0.35)" };
    return { title: "⚖️ 中性持有 (Hold)", color: "#b0bec5", bg: "rgba(176,190,197,0.05)", border: "rgba(176,190,197,0.2)" };
  })();

  const changePct =
    info?.current_price && info?.previous_close
      ? ((info.current_price - info.previous_close) / info.previous_close) * 100
      : null;

  return (
    <div className="analysis-layout">
      {/* ─── 左側資訊面板 ─────────────────────────────────────────── */}
      <div className="analysis-sidebar">
        {/* 搜尋列 */}
        <div className="analysis-search">
          <div style={{ position: "relative", flex: 1 }}>
            <input
              ref={inputRef}
              className="input-field"
              value={query}
              onChange={(e) => onInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="代碼 / 名稱 (例如: 2330)"
            />
            {autocomplete.length > 0 && (
              <div style={{
                position: "absolute", top: "100%", left: 0, right: 0, zIndex: 200,
                background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: "var(--radius-sm)", maxHeight: "220px", overflowY: "auto",
                boxShadow: "var(--shadow-card)",
              }}>
                {autocomplete.map((s) => (
                  <div key={s.symbol} onClick={() => { setQuery(s.symbol); doAnalysis(s.symbol); }}
                    style={{ padding: "8px 12px", cursor: "pointer", fontSize: "0.85rem", display: "flex", gap: "8px" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(77,148,255,0.1)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <span style={{ color: "var(--accent-blue)" }}>{s.symbol.split(".")[0]}</span>
                    <span style={{ color: "var(--text-secondary)" }}>{s.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => doAnalysis()} disabled={loading}>
            {loading ? <span className="loading-spinner" /> : "分析"}
          </button>
        </div>

        {/* 錯誤訊息 */}
        {error && (
          <div style={{ margin: "8px 14px", padding: "8px 12px", background: "rgba(255,82,82,0.1)", border: "1px solid rgba(255,82,82,0.3)", borderRadius: "var(--radius-sm)", fontSize: "0.82rem", color: "#ef9a9a" }}>
            {error}
          </div>
        )}

        {/* 內容 */}
        <div className="analysis-info">
          {!info && !loading && (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <div className="empty-text">輸入股票代碼開始分析</div>
            </div>
          )}

          {info && (
            <>
              {/* 股票名稱與現價 */}
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "1.15rem", fontWeight: 700, color: "var(--text-primary)" }}>{info.name}</div>
                <div style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginBottom: "6px" }}>{info.symbol}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                  <span style={{ fontSize: "1.6rem", fontWeight: 700, color: changePct != null && changePct >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                    {fmtPrice(info.current_price)}
                  </span>
                  {changePct != null && (
                    <span style={{ fontSize: "0.9rem", color: changePct >= 0 ? "var(--accent-green)" : "var(--accent-red)", fontWeight: 600 }}>
                      {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>

              {/* 地雷風險警示 */}
              {risks.length > 0 && (
                <div className="risk-banner">
                  <div className="risk-banner-title">⚠️ 偵測到潛在風險</div>
                  {risks.map((r, i) => <div className="risk-item" key={i}>{r}</div>)}
                </div>
              )}

              {/* 技術建議 */}
              <div className="advice-card" style={{ background: advice.bg, borderColor: advice.border }}>
                <div className="advice-title" style={{ color: advice.color }}>{advice.title}</div>
                <div className="advice-desc" style={{ color: "var(--text-secondary)" }}>
                  綜合評分：<b style={{ color: advice.color }}>{finalScore > 0 ? "+" : ""}{finalScore.toFixed(1)}</b> 分
                </div>
              </div>

              {/* 基本面評分卡 */}
              {fs && (
                <div className="score-card" style={{ background: fsGrade.bg, borderColor: fsGrade.border, marginBottom: "12px" }}>
                  <div className="score-header">
                    <div className="score-grade" style={{ color: fsGrade.color }}>📊 基本面：{fsGrade.label}</div>
                    <div className="score-num" style={{ color: "var(--text-secondary)" }}>
                      評分 <b style={{ color: fsGrade.color }}>{fsScore > 0 ? "+" : ""}{fsScore}</b>
                      &nbsp;｜ ✅{fs.passed.length} ❌{fs.failed.length} ⬜{fs.na.length}
                    </div>
                  </div>
                  <div className="score-tags">
                    {fs.passed.map(([l, d]) => (
                      <span className="score-tag" key={l} style={{ color: "#81c784", background: "rgba(76,175,80,0.12)", borderColor: "rgba(76,175,80,0.3)", cursor: "pointer" }} title={d} onClick={() => showMetricExplanation(l)}>{l}</span>
                    ))}
                    {fs.failed.map(([l, d]) => (
                      <span className="score-tag" key={l} style={{ color: "#ef9a9a", background: "rgba(255,82,82,0.12)", borderColor: "rgba(255,82,82,0.3)", cursor: "pointer" }} title={d} onClick={() => showMetricExplanation(l)}>{l}</span>
                    ))}
                    {fs.na.map((l) => (
                      <span className="score-tag" key={l} style={{ color: "var(--text-muted)", background: "rgba(255,255,255,0.04)", borderColor: "var(--border-subtle)", cursor: "pointer" }} onClick={() => showMetricExplanation(l)}>{l}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* 獲利能力 */}
              <div className="info-section">
                <div className="info-section-header">一、獲利能力</div>
                <div className="info-section-body">
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("EPS")}>EPS</span><span className="info-value">{n2s(info.eps)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("ROE")}>ROE</span><span className="info-value" style={{ color: pctColor(info.roe) }}>{pct(info.roe)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("毛利率")}>毛利率</span><span className="info-value">{pct(info.gross_margins)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("營業利益率")}>營業利益率</span><span className="info-value">{pct(info.operating_margins)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("淨利率")}>淨利率</span><span className="info-value">{pct(info.profit_margins)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("營收YoY")}>營收成長 YoY</span><span className="info-value" style={{ color: pctColor(info.revenue_growth) }}>{pct(info.revenue_growth)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("盈餘YoY")}>盈餘成長 YoY</span><span className="info-value" style={{ color: pctColor(info.earnings_growth) }}>{pct(info.earnings_growth)}</span></div>
                </div>
              </div>

              {/* 財務穩健度 */}
              <div className="info-section">
                <div className="info-section-header">二、財務穩健度</div>
                <div className="info-section-body">
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("自由現金流")}>自由現金流</span><span className="info-value" style={{ color: (info.free_cashflow ?? 0) > 0 ? "var(--accent-green)" : "var(--accent-red)" }}>{fmtNum(info.free_cashflow)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("營業現金流")}>營業現金流</span><span className="info-value">{fmtNum(info.operating_cashflow)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("流動比率")}>流動比率</span><span className="info-value">{n2s(info.current_ratio)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("速動比率")}>速動比率</span><span className="info-value">{n2s(info.quick_ratio)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("負債/權益比")}>負債/權益比</span><span className="info-value" style={{ color: (info.debt_to_equity ?? 0) > 200 ? "var(--accent-red)" : "inherit" }}>{info.debt_to_equity != null ? `${info.debt_to_equity.toFixed(1)}%` : "N/A"}</span></div>
                </div>
              </div>

              {/* 估值指標 */}
              <div className="info-section">
                <div className="info-section-header">三、估值指標</div>
                <div className="info-section-body">
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("PE")}>本益比 (PE)</span><span className="info-value" style={{ color: "var(--accent-blue)" }}>{n2s(info.tw_pe ?? info.pe)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("PB")}>股價淨值比 (PB)</span><span className="info-value" style={{ color: "var(--accent-blue)" }}>{n2s(info.tw_pb ?? info.pb)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("殖利率")}>殖利率</span><span className="info-value" style={{ color: "var(--accent-amber)" }}>{pct(info.tw_yield ?? info.dividend_yield)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("市值")}>市值</span><span className="info-value">{fmtNum(info.market_cap)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" onClick={() => showMetricExplanation("所屬產業")}>所屬產業</span><span className="info-value" style={{ fontSize: "0.78rem" }}>{info.sector ?? "N/A"}</span></div>
                </div>
              </div>

              {/* 業務介紹 */}
              {info.long_business_summary && (
                <div className="info-section">
                  <div className="info-section-header">四、公司業務介紹</div>
                  <div className="info-section-body" style={{ fontSize: "0.78rem", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    {info.long_business_summary.slice(0, 400)}{info.long_business_summary.length > 400 ? "…" : ""}
                  </div>
                </div>
              )}

              {/* 智慧診斷細節 */}
              <div style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "0.88rem", fontWeight: 600, color: "var(--accent-blue-light)", marginBottom: "8px" }}>📡 智慧診斷細節</div>
                {suggestions.map((s, i) => (
                  <div className="signal-card" key={i} style={{ borderLeftColor: s.color }}>
                    <div className="signal-title" style={{ color: s.color }}>{s.title}</div>
                    <div className="signal-desc">{s.desc}</div>
                  </div>
                ))}
              </div>

              {/* 相關新聞 */}
              {news.length > 0 && (
                <div className="info-section">
                  <div className="info-section-header">🗞️ 相關新聞</div>
                  <div className="info-section-body">
                    <ul className="news-list">
                      {news.map((item, i) => (
                        <li className="news-item" key={i}>
                          <a
                            className="news-link"
                            href="#"
                            onClick={(e) => {
                              e.preventDefault();
                              invoke("open_url", { url: item.link });
                            }}
                          >
                            {item.title}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {/* 快捷按鈕 */}
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "8px" }}>
                <button className="btn btn-outline btn-sm" onClick={() => {
                  const code = info.symbol.split(".")[0];
                  invoke("open_url", { url: `https://www.cmoney.tw/forum/stock/${code}` });
                }}>股市同學會</button>
                <button className="btn btn-outline btn-sm" onClick={() => {
                  invoke("open_url", { url: `https://tw.stock.yahoo.com/quote/${info.symbol}` });
                }}>Yahoo 股市</button>
                <button className="btn btn-outline btn-sm" onClick={() => {
                  const code = info.symbol.split(".")[0];
                  invoke("open_url", { url: `https://goodinfo.tw/tw/StockDetail.asp?STOCK_ID=${code}` });
                }}>Goodinfo</button>
                <button className="btn btn-primary btn-sm" onClick={fetchFundamentals}>
                  📊 詳細基本面
                </button>
                <button className="btn btn-primary btn-sm" onClick={addToWatchlist} style={{ background: "#ffd740", borderColor: "#ffd740", color: "#111", fontWeight: 600 }}>
                  ⭐ 存入自選
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── 右側圖表區 ─────────────────────────────────────────────── */}
      <div className="analysis-chart-area">
        {ohlcv && ind ? (
          <ChartPanel ohlcv={ohlcv} ind={ind} symbol={info?.symbol ?? ""} name={info?.name ?? ""} />
        ) : (
          <div className="empty-state" style={{ height: "100%" }}>
            <div className="empty-icon">📈</div>
            <div className="empty-text">分析後將顯示 K 線圖與7項技術指標</div>
          </div>
        )}
      </div>
      {/* 搜尋結果多選 Modal */}
      {searchModalItems.length > 0 && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          zIndex: 9999, display: "flex", justifyContent: "center", alignItems: "center"
        }} onClick={() => setSearchModalItems([])}>
          <div style={{
            background: "#1a1a24", borderRadius: "12px", width: "400px", maxWidth: "90%",
            maxHeight: "80vh", display: "flex", flexDirection: "column", border: "1px solid rgba(255,255,255,0.1)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "16px", borderBottom: "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>請選擇標的 ({searchModalItems.length} 筆相符)</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setSearchModalItems([])}>✕</button>
            </div>
            <div style={{ overflowY: "auto", padding: "8px" }}>
              {searchModalItems.map(s => (
                <div key={s.symbol} onClick={() => { setQuery(s.symbol.split(".")[0]); doAnalysis(s.symbol); }}
                  style={{
                    padding: "12px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,0.05)",
                    display: "flex", justifyContent: "space-between", alignItems: "center"
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.05)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ fontWeight: "bold" }}>{s.name}</span>
                  <span style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.9rem" }}>{s.symbol}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 詳細基本面 Modal */}
      {showFundModal && (() => {
        const rawResult = fundData?.quoteSummary?.result?.[0] || fundData;

        const findTwKey = (prefix: string, freq: "annual" | "quarterly") => {
          if (!rawResult) return undefined;
          const freqStr = freq === "annual" ? "year" : "quarter";
          // 1) 精確前綴 + 頻率字串 (e.g. "incomeStatement-2330.TW-quarter-20--date")
          const detailedKey = Object.keys(rawResult).find(k => k.startsWith(prefix) && k.includes(freqStr));
          if (detailedKey) return detailedKey;
          // 2) 精確前綴不論頻率，只要有 data (e.g. "incomeStatement-2330.TW-...")
          const anyKey = Object.keys(rawResult).find(k => k.startsWith(prefix) && typeof rawResult[k] === "object" && Array.isArray((rawResult[k] as any)?.data) && (rawResult[k] as any).data.length > 0);
          if (anyKey) return anyKey;
          // 3) 縮短前綴去掉尾巴的 "-" 嘗試直接匹配 (e.g. "balanceSheet" 或 "cashFlowStatement")
          const plain = prefix.endsWith("-") ? prefix.slice(0, -1) : prefix;
          if (rawResult[plain] && typeof rawResult[plain] === "object") {
            const d = (rawResult[plain] as any).data;
            if (Array.isArray(d) && d.length > 0) return plain;
          }
          // 4) 前綴模糊比對 (e.g. prefix="balanceSheet-" 能找到 "balanceSheet")
          const looseKey = Object.keys(rawResult).find(k => {
            const kNoSuffix = k.split("-")[0];
            const pNoSuffix = plain.split("-")[0];
            return kNoSuffix.toLowerCase() === pNoSuffix.toLowerCase() && typeof rawResult[k] === "object" && Array.isArray((rawResult[k] as any)?.data) && (rawResult[k] as any).data.length > 0;
          });
          return looseKey;
        };

        const getQuarterlyStatements = (prefix: string) => {
          const twKey = findTwKey(prefix, "quarterly");
          if (twKey) return (rawResult[twKey] as any)?.data || [];
          return [];
        };
        
        // 解析資料
        const statements = (() => {
          if (!rawResult) return [];

          // 如果需要年度資料，且本地只有台灣單季資料，我們動態計算年度累計/期末數據
          if (fundFreq === "annual") {
            let qStatements: any[] = [];
            let prefix = "";
            let isBalance = false;
            
            if (fundTab === "income") {
              prefix = "incomeStatement-";
              qStatements = getQuarterlyStatements(prefix);
            } else if (fundTab === "balance") {
              prefix = "balanceSheet-";
              qStatements = getQuarterlyStatements(prefix);
              isBalance = true;
            } else {
              prefix = "cashFlowStatement-";
              qStatements = getQuarterlyStatements(prefix);
            }

            if (qStatements.length > 0) {
              const yearsMap: Record<string, any[]> = {};
              for (const q of qStatements) {
                const dateStr = q.date || "";
                const y = dateStr.slice(0, 4);
                if (y && y.length === 4) {
                  if (!yearsMap[y]) yearsMap[y] = [];
                  yearsMap[y].push(q);
                }
              }

              const annualList: any[] = [];
              const sortedYears = Object.keys(yearsMap).sort((a, b) => b.localeCompare(a));
              for (const y of sortedYears) {
                const quarters = yearsMap[y];
                if (isBalance) {
                  // 資產負債表是期末值 (存量)，取該年度 12 月或最後一季的數據
                  const q4 = quarters.find(q => q.date && (q.date.includes("-12-") || q.date.includes("-12T")));
                  const targetQ = q4 || quarters[0];
                  annualList.push({
                    ...targetQ,
                    date: `${y}-12-31T00:00:00+08:00`
                  });
                } else {
                  // 損益表與現金流量表為累計值 (流量)，將該年度所有單季相加
                  const template = quarters[0];
                  const annualEntry: any = {
                    symbol: template.symbol,
                    date: `${y}-12-31T00:00:00+08:00`
                  };
                  
                  const keysToSum = Object.keys(template).filter(k => k !== "symbol" && k !== "date");
                  for (const key of keysToSum) {
                    let sum = 0;
                    let foundAny = false;
                    for (const q of quarters) {
                      const val = q[key];
                      if (val !== undefined && val !== null) {
                        const parsed = typeof val === "number" ? val : parseFloat(val);
                        if (!isNaN(parsed)) {
                          sum += parsed;
                          foundAny = true;
                        }
                      }
                    }
                    annualEntry[key] = foundAny ? sum.toString() : null;
                  }
                  annualList.push(annualEntry);
                }
              }
              return annualList;
            }
          }


          if (fundTab === "income") {
            const twKey = findTwKey("incomeStatement-", fundFreq);
            if (twKey) return rawResult[twKey]?.data || [];

            const key = fundFreq === "annual" ? "incomeStatementHistory" : "incomeStatementHistoryQuarterly";
            return rawResult[key]?.incomeStatementHistory || [];
          } else if (fundTab === "balance") {
            const twKey = findTwKey("balanceSheet-", fundFreq);
            if (twKey) return rawResult[twKey]?.data || [];

            const key = fundFreq === "annual" ? "balanceSheetHistory" : "balanceSheetHistoryQuarterly";
            return rawResult[key]?.balanceSheetStatements || [];
          } else {
            const twKey = findTwKey("cashFlowStatement-", fundFreq);
            if (twKey) return rawResult[twKey]?.data || [];

            const key = fundFreq === "annual" ? "cashflowStatementHistory" : "cashflowStatementHistoryQuarterly";
            return rawResult[key]?.cashflowStatements || [];
          }
        })();

        const dates = statements.map((s: any) => s.endDate?.fmt || s.date?.slice(0, 10) || "N/A");

        const getSingleVal = (statement: any, key: string) => {
          const field = statement[key];
          if (field === undefined || field === null) return null;
          if (typeof field === "object") {
            return field.raw !== undefined ? field.raw : null;
          }
          if (typeof field === "number") return field;
          if (typeof field === "string") {
            const parsed = parseFloat(field);
            return isNaN(parsed) ? null : parsed;
          }
          return null;
        };

        const getVal = (statement: any, rowConfig: { keys: string[], sumKeys?: string[], calc?: string }) => {
          if (!statement) return null;
          
          if (rowConfig.calc === "costOfRevenue") {
            const rev = getSingleVal(statement, "revenue") ?? getSingleVal(statement, "totalRevenue");
            const gp = getSingleVal(statement, "grossProfit");
            if (rev !== null && gp !== null) return rev - gp;
          } else if (rowConfig.calc === "incomeTaxExpense") {
            const pbt = getSingleVal(statement, "profitBeforeTax") ?? getSingleVal(statement, "incomeBeforeTax");
            const ni = getSingleVal(statement, "netIncome");
            if (pbt !== null && ni !== null) return pbt - ni;
          } else if (rowConfig.calc === "cashflowNetIncome") {
            const dateStr = statement.date || statement.endDate?.fmt || "";
            const targetDate = dateStr.slice(0, 10);
            if (targetDate) {
              const incKey = findTwKey("incomeStatement-", fundFreq);
              const incStatements = incKey ? (rawResult[incKey]?.data || []) : [];
              const incMatch = incStatements.find((s: any) => (s.date || s.endDate?.fmt || "").startsWith(targetDate));
              if (incMatch) {
                return getSingleVal(incMatch, "netIncome");
              }
            }
          } else if (rowConfig.calc === "capitalExpenditures") {
            const ocf = getSingleVal(statement, "totalCashFromOperatingActivities") ?? getSingleVal(statement, "operatingCashFlow");
            const fcf = getSingleVal(statement, "freeCashFlow");
            if (ocf !== null && fcf !== null) {
              return fcf - ocf;
            }
          }

          if (rowConfig.sumKeys) {
            let sum = 0;
            let foundAny = false;
            for (const key of rowConfig.sumKeys) {
              const val = getSingleVal(statement, key);
              if (val !== null) {
                sum += val;
                foundAny = true;
              }
            }
            if (foundAny) return sum;
          }

          for (const key of rowConfig.keys) {
            const val = getSingleVal(statement, key);
            if (val !== null) return val;
          }
          return null;
        };

        const incomeRows = [
          { keys: ["totalRevenue", "revenue"], label: "營業收入 (Total Revenue)" },
          { keys: ["costOfRevenue", "costOfGoodsSold"], calc: "costOfRevenue", label: "營業成本 (Cost of Revenue)" },
          { keys: ["grossProfit"], label: "營業毛利 (Gross Profit)" },
          { keys: ["researchDevelopment", "rdExpenses"], label: "研發費用 (R&D Expense)" },
          { keys: ["sellingGeneralAdministrative"], sumKeys: ["sellingExpenses", "adminExpenses"], label: "推銷及管理費用 (SG&A)" },
          { keys: ["totalOperatingExpenses", "operatingExpenses"], label: "營業費用總額 (Operating Expenses)" },
          { keys: ["operatingIncome", "operatingProfit"], label: "營業利益 (Operating Income)" },
          { keys: ["totalOtherIncomeExpenseNet", "nonOperatingIncome"], label: "營業外收支淨額 (Other Income/Expense)" },
          { keys: ["ebit"], label: "息稅前折舊攤銷前淨利 (EBIT)" },
          { keys: ["incomeBeforeTax", "profitBeforeTax"], label: "稅前淨利 (Income Before Tax)" },
          { keys: ["incomeTaxExpense"], calc: "incomeTaxExpense", label: "所得稅費用 (Income Tax Expense)" },
          { keys: ["netIncome"], label: "稅後淨利 (Net Income)" },
        ];

        const balanceRows = [
          { keys: ["cash", "cashAndEquivalents"], label: "現金與約當現金 (Cash & Equivalents)" },
          { keys: ["shortTermInvestments", "shortTermInvestment"], label: "短期投資 (Short Term Investments)" },
          { keys: ["netReceivables", "accountsReceivable"], label: "應收帳款 (Net Receivables)" },
          { keys: ["inventory"], label: "存貨 (Inventory)" },
          { keys: ["totalCurrentAssets", "currentAssets"], label: "流動資產總額 (Total Current Assets)" },
          { keys: ["propertyPlantEquipment", "propertyPlantAndEquipment"], label: "不動產、廠房及設備 (PPE)" },
          { keys: ["goodWill"], label: "商譽 (Goodwill)" },
          { keys: ["intangibleAssets"], label: "無形資產 (Intangible Assets)" },
          { keys: ["totalAssets"], label: "資產總額 (Total Assets)" },
          { keys: ["accountsPayable"], label: "應付帳款 (Accounts Payable)" },
          { keys: ["shortLongTermDebt", "shortTermDebt"], label: "短期借款 / 一年內到期長期負債" },
          { keys: ["totalCurrentLiabilities", "currentLiabilities"], label: "流動負債總額 (Total Current Liabilities)" },
          { keys: ["longTermDebt", "longTermLiabilities"], label: "長期負債 (Long Term Debt)" },
          { keys: ["totalLiabilities"], label: "負債總額 (Total Liabilities)" },
          { keys: ["totalStockholderEquity", "equity", "netWorth"], label: "權益總額 (股東權益)" },
        ];

        const cashflowRows = [
          { keys: ["netIncome"], calc: "cashflowNetIncome", label: "淨利 (Net Income)" },
          { keys: ["depreciation", "amortization"], label: "折舊與攤銷 (Depreciation & Amortization)" },
          { keys: ["totalCashFromOperatingActivities", "operatingCashFlow"], label: "營業活動現金流量 (Operating Cash Flow)" },
          { keys: ["capitalExpenditures"], calc: "capitalExpenditures", label: "資本支出 (Capital Expenditures)" },
          { keys: ["totalCashflowsFromInvestingActivities", "investingCashFlow"], label: "投資活動現金流量 (Investing Cash Flow)" },
          { keys: ["totalCashFromFinancingActivities", "financingCashFlow"], label: "籌資活動現金流量 (Financing Cash Flow)" },
          { keys: ["changeInCash", "netCashFlow"], label: "現金及約當現金淨增加額 (Change in Cash)" },
          { keys: ["freeCashFlow"], label: "自由現金流量 (Free Cash Flow)" },
        ];

        const rows = fundTab === "income" ? incomeRows : fundTab === "balance" ? balanceRows : cashflowRows;

        return (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)",
            zIndex: 10000, display: "flex", justifyContent: "center", alignItems: "center"
          }} onClick={() => setShowFundModal(false)}>
            <div style={{
              background: "#1a1a24", borderRadius: "12px", width: "950px", maxWidth: "95%",
              height: "85vh", display: "flex", flexDirection: "column", border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 20px 40px rgba(0, 0, 0, 0.5)"
            }} onClick={e => e.stopPropagation()}>
              
              {/* Header */}
              <div style={{ 
                padding: "16px 20px", 
                borderBottom: "1px solid rgba(255,255,255,0.1)", 
                display: "flex", 
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "1.3rem" }}>📊</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>詳細基本面 - {info?.name}</h3>
                    <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>{info?.symbol}</span>
                  </div>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => setShowFundModal(false)} style={{ minWidth: "32px", padding: 0, height: "32px", borderRadius: "50%" }}>✕</button>
              </div>

              {/* Sub-header / Tabs */}
              <div style={{ 
                padding: "12px 20px", 
                borderBottom: "1px solid rgba(255,255,255,0.06)", 
                display: "flex", 
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "12px",
                background: "rgba(255,255,255,0.01)"
              }}>
                {/* Statement Tabs */}
                <div style={{ display: "flex", gap: "6px" }}>
                  <button 
                    className={`btn btn-sm ${fundTab === "income" ? "btn-primary" : "btn-outline"}`}
                    onClick={() => setFundTab("income")}
                  >損益表</button>
                  <button 
                    className={`btn btn-sm ${fundTab === "balance" ? "btn-primary" : "btn-outline"}`}
                    onClick={() => setFundTab("balance")}
                  >資產負債表</button>
                  <button 
                    className={`btn btn-sm ${fundTab === "cashflow" ? "btn-primary" : "btn-outline"}`}
                    onClick={() => setFundTab("cashflow")}
                  >現金流量表</button>
                </div>

                {/* Frequency Toggle */}
                <div style={{ display: "flex", gap: "6px", background: "rgba(255,255,255,0.05)", padding: "3px", borderRadius: "8px" }}>
                  <button 
                    onClick={() => setFundFreq("annual")}
                    style={{
                      border: "none",
                      background: fundFreq === "annual" ? "var(--btn-primary-bg, #4d94ff)" : "transparent",
                      color: "#fff",
                      fontSize: "0.78rem",
                      padding: "5px 12px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontWeight: fundFreq === "annual" ? 600 : 400,
                      transition: "all 0.2s"
                    }}
                  >年度</button>
                  <button 
                    onClick={() => setFundFreq("quarterly")}
                    style={{
                      border: "none",
                      background: fundFreq === "quarterly" ? "var(--btn-primary-bg, #4d94ff)" : "transparent",
                      color: "#fff",
                      fontSize: "0.78rem",
                      padding: "5px 12px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontWeight: fundFreq === "quarterly" ? 600 : 400,
                      transition: "all 0.2s"
                    }}
                  >單季</button>
                </div>
              </div>

              {/* Table Content */}
              <div style={{ flex: 1, overflowY: "auto", padding: "20px", background: "#13131e" }}>
                {fundLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "100%", gap: "12px" }}>
                    <span className="loading-spinner" style={{ width: "36px", height: "36px" }}></span>
                    <span style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>正在從 Yahoo Finance 獲取財報資料...</span>
                  </div>
                ) : fundData?.error ? (
                  <div style={{ color: "#ff5252", padding: "20px", background: "rgba(255,82,82,0.05)", border: "1px solid rgba(255,82,82,0.2)", borderRadius: "8px" }}>
                    ⚠️ 載入失敗: {fundData.error}
                  </div>
                ) : statements.length > 0 ? (
                  <div style={{ overflowX: "auto", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
                      <thead>
                        <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                          <th style={{ padding: "12px 16px", color: "var(--text-muted)", fontWeight: 600, minWidth: "220px", position: "sticky", left: 0, background: "#161622", zIndex: 2 }}>會計項目</th>
                          {dates.map((date: string, idx: number) => (
                            <th key={idx} style={{ padding: "12px 16px", color: "var(--text-primary)", fontWeight: 600, textAlign: "right" }}>{date}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr 
                            key={row.keys[0]} 
                            style={{ 
                              borderBottom: "1px solid rgba(255,255,255,0.04)",
                              transition: "background 0.15s"
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = "rgba(255,255,255,0.02)"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          >
                            <td style={{ 
                              padding: "10px 16px", 
                              color: "rgba(255,255,255,0.9)", 
                              fontWeight: row.keys.includes("netIncome") || row.keys.includes("totalRevenue") || row.keys.includes("totalAssets") || row.keys.includes("freeCashFlow") ? 700 : 400,
                              position: "sticky", 
                              left: 0, 
                              background: "#13131e",
                              zIndex: 1,
                              borderRight: "1px solid rgba(255,255,255,0.02)"
                            }}>
                              {row.label}
                            </td>
                            {statements.map((statement: any, sIdx: number) => {
                              const rawVal = getVal(statement, row);
                              const isImportantRow = row.keys.includes("netIncome") || row.keys.includes("totalRevenue") || row.keys.includes("totalAssets") || row.keys.includes("freeCashFlow");
                              return (
                                <td 
                                  key={sIdx} 
                                  style={{ 
                                    padding: "10px 16px", 
                                    textAlign: "right",
                                    color: rawVal !== null && rawVal < 0 ? "var(--accent-red)" : isImportantRow ? "var(--accent-blue-light, #80b3ff)" : "rgba(255,255,255,0.75)",
                                    fontWeight: isImportantRow ? 700 : 400
                                  }}
                                >
                                  {fmtNum(rawVal)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                    📭 無財報數據 (可能該個股不支援此財報項目)
                  </div>
                )}
              </div>

              {/* Footer */}
              <div style={{ 
                padding: "12px 20px", 
                borderTop: "1px solid rgba(255,255,255,0.08)", 
                display: "flex", 
                justifyContent: "space-between", 
                alignItems: "center",
                background: "rgba(0,0,0,0.2)"
              }}>
                <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  數據來源: Yahoo Finance
                </span>
                <button className="btn btn-outline btn-sm" onClick={() => setShowFundModal(false)}>關閉</button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* 指標診斷與解說 Modal */}
      {selectedMetric && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
          zIndex: 20000, display: "flex", justifyContent: "center", alignItems: "center"
        }} onClick={() => setSelectedMetric(null)}>
          <div style={{
            background: "#161622", borderRadius: "12px", width: "420px", maxWidth: "90%",
            padding: "20px", border: "1px solid rgba(255,255,255,0.15)",
            boxShadow: "0 15px 30px rgba(0, 0, 0, 0.6)",
            display: "flex", flexDirection: "column", gap: "14px"
          }} onClick={e => e.stopPropagation()}>
            
            {/* Title */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "10px" }}>
              <h4 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600, color: "var(--accent-blue-light)" }}>
                💡 {selectedMetric.label || selectedMetric.name}
              </h4>
              <button className="btn btn-outline btn-sm" onClick={() => setSelectedMetric(null)} style={{ minWidth: "24px", padding: 0, height: "24px", borderRadius: "50%", fontSize: "0.8rem" }}>✕</button>
            </div>
            
            {/* Diagnostic Result */}
            {selectedMetric.result && (
              <div style={{ 
                background: selectedMetric.isPassed ? "rgba(76,175,80,0.08)" : selectedMetric.isFailed ? "rgba(255,82,82,0.08)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${selectedMetric.isPassed ? "rgba(76,175,80,0.2)" : selectedMetric.isFailed ? "rgba(255,82,82,0.2)" : "rgba(255,255,255,0.08)"}`,
                color: selectedMetric.isPassed ? "#81c784" : selectedMetric.isFailed ? "#ef9a9a" : "var(--text-secondary)",
                padding: "10px 12px", borderRadius: "6px", fontSize: "0.88rem"
              }}>
                <strong>當前診斷：</strong>{selectedMetric.result}
              </div>
            )}
            
            {/* Explanation Text */}
            <div style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {selectedMetric.explanation}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "4px" }}>
              <button className="btn btn-primary btn-sm" onClick={() => setSelectedMetric(null)}>確定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
