use serde::{Deserialize, Serialize};

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
    pub symbol: String,
    pub name: String,
    pub sector: Option<String>,
    pub industry: Option<String>,
    pub current_price: Option<f64>,
    pub previous_close: Option<f64>,
    pub pe: Option<f64>,
    pub forward_pe: Option<f64>,
    pub pb: Option<f64>,
    pub dividend_yield: Option<f64>,
    pub eps: Option<f64>,
    pub roe: Option<f64>,
    pub gross_margins: Option<f64>,
    pub operating_margins: Option<f64>,
    pub profit_margins: Option<f64>,
    pub revenue_growth: Option<f64>,
    pub earnings_growth: Option<f64>,
    pub current_ratio: Option<f64>,
    pub quick_ratio: Option<f64>,
    pub debt_to_equity: Option<f64>,
    pub free_cashflow: Option<f64>,
    pub operating_cashflow: Option<f64>,
    pub net_income: Option<f64>,
    pub market_cap: Option<f64>,
    pub long_business_summary: Option<String>,
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
