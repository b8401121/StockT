/**
 * Multi-Tier Price & Corporate Action Taxonomy
 * 
 * Strict separation of price concepts:
 * 1. Raw Execution Price: The actual price printed on the order book at T+1 Open (used for trade execution & fees)
 * 2. Adjusted Analysis Price: Split/Dividend adjusted price series (used for momentum & technical factor calculations)
 * 3. Corporate Action Multiplier: Split / Dividend adjustment factor between Entry T+1 and Exit T+20
 * 4. Total Return: P_exit_raw * splitMultiplier + dividends - P_entry_raw
 */

export interface CorporateActionRecord {
  symbol: string;
  date: string;                     // Ex-date (除權息日)
  type: "cash_dividend" | "stock_dividend" | "split" | "capital_reduction";
  cashDividendNtd?: number;         // 每股現金股利
  stockDividendShares?: number;     // 每股配股 (e.g. 0.1 share per share)
  splitRatio?: number;              // 分割比例 (e.g. 2 for 2-for-1 split)
}

export interface SecurityPriceBar {
  date: string;
  rawOpen: number;
  rawHigh: number;
  rawLow: number;
  rawClose: number;
  volume: number;
  adjustedClose: number;            // For factor analysis
  adjustmentFactor: number;         // Cumulative adjustment factor
}

/**
 * 計算從 Entry Date 到 Exit Date 期間因除權息或分割造成的股數調整倍數與累積現金股利
 */
export function computeCorporateAdjustment(
  symbol: string,
  entryDate: string,
  exitDate: string,
  actions: CorporateActionRecord[]
): {
  sharesMultiplier: number;
  accumulatedCashDividendPerShare: number;
} {
  const relevantActions = actions.filter(
    (a) => a.symbol === symbol && a.date > entryDate && a.date <= exitDate
  );

  let sharesMultiplier = 1.0;
  let accumulatedCashDividend = 0.0;

  for (const act of relevantActions) {
    if (act.type === "cash_dividend" && act.cashDividendNtd) {
      accumulatedCashDividend += act.cashDividendNtd * sharesMultiplier;
    } else if (act.type === "stock_dividend" && act.stockDividendShares) {
      sharesMultiplier *= 1 + act.stockDividendShares;
    } else if (act.type === "split" && act.splitRatio) {
      sharesMultiplier *= act.splitRatio;
    } else if (act.type === "capital_reduction" && act.splitRatio) {
      sharesMultiplier *= act.splitRatio;
    }
  }

  return {
    sharesMultiplier,
    accumulatedCashDividendPerShare: accumulatedCashDividend,
  };
}
