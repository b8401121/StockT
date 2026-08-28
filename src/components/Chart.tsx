import React, { useEffect, useRef, useState } from "react";
import { createChart, ColorType, IChartApi, UTCTimestamp } from "lightweight-charts";
import { OhlcvData, Indicators } from "../utils/indicators";
import { useAppTheme } from "../utils/theme";

interface ChartPanelProps {
  ohlcv: OhlcvData;
  ind: Indicators;
  symbol: string;
  name: string;
  sidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export type SubChartType = "kd" | "macd" | "rsi" | "obv" | "wr" | "atr";

const getChartOptions = (isWarm: boolean) => ({
  layout: {
    background: { type: ColorType.Solid, color: "transparent" },
    textColor: isWarm ? "#44403c" : "rgba(200,210,230,0.8)",
  },
  grid: {
    vertLines: { color: isWarm ? "rgba(140, 110, 80, 0.12)" : "rgba(255,255,255,0.03)" },
    horzLines: { color: isWarm ? "rgba(140, 110, 80, 0.12)" : "rgba(255,255,255,0.03)" },
  },
  crosshair: { mode: 1 },
  leftPriceScale: { visible: true, borderColor: isWarm ? "rgba(140, 110, 80, 0.2)" : "rgba(255,255,255,0.1)" },
  rightPriceScale: { visible: false },
  timeScale: { borderColor: isWarm ? "rgba(140, 110, 80, 0.2)" : "rgba(255,255,255,0.1)", timeVisible: true },
  handleScroll: { mouseWheel: true, pressedMouseMove: true },
  handleScale: { axisPressedMouseMove: true, mouseWheel: true },
});

interface TooltipData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePct: number;
  volume: number;
  sma5?: number;
  sma10?: number;
  sma20?: number;
}

const ChartHUDView: React.FC<{ data: TooltipData; isWarm?: boolean }> = ({ data, isWarm }) => {
  const isUp = data.change > 0;
  const isDown = data.change < 0;
  const changeColor = isUp ? (isWarm ? "#dc2626" : "#ff5252") : isDown ? (isWarm ? "#15803d" : "#4caf50") : (isWarm ? "#71717a" : "#94a3b8");
  const changeSign = isUp ? "▲ +" : isDown ? "▼ " : "━ ";

  const volDisplay = data.volume >= 1000
    ? `${(data.volume / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} 張 (${data.volume.toLocaleString()} 股)`
    : `${data.volume.toLocaleString()} 股`;

  return (
    <div
      style={{
        position: "absolute",
        left: "70px",
        top: "8px",
        pointerEvents: "none",
        zIndex: 50,
        backgroundColor: isWarm ? "rgba(255, 252, 245, 0.95)" : "rgba(15, 23, 42, 0.90)",
        border: `1px solid ${isWarm ? "rgba(217, 119, 6, 0.4)" : "rgba(139, 92, 246, 0.4)"}`,
        borderRadius: "6px",
        padding: "5px 12px",
        boxShadow: isWarm ? "0 4px 16px rgba(90, 60, 30, 0.12)" : "0 4px 16px rgba(0, 0, 0, 0.6)",
        fontSize: "0.78rem",
        color: isWarm ? "#18181b" : "#f8fafc",
        backdropFilter: "blur(8px)",
        lineHeight: "1.45",
        display: "flex",
        flexDirection: "column",
        gap: "2px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, color: isWarm ? "#57534e" : "#cbd5e1" }}>📅 {data.date}</span>
        <span>開: <b>{data.open.toFixed(2)}</b></span>
        <span>高: <b style={{ color: isWarm ? "#dc2626" : "#ff5252" }}>{data.high.toFixed(2)}</b></span>
        <span>低: <b style={{ color: isWarm ? "#15803d" : "#4caf50" }}>{data.low.toFixed(2)}</b></span>
        <span>收: <b style={{ color: changeColor, fontSize: "0.85rem" }}>{data.close.toFixed(2)}</b></span>
        <span style={{ fontWeight: 800, color: changeColor }}>
          {changeSign}{Math.abs(data.change).toFixed(2)} ({data.changePct >= 0 ? "+" : ""}{data.changePct.toFixed(2)}%)
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "0.74rem", color: isWarm ? "#57534e" : "rgba(255,255,255,0.7)", flexWrap: "wrap" }}>
        <span>📊 成交量: <b style={{ color: isWarm ? "#1d4ed8" : "#38bdf8" }}>{volDisplay}</b></span>
        {data.sma5 != null && !isNaN(data.sma5) && (
          <span><span style={{ color: isWarm ? "#ea580c" : "#ff9800" }}>● MA5:</span> {data.sma5.toFixed(2)}</span>
        )}
        {data.sma10 != null && !isNaN(data.sma10) && (
          <span><span style={{ color: isWarm ? "#0284c7" : "#03a9f4" }}>● MA10:</span> {data.sma10.toFixed(2)}</span>
        )}
        {data.sma20 != null && !isNaN(data.sma20) && (
          <span><span style={{ color: isWarm ? "#d97706" : "#ffea00" }}>● MA20:</span> {data.sma20.toFixed(2)}</span>
        )}
      </div>
    </div>
  );
};

