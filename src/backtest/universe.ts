/**
 * Point-in-Time Universe Filter with Survivorship Bias Protection
 * 
 * Ensures backtest only evaluates securities that were genuinely listed,
 * active, and tradable on the exact signal timestamp `T`.
 */

import { BacktestUniverseConfig, UniverseSecurity } from "./types";

export class PITUniverseManager {
  private securities: UniverseSecurity[];
  private config: BacktestUniverseConfig;

  constructor(securities: UniverseSecurity[], config: BacktestUniverseConfig) {
    this.securities = securities;
    this.config = config;
  }

  /**
   * 取得在指定交易日 (asOfDate) 符合條件的合法股票標的池 (Survivorship-bias free)
   */
  public getEligibleUniverse(asOfDate: string): UniverseSecurity[] {
    return this.securities.filter((sec) => {
      // 1. 檢驗上市日期：asOfDate 必須 >= listingDate
      if (sec.listingDate > asOfDate) {
        return false;
      }

      // 2. 檢驗下市日期：若已下市，asOfDate 必須 < delistingDate
      if (sec.delistingDate && sec.delistingDate <= asOfDate) {
        return false;
      }

      // 3. 檢驗暫停交易 / 全額交割過濾
      if (this.config.exclude_suspended_trading && sec.isSuspended) {
        return false;
      }

      if (this.config.exclude_full_cash_delivery && sec.isFullCashDelivery) {
        return false;
      }

      return true;
    });
  }

  /**
   * 驗證指定股票在該日期是否處於存續交易中
   */
  public isTradableOn(symbol: string, asOfDate: string): boolean {
    const sec = this.securities.find((s) => s.symbol === symbol);
    if (!sec) return false;
    if (sec.listingDate > asOfDate) return false;
    if (sec.delistingDate && sec.delistingDate <= asOfDate) return false;
    return true;
  }
}
