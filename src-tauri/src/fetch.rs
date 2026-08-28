use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

static STOCK_NAMES: OnceLock<HashMap<String, String>> = OnceLock::new();

fn get_chinese_stock_name(symbol: &str) -> Option<String> {
    let map = STOCK_NAMES.get_or_init(|| {
        let mut m = HashMap::new();
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(include_str!("../assets/taiwan_stocks.json")) {
            if let Some(arr) = json.as_array() {
                for item in arr {
                    if let (Some(sym), Some(name)) = (item["symbol"].as_str(), item["name"].as_str()) {
                        m.insert(sym.to_string(), name.to_string());
                    }
                }
            }
        }
        m
    });
    map.get(symbol).cloned()
}

async fn fetch_yahoo_tw_store(co_id: &str, page: &str) -> Option<serde_json::Value> {
    let client = make_client();
    let url = format!("https://tw.stock.yahoo.com/quote/{}/{}", co_id, page);
    if let Ok(resp) = client.get(&url).send().await {
        if resp.status() == 200 {
            if let Ok(html) = resp.text().await {
                if let Some(start_pos) = html.find("root.App.main = ") {
                    let start_idx = start_pos + "root.App.main = ".len();
                    let rest = &html[start_idx..];
                    if let Some(end_pos) = rest.find("}(this));") {
                        let mut json_end = end_pos;
                        // trim trailing semicolons or whitespace
                        while json_end > 0 && (rest.as_bytes()[json_end - 1] == b';' || rest.as_bytes()[json_end - 1] == b'\n' || rest.as_bytes()[json_end - 1] == b'\r' || rest.as_bytes()[json_end - 1] == b' ') {
                            json_end -= 1;
                        }
                        let json_str = &rest[..json_end];
                        let cleaned = json_str.replace(":undefined", ":null").replace(":NaN", ":null");
                        if let Ok(json_val) = serde_json::from_str::<serde_json::Value>(&cleaned) {
                            if let Some(store) = json_val
                                .get("context")
                                .and_then(|c| c.get("dispatcher"))
                                .and_then(|d| d.get("stores"))
                                .and_then(|s| s.get("QuoteFinanceStore"))
                            {
                                return Some(store.clone());
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

// ─── 回傳資料結構 ─────────────────────────────────────────────────────────────

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

// ─── 輔助函數 ─────────────────────────────────────────────────────────────────

fn make_client() -> Client {
    Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .expect("建立 HTTPS 客戶端失敗")
}

fn extract_f64(v: &serde_json::Value) -> Vec<f64> {
    match v.as_array() {
        Some(arr) => arr.iter().map(|x| x.as_f64().unwrap_or(f64::NAN)).collect(),
        None => vec![],
    }
}

fn extract_i64(v: &serde_json::Value) -> Vec<i64> {
    match v.as_array() {
        Some(arr) => arr.iter().filter_map(|x| x.as_i64()).collect(),
        None => vec![],
    }
}

fn opt_f64(v: &serde_json::Value) -> Option<f64> {
    if v.is_null() { None } else { v.as_f64() }
}

fn opt_str(v: &serde_json::Value) -> Option<String> {
    if v.is_null() { None } else { v.as_str().map(|s| s.to_string()) }
}

fn unescape_unicode(input: &str) -> String {
    let mut result = String::new();
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => result.push('\n'),
                Some('r') => result.push('\r'),
                Some('t') => result.push('\t'),
                Some('\"') => result.push('\"'),
                Some('\\') => result.push('\\'),
                Some('u') => {
                    let mut hex = String::new();
                    for _ in 0..4 {
                        if let Some(&h) = chars.peek() {
                            if h.is_ascii_hexdigit() {
                                hex.push(chars.next().unwrap());
                            } else {
                                break;
                            }
                        }
                    }
                    if hex.len() == 4 {
                        if let Ok(val) = u32::from_str_radix(&hex, 16) {
                            if let Some(unicode_char) = std::char::from_u32(val) {
                                result.push(unicode_char);
                                continue;
                            }
                        }
                    }
                    result.push_str("\\u");
                    result.push_str(&hex);
                }
                Some(other) => {
                    result.push('\\');
                    result.push(other);
                }
                None => {
                    result.push('\\');
                }
            }
        } else {
            result.push(c);
        }
    }
    result
}

async fn fetch_tw_business_summary(co_id: &str) -> Option<String> {
    let client = make_client();
    let url = format!("https://tw.stock.yahoo.com/quote/{}/profile", co_id);
    
    if let Ok(resp) = client.get(&url).send().await {
        if resp.status() == 200 {
            if let Ok(html) = resp.text().await {
                if let Some(pos) = html.find("\"business\":\"") {
                    let start = pos + 12;
                    let rest = &html[start..];
                    if let Some(end) = rest.find('"') {
                        let raw_desc = &rest[..end];
                        let decoded = unescape_unicode(raw_desc);
                        return Some(decoded);
                    }
                }
            }
        }
    }
    None
}

// ─── Yahoo Finance Cookie & Crumb 取得 ────────────────────────────────────────

struct YahooSession {
    cookie: String,
    crumb: String,
    fetched_at: std::time::Instant,
}

static YAHOO_SESSION: OnceLock<tokio::sync::Mutex<Option<YahooSession>>> = OnceLock::new();

async fn get_yahoo_session() -> Result<(String, String), String> {
    let lock = YAHOO_SESSION.get_or_init(|| tokio::sync::Mutex::new(None));
    let mut session_guard = lock.lock().await;
    
    if let Some(session) = &*session_guard {
        if session.fetched_at.elapsed() < std::time::Duration::from_secs(1800) {
            return Ok((session.cookie.clone(), session.crumb.clone()));
        }
    }
    
    let client = make_client();
    let fc_resp = client.get("https://fc.yahoo.com")
        .send()
        .await
        .map_err(|e| format!("連線 fc.yahoo.com 失敗: {}", e))?;
    
    let mut cookie_value = String::new();
    if let Some(cookie_header) = fc_resp.headers().get("set-cookie") {
        if let Ok(cookie_str) = cookie_header.to_str() {
            if let Some(first_part) = cookie_str.split(';').next() {
                cookie_value = first_part.to_string();
            }
        }
    }
    
    if cookie_value.is_empty() {
        return Err("Yahoo Finance 未回傳有效 Session Cookie，請檢查網路連線或稍後重試".to_string());
    }

    let crumb_url = "https://query2.finance.yahoo.com/v1/test/getcrumb";
    let crumb_resp = client.get(crumb_url)
        .header("cookie", &cookie_value)
        .send()
        .await
        .map_err(|e| format!("取得 Yahoo Crumb 失敗: {}", e))?;
    
    let crumb = crumb_resp.text().await
        .map_err(|e| format!("讀取 Crumb 失敗: {}", e))?
        .trim()
        .to_string();

    if crumb.is_empty() {
        return Err("取得的 Yahoo Crumb 為空".to_string());
    }

    let session = YahooSession {
        cookie: cookie_value.clone(),
        crumb: crumb.clone(),
        fetched_at: std::time::Instant::now(),
    };
    *session_guard = Some(session);

    Ok((cookie_value, crumb))
}

async fn fetch_yahoo_quote_summary(symbol: &str) -> Result<serde_json::Value, String> {
    let client = make_client();
    let (cookie_value, crumb) = get_yahoo_session().await?;

    let summary_url = format!(
        "https://query2.finance.yahoo.com/v10/finance/quoteSummary/{}?modules=assetProfile,financialData,defaultKeyStatistics,summaryDetail,earnings&crumb={}",
        symbol, crumb
    );
    
    let summary_resp = client.get(&summary_url)
        .header("cookie", &cookie_value)
        .send()
        .await
        .map_err(|e| format!("連線 quoteSummary 失敗: {}", e))?;
        
    let summary_json = summary_resp.json::<serde_json::Value>().await
        .map_err(|e| format!("解析 quoteSummary 失敗: {}", e))?;
        
    Ok(summary_json)
}

#[tauri::command]
pub async fn fetch_detailed_fundamentals(symbol: String) -> Result<serde_json::Value, String> {
    let co_id = symbol.split('.').next().unwrap_or(&symbol).to_string();
    let is_tw = symbol.ends_with(".TW") || symbol.ends_with(".TWO") || co_id.chars().all(|c| c.is_ascii_digit());

    if is_tw {
        let mut merged_store = serde_json::Map::new();
        for page in &["income-statement", "balance-sheet", "cash-flow-statement"] {
            if let Some(store) = fetch_yahoo_tw_store(&co_id, page).await {
                if let Some(obj) = store.as_object() {
                    for (k, v) in obj {
                        let is_new_val_populated = v.get("data")
                            .and_then(|d| d.as_array())
                            .map(|arr| !arr.is_empty())
                            .unwrap_or(false);
                            
                        let is_existing_val_populated = merged_store.get(k)
                            .and_then(|d| d.get("data"))
                            .and_then(|d| d.as_array())
                            .map(|arr| !arr.is_empty())
                            .unwrap_or(false);

                        if is_new_val_populated || !is_existing_val_populated {
                            merged_store.insert(k.clone(), v.clone());
                        }
                    }
                }
            }
        }
        if !merged_store.is_empty() {
            return Ok(serde_json::Value::Object(merged_store));
        }
    }

    let client = make_client();
    let (cookie_value, crumb) = get_yahoo_session().await.map_err(|e| e.to_string())?;

    let modules = "incomeStatementHistory,incomeStatementHistoryQuarterly,balanceSheetHistory,balanceSheetHistoryQuarterly,cashflowStatementHistory,cashflowStatementHistoryQuarterly";
    let url = format!("https://query2.finance.yahoo.com/v10/finance/quoteSummary/{}?modules={}&crumb={}", symbol, modules, crumb);
    
    let summary_resp = client.get(&url).header("cookie", &cookie_value).send().await.map_err(|e| e.to_string())?;
    let summary_json = summary_resp.json::<serde_json::Value>().await.map_err(|e| e.to_string())?;
    Ok(summary_json)
}

// ─── 取得個股 K 線資料 (Yahoo Finance) ───────────────────────────────────────────────────────────────

/// 抓取單一股票的 OHLCV 歷史資料與基本資訊
#[tauri::command]
pub async fn fetch_stock_data(symbol: String, range: String) -> Result<StockData, String> {
    let client = make_client();

    // ① 抓取歷史K線
    let chart_url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?range={}&interval=1d&includeAdjustedClose=true",
        symbol, range
    );

    let chart_res = client
        .get(&chart_url)
        .send()
        .await
        .map_err(|e| format!("無法連線 Yahoo Finance: {}", e))?
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("解析回應失敗: {}", e))?;

    let result = &chart_res["chart"]["result"][0];
    if result.is_null() {
        return Err(format!("找不到股票代碼: {}", symbol));
    }

    let timestamps = extract_i64(&result["timestamp"]);
    let quote = &result["indicators"]["quote"][0];
    let opens = extract_f64(&quote["open"]);
    let highs = extract_f64(&quote["high"]);
    let lows = extract_f64(&quote["low"]);
    let closes = extract_f64(&quote["close"]);
    let volumes = extract_f64(&quote["volume"]);

    let meta = &result["meta"];
    let _currency_symbol = meta["currency"].as_str().unwrap_or("$").to_string();
    let current_price = meta["regularMarketPrice"].as_f64();
    let previous_close = meta["chartPreviousClose"].as_f64();
    let mut long_name = meta.get("longName")
        .and_then(|v| v.as_str())
        .or_else(|| meta.get("shortName").and_then(|v| v.as_str()))
        .unwrap_or(&symbol)
        .to_string();

    if let Some(zh_name) = get_chinese_stock_name(&symbol) {
        long_name = zh_name;
    }

    // ② 抓取基本面 (使用 crumb 機制呼叫 quoteSummary)
    let mut info = StockInfo {
        symbol: symbol.clone(),
        name: long_name,
        sector: None,
        industry: None,
        current_price,
        previous_close,
        pe: None,
        forward_pe: None,
        pb: None,
        dividend_yield: None,
        eps: None,
        roe: None,
        gross_margins: None,
        operating_margins: None,
        profit_margins: None,
        revenue_growth: None,
        earnings_growth: None,
        current_ratio: None,
        quick_ratio: None,
        debt_to_equity: None,
        free_cashflow: None,
        operating_cashflow: None,
        net_income: None,
        market_cap: None,
        long_business_summary: None,
    };

    if let Ok(json) = fetch_yahoo_quote_summary(&symbol).await {
        let qs = &json["quoteSummary"]["result"][0];
        if !qs.is_null() {
            let ap = &qs["assetProfile"];
            let fd = &qs["financialData"];
            let ks = &qs["defaultKeyStatistics"];
            let sd = &qs["summaryDetail"];

            info.sector = opt_str(&ap["sector"]);
            info.industry = opt_str(&ap["industry"]);
            info.long_business_summary = opt_str(&ap["longBusinessSummary"]);

            info.pe = opt_f64(&sd["trailingPE"]["raw"]);
            info.forward_pe = opt_f64(&ks["forwardPE"]["raw"]);
            info.pb = opt_f64(&ks["priceToBook"]["raw"]);
            info.dividend_yield = opt_f64(&sd["dividendYield"]["raw"]);
            info.eps = opt_f64(&ks["trailingEps"]["raw"]);
            info.market_cap = opt_f64(&sd["marketCap"]["raw"]);

            info.roe = opt_f64(&fd["returnOnEquity"]["raw"]);
            info.gross_margins = opt_f64(&fd["grossMargins"]["raw"]);
            info.operating_margins = opt_f64(&fd["operatingMargins"]["raw"]);
            info.profit_margins = opt_f64(&fd["profitMargins"]["raw"]);
            info.revenue_growth = opt_f64(&fd["revenueGrowth"]["raw"]);
            info.earnings_growth = opt_f64(&fd["earningsGrowth"]["raw"]);
            info.current_ratio = opt_f64(&fd["currentRatio"]["raw"]);
            info.quick_ratio = opt_f64(&fd["quickRatio"]["raw"]);
            info.debt_to_equity = opt_f64(&fd["debtToEquity"]["raw"]);
            info.free_cashflow = opt_f64(&fd["freeCashflow"]["raw"]);
            info.operating_cashflow = opt_f64(&fd["operatingCashflow"]["raw"]);

            if info.current_price.is_none() {
                info.current_price = opt_f64(&fd["currentPrice"]["raw"]);
            }
        }
    }

    // ③ 對於台股，優先抓取中文業務簡介與備用整合台灣 OpenAPI 最新估值 (PE/PB/殖利率)
    let co_id = symbol.split('.').next().unwrap_or(&symbol);
    let symbol_upper = symbol.to_uppercase();
    if symbol_upper.ends_with(".TW") || symbol_upper.ends_with(".TWO") {
        if let Some(summary_tw) = fetch_tw_business_summary(&symbol_upper).await {
            info.long_business_summary = Some(summary_tw);
        }
        if let Ok(tw_data) = fetch_tw_fundamentals().await {
            if let Some(fund) = tw_data.get(co_id) {
                if info.pe.is_none() {
                    info.pe = fund.pe;
                }
                if info.pb.is_none() {
                    info.pb = fund.pb;
                }
                if info.dividend_yield.is_none() {
                    info.dividend_yield = fund.yield_rate;
                }
            }
        }
    }

    let ohlcv = OhlcvData {
        timestamp: timestamps,
        open: opens,
        high: highs,
        low: lows,
        close: closes,
        volume: volumes,
    };

    Ok(StockData { ohlcv, info })
}

static TW_FUNDAMENTALS_CACHE: OnceLock<std::sync::Mutex<Option<(std::time::Instant, HashMap<String, TwFundamental>)>>> = OnceLock::new();

/// 抓取台灣證交所與櫃買中心的基本面資料 (PE/PB/殖利率)
#[tauri::command]
pub async fn fetch_tw_fundamentals() -> Result<HashMap<String, TwFundamental>, String> {
    let cache_mutex = TW_FUNDAMENTALS_CACHE.get_or_init(|| std::sync::Mutex::new(None));
    {
        if let Ok(cache) = cache_mutex.lock() {
            if let Some((fetched_at, data)) = &*cache {
                if fetched_at.elapsed().as_secs() < 3600 {
                    return Ok(data.clone());
                }
            }
        }
    }

    let mut map = HashMap::new();
    let client = make_client();

    // TWSE 上市
    if let Ok(res) = client
        .get("https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL")
        .send()
        .await
    {
        if let Ok(json) = res.json::<Vec<serde_json::Value>>().await {
            for item in json {
                if let Some(code) = item["Code"].as_str() {
                    let pe = item["PEratio"].as_str()
                        .and_then(|s| s.replace(',', "").parse::<f64>().ok());
                    let pb = item["PBratio"].as_str()
                        .and_then(|s| s.replace(',', "").parse::<f64>().ok());
                    let yr = item["DividendYield"].as_str()
                        .and_then(|s| s.replace(',', "").parse::<f64>().ok())
                        .map(|v| v / 100.0);
                    map.insert(code.to_string(), TwFundamental { pe, pb, yield_rate: yr });
                }
            }
        }
    }

    // TPEx 上櫃
    if let Ok(res) = client
        .get("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis")
        .send()
        .await
    {
        if let Ok(json) = res.json::<Vec<serde_json::Value>>().await {
            for item in json {
                if let Some(code) = item["SecuritiesCompanyCode"].as_str() {
                    let pe = item["PERatio"].as_str()
                        .and_then(|s| s.replace(',', "").parse::<f64>().ok());
                    let pb = item["PriceBookRatio"].as_str()
                        .and_then(|s| s.replace(',', "").parse::<f64>().ok());
                    let yr = item["DividendYield"].as_str()
                        .and_then(|s| s.replace(',', "").parse::<f64>().ok())
                        .map(|v| v / 100.0);
                    map.insert(code.to_string(), TwFundamental { pe, pb, yield_rate: yr });
                }
            }
        }
    }

    {
        if let Ok(mut cache) = cache_mutex.lock() {
            *cache = Some((std::time::Instant::now(), map.clone()));
        }
    }

    Ok(map)
}

/// 抓取相關新聞 (Google News RSS)
#[tauri::command]
pub async fn fetch_news(query: String) -> Result<Vec<NewsItem>, String> {
    let client = make_client();
    let url = format!(
        "https://news.google.com/rss/search?q={}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
        urlencoding::encode(&query)
    );

    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let mut items = vec![];
    // 使用簡單的字串解析找到 <item> 區塊
    for chunk in res.split("<item>").skip(1).take(8) {
        let title = extract_xml_tag(chunk, "title")
            .unwrap_or_default()
            .split(" - ")
            .next()
            .unwrap_or_default()
            .replace("<![CDATA[", "")
            .replace("]]>", "")
            .trim()
            .to_string();

        let link = extract_xml_tag(chunk, "link").unwrap_or_default();

        if !title.is_empty() && !link.is_empty() {
            items.push(NewsItem { title, link });
        }
    }

    Ok(items)
}

fn extract_xml_tag(text: &str, tag: &str) -> Option<String> {
    let open = format!("<{}>", tag);
    let close = format!("</{}>", tag);
    let start = text.find(&open)? + open.len();
    let end = text.find(&close)?;
    if start < end {
        Some(text[start..end].to_string())
    } else {
        None
    }
}

async fn fetch_single_stock_data_limited(client: &Client, symbol: &str) -> Option<StockData> {
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=1y&interval=1d",
        symbol
    );
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(json) = resp.json::<serde_json::Value>().await {
            let result = &json["chart"]["result"][0];
            if result.is_null() { return None; }

            let timestamps = extract_i64(&result["timestamp"]);
            let quote = &result["indicators"]["quote"][0];
            let opens = extract_f64(&quote["open"]);
            let highs = extract_f64(&quote["high"]);
            let lows = extract_f64(&quote["low"]);
            let closes = extract_f64(&quote["close"]);
            let volumes = extract_f64(&quote["volume"]);
            let meta = &result["meta"];
            let current_price = meta["regularMarketPrice"].as_f64();
            let mut long_name = meta.get("longName")
                .and_then(|v| v.as_str())
                .or_else(|| meta.get("shortName").and_then(|v| v.as_str()))
                .unwrap_or(symbol)
                .to_string();

            if let Some(zh_name) = get_chinese_stock_name(symbol) {
                long_name = zh_name;
            }
            let prev = meta["chartPreviousClose"].as_f64();

            let ohlcv = OhlcvData {
                timestamp: timestamps,
                open: opens,
                high: highs,
                low: lows,
                close: closes,
                volume: volumes,
            };

            let info = StockInfo {
                symbol: symbol.to_string(),
                name: long_name,
                sector: None,
                industry: None,
                current_price,
                previous_close: prev,
                pe: None,
                forward_pe: None,
                pb: None,
                dividend_yield: None,
                eps: None,
                roe: None,
                gross_margins: None,
                operating_margins: None,
                profit_margins: None,
                revenue_growth: None,
                earnings_growth: None,
                current_ratio: None,
                quick_ratio: None,
                debt_to_equity: None,
                free_cashflow: None,
                operating_cashflow: None,
                net_income: None,
                market_cap: None,
                long_business_summary: None,
            };

            return Some(StockData { ohlcv, info });
        }
    }
    None
}

/// 批次抓取股票最新報價 (用於選股器)
#[tauri::command]
pub async fn fetch_batch_stock_data(symbols: Vec<String>) -> Result<Vec<StockData>, String> {
    use std::sync::Arc;
    let client = make_client();
    let client = Arc::new(client);
    let semaphore = Arc::new(tokio::sync::Semaphore::new(8));
    let mut tasks = vec![];

    for symbol in symbols {
        let client = client.clone();
        let semaphore = semaphore.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = semaphore.acquire().await.ok();
            fetch_single_stock_data_limited(&client, &symbol).await
        }));
    }

    let mut results = vec![];
    for task in tasks {
        if let Ok(Some(data)) = task.await {
            results.push(data);
        }
    }

    Ok(results)
}

