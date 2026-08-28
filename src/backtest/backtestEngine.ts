/**
 * Institutional-Grade Multi-Factor Backtest Engine (Audited Architecture)
 * 
 * Enforces:
 * 1. Internal Price Resolution from SecurityPriceBar (No caller-injected execution prices)
 * 2. Multi-Factor AI Alpha Ranking & Top-N Selection Pipeline
 * 3. Zero-Tolerance for Missing PIT Snapshots & Benchmark Gaps
 * 4. Corporate Actions Integration (Splits & Cash Dividends)
 */

import {
  BacktestConfig,
  BacktestReport,
  CorporateActionRecord,
  SecurityPriceBar,
  UniverseSecurity,
} from "./types";
import { PortfolioEngine } from "./portfolioEngine";
import { StockInfo } from "../utils/platform";
import { createPITStockInfo } from "../utils/pitValidator";
import { evaluateAIAlpha } from "../utils/aiAlphaModel";
import { computeCorporateAdjustment } from "./priceModel";

export interface SecurityCohortCandidate {
  security: UniverseSecurity;
  stockInfo: StockInfo;
  bars: SecurityPriceBar[];
  entryBar: SecurityPriceBar;
  exitBar: SecurityPriceBar;
  corporateActions: CorporateActionRecord[];
}

export class BacktestEngine {
  private config: BacktestConfig;
  private portfolio: PortfolioEngine;

  constructor(config: BacktestConfig) {
    this.config = config;
    this.portfolio = new PortfolioEngine(config);
  }

  public getPortfolioEngine(): PortfolioEngine {
    return this.portfolio;
  }

  /**
   * 執行單一世代 (Cohort) 之多因子評分、排名 (Ranking)、選出 Top N 並執行交易
   */
  public executeRankedCohort(params: {
    signalDate: string;           // T Close (13:30)
    candidates: SecurityCohortCandidate[];
    benchmarkEntryBar: SecurityPriceBar;
    benchmarkExitBar: SecurityPriceBar;
    currentPortfolioNav: number;
  }) {
    const { signalDate, candidates, benchmarkEntryBar, benchmarkExitBar, currentPortfolioNav } = params;

    // 1. 嚴格檢驗 Benchmark 資料完整性 (杜絕 10000 fallback)
    if (!benchmarkEntryBar || !benchmarkExitBar || benchmarkEntryBar.rawOpen <= 0 || benchmarkExitBar.rawClose <= 0) {
      this.portfolio.incrementMissingBenchmark(signalDate);
      throw new Error(`Missing or invalid benchmark data for cohort on ${signalDate}`);
    }

    const scoredCandidates: {
      candidate: SecurityCohortCandidate;
      factorScore: number;
      convictionTier: string;
      pitInfo: StockInfo;
    }[] = [];

    // 2. 對當前世代所有候選股票執行 PIT 過濾與 AI Alpha 15 多因子模型評估
    for (const cand of candidates) {
      const signalTs = `${signalDate}T13:30:00+08:00`;
      const pitInfo = createPITStockInfo(cand.stockInfo, signalTs);

      // 構造截至 T 日為止的 OHLCV 序列 (因子計算專用：使用 adjustedClose 避免除息假斷崖)
      const histBars = cand.bars.filter((b) => b.date <= signalDate);
      if (histBars.length < 20) continue;

      const ohlcv = {
        timestamp: histBars.map((b) => new Date(b.date).getTime()),
        open: histBars.map((b) => b.rawOpen),
        high: histBars.map((b) => b.rawHigh),
        low: histBars.map((b) => b.rawLow),
        close: histBars.map((b) => b.adjustedClose), // 👈 因子計算嚴格使用 adjustedClose
        volume: histBars.map((b) => b.volume),
      };

      const curP = histBars[histBars.length - 1].rawClose;
      const prevP = histBars.length > 1 ? histBars[histBars.length - 2].rawClose : curP;

      const aiResult = evaluateAIAlpha(pitInfo as any, curP, prevP, ohlcv);

      scoredCandidates.push({
        candidate: cand,
        factorScore: aiResult.rawProbabilityPct,
        convictionTier: aiResult.convictionTier,
        pitInfo,
      });
    }

    // 3. 排序 (Ranking)：依據 AI Alpha 綜合評分由高至低排序
    scoredCandidates.sort((a, b) => b.factorScore - a.factorScore);

    // 4. 選股 (Selection)：選出 Top N 股票 (預設 max_positions，例如 Top 20)
    const { max_positions, holding_period } = {
      max_positions: this.config.portfolio.max_positions,
      holding_period: this.config.timing.holding_period,
    };

    const selected = scoredCandidates.slice(0, max_positions);
    const executedTrades = [];

    for (let rank = 0; rank < selected.length; rank++) {
      const { candidate, factorScore } = selected[rank];
      const entryDate = candidate.entryBar.date;
      const exitDate = candidate.exitBar.date;

      // 5. 計算持倉期間 Corporate Actions (股數調整與現金股利)
      const corpAdjustment = computeCorporateAdjustment(
        candidate.security.symbol,
        entryDate,
        exitDate,
        candidate.corporateActions
      );

      // 6. 內部直接由 SecurityPriceBar 提取真實撮合價 (T+1 rawOpen 與 T+20 rawClose)
      const trade = this.portfolio.executeTrade({
        symbol: candidate.security.symbol,
        name: candidate.security.name,
        sector: candidate.security.sector,
        signalDate,
        entryDate,
        exitDate,
        holdingTradingDays: holding_period,
        entryPriceRaw: candidate.entryBar.rawOpen,   // 👈 Engine 內部直接從 Bar 取價
        exitPriceRaw: candidate.exitBar.rawClose,    // 👈 Engine 內部直接從 Bar 取價
        benchmarkEntryPrice: benchmarkEntryBar.rawOpen,
        benchmarkExitPrice: benchmarkExitBar.rawClose,
        factorScore,
        factorRank: rank + 1,
        portfolioNavAtEntry: currentPortfolioNav,
        corporateAdjustment: corpAdjustment,
      });

      executedTrades.push(trade);
    }

    return executedTrades;
  }

  /**
   * 結算並輸出 Backtest 報告
   */
  public finalize(
    benchmarkDailyReturns: number[],
    periodStart: string,
    periodEnd: string,
    provenanceHashes?: {
      runId?: string;
      gitCommit?: string;
      configSha256?: string;
      datasetSha256?: string;
      engineSha256?: string;
    }
  ): BacktestReport {
    return this.portfolio.generateReport(benchmarkDailyReturns, periodStart, periodEnd, provenanceHashes);
  }
}
