// ─────────────────────────────────────────────────────────────────────────────
// 技術指標計算 (完全移植自 Python 版 stock.py)
// ─────────────────────────────────────────────────────────────────────────────

export interface OhlcvData {
  timestamp: number[];
  open: number[];
  high: number[];
  low: number[];
  close: number[];
  volume: number[];
}

export interface Indicators {
  close: number[];
  sma5: number[];
  sma10: number[];
  sma20: number[];
  ema50: number[];
  ema200: number[];
  volMa20: number[];
  bbUpper: number[];
  bbMiddle: number[];
  bbLower: number[];
  bbPercentB: number[];
  bbBandWidth: number[];
  rsi: number[];
  k: number[];
  d: number[];
  macd: number[];
  signal: number[];
  hist: number[];
  obv: number[];
  obvMa10: number[];
  williamsR: number[];
  atr: number[];
}

// ─── 基礎計算函數 ─────────────────────────────────────────────────────────────

export function calcSMA(data: number[], period: number): number[] {
  const result = new Array(data.length).fill(NaN);
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j];
    result[i] = sum / period;
  }
  return result;
}

export function calcEMA(data: number[], period: number): number[] {
  const result = new Array(data.length).fill(NaN);
  const k = 2 / (period + 1);
  let first = true;
  for (let i = 0; i < data.length; i++) {
    if (isNaN(data[i])) continue;
    if (first) {
      result[i] = data[i];
      first = false;
    } else {
      const prev = result.slice(0, i).reverse().find((v) => !isNaN(v));
      result[i] = data[i] * k + (prev ?? data[i]) * (1 - k);
    }
  }
  return result;
}

export function calcRSI(close: number[], period = 14): number[] {
  const result = new Array(close.length).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = close[i] - close[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) result[period] = 100;
  else result[period] = 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < close.length; i++) {
    const diff = close[i] - close[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    if (avgLoss === 0) result[i] = 100;
    else result[i] = 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

export function calcKD(high: number[], low: number[], close: number[], period = 9): { k: number[]; d: number[] } {
  const k = new Array(close.length).fill(NaN);
  const d = new Array(close.length).fill(NaN);
  let kVal = 50;
  let dVal = 50;

  for (let i = period - 1; i < close.length; i++) {
    const highN = Math.max(...high.slice(i - period + 1, i + 1));
    const lowN = Math.min(...low.slice(i - period + 1, i + 1));
    const rsv = highN === lowN ? 50 : ((close[i] - lowN) / (highN - lowN)) * 100;
    kVal = (2 / 3) * kVal + (1 / 3) * rsv;
    dVal = (2 / 3) * dVal + (1 / 3) * kVal;
    k[i] = kVal;
    d[i] = dVal;
  }
  return { k, d };
}

export function calcMACD(
  close: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { macd: number[]; signal: number[]; hist: number[] } {
  const emaFast = calcEMA(close, fast);
  const emaSlow = calcEMA(close, slow);
  const macd = close.map((_, i) => emaFast[i] - emaSlow[i]);
  const sig = calcEMA(macd.map((v) => (isNaN(v) ? 0 : v)), signal);
  const hist = macd.map((v, i) => v - sig[i]);
  return { macd, signal: sig, hist };
}

export function calcBollingerBands(
  close: number[],
  period = 20,
  mult = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = calcSMA(close, period);
  const upper = new Array(close.length).fill(NaN);
  const lower = new Array(close.length).fill(NaN);

  for (let i = period - 1; i < close.length; i++) {
    const slice = close.slice(i - period + 1, i + 1);
    const mean = middle[i];
    const std = Math.sqrt(slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period);
    upper[i] = mean + mult * std;
    lower[i] = mean - mult * std;
  }
  return { upper, middle, lower };
}

export function calcOBV(close: number[], volume: number[]): number[] {
  const obv = new Array(close.length).fill(0);
  for (let i = 1; i < close.length; i++) {
    if (close[i] > close[i - 1]) obv[i] = obv[i - 1] + volume[i];
    else if (close[i] < close[i - 1]) obv[i] = obv[i - 1] - volume[i];
    else obv[i] = obv[i - 1];
  }
  return obv;
}

export function calcWilliamsR(high: number[], low: number[], close: number[], period = 14): number[] {
  const result = new Array(close.length).fill(NaN);
  for (let i = period - 1; i < close.length; i++) {
    const highN = Math.max(...high.slice(i - period + 1, i + 1));
    const lowN = Math.min(...low.slice(i - period + 1, i + 1));
    result[i] = highN === lowN ? -50 : ((highN - close[i]) / (highN - lowN)) * -100;
  }
  return result;
}

export function calcATR(high: number[], low: number[], close: number[], period = 14): number[] {
  const tr = new Array(close.length).fill(NaN);
  for (let i = 1; i < close.length; i++) {
    tr[i] = Math.max(
      high[i] - low[i],
      Math.abs(high[i] - close[i - 1]),
      Math.abs(low[i] - close[i - 1])
    );
  }
  // Wilder's smoothing (EMA with alpha=1/period)
  const atr = new Array(close.length).fill(NaN);
  const alpha = 1 / period;
  let prev = NaN;
  for (let i = 1; i < tr.length; i++) {
    if (isNaN(tr[i])) continue;
    if (isNaN(prev)) { prev = tr[i]; atr[i] = tr[i]; continue; }
    prev = alpha * tr[i] + (1 - alpha) * prev;
    atr[i] = prev;
  }
  return atr;
}

// ─── 一次計算所有指標 ─────────────────────────────────────────────────────────

export function calculateAllIndicators(ohlcv: OhlcvData): Indicators {
  const { high, low, close, volume } = ohlcv;

  const sma5 = calcSMA(close, 5);
  const sma10 = calcSMA(close, 10);
  const sma20 = calcSMA(close, 20);
  const ema50 = calcEMA(close, 50);
  const ema200 = calcEMA(close, 200);
  const volMa20 = calcSMA(volume, 20);

  const bb = calcBollingerBands(close, 20, 2);
  const bbPercentB = close.map((c, i) => {
    const diff = bb.upper[i] - bb.lower[i];
    if (isNaN(diff) || diff === 0) return NaN;
    return (c - bb.lower[i]) / diff;
  });
  const bbBandWidth = close.map((_, i) => {
    if (isNaN(bb.middle[i]) || bb.middle[i] === 0) return NaN;
    return (bb.upper[i] - bb.lower[i]) / bb.middle[i];
  });

  const rsi = calcRSI(close, 14);
  const { k, d } = calcKD(high, low, close, 9);
  const { macd, signal, hist } = calcMACD(close, 12, 26, 9);
  const obv = calcOBV(close, volume);
  const obvMa10 = calcSMA(obv, 10);
  const williamsR = calcWilliamsR(high, low, close, 14);
  const atr = calcATR(high, low, close, 14);

  return {
    close,
    sma5, sma10, sma20, ema50, ema200, volMa20,
    bbUpper: bb.upper, bbMiddle: bb.middle, bbLower: bb.lower,
    bbPercentB, bbBandWidth,
    rsi, k, d, macd, signal, hist,
    obv, obvMa10, williamsR, atr,
  };
}
