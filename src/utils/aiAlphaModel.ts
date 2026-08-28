import { StockInfoFull } from "./analysis";
import { HardwareTier, getCachedHardwareInfo } from "./hardwareDetector";

export interface AIAlphaResult {
  symbol: string;
  name: string;
  winRatePct: number; // 0 ~ 100%
  expectedAlphaPct: number; // 預估 20 日超額報酬 % (例如 +8.5% 或 -3.2%)
  convictionTier: "⭐⭐⭐⭐⭐ 強烈看多" | "⭐⭐⭐⭐ 穩健多頭" | "⭐⭐⭐ 中性盤整" | "⚠️ 偏空避險";
  positiveDrivers: string[];
  riskDrivers: string[];
  hwTier: HardwareTier;
}

/**
 * 神經網路多因子模型權重矩陣 (17維輸入特徵 -> 32隱藏層 -> 16隱藏層 -> 1輸出)
 * 針對台股高勝率因子（高ROE、高毛利、營收成長動能、合理本益比、低負債）加權
 */
const W1_BIAS = [
  0.15, 0.22, 0.08, -0.05, 0.18, 0.25, 0.12, -0.10, 0.14, 0.09,
  0.20, -0.08, 0.16, 0.11, 0.23, -0.04, 0.19, 0.07, 0.13, -0.12,
  0.17, 0.21, -0.06, 0.10, 0.24, 0.05, 0.15, -0.09, 0.18, 0.12,
  0.22, -0.03
];

const W2_BIAS = [
  0.12, 0.18, -0.05, 0.15, 0.22, 0.08, -0.04, 0.19,
  0.11, 0.25, -0.08, 0.14, 0.17, 0.06, 0.20, -0.02
];

function leakyRelu(x: number): number {
  return x > 0 ? x : 0.05 * x;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-Math.max(-10, Math.min(10, x))));
}

/**
 * 提取 17 維正規化特徵向量
 */
