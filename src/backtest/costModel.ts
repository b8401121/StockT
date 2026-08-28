/**
 * Taiwan Stock Exchange Transaction Cost & Friction Model
 * 
 * Accurately models:
 * - Brokerage Commission (14.25 bps with NT$20 minimum floor)
 * - Securities Transaction Tax (30.0 bps on sale)
 * - Bid-Ask Slippage (e.g. 5.0 bps on entry and exit)
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
 * 計算買進 (Entry / Buy) 之執行價與摩擦成本
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
 * 計算賣出 (Exit / Sell) 之執行價與摩擦成本
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

  const rawCommission = executedAmount * (config.commission_bps / 10000);
  const commission = Math.max(config.min_commission_ntd, Math.round(rawCommission));
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
    totalFrictionNtd: Math.round(totalFrictionNtd),
    buyBreakdown: buy,
    sellBreakdown: sell,
  };
}
