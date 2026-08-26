import React, { useEffect, useRef, useState } from "react";
import { createChart, ColorType, IChartApi, UTCTimestamp } from "lightweight-charts";
import { OhlcvData, Indicators, calcSMA } from "../utils/indicators";

interface ChartPanelProps {
  ohlcv: OhlcvData;
  ind: Indicators;
  symbol: string;
  name: string;
}

type SubChartType = "vol" | "kd" | "macd" | "rsi" | "obv" | "wr" | "atr";

const CHART_OPTS = {
  layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "rgba(200,210,230,0.8)" },
  grid: { vertLines: { color: "rgba(255,255,255,0.03)" }, horzLines: { color: "rgba(255,255,255,0.03)" } },
  crosshair: { mode: 1 },
  leftPriceScale: { visible: true, borderColor: "rgba(255,255,255,0.1)" },
  rightPriceScale: { visible: false },
  timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true },
  handleScroll: { mouseWheel: true, pressedMouseMove: true },
  handleScale: { axisPressedMouseMove: true, mouseWheel: true },
};

// ─── 放大檢視互動式 Modal ───────────────────────────────────────────────────────
interface ZoomModalProps {
  type: "main" | SubChartType;
  ohlcv: OhlcvData;
  ind: Indicators;
  symbol: string;
  name: string;
  onClose: () => void;
}