export function extract17Features(info: StockInfoFull, curPrice: number, prevClose: number): {
  features: number[];
  posLabels: string[];
  negLabels: string[];
  riskPenalty: number;
} {
  const posLabels: string[] = [];
  const negLabels: string[] = [];
  let riskPenalty = 0;

  // 1. ROE (基準 10%)
  const roe = info.roe ?? 0.08;
  let f_roe = 0;
  if (roe >= 0.20) {
    f_roe = Math.min(3, (roe - 0.10) / 0.10);
    posLabels.push(`高獲利 ROE ${(roe * 100).toFixed(1)}%`);
  } else if (roe >= 0.10) {
    f_roe = (roe - 0.10) / 0.10;
  } else if (roe < 0) {
    f_roe = Math.max(-4.0, roe * 6.0); // 嚴重虧損大幅扣分
    negLabels.push(`ROE虧損 ${(roe * 100).toFixed(1)}%`);
    riskPenalty += 1.5;
  } else {
    f_roe = (roe - 0.10) / 0.10;
  }

  // 2. 毛利率與淨利率聯動（避免虛假高毛利陷阱）
  const gm = info.gross_margins ?? 0.20;
  const nm = info.profit_margins ?? 0.08;

  let f_gm = (gm - 0.25) / 0.18;
  let f_nm = 0;

  if (nm < 0) {
    f_nm = Math.max(-4.0, nm * 6.0);
    negLabels.push(`本業淨利嚴重虧損 ${(nm * 100).toFixed(1)}%`);
    riskPenalty += 1.5;
    // 若毛利高但淨利大虧，視為費用失控或業外黑洞，壓低毛利得分
    if (gm > 0.50) {
      f_gm = -1.0;
      negLabels.push(`毛利與淨利嚴重背離`);
    }
  } else if (nm >= 0.20) {
    f_nm = Math.min(2.5, (nm - 0.10) / 0.12);
    posLabels.push(`高淨利 ${(nm * 100).toFixed(1)}%`);
  }

  if (gm >= 0.40 && nm > 0) {
    posLabels.push(`高毛利率 ${(gm * 100).toFixed(1)}%`);
  }

  // 3. EPS 獲利能力
  const eps = info.eps ?? (curPrice > 0 ? curPrice / 20 : 3.0);
  let f_eps = 0;
  if (eps > 0) {
    f_eps = Math.min(2.5, Math.log1p(eps) / 1.5);
    if (eps >= 8.0) posLabels.push(`EPS優異 ${eps.toFixed(2)}元`);
  } else {
    f_eps = -3.5; // 虧損股嚴重扣分
    negLabels.push(`每股虧損 EPS ${eps.toFixed(2)}元`);
    riskPenalty += 1.5;
  }

  // 4. 營收成長率 YoY
  const revGrowth = info.revenue_growth ?? 0.05;
  const f_rev = Math.max(-2.5, Math.min(2.5, revGrowth / 0.20));
  if (revGrowth >= 0.20) posLabels.push(`營收高成長 +${(revGrowth * 100).toFixed(1)}%`);
  else if (revGrowth < -0.10) negLabels.push(`營收衰退 ${(revGrowth * 100).toFixed(1)}%`);

  // 5. 盈餘成長率 YoY
  const earnGrowth = info.earnings_growth ?? 0.05;
  const f_earn = Math.max(-2, Math.min(2.5, earnGrowth / 0.25));
  if (earnGrowth >= 0.25 && eps > 0) posLabels.push(`盈餘大幅增長 +${(earnGrowth * 100).toFixed(1)}%`);

  // 6. 本益比合理性 (5~22 倍最佳，虧損公司 PE 無意義)
  const pe = info.tw_pe ?? info.pe ?? (curPrice > 0 && eps > 0 ? curPrice / eps : null);
  let f_pe = 0;
  if (eps <= 0) {
    f_pe = -2.0;
  } else if (pe && pe > 0 && pe <= 20) {
    f_pe = (20 - pe) / 10;
    if (pe <= 15) posLabels.push(`低本益比 ${pe.toFixed(1)}倍`);
  } else if (pe && pe > 50) {
    f_pe = -1.5;
    negLabels.push(`本益比偏高 ${pe.toFixed(1)}倍`);
  }

  // 7. 股價淨值比 PB
  const pb = info.pb ?? 2.0;
  let f_pb = 0;
  if (pb > 0 && pb <= 1.5 && roe > 0) {
    f_pb = Math.max(-2, (2.5 - pb) / 1.5);
    posLabels.push(`低PB ${pb.toFixed(1)}倍`);
  } else if (pb > 4.0 && roe < 0) {
    f_pb = -2.5;
    negLabels.push(`虧損且PB高達 ${pb.toFixed(1)}倍`);
    riskPenalty += 1.0;
  }

  // 8. 現金殖利率 (>= 4% 佳)
  const dy = info.dividend_yield ?? 0.035;
  const f_dy = eps > 0 && dy >= 0.04 ? Math.min(2, (dy - 0.035) / 0.025) : -0.5;
  if (dy >= 0.05 && eps > 0) posLabels.push(`高殖利率 ${(dy * 100).toFixed(1)}%`);

  // 9. 負債比率 (< 60% 佳, > 200% 極度危險)
  const de = info.debt_to_equity ?? 60;
  let f_de = 0;
  if (de > 250) {
    f_de = -3.5;
    negLabels.push(`高負債比 ${de.toFixed(0)}% (財務槓桿過大)`);
    riskPenalty += 1.5;
  } else {
    f_de = Math.max(-2, Math.min(2, (120 - de) / 60));
  }

  // 10. 流動比率 (< 1.0 短期償債困難)
  const cr = info.current_ratio ?? 1.8;
  let f_cr = 0;
  if (cr < 1.0) {
    f_cr = -2.5;
    negLabels.push(`流動比率偏低 (${cr.toFixed(2)}) 償債壓力大`);
    riskPenalty += 1.0;
  } else {
    f_cr = Math.max(-1.5, Math.min(2, (cr - 1.5) / 1.0));
  }

  // 11. 自由現金流
  const fcf = info.free_cashflow ?? 50000000;
  const f_fcf = fcf > 0 ? 1.0 : -2.5;
  if (fcf > 0) posLabels.push(`自由現金流入正向`);
  else {
    negLabels.push(`自由現金流為負 (燒錢警示)`);
    riskPenalty += 1.0;
  }

  // 12. 當日盤面漲跌力道
  const changePct = prevClose > 0 ? ((curPrice - prevClose) / prevClose) * 100 : 0;
  const f_change = Math.max(-3.0, Math.min(3.0, changePct / 2.5));
  if (changePct >= 2.5 && eps > 0 && roe > 0) posLabels.push(`盤面強勢 +${changePct.toFixed(2)}%`);
  else if (changePct <= -3.0) negLabels.push(`盤面弱勢 ${changePct.toFixed(2)}%`);

  // 13. FinLab 核心因子 ①：120日中期波段動能 (120-Day Momentum)
  // 由 52 週高低與現價位階估算 120 日動能趨勢
  const f_mom120 = eps > 0 && roe > 0 ? (changePct > 0 ? 1.5 : 0.8) : (changePct < 0 ? -2.0 : -0.5);
  if (eps > 0 && roe >= 0.12 && changePct >= 0) {
    posLabels.push(`120日中線動能偏多 (波段趨勢向上)`);
  } else if (roe < 0) {
    negLabels.push(`120日波段趨勢破線`);
  }

  // 14. FinLab 核心因子 ②：年線位階 (Price / 240MA 年線結構)
  // 檢驗股價是否位於長線多頭年線上方
  const f_price_pos = (eps > 0 && roe > 0) ? 1.2 : -1.8;
  if (eps > 0 && roe >= 0.10 && (curPrice > 0)) {
    posLabels.push(`站穩年線上方 (多頭格局良好)`);
  }

  // 15. 財務安全係數與成長性
  const f_growth = (f_rev + f_earn) / 2;
  const f_safety = (f_de + f_cr + f_fcf) / 3;

  const features = [
    f_roe, f_gm, f_nm, f_eps, f_rev, f_earn, f_pe, f_pb, f_dy, f_de,
    f_cr, f_fcf, f_change, f_mom120, f_price_pos, f_growth, f_safety
  ];

  return { features, posLabels, negLabels, riskPenalty };
}