/// 批次抓取股票 K 線與完整基本面資料
#[tauri::command]
pub async fn fetch_batch_stock_data_full(symbols: Vec<String>, range: String) -> Result<Vec<StockData>, String> {
    use std::sync::Arc;
    let semaphore = Arc::new(tokio::sync::Semaphore::new(6));
    let mut tasks = vec![];

    let _ = fetch_tw_fundamentals().await;
    let _ = get_yahoo_session().await;

    for symbol in symbols {
        let semaphore = semaphore.clone();
        let r = range.clone();
        tasks.push(tokio::spawn(async move {
            let _permit = semaphore.acquire().await.ok();
            fetch_stock_data(symbol, r).await
        }));
    }

    let mut results = vec![];
    for task in tasks {
        if let Ok(Ok(data)) = task.await {
            results.push(data);
        }
    }

    Ok(results)
}

// ─── 股票清單取得與更新 ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_stock_list(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let local_path = app.path().app_data_dir()
        .map(|p| p.join("taiwan_stocks.json"))
        .map_err(|e| e.to_string())?;

    if local_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&local_path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                return Ok(json);
            }
        }
    }

    // 回退到嵌入的預設清單
    let default_stocks: serde_json::Value = serde_json::from_str(include_str!("../assets/taiwan_stocks.json"))
        .map_err(|e| format!("解析內建股票資料庫失敗: {}", e))?;
    Ok(default_stocks)
}

