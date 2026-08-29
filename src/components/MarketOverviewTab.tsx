import { useEffect, useState, useRef, useMemo } from "react";
import {
  createChart,
  IChartApi,
  ISeriesApi,
  ColorType,
  CandlestickData,
  LineData,
  HistogramData,
} from "lightweight-charts";
import {
  MarketIndexQuote,
  IndexHistoryData,
  fetchMarketIndices,
  fetchIndexHistory,
} from "../utils/marketService";
import { calcSMA } from "../utils/indicators";

interface MarketOverviewTabProps {
  onNavigateToAnalysis: (symbol: string) => void;
}

type Timeframe = "1d" | "1mo" | "3mo" | "6mo" | "1y";

export function MarketOverviewTab({ onNavigateToAnalysis }: MarketOverviewTabProps) {
  const [quotes, setQuotes] = useState<MarketIndexQuote[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("^TWII");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [timeframe, setTimeframe] = useState<Timeframe>("1mo");
  const [historyData, setHistoryData] = useState<IndexHistoryData | null>(null);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [lastUpdated, setLastUpdated] = useState<string>("");

  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const lineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma5SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // 1. 初始化與定時輪詢
  const loadMarketData = async (isManual = false) => {
    if (isManual) setRefreshing(true);
    try {
      const data = await fetchMarketIndices();
      setQuotes(data);
      setLastUpdated(new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (e) {
      console.error("Failed to load market data:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadMarketData();
    const timer = setInterval(() => {
      loadMarketData();
    }, 60000); // 每 60 秒自動背景輪詢
    return () => clearInterval(timer);
  }, []);

  // 2. 當選中的指數或時間區間變更時，抓取歷史 K 線
  useEffect(() => {
    let isMounted = true;
    setHistoryLoading(true);
    fetchIndexHistory(selectedSymbol, timeframe)
      .then((data) => {
        if (isMounted) {
          setHistoryData(data);
          setHistoryLoading(false);
        }
      })
      .catch((e) => {
        if (isMounted) {
          console.error("Failed to fetch index history:", e);
          setHistoryLoading(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [selectedSymbol, timeframe]);

  // 3. 渲染主圖表 (TradingView Lightweight-Charts)
  useEffect(() => {
    if (!chartContainerRef.current) return;

    // 清理舊圖表
    if (chartInstanceRef.current) {
      chartInstanceRef.current.remove();
      chartInstanceRef.current = null;
    }

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: 380,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#94a3b8",
        fontSize: 12,
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.05)" },
        horzLines: { color: "rgba(255, 255, 255, 0.05)" },
      },
      crosshair: {
        vertLine: { color: "rgba(255, 255, 255, 0.2)", width: 1, style: 2 },
        horzLine: { color: "rgba(255, 255, 255, 0.2)", width: 1, style: 2 },
      },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        timeVisible: timeframe === "1d",
        secondsVisible: false,
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
    });

    chartInstanceRef.current = chart;

    if (timeframe === "1d") {
      // 1D 分時圖使用平滑折線
      const lineSeries = chart.addLineSeries({
        color: "#38bdf8",
        lineWidth: 2,
        priceLineVisible: true,
      });
      lineSeriesRef.current = lineSeries;
    } else {
      // 日K / 週K / 月K 使用標準蠟燭圖 (台股慣例: 紅漲 綠跌)
      const candleSeries = chart.addCandlestickSeries({
        upColor: "#ff5252",
        downColor: "#4caf50",
        borderUpColor: "#ff5252",
        borderDownColor: "#4caf50",
        wickUpColor: "#ff5252",
        wickDownColor: "#4caf50",
      });
      candleSeriesRef.current = candleSeries;

      const ma5 = chart.addLineSeries({ color: "#facc15", lineWidth: 1, title: "MA5" });
      const ma20 = chart.addLineSeries({ color: "#c084fc", lineWidth: 1, title: "MA20" });
      ma5SeriesRef.current = ma5;
      ma20SeriesRef.current = ma20;
    }

    const volumeSeries = chart.addHistogramSeries({
      color: "rgba(56, 189, 248, 0.35)",
      priceFormat: { type: "volume" },
      priceScaleId: "volume_scale",
    });
    chart.priceScale("volume_scale").applyOptions({
      scaleMargins: { top: 0.75, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    const handleResize = () => {
      if (container && chartInstanceRef.current) {
        chartInstanceRef.current.applyOptions({ width: container.clientWidth });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (chartInstanceRef.current) {
        chartInstanceRef.current.remove();
        chartInstanceRef.current = null;
      }
    };
  }, [timeframe]);

  // 4. 更新圖表數據
  useEffect(() => {
    if (!historyData || historyData.timestamp.length === 0 || !chartInstanceRef.current) return;

    const ts = historyData.timestamp;
    const opens = historyData.open;
    const highs = historyData.high;
    const lows = historyData.low;
    const closes = historyData.close;
    const vols = historyData.volume;

    const candleData: CandlestickData[] = [];
    const lineData: LineData[] = [];
    const volData: HistogramData[] = [];

    for (let i = 0; i < ts.length; i++) {
      const timeVal = ts[i] as any;
      if (timeframe === "1d") {
        lineData.push({ time: timeVal, value: closes[i] });
      } else {
        candleData.push({
          time: timeVal,
          open: opens[i],
          high: highs[i],
          low: lows[i],
          close: closes[i],
        });
      }

      volData.push({
        time: timeVal,
        value: vols[i] || 0,
        color: closes[i] >= opens[i] ? "rgba(255, 82, 82, 0.4)" : "rgba(76, 175, 80, 0.4)",
      });
    }

    if (timeframe === "1d" && lineSeriesRef.current) {
      lineSeriesRef.current.setData(lineData);
    } else if (candleSeriesRef.current) {
      candleSeriesRef.current.setData(candleData);

      // 計算 MA5 與 MA20
      if (ma5SeriesRef.current && ma20SeriesRef.current) {
        const ma5 = calcSMA(closes, 5);
        const ma20 = calcSMA(closes, 20);
        const ma5Data: LineData[] = [];
        const ma20Data: LineData[] = [];

        for (let i = 0; i < ts.length; i++) {
          if (ma5[i] != null && !isNaN(ma5[i])) {
            ma5Data.push({ time: ts[i] as any, value: Number(ma5[i].toFixed(2)) });
          }
          if (ma20[i] != null && !isNaN(ma20[i])) {
            ma20Data.push({ time: ts[i] as any, value: Number(ma20[i].toFixed(2)) });
          }
        }
        ma5SeriesRef.current.setData(ma5Data);
        ma20SeriesRef.current.setData(ma20Data);
      }
    }

    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.setData(volData);
    }

    chartInstanceRef.current.timeScale().fitContent();
  }, [historyData, timeframe]);

  // 目前選中的指數 Quote
  const currentQuote = useMemo(() => {
    return quotes.find((q) => q.symbol === selectedSymbol) || quotes[0] || null;
  }, [quotes, selectedSymbol]);

  // 篩選分類後的指數清單
  const filteredQuotes = useMemo(() => {
    if (activeCategory === "all") return quotes;
    return quotes.filter((q) => q.category === activeCategory);
  }, [quotes, activeCategory]);

  // 全球關鍵指標衍生計算 (SOX / VIX / TNX / TSM)
  const macroStats = useMemo(() => {
    const vix = quotes.find((q) => q.symbol === "^VIX");
    const sox = quotes.find((q) => q.symbol === "^SOX");
    const tsm = quotes.find((q) => q.symbol === "TSM");
    const tnx = quotes.find((q) => q.symbol === "^TNX");
    const gspc = quotes.find((q) => q.symbol === "^GSPC");
    const twii = quotes.find((q) => q.symbol === "^TWII");

    return { vix, sox, tsm, tnx, gspc, twii };
  }, [quotes]);

  return (
    <div className="market-overview-tab" style={{ padding: "16px 24px", minHeight: "100%", boxSizing: "border-box" }}>
      {/* ─── 頂部標題與狀態列 ──────────────────────────────────────────────── */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        flexWrap: "wrap", gap: "12px", marginBottom: "16px"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "1.6rem" }}>🌐</span>
          <div>
            <h1 style={{ margin: 0, fontSize: "1.4rem", fontWeight: 800, color: "var(--text-primary, #f8fafc)" }}>
              全球大盤與市場總覽
            </h1>
            <p style={{ margin: "2px 0 0", fontSize: "0.82rem", color: "var(--text-muted, #94a3b8)" }}>
              即時追蹤台灣加權、櫃買、美股四大指數、亞歐重要股市及宏觀資金風向
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          {lastUpdated && (
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted, #94a3b8)" }}>
              🕒 最後更新: {lastUpdated}
            </span>
          )}
          <button
            onClick={() => loadMarketData(true)}
            disabled={refreshing}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "7px 14px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(255,255,255,0.06)", color: "var(--text-primary, #fff)",
              fontSize: "0.84rem", fontWeight: 600, cursor: refreshing ? "not-allowed" : "pointer"
            }}
          >
            <span style={{ display: "inline-block", transform: refreshing ? "rotate(360deg)" : "none", transition: "transform 0.6s ease" }}>
              🔄
            </span>
            {refreshing ? "更新中..." : "重新整理"}
          </button>
        </div>
      </div>

      {/* ─── 市場連動與情緒診斷 Bar ────────────────────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px",
        marginBottom: "20px"
      }}>
        {/* 1. 台股開盤風向標 (費半 + 台積 ADR) */}
        <div style={{
          background: "rgba(30, 41, 59, 0.7)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "10px", padding: "12px 16px", display: "flex", flexDirection: "column", gap: "6px"
        }}>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
            <span>🇹🇼</span> 台股開盤聯動風向
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px" }}>
            <span style={{ fontSize: "0.88rem", color: "#e2e8f0" }}>
              費半 {macroStats.sox ? `${macroStats.sox.changePct >= 0 ? "+" : ""}${macroStats.sox.changePct.toFixed(2)}%` : "-"}
            </span>
            <span style={{ color: "rgba(255,255,255,0.2)" }}>｜</span>
            <span style={{ fontSize: "0.88rem", color: "#e2e8f0" }}>
              台積ADR {macroStats.tsm ? `${macroStats.tsm.changePct >= 0 ? "+" : ""}${macroStats.tsm.changePct.toFixed(2)}%` : "-"}
            </span>
          </div>
          <div style={{
            fontSize: "0.76rem", fontWeight: 600,
            color: (macroStats.sox?.changePct || 0) >= 0 ? "#ff5252" : "#4caf50"
          }}>
            {(macroStats.sox?.changePct || 0) >= 1.0
              ? "🚀 費半大漲，台股半導體族群開盤正面激勵"
              : (macroStats.sox?.changePct || 0) <= -1.0
              ? "⚠️ 費半重挫，留意電子權值開盤回檔壓力"
              : "⚖️ 國際科技股平穩，台股回歸基本面震盪"}
          </div>
        </div>

        {/* 2. 恐慌指數 VIX 水位 */}
        <div style={{
          background: "rgba(30, 41, 59, 0.7)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "10px", padding: "12px 16px", display: "flex", flexDirection: "column", gap: "6px"
        }}>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
            <span>⚠️</span> 恐慌指數 VIX 水位診斷
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{ fontSize: "1.2rem", fontWeight: 800, color: "#f8fafc" }}>
              {macroStats.vix ? macroStats.vix.price.toFixed(2) : "--"}
            </span>
            <span style={{
              fontSize: "0.75rem", fontWeight: 700, padding: "2px 6px", borderRadius: "4px",
              background: (macroStats.vix?.price || 0) < 20 ? "rgba(74, 222, 128, 0.15)" : (macroStats.vix?.price || 0) > 30 ? "rgba(239, 68, 68, 0.2)" : "rgba(250, 204, 21, 0.2)",
              color: (macroStats.vix?.price || 0) < 20 ? "#4ade80" : (macroStats.vix?.price || 0) > 30 ? "#ef4444" : "#facc15"
            }}>
              {(macroStats.vix?.price || 0) < 20 ? "🟢 樂觀偏多" : (macroStats.vix?.price || 0) > 30 ? "🔴 恐慌高壓" : "🟡 震盪戒備"}
            </span>
          </div>
          <div style={{ fontSize: "0.74rem", color: "#cbd5e1" }}>
            {(macroStats.vix?.price || 0) < 20 ? "市場波動平緩，資金風險偏好充沛" : (macroStats.vix?.price || 0) > 30 ? "避險情緒急升，建議控管部位現金" : "市場不確定性升溫，多空角力加劇"}
          </div>
        </div>

        {/* 3. 美國 10 年期公債殖利率 */}
        <div style={{
          background: "rgba(30, 41, 59, 0.7)", border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: "10px", padding: "12px 16px", display: "flex", flexDirection: "column", gap: "6px"
        }}>
          <div style={{ fontSize: "0.8rem", color: "#94a3b8", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
            <span>💵</span> 美國 10 年期公債殖利率
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
            <span style={{ fontSize: "1.2rem", fontWeight: 800, color: "#f8fafc" }}>
              {macroStats.tnx ? `${macroStats.tnx.price.toFixed(2)}%` : "--"}
            </span>
            <span style={{ fontSize: "0.75rem", color: (macroStats.tnx?.change || 0) >= 0 ? "#ff5252" : "#4caf50", fontWeight: 600 }}>
              {macroStats.tnx ? `${macroStats.tnx.change >= 0 ? "+" : ""}${macroStats.tnx.change.toFixed(2)}` : ""}
            </span>
          </div>
          <div style={{ fontSize: "0.74rem", color: "#cbd5e1" }}>
            全球資金成本錨定指標（殖利率下滑有利科技股估值）
          </div>
        </div>
      </div>

      {/* ─── 分類篩選 Tab 按鈕 ────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px",
        overflowX: "auto", paddingBottom: "4px"
      }}>
        {[
          { id: "all", label: "全部大盤" },
          { id: "tw", label: "🇹🇼 台灣市場" },
          { id: "us", label: "🇺🇸 美國市場" },
          { id: "asia", label: "🌏 亞太股市" },
          { id: "europe", label: "🌍 歐洲市場" },
          { id: "macro", label: "📊 宏觀/公債" },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            style={{
              padding: "6px 14px", borderRadius: "6px", border: "none", cursor: "pointer",
              fontSize: "0.84rem", fontWeight: 700, whiteSpace: "nowrap",
              background: activeCategory === cat.id ? "#2563eb" : "rgba(255,255,255,0.06)",
              color: activeCategory === cat.id ? "#ffffff" : "#94a3b8",
              transition: "all 0.15s ease",
            }}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* ─── 大盤卡片網格 (Cards Grid) ────────────────────────────────────── */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: "10px",
        marginBottom: "24px"
      }}>
        {loading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{
                background: "rgba(255,255,255,0.03)", borderRadius: "8px", height: "100px",
                border: "1px solid rgba(255,255,255,0.05)", animation: "pulse 1.5s infinite"
              }} />
            ))
          : filteredQuotes.map((q) => {
              const isSelected = q.symbol === selectedSymbol;
              const isUp = q.change >= 0;
              return (
                <div
                  key={q.symbol}
                  onClick={() => setSelectedSymbol(q.symbol)}
                  style={{
                    background: isSelected ? "rgba(37, 99, 235, 0.12)" : "rgba(30, 41, 59, 0.5)",
                    border: isSelected ? "1.5px solid #3b82f6" : "1px solid rgba(255,255,255,0.07)",
                    borderRadius: "10px", padding: "10px 12px", cursor: "pointer",
                    transition: "all 0.15s ease", position: "relative",
                    display: "flex", flexDirection: "column", justifyContent: "space-between"
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.borderColor = "rgba(255,255,255,0.2)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)";
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontSize: "1.1rem" }}>{q.flag}</span>
                      <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#f8fafc" }}>
                        {q.name.split(" ")[0]}
                      </span>
                    </div>
                    <span style={{ fontSize: "0.70rem", color: "#94a3b8", fontFamily: "monospace" }}>
                      {q.symbol}
                    </span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "4px 0" }}>
                    <div style={{ fontSize: "1.15rem", fontWeight: 800, color: "#ffffff" }}>
                      {q.price <= 0
                        ? "--"
                        : q.price > 1000
                        ? q.price.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
                        : q.price.toFixed(2)}
                    </div>
                    {q.price > 0 && (
                      <div style={{
                        fontSize: "0.78rem", fontWeight: 700,
                        color: isUp ? "#ff5252" : "#4caf50",
                        display: "flex", alignItems: "center", gap: "2px"
                      }}>
                        <span>{isUp ? "▲" : "▼"}</span>
                        <span>{Math.abs(q.changePct).toFixed(2)}%</span>
                      </div>
                    )}
                  </div>

                  {/* 迷你走勢圖 (Sparkline SVG) */}
                  <div style={{ height: "24px", width: "100%", marginTop: "2px" }}>
                    {q.sparkline && q.sparkline.length > 2 && (
                      <svg width="100%" height="24" style={{ overflow: "visible" }}>
                        {(() => {
                          const min = Math.min(...q.sparkline);
                          const max = Math.max(...q.sparkline);
                          const range = max - min || 1;
                          const points = q.sparkline.map((val, idx) => {
                            const x = (idx / (q.sparkline.length - 1)) * 100;
                            const y = 20 - ((val - min) / range) * 16;
                            return `${x}%,${y}`;
                          }).join(" ");
                          return (
                            <polyline
                              fill="none"
                              stroke={isUp ? "#ff5252" : "#4caf50"}
                              strokeWidth="1.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              points={points}
                            />
                          );
                        })()}
                      </svg>
                    )}
                  </div>
                </div>
              );
            })}
      </div>

      {/* ─── 主互動圖表區 (Interactive Chart Section) ────────────────────── */}
      <div style={{
        background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: "12px", padding: "16px 20px", marginBottom: "20px"
      }}>
        {/* 圖表頂部操作列 */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          flexWrap: "wrap", gap: "12px", marginBottom: "14px", borderBottom: "1px solid rgba(255,255,255,0.06)",
          paddingBottom: "12px"
        }}>
          {currentQuote && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "1.4rem" }}>{currentQuote.flag}</span>
              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                  <span style={{ fontSize: "1.15rem", fontWeight: 800, color: "#f8fafc" }}>
                    {currentQuote.name}
                  </span>
                  <span style={{ fontSize: "0.82rem", color: "#94a3b8", fontFamily: "monospace" }}>
                    ({currentQuote.symbol})
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "2px" }}>
                  <span style={{ fontSize: "1.1rem", fontWeight: 800, color: "#ffffff" }}>
                    {currentQuote.price > 1000 ? currentQuote.price.toLocaleString() : currentQuote.price.toFixed(2)}
                  </span>
                  <span style={{
                    fontSize: "0.82rem", fontWeight: 700,
                    color: currentQuote.change >= 0 ? "#ff5252" : "#4caf50"
                  }}>
                    {currentQuote.change >= 0 ? "+" : ""}{currentQuote.change.toFixed(2)} ({currentQuote.change >= 0 ? "+" : ""}{currentQuote.changePct.toFixed(2)}%)
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* 時間週期切換與深度分析按鈕 */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ display: "flex", background: "rgba(255,255,255,0.06)", borderRadius: "6px", padding: "2px" }}>
              {(["1d", "1mo", "3mo", "6mo", "1y"] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  style={{
                    padding: "4px 10px", borderRadius: "4px", border: "none", cursor: "pointer",
                    fontSize: "0.78rem", fontWeight: 700,
                    background: timeframe === tf ? "#2563eb" : "transparent",
                    color: timeframe === tf ? "#fff" : "#94a3b8",
                  }}
                >
                  {tf === "1d" ? "分時" : tf === "1mo" ? "1月" : tf === "3mo" ? "3月" : tf === "6mo" ? "半年" : "1年"}
                </button>
              ))}
            </div>

            {currentQuote && (
              <button
                onClick={() => onNavigateToAnalysis(currentQuote.symbol)}
                style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  padding: "6px 12px", borderRadius: "6px", border: "none",
                  background: "#7c3aed", color: "#ffffff",
                  fontSize: "0.80rem", fontWeight: 700, cursor: "pointer",
                  transition: "background 0.15s ease"
                }}
                title="帶入個股分析分頁進行深度指標與技術診斷"
              >
                <span>📊</span> 進入深度分析
              </button>
            )}
          </div>
        </div>

        {/* 圖表容器 */}
        <div style={{ position: "relative", width: "100%", height: "380px" }}>
          {historyLoading && (
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
              background: "rgba(15, 23, 42, 0.6)", zIndex: 10,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "0.9rem", color: "#38bdf8", fontWeight: 600
            }}>
              載入 K 線圖表中...
            </div>
          )}
          <div ref={chartContainerRef} style={{ width: "100%", height: "100%" }} />
        </div>
      </div>
    </div>
  );
}
