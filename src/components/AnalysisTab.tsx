import { AddToWatchlistBtn } from "./AddToWatchlistBtn";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { stockService, newsService, fundamentalService } from "../services";
import twseFundamentals from "../utils/twse_mops_fundamentals.json";
import { ChartPanel, ZoomChartModal, SubChartType } from "./Chart";
import { calculateAllIndicators, OhlcvData } from "../utils/indicators";
import {
  getAnalysisSuggestions,
  checkLandmineRisks,
  computeFundamentalScore,
  StockInfoFull,
} from "../utils/analysis";
import { evaluateAIAlpha } from "../utils/aiAlphaModel";
import { HardwareBadge } from "./HardwareBadge";
import { useAppTheme } from "../utils/theme";

import { getCachedStocks, subscribeStocks, StockEntry } from "../utils/stocks";
import { getCompanyBusinessSummary } from "../utils/companyProfiles";

// ─── 股票資料庫 (taiwan_stocks.json) ─────────────────────────────────────────
let STOCK_DB: StockEntry[] = getCachedStocks();
subscribeStocks((stocks) => {
  STOCK_DB = stocks;
});

// ─── 輔助函數 ─────────────────────────────────────────────────────────────────
const pct = (v?: number | null) => (v != null && !isNaN(v) ? `${(v * 100).toFixed(2)}%` : "N/A");
const fmtNum = (v?: number | null) => {
  if (v == null || isNaN(v)) return "N/A";
  if (Math.abs(v) >= 1e8) return `${(v / 1e8).toFixed(2)}億`;
  if (Math.abs(v) >= 1e4) return `${(v / 1e4).toFixed(2)}萬`;
  return v.toFixed(2);
};
const fmtPrice = (v?: number | null) =>
  v != null && !isNaN(v) ? v.toFixed(2) : "N/A";
const n2s = (v?: number | null) =>
  v != null && !isNaN(v) ? v.toFixed(2) : "N/A";