#[tauri::command]
pub async fn update_stock_list(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    let client = make_client();
    
    // 1. 下載上市清單 (Mode 2)
    let url_twse = "https://isin.twse.com.tw/isin/C_public.jsp?strMode=2";
    let resp_twse = client.get(url_twse).send().await
        .map_err(|e| format!("取得上市清單失敗: {}", e))?;
    let bytes_twse = resp_twse.bytes().await
        .map_err(|e| format!("讀取上市清單失敗: {}", e))?;
    
    let (decoded_twse, _, _) = encoding_rs::BIG5.decode(&bytes_twse);
    let twse_stocks = parse_isin_html(&decoded_twse, "TW");

    // 2. 下載上櫃清單 (Mode 4)
    let url_tpex = "https://isin.twse.com.tw/isin/C_public.jsp?strMode=4";
    let resp_tpex = client.get(url_tpex).send().await
        .map_err(|e| format!("取得上櫃清單失敗: {}", e))?;
    let bytes_tpex = resp_tpex.bytes().await
        .map_err(|e| format!("讀取上櫃清單失敗: {}", e))?;
    
    let (decoded_tpex, _, _) = encoding_rs::BIG5.decode(&bytes_tpex);
    let tpex_stocks = parse_isin_html(&decoded_tpex, "TWO");

    let mut all_stocks = twse_stocks;
    all_stocks.extend(tpex_stocks);

    if all_stocks.is_empty() {
        return Err("下載失敗：未取得任何股票資料，請檢查網路連線。".to_string());
    }

    // 3. 儲存至本地應用程式目錄
    let local_dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?;
    
    std::fs::create_dir_all(&local_dir)
        .map_err(|e| format!("無法建立應用程式資料夾: {}", e))?;
        
    let local_path = local_dir.join("taiwan_stocks.json");
    let content = serde_json::to_string_pretty(&all_stocks)
        .map_err(|e| e.to_string())?;
        
    std::fs::write(&local_path, content)
        .map_err(|e| format!("儲存股票清單失敗: {}", e))?;

    Ok(serde_json::json!({
        "status": "success",
        "count": all_stocks.len()
    }))
}

