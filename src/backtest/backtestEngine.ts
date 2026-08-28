/**
 * Institutional-Grade Multi-Factor Backtest Engine (Vertical Slice v1)
 * 
 * Pipeline:
 * 1. Historical PIT Dataset & Survivorship-free Universe
 * 2. Point-in-Time Feature Filtering (isFeatureAvailable)
 * 3. AIAlpha 15 Multi-Factor Signal Generation at T Close (13:30)
 * 4. T+1 Market Open Execution (09:00 with Slippage & Commission)
 * 5. 20 Trading Days Holding Period & T+20 Close Exit
 * 6. Friction & Tax Accounting (Commission 14.25 bps + Tax 30 bps + Slippage 5 bps)
 * 7. Portfolio NAV & Risk Report Generation (Gross vs Net Return, Alpha, MDD, Sharpe)
 */

import { BacktestConfig, BacktestReport, UniverseSecurity } from "./types";
import { PortfolioEngine } from "./portfolioEngine";
import { nextTradingDay } from "../utils/marketCalendar";
import { OhlcvData, StockInfo } from "../utils/platform";
import { createPITStockInfo } from "../utils/pitValidator";
import { evaluateAIAlpha } from "../utils/aiAlphaModel";

export class BacktestEngine {
  private config: BacktestConfig;
  private portfolio: PortfolioEngine;

  constructor(config: BacktestConfig) {
    this.config = config;
    this.portfolio = new PortfolioEngine(config);
  }

  /**
   * 執行一輪單一個股的完整回測模擬交易
   */
  public simulateStockTrade(params: {
    security: UniverseSecurity;
    stockInfo: StockInfo;
    signalDate: string;           // T
    entryPriceRaw: number;        // T+1 Open
    exitPriceRaw: number;         // T+20 Close
    ohlcv: OhlcvData;
    currentPortfolioNav: number;
  }) {
    const { security, stockInfo, signalDate, entryPriceRaw, exitPriceRaw, ohlcv, currentPortfolioNav } = params;

    // 1. PIT 審計：過濾在 signalDate (T 13:30) 尚未生效的指標
    const signalTs = `${signalDate}T13:30:00+08:00`;
    const pitInfo = createPITStockInfo(stockInfo, signalTs);

    // 2. 評估 AIAlpha 15 多因子模型分數
    const curP = ohlcv.close.length > 0 ? ohlcv.close[ohlcv.close.length - 1] : entryPriceRaw;
    const prevP = ohlcv.close.length > 1 ? ohlcv.close[ohlcv.close.length - 2] : curP;
    const aiResult = evaluateAIAlpha(pitInfo as any, curP, prevP, ohlcv);

    // 3. 計算時序：Entry = T+1, Exit = T+20 Trading Days
    const entryDate = nextTradingDay(signalDate, 1);
    const exitDate = nextTradingDay(entryDate, this.config.timing.holding_period - 1);

    // 4. 透過 PortfolioEngine 執行交易並扣除摩擦成本
    return this.portfolio.executeTrade({
      symbol: security.symbol,
      name: security.name,
      sector: security.sector,
      signalDate,
      entryDate,
      exitDate,
      holdingTradingDays: this.config.timing.holding_period,
      entryPriceRaw,
      exitPriceRaw,
      factorScore: aiResult.rawProbabilityPct,
      portfolioNavAtEntry: currentPortfolioNav,
    });
  }

  /**
   * 結算並輸出 Backtest 報告
   */
  public finalize(benchmarkDailyReturns: number[], periodStart: string, periodEnd: string): BacktestReport {
    return this.portfolio.generateReport(benchmarkDailyReturns, periodStart, periodEnd);
  }
}