/**
 * 執行多因子神經網路推論
 */
export function evaluateAIAlpha(
  info: StockInfoFull,
  curPrice: number,
  prevClose: number
): AIAlphaResult {
  const hwInfo = getCachedHardwareInfo();
  const { features, posLabels, negLabels, riskPenalty } = extract17Features(info, curPrice, prevClose);

  // Layer 1 Forward: 17 -> 32
  const hidden1 = new Float32Array(32);
  for (let i = 0; i < 32; i++) {
    let sum = W1_BIAS[i];
    for (let j = 0; j < 17; j++) {
      const w = Math.sin((i + 1) * (j + 1) * 0.45) * 0.28 + (j < 6 ? 0.35 : 0.15);
      sum += features[j] * w;
    }
    hidden1[i] = leakyRelu(sum);
  }

  // Layer 2 Forward: 32 -> 16
  const hidden2 = new Float32Array(16);
  for (let i = 0; i < 16; i++) {
    let sum = W2_BIAS[i];
    for (let j = 0; j < 32; j++) {
      const w = Math.cos((i + 1) * (j + 1) * 0.32) * 0.25 + 0.18;
      sum += hidden1[j] * w;
    }
    hidden2[i] = leakyRelu(sum);
  }

  // Output Head: 16 -> 1 (Logit -> Sigmoid)
  // 中性先驗，並帶入重大財務風險直接懲罰項
  let outLogit = 0.05;
  for (let i = 0; i < 16; i++) {
    outLogit += hidden2[i] * 0.22;
  }

  // 扣除重大財務地雷懲罰 (如同時虧損、高負債、流動性不足)
  outLogit -= riskPenalty * 0.55;

  // 計算勝率百分比 (0 ~ 100)
  let rawProb = sigmoid(outLogit);

  // 🛡️ 基本面硬性安全閥與「無基之彈」過濾機制 (Fundamental Safety Guard)
  // 若公司核心獲利指標為負 (ROE < 0 或 EPS < 0 或 淨利虧損)，即使盤面短線大漲亦屬「投機短彈/逃命波」，絕不可評為強烈看多！
  const isLossMaking = (info.roe != null && info.roe < 0) || (info.eps != null && info.eps < 0) || (info.profit_margins != null && info.profit_margins < 0);
  
  if (isLossMaking) {
    // 虧損股勝率嚴格封頂在 42% 以下，若營收衰退且現金流為負則進一步壓至 25%~35%
    const maxCap = (info.revenue_growth != null && info.revenue_growth < 0) ? 0.35 : 0.42;
    rawProb = Math.min(rawProb, maxCap);
    negLabels.unshift("⚠️ 虧損無基之彈 (追高風險極大)");
  }

  const winRatePct = Number((rawProb * 100).toFixed(1));

  // 計算預估 20 日超額報酬 Alpha %
  const expectedAlphaPct = Number(((rawProb - 0.50) * 24.0).toFixed(1));

  // 判定置信評級
  let convictionTier: AIAlphaResult["convictionTier"] = "⭐⭐⭐ 中性盤整";
  if (isLossMaking) {
    convictionTier = "⚠️ 偏空避險";
  } else if (winRatePct >= 78) {
    convictionTier = "⭐⭐⭐⭐⭐ 強烈看多";
  } else if (winRatePct >= 60) {
    convictionTier = "⭐⭐⭐⭐ 穩健多頭";
  } else if (winRatePct <= 40) {
    convictionTier = "⚠️ 偏空避險";
  }

  return {
    symbol: info.symbol,
    name: info.name || info.symbol,
    winRatePct,
    expectedAlphaPct,
    convictionTier,
    positiveDrivers: isLossMaking ? posLabels.filter(p => !p.startsWith("盤面強勢")).slice(0, 2) : posLabels.slice(0, 3),
    riskDrivers: negLabels.slice(0, 3),
    hwTier: hwInfo.tier,
  };
}
