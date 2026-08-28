/**
 * End-to-End Historical Backtest Runner
 * 
 * Ingests raw PIT dataset, traverses Taiwan market calendar cohorts,
 * internally retrieves T+1 Open execution prices and T+20 Close exit prices,
 * executes multi-factor scoring and portfolio accounting, and outputs an audited report.
 */

import { BacktestConfig, BacktestReport, UniverseSecurity } from "./types";
import { BacktestEngine } from "./backtestEngine";
import { PITUniverseManager } from "./universe";
import { isTradingDay, nextTradingDay } from "../utils/marketCalendar";
import { StockInfo } from "../utils/platform";
import { CorporateActionRecord, SecurityPriceBar } from "./priceModel";

export interface HistoricalDataset {
  datasetId: string;
  securities: UniverseSecurity[];
  priceBars: Map<string, SecurityPriceBar[]>; // Symbol -> chronological price bars
  stockInfoSnapshots: Map<string, Map<string, StockInfo>>; // Symbol -> (Date -> StockInfo)
  corporateActions: CorporateActionRecord[];
  benchmarkBars: SecurityPriceBar[]; // TAIEX index bars
}

export class HistoricalBacktestRunner {
  private config: BacktestConfig;
  private dataset: HistoricalDataset;
  private universeManager: PITUniverseManager;
  private engine: BacktestEngine;

  constructor(config: BacktestConfig, dataset: HistoricalDataset) {
    this.config = config;
    this.dataset = dataset;
    this.universeManager = new PITUniverseManager(dataset.securities, config.universe);
    this.engine = new BacktestEngine(config);
  }

  /**
   * 執行端到端完整歷史回測 (End-to-End Traversal)
   */
  public runFullBacktest(
    startDate: string,
    endDate: string,
    provenanceHashes?: {
      runId?: string;
      configHash?: string;
      datasetHash?: string;
      engineSha256?: string;
      gitCommit?: string;
    }
  ): BacktestReport {
    let currentDate = startDate;
    const { holding_period } = this.config.timing;
    let currentPortfolioNav = this.config.portfolio.initial_capital_ntd;

    // 依據 20 交易日世代 (Fixed Cohort) 遍歷日期
    while (currentDate <= endDate) {
      if (!isTradingDay(currentDate)) {
        currentDate = nextTradingDay(currentDate, 1);
        continue;
      }

      const signalDate = currentDate; // T Close (13:30)
      const entryDate = nextTradingDay(signalDate, 1); // T+1 Open (09:00)
      const exitDate = nextTradingDay(entryDate, holding_period - 1); // T+20 Close

      // 超出回測區間則結束
      if (exitDate > endDate) {
        break;
      }

      // 1. 取得當日符合資格之標的池 (Survivorship-bias free)
      const eligibleSecurities = this.universeManager.getEligibleUniverse(signalDate);

      // 2. 針對標的池內部各股票取得價格與 PIT 資訊
      for (const sec of eligibleSecurities) {
        const bars = this.dataset.priceBars.get(sec.symbol);
        if (!bars || bars.length < 20) continue;

        // 取得 T+1 Open 與 T+20 Close
        const entryBar = bars.find((b) => b.date === entryDate);
        const exitBar = bars.find((b) => b.date === exitDate);
        if (!entryBar || !exitBar) continue;

        // 取得 Benchmark (TAIEX) 在 T+1 Open 與 T+20 Close 之價格
        const benchEntryBar = this.dataset.benchmarkBars.find((b) => b.date === entryDate);
        const benchExitBar = this.dataset.benchmarkBars.find((b) => b.date === exitDate);
        const benchmarkEntryPrice = benchEntryBar ? benchEntryBar.rawOpen : 10000;
        const benchmarkExitPrice = benchExitBar ? benchExitBar.rawClose : 10000;

        // 取得歷史 PIT 財務基本面快照
        const secInfoMap = this.dataset.stockInfoSnapshots.get(sec.symbol);
        const stockInfo = secInfoMap?.get(signalDate) || {
          symbol: sec.symbol,
          name: sec.name,
          current_price: { value: entryBar.rawOpen, source: "TWSE", fetchedAt: `${signalDate}T13:30:00Z` },
        } as StockInfo;

        // 構造歷史 OHLCV 序列 (截至 T 日為止，不得有 T+1 未來數據)
        const histBars = bars.filter((b) => b.date <= signalDate);
        if (histBars.length < 20) continue;

        const ohlcv = {
          timestamp: histBars.map((b) => new Date(b.date).getTime()),
          open: histBars.map((b) => b.rawOpen),
          high: histBars.map((b) => b.rawHigh),
          low: histBars.map((b) => b.rawLow),
          close: histBars.map((b) => b.rawClose),
          volume: histBars.map((b) => b.volume),
        };

        // 3. 透過 Engine 執行模擬交易與計費
        const trade = this.engine.simulateStockTrade({
          security: sec,
          stockInfo,
          signalDate,
          entryPriceRaw: entryBar.rawOpen,
          exitPriceRaw: exitBar.rawClose,
          benchmarkEntryPrice,
          benchmarkExitPrice,
          ohlcv,
          currentPortfolioNav,
        });

        currentPortfolioNav += trade.netPnLNtd;
      }

      // 下一個世代排在 T+20 Close 後，即次一交易日 T+21
      currentDate = nextTradingDay(exitDate, 1);
    }

    const benchmarkDailyReturns: number[] = [];
    return this.engine.finalize(benchmarkDailyReturns, startDate, endDate, provenanceHashes);
  }
}
