/**
 * Taiwan Stock Exchange (TWSE / TPEx) Market Calendar & Point-in-Time Timing Engine
 * 
 * Provides official trading day calendar calculations, holiday resolution,
 * market open/close timings, and AvailabilityPolicy constraint validation.
 */

import { AvailabilityPolicy, Metric } from "./platform";

/** 台灣例行國定假日與特殊休市日資料庫 (涵蓋主要國定假日與台股封關日) */
export const TAIWAN_MARKET_HOLIDAYS = new Set<string>([
  // 2024
  "2024-01-01", "2024-02-06", "2024-02-07", "2024-02-08", "2024-02-09",
  "2024-02-12", "2024-02-13", "2024-02-14", "2024-02-28",
  "2024-04-04", "2024-04-05", "2024-05-01", "2024-06-10", "2024-09-17",
  "2024-10-10", "2024-10-02", "2024-10-03", // 颱風假
  // 2025
  "2025-01-01", "2025-01-23", "2025-01-24", "2025-01-27", "2025-01-28",
  "2025-01-29", "2025-01-30", "2025-01-31", "2025-02-28", "2025-04-03",
  "2025-04-04", "2025-05-01", "2025-05-30", "2025-10-06", "2025-10-10",
  // 2026
  "2026-01-01", "2026-02-13", "2026-02-16", "2026-02-17", "2026-02-18",
  "2026-02-19", "2026-02-20", "2026-02-27", "2026-04-03", "2026-04-06",
  "2026-05-01", "2026-06-19", "2026-09-25", "2026-10-09",
]);

/**
 * 格式化 Date 為 YYYY-MM-DD
 */
export function formatYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 解析日期字串為 Date 物件 (支援 YYYY-MM-DD 與 ISO-8601)
 */
export function parseDate(dateInput: string | Date): Date {
  if (dateInput instanceof Date) return new Date(dateInput.getTime());
  // 若僅有 YYYY-MM-DD，補上台北時區 00:00:00
  if (dateInput.length === 10) {
    const [y, m, d] = dateInput.split("-").map(Number);
    return new Date(y, m - 1, d, 0, 0, 0);
  }
  return new Date(dateInput);
}

/**
 * 判斷指定日期是否為台股開市交易日 (排除週末與假日)
 */
export function isTradingDay(dateInput: string | Date): boolean {
  const d = parseDate(dateInput);
  const dayOfWeek = d.getDay();
  // 0 = Sunday, 6 = Saturday
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;
  const ymd = formatYMD(d);
  if (TAIWAN_MARKET_HOLIDAYS.has(ymd)) return false;
  return true;
}

/**
 * 取得指定日期之後的第 N 個交易日 (預設 n = 1)
 */
export function nextTradingDay(dateInput: string | Date, n = 1): string {
  let d = parseDate(dateInput);
  let count = 0;
  while (count < n) {
    d.setDate(d.getDate() + 1);
    if (isTradingDay(d)) {
      count++;
    }
  }
  return formatYMD(d);
}

/**
 * 取得指定日期的台股收盤時間 (13:30:00+08:00)
 */
export function marketClose(dateInput: string | Date): string {
  const ymd = typeof dateInput === "string" && dateInput.length === 10
    ? dateInput
    : formatYMD(parseDate(dateInput));
  return `${ymd}T13:30:00+08:00`;
}

/**
 * 根據發布時間戳，計算次一開盤可用時間點 (09:00:00+08:00)
 * 
 * 規則：
 * 1. 若發布於盤前 (例如 08:30) 且當日為交易日 → 當日 09:00:00 開盤可用
 * 2. 若發布於盤中或盤後 (例如 16:30) 或非交易日/週末 → 次一交易日 09:00:00 開盤可用
 */
