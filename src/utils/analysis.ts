// ─────────────────────────────────────────────────────────────────────────────
// 分析邏輯 (完全移植自 Python 版 stock.py)
// ─────────────────────────────────────────────────────────────────────────────

import { Indicators } from "./indicators";

export interface Signal {
  title: string;
  desc: string;
  color: string;
}

export interface StockInfoFull {
  symbol: string;
  name: string;
  sector?: string;
  industry?: string;
  current_price?: number;
  previous_close?: number;
  pe?: number;
  forward_pe?: number;
  pb?: number;
  dividend_yield?: number;
  eps?: number;
  roe?: number;
  gross_margins?: number;
  operating_margins?: number;
  profit_margins?: number;
  revenue_growth?: number;
  earnings_growth?: number;
  current_ratio?: number;
  quick_ratio?: number;
  debt_to_equity?: number;
  free_cashflow?: number;
  operating_cashflow?: number;
  net_income?: number;
  market_cap?: number;
  long_business_summary?: string;
  // TWSE 補充
  tw_pe?: number;
  tw_pb?: number;
  tw_yield?: number;
}

// ─── 技術分析建議 ─────────────────────────────────────────────────────────────

export function getAnalysisSuggestions(
  ind: Indicators,
  n: number // 最後一個有效 index
): { signals: Signal[]; score: number } {
  const signals: Signal[] = [];
  let score = 0;

  const latest = (arr: number[]) => arr[n];
  const prev = (arr: number[]) => arr[n - 1] ?? arr[n];

  // 1. 長線趨勢 EMA50 vs EMA200
  const ema50 = latest(ind.ema50);
  const ema200 = latest(ind.ema200);
  if (!isNaN(ema200)) {
    if (ema50 > ema200) {
      signals.push({ title: "長線趨勢：多頭排列", desc: "50日均線大於200日均線，長線趨勢向上，具備支撐保護。", color: "#4caf50" });
      score += 1;
    } else {
      signals.push({ title: "📉 長線趨勢：空頭排列", desc: "50日均線小於200日均線，長線趨勢向下，上方壓力較重。", color: "#ff9800" });
      score -= 1;
    }
  } else {
    const sma20 = latest(ind.sma20);
    const close = latest(ind.sma5); // 用sma5近似close
    if (!isNaN(sma20)) {
      if (close > sma20) {
        signals.push({ title: "短線趨勢：站上月線", desc: "目前股價大於20日均線，短線呈現多方優勢。", color: "#4caf50" });
        score += 1;
      } else {
        signals.push({ title: "📉 短線趨勢：跌破月線", desc: "目前股價小於20日均線，短線呈現空方弱勢。", color: "#ff9800" });
        score -= 1;
      }
    }
  }

  // 2. 布林通道
  const bbU = latest(ind.bbUpper);
  const bbL = latest(ind.bbLower);
  const bbM = latest(ind.bbMiddle);
  // 用 ema50 作近似收盤
  const closeApprox = !isNaN(ema50) ? ema50 : bbM;
  if (!isNaN(bbU) && !isNaN(bbL)) {
    const bbRange = bbU - bbL;
    if (bbRange > 0) {
      const pos = ((closeApprox - bbL) / bbRange) * 100;
      if (pos > 100) {
        signals.push({ title: "布林通道：股價突破上軌", desc: "目前股價處於超買區，短期可能有回檔壓力。", color: "#ff5252" });
        score -= 1;
      } else if (pos < 0) {
        signals.push({ title: "✅ 布林通道：股價跌破下軌", desc: "目前股價處於超賣區，支撐力道增強，可關注反彈機會。", color: "#4caf50" });
        score += 1;
      } else {
        signals.push({ title: "💠 布林通道：通道內震盪", desc: `股價位於通道內，目前處於 ${pos.toFixed(1)}% 相對位置 (50%為中線)。`, color: "#90caf9" });
      }
    }
  }

  // 3. RSI
  const rsi = latest(ind.rsi);
  if (!isNaN(rsi)) {
    if (rsi > 70) {
      signals.push({ title: "🔥 RSI：超買區 (>70)", desc: `數值達 ${rsi.toFixed(1)}，市場情緒過熱，建議分批獲利了結或留意回檔。`, color: "#ff5252" });
      score -= 1;
    } else if (rsi < 30) {
      signals.push({ title: "🔰 RSI：超賣區 (<30)", desc: `數值達 ${rsi.toFixed(1)}，市場情緒低迷，可能醞釀跌深反彈。`, color: "#00e676" });
      score += 1;
    } else {
      const dir = rsi > 50 ? "偏多" : "偏空";
      signals.push({ title: "⚖️ RSI：中性區間", desc: `數值為 ${rsi.toFixed(1)}，目前力道${dir}，未達極端值。`, color: "#b0bec5" });
    }
  }

  // 4. KD
  const k = latest(ind.k);
  const d = latest(ind.d);
  const pk = prev(ind.k);
  const pd = prev(ind.d);
  if (!isNaN(k) && !isNaN(d)) {
    if (k > d && pk <= pd) {
      signals.push({ title: "🔥 KD 訊號：黃金交叉", desc: "K線由下往上穿過D線，短線買點浮現。", color: "#ff4081" });
      score += 1;
    } else if (k < d && pk >= pd) {
      signals.push({ title: "💀 KD 訊號：死亡交叉", desc: "K線由上往下穿過D線，短線賣點浮現，請留意風險。", color: "#9e9e9e" });
      score -= 1;
    } else if (k > d) {
      signals.push({ title: "KD 訊號：多方優勢", desc: `目前 K(${k.toFixed(1)}) > D(${d.toFixed(1)})，KD指標呈現多頭向上趨勢。`, color: "#4fc3f7" });
      score += 0.5;
    } else {
      signals.push({ title: "KD 訊號：空方弱勢", desc: `目前 K(${k.toFixed(1)}) < D(${d.toFixed(1)})，KD指標呈現空頭向下趨勢。`, color: "#ffab40" });
      score -= 0.5;
    }
  }

  // 5. MACD
  const macd = latest(ind.macd);
  const sig = latest(ind.signal);
  const pMacd = prev(ind.macd);
  const pSig = prev(ind.signal);
  if (!isNaN(macd) && !isNaN(sig)) {
    if (macd > sig && pMacd <= pSig) {
      signals.push({ title: "🚀 MACD：多頭交叉 (剛突破)", desc: "MACD 柱狀由負轉正，多方啟動，趨勢轉強。", color: "#64ffda" });
      score += 1;
    } else if (macd < sig && pMacd >= pSig) {
      signals.push({ title: "MACD：空頭交叉 (剛跌破)", desc: "MACD 柱狀由正轉負，空方啟動，趨勢轉弱。", color: "#ff80ab" });
      score -= 1;
    } else if (macd > sig) {
      signals.push({ title: "🟩 MACD：多頭發散", desc: "柱狀圖為正值，目前MACD維持多頭格局。", color: "#64ffda" });
      score += 0.5;
    } else {
      signals.push({ title: "🟥 MACD：空頭發散", desc: "柱狀圖為負值，目前MACD維持空頭收斂或發散格局。", color: "#ff80ab" });
      score -= 0.5;
    }
  }

  // 成交量爆量 - OBV差值可提供量能方向參考
  // (量能資訊已納入OBV指標計算)

  // 7. OBV
  const obvVal = latest(ind.obv);
  const obvMa = latest(ind.obvMa10);
  if (!isNaN(obvVal) && !isNaN(obvMa)) {
    if (obvVal > obvMa) {
      signals.push({ title: "📊 OBV：量能指標向上", desc: "OBV 處於均線上方，量價配合良好，資金積極介入。", color: "#4caf50" });
      score += 0.5;
    } else {
      signals.push({ title: "📊 OBV：量能指標疲弱", desc: "OBV 處於均線下方，動能不足或資金有撤退跡象。", color: "#ff9800" });
      score -= 0.5;
    }
  }

  // 8. Williams %R
  const wr = latest(ind.williamsR);
  if (!isNaN(wr)) {
    if (wr < -80) {
      signals.push({ title: "📉 威廉指標：超賣區", desc: `數值為 ${wr.toFixed(1)}，股價處於相對低位，隨時可能反彈。`, color: "#00e676" });
      score += 1;
    } else if (wr > -20) {
      signals.push({ title: "📈 威廉指標：超買區", desc: `數值為 ${wr.toFixed(1)}，股價處於相對高位，注意高檔震盪或回檔。`, color: "#ff5252" });
      score -= 1;
    } else {
      signals.push({ title: "⚖️ 威廉指標：中性", desc: `數值為 ${wr.toFixed(1)}，目前無過熱或過冷現象。`, color: "#b0bec5" });
    }
  }

  // 9. ATR
  const atr = latest(ind.atr);
  const atrSlice = ind.atr.slice(Math.max(0, n - 20), n);
  const avgAtr = atrSlice.filter((v) => !isNaN(v)).reduce((a, b) => a + b, 0) / (atrSlice.filter((v) => !isNaN(v)).length || 1);
  if (!isNaN(atr) && avgAtr > 0) {
    const stopLoss = closeApprox - 2 * atr;
    if (atr > avgAtr * 2.0) {
      signals.push({ title: "💀 ATR：極端波動風險", desc: `ATR 值為 ${atr.toFixed(2)}，波動異常擴大。建議停損設於 ${stopLoss.toFixed(2)} (2倍ATR)。`, color: "#ff5252" });
      score -= 1;
    } else if (atr > avgAtr * 1.5) {
      signals.push({ title: "⚠️ ATR：波動性增加", desc: `ATR 值為 ${atr.toFixed(2)}，行情可能即將發動。建議停損設於 ${stopLoss.toFixed(2)}。`, color: "#ffff00" });
    } else if (atr < avgAtr * 0.7) {
      signals.push({ title: "💤 ATR：波動性收斂", desc: `ATR 值為 ${atr.toFixed(2)}，進入盤整期。建議停損設於 ${stopLoss.toFixed(2)}。`, color: "#b0bec5" });
    } else {
      signals.push({ title: "📊 ATR：波動性穩定", desc: `目前 ATR 為 ${atr.toFixed(2)}，處於常態範圍。建議停損(2*ATR)參考價：${stopLoss.toFixed(2)}。`, color: "#00897b" });
    }
  }

  return { signals, score };
}

