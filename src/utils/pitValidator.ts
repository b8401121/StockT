/**
 * Point-in-Time (PIT) Validator & Backtest Feature Gatekeeper
 * 
 * Enforces strict time causality invariants:
 * 1. feature.availableAt <= signalTimestamp
 * 2. feature.publishedAt <= feature.availableAt
 * 3. feature.availableAt matches AvailabilityPolicy + Taiwan Market Calendar
 */

import { Metric, StockInfo } from "./platform";
import { parseDate, validatePITMetric } from "./marketCalendar";

export interface PITValidationResult {
  isAvailable: boolean;
  rejectReason?: string;
  verifiedTimestamp?: string;
}

/**
 * 嚴格檢驗單項 Metric 在指定訊號時間點 (signalTimestamp) 是否合法可用
 */
export function checkMetricAvailability<T>(
  metric: Metric<T> | null | undefined,
  signalTimestamp: string | Date
): PITValidationResult {
  if (!metric || metric.value === null || metric.value === undefined) {
    return { isAvailable: false, rejectReason: "Metric is null or undefined" };
  }

  // 1. 檢驗 Metric 本身的 PIT Invariants (因果律與政策一致性)
  const validation = validatePITMetric(metric);
  if (!validation.valid) {
    return {
      isAvailable: false,
      rejectReason: `PIT Invariant Violation: ${validation.reason}`
    };
  }

  // 2. 檢驗時序門檻：availableAt <= signalTimestamp
  const availTs = parseDate(metric.availableAt!).getTime();
  const signalTs = parseDate(signalTimestamp).getTime();

  if (availTs > signalTs) {
    return {
      isAvailable: false,
      rejectReason: `Look-ahead bias prevented: availableAt (${metric.availableAt}) > signalTimestamp (${signalTimestamp})`
    };
  }

  return {
    isAvailable: true,
    verifiedTimestamp: metric.availableAt
  };
}

/**
 * 回測專用：將 StockInfo 中在 signalTimestamp 尚未生效的指標遮蔽 (屏蔽為 null)
 */
export function createPITStockInfo(info: StockInfo, signalTimestamp: string): StockInfo {
  const result: StockInfo = { ...info };

  const quantFields: (keyof StockInfo)[] = [
    "current_price", "previous_close", "pe", "forward_pe", "pb",
    "dividend_yield", "eps", "roe", "gross_margins", "operating_margins",
    "profit_margins", "revenue_growth", "earnings_growth", "current_ratio",
    "quick_ratio", "debt_to_equity", "free_cashflow", "operating_cashflow",
    "net_income", "market_cap"
  ];

  for (const field of quantFields) {
    const m = info[field] as Metric<number> | null | undefined;
    if (m) {
      const check = checkMetricAvailability(m, signalTimestamp);
      if (!check.isAvailable) {
        (result as any)[field] = null;
      }
    }
  }

  return result;
}