// ─── 放大檢視互動式 Modal ───────────────────────────────────────────────────────
export interface ZoomModalProps {
  type: "main" | SubChartType;
  ohlcv: OhlcvData;
  ind: Indicators;
  symbol: string;
  name: string;
  onClose: () => void;
}

export const ZoomChartModal: React.FC<ZoomModalProps> = ({ type, ohlcv, ind, symbol, name, onClose }) => {
  const [theme] = useAppTheme();
  const isWarm = theme === "warm";
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const subContainerRef = useRef<HTMLDivElement>(null);
  const mainChartRef = useRef<IChartApi | null>(null);
  const subChartRef = useRef<IChartApi | null>(null);
  const [hoverInfo, setHoverInfo] = useState<TooltipData | null>(null);

  const resetZoom = () => {
    if (mainChartRef.current) {
      try {
        mainChartRef.current.timeScale().fitContent();
      } catch {}
    }
    if (subChartRef.current) {
      try {
        subChartRef.current.timeScale().fitContent();
      } catch {}
    }
  };

  const getLatestBarInfo = (): TooltipData | null => {
    const len = ohlcv.timestamp.length;
    if (len === 0) return null;
    const idx = len - 1;
    const o = ohlcv.open[idx] ?? 0;
    const h = ohlcv.high[idx] ?? 0;
    const l = ohlcv.low[idx] ?? 0;
    const c = ohlcv.close[idx] ?? 0;
    const prevC = idx > 0 ? (ohlcv.close[idx - 1] ?? o) : o;
    const change = c - prevC;
    const changePct = prevC > 0 ? (change / prevC) * 100 : 0;
    const vol = ohlcv.volume[idx] ?? 0;

    const rawDate = ohlcv.timestamp[idx];
    const dateObj = new Date(rawDate < 1e12 ? rawDate * 1000 : rawDate);
    const dateStr = `${dateObj.getFullYear()}/${String(dateObj.getMonth() + 1).padStart(2, "0")}/${String(dateObj.getDate()).padStart(2, "0")}`;

    return {
      date: dateStr,
      open: o,
      high: h,
      low: l,
      close: c,
      change,
      changePct,
      volume: vol,
      sma5: ind.sma5[idx],
      sma10: ind.sma10[idx],
      sma20: ind.sma20[idx],
    };
  };

  const displayData = hoverInfo || getLatestBarInfo();

  useEffect(() => {
    if (!mainContainerRef.current) return;

    const times = ohlcv.timestamp.map((t) => (t < 1e12 ? t : Math.floor(t / 1000)) as UTCTimestamp);
    const toLineData = (arr: number[]) =>
      times.map((t, i) => ({ time: t, value: arr[i] })).filter((d) => !isNaN(d.value) && d.value !== null && d.value !== undefined);

    const isDual = type !== "main";
    const mainWidth = mainContainerRef.current.clientWidth;
    const mainHeight = mainContainerRef.current.clientHeight || (isDual ? 320 : 540);

    const mainChart = createChart(mainContainerRef.current, {
      ...getChartOptions(isWarm),
      width: mainWidth,
      height: mainHeight,
    });
    mainChartRef.current = mainChart;

    // 蠟燭線
    const candleSeries = mainChart.addCandlestickSeries({
      upColor: isWarm ? "#dc2626" : "#ff5252", downColor: isWarm ? "#16a34a" : "#4caf50",
      borderUpColor: isWarm ? "#dc2626" : "#ff5252", borderDownColor: isWarm ? "#16a34a" : "#4caf50",
      wickUpColor: isWarm ? "#dc2626" : "#ff5252", wickDownColor: isWarm ? "#16a34a" : "#4caf50",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const candleData = ohlcv.timestamp.map((_, i) => ({
      time: times[i],
      open: ohlcv.open[i] ?? 0, high: ohlcv.high[i] ?? 0,
      low: ohlcv.low[i] ?? 0, close: ohlcv.close[i] ?? 0,
    })).filter((d) => d.open && d.close);
    candleSeries.setData(candleData);

    // 成交量
    const volumeSeries = mainChart.addHistogramSeries({
      color: "#26a69a",
      priceFormat: { type: "volume" },
      priceScaleId: "",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.76, bottom: 0 },
    });
    const volData = times.map((t, i) => {
      const o = ohlcv.open[i] ?? 0;
      const c = ohlcv.close[i] ?? 0;
      const isUp = c >= o;
      return {
        time: t,
        value: ohlcv.volume[i] ?? 0,
        color: isUp ? (isWarm ? "rgba(220, 38, 38, 0.65)" : "rgba(255, 82, 82, 0.65)") : (isWarm ? "rgba(22, 163, 74, 0.65)" : "rgba(76, 175, 80, 0.65)"),
      };
    }).filter((d) => d.value > 0);
    volumeSeries.setData(volData);

    // 均線與布林
    const sma5s = mainChart.addLineSeries({ color: isWarm ? "#ea580c" : "#ff9800", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const sma10s = mainChart.addLineSeries({ color: isWarm ? "#0284c7" : "#03a9f4", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const sma20s = mainChart.addLineSeries({ color: isWarm ? "#d97706" : "#ffea00", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const bbUpS = mainChart.addLineSeries({ color: isWarm ? "rgba(126, 34, 206, 0.8)" : "rgba(179, 157, 219, 0.8)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const bbLoS = mainChart.addLineSeries({ color: isWarm ? "rgba(126, 34, 206, 0.8)" : "rgba(179, 157, 219, 0.8)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });

    sma5s.setData(toLineData(ind.sma5));
    sma10s.setData(toLineData(ind.sma10));
    sma20s.setData(toLineData(ind.sma20));
    bbUpS.setData(toLineData(ind.bbUpper));
    bbLoS.setData(toLineData(ind.bbLower));

    // 懸停十字線 HUD
    mainChart.subscribeCrosshairMove((param) => {
      if (
        !param.point ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > (mainContainerRef.current?.clientWidth ?? 0) ||
        param.point.y < 0 ||
        param.point.y > (mainContainerRef.current?.clientHeight ?? 0)
      ) {
        setHoverInfo(null);
        return;
      }

      const tNum = typeof param.time === "number" ? param.time : (param.time as any);
      const idx = times.findIndex((t) => t === tNum);
      if (idx === -1) {
        setHoverInfo(null);
        return;
      }

      const o = ohlcv.open[idx] ?? 0;
      const h = ohlcv.high[idx] ?? 0;
      const l = ohlcv.low[idx] ?? 0;
      const c = ohlcv.close[idx] ?? 0;
      const prevC = idx > 0 ? (ohlcv.close[idx - 1] ?? o) : o;
      const change = c - prevC;
      const changePct = prevC > 0 ? (change / prevC) * 100 : 0;
      const vol = ohlcv.volume[idx] ?? 0;

      const rawDate = ohlcv.timestamp[idx];
      const dateObj = new Date(rawDate < 1e12 ? rawDate * 1000 : rawDate);
      const dateStr = `${dateObj.getFullYear()}/${String(dateObj.getMonth() + 1).padStart(2, "0")}/${String(dateObj.getDate()).padStart(2, "0")}`;

      setHoverInfo({
        date: dateStr,
        open: o,
        high: h,
        low: l,
        close: c,
        change,
        changePct,
        volume: vol,
        sma5: ind.sma5[idx],
        sma10: ind.sma10[idx],
        sma20: ind.sma20[idx],
      });
    });

    let subChart: IChartApi | null = null;

    if (isDual && subContainerRef.current) {
      const subWidth = subContainerRef.current.clientWidth;
      const subHeight = subContainerRef.current.clientHeight || 240;
      subChart = createChart(subContainerRef.current, {
        ...getChartOptions(isWarm),
        width: subWidth,
        height: subHeight,
      });
      subChartRef.current = subChart;

      if (type === "kd") {
        const kS = subChart.addLineSeries({ color: isWarm ? "#0284c7" : "#00bcd4", lineWidth: 2, title: "K" });
        const dS = subChart.addLineSeries({ color: isWarm ? "#d97706" : "#ffc107", lineWidth: 2, title: "D" });
        const ob = subChart.addLineSeries({ color: isWarm ? "rgba(220,38,38,0.5)" : "rgba(255,82,82,0.5)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
        const os = subChart.addLineSeries({ color: isWarm ? "rgba(22,163,74,0.5)" : "rgba(76,175,80,0.5)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
        kS.setData(toLineData(ind.k));
        dS.setData(toLineData(ind.d));
        ob.setData(times.map((t) => ({ time: t, value: 80 })));
        os.setData(times.map((t) => ({ time: t, value: 20 })));
      } else if (type === "macd") {
        const macdS = subChart.addLineSeries({ color: isWarm ? "#1e293b" : "#ffffff", lineWidth: 2, title: "DIF" });
        const sigS = subChart.addLineSeries({ color: isWarm ? "#0284c7" : "#03a9f4", lineWidth: 2, title: "DEA" });
        const histS = subChart.addHistogramSeries({ color: isWarm ? "#15803d" : "#4caf50", title: "OSC 柱狀圖" });
        const zero = subChart.addLineSeries({ color: isWarm ? "rgba(140,110,80,0.3)" : "rgba(255,255,255,0.2)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
        macdS.setData(toLineData(ind.macd));
        sigS.setData(toLineData(ind.signal));
        zero.setData(times.map((t) => ({ time: t, value: 0 })));
        histS.setData(times.map((t, i) => ({
          time: t, value: ind.hist[i],
          color: (ind.hist[i] ?? 0) >= 0 ? (isWarm ? "rgba(220,38,38,0.8)" : "rgba(255,82,82,0.75)") : (isWarm ? "rgba(22,163,74,0.8)" : "rgba(76,175,80,0.75)"),
        })).filter((d) => !isNaN(d.value)));
      } else if (type === "rsi") {
        const rsiS = subChart.addLineSeries({ color: isWarm ? "#db2777" : "#f06292", lineWidth: 2, title: "RSI" });
        const ob = subChart.addLineSeries({ color: isWarm ? "rgba(220,38,38,0.5)" : "rgba(255,82,82,0.5)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
        const os = subChart.addLineSeries({ color: isWarm ? "rgba(22,163,74,0.5)" : "rgba(76,175,80,0.5)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
        const mid = subChart.addLineSeries({ color: isWarm ? "rgba(140,110,80,0.3)" : "rgba(255,255,255,0.2)", lineWidth: 1, lineStyle: 3, lastValueVisible: false, priceLineVisible: false });
        rsiS.setData(toLineData(ind.rsi));
        ob.setData(times.map((t) => ({ time: t, value: 70 })));
        os.setData(times.map((t) => ({ time: t, value: 30 })));
        mid.setData(times.map((t) => ({ time: t, value: 50 })));
      } else if (type === "obv") {
        const obvS = subChart.addLineSeries({ color: isWarm ? "#9333ea" : "#c084fc", lineWidth: 2, title: "OBV" });
        const obvMaS = subChart.addLineSeries({ color: isWarm ? "#ea580c" : "#ff9800", lineWidth: 1, lineStyle: 2, title: "OBV 10MA" });
        obvS.setData(toLineData(ind.obv));
        obvMaS.setData(toLineData(ind.obvMa10));
      } else if (type === "wr") {
        const wrS = subChart.addLineSeries({ color: isWarm ? "#ea580c" : "#fb923c", lineWidth: 2, title: "Wm%R" });
        const wob = subChart.addLineSeries({ color: isWarm ? "rgba(220,38,38,0.5)" : "rgba(255,82,82,0.5)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
        const wos = subChart.addLineSeries({ color: isWarm ? "rgba(22,163,74,0.5)" : "rgba(76,175,80,0.5)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
        wrS.setData(toLineData(ind.williamsR));
        wob.setData(times.map((t) => ({ time: t, value: -20 })));
        wos.setData(times.map((t) => ({ time: t, value: -80 })));
      } else if (type === "atr") {
        const atrS = subChart.addLineSeries({ color: isWarm ? "#0d9488" : "#2dd4bf", lineWidth: 2, title: "ATR" });
        atrS.setData(toLineData(ind.atr));
      }

      // 雙圖時間軸連動同步
      mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && subChartRef.current) subChartRef.current.timeScale().setVisibleLogicalRange(range);
      });
      subChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
        if (range && mainChartRef.current) mainChartRef.current.timeScale().setVisibleLogicalRange(range);
      });
    }

    mainChart.timeScale().fitContent();
    if (subChart) subChart.timeScale().fitContent();

    const handleResize = () => {
      if (mainContainerRef.current) {
        mainChart.applyOptions({
          width: mainContainerRef.current.clientWidth,
          height: mainContainerRef.current.clientHeight,
        });
      }
      if (subContainerRef.current && subChart) {
        subChart.applyOptions({
          width: subContainerRef.current.clientWidth,
          height: subContainerRef.current.clientHeight,
        });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      mainChartRef.current = null;
      subChartRef.current = null;
      mainChart.remove();
      if (subChart) subChart.remove();
    };
  }, [type, ohlcv, ind, isWarm]);

  const getTitle = () => {
    if (type === "main") return "K線與均線全景 (含成交量)";
    if (type === "kd") return "KD 隨機指標 (9, 3, 3)";
    if (type === "macd") return "MACD 平滑異同移動平均線 (12, 26, 9)";
    if (type === "rsi") return "RSI 相對強弱指標 (14)";
    if (type === "obv") return "OBV 能量潮指標 (含 10MA)";
    if (type === "wr") return "Williams %R 威廉指標 (14)";
    return "ATR 真實波動區間指標 (14)";
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 50000, background: isWarm ? "rgba(246, 241, 232, 0.98)" : "rgba(10, 10, 18, 0.98)",
      backdropFilter: "blur(20px)", display: "flex", flexDirection: "column",
      padding: "20px 24px", color: isWarm ? "#18181b" : "#f0f2f5"
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: "var(--accent-blue)" }}>
            {name} ({symbol}) — {getTitle()}
          </h3>
          <div style={{ fontSize: "0.8rem", color: isWarm ? "#57534e" : "rgba(255,255,255,0.6)", marginTop: "4px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <span><span style={{ color: isWarm ? "#ea580c" : "#ff9800" }}>●</span> MA5 (橘)</span>
            <span><span style={{ color: isWarm ? "#0284c7" : "#03a9f4" }}>●</span> MA10 (藍)</span>
            <span><span style={{ color: isWarm ? "#d97706" : "#ffea00" }}>●</span> MA20 (黃)</span>
            <span><span style={{ color: isWarm ? "rgba(126, 34, 206, 0.9)" : "rgba(179, 157, 219, 0.9)" }}>- -</span> 布林通道 (紫)</span>
            <span><span style={{ color: "#26a69a" }}>■</span> 成交量 (紅/綠柱)</span>
            {type === "kd" && <span><span style={{ color: isWarm ? "#0284c7" : "#00bcd4" }}>●</span> K線 <span style={{ color: isWarm ? "#d97706" : "#ffc107" }}>●</span> D線 <span style={{ color: isWarm ? "rgba(220,38,38,0.8)" : "rgba(255,82,82,0.8)" }}>- -</span> 80超買 <span style={{ color: isWarm ? "rgba(22,163,74,0.8)" : "rgba(76,175,80,0.8)" }}>- -</span> 20超賣</span>}
            {type === "macd" && <span><span style={{ color: isWarm ? "#1e293b" : "#ffffff" }}>●</span> DIF快線 <span style={{ color: isWarm ? "#0284c7" : "#03a9f4" }}>●</span> DEA慢線 <span style={{ color: isWarm ? "#15803d" : "#4caf50" }}>■</span> OSC柱狀圖</span>}
            {type === "rsi" && <span><span style={{ color: isWarm ? "#db2777" : "#f06292" }}>●</span> RSI(14) <span style={{ color: isWarm ? "rgba(220,38,38,0.8)" : "rgba(255,82,82,0.8)" }}>- -</span> 70超買 <span style={{ color: isWarm ? "rgba(22,163,74,0.8)" : "rgba(76,175,80,0.8)" }}>- -</span> 30超賣</span>}
            {type === "obv" && <span><span style={{ color: isWarm ? "#9333ea" : "#c084fc" }}>●</span> OBV能量潮 <span style={{ color: isWarm ? "#ea580c" : "#ff9800" }}>- -</span> 10日均線</span>}
            {type === "wr" && <span><span style={{ color: isWarm ? "#ea580c" : "#fb923c" }}>●</span> Williams %R <span style={{ color: isWarm ? "rgba(220,38,38,0.8)" : "rgba(255,82,82,0.8)" }}>- -</span> -20超買 <span style={{ color: isWarm ? "rgba(22,163,74,0.8)" : "rgba(76,175,80,0.8)" }}>- -</span> -80超賣</span>}
            {type === "atr" && <span><span style={{ color: isWarm ? "#0d9488" : "#2dd4bf" }}>●</span> ATR(14) 真實波動幅度</span>}
          </div>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button 
            onClick={resetZoom}
            style={{
              background: isWarm ? "rgba(140, 110, 80, 0.1)" : "rgba(255,255,255,0.08)",
              border: `1px solid ${isWarm ? "rgba(140, 110, 80, 0.25)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: "6px", padding: "6px 14px", color: isWarm ? "#18181b" : "#fff",
              cursor: "pointer", fontSize: "0.85rem", transition: "all 0.2s"
            }}
          >
            🔄 重設縮放
          </button>
          <button 
            onClick={onClose}
            style={{
              background: isWarm ? "rgba(220,38,38,0.12)" : "rgba(255,82,82,0.15)",
              border: `1px solid ${isWarm ? "rgba(220,38,38,0.3)" : "rgba(255,82,82,0.4)"}`,
              borderRadius: "50%", width: "36px", height: "36px", color: isWarm ? "#dc2626" : "#fca5a5",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.1rem", transition: "all 0.2s"
            }}
            title="關閉技術圖表視窗"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Chart Containers */}
      <div style={{ position: "relative", flex: 1, width: "100%", height: "100%", display: "flex", flexDirection: "column", gap: "8px" }}>
        {/* Main K-line chart */}
        <div style={{ position: "relative", width: "100%", flex: type === "main" ? 1 : 0.58, minHeight: 0 }}>
          <div ref={mainContainerRef} style={{ width: "100%", height: "100%" }} />
          {displayData && (
            <ChartHUDView data={displayData} isWarm={isWarm} />
          )}
        </div>

        {/* Sub-chart if type !== 'main' */}
        {type !== "main" && (
          <div style={{ position: "relative", width: "100%", flex: 0.42, minHeight: 0, borderTop: isWarm ? "1px solid rgba(140, 110, 80, 0.18)" : "1px solid rgba(255,255,255,0.08)", paddingTop: "4px" }}>
            <div style={{ position: "absolute", top: "6px", left: "10px", zIndex: 10, fontSize: "0.75rem", fontWeight: 700, color: isWarm ? "#57534e" : "rgba(255,255,255,0.6)" }}>
              📊 {getTitle()}
            </div>
            <div ref={subContainerRef} style={{ width: "100%", height: "100%" }} />
          </div>
        )}
      </div>
    </div>
  );
};

// ─── 主元件 ───────────────────────────────────────────────────────────────────
export const ChartPanel: React.FC<ChartPanelProps> = ({ ohlcv, ind, symbol, name, sidebarCollapsed, onToggleSidebar }) => {
  const [theme] = useAppTheme();
  const isWarm = theme === "warm";
  const mainRef = useRef<HTMLDivElement>(null);
  const chartsRef = useRef<IChartApi[]>([]);
  const [zoomChart, setZoomChart] = useState<"main" | SubChartType | null>(null);
  const [hoverInfo, setHoverInfo] = useState<TooltipData | null>(null);

  const getLatestBarInfo = (): TooltipData | null => {
    const len = ohlcv.timestamp.length;
    if (len === 0) return null;
    const idx = len - 1;
    const o = ohlcv.open[idx] ?? 0;
    const h = ohlcv.high[idx] ?? 0;
    const l = ohlcv.low[idx] ?? 0;
    const c = ohlcv.close[idx] ?? 0;
    const prevC = idx > 0 ? (ohlcv.close[idx - 1] ?? o) : o;
    const change = c - prevC;
    const changePct = prevC > 0 ? (change / prevC) * 100 : 0;
    const vol = ohlcv.volume[idx] ?? 0;

    const rawDate = ohlcv.timestamp[idx];
    const dateObj = new Date(rawDate < 1e12 ? rawDate * 1000 : rawDate);
    const dateStr = `${dateObj.getFullYear()}/${String(dateObj.getMonth() + 1).padStart(2, "0")}/${String(dateObj.getDate()).padStart(2, "0")}`;

    return {
      date: dateStr,
      open: o,
      high: h,
      low: l,
      close: c,
      change,
      changePct,
      volume: vol,
      sma5: ind.sma5[idx],
      sma10: ind.sma10[idx],
      sma20: ind.sma20[idx],
    };
  };

  const displayData = hoverInfo || getLatestBarInfo();

  const resetZoom = () => {
    chartsRef.current.forEach((chart) => {
      try {
        chart.timeScale().fitContent();
      } catch {}
    });
  };

  if (!ohlcv || ohlcv.timestamp.length < 5) {
    return (
      <div className="empty-state" style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "12px", padding: "40px" }}>
        <div style={{ fontSize: "2.8rem" }}>⏳</div>
        <div style={{ color: "var(--text-primary)", fontWeight: 700, fontSize: "1.1rem" }}>正在連線載入【{name || symbol}】完整歷史日 K 棒...</div>
        <div style={{ color: "#94a3b8", fontSize: "0.85rem", textAlign: "center", maxWidth: "420px" }}>
          目前僅獲取到交易所最新即時快照，技術指標需 20 根以上日 K 棒進行運算。請稍候或重新點擊「分析」。
        </div>
      </div>
    );
  }

  useEffect(() => {
    if (!mainRef.current || ohlcv.timestamp.length === 0) return;

    // 清除舊圖
    chartsRef.current.forEach((c) => c.remove());
    chartsRef.current = [];

    const times = ohlcv.timestamp.map((t) => (t < 1e12 ? t : Math.floor(t / 1000)) as UTCTimestamp);
    const toLineData = (arr: number[]) =>
      times.map((t, i) => ({ time: t, value: arr[i] })).filter((d) => !isNaN(d.value) && d.value !== null && d.value !== undefined);

    // ── 1. 主圖 K線 + 內嵌成交量 + 均線 + 布林 ──────────────────────────────────────────
    const mainHeight = Math.max(540, (mainRef.current?.clientHeight ?? 0) || 560);
    const mainChart = createChart(mainRef.current!, {
      ...getChartOptions(isWarm),
      width: mainRef.current!.clientWidth,
      height: mainHeight,
    });
    chartsRef.current.push(mainChart);

    // 蠟燭線 (無橫向虛線與刻度盒)
    const candleSeries = mainChart.addCandlestickSeries({
      upColor: isWarm ? "#dc2626" : "#ff5252", downColor: isWarm ? "#16a34a" : "#4caf50",
      borderUpColor: isWarm ? "#dc2626" : "#ff5252", borderDownColor: isWarm ? "#16a34a" : "#4caf50",
      wickUpColor: isWarm ? "#dc2626" : "#ff5252", wickDownColor: isWarm ? "#16a34a" : "#4caf50",
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const candleData = ohlcv.timestamp.map((_, i) => ({
      time: times[i],
      open: ohlcv.open[i] ?? 0, high: ohlcv.high[i] ?? 0,
      low: ohlcv.low[i] ?? 0, close: ohlcv.close[i] ?? 0,
    })).filter((d) => d.open && d.close);
    candleSeries.setData(candleData);

    // 主圖內建成交量 (底部 22% 區間)
    const volumeSeries = mainChart.addHistogramSeries({
      color: "#26a69a",
      priceFormat: { type: "volume" },
      priceScaleId: "",
      priceLineVisible: false,
      lastValueVisible: false,
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0,
      },
    });
    const volData = times.map((t, i) => {
      const o = ohlcv.open[i] ?? 0;
      const c = ohlcv.close[i] ?? 0;
      const isUp = c >= o;
      return {
        time: t,
        value: ohlcv.volume[i] ?? 0,
        color: isUp ? (isWarm ? "rgba(220, 38, 38, 0.65)" : "rgba(255, 82, 82, 0.65)") : (isWarm ? "rgba(22, 163, 74, 0.65)" : "rgba(76, 175, 80, 0.65)"),
      };
    }).filter((d) => d.value > 0);
    volumeSeries.setData(volData);

    // 均線與布林通道 (不設 title、關閉價格線與軸標籤)
    const sma5s = mainChart.addLineSeries({ color: isWarm ? "#ea580c" : "#ff9800", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const sma10s = mainChart.addLineSeries({ color: isWarm ? "#0284c7" : "#03a9f4", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const sma20s = mainChart.addLineSeries({ color: isWarm ? "#d97706" : "#ffea00", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const bbUpS = mainChart.addLineSeries({ color: isWarm ? "rgba(126, 34, 206, 0.8)" : "rgba(179, 157, 219, 0.8)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const bbLoS = mainChart.addLineSeries({ color: isWarm ? "rgba(126, 34, 206, 0.8)" : "rgba(179, 157, 219, 0.8)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });

    sma5s.setData(toLineData(ind.sma5));
    sma10s.setData(toLineData(ind.sma10));
    sma20s.setData(toLineData(ind.sma20));
    bbUpS.setData(toLineData(ind.bbUpper));
    bbLoS.setData(toLineData(ind.bbLower));

    // 懸停十字線 HUD 互動事件
    mainChart.subscribeCrosshairMove((param) => {
      if (
        !param.point ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > (mainRef.current?.clientWidth ?? 0) ||
        param.point.y < 0
      ) {
        setHoverInfo(null);
        return;
      }

      const tNum = typeof param.time === "number" ? param.time : (param.time as any);
      const idx = times.findIndex((t) => t === tNum);
      if (idx === -1) {
        setHoverInfo(null);
        return;
      }

      const o = ohlcv.open[idx] ?? 0;
      const h = ohlcv.high[idx] ?? 0;
      const l = ohlcv.low[idx] ?? 0;
      const c = ohlcv.close[idx] ?? 0;
      const prevC = idx > 0 ? (ohlcv.close[idx - 1] ?? o) : o;
      const change = c - prevC;
      const changePct = prevC > 0 ? (change / prevC) * 100 : 0;
      const vol = ohlcv.volume[idx] ?? 0;

      const rawDate = ohlcv.timestamp[idx];
      const dateObj = new Date(rawDate < 1e12 ? rawDate * 1000 : rawDate);
      const dateStr = `${dateObj.getFullYear()}/${String(dateObj.getMonth() + 1).padStart(2, "0")}/${String(dateObj.getDate()).padStart(2, "0")}`;

      setHoverInfo({
        date: dateStr,
        open: o,
        high: h,
        low: l,
        close: c,
        change,
        changePct,
        volume: vol,
        sma5: ind.sma5[idx],
        sma10: ind.sma10[idx],
        sma20: ind.sma20[idx],
      });
    });

    // 自動縮放到最新資料
    mainChart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (mainRef.current) {
        mainChart.applyOptions({
          width: mainRef.current.clientWidth,
          height: Math.max(540, mainRef.current.clientHeight || 560),
        });
      }
    });
    if (mainRef.current) ro.observe(mainRef.current);

    return () => {
      ro.disconnect();
      chartsRef.current.forEach((c) => { try { c.remove(); } catch {} });
      chartsRef.current = [];
    };
  }, [ohlcv, ind, isWarm]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: isWarm ? "#fdfbf7" : "#0a0a12", position: "relative" }}>
      <div style={{ padding: "8px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", background: isWarm ? "rgba(246, 241, 232, 0.95)" : "rgba(255,255,255,0.02)", borderBottom: isWarm ? "1px solid rgba(140, 110, 80, 0.18)" : "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          {onToggleSidebar && (
            <button
              onClick={onToggleSidebar}
              style={{
                background: sidebarCollapsed ? (isWarm ? "rgba(217, 119, 6, 0.12)" : "rgba(56, 189, 248, 0.15)") : (isWarm ? "rgba(140, 110, 80, 0.08)" : "rgba(255, 255, 255, 0.06)"),
                border: `1px solid ${sidebarCollapsed ? (isWarm ? "rgba(217, 119, 6, 0.4)" : "rgba(56, 189, 248, 0.4)") : (isWarm ? "rgba(140, 110, 80, 0.25)" : "rgba(255, 255, 255, 0.15)")}`,
                color: sidebarCollapsed ? (isWarm ? "#b45309" : "#38bdf8") : (isWarm ? "#44403c" : "rgba(255, 255, 255, 0.8)"),
                borderRadius: "6px",
                padding: "3px 9px",
                fontSize: "0.75rem",
                fontWeight: 700,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                transition: "all 0.2s ease",
              }}
              title={sidebarCollapsed ? "展開左側資訊欄" : "收合左側資訊欄"}
            >
              {sidebarCollapsed ? "▶ 展開側欄" : "◀ 側欄"}
            </button>
          )}
          <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--accent-blue)" }}>
            {name} ({symbol}) — K線主圖
          </span>
          <div style={{ fontSize: "0.75rem", color: isWarm ? "#57534e" : "rgba(255,255,255,0.6)", display: "flex", gap: "10px" }}>
            <span><span style={{ color: isWarm ? "#ea580c" : "#ff9800" }}>●</span> MA5 (橘)</span>
            <span><span style={{ color: isWarm ? "#0284c7" : "#03a9f4" }}>●</span> MA10 (藍)</span>
            <span><span style={{ color: isWarm ? "#d97706" : "#ffea00" }}>●</span> MA20 (黃)</span>
            <span><span style={{ color: isWarm ? "rgba(126, 34, 206, 0.9)" : "rgba(179, 157, 219, 0.9)" }}>- -</span> 布林通道 (紫)</span>
            <span><span style={{ color: "#26a69a" }}>■</span> 成交量 (紅/綠柱)</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <button 
            onClick={resetZoom}
            style={{ 
              padding: "4px 10px", 
              fontSize: "0.75rem", 
              background: isWarm ? "rgba(140, 110, 80, 0.08)" : "rgba(255, 255, 255, 0.05)", 
              color: isWarm ? "#44403c" : "rgba(255, 255, 255, 0.8)", 
              border: `1px solid ${isWarm ? "rgba(140, 110, 80, 0.25)" : "rgba(255, 255, 255, 0.15)"}`,
              borderRadius: "4px",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
          >
            🔄 重設縮放
          </button>
        </div>
      </div>
      
      {/* 主 K 線圖 (包含內建成交量柱狀圖，填滿空間) */}
      <div style={{ position: "relative", flex: 1, width: "100%", height: "100%", minHeight: "540px" }}>
        <div 
          ref={mainRef} 
          style={{ width: "100%", height: "100%", cursor: "zoom-in" }} 
          onClick={() => setZoomChart("main")}
          title="點擊全螢幕放大主圖"
        />
        {displayData && (
          <ChartHUDView data={displayData} />
        )}
      </div>

      {/* 放大 Modal */}
      {zoomChart && (
        <ZoomChartModal
          type={zoomChart}
          ohlcv={ohlcv}
          ind={ind}
          symbol={symbol}
          name={name}
          onClose={() => setZoomChart(null)}
        />
      )}
    </div>
  );
};
