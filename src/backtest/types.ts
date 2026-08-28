/**
 * Audited Institutional Backtest Types & Schemas
 */

export interface BacktestTimingConfig {
  signal_time: "market_close";
  signal_timestamp_rule: string;
  execution_time: "next_market_open";
  execution_timestamp_rule: string;
  holding_period: number;
  holding_period_unit: "trading_days";
  exit_timing: string;
  exit_execution_timing: string;
  rebalance_policy: string;
  rebalance_rule_explanation: string;
}

export interface BacktestCostConfig {
  commission_bps: number;       // 14.25 bps
  sell_tax_bps: number;         // 30.0 bps
  slippage_bps: number;         // 5.0 bps
  min_commission_ntd: number;   // NT$ 20 floor
  cost_accounting_rule: string;
}

export interface BacktestUniverseConfig {
  benchmark: string;
  market: string[];
  survivorship_bias_protection: boolean;
  min_market_cap_billions: number;
  min_20d_avg_volume_shares: number;
  exclude_suspended_trading: boolean;
  exclude_full_cash_delivery: boolean;
}

export interface BacktestCorporateActionsConfig {
  price_field: "adjusted_close" | "close";
  return_method: "total_return" | "price_return";
  dividend_handling: "embedded_in_adjusted_close" | "cash_reinvestment";
  double_counting_protection: boolean;
  explanation: string;
}

export interface BacktestBenchmarkConfig {
  benchmark_symbol: string;
  timing_rule: string;
  window_definition: string;
  explanation: string;
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
  benchmark_alignment: BacktestBenchmarkConfig;
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
  signalDate: string;           // T Close (13:30)
  entryDate: string;            // T+1 Open (09:00)
  exitDate: string;             // T+20 Close (13:30)
  holdingTradingDays: number;
  entryPriceRaw: number;
  entryPriceExec: number;       // Entry + Slippage
  exitPriceRaw: number;
  exitPriceExec: number;        // Exit - Slippage
  shares: number;
  positionSizeNtd: number;
  entryCommissionNtd: number;   // with NT$20 min
  exitCommissionNtd: number;    // with NT$20 min
  exitTaxNtd: number;           // 30 bps on sell
  entrySlippageNtd: number;
  exitSlippageNtd: number;
  totalFrictionNtd: number;
  grossReturnPct: number;
  netReturnPct: number;
  benchmarkReturnPct: number;   // Synchronized: TAIEX(T+20 Close) / TAIEX(T+1 Open) - 1
  netAlphaPct: number;          // netReturnPct - benchmarkReturnPct
  grossPnLNtd: number;
  netPnLNtd: number;
  factorScoreAtSignal: number;
}

export interface YearlyPerformanceRecord {
  year: number;
  periodType: "In-Sample" | "Walk-Forward Out-of-Sample";
  tradesCount: number;
  winRatePct: number;
  grossReturnPct: number;
  netReturnPct: number;
  benchmarkReturnPct: number;
  netAlphaPct: number;
  sharpeRatio: number;
  maxDrawdownPct: number;
  frictionPaidNtd: number;
}

export interface CalibrationBucket {
  raw_probability_min: number;
  empirical_win_rate_pct: number;
  sample_count: number;
  avg_net_return_pct: number;
}

export interface BacktestReport {
  provenance: {
    runId: string;
    configHash: string;
    datasetHash: string;
    engineVersion: string;
    generatedAt: string;
    isAuditVerified: boolean;
  };
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
    netAlphaAnnualizedPct: number;
    grossTurnoverNtd: number;
    totalCommissionNtd: number;
    totalTaxNtd: number;
    totalSlippageNtd: number;
    totalFrictionPaidNtd: number;
    costToNavRatioPct: number;
    frictionDragPct: number;
  };
  risk: {
    annualizedVolatilityPct: number;
    sharpeRatio: number;
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
  yearlyBreakdown: YearlyPerformanceRecord[];
  calibrationCurve: CalibrationBucket[];
}