// ─── 地雷風險偵測 ─────────────────────────────────────────────────────────────

export function checkLandmineRisks(ind: Indicators, info: StockInfoFull, n: number): string[] {
  const risks: string[] = [];

  const ema50 = ind.ema50[n];
  const ema200 = ind.ema200[n];
  if (!isNaN(ema50) && !isNaN(ema200) && ema50 < ema200 * 0.95) {
    risks.push("📉 長線趨勢偏弱 (50MA 低於 200MA 5%)");
  }

  const rsi = ind.rsi[n];
  if (!isNaN(rsi) && rsi < 30) {
    risks.push(`😱 RSI 極度低迷 (${rsi.toFixed(1)})，需注意流動性風險`);
  }

  const closePrice = ind.close[n];
  const bbL = ind.bbLower[n];
  const bw = ind.bbBandWidth[n];
  const prevBw = ind.bbBandWidth[n - 1] ?? bw;
  if (!isNaN(bbL) && !isNaN(closePrice) && closePrice < bbL) {
    const isExpanding = !isNaN(bw) && !isNaN(prevBw) && bw > prevBw * 1.05;
    risks.push(`🧨 股價跌破布林下軌 (${closePrice.toFixed(1)} < ${bbL.toFixed(1)})${isExpanding ? "，且通道擴張呈弱勢加速" : ""}`);
  }

  const atr = ind.atr[n];
  const atrSlice = ind.atr.slice(Math.max(0, n - 20), n);
  const avgAtr = atrSlice.filter((v) => !isNaN(v)).reduce((a, b) => a + b, 0) / (atrSlice.filter((v) => !isNaN(v)).length || 1);
  if (!isNaN(atr) && avgAtr > 0 && atr > avgAtr * 2.5) {
    risks.push(`🌪️ 波動率異常飆高 (ATR: ${atr.toFixed(2)})，風險增加`);
  }

  // ── 財務基本面地雷 ────────────────────────────────────────────────
  // 虧損
  if (info.net_income !== undefined && info.net_income !== null && info.net_income < 0) {
    risks.push("💸 公司目前財報呈現淨損（虧損中）");
  }
  // EPS 為負
  if (info.eps !== undefined && info.eps !== null && info.eps < 0) {
    risks.push(`📛 EPS 為負 (${info.eps.toFixed(2)})，每股虧損`);
  }
  // ROE 為負（淨值縮水）
  if (info.roe !== undefined && info.roe !== null && info.roe < 0) {
    risks.push(`🔴 ROE 為負 (${(info.roe * 100).toFixed(1)}%)，股東權益遭侵蝕`);
  }
  // 毛利率偏低
  if (info.gross_margins !== undefined && info.gross_margins !== null && info.gross_margins < 0.10) {
    risks.push(`📉 毛利率極低 (${(info.gross_margins * 100).toFixed(1)}%)，獲利能力堪憂`);
  }
  // 淨利率為負
  if (info.profit_margins !== undefined && info.profit_margins !== null && info.profit_margins < 0) {
    risks.push(`🩸 淨利率為負 (${(info.profit_margins * 100).toFixed(1)}%)，本業虧損`);
  }
  // 負自由現金流
  if (info.free_cashflow !== undefined && info.free_cashflow !== null && info.free_cashflow < 0) {
    risks.push(`💧 自由現金流為負 (${(info.free_cashflow / 1e8).toFixed(2)}億)，燒錢警示`);
  }
  // 高負債
  if (info.debt_to_equity !== undefined && info.debt_to_equity !== null && info.debt_to_equity > 200) {
    risks.push(`🏗️ 負債比率偏高 (${info.debt_to_equity.toFixed(1)}%)，財務槓桿過大`);
  }
  // 流動比率過低
  if (info.current_ratio !== undefined && info.current_ratio !== null && info.current_ratio < 1) {
    risks.push(`💦 流動比率偏低 (${info.current_ratio.toFixed(2)})，短期償債壓力大`);
  }
  // 盈餘衰退
  if (info.earnings_growth !== undefined && info.earnings_growth !== null && info.earnings_growth < -0.20) {
    risks.push(`📊 盈餘大幅衰退 (YoY: ${(info.earnings_growth * 100).toFixed(1)}%)`);
  }
  // 營收衰退
  if (info.revenue_growth !== undefined && info.revenue_growth !== null && info.revenue_growth < -0.10) {
    risks.push(`📊 營收明顯衰退 (YoY: ${(info.revenue_growth * 100).toFixed(1)}%)`);
  }

  return risks;
}


