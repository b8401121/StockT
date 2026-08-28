/**
 * Taiwan Stock Exchange Transaction Cost & Friction Model (Audited)
 * 
 * Strict Accounting:
 * - Buy: max(executedAmount * 0.001425, 20) + entry slippage
 * - Sell: max(executedAmount * 0.001425, 20) + round(executedAmount * 0.0030) + exit slippage
 * - Double Counting Protection: No dividend reinvestment added to cash when using adjusted_close
 */

import { BacktestCostConfig } from "./types";

export interface TradeCostBreakdown {
  rawAmount: number;
  slippageAmount: number;
  executedPrice: number;
  commission: number;
  tax: number;
  totalCost: number;
}

/**
 * 計算買進 (Entry / Buy) 之執行價與摩擦成本 (含 NT$20 低消)
 */
export function calculateBuyFriction(
  rawPrice: number,
  shares: number,
  config: BacktestCostConfig
): TradeCostBreakdown {
  const slippageMultiplier = 1 + config.slippage_bps / 10000;
  const executedPrice = rawPrice * slippageMultiplier;
  const rawAmount = rawPrice * shares;
  const executedAmount = executedPrice * shares;
  const slippageAmount = executedAmount - rawAmount;

  // 券商手續費 14.25 bps，強制最低 20 元低消
  const rawCommission = executedAmount * (config.commission_bps / 10000);
  const commission = Math.max(config.min_commission_ntd, Math.round(rawCommission));
  const tax = 0; // 買進不課證交稅

  return {
    rawAmount,
    slippageAmount,
    executedPrice,
    commission,
    tax,
    totalCost: executedAmount + commission,
  };
}

/**
 * 計算賣出 (Exit / Sell) 之執行價與摩擦成本 (含 NT$20 低消與 30 bps 證交稅)
 */
export function calculateSellFriction(
  rawPrice: number,
  shares: number,
  config: BacktestCostConfig
): TradeCostBreakdown {
  const slippageMultiplier = 1 - config.slippage_bps / 10000;
  const executedPrice = rawPrice * slippageMultiplier;
  const rawAmount = rawPrice * shares;
  const executedAmount = executedPrice * shares;
  const slippageAmount = rawAmount - executedAmount;

  // 券商手續費 14.25 bps，強制最低 20 元低消
  const rawCommission = executedAmount * (config.commission_bps / 10000);
  const commission = Math.max(config.min_commission_ntd, Math.round(rawCommission));
  // 證券交易稅 30 bps (四捨五入至整數)
  const tax = Math.round(executedAmount * (config.sell_tax_bps / 10000));

  return {
    rawAmount,
    slippageAmount,
    executedPrice,
    commission,
    tax,
    totalCost: executedAmount - commission - tax,
  };
}

/**
 * 計算單筆交易之毛報酬率 (Gross Return) 與淨報酬率 (Net Return)
 */
export function computeTradePnL(
  entryRawPrice: number,
  exitRawPrice: number,
  shares: number,
  config: BacktestCostConfig
): {
  grossReturnPct: number;
  netReturnPct: number;
  grossPnLNtd: number;
  netPnLNtd: number;
  entryCommissionNtd: number;
  exitCommissionNtd: number;
  exitTaxNtd: number;
  entrySlippageNtd: number;
  exitSlippageNtd: number;
  totalFrictionNtd: number;
  buyBreakdown: TradeCostBreakdown;
  sellBreakdown: TradeCostBreakdown;
} {
  const buy = calculateBuyFriction(entryRawPrice, shares, config);
  const sell = calculateSellFriction(exitRawPrice, shares, config);

  const grossInvested = buy.rawAmount;
  const grossProceeds = sell.rawAmount;
  const grossPnLNtd = grossProceeds - grossInvested;
  const grossReturnPct = grossInvested > 0 ? (grossPnLNtd / grossInvested) * 100 : 0;

  const netInvested = buy.totalCost;
  const netProceeds = sell.totalCost;
  const netPnLNtd = netProceeds - netInvested;
  const netReturnPct = netInvested > 0 ? (netPnLNtd / netInvested) * 100 : 0;

  const totalFrictionNtd = (buy.slippageAmount + buy.commission) + (sell.slippageAmount + sell.commission + sell.tax);

  return {
    grossReturnPct: Number(grossReturnPct.toFixed(2)),
    netReturnPct: Number(netReturnPct.toFixed(2)),
    grossPnLNtd: Math.round(grossPnLNtd),
    netPnLNtd: Math.round(netPnLNtd),
    entryCommissionNtd: buy.commission,
    exitCommissionNtd: sell.commission,
    exitTaxNtd: sell.tax,
    entrySlippageNtd: Math.round(buy.slippageAmount),
    exitSlippageNtd: Math.round(sell.slippageAmount),
    totalFrictionNtd: Math.round(totalFrictionNtd),
    buyBreakdown: buy,
    sellBreakdown: sell,
  };
}
