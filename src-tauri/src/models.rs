use serde::{Deserialize, Serialize};

/// 帶 Point-in-Time (PIT) 數據特徵與來源標籤的量化指標容器
/// 
/// 區分三個關鍵時間概念以杜絕 Look-Ahead Bias：
/// - `period`: 數據所屬期間 (例如 "2024Q2", "2024-07", "2026-08-28")
/// - `published_at`: 市場/主管機關正式公告時間 (例如 "2024-08-14", "2024-08-10")
/// - `fetched_at`: StockT 實際發送 HTTP 請求抓取時間 (ISO 8601 UTC)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MetricF64 {
    pub value: f64,
    pub source: String,
    pub period: Option<String>,
    pub published_at: Option<String>,
    pub fetched_at: String,
}

impl MetricF64 {
    pub fn yahoo(value: f64, fetched_at: &str) -> Self {
        Self {
            value,
            source: "Yahoo Finance".to_string(),
            period: None,
            published_at: None,
            fetched_at: fetched_at.to_string(),
        }
    }

    pub fn yahoo_fundamental(
        value: f64,
        period: Option<String>,
        published_at: Option<String>,
        fetched_at: &str,
    ) -> Self {
        Self {
            value,
            source: "Yahoo Finance".to_string(),
            period,
            published_at,
            fetched_at: fetched_at.to_string(),
        }
    }

    pub fn twse(value: f64, period: Option<String>, published_at: Option<String>, fetched_at: &str) -> Self {
        Self {
            value,
            source: "TWSE".to_string(),
            period,
            published_at,
            fetched_at: fetched_at.to_string(),
        }
    }

    pub fn tpex(value: f64, period: Option<String>, published_at: Option<String>, fetched_at: &str) -> Self {
        Self {
            value,
            source: "TPEx".to_string(),
            period,
            published_at,
            fetched_at: fetched_at.to_string(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OhlcvData {
    pub timestamp: Vec<i64>,
    pub open: Vec<f64>,
    pub high: Vec<f64>,
    pub low: Vec<f64>,
    pub close: Vec<f64>,
    pub volume: Vec<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StockInfo {
    // ─── 識別與文字欄位 ────────────────────────────────────────────────────────
    pub symbol: String,
    pub name: String,
    pub sector: Option<String>,
    pub industry: Option<String>,
    pub long_business_summary: Option<String>,

    // ─── 量化指標 (帶 PIT provenance: value, source, period, published_at, fetched_at)
    pub current_price:      Option<MetricF64>,
    pub previous_close:     Option<MetricF64>,
    pub pe:                 Option<MetricF64>,
    pub forward_pe:         Option<MetricF64>,
    pub pb:                 Option<MetricF64>,
    pub dividend_yield:     Option<MetricF64>,
    pub eps:                Option<MetricF64>,
    pub roe:                Option<MetricF64>,
    pub gross_margins:      Option<MetricF64>,
    pub operating_margins:  Option<MetricF64>,
    pub profit_margins:     Option<MetricF64>,
    pub revenue_growth:     Option<MetricF64>,
    pub earnings_growth:    Option<MetricF64>,
    pub current_ratio:      Option<MetricF64>,
    pub quick_ratio:        Option<MetricF64>,
    pub debt_to_equity:     Option<MetricF64>,
    pub free_cashflow:      Option<MetricF64>,
    pub operating_cashflow: Option<MetricF64>,
    pub net_income:         Option<MetricF64>,
    pub market_cap:         Option<MetricF64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StockData {
    pub ohlcv: OhlcvData,
    pub info: StockInfo,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct NewsItem {
    pub title: String,
    pub link: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TwFundamental {
    pub pe: Option<f64>,
    pub pb: Option<f64>,
    pub yield_rate: Option<f64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BatchQuote {
    pub symbol: String,
    pub name: String,
    pub close: f64,
    pub change_pct: f64,
}