fn parse_isin_html(html: &str, suffix: &str) -> Vec<serde_json::Value> {
    let mut stocks = Vec::new();
    for tr_part in html.split("<tr") {
        if tr_part.is_empty() {
            continue;
        }
        if let Some(td_start) = tr_part.find("<td") {
            let td_content_part = &tr_part[td_start..];
            if let Some(td_close_start) = td_content_part.find('>') {
                let td_inner_part = &td_content_part[td_close_start + 1..];
                if let Some(td_end) = td_inner_part.find("</td>") {
                    let text = &td_inner_part[..td_end];
                    let cleaned = clean_html(text);
                    let cleaned_trimmed = cleaned.trim();
                    let parts: Vec<&str> = cleaned_trimmed.split(|c| c == ' ' || c == '　').collect();
                    if parts.len() >= 2 {
                        let code = parts[0].trim();
                        let name = parts[1..].join(" ").trim().to_string();
                        if code.len() >= 4 && code.chars().all(|c| c.is_alphanumeric()) {
                            stocks.push(serde_json::json!({
                                "symbol": format!("{}.{}", code, suffix),
                                "name": name
                            }));
                        }
                    }
                }
            }
        }
    }
    stocks
}

fn clean_html(input: &str) -> String {
    let mut output = String::new();
    let mut in_tag = false;
    for c in input.chars() {
        if c == '<' {
            in_tag = true;
        } else if c == '>' {
            in_tag = false;
        } else if !in_tag {
            output.push(c);
        }
    }
    output.replace("&nbsp;", " ")
}
