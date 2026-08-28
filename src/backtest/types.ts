/**
 * Institutional-Grade Backtest & Portfolio Engine Types
 */

export interface BacktestTimingConfig {
  signal_time: "market_close";
  signal_timestamp_rule: string;
  execution_time: "next_market_open";
  execution_timestamp_rule: string;
  holding_period: number;
  holding_period_unit: "trading_days";
  exit_timing: string;
  exit_execution: string;
  rebalance_frequency: "daily" | "weekly" | "monthly";
}

export interface BacktestCostConfig {
  commission_bps: number;       // e.g. 14.25 bps
  sell_tax_bps: number;         // e.g. 30.0 bps (TWSE standard)
  slippage_bps: number;         // e.g. 5.0 bps
  min_commission_ntd: number;   // e.g. NT$ 20
}

export interface BacktestUniverseConfig {
  benchmark: string;            // e.g. "TAIEX"
  market: string[];             // ["TWSE", "TPEx"]
  survivorship_bias_protection: boolean;
  min_market_cap_billions: number;
  min_20d_avg_volume_shares: number;
  exclude_suspended_trading: boolean;
  exclude_full_cash_delivery: boolean;
}

export interface BacktestCorporateActionsConfig {
  price_field: "adjusted_close" | "close";
  return_method: "total_return" | "price_return";
  dividend_reinvestment: boolean;
}

export interface BacktestPortfolioConfig {
  initial_capital_ntd: number;
  max_positions: number;
  position_weighting: "equal" | "conviction_weighted";
  max_single_position_weight: number;
  cash_buffer_weight: number;
  max_sector_exposure_weight: number;
}

export interface BacktestConfig {
  engine_version: string;
  model_name: string;
  timezone: string;
  timing: BacktestTimingConfig;
  costs: BacktestCostConfig;
  universe: BacktestUniverseConfig;
  corporate_actions: BacktestCorporateActionsConfig;
  portfolio: BacktestPortfolioConfig;
}

export interface UniverseSecurity {
  symbol: string;
  name: string;
  sector: string;
  listingDate: string;          // YYYY-MM-DD
  delistingDate?: string;       // YYYY-MM-DD | undefined
  isSuspended?: boolean;
  isFullCashDelivery?: boolean;
}

export interface SimulatedTrade {
  tradeId: string;
  symbol: string;
  name: string;
  sector: string;
  signalDate: string;           // T
  entryDate: string;            // T+1
  exitDate: string;             // T+20 trading days
  holdingTradingDays: number;
  entryPriceRaw: number;
  entryPriceExec: number;       // with slippage
  exitPriceRaw: number;
  exitPriceExec: number;        // with slippage
  shares: number;
  positionSizeNtd: number;
  entryCommissionNtd: number;
  exitCommissionNtd: number;
  exitTaxNtd: number;
  totalFrictionNtd: number;
  grossReturnPct: number;
  netReturnPct: number;
  grossPnLNtd: number;
  netPnLNtd: number;
  factorScoreAtSignal: number;
}

export interface DailyPortfolioRecord {
  date: string;
  portfolioNav: number;
  cashNtd: number;
  investedNtd: number;
  activePositionsCount: number;
  dailyGrossReturnPct: number;
  dailyNetReturnPct: number;
  benchmarkValue: number;
  benchmarkDailyReturnPct: number;
  cumulativeNetReturnPct: number;
  cumulativeBenchmarkReturnPct: number;
  drawdownPct: number;
}

export interface BacktestReport {
  summary: {
    periodStart: string;
    periodEnd: string;
    totalTradingDays: number;
    totalTrades: number;
    winRatePct: number;
    profitFactor: number;
  };
  returns: {
    grossTotalReturnPct: number;
    netTotalReturnPct: number;
    benchmarkTotalReturnPct: number;
    grossAnnualizedReturnPct: number;
    netAnnualizedReturnPct: number;
    benchmarkAnnualizedReturnPct: number;
    netAlphaAnnualizedPct: number;  // Net Excess Return over TAIEX
    totalFrictionPaidNtd: number;
    frictionDragPct: number;       // Drag caused by commission + tax + slippage
  };
  risk: {
    annualizedVolatilityPct: number;
    sharpeRatio: number;           // Net Return / Vol
    sortinoRatio: number;
    maxDrawdownPct: number;
    informationRatio: number;
    betaToBenchmark: number;
  };
  trading: {
    annualizedTurnoverPct: number;
    avgHoldingTradingDays: number;
    winTradesCount: number;
    lossTradesCount: number;
    avgWinPct: number;
    avgLossPct: number;
    maxConsecutiveLosses: number;
  };
}