const calcEquityRatio = (info?: StockInfoFull | null): number | null => {
  if (!info || info.debt_to_equity?.value == null || isNaN(info.debt_to_equity?.value)) return null;
  const de = info.debt_to_equity?.value / 100;
  if (de < 0) return null;
  return (1 / (1 + de)) * 100;
};
const fmtEquityRatio = (info?: StockInfoFull | null) => {
  const er = calcEquityRatio(info);
  return er != null && !isNaN(er) ? `${er.toFixed(1)}%` : "N/A";
};

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
  return await stockService.translateText(text);
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
  "自有資本率": {
    label: "自有資本比率 / 股東權益比率 (Equity Ratio)",
    explanation: "衡量公司總資產中有多少比例是由股東自有資金出資。計算公式為「股東權益 / 總資產 * 100%」。數值越高代表公司自有資金越充裕、財務結構越穩健、破產風險越低。一般而言大於 50% 為良好穩健，低於 30% 則代表高度依賴外部借款。"
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

const getTechIndicatorExplanation = (title: string): { label: string, explanation: string } => {
  if (title.includes("長線趨勢") || title.includes("短線趨勢")) {
    return {
      label: "均線趨勢與多空排列 (MA Trend)",
      explanation: "利用短中長期均線（50MA / 200MA 或 20MA）的交叉排列判定主升段或空頭格局。50MA > 200MA 為黃金交叉多頭排列，具備極強之均線支撐保護與趨勢慣性。"
    };
  }
  if (title.includes("布林通道")) {
    return {
      label: "布林通道統計區間 (Bollinger Bands)",
      explanation: "由 20 日均線加減 2 個標準差構成的動態統計通道，約有 95.4% 的價格波動落在通道內。價格處於通道中線上方向上運行代表多方發球局，突破上軌需防過熱回檔，跌破下軌則為超賣反彈機會。"
    };
  }
  if (title.includes("RSI")) {
    return {
      label: "相對強弱指標 (Relative Strength Index)",
      explanation: "衡量一定期間內多空買賣力道強弱的震盪指標（0~100）。>70 為超買過熱區、<30 為超賣低迷區，50 以上代表多頭力道佔優，未達極端值代表健康推升。"
    };
  }
  if (title.includes("KD")) {
    return {
      label: "隨機指標 (Stochastic Oscillator KD)",
      explanation: "藉由最高價、最低價與收盤價計算當前股價在近期區間的相對強弱位置。K 值反應靈敏、D 值為平滑訊號。K > D 形成多頭優勢向上發散；若在 20 以下發生黃金交叉常為極佳買點。"
    };
  }
  if (title.includes("MACD")) {
    return {
      label: "平滑異同移動平均線 (MACD)",
      explanation: "由快慢兩條指數平滑移動平均線（EMA12 - EMA26 = DIF）與其訊號線（MACD9）之差離值（OSC 柱狀圖）組成。柱狀體為正且向上放大代表多頭動能加速發散。"
    };
  }
  if (title.includes("OBV")) {
    return {
      label: "能量潮指標 (On-Balance Volume)",
      explanation: "將成交量根據每日股價漲跌進行累加，用以觀測主力資金進出與量價配合結構。OBV 高於其均線代表資金持續淨流入，量先價行，多頭結構扎實。"
    };
  }
  if (title.includes("威廉指標")) {
    return {
      label: "威廉指標 (Williams %R)",
      explanation: "反向震盪指標（0 至 -100），衡量市場超買超賣程度。>-20 為高檔超買超熱區、<-80 為低檔超賣區，-20~-80 之間代表震盪平衡無過熱風險。"
    };
  }
  if (title.includes("ATR")) {
    return {
      label: "真實波動區間 (Average True Range)",
      explanation: "衡量股價真實震盪幅度的波動度指標。ATR 處於常態範圍代表波動穩定；可作為動態風控基準（一般建議以 2 倍 ATR 作為移動停損點）。"
    };
  }
  return {
    label: "量化技術分析指標",
    explanation: "透過數學統計與歷史價量運算，提供客觀量化交易參考依據。"
  };
};

const getTechChartType = (title: string): "main" | SubChartType => {
  if (title.includes("KD")) return "kd";
  if (title.includes("MACD")) return "macd";
  if (title.includes("RSI")) return "rsi";
  if (title.includes("OBV")) return "obv";
  if (title.includes("威廉")) return "wr";
  if (title.includes("ATR")) return "atr";
  return "main";
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
  
  // 主題與 Modal 狀態
  const [theme] = useAppTheme();
  const isWarm = theme === "warm";
  const [showFundModal, setShowFundModal] = useState(false);
  const [showAIModal, setShowAIModal] = useState(false);
  const [showFsModal, setShowFsModal] = useState(false);
  const [showTechModal, setShowTechModal] = useState(false);
  const [activeTechChart, setActiveTechChart] = useState<"main" | SubChartType | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [aiModalFilter, setAiModalFilter] = useState<"ALL" | "OHLCV" | "Fundamental" | "Valuation" | "Safety">("ALL");
  const [fundData, setFundData] = useState<any>(null);
  const [fundLoading, setFundLoading] = useState(false);
  const [fundTab, setFundTab] = useState<"income" | "balance" | "cashflow">("income");
  const [fundFreq, setFundFreq] = useState<"annual" | "quarterly">("quarterly");
  const inputRef = useRef<HTMLInputElement>(null);

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => !prev);
    setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
  };

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
    setOhlcv(null);
    setInfo(null);
    setAutocomplete([]);
    try {
      const data = await stockService.getStockData(target, "1y");
      const stockOhlcv: OhlcvData = data.ohlcv;
      const stockInfo: StockInfoFull = { ...data.info } as StockInfoFull;

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
      newsService.getNews(searchName)
        .then((n) => setNews(n))
        .catch(() => {});
    } catch (e: any) {
      setError(e?.message || String(e) || "無法連線取得該標的之即時行情資料，請檢查網路連線後重試。");
      setOhlcv(null);
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }, [query, stockDb]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") doAnalysis();
  };

  const fetchFundamentals = async () => {
    if (!info) return;
    setFundLoading(true);
    setShowFundModal(true);
    setFundData(null);
    try {
      const data = await fundamentalService.getDetailedFundamentals(info.symbol);
      setFundData(data);
    } catch (e) {
      console.error(e);
      setFundData({ error: String(e) });
    } finally {
      setFundLoading(false);
    }
  };

  // ── 基本面評分
  const fs = info ? computeFundamentalScore(info) : null;
  const fsScore = fs?.score ?? 0;
  const fsGrade = (() => {
    if (fsScore >= 10) return { label: "S 頂級", color: "#4ade80", bg: "rgba(74,222,128,0.1)", border: "rgba(74,222,128,0.4)" };
    if (fsScore >= 7) return { label: "A 優質", color: "#38bdf8", bg: "rgba(56,189,248,0.1)", border: "rgba(56,189,248,0.4)" };
    if (fsScore >= 4) return { label: "B 良好", color: "#818cf8", bg: "rgba(129,140,248,0.1)", border: "rgba(129,140,248,0.4)" };
    if (fsScore >= 1) return { label: "C 普通", color: "#facc15", bg: "rgba(250,204,21,0.1)", border: "rgba(250,204,21,0.4)" };
    if (fsScore >= -2) return { label: "D 偏弱", color: "#fb923c", bg: "rgba(251,146,60,0.1)", border: "rgba(251,146,60,0.4)" };
    return { label: "F 危險", color: "#ef4444", bg: "rgba(239,68,68,0.15)", border: "rgba(239,68,68,0.4)" };
  })();

  // ── 技術建議
  const finalScore = techScore - risks.length;
  const advice = (() => {
    if (finalScore >= 3) return { title: "🚀 強力買進 (Strong Buy)", color: "#38bdf8", bg: "rgba(56,189,248,0.08)", border: "rgba(56,189,248,0.35)" };
    if (finalScore >= 1) return { title: "📈 偏多進場 (Bullish)", color: "#818cf8", bg: "rgba(129,140,248,0.08)", border: "rgba(129,140,248,0.25)" };
    if (finalScore <= -3) return { title: "💀 建議賣出 (Sell)", color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.4)" };
    if (finalScore <= -1) return { title: "📉 偏空觀望 (Bearish)", color: "#f87171", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.3)" };
    return { title: "⚖️ 中性持有 (Hold)", color: "#b0bec5", bg: "rgba(176,190,197,0.05)", border: "rgba(176,190,197,0.2)" };
  })();

  const changeAmt =
    info?.current_price && info?.previous_close
      ? info.current_price?.value - info.previous_close?.value
      : null;
  const changePct =
    info?.current_price && info?.previous_close
      ? ((info.current_price?.value - info.previous_close?.value) / info.previous_close?.value) * 100
      : null;

  return (
    <div className="analysis-layout">
      {/* ─── 左側資訊面板 ─────────────────────────────────────────── */}
      <div className="analysis-sidebar" style={{ display: sidebarCollapsed ? "none" : "flex" }}>
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
                background: isWarm ? "#fffcf5" : "#1a1a2e", border: isWarm ? "1px solid rgba(140, 110, 80, 0.25)" : "1px solid rgba(255,255,255,0.12)",
                borderRadius: "var(--radius-sm)", maxHeight: "220px", overflowY: "auto",
                boxShadow: isWarm ? "0 10px 25px rgba(90, 60, 30, 0.12)" : "var(--shadow-card)",
              }}>
                {autocomplete.map((s) => (
                  <div key={s.symbol} onClick={() => { setQuery(s.symbol); doAnalysis(s.symbol); }}
                    style={{ padding: "8px 12px", cursor: "pointer", fontSize: "0.85rem", display: "flex", gap: "8px" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = isWarm ? "rgba(217, 119, 6, 0.08)" : "rgba(77,148,255,0.1)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                    <span style={{ color: isWarm ? "#0284c7" : "var(--accent-blue)", fontWeight: 700 }}>{s.symbol.split(".")[0]}</span>
                    <span style={{ color: isWarm ? "#18181b" : "var(--text-secondary)" }}>{s.name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-primary" onClick={() => doAnalysis()} disabled={loading}>
            {loading ? <span className="loading-spinner" /> : "分析"}
          </button>
          <button
            className="btn btn-outline"
            onClick={toggleSidebar}
            title="隱藏側欄 (全螢幕 K 線圖)"
            style={{ padding: "0 10px", fontSize: "0.85rem", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            ◀
          </button>
        </div>

        {/* 錯誤訊息 */}
        {error && (
          <div style={{ margin: "8px 14px", padding: "8px 12px", background: isWarm ? "rgba(220, 38, 38, 0.08)" : "rgba(255,82,82,0.1)", border: isWarm ? "1px solid rgba(220, 38, 38, 0.25)" : "1px solid rgba(255,82,82,0.3)", borderRadius: "var(--radius-sm)", fontSize: "0.82rem", color: isWarm ? "#dc2626" : "#ef9a9a" }}>
            {error}
          </div>
        )}

        {/* 內容 */}
        <div className="analysis-info">
          {loading && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", gap: "14px" }}>
              <div style={{ fontSize: "2.5rem" }}>⏳</div>
              <div style={{ color: isWarm ? "#0284c7" : "#38bdf8", fontWeight: 700, fontSize: "1.05rem" }}>正在連線取得即時行情...</div>
              <div style={{ color: isWarm ? "#57534e" : "#94a3b8", fontSize: "0.82rem", textAlign: "center" }}>正在同步台灣證券交易所與櫃買中心數據，絕不產生虛擬數據</div>
            </div>
          )}

          {!info && !loading && (
            <div className="empty-state">
              <div className="empty-icon">📊</div>
              <div className="empty-text">輸入股票代碼開始分析</div>
            </div>
          )}

          {!loading && info && (
            <>
              {/* 股票名稱與現價 */}
              <div style={{ marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ fontSize: "1.15rem", fontWeight: 700, color: isWarm ? "#18181b" : "var(--text-primary)" }}>{info.name}</div>
                  <AddToWatchlistBtn symbol={info.symbol} text="⭐ 加入收藏" style={{ fontSize: "0.8rem", padding: "4px 10px" }} />
                </div>
                <div style={{ fontSize: "0.82rem", color: isWarm ? "#57534e" : "#94a3b8", marginBottom: "6px" }}>{info.symbol}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
                  <span style={{ fontSize: "1.6rem", fontWeight: 700, color: changeAmt != null && changeAmt >= 0 ? (isWarm ? "#dc2626" : "var(--accent-red)") : (isWarm ? "#15803d" : "var(--accent-green)") }}>
                    {fmtPrice(info.current_price?.value)}
                  </span>
                  {changeAmt != null && changePct != null && !isNaN(changePct) && (
                    <span style={{ fontSize: "0.95rem", color: changeAmt >= 0 ? (isWarm ? "#dc2626" : "var(--accent-red)") : (isWarm ? "#15803d" : "var(--accent-green)"), fontWeight: 600 }}>
                      {changeAmt >= 0 ? "▲" : "▼"} {Math.abs(changeAmt).toFixed(2)} ({changeAmt >= 0 ? "+" : ""}{changePct.toFixed(2)}%)
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

              {/* 技術建議 (點擊展開 8 大技術指標智慧診斷全景視窗) */}
              <div
                className="advice-card"
                onClick={() => setShowTechModal(true)}
                style={{
                  background: advice.bg,
                  borderColor: advice.border,
                  cursor: "pointer",
                  transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
                }}
                title="點擊展開 8 大技術指標智慧診斷全景視窗"
              >
                <div className="advice-title" style={{ color: advice.color }}>{advice.title}</div>
                <div className="advice-desc" style={{ color: isWarm ? "#57534e" : "var(--text-secondary)" }}>
                  綜合評分：<b style={{ color: advice.color }}>{(finalScore ?? 0) > 0 ? "+" : ""}{finalScore != null && !isNaN(finalScore) ? finalScore.toFixed(1) : "0.0"}</b> 分
                </div>
              </div>

              {/* 🧠 Data-backed Multi-Factor Model v1 多因子量化診斷卡片 */}
              {(() => {
                const aiResult = evaluateAIAlpha(info, info.current_price?.value || 0, info.previous_close?.value || (info.current_price?.value || 0), ohlcv);
                const winRate = aiResult.winRatePct;
                const alphaColor = winRate >= 75 ? (isWarm ? "#0284c7" : "#38bdf8") : winRate >= 50 ? (isWarm ? "#7e22ce" : "#c084fc") : (isWarm ? "#dc2626" : "#ef4444");
                const dq = aiResult.dataQuality;

                return (
                  <div
                    className="score-card"
                    onClick={() => setShowAIModal(true)}
                    style={{
                      background: isWarm ? "linear-gradient(135deg, rgba(217, 119, 6, 0.08), rgba(245, 158, 11, 0.12))" : "linear-gradient(135deg, rgba(123, 31, 162, 0.18), rgba(74, 20, 140, 0.28))",
                      borderColor: isWarm ? "rgba(217, 119, 6, 0.35)" : "rgba(168, 85, 247, 0.5)",
                      marginBottom: "12px",
                      boxShadow: isWarm ? "0 4px 14px rgba(217, 119, 6, 0.1)" : "0 4px 14px rgba(123, 31, 162, 0.15)",
                      cursor: "pointer",
                      transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
                    }}
                    title="點擊展開 AI 多因子量化全景診斷視窗"
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontWeight: 700, fontSize: "0.95rem", color: isWarm ? "#9a3412" : "#e9d5ff" }}>
                        <span>🧠 CPU 內建 AI 多因子診斷 (量化校準版)</span>
                      </div>
                      <HardwareBadge />
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: isWarm ? "rgba(255, 255, 255, 0.95)" : "rgba(0,0,0,0.28)", padding: "10px 12px", borderRadius: "8px", marginBottom: "10px", border: isWarm ? "1px solid rgba(140, 110, 80, 0.15)" : "none" }}>
                      <div>
                        <div style={{ fontSize: "0.76rem", color: isWarm ? "#57534e" : "#cbd5e1", marginBottom: "2px" }}>預估 20 日超額勝率</div>
                        <div style={{ fontSize: "1.45rem", fontWeight: 800, color: alphaColor }}>
                          {winRate.toFixed(1)}%
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontSize: "0.76rem", color: isWarm ? "#57534e" : "#cbd5e1", marginBottom: "2px" }}>AI 置信評級</div>
                        <div style={{ fontSize: "0.92rem", fontWeight: 700, color: alphaColor }}>
                          {aiResult.convictionTier}
                        </div>
                      </div>
                    </div>

                    {/* 勝率光條 */}
                    <div style={{ height: "6px", width: "100%", background: isWarm ? "rgba(140, 110, 80, 0.15)" : "rgba(255,255,255,0.1)", borderRadius: "3px", overflow: "hidden", marginBottom: "12px" }}>
                      <div style={{ height: "100%", width: `${winRate}%`, background: winRate >= 70 ? (isWarm ? "linear-gradient(90deg, #0284c7, #7e22ce)" : "linear-gradient(90deg, #38bdf8, #a855f7)") : (isWarm ? "linear-gradient(90deg, #d97706, #dc2626)" : "linear-gradient(90deg, #f59e0b, #ef4444)"), transition: "width 0.6s ease" }} />
                    </div>

                    {/* 🛡️ 資料品質與可信度分析 (Data Quality Report) */}
                    <div style={{
                      background: isWarm ? "rgba(255, 255, 255, 0.95)" : "rgba(15, 23, 42, 0.5)",
                      border: isWarm ? "1px solid rgba(140, 110, 80, 0.18)" : "1px solid rgba(148, 163, 184, 0.2)",
                      borderRadius: "6px",
                      padding: "8px 10px",
                      fontSize: "0.75rem"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                        <span style={{ fontWeight: 700, color: isWarm ? "#18181b" : "#cbd5e1" }}>
                          📊 資料品質評分：
                          <b style={{ color: dq.overallScore >= 80 ? (isWarm ? "#15803d" : "#4ade80") : dq.overallScore >= 50 ? (isWarm ? "#d97706" : "#facc15") : (isWarm ? "#dc2626" : "#f87171") }}>
                            {dq.overallScore} / 100
                          </b>
                          {dq.isDegraded && <span style={{ color: isWarm ? "#dc2626" : "#f87171", marginLeft: "6px" }}>(⚠️ 核心財報有缺項)</span>}
                        </span>
                        <span style={{ color: isWarm ? "#57534e" : "#94a3b8" }}>{dq.availableCount} / {dq.totalRequired} 指標完備</span>
                      </div>
                      <div style={{ display: "flex", gap: "8px", color: isWarm ? "#57534e" : "#94a3b8", fontSize: "0.70rem" }}>
                        <span>財報獲利: {dq.financialCompleteness}%</span>
                        <span>・ 官方估值: {dq.valuationCompleteness}%</span>
                        <span>・ 財務安全: {dq.financialSafetyCompleteness}%</span>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 基本面評分卡 (點擊彈出全景明細) */}
              {fs && (
                <div
                  className="score-card"
                  onClick={() => setShowFsModal(true)}
                  style={{
                    background: fsGrade.bg,
                    borderColor: fsGrade.border,
                    marginBottom: "12px",
                    cursor: "pointer",
                    transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
                  }}
                  title="點擊展開基本面完整評分與各項指標明細"
                >
                  <div className="score-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div className="score-grade" style={{ color: fsGrade.color, fontWeight: 700 }}>
                      📊 基本面：{fsGrade.label} <span style={{ fontSize: "0.72rem", color: isWarm ? "#57534e" : "rgba(255,255,255,0.6)", fontWeight: 400 }}>(2026 Q2 累計)</span>
                    </div>
                    <div className="score-num" style={{ color: isWarm ? "#18181b" : "var(--text-secondary)", fontSize: "0.85rem" }}>
                      評分 <b style={{ color: fsGrade.color }}>{fsScore > 0 ? "+" : ""}{fsScore}</b>
                      &nbsp;｜ ✅{fs.passed.length} ❌{fs.failed.length} ⬜{fs.na.length}
                    </div>
                  </div>
                </div>
              )}

              {/* 獲利能力 */}
              <div className="info-section">
                <div className="info-section-header"><span style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700 }}>一、獲利能力</span> <span style={{ fontSize: "0.80rem", color: isWarm ? "#0284c7" : "#93c5fd", fontWeight: 600 }}>(2026 Q2 財報 / 7月營收)</span></div>
                <div className="info-section-body">
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("EPS")}>EPS <small style={{ color: isWarm ? "#0284c7" : "#38bdf8", fontSize: "0.78rem", fontWeight: 700 }}>(TTM)</small></span><span className="info-value" style={{ color: (info.eps?.value ?? 0) < 0 ? (isWarm ? "#dc2626" : "#ff5252") : (info.eps?.value ?? 0) >= 6 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#18181b" : "#ffffff"), fontWeight: 800, fontSize: "1.02rem" }}>{n2s(info.eps?.value)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("ROE")}>ROE <small style={{ color: isWarm ? "#0284c7" : "#38bdf8", fontSize: "0.78rem", fontWeight: 700 }}>(Q2累計)</small></span><span className="info-value" style={{ color: (info.roe?.value ?? 0) < 0 ? (isWarm ? "#dc2626" : "#ff5252") : (info.roe?.value ?? 0) >= 0.15 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#18181b" : "#ffffff"), fontWeight: 800, fontSize: "1.02rem" }}>{pct(info.roe?.value)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("毛利率")}>毛利率 <small style={{ color: isWarm ? "#0284c7" : "#38bdf8", fontSize: "0.78rem", fontWeight: 700 }}>(Q2)</small></span><span className="info-value" style={{ color: (info.gross_margins?.value ?? 0) < 0.10 ? (isWarm ? "#dc2626" : "#ff5252") : (info.gross_margins?.value ?? 0) >= 0.35 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#18181b" : "#ffffff"), fontWeight: 800, fontSize: "1.02rem" }}>{pct(info.gross_margins?.value)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("營業利益率")}>營業利益率 <small style={{ color: isWarm ? "#0284c7" : "#38bdf8", fontSize: "0.78rem", fontWeight: 700 }}>(Q2)</small></span><span className="info-value" style={{ color: (info.operating_margins?.value ?? 0) < 0 ? (isWarm ? "#dc2626" : "#ff5252") : (info.operating_margins?.value ?? 0) >= 0.15 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#18181b" : "#ffffff"), fontWeight: 800, fontSize: "1.02rem" }}>{pct(info.operating_margins?.value)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("淨利率")}>淨利率 <small style={{ color: isWarm ? "#0284c7" : "#38bdf8", fontSize: "0.78rem", fontWeight: 700 }}>(Q2)</small></span><span className="info-value" style={{ color: (info.profit_margins?.value ?? 0) < 0 ? (isWarm ? "#dc2626" : "#ff5252") : (info.profit_margins?.value ?? 0) >= 0.15 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#18181b" : "#ffffff"), fontWeight: 800, fontSize: "1.02rem" }}>{pct(info.profit_margins?.value)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("營收YoY")}>營收成長 YoY <small style={{ color: isWarm ? "#0284c7" : "#38bdf8", fontSize: "0.78rem", fontWeight: 700 }}>(2026/07)</small></span><span className="info-value" style={{ color: (info.revenue_growth?.value ?? 0) < 0 ? (isWarm ? "#dc2626" : "#ff5252") : (info.revenue_growth?.value ?? 0) >= 0.15 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#18181b" : "#ffffff"), fontWeight: 800, fontSize: "1.02rem" }}>{pct(info.revenue_growth?.value)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("盈餘YoY")}>盈餘成長 YoY <small style={{ color: isWarm ? "#0284c7" : "#38bdf8", fontSize: "0.78rem", fontWeight: 700 }}>(Q2)</small></span><span className="info-value" style={{ color: (info.earnings_growth?.value ?? 0) < 0 ? (isWarm ? "#dc2626" : "#ff5252") : (info.earnings_growth?.value ?? 0) >= 0.20 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#18181b" : "#ffffff"), fontWeight: 800, fontSize: "1.02rem" }}>{pct(info.earnings_growth?.value)}</span></div>
                </div>
              </div>

              {/* 財務穩健度 */}
              <div className="info-section">
                <div className="info-section-header"><span style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700 }}>二、財務穩健度</span> <span style={{ fontSize: "0.80rem", color: isWarm ? "#0284c7" : "#93c5fd", fontWeight: 600 }}>(2026 Q2 資產負債與現金流)</span></div>
                <div className="info-section-body">
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("自由現金流")}>自由現金流</span><span className="info-value" style={{ color: (info.free_cashflow?.value ?? 0) < 0 ? (isWarm ? "#dc2626" : "#ff5252") : (isWarm ? "#15803d" : "#4ade80"), fontWeight: 800, fontSize: "1.02rem" }}>{fmtNum(info.free_cashflow?.value)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("營業現金流")}>營業現金流</span><span className="info-value" style={{ color: (info.operating_cashflow?.value ?? 0) < 0 ? (isWarm ? "#dc2626" : "#ff5252") : (isWarm ? "#15803d" : "#4ade80"), fontWeight: 800, fontSize: "1.02rem" }}>{fmtNum(info.operating_cashflow?.value)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("流動比率")}>流動比率</span><span className="info-value" style={{ color: (info.current_ratio?.value ?? 2) < 1.0 ? (isWarm ? "#dc2626" : "#ff5252") : (isWarm ? "#18181b" : "#ffffff"), fontWeight: 800, fontSize: "1.02rem" }}>{n2s(info.current_ratio?.value)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("速動比率")}>速動比率</span><span className="info-value" style={{ color: (info.quick_ratio?.value ?? 2) < 1.0 ? (isWarm ? "#dc2626" : "#ff5252") : (isWarm ? "#18181b" : "#ffffff"), fontWeight: 800, fontSize: "1.02rem" }}>{n2s(info.quick_ratio?.value)}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("負債/權益比")}>負債/權益比</span><span className="info-value" style={{ color: (info.debt_to_equity?.value ?? 0) > 200 ? (isWarm ? "#dc2626" : "#ff5252") : (info.debt_to_equity?.value ?? 100) <= 60 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#18181b" : "#ffffff"), fontWeight: 800, fontSize: "1.02rem" }}>{info.debt_to_equity?.value != null && !isNaN(info.debt_to_equity?.value) ? `${info.debt_to_equity?.value.toFixed(1)}%` : "N/A"}</span></div>
                  <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("自有資本率")}>自有資本率</span><span className="info-value" style={{ color: (calcEquityRatio(info) ?? 100) < 30 ? (isWarm ? "#dc2626" : "#ff5252") : (calcEquityRatio(info) ?? 0) >= 50 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#18181b" : "#ffffff"), fontWeight: 800, fontSize: "1.02rem" }}>{fmtEquityRatio(info)}</span></div>
                </div>
              </div>

              {/* 估值指標 */}
              {(() => {
                const coId = info.symbol.split(".")[0];
                const fund = (twseFundamentals as Record<string, any>)[coId];
                const cashDiv = fund?.cash_dividend != null ? Number(fund.cash_dividend) : 0;
                const stockDiv = fund?.stock_dividend != null ? Number(fund.stock_dividend) : 0;
                const exType = stockDiv > 0 && cashDiv > 0 ? "除權息" : stockDiv > 0 ? "除權" : cashDiv > 0 ? "除息" : "無配息";

                return (
                  <div className="info-section">
                    <div className="info-section-header"><span style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700 }}>三、估值與除權息指標</span> <span style={{ fontSize: "0.80rem", color: isWarm ? "#0284c7" : "#93c5fd", fontWeight: 600 }}>(最新公佈 / 每日收盤)</span></div>
                    <div className="info-section-body">
                      <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("PE")}>本益比 (PE)</span><span className="info-value" style={{ color: isWarm ? "#0284c7" : "#60a5fa", fontWeight: 800, fontSize: "1.02rem" }}>{n2s(info.tw_pe?.value ?? info.pe?.value)}</span></div>
                      <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("PB")}>股價淨值比 (PB)</span><span className="info-value" style={{ color: isWarm ? "#0284c7" : "#60a5fa", fontWeight: 800, fontSize: "1.02rem" }}>{n2s(info.tw_pb?.value ?? info.pb?.value)}</span></div>
                      <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("殖利率")}>現金殖利率</span><span className="info-value" style={{ color: isWarm ? "#b45309" : "#facc15", fontWeight: 800, fontSize: "1.02rem" }}>{pct(info.tw_yield?.value ?? info.dividend_yield?.value)}</span></div>
                      <div className="info-row"><span className="info-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }}>每股現金股利 (除息)</span><span className="info-value" style={{ color: isWarm ? "#b45309" : "#facc15", fontWeight: 800, fontSize: "1.02rem" }}>{cashDiv > 0 ? `${cashDiv.toFixed(2)} 元` : "無配息"}</span></div>
                      <div className="info-row"><span className="info-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }}>每股股票股利 (除權)</span><span className="info-value" style={{ color: stockDiv > 0 ? (isWarm ? "#7e22ce" : "#c084fc") : (isWarm ? "#57534e" : "#94a3b8"), fontWeight: 800, fontSize: "1.02rem" }}>{stockDiv > 0 ? `${stockDiv.toFixed(2)} 元` : "0.00 元 (未除權)"}</span></div>
                      <div className="info-row"><span className="info-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }}>除權息性質</span><span className="info-value" style={{ color: isWarm ? "#0284c7" : "#38bdf8", fontWeight: 800, fontSize: "0.95rem" }}>{exType}</span></div>
                      <div className="info-row"><span className="info-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }}>除息交易日</span><span className="info-value" style={{ color: fund?.ex_dividend_date ? (isWarm ? "#b45309" : "#facc15") : (isWarm ? "#57534e" : "#94a3b8"), fontWeight: 800, fontSize: "0.95rem" }}>{fund?.ex_dividend_date || "尚待公告"}</span></div>
                      <div className="info-row"><span className="info-label" style={{ color: isWarm ? "#57534e" : "#cbd5e1", fontSize: "0.82rem" }}>二代健保補充保費 (2.11%)</span><span className="info-value" style={{ color: isWarm ? "#57534e" : "#cbd5e1", fontSize: "0.82rem" }}>單筆達 2 萬元代扣 2.11%</span></div>
                      <div className="info-row"><span className="info-label" style={{ color: isWarm ? "#57534e" : "#cbd5e1", fontSize: "0.82rem" }}>股利抵減稅額 (8.5%)</span><span className="info-value" style={{ color: isWarm ? "#0284c7" : "#38bdf8", fontSize: "0.82rem" }}>可抵減稅額 8.5% (上限 8 萬)</span></div>
                      <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("市值")}>市值</span><span className="info-value" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 800, fontSize: "1.02rem" }}>{fmtNum(info.market_cap?.value)}</span></div>
                      <div className="info-row"><span className="info-label clickable-label" style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700, fontSize: "0.95rem" }} onClick={() => showMetricExplanation("所屬產業")}>所屬產業</span><span className="info-value" style={{ color: isWarm ? "#0284c7" : "#67e8f9", fontWeight: 700, fontSize: "0.92rem" }}>{info.sector ?? "N/A"}</span></div>
                    </div>
                  </div>
                );
              })()}

              {/* 業務介紹 */}
              {(() => {
                const coId = info.symbol.split(".")[0];
                const summary = getCompanyBusinessSummary(coId, info.symbol, info.name || info.symbol, info.sector || undefined);
                return (
                  <div className="info-section">
                    <div className="info-section-header"><span style={{ color: isWarm ? "#18181b" : "#ffffff", fontWeight: 700 }}>🏢 四、公司業務與營業項目介紹</span> <span style={{ fontSize: "0.80rem", color: isWarm ? "#0284c7" : "#93c5fd", fontWeight: 600 }}>(官方公開資訊與產業深度分析)</span></div>
                    <div className="info-section-body" style={{ fontSize: "0.86rem", color: isWarm ? "#292524" : "#e2e8f0", lineHeight: 1.75, whiteSpace: "pre-line", padding: "10px 14px", background: isWarm ? "rgba(255, 255, 255, 0.95)" : "rgba(15, 23, 42, 0.4)", border: isWarm ? "1px solid rgba(140, 110, 80, 0.15)" : "none", borderRadius: "6px" }}>
                      {summary}
                    </div>
                  </div>
                );
              })()}

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
                              stockService.openUrl(item.link);
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
                  stockService.openUrl(`https://www.cmoney.tw/forum/stock/${code}`);
                }}>股市同學會</button>
                <button className="btn btn-outline btn-sm" onClick={() => {
                  stockService.openUrl(`https://tw.stock.yahoo.com/quote/${info.symbol}`);
                }}>Yahoo 股市</button>
                <button className="btn btn-outline btn-sm" onClick={() => {
                  const code = info.symbol.split(".")[0];
                  stockService.openUrl(`https://goodinfo.tw/tw/StockDetail.asp?STOCK_ID=${code}`);
                }}>Goodinfo</button>
                <button className="btn btn-primary btn-sm" onClick={fetchFundamentals}>
                  📊 詳細基本面
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ─── 右側圖表區 ─────────────────────────────────────────────── */}
      <div className="analysis-chart-area">
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {sidebarCollapsed && (
              <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <button
                  onClick={toggleSidebar}
                  style={{
                    background: "rgba(56, 189, 248, 0.15)",
                    border: "1px solid rgba(56, 189, 248, 0.4)",
                    color: "#38bdf8",
                    borderRadius: "6px",
                    padding: "3px 9px",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  ▶ 展開側欄
                </button>
              </div>
            )}
            <div className="empty-state" style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "16px" }}>
              <div style={{ fontSize: "3.5rem" }}>⏳</div>
              <div style={{ fontSize: "1.2rem", color: "#38bdf8", fontWeight: 700 }}>正在載入真實交易 K 線與技術指標...</div>
              <div style={{ fontSize: "0.85rem", color: "#94a3b8" }}>正在安全連線官方行情資料集，絕不捏造虛假數據</div>
            </div>
          </div>
        ) : ohlcv && ind ? (
          <ChartPanel
            ohlcv={ohlcv}
            ind={ind}
            symbol={info?.symbol ?? ""}
            name={info?.name ?? ""}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {sidebarCollapsed && (
              <div style={{ padding: "8px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <button
                  onClick={toggleSidebar}
                  style={{
                    background: "rgba(56, 189, 248, 0.15)",
                    border: "1px solid rgba(56, 189, 248, 0.4)",
                    color: "#38bdf8",
                    borderRadius: "6px",
                    padding: "3px 9px",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  ▶ 展開側欄
                </button>
              </div>
            )}
            <div className="empty-state" style={{ flex: 1 }}>
              <div className="empty-icon">📈</div>
              <div className="empty-text">{error ? error : "輸入股票代碼並點擊「分析」以載入即時行情"}</div>
            </div>
          </div>
        )}
      </div>
      {/* 搜尋結果多選 Modal */}
      {searchModalItems.length > 0 && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: isWarm ? "rgba(40, 30, 20, 0.4)" : "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          zIndex: 9999, display: "flex", justifyContent: "center", alignItems: "center"
        }} onClick={() => setSearchModalItems([])}>
          <div style={{
            background: isWarm ? "rgba(255, 252, 245, 0.98)" : "#1a1a24", borderRadius: "12px", width: "400px", maxWidth: "90%",
            maxHeight: "80vh", display: "flex", flexDirection: "column", border: isWarm ? "1px solid rgba(140, 110, 80, 0.25)" : "1px solid rgba(255,255,255,0.1)",
            color: isWarm ? "#18181b" : "#ffffff", boxShadow: isWarm ? "0 20px 40px rgba(90,60,30,0.15)" : "0 20px 40px rgba(0,0,0,0.5)"
          }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "16px", borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.15)" : "1px solid rgba(255,255,255,0.1)", display: "flex", justifyContent: "space-between" }}>
              <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: isWarm ? "#18181b" : "#ffffff" }}>請選擇標的 ({searchModalItems.length} 筆相符)</h3>
              <button className="btn btn-outline btn-sm" onClick={() => setSearchModalItems([])}>✕</button>
            </div>
            <div style={{ overflowY: "auto", padding: "8px" }}>
              {searchModalItems.map(s => (
                <div key={s.symbol} onClick={() => { setQuery(s.symbol.split(".")[0]); doAnalysis(s.symbol); }}
                  style={{
                    padding: "12px", cursor: "pointer", borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.08)" : "1px solid rgba(255,255,255,0.05)",
                    display: "flex", justifyContent: "space-between", alignItems: "center"
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = isWarm ? "rgba(217, 119, 6, 0.08)" : "rgba(255,255,255,0.05)"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  <span style={{ fontWeight: "bold", color: isWarm ? "#18181b" : "#ffffff" }}>{s.name}</span>
                  <span style={{ color: isWarm ? "#57534e" : "rgba(255,255,255,0.5)", fontSize: "0.9rem" }}>{s.symbol}</span>
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
          } else if (rowConfig.calc === "equityRatio") {
            const eq = getSingleVal(statement, "totalStockholderEquity") ?? getSingleVal(statement, "equity") ?? getSingleVal(statement, "netWorth");
            const ta = getSingleVal(statement, "totalAssets");
            if (eq !== null && ta !== null && ta > 0) return (eq / ta) * 100;
          } else if (rowConfig.calc === "debtRatio") {
            const tl = getSingleVal(statement, "totalLiabilities");
            const ta = getSingleVal(statement, "totalAssets");
            if (tl !== null && ta !== null && ta > 0) return (tl / ta) * 100;
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
          { keys: ["equityRatio"], calc: "equityRatio", isRatio: true, label: "自有資本率 (Equity Ratio, 權益/資產)" },
          { keys: ["debtRatio"], calc: "debtRatio", isRatio: true, label: "負債比率 (Debt Ratio, 負債/資產)" },
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
                borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.15)" : "1px solid rgba(255,255,255,0.1)", 
                display: "flex", 
                justifyContent: "space-between",
                alignItems: "center"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "1.3rem" }}>📊</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: isWarm ? "#18181b" : "#ffffff" }}>詳細基本面 - {info?.name}</h3>
                    <span style={{ fontSize: "0.75rem", color: isWarm ? "#57534e" : "#94a3b8" }}>{info?.symbol}</span>
                  </div>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => setShowFundModal(false)} style={{ minWidth: "32px", padding: 0, height: "32px", borderRadius: "50%" }}>✕</button>
              </div>

              {/* Sub-header / Tabs */}
              <div style={{ 
                padding: "12px 20px", 
                borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.12)" : "1px solid rgba(255,255,255,0.06)", 
                display: "flex", 
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: "12px",
                background: isWarm ? "rgba(245, 238, 225, 0.4)" : "rgba(255,255,255,0.01)"
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
                <div style={{ display: "flex", gap: "6px", background: isWarm ? "rgba(140, 110, 80, 0.1)" : "rgba(255,255,255,0.05)", padding: "3px", borderRadius: "8px" }}>
                  <button 
                    onClick={() => setFundFreq("annual")}
                    style={{
                      border: "none",
                      background: fundFreq === "annual" ? (isWarm ? "#d97706" : "var(--btn-primary-bg, #4d94ff)") : "transparent",
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
                      background: fundFreq === "quarterly" ? (isWarm ? "#d97706" : "var(--btn-primary-bg, #4d94ff)") : "transparent",
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
              <div style={{ flex: 1, overflowY: "auto", padding: "20px", background: isWarm ? "transparent" : "#13131e" }}>
                {fundLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", height: "100%", gap: "12px" }}>
                    <span className="loading-spinner" style={{ width: "36px", height: "36px" }}></span>
                    <span style={{ color: isWarm ? "#57534e" : "#94a3b8", fontSize: "0.85rem" }}>正在從 Yahoo Finance 獲取財報資料...</span>
                  </div>
                ) : fundData?.error ? (
                  <div style={{ color: "#ff5252", padding: "20px", background: "rgba(255,82,82,0.05)", border: "1px solid rgba(255,82,82,0.2)", borderRadius: "8px" }}>
                    ⚠️ 載入失敗: {fundData.error}
                  </div>
                ) : statements.length > 0 ? (
                  <div style={{ overflowX: "auto", borderRadius: "8px", border: isWarm ? "1px solid rgba(140, 110, 80, 0.15)" : "1px solid rgba(255,255,255,0.08)" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.85rem", textAlign: "left" }}>
                      <thead>
                        <tr style={{ background: isWarm ? "rgba(140, 110, 80, 0.05)" : "rgba(255,255,255,0.03)", borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.15)" : "1px solid rgba(255,255,255,0.08)" }}>
                          <th style={{ padding: "12px 16px", color: isWarm ? "#57534e" : "#94a3b8", fontWeight: 600, minWidth: "220px", position: "sticky", left: 0, background: isWarm ? "#fafaf9" : "#161622", zIndex: 2 }}>會計項目</th>
                          {dates.map((date: string, idx: number) => (
                            <th key={idx} style={{ padding: "12px 16px", color: isWarm ? "#18181b" : "var(--text-primary)", fontWeight: 600, textAlign: "right" }}>{date}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr 
                            key={row.keys[0]} 
                            style={{ 
                              borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.08)" : "1px solid rgba(255,255,255,0.04)",
                              transition: "background 0.15s"
                            }}
                            onMouseEnter={e => e.currentTarget.style.background = isWarm ? "rgba(140, 110, 80, 0.04)" : "rgba(255,255,255,0.02)"}
                            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                          >
                            <td style={{ 
                              padding: "10px 16px", 
                              color: isWarm ? "#18181b" : "rgba(255,255,255,0.9)", 
                              fontWeight: row.keys.includes("netIncome") || row.keys.includes("totalRevenue") || row.keys.includes("totalAssets") || row.keys.includes("freeCashFlow") ? 700 : 400,
                              position: "sticky", 
                              left: 0, 
                              background: isWarm ? "rgba(255, 252, 245, 0.98)" : "#13131e",
                              zIndex: 1,
                              borderRight: isWarm ? "1px solid rgba(140, 110, 80, 0.05)" : "1px solid rgba(255,255,255,0.02)"
                            }}>
                              {row.label}
                            </td>
                            {statements.map((statement: any, sIdx: number) => {
                              const rawVal = getVal(statement, row);
                              const isImportantRow = row.keys.includes("netIncome") || row.keys.includes("totalRevenue") || row.keys.includes("totalAssets") || row.keys.includes("freeCashFlow") || row.keys.includes("equityRatio");
                              const isRatio = (row as any).isRatio;
                              return (
                                <td 
                                  key={sIdx} 
                                  style={{ 
                                    padding: "10px 16px", 
                                    textAlign: "right",
                                    color: rawVal !== null && rawVal < 0 ? "var(--accent-green)" : isImportantRow ? "var(--accent-red, #ff5252)" : "rgba(255,255,255,0.75)",
                                    fontWeight: isImportantRow ? 700 : 400
                                  }}
                                >
                                  {rawVal !== null && !isNaN(rawVal) ? (isRatio ? `${rawVal.toFixed(2)}%` : fmtNum(rawVal)) : "N/A"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "40px", color: "#94a3b8" }}>
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
                <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                  數據來源: Yahoo Finance
                </span>
                <button className="btn btn-outline btn-sm" onClick={() => setShowFundModal(false)}>關閉</button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* 🧠 AI 多因子全景診斷放大視窗 Modal */}
      {showAIModal && (() => {
        if (!info) return null;
        const aiResult = evaluateAIAlpha(info, info.current_price?.value || 0, info.previous_close?.value || (info.current_price?.value || 0), ohlcv);
        const winRate = aiResult.winRatePct;
        const alphaColor = winRate >= 75 ? (isWarm ? "#0284c7" : "#38bdf8") : winRate >= 50 ? (isWarm ? "#7e22ce" : "#c084fc") : (isWarm ? "#dc2626" : "#ef4444");
        const dq = aiResult.dataQuality;
        const ml = aiResult.mlInference;

        const filteredFactors = aiModalFilter === "ALL" 
          ? aiResult.factors 
          : aiResult.factors.filter(f => f.category === aiModalFilter);

        return (
          <div style={{
            position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
            background: isWarm ? "rgba(40, 30, 20, 0.45)" : "rgba(3, 7, 18, 0.85)", backdropFilter: "blur(12px)",
            zIndex: 25000, display: "flex", justifyContent: "center", alignItems: "center",
            padding: "20px"
          }} onClick={() => setShowAIModal(false)}>
            <div style={{
              background: isWarm ? "rgba(255, 252, 245, 0.98)" : "linear-gradient(145deg, #111827, #0f172a)",
              borderRadius: "16px", width: "960px", maxWidth: "98vw", maxHeight: "90vh",
              padding: "24px", border: isWarm ? "1px solid rgba(217, 119, 6, 0.35)" : "1px solid rgba(168, 85, 247, 0.4)",
              color: isWarm ? "#18181b" : "#ffffff",
              boxShadow: isWarm ? "0 25px 60px rgba(90, 60, 30, 0.2)" : "0 25px 60px rgba(0, 0, 0, 0.8), 0 0 35px rgba(168, 85, 247, 0.18)",
              display: "flex", flexDirection: "column", gap: "16px", overflow: "hidden"
            }} onClick={e => e.stopPropagation()}>
              
              {/* Modal Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.18)" : "1px solid rgba(255,255,255,0.1)", paddingBottom: "14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <span style={{ fontSize: "1.6rem" }}>🧠</span>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                      <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 800, color: isWarm ? "#18181b" : "#f3e8ff" }}>
                        AI 多因子量化全景診斷
                      </h3>
                      <span style={{ background: isWarm ? "rgba(217, 119, 6, 0.15)" : "rgba(168, 85, 247, 0.25)", color: isWarm ? "#b45309" : "#d8b4fe", padding: "2px 8px", borderRadius: "12px", fontSize: "0.75rem", fontWeight: 700, border: isWarm ? "1px solid rgba(217, 119, 6, 0.35)" : "1px solid rgba(168, 85, 247, 0.4)" }}>
                        Cross-Sectional ML Alpha Engine
                      </span>
                    </div>
                    <div style={{ fontSize: "0.86rem", color: isWarm ? "#57534e" : "#94a3b8", marginTop: "3px" }}>
                      標的：<b style={{ color: isWarm ? "#18181b" : "#ffffff" }}>{info.name || info.symbol} ({info.symbol})</b> ｜ 最新價：<b style={{ color: isWarm ? "#0284c7" : "#38bdf8" }}>{fmtPrice(info.current_price?.value)} 元</b> ｜ 產業：<b style={{ color: isWarm ? "#57534e" : "#cbd5e1" }}>{info.sector || "一般產業"}</b>
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <HardwareBadge />
                  <button className="btn btn-outline btn-sm" onClick={() => setShowAIModal(false)} style={{ borderRadius: "50%", width: "32px", height: "32px", padding: 0, fontSize: "1rem" }}>✕</button>
                </div>
              </div>

              {/* Modal Scrollable Body */}
              <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px", paddingRight: "6px" }}>
                
                {/* 頂部四大核心計量指標看板 */}
                <div style={{
                  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px",
                  background: isWarm ? "rgba(245, 238, 225, 0.8)" : "rgba(0,0,0,0.38)", padding: "16px", borderRadius: "12px", border: isWarm ? "1px solid rgba(140, 110, 80, 0.2)" : "1px solid rgba(255,255,255,0.06)"
                }}>
                  <div style={{ borderLeft: `3px solid ${isWarm ? "#0284c7" : "#38bdf8"}`, paddingLeft: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "0.78rem", color: isWarm ? "#57534e" : "#94a3b8", fontWeight: 600 }}>預估 20 日超額勝率</span>
                    </div>
                    <div style={{ fontSize: "1.75rem", fontWeight: 900, color: alphaColor, margin: "2px 0" }}>
                      {winRate.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: "0.72rem", color: isWarm ? "#57534e" : "#94a3b8", lineHeight: 1.3 }}>
                      歷史回測校準基準 ｜ 實扣 63.5 bps 摩擦後擊敗大盤機率
                    </div>
                  </div>
                  
                  <div style={{ borderLeft: `3px solid ${isWarm ? "#7e22ce" : "#a855f7"}`, paddingLeft: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "0.78rem", color: isWarm ? "#57534e" : "#94a3b8", fontWeight: 600 }}>預估超額 Alpha</span>
                    </div>
                    <div style={{ fontSize: "1.75rem", fontWeight: 900, color: aiResult.expectedAlphaPct >= 0 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#dc2626" : "#f87171"), margin: "2px 0" }}>
                      {aiResult.expectedAlphaPct >= 0 ? "+" : ""}{aiResult.expectedAlphaPct.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: "0.72rem", color: isWarm ? "#57534e" : "#94a3b8", lineHeight: 1.3 }}>
                      相對於大盤 T+20 淨超額 ｜ 預期領先加權指數之利潤幅度
                    </div>
                  </div>

                  <div style={{ borderLeft: `3px solid ${isWarm ? "#d97706" : "#f59e0b"}`, paddingLeft: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "0.78rem", color: isWarm ? "#57534e" : "#94a3b8", fontWeight: 600 }}>AI 置信評級</span>
                    </div>
                    <div style={{ fontSize: "1.3rem", fontWeight: 800, color: alphaColor, marginTop: "4px", marginBottom: "2px" }}>
                      {aiResult.convictionTier}
                    </div>
                    <div style={{ fontSize: "0.72rem", color: isWarm ? "#57534e" : "#94a3b8", lineHeight: 1.3 }}>
                      雙軌集成 (60% Rule + 40% ML) ｜ 截面分位強度綜合判定
                    </div>
                  </div>

                  <div style={{ borderLeft: `3px solid ${isWarm ? "#15803d" : "#10b981"}`, paddingLeft: "10px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "0.78rem", color: isWarm ? "#57534e" : "#94a3b8", fontWeight: 600 }}>資料品質完備度</span>
                    </div>
                    <div style={{ fontSize: "1.45rem", fontWeight: 800, color: dq.overallScore >= 80 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#d97706" : "#facc15"), margin: "2px 0" }}>
                      {dq.overallScore} <span style={{ fontSize: "0.85rem", fontWeight: 500, color: isWarm ? "#57534e" : "#94a3b8" }}>/ 100 ({dq.availableCount}/{dq.totalRequired})</span>
                    </div>
                    <div style={{ fontSize: "0.72rem", color: isWarm ? "#57534e" : "#94a3b8", lineHeight: 1.3 }}>
                      零未來函數 (Point-in-Time) ｜ 嚴格鎖定法定財報申報時效
                    </div>
                  </div>
                </div>

                {/* 💡 4 大核心指標深度解讀指南 */}
                <div style={{
                  background: isWarm ? "rgba(245, 238, 225, 0.6)" : "rgba(15, 23, 42, 0.6)",
                  border: isWarm ? "1px solid rgba(140, 110, 80, 0.18)" : "1px solid rgba(148, 163, 184, 0.18)",
                  borderRadius: "10px",
                  padding: "12px 14px",
                  fontSize: "0.76rem"
                }}>
                  <div style={{ fontWeight: 700, color: isWarm ? "#18181b" : "#cbd5e1", marginBottom: "8px", display: "flex", alignItems: "center", gap: "6px" }}>
                    <span>📖 4 大核心計量指標深度解讀指南</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px", color: isWarm ? "#44403c" : "#94a3b8", lineHeight: 1.45 }}>
                    <div style={{ background: isWarm ? "rgba(255, 255, 255, 0.85)" : "rgba(0,0,0,0.2)", padding: "8px", borderRadius: "6px", border: isWarm ? "1px solid rgba(140, 110, 80, 0.12)" : "none" }}>
                      <b style={{ color: isWarm ? "#0284c7" : "#38bdf8" }}>🎯 20日超額勝率：</b><br />
                      衡量自 T+1 開盤持有至 T+20 收盤，扣除 63.5 bps 總摩擦後擊敗大盤之實證機率。由 2018–2024 歷史回測分位數單調性校準。
                    </div>
                    <div style={{ background: isWarm ? "rgba(255, 255, 255, 0.85)" : "rgba(0,0,0,0.2)", padding: "8px", borderRadius: "6px", border: isWarm ? "1px solid rgba(140, 110, 80, 0.12)" : "none" }}>
                      <b style={{ color: isWarm ? "#7e22ce" : "#c084fc" }}>📈 預估超額 Alpha：</b><br />
                      預期 20 個交易日相對於加權指數的純 Alpha 淨超額幅度（+1.4% 表示預期領先大盤 1.4 個百分點）。
                    </div>
                    <div style={{ background: isWarm ? "rgba(255, 255, 255, 0.85)" : "rgba(0,0,0,0.2)", padding: "8px", borderRadius: "6px", border: isWarm ? "1px solid rgba(140, 110, 80, 0.12)" : "none" }}>
                      <b style={{ color: isWarm ? "#b45309" : "#fbbf24" }}>🧠 AI 置信評級：</b><br />
                      60% 啟發式 17 維因子 + 40% 8-Tree GBDT 決策樹雙軌集成。勝率 ≥68% 強烈看多、60~68% 穩健多頭、50~60% 中性盤整、&lt;50% 偏空避險。
                    </div>
                    <div style={{ background: isWarm ? "rgba(255, 255, 255, 0.85)" : "rgba(0,0,0,0.2)", padding: "8px", borderRadius: "6px", border: isWarm ? "1px solid rgba(140, 110, 80, 0.12)" : "none" }}>
                      <b style={{ color: isWarm ? "#15803d" : "#34d399" }}>🛡️ 資料品質完備度：</b><br />
                      計算 17 項核心因子中即時有效之比例（17/17=100分）。嚴格依據 MOPS 財報法定申報日鎖定，確認 0 未來函數洩漏。
                    </div>
                  </div>
                </div>

                {/* 機器學習 GBDT & 特徵貢獻度視圖 */}
                {ml && (
                  <div style={{
                    background: isWarm ? "rgba(240, 249, 255, 0.85)" : "linear-gradient(135deg, rgba(30, 41, 59, 0.6), rgba(15, 23, 42, 0.8))",
                    border: isWarm ? "1px solid rgba(2, 132, 199, 0.35)" : "1px solid rgba(56, 189, 248, 0.3)", borderRadius: "10px", padding: "12px 16px"
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "6px" }}>
                      <div style={{ fontWeight: 700, fontSize: "0.88rem", color: isWarm ? "#0369a1" : "#38bdf8", display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>⚡ 機器學習 Track：8-Tree GBDT + Ridge 特徵交互推論</span>
                      </div>
                      <span style={{ fontSize: "0.75rem", color: isWarm ? "#57534e" : "#94a3b8" }}>
                        ML 預估勝率：<b style={{ color: isWarm ? "#0284c7" : "#38bdf8" }}>{ml.mlWinProbabilityPct.toFixed(1)}%</b> ｜ 預估超額：<b style={{ color: ml.predictedExcessReturnPct >= 0 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#dc2626" : "#f87171") }}>{ml.predictedExcessReturnPct >= 0 ? "+" : ""}{ml.predictedExcessReturnPct.toFixed(1)}%</b>
                      </span>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {ml.topFeatureContributions?.slice(0, 6).map((fc: { feature: string; impact: number }, i: number) => (
                        <span key={i} style={{
                          background: fc.impact >= 0 ? (isWarm ? "rgba(22, 163, 74, 0.12)" : "rgba(34, 197, 94, 0.12)") : (isWarm ? "rgba(220, 38, 38, 0.12)" : "rgba(239, 68, 68, 0.12)"),
                          border: `1px solid ${fc.impact >= 0 ? (isWarm ? "rgba(22, 163, 74, 0.3)" : "rgba(34, 197, 94, 0.3)") : (isWarm ? "rgba(220, 38, 38, 0.3)" : "rgba(239, 68, 68, 0.3)")}`,
                          color: fc.impact >= 0 ? (isWarm ? "#15803d" : "#86efac") : (isWarm ? "#dc2626" : "#fca5a5"),
                          padding: "3px 8px", borderRadius: "6px", fontSize: "0.72rem", fontWeight: 600
                        }}>
                          {fc.feature}: {fc.impact >= 0 ? "+" : ""}{fc.impact.toFixed(3)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 因子分類篩選標籤 */}
                <div style={{ display: "flex", gap: "6px", borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.15)" : "1px solid rgba(255,255,255,0.08)", paddingBottom: "8px", flexWrap: "wrap" }}>
                  {[
                    { id: "ALL", label: `全部 17 維因子 (${aiResult.factors.length})` },
                    { id: "OHLCV", label: `🚀 價量動能 (${aiResult.factors.filter(f => f.category === "OHLCV").length})` },
                    { id: "Fundamental", label: `💎 基本獲利 (${aiResult.factors.filter(f => f.category === "Fundamental").length})` },
                    { id: "Valuation", label: `🏷️ 市場估值 (${aiResult.factors.filter(f => f.category === "Valuation").length})` },
                    { id: "Safety", label: `🛡️ 財務安全 (${aiResult.factors.filter(f => f.category === "Safety").length})` },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setAiModalFilter(tab.id as any)}
                      style={{
                        background: aiModalFilter === tab.id ? (isWarm ? "rgba(217, 119, 6, 0.18)" : "rgba(168, 85, 247, 0.35)") : (isWarm ? "rgba(140, 110, 80, 0.08)" : "rgba(255,255,255,0.04)"),
                        border: `1px solid ${aiModalFilter === tab.id ? (isWarm ? "rgba(217, 119, 6, 0.4)" : "rgba(168, 85, 247, 0.6)") : (isWarm ? "rgba(140, 110, 80, 0.15)" : "rgba(255,255,255,0.08)")}`,
                        color: aiModalFilter === tab.id ? (isWarm ? "#b45309" : "#f3e8ff") : (isWarm ? "#57534e" : "#94a3b8"),
                        padding: "5px 12px", borderRadius: "6px", fontSize: "0.78rem", fontWeight: aiModalFilter === tab.id ? 700 : 500,
                        cursor: "pointer", transition: "all 0.2s ease"
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* 17 維因子詳細卡片網格 */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: "10px" }}>
                  {filteredFactors.map(f => {
                    const isPos = f.status === "positive";
                    const isNeg = f.status === "negative";
                    const bg = isPos ? (isWarm ? "rgba(22, 163, 74, 0.08)" : "rgba(34, 197, 94, 0.08)") : isNeg ? (isWarm ? "rgba(220, 38, 38, 0.08)" : "rgba(239, 68, 68, 0.10)") : (isWarm ? "rgba(140, 110, 80, 0.05)" : "rgba(148, 163, 184, 0.05)");
                    const border = isPos ? (isWarm ? "rgba(22, 163, 74, 0.3)" : "rgba(34, 197, 94, 0.3)") : isNeg ? (isWarm ? "rgba(220, 38, 38, 0.3)" : "rgba(239, 68, 68, 0.3)") : (isWarm ? "rgba(140, 110, 80, 0.15)" : "rgba(148, 163, 184, 0.15)");
                    const color = isPos ? (isWarm ? "#15803d" : "#4ade80") : isNeg ? (isWarm ? "#dc2626" : "#f87171") : (isWarm ? "#57534e" : "#94a3b8");
                    const icon = isPos ? "✅" : isNeg ? "❌" : "⚪";

                    return (
                      <div key={f.name} style={{
                        background: bg, border: `1px solid ${border}`, borderRadius: "8px", padding: "10px 12px",
                        display: "flex", flexDirection: "column", gap: "4px", boxShadow: isWarm ? "0 1px 3px rgba(90, 60, 30, 0.05)" : "none"
                      }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "1rem" }}>{icon}</span>
                            <span style={{ fontWeight: 700, color: isWarm ? "#18181b" : "#f8fafc", fontSize: "0.88rem" }}>{f.label}</span>
                            <span style={{ fontSize: "0.68rem", color: isWarm ? "#57534e" : "#94a3b8", background: isWarm ? "rgba(140, 110, 80, 0.1)" : "rgba(255,255,255,0.06)", padding: "1px 6px", borderRadius: "4px" }}>
                              {f.source || "系統精算"}
                            </span>
                          </div>
                          <span style={{ fontWeight: 800, color: color, fontSize: "0.95rem" }}>
                            {f.valueDisplay}
                          </span>
                        </div>

                        <div style={{ fontSize: "0.76rem", color: isWarm ? "#44403c" : "#cbd5e1", lineHeight: 1.4, marginTop: "2px" }}>
                          {f.explanation}
                        </div>

                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: isWarm ? "1px dashed rgba(140, 110, 80, 0.15)" : "1px dashed rgba(255,255,255,0.06)", paddingTop: "4px", marginTop: "2px", fontSize: "0.70rem" }}>
                          <span style={{ color: isWarm ? "#57534e" : "#94a3b8" }}>
                            因子權重：{((f.weight || 0) * 100).toFixed(0)}%
                          </span>
                          <span style={{ color: color, fontWeight: 700 }}>
                            {isPos ? `多頭推進 (+${((f.score || 0) * (f.weight || 0)).toFixed(2)})` : isNeg ? `空頭扣分 (${((f.score || 0) * (f.weight || 0)).toFixed(2)})` : "中性"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

              </div>

              {/* Modal Footer */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: isWarm ? "1px solid rgba(140, 110, 80, 0.18)" : "1px solid rgba(255,255,255,0.1)", paddingTop: "12px" }}>
                <span style={{ fontSize: "0.75rem", color: isWarm ? "#57534e" : "#64748b" }}>
                  🔒 StockT Cross-Sectional ML Alpha Engine ｜ 點擊遮罩或按鈕即可關閉
                </span>
                <button className="btn btn-primary btn-sm" onClick={() => setShowAIModal(false)}>
                  確定關閉
                </button>
              </div>

            </div>
          </div>
        );
      })()}

      {/* 📊 基本面完整評分與指標診斷清單 Modal */}
      {showFsModal && fs && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: isWarm ? "rgba(40, 30, 20, 0.45)" : "rgba(3, 7, 18, 0.85)", backdropFilter: "blur(12px)",
          zIndex: 25000, display: "flex", justifyContent: "center", alignItems: "center",
          padding: "20px"
        }} onClick={() => setShowFsModal(false)}>
          <div style={{
            background: isWarm ? "rgba(255, 252, 245, 0.98)" : "linear-gradient(145deg, #111827, #0f172a)",
            borderRadius: "16px", width: "760px", maxWidth: "98vw", maxHeight: "90vh",
            padding: "24px", border: `1px solid ${fsGrade.border}`,
            color: isWarm ? "#18181b" : "#ffffff",
            boxShadow: isWarm ? "0 25px 60px rgba(90, 60, 30, 0.2)" : "0 25px 60px rgba(0, 0, 0, 0.8)",
            display: "flex", flexDirection: "column", gap: "16px", overflow: "hidden"
          }} onClick={e => e.stopPropagation()}>
            
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.18)" : "1px solid rgba(255,255,255,0.1)", paddingBottom: "12px" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800, color: fsGrade.color }}>
                  📊 基本面評分全景診斷
                </h3>
                <div style={{ fontSize: "0.85rem", color: isWarm ? "#57534e" : "#94a3b8", marginTop: "3px" }}>
                  標的：<b style={{ color: isWarm ? "#18181b" : "#ffffff" }}>{info?.name || info?.symbol} ({info?.symbol})</b> ｜ 評級：<b style={{ color: fsGrade.color }}>{fsGrade.label}</b> ｜ 總分：<b style={{ color: fsGrade.color }}>{fsScore > 0 ? "+" : ""}{fsScore}</b>
                </div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setShowFsModal(false)} style={{ borderRadius: "50%", width: "32px", height: "32px", padding: 0, fontSize: "1rem" }}>✕</button>
            </div>

            {/* Content List */}
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "14px", paddingRight: "4px" }}>
              
              {/* Summary Badges */}
              <div style={{ display: "flex", gap: "16px", background: isWarm ? "rgba(245, 238, 225, 0.8)" : "rgba(0,0,0,0.3)", padding: "12px 16px", borderRadius: "10px", border: isWarm ? "1px solid rgba(140, 110, 80, 0.15)" : "none" }}>
                <div>
                  <span style={{ fontSize: "0.76rem", color: isWarm ? "#57534e" : "#94a3b8" }}>良好達標指標</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 800, color: isWarm ? "#15803d" : "#4ade80" }}>✅ {fs.passed.length} 項</div>
                </div>
                <div style={{ borderLeft: isWarm ? "1px solid rgba(140, 110, 80, 0.2)" : "1px solid rgba(255,255,255,0.1)", paddingLeft: "16px" }}>
                  <span style={{ fontSize: "0.76rem", color: isWarm ? "#57534e" : "#94a3b8" }}>待改善/未達標指標</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 800, color: isWarm ? "#dc2626" : "#f87171" }}>❌ {fs.failed.length} 項</div>
                </div>
                <div style={{ borderLeft: isWarm ? "1px solid rgba(140, 110, 80, 0.2)" : "1px solid rgba(255,255,255,0.1)", paddingLeft: "16px" }}>
                  <span style={{ fontSize: "0.76rem", color: isWarm ? "#57534e" : "#94a3b8" }}>無資料/不適用</span>
                  <div style={{ fontSize: "1.3rem", fontWeight: 800, color: isWarm ? "#71717a" : "#94a3b8" }}>⬜ {fs.na.length} 項</div>
                </div>
              </div>

              {/* Passed Metrics */}
              {fs.passed.length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, color: isWarm ? "#15803d" : "#4ade80", fontSize: "0.88rem", marginBottom: "8px" }}>
                    ✅ 良好達標項目 ({fs.passed.length} 項)：
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "10px" }}>
                    {fs.passed.map(([l, d]) => {
                      const exp = METRIC_EXPLANATIONS[l] || { label: l, explanation: "衡量公司基本面健康指標。" };
                      return (
                        <div
                          key={l}
                          onClick={() => showMetricExplanation(l)}
                          style={{
                            background: isWarm ? "rgba(22, 163, 74, 0.08)" : "rgba(34, 197, 94, 0.08)", border: `1px solid ${isWarm ? "rgba(22, 163, 74, 0.3)" : "rgba(34, 197, 94, 0.3)"}`,
                            borderRadius: "10px", padding: "10px 14px", cursor: "pointer",
                            display: "flex", flexDirection: "column", gap: "4px",
                            transition: "all 0.15s ease"
                          }}
                          title={`點擊查看 ${l} 深度解說`}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: 700, color: isWarm ? "#15803d" : "#86efac", fontSize: "0.88rem" }}>✓ {l}</span>
                            <span style={{ fontSize: "0.72rem", color: isWarm ? "#b45309" : "#fef08a", background: isWarm ? "rgba(217, 119, 6, 0.15)" : "rgba(255,255,255,0.08)", padding: "1px 6px", borderRadius: "4px" }}>點擊看說明 💡</span>
                          </div>
                          <div style={{ fontSize: "0.82rem", color: isWarm ? "#18181b" : "#f0fdf4", fontWeight: 600 }}>{d}</div>
                          <div style={{ fontSize: "0.74rem", color: isWarm ? "#57534e" : "#94a3b8", lineHeight: 1.4, borderTop: isWarm ? "1px solid rgba(140, 110, 80, 0.12)" : "1px solid rgba(255,255,255,0.06)", paddingTop: "4px" }}>
                            {exp.explanation.substring(0, 50)}...
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Failed Metrics */}
              {fs.failed.length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, color: isWarm ? "#dc2626" : "#f87171", fontSize: "0.88rem", marginBottom: "8px" }}>
                    ❌ 待改善/未達標項目 ({fs.failed.length} 項)：
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "10px" }}>
                    {fs.failed.map(([l, d]) => {
                      const exp = METRIC_EXPLANATIONS[l] || { label: l, explanation: "衡量公司基本面健康指標。" };
                      return (
                        <div
                          key={l}
                          onClick={() => showMetricExplanation(l)}
                          style={{
                            background: isWarm ? "rgba(220, 38, 38, 0.08)" : "rgba(239, 68, 68, 0.08)", border: `1px solid ${isWarm ? "rgba(220, 38, 38, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
                            borderRadius: "10px", padding: "10px 14px", cursor: "pointer",
                            display: "flex", flexDirection: "column", gap: "4px",
                            transition: "all 0.15s ease"
                          }}
                          title={`點擊查看 ${l} 深度解說`}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <span style={{ fontWeight: 700, color: isWarm ? "#dc2626" : "#fca5a5", fontSize: "0.88rem" }}>✗ {l}</span>
                            <span style={{ fontSize: "0.72rem", color: isWarm ? "#b45309" : "#fef08a", background: isWarm ? "rgba(217, 119, 6, 0.15)" : "rgba(255,255,255,0.08)", padding: "1px 6px", borderRadius: "4px" }}>點擊看說明 💡</span>
                          </div>
                          <div style={{ fontSize: "0.82rem", color: isWarm ? "#18181b" : "#fef2f2", fontWeight: 600 }}>{d}</div>
                          <div style={{ fontSize: "0.74rem", color: isWarm ? "#57534e" : "#94a3b8", lineHeight: 1.4, borderTop: isWarm ? "1px solid rgba(140, 110, 80, 0.12)" : "1px solid rgba(255,255,255,0.06)", paddingTop: "4px" }}>
                            {exp.explanation.substring(0, 50)}...
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* NA Metrics */}
              {fs.na.length > 0 && (
                <div>
                  <div style={{ fontWeight: 700, color: isWarm ? "#71717a" : "#94a3b8", fontSize: "0.88rem", marginBottom: "8px" }}>
                    ⬜ 無數據/不適用項目 ({fs.na.length} 項)：
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "10px" }}>
                    {fs.na.map(([l, d]) => (
                      <div
                        key={l}
                        onClick={() => showMetricExplanation(l)}
                        style={{
                          background: isWarm ? "rgba(140, 110, 80, 0.05)" : "rgba(255, 255, 255, 0.03)", border: isWarm ? "1px solid rgba(140, 110, 80, 0.15)" : "1px solid rgba(255, 255, 255, 0.06)",
                          borderRadius: "10px", padding: "10px 14px", cursor: "pointer",
                          display: "flex", flexDirection: "column", gap: "4px"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 600, color: isWarm ? "#57534e" : "#cbd5e1", fontSize: "0.88rem" }}>- {l}</span>
                          <span style={{ fontSize: "0.72rem", color: isWarm ? "#71717a" : "#94a3b8" }}>點擊看說明 💡</span>
                        </div>
                        <div style={{ fontSize: "0.82rem", color: isWarm ? "#71717a" : "#94a3b8" }}>{d}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>

            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: isWarm ? "1px solid rgba(140, 110, 80, 0.18)" : "1px solid rgba(255,255,255,0.1)", paddingTop: "12px" }}>
              <span style={{ fontSize: "0.75rem", color: isWarm ? "#57534e" : "#64748b" }}>
                以 12 大指標加權打分（滿分+12） ｜ 點擊任一項目可檢視量化定義與評判標準
              </span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowFsModal(false)}>
                確定關閉
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 📡 8 大技術指標智慧診斷與操作建議全景 Modal */}
      {showTechModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: isWarm ? "rgba(40, 30, 20, 0.45)" : "rgba(3, 7, 18, 0.85)", backdropFilter: "blur(12px)",
          zIndex: 25000, display: "flex", justifyContent: "center", alignItems: "center",
          padding: "20px"
        }} onClick={() => setShowTechModal(false)}>
          <div style={{
            background: isWarm ? "rgba(255, 252, 245, 0.98)" : "linear-gradient(145deg, #111827, #0f172a)",
            borderRadius: "16px", width: "840px", maxWidth: "98vw", maxHeight: "90vh",
            padding: "24px", border: `1px solid ${advice.border}`,
            color: isWarm ? "#18181b" : "#ffffff",
            boxShadow: isWarm ? "0 25px 60px rgba(90, 60, 30, 0.2)" : "0 25px 60px rgba(0, 0, 0, 0.8)",
            display: "flex", flexDirection: "column", gap: "16px", overflow: "hidden"
          }} onClick={e => e.stopPropagation()}>
            
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.18)" : "1px solid rgba(255,255,255,0.1)", paddingBottom: "12px" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: "1.2rem", fontWeight: 800, color: advice.color }}>
                  📡 技術面指標與操作建議全景診斷
                </h3>
                <div style={{ fontSize: "0.85rem", color: isWarm ? "#57534e" : "#94a3b8", marginTop: "3px" }}>
                  標的：<b style={{ color: isWarm ? "#18181b" : "#ffffff" }}>{info?.name || info?.symbol} ({info?.symbol})</b> ｜ 操作建議：<b style={{ color: advice.color }}>{advice.title}</b> ｜ 綜合評分：<b style={{ color: advice.color }}>{(finalScore ?? 0) > 0 ? "+" : ""}{finalScore != null && !isNaN(finalScore) ? finalScore.toFixed(1) : "0.0"} 分</b>
                </div>
              </div>
              <button className="btn btn-outline btn-sm" onClick={() => setShowTechModal(false)} style={{ borderRadius: "50%", width: "32px", height: "32px", padding: 0, fontSize: "1rem" }}>✕</button>
            </div>

            {/* Content List */}
            <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "14px", paddingRight: "4px" }}>
              
              {/* Scoring Summary Banner */}
              <div style={{
                background: isWarm ? "rgba(245, 238, 225, 0.8)" : "rgba(0,0,0,0.35)", padding: "14px 16px", borderRadius: "10px",
                border: isWarm ? "1px solid rgba(140, 110, 80, 0.15)" : "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between",
                alignItems: "center", flexWrap: "wrap", gap: "10px"
              }}>
                <div>
                  <div style={{ fontSize: "0.76rem", color: isWarm ? "#57534e" : "#94a3b8" }}>當前技術綜合判定</div>
                  <div style={{ fontSize: "1.25rem", fontWeight: 800, color: advice.color }}>{advice.title}</div>
                </div>
                <div>
                  <div style={{ fontSize: "0.76rem", color: isWarm ? "#57534e" : "#94a3b8" }}>多空淨得分</div>
                  <div style={{ fontSize: "1.25rem", fontWeight: 800, color: advice.color }}>
                    {(finalScore ?? 0) > 0 ? "+" : ""}{finalScore != null && !isNaN(finalScore) ? finalScore.toFixed(1) : "0.0"} 分
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: "0.76rem", color: isWarm ? "#57534e" : "#94a3b8" }}>偵測潛在地雷風險</div>
                  <div style={{ fontSize: "1.25rem", fontWeight: 800, color: risks.length === 0 ? (isWarm ? "#15803d" : "#4ade80") : (isWarm ? "#dc2626" : "#f87171") }}>
                    {risks.length === 0 ? "0 項 (無風險扣分)" : `扣除 ${risks.length} 分`}
                  </div>
                </div>
              </div>

              {/* Suggestions Signal Cards with Full Explanations */}
              <div>
                <div style={{ fontWeight: 700, color: isWarm ? "var(--accent-blue)" : "#93c5fd", fontSize: "0.9rem", marginBottom: "10px" }}>
                  📡 8 大技術指標即時量化診斷與深度解說：
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "10px" }}>
                  {suggestions.map((s, i) => {
                    const exp = getTechIndicatorExplanation(s.title);
                    const chartType = getTechChartType(s.title);
                    return (
                      <div
                        key={i}
                        onClick={() => setActiveTechChart(chartType)}
                        style={{
                          background: isWarm ? "rgba(255, 255, 255, 0.95)" : "rgba(15, 23, 42, 0.6)",
                          border: `1px solid ${s.color}40`,
                          borderLeft: `4px solid ${s.color}`,
                          borderRadius: "10px", padding: "12px 14px",
                          boxShadow: isWarm ? "0 2px 8px rgba(90,60,30,0.06)" : "none",
                          display: "flex", flexDirection: "column", gap: "4px",
                          cursor: "pointer", transition: "all 0.15s ease"
                        }}
                        title={`點擊查看 ${exp.label} 互動圖表`}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700, color: s.color, fontSize: "0.88rem" }}>
                            {s.title}
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <span style={{ fontSize: "0.68rem", color: isWarm ? "#57534e" : "#94a3b8", background: isWarm ? "rgba(140, 110, 80, 0.1)" : "rgba(255,255,255,0.06)", padding: "1px 6px", borderRadius: "4px" }}>
                              {exp.label}
                            </span>
                            <span style={{
                              background: isWarm ? "rgba(217, 119, 6, 0.12)" : "rgba(56, 189, 248, 0.18)",
                              color: isWarm ? "#b45309" : "#38bdf8",
                              border: isWarm ? "1px solid rgba(217, 119, 6, 0.35)" : "1px solid rgba(56, 189, 248, 0.4)",
                              padding: "1px 6px",
                              borderRadius: "4px",
                              fontSize: "0.68rem",
                              fontWeight: 700
                            }}>
                              📈 檢視圖表 🔍
                            </span>
                          </div>
                        </div>
                        <div style={{ fontSize: "0.82rem", color: isWarm ? "#18181b" : "#f8fafc", fontWeight: 600, marginTop: "2px" }}>
                          {s.desc}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: isWarm ? "#57534e" : "#94a3b8", lineHeight: 1.45, marginTop: "4px", borderTop: isWarm ? "1px solid rgba(140, 110, 80, 0.12)" : "1px solid rgba(255,255,255,0.06)", paddingTop: "4px" }}>
                          💡 <b>量化定義：</b>{exp.explanation}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: isWarm ? "1px solid rgba(140, 110, 80, 0.18)" : "1px solid rgba(255,255,255,0.1)", paddingTop: "12px" }}>
              <span style={{ fontSize: "0.75rem", color: isWarm ? "#57534e" : "#64748b" }}>
                以 8 大指標數值及 20/50/200 日價量統計為依據進行量化加權 ｜ 點擊任一項目可開啟獨立互動圖表
              </span>
              <button className="btn btn-primary btn-sm" onClick={() => setShowTechModal(false)}>
                確定關閉
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 獨立技術指標放大圖表 Modal */}
      {activeTechChart && ohlcv && ind && (
        <ZoomChartModal
          type={activeTechChart}
          ohlcv={ohlcv}
          ind={ind}
          symbol={info?.symbol ?? ""}
          name={info?.name ?? ""}
          onClose={() => setActiveTechChart(null)}
        />
      )}

      {/* 指標診斷與解說 Modal */}
      {selectedMetric && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: isWarm ? "rgba(40, 30, 20, 0.4)" : "rgba(0,0,0,0.65)", backdropFilter: "blur(6px)",
          zIndex: 20000, display: "flex", justifyContent: "center", alignItems: "center"
        }} onClick={() => setSelectedMetric(null)}>
          <div style={{
            background: isWarm ? "rgba(255, 252, 245, 0.98)" : "#161622", borderRadius: "12px", width: "420px", maxWidth: "90%",
            padding: "20px", border: isWarm ? "1px solid rgba(140, 110, 80, 0.25)" : "1px solid rgba(255,255,255,0.15)",
            color: isWarm ? "#18181b" : "#ffffff",
            boxShadow: isWarm ? "0 15px 30px rgba(90, 60, 30, 0.15)" : "0 15px 30px rgba(0, 0, 0, 0.6)",
            display: "flex", flexDirection: "column", gap: "14px"
          }} onClick={e => e.stopPropagation()}>
            
            {/* Title */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.15)" : "1px solid rgba(255,255,255,0.1)", paddingBottom: "10px" }}>
              <h4 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: isWarm ? "var(--accent-blue)" : "var(--accent-blue-light)" }}>
                💡 {selectedMetric.label || selectedMetric.name}
              </h4>
              <button className="btn btn-outline btn-sm" onClick={() => setSelectedMetric(null)} style={{ minWidth: "24px", padding: 0, height: "24px", borderRadius: "50%", fontSize: "0.8rem" }}>✕</button>
            </div>
            
            {/* Diagnostic Result */}
            {selectedMetric.result && (
              <div style={{ 
                background: selectedMetric.isPassed ? (isWarm ? "rgba(22, 163, 74, 0.1)" : "rgba(76,175,80,0.08)") : selectedMetric.isFailed ? (isWarm ? "rgba(220, 38, 38, 0.1)" : "rgba(255,82,82,0.08)") : (isWarm ? "rgba(140, 110, 80, 0.08)" : "rgba(255,255,255,0.03)"),
                border: `1px solid ${selectedMetric.isPassed ? (isWarm ? "rgba(22, 163, 74, 0.3)" : "rgba(76,175,80,0.2)") : selectedMetric.isFailed ? (isWarm ? "rgba(220, 38, 38, 0.3)" : "rgba(255,82,82,0.2)") : (isWarm ? "rgba(140, 110, 80, 0.2)" : "rgba(255,255,255,0.08)")}`,
                color: selectedMetric.isPassed ? (isWarm ? "#15803d" : "#81c784") : selectedMetric.isFailed ? (isWarm ? "#dc2626" : "#ef9a9a") : (isWarm ? "#57534e" : "var(--text-secondary)"),
                padding: "10px 12px", borderRadius: "6px", fontSize: "0.88rem"
              }}>
                <strong>當前診斷：</strong>{selectedMetric.result}
              </div>
            )}
            
            {/* Explanation Text */}
            <div style={{ fontSize: "0.85rem", color: isWarm ? "#44403c" : "var(--text-secondary)", lineHeight: 1.5 }}>
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