// ─── 基本面評分 ───────────────────────────────────────────────────────────────

export interface FundamentalScoreResult {
  score: number;
  passed: [string, string][];
  failed: [string, string][];
  na: string[];
}

export function computeFundamentalScore(info: StockInfoFull): FundamentalScoreResult {
  const passed: [string, string][] = [];
  const failed: [string, string][] = [];
  const na: string[] = [];
  let score = 0;

  const def = (v: number | undefined | null) => v !== undefined && v !== null && !isNaN(v);

  // 1. ROE
  if (def(info.roe)) {
    const roe = info.roe!;
    if (roe >= 0.15) { passed.push(["ROE", `${(roe * 100).toFixed(1)}% ✓（優秀≥15%）`]); score += 2; }
    else if (roe >= 0.10) { passed.push(["ROE", `${(roe * 100).toFixed(1)}% ✓（良好≥10%）`]); score += 1; }
    else if (roe >= 0) { failed.push(["ROE", `${(roe * 100).toFixed(1)}% ✗（偏低<10%）`]); }
    else { failed.push(["ROE", `${(roe * 100).toFixed(1)}% ✗（負值，淨值縮水）`]); score -= 1; }
  } else na.push("ROE");

  // 2. 毛利率
  if (def(info.gross_margins)) {
    const gm = info.gross_margins!;
    if (gm >= 0.30) { passed.push(["毛利率", `${(gm * 100).toFixed(1)}% ✓（優秀≥30%）`]); score += 1; }
    else if (gm >= 0.20) { passed.push(["毛利率", `${(gm * 100).toFixed(1)}% ✓（合格≥20%）`]); }
    else { failed.push(["毛利率", `${(gm * 100).toFixed(1)}% ✗（偏低<20%）`]); score -= 1; }
  } else na.push("毛利率");

  // 3. 淨利率
  if (def(info.profit_margins)) {
    const nm = info.profit_margins!;
    if (nm >= 0.10) { passed.push(["淨利率", `${(nm * 100).toFixed(1)}% ✓（優秀≥10%）`]); score += 1; }
    else if (nm >= 0.05) { passed.push(["淨利率", `${(nm * 100).toFixed(1)}% ✓（合格≥5%）`]); }
    else if (nm >= 0) { failed.push(["淨利率", `${(nm * 100).toFixed(1)}% ✗（偏低<5%）`]); }
    else { failed.push(["淨利率", `${(nm * 100).toFixed(1)}% ✗（虧損）`]); score -= 2; }
  } else na.push("淨利率");

  // 4. EPS
  if (def(info.eps)) {
    const eps = info.eps!;
    if (eps > 0) { passed.push(["EPS", `${eps.toFixed(2)} ✓（獲利）`]); score += 1; }
    else { failed.push(["EPS", `${eps.toFixed(2)} ✗（虧損）`]); score -= 2; }
  } else na.push("EPS");

  // 5. 營收YoY
  const revG = info.revenue_growth;
  if (def(revG)) {
    const rg = revG!;
    if (rg >= 0.10) { passed.push(["營收YoY", `${(rg * 100).toFixed(1)}% ✓（成長≥10%）`]); score += 1; }
    else if (rg >= 0) { passed.push(["營收YoY", `${(rg * 100).toFixed(1)}% ✓（微成長）`]); }
    else { failed.push(["營收YoY", `${(rg * 100).toFixed(1)}% ✗（衰退）`]); score -= 1; }
  } else na.push("營收YoY");

  // 6. 盈餘YoY
  const eg = info.earnings_growth;
  if (def(eg)) {
    const earn = eg!;
    if (earn > 0.10) { passed.push(["盈餘YoY", `${(earn * 100).toFixed(1)}% ✓（成長≥10%）`]); score += 1; }
    else if (earn > 0) { passed.push(["盈餘YoY", `${(earn * 100).toFixed(1)}% ✓（微成長）`]); }
    else { failed.push(["盈餘YoY", `${(earn * 100).toFixed(1)}% ✗（衰退）`]); }
  } else na.push("盈餘YoY");

  // 7. PE
  const pe = info.tw_pe ?? info.pe ?? info.forward_pe;
  if (def(pe) && pe! > 0) {
    const p = pe!;
    if (p > 5 && p <= 20) { passed.push(["PE", `${p.toFixed(1)} ✓（合理 5~20）`]); score += 1; }
    else if (p > 20 && p <= 40) { passed.push(["PE", `${p.toFixed(1)} ✓（偏高但可接受 20~40）`]); }
    else { failed.push(["PE", `${p.toFixed(1)} ✗（過高>40 或異常）`]); }
  } else na.push("PE");

  // 8. PB
  const pb = info.tw_pb ?? info.pb;
  if (def(pb)) {
    const p = pb!;
    if (p > 0 && p <= 2) { passed.push(["PB", `${p.toFixed(2)} ✓（偏低≤2）`]); score += 1; }
    else if (p > 2 && p <= 5) { passed.push(["PB", `${p.toFixed(2)} ✓（合理 2~5）`]); }
    else if (p > 5) { failed.push(["PB", `${p.toFixed(2)} ✗（偏高>5）`]); }
    else { failed.push(["PB", `${p.toFixed(2)} ✗（淨值為負）`]); score -= 1; }
  } else na.push("PB");

  // 9. 殖利率
  const dy = info.tw_yield ?? info.dividend_yield;
  if (def(dy) && dy! > 0) {
    const y = dy!;
    if (y >= 0.04) { passed.push(["殖利率", `${(y * 100).toFixed(1)}% ✓（高息≥4%）`]); score += 1; }
    else if (y >= 0.02) { passed.push(["殖利率", `${(y * 100).toFixed(1)}% ✓（配息≥2%）`]); }
    else { passed.push(["殖利率", `${(y * 100).toFixed(1)}%（配息偏低）`]); }
  } else na.push("殖利率");

  // 10. 流動比率
  if (def(info.current_ratio)) {
    const cr = info.current_ratio!;
    if (cr >= 2.0) { passed.push(["流動比率", `${cr.toFixed(2)} ✓（充裕≥2）`]); score += 1; }
    else if (cr >= 1.5) { passed.push(["流動比率", `${cr.toFixed(2)} ✓（良好≥1.5）`]); score += 1; }
    else if (cr >= 1.0) { passed.push(["流動比率", `${cr.toFixed(2)} ✓（尚可≥1）`]); }
    else { failed.push(["流動比率", `${cr.toFixed(2)} ✗（偏低<1，短債風險）`]); score -= 1; }
  } else na.push("流動比率");

  // 11. 負債/權益比
  if (def(info.debt_to_equity)) {
    const de = info.debt_to_equity!;
    if (de <= 50) { passed.push(["負債/權益比", `${de.toFixed(0)}% ✓（低負債≤50%）`]); score += 1; }
    else if (de <= 150) { passed.push(["負債/權益比", `${de.toFixed(0)}% ✓（合理≤150%）`]); }
    else if (de <= 300) { failed.push(["負債/權益比", `${de.toFixed(0)}% ✗（偏高150~300%）`]); }
    else { failed.push(["負債/權益比", `${de.toFixed(0)}% ✗（高槓桿>300%）`]); score -= 1; }
  } else na.push("負債/權益比");

  // 12. 自由現金流
  if (def(info.free_cashflow)) {
    const fcf = info.free_cashflow!;
    if (fcf > 0) { passed.push(["自由現金流", `正 ✓（${(fcf / 1e8).toFixed(2)}億）`]); score += 2; }
    else { failed.push(["自由現金流", `負 ✗（${(fcf / 1e8).toFixed(2)}億，燒錢中）`]); score -= 1; }
  } else na.push("自由現金流");

  return { score, passed, failed, na };
}