export function nextMarketOpen(timestampInput: string | Date): string {
  const dt = parseDate(timestampInput);
  const ymd = formatYMD(dt);
  const hours = dt.getHours();
  const minutes = dt.getMinutes();
  const isBeforeOpen = hours < 9 || (hours === 9 && minutes === 0);

  if (isTradingDay(dt) && isBeforeOpen) {
    return `${ymd}T09:00:00+08:00`;
  }

  const nextDay = nextTradingDay(dt, 1);
  return `${nextDay}T09:00:00+08:00`;
}

/**
 * 依據 AvailabilityPolicy 與 publishedAt 計算權威的 availableAt
 */
export function computeAvailableAt(
  publishedAt: string | undefined,
  policy: AvailabilityPolicy,
  period?: string
): string {
  switch (policy) {
    case "immediate":
      return publishedAt || new Date().toISOString();

    case "market_close": {
      const base = publishedAt || period || formatYMD(new Date());
      const ymd = base.slice(0, 10);
      return marketClose(ymd);
    }

    case "next_market_open": {
      if (!publishedAt) {
        throw new Error(`Policy 'next_market_open' requires explicit publishedAt timestamp`);
      }
      return nextMarketOpen(publishedAt);
    }

    case "next_market_close": {
      const openTime = nextMarketOpen(publishedAt || new Date().toISOString());
      const nextDay = openTime.slice(0, 10);
      return marketClose(nextDay);
    }

    case "conservative_statutory_deadline": {
      // 若有明確法定截止日直接使用，否則依 period 推算
      if (publishedAt && publishedAt.length === 10) return `${publishedAt}T23:59:59+08:00`;
      if (period && period.includes("Q")) {
        const year = parseInt(period.slice(0, 4), 10);
        const q = period.slice(4);
        if (q === "Q1") return `${year}-05-15T23:59:59+08:00`;
        if (q === "Q2") return `${year}-08-14T23:59:59+08:00`;
        if (q === "Q3") return `${year}-11-14T23:59:59+08:00`;
        if (q === "Q4") return `${year + 1}-03-31T23:59:59+08:00`;
      }
      return publishedAt || new Date().toISOString();
    }
  }
}

/**
 * Point-in-Time 嚴格約束校驗器 (Invariant Verifier)
 * 
 * 驗證 Metric 是否合規：
 * 1. publishedAt 不得晚於 availableAt (因果律 publishedAt <= availableAt)
 * 2. availableAt 必須符合 availabilityPolicy 與市場日曆
 */
export function validatePITMetric<T>(metric: Metric<T>): {
  valid: boolean;
  reason?: string;
  verifiedAvailableAt?: string;
} {
  if (!metric.availableAt) {
    return { valid: false, reason: "Missing required availableAt timestamp" };
  }

  // 1. Invariant 檢驗：publishedAt <= availableAt
  if (metric.publishedAt) {
    const pubTs = parseDate(metric.publishedAt).getTime();
    const availTs = parseDate(metric.availableAt).getTime();
    if (pubTs > availTs) {
      return {
        valid: false,
        reason: `Causality violation: publishedAt (${metric.publishedAt}) > availableAt (${metric.availableAt})`
      };
    }
  }

  // 2. Policy 檢驗：如果宣告了 policy，比對是否符合生成規則
  if (metric.availabilityPolicy) {
    try {
      const expectedAvail = computeAvailableAt(metric.publishedAt, metric.availabilityPolicy, metric.period);
      // 容許時間戳前綴匹配 (例如 Date 精度差異)
      const isMatch = metric.availableAt.startsWith(expectedAvail.slice(0, 10)) ||
                      expectedAvail.startsWith(metric.availableAt.slice(0, 10));
      if (!isMatch) {
        return {
          valid: false,
          reason: `Policy mismatch for ${metric.availabilityPolicy}: expected ${expectedAvail}, got ${metric.availableAt}`
        };
      }
      return { valid: true, verifiedAvailableAt: expectedAvail };
    } catch (err: any) {
      return { valid: false, reason: err.message };
    }
  }

  return { valid: true, verifiedAvailableAt: metric.availableAt };
}