const ZoomChartModal: React.FC<ZoomModalProps> = ({ type, ohlcv, ind, symbol, name, onClose }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const resetZoom = () => {
    if (chartRef.current) {
      try {
        chartRef.current.timeScale().fitContent();
      } catch {}
    }
  };
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const times = ohlcv.timestamp.map((t) => (t < 1e12 ? t : Math.floor(t / 1000)) as UTCTimestamp);
    const toLineData = (arr: number[]) =>
      times.map((t, i) => ({ time: t, value: arr[i] })).filter((d) => !isNaN(d.value) && d.value !== null && d.value !== undefined);

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight - 40;
    
    const chart = createChart(containerRef.current, {
      ...CHART_OPTS,
      width,
      height,
    });
    chartRef.current = chart;
    
    if (type === "main") {
      // 1. 蠟燭 K 線 (關閉綠色/紅色水平虛線)
      const candleSeries = chart.addCandlestickSeries({
        upColor: "#ff5252", downColor: "#4caf50",
        borderUpColor: "#ff5252", borderDownColor: "#4caf50",
        wickUpColor: "#ff5252", wickDownColor: "#4caf50",
        priceLineVisible: false,
        lastValueVisible: true,
      });
      const candleData = ohlcv.timestamp.map((_, i) => ({
        time: times[i],
        open: ohlcv.open[i] ?? 0, high: ohlcv.high[i] ?? 0,
        low: ohlcv.low[i] ?? 0, close: ohlcv.close[i] ?? 0,
      })).filter((d) => d.open && d.close);
      candleSeries.setData(candleData);

      // 2. 主圖內建成交量柱狀圖 (佔下方 22% 區塊)
      const volumeSeries = chart.addHistogramSeries({
        color: "#26a69a",
        priceFormat: { type: "volume" },
        priceScaleId: "",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.76,
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
          color: isUp ? "rgba(255, 82, 82, 0.65)" : "rgba(76, 175, 80, 0.65)",
        };
      }).filter((d) => d.value > 0);
      volumeSeries.setData(volData);

      // 3. 乾淨均線與布林通道 (不帶 title、關閉價格線與最後數值標籤)
      const sma5s = chart.addLineSeries({ color: "#ff9800", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
      const sma10s = chart.addLineSeries({ color: "#03a9f4", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
      const sma20s = chart.addLineSeries({ color: "#ffea00", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
      const bbUpS = chart.addLineSeries({ color: "rgba(179, 157, 219, 0.8)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
      const bbLoS = chart.addLineSeries({ color: "rgba(179, 157, 219, 0.8)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });

      sma5s.setData(toLineData(ind.sma5));
      sma10s.setData(toLineData(ind.sma10));
      sma20s.setData(toLineData(ind.sma20));
      bbUpS.setData(toLineData(ind.bbUpper));
      bbLoS.setData(toLineData(ind.bbLower));
    } else if (type === "vol") {
      const volSeries = chart.addHistogramSeries({
        color: "#26a69a",
        priceFormat: { type: "volume" },
        title: "成交量",
      });
      const volData = times.map((t, i) => {
        const o = ohlcv.open[i] ?? 0;
        const c = ohlcv.close[i] ?? 0;
        const isUp = c >= o;
        return {
          time: t,
          value: ohlcv.volume[i] ?? 0,
          color: isUp ? "rgba(255, 82, 82, 0.85)" : "rgba(76, 175, 80, 0.85)",
        };
      }).filter((d) => d.value > 0);
      volSeries.setData(volData);

      const vMa5S = chart.addLineSeries({ color: "#ff9800", lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      const vMa20S = chart.addLineSeries({ color: "#03a9f4", lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      vMa5S.setData(toLineData(calcSMA(ohlcv.volume, 5)));
      vMa20S.setData(toLineData(ind.volMa20 || calcSMA(ohlcv.volume, 20)));
    } else if (type === "rsi") {
      const rsiS = chart.addLineSeries({ color: "#f06292", lineWidth: 1, title: "RSI" });
      const ob = chart.addLineSeries({ color: "rgba(255,82,82,0.4)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
      const os = chart.addLineSeries({ color: "rgba(76,175,80,0.4)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
      rsiS.setData(toLineData(ind.rsi));
      ob.setData(times.map((t) => ({ time: t, value: 70 })));
      os.setData(times.map((t) => ({ time: t, value: 30 })));
    } else if (type === "kd") {
      const kS = chart.addLineSeries({ color: "#00bcd4", lineWidth: 1, title: "K" });
      const dS = chart.addLineSeries({ color: "#ffc107", lineWidth: 1, title: "D" });
      kS.setData(toLineData(ind.k));
      dS.setData(toLineData(ind.d));
    } else if (type === "macd") {
      const macdS = chart.addLineSeries({ color: "#ffffff", lineWidth: 1, title: "DIF" });
      const sigS = chart.addLineSeries({ color: "#03a9f4", lineWidth: 1, title: "DEA" });
      const histS = chart.addHistogramSeries({ color: "#4caf50", title: "Hist" });
      macdS.setData(toLineData(ind.macd));
      sigS.setData(toLineData(ind.signal));
      histS.setData(times.map((t, i) => ({
        time: t, value: ind.hist[i],
        color: (ind.hist[i] ?? 0) >= 0 ? "rgba(255,82,82,0.7)" : "rgba(76,175,80,0.7)",
      })).filter((d) => !isNaN(d.value)));
    } else if (type === "obv") {
      const obvS = chart.addLineSeries({ color: "#9c27b0", lineWidth: 1, title: "OBV" });
      const obvMaS = chart.addLineSeries({ color: "#ff9800", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
      obvS.setData(toLineData(ind.obv));
      obvMaS.setData(toLineData(ind.obvMa10));
    } else if (type === "wr") {
      const wrS = chart.addLineSeries({ color: "#e65100", lineWidth: 1, title: "Wm%R" });
      const wob = chart.addLineSeries({ color: "rgba(255,82,82,0.4)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
      const wos = chart.addLineSeries({ color: "rgba(76,175,80,0.4)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
      wrS.setData(toLineData(ind.williamsR));
      wob.setData(times.map((t) => ({ time: t, value: -20 })));
      wos.setData(times.map((t) => ({ time: t, value: -80 })));
    } else if (type === "atr") {
      const atrS = chart.addLineSeries({ color: "#1abc9c", lineWidth: 1, title: "ATR" });
      atrS.setData(toLineData(ind.atr));
    }
    
    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight - 40,
        });
      }
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chartRef.current = null;
      chart.remove();
    };
  }, [type, ohlcv, ind]);

  const getTitle = () => {
    if (type === "main") return "K線與技術分析";
    if (type === "vol") return "獨立成交量圖 (Volume + 5/20日均量)";
    if (type === "kd") return "KD 隨機指標";
    if (type === "macd") return "MACD 指標";
    if (type === "rsi") return "RSI 相對強弱指標";
    if (type === "obv") return "OBV 能量潮指標";
    if (type === "wr") return "Williams %R 威廉指標";
    return "ATR 真實波幅指標";
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      zIndex: 9999, background: "rgba(10, 10, 18, 0.98)",
      backdropFilter: "blur(20px)", display: "flex", flexDirection: "column",
      padding: "24px", color: "#f0f2f5"
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <div>
          <h3 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 600, color: "var(--accent-blue)" }}>
            {name} ({symbol}) — {getTitle()}
          </h3>
          {type === "main" && (
            <div style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.6)", marginTop: "4px", display: "flex", gap: "12px" }}>
              <span><span style={{ color: "#ff9800" }}>●</span> MA5 (橘)</span>
              <span><span style={{ color: "#03a9f4" }}>●</span> MA10 (藍)</span>
              <span><span style={{ color: "#ffea00" }}>●</span> MA20 (黃)</span>
              <span><span style={{ color: "rgba(179, 157, 219, 0.9)" }}>- -</span> 布林通道 (紫)</span>
              <span><span style={{ color: "#26a69a" }}>■</span> 成交量 (紅/綠柱)</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button 
            onClick={resetZoom}
            style={{
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "4px", padding: "6px 12px", color: "#fff",
              cursor: "pointer", fontSize: "0.85rem", transition: "all 0.2s"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(2, 136, 209, 0.2)";
              e.currentTarget.style.borderColor = "rgba(2, 136, 209, 0.4)";
              e.currentTarget.style.color = "#29b6f6";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
              e.currentTarget.style.color = "#fff";
            }}
          >
            🔄 重設縮放
          </button>
          <button 
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "50%", width: "36px", height: "36px", color: "#fff",
              cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: "1.1rem", transition: "all 0.2s"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(255,82,82,0.2)";
              e.currentTarget.style.borderColor = "rgba(255,82,82,0.4)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(255,255,255,0.08)";
              e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)";
            }}
          >
            ✕
          </button>
        </div>
      </div>
      <div ref={containerRef} style={{ flex: 1, width: "100%", height: "100%" }} />
    </div>
  );
};

// ─── 主元件 ───────────────────────────────────────────────────────────────────
export const ChartPanel: React.FC<ChartPanelProps> = ({ ohlcv, ind, symbol, name }) => {
  const mainRef = useRef<HTMLDivElement>(null);
  const subRefs = useRef<Record<SubChartType, HTMLDivElement | null>>({
    vol: null, kd: null, macd: null, rsi: null, obv: null, wr: null, atr: null,
  });
  const chartsRef = useRef<IChartApi[]>([]);
  const [zoomChart, setZoomChart] = useState<"main" | SubChartType | null>(null);

  const resetZoom = () => {
    chartsRef.current.forEach((chart) => {
      try {
        chart.timeScale().fitContent();
      } catch {}
    });
  };

  useEffect(() => {
    if (!mainRef.current || ohlcv.timestamp.length === 0) return;

    // 清除舊圖
    chartsRef.current.forEach((c) => c.remove());
    chartsRef.current = [];

    const times = ohlcv.timestamp.map((t) => (t < 1e12 ? t : Math.floor(t / 1000)) as UTCTimestamp);
    const toLineData = (arr: number[]) =>
      times.map((t, i) => ({ time: t, value: arr[i] })).filter((d) => !isNaN(d.value) && d.value !== null && d.value !== undefined);

    // ── 1. 主圖 K線 + 成交量 + 均線 + 布林 ──────────────────────────────────────────────
    const mainChart = createChart(mainRef.current!, {
      ...CHART_OPTS,
      width: mainRef.current!.clientWidth,
      height: 280,
    });
    chartsRef.current.push(mainChart);

    // 蠟燭線 (關閉價格虛線)
    const candleSeries = mainChart.addCandlestickSeries({
      upColor: "#ff5252", downColor: "#4caf50",
      borderUpColor: "#ff5252", borderDownColor: "#4caf50",
      wickUpColor: "#ff5252", wickDownColor: "#4caf50",
      priceLineVisible: false,
      lastValueVisible: true,
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
        color: isUp ? "rgba(255, 82, 82, 0.65)" : "rgba(76, 175, 80, 0.65)",
      };
    }).filter((d) => d.value > 0);
    volumeSeries.setData(volData);

    // 均線與布林通道 (不設 title、關閉價格線與軸標籤)
    const sma5s = mainChart.addLineSeries({ color: "#ff9800", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const sma10s = mainChart.addLineSeries({ color: "#03a9f4", lineWidth: 1, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const sma20s = mainChart.addLineSeries({ color: "#ffea00", lineWidth: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const bbUpS = mainChart.addLineSeries({ color: "rgba(179, 157, 219, 0.8)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });
    const bbLoS = mainChart.addLineSeries({ color: "rgba(179, 157, 219, 0.8)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false });

    sma5s.setData(toLineData(ind.sma5));
    sma10s.setData(toLineData(ind.sma10));
    sma20s.setData(toLineData(ind.sma20));
    bbUpS.setData(toLineData(ind.bbUpper));
    bbLoS.setData(toLineData(ind.bbLower));

    // ── 2. 獨立成交量副圖 (Volume + 5/20日均量) ────────────────────────────────
    const volEl = subRefs.current.vol;
    if (volEl) {
      const volChart = createChart(volEl, { ...CHART_OPTS, width: volEl.clientWidth, height: 90 });
      chartsRef.current.push(volChart);

      const subVolSeries = volChart.addHistogramSeries({
        color: "#26a69a",
        priceFormat: { type: "volume" },
        title: "成交量",
      });

      subVolSeries.setData(volData);

      const vMa5S = volChart.addLineSeries({ color: "#ff9800", lineWidth: 1, lastValueVisible: false, priceLineVisible: false });
      const vMa20S = volChart.addLineSeries({ color: "#03a9f4", lineWidth: 1, lastValueVisible: false, priceLineVisible: false });

      vMa5S.setData(toLineData(calcSMA(ohlcv.volume, 5)));
      vMa20S.setData(toLineData(ind.volMa20 || calcSMA(ohlcv.volume, 20)));

      mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) volChart.timeScale().setVisibleLogicalRange(range); });
      volChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) mainChart.timeScale().setVisibleLogicalRange(range); });
    }

    // ── 3. KD ──────────────────────────────────────────────────────────────────
    const kdEl = subRefs.current.kd;
    if (kdEl) {
      const kdChart = createChart(kdEl, { ...CHART_OPTS, width: kdEl.clientWidth, height: 80 });
      chartsRef.current.push(kdChart);
      const kS = kdChart.addLineSeries({ color: "#00bcd4", lineWidth: 1, title: "K" });
      const dS = kdChart.addLineSeries({ color: "#ffc107", lineWidth: 1, title: "D" });
      kS.setData(toLineData(ind.k));
      dS.setData(toLineData(ind.d));
      mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) kdChart.timeScale().setVisibleLogicalRange(range); });
      kdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) mainChart.timeScale().setVisibleLogicalRange(range); });
    }

    // ── 4. MACD ────────────────────────────────────────────────────────────────
    const macdEl = subRefs.current.macd;
    if (macdEl) {
      const macdChart = createChart(macdEl, { ...CHART_OPTS, width: macdEl.clientWidth, height: 80 });
      chartsRef.current.push(macdChart);
      const macdS = macdChart.addLineSeries({ color: "#ffffff", lineWidth: 1, title: "DIF" });
      const sigS = macdChart.addLineSeries({ color: "#03a9f4", lineWidth: 1, title: "DEA" });
      const histS = macdChart.addHistogramSeries({ color: "#4caf50", title: "Hist" });
      macdS.setData(toLineData(ind.macd));
      sigS.setData(toLineData(ind.signal));
      histS.setData(times.map((t, i) => ({
        time: t, value: ind.hist[i],
        color: (ind.hist[i] ?? 0) >= 0 ? "rgba(255,82,82,0.7)" : "rgba(76,175,80,0.7)",
      })).filter((d) => !isNaN(d.value)));
      mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) macdChart.timeScale().setVisibleLogicalRange(range); });
      macdChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) mainChart.timeScale().setVisibleLogicalRange(range); });
    }

    // ── 5. RSI ────────────────────────────────────────────────────────────────
    const rsiEl = subRefs.current.rsi;
    if (rsiEl) {
      const rsiChart = createChart(rsiEl, { ...CHART_OPTS, width: rsiEl.clientWidth, height: 80 });
      chartsRef.current.push(rsiChart);
      const rsiS = rsiChart.addLineSeries({ color: "#f06292", lineWidth: 1, title: "RSI" });
      const ob = rsiChart.addLineSeries({ color: "rgba(255,82,82,0.4)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
      const os = rsiChart.addLineSeries({ color: "rgba(76,175,80,0.4)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
      rsiS.setData(toLineData(ind.rsi));
      ob.setData(times.map((t) => ({ time: t, value: 70 })));
      os.setData(times.map((t) => ({ time: t, value: 30 })));
      mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) rsiChart.timeScale().setVisibleLogicalRange(range); });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) mainChart.timeScale().setVisibleLogicalRange(range); });
    }

    // ── 6. OBV ─────────────────────────────────────────────────────────────────
    const obvEl = subRefs.current.obv;
    if (obvEl) {
      const obvChart = createChart(obvEl, { ...CHART_OPTS, width: obvEl.clientWidth, height: 70 });
      chartsRef.current.push(obvChart);
      const obvS = obvChart.addLineSeries({ color: "#9c27b0", lineWidth: 1, title: "OBV" });
      const obvMaS = obvChart.addLineSeries({ color: "#ff9800", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
      obvS.setData(toLineData(ind.obv));
      obvMaS.setData(toLineData(ind.obvMa10));
      mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) obvChart.timeScale().setVisibleLogicalRange(range); });
      obvChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) mainChart.timeScale().setVisibleLogicalRange(range); });
    }

    // ── 7. Williams %R ─────────────────────────────────────────────────────────
    const wrEl = subRefs.current.wr;
    if (wrEl) {
      const wrChart = createChart(wrEl, { ...CHART_OPTS, width: wrEl.clientWidth, height: 70 });
      chartsRef.current.push(wrChart);
      const wrS = wrChart.addLineSeries({ color: "#e65100", lineWidth: 1, title: "Wm%R" });
      const wob = wrChart.addLineSeries({ color: "rgba(255,82,82,0.4)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
      const wos = wrChart.addLineSeries({ color: "rgba(76,175,80,0.4)", lineWidth: 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false });
      wrS.setData(toLineData(ind.williamsR));
      wob.setData(times.map((t) => ({ time: t, value: -20 })));
      wos.setData(times.map((t) => ({ time: t, value: -80 })));
      mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) wrChart.timeScale().setVisibleLogicalRange(range); });
      wrChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) mainChart.timeScale().setVisibleLogicalRange(range); });
    }

    // ── 8. ATR ─────────────────────────────────────────────────────────────────
    const atrEl = subRefs.current.atr;
    if (atrEl) {
      const atrChart = createChart(atrEl, { ...CHART_OPTS, width: atrEl.clientWidth, height: 70 });
      chartsRef.current.push(atrChart);
      const atrS = atrChart.addLineSeries({ color: "#1abc9c", lineWidth: 1, title: "ATR" });
      atrS.setData(toLineData(ind.atr));
      mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) atrChart.timeScale().setVisibleLogicalRange(range); });
      atrChart.timeScale().subscribeVisibleLogicalRangeChange((range) => { if (range) mainChart.timeScale().setVisibleLogicalRange(range); });
    }

    // 自動縮放到最新資料
    mainChart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver(() => {
      chartsRef.current.forEach((ch, idx) => {
        const el = idx === 0 ? mainRef.current : Object.values(subRefs.current)[idx - 1];
        if (el) ch.applyOptions({ width: el.clientWidth });
      });
    });
    if (mainRef.current) ro.observe(mainRef.current);

    return () => {
      ro.disconnect();
      chartsRef.current.forEach((c) => { try { c.remove(); } catch {} });
      chartsRef.current = [];
    };
  }, [ohlcv, ind]);

  const subCharts: { key: SubChartType; label: string }[] = [
    { key: "vol", label: "📊 成交量 (Volume + 5/20日均量)" },
    { key: "kd", label: "KD 隨機指標" },
    { key: "macd", label: "MACD 指標" },
    { key: "rsi", label: "RSI 相對強弱指標" },
    { key: "obv", label: "OBV 能量潮" },
    { key: "wr", label: "Williams %R 威廉指標" },
    { key: "atr", label: "ATR 真實波幅" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "auto", background: "#0a0a12", position: "relative" }}>
      <div style={{ padding: "6px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--accent-blue)" }}>
            {name} ({symbol})
          </span>
          <div style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.6)", display: "flex", gap: "10px" }}>
            <span><span style={{ color: "#ff9800" }}>●</span> MA5 (橘)</span>
            <span><span style={{ color: "#03a9f4" }}>●</span> MA10 (藍)</span>
            <span><span style={{ color: "#ffea00" }}>●</span> MA20 (黃)</span>
            <span><span style={{ color: "rgba(179, 157, 219, 0.9)" }}>- -</span> 布林通道 (紫)</span>
            <span><span style={{ color: "#26a69a" }}>■</span> 成交量 (紅/綠)</span>
          </div>
        </div>
        <button 
          onClick={resetZoom}
          style={{ 
            padding: "2px 8px", 
            fontSize: "0.75rem", 
            background: "rgba(255, 255, 255, 0.05)", 
            color: "rgba(255, 255, 255, 0.8)", 
            border: "1px solid rgba(255, 255, 255, 0.15)",
            borderRadius: "4px",
            cursor: "pointer",
            transition: "all 0.2s"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(2, 136, 209, 0.15)";
            e.currentTarget.style.color = "#29b6f6";
            e.currentTarget.style.borderColor = "rgba(2, 136, 209, 0.4)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(255, 255, 255, 0.05)";
            e.currentTarget.style.color = "rgba(255, 255, 255, 0.8)";
            e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.15)";
          }}
        >
          🔄 重設縮放
        </button>
      </div>
      
      {/* 主 K 線圖 (包含內建成交量柱狀圖) */}
      <div 
        ref={mainRef} 
        style={{ width: "100%", cursor: "zoom-in" }} 
        onClick={() => setZoomChart("main")}
        title="點擊放大主圖 (含成交量)"
      />
      
      {/* 各副圖 */}
      {subCharts.map(({ key, label }) => (
        <div 
          key={key} 
          className="sub-chart" 
          style={{ cursor: "zoom-in" }} 
          onClick={() => setZoomChart(key)}
          title={`點擊放大 ${label} 圖`}
        >
          <div className="chart-title">{label}</div>
          <div ref={(el) => { subRefs.current[key] = el; }} style={{ width: "100%" }} />
        </div>
      ))}

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