// ─── 技術掃描評分（用於選股器）───────────────────────────────────────────────

export function calcTechScanScore(ind: Indicators, n: number): { score: number; reasons: string[]; risks: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const risks: string[] = [];

  const latest = (arr: number[]) => arr[n];
  const prev = (arr: number[]) => arr[n - 1] ?? arr[n];

  // EMA50 vs EMA200
  const ema50 = latest(ind.ema50), ema200 = latest(ind.ema200);
  if (!isNaN(ema200)) {
    if (ema50 > ema200) { score += 1; reasons.push("長線多頭"); }
    else { score -= 1; risks.push("空頭排列"); }
  }

  // 布林通道 (根據 ThinkMarkets 策略增強)
  const bw = latest(ind.bbBandWidth);
  const pb = latest(ind.bbPercentB);
  const closePrice = latest(ind.close);
  const bbU = latest(ind.bbUpper);
  const bbL = latest(ind.bbLower);

  if (!isNaN(pb) && !isNaN(bw)) {
    const bwSlice = ind.bbBandWidth.slice(Math.max(0, n - 60), n).filter(v => !isNaN(v));
    const minBw = bwSlice.length ? Math.min(...bwSlice) : bw;
    
    // 計算 20 日平均頻寬
    const bwMaSlice = ind.bbBandWidth.slice(Math.max(0, n - 20), n + 1).filter(v => !isNaN(v));
    const bwMa20 = bwMaSlice.length ? bwMaSlice.reduce((sum, v) => sum + v, 0) / bwMaSlice.length : bw;

    const isSqueezed = bwSlice.length >= 15 && bw <= minBw * 1.15; // 頻寬接近 60 日低點 (15% 內)
    const isExpanding = bw > bwMa20 * 1.1; // 頻寬大於 20MA 平均值 10% 以上

    if (pb > 1.0) {
      if (isExpanding) {
        score += 1.5;
        reasons.push(`布林突破：股價強勢衝出上軌 (${closePrice.toFixed(1)} > ${bbU.toFixed(1)})，伴隨通道擴張呈多頭爆發`);
      } else {
        score -= 1.0;
        risks.push(`布林超買：股價高於上軌 (${closePrice.toFixed(1)} > ${bbU.toFixed(1)})，但通道未擴張，防範拉回`);
      }
    } else if (pb < 0.0) {
      if (isExpanding) {
        score -= 1.5;
        risks.push(`布林破位：股價弱勢跌破下軌 (${closePrice.toFixed(1)} < ${bbL.toFixed(1)})，伴隨通道擴張呈空頭爆發`);
      } else {
        score += 1.0;
        reasons.push(`布林超賣：股價低於下軌 (${closePrice.toFixed(1)} < ${bbL.toFixed(1)})，但通道未擴張，注意反彈`);
      }
    } else {
      if (pb > 0.9) {
        score -= 0.5;
        risks.push("布林通道：股價已接近上軌壓力區");
      } else if (pb < 0.1) {
        score += 0.5;
        reasons.push("布林通道：股價已接近下軌支撐區");
      } else if (isSqueezed) {
        reasons.push("布林頻寬：通道極度擠壓，暗示即將發生大方向波動");
      }
    }
  }

  // RSI
  const rsi = latest(ind.rsi);
  if (!isNaN(rsi)) {
    if (rsi > 70) { score -= 1; risks.push(`RSI超買(${rsi.toFixed(0)})`); }
    else if (rsi < 30) { score += 1; reasons.push(`RSI超賣(${rsi.toFixed(0)})`); }
  }

  // KD
  const k = latest(ind.k), d = latest(ind.d), pk = prev(ind.k), pd = prev(ind.d);
  if (!isNaN(k)) {
    if (k > d && pk <= pd) { score += 1; reasons.push("KD黃金交叉"); }
    else if (k < d && pk >= pd) { score -= 1; risks.push("KD死亡交叉"); }
    else if (k > d) { score += 0.5; reasons.push("KD多方"); }
    else { score -= 0.5; risks.push("KD空方"); }
  }

  // MACD
  const macd = latest(ind.macd), sig = latest(ind.signal), pm = prev(ind.macd), ps = prev(ind.signal);
  if (!isNaN(macd)) {
    if (macd > sig && pm <= ps) { score += 1; reasons.push("MACD多頭交叉"); }
    else if (macd < sig && pm >= ps) { score -= 1; risks.push("MACD空頭交叉"); }
    else if (macd > sig) { score += 0.5; reasons.push("MACD多頭"); }
    else { score -= 0.5; risks.push("MACD空頭"); }
  }

  // OBV
  const obv = latest(ind.obv), obvMa = latest(ind.obvMa10);
  if (!isNaN(obv) && !isNaN(obvMa)) {
    if (obv > obvMa) { score += 0.5; reasons.push("量能向上"); }
    else { score -= 0.5; risks.push("量能疲弱"); }
  }

  // Williams %R
  const wr = latest(ind.williamsR);
  if (!isNaN(wr)) {
    if (wr < -80) { score += 1; reasons.push(`威廉超賣(${wr.toFixed(0)})`); }
    else if (wr > -20) { score -= 1; risks.push(`威廉超買(${wr.toFixed(0)})`); }
  }

  // ATR
  const atr = latest(ind.atr);
  const slice = ind.atr.slice(Math.max(0, n - 20), n).filter((v) => !isNaN(v));
  const avgAtr = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
  if (!isNaN(atr) && avgAtr > 0 && atr > avgAtr * 2) { score -= 1; risks.push("波動劇烈"); }

  return { score, reasons, risks };
}

export function getTechRating(score: number): string {
  if (score >= 3) return "強力推薦";
  if (score >= 1.5) return "多方優勢";
  if (score >= 0.5) return "偏多盤整";
  if (score <= -3) return "極度危險";
  if (score <= -1.5) return "空方優勢";
  if (score <= -0.5) return "偏空盤整";
  return "中性觀望";
}

export function getFsGrade(score: number): string {
  if (score >= 10) return "S 頂級";
  if (score >= 7) return "A 優質";
  if (score >= 4) return "B 良好";
  if (score >= 1) return "C 普通";
  if (score >= -2) return "D 偏弱";
  return "F 危險";
}
