use std::collections::HashMap;
use std::sync::OnceLock;
use serde_json::Value;

pub use crate::models::{MetricF64, NewsItem, OhlcvData, StockData, StockInfo, TwFundamental};
use crate::providers::{
    extract_f64, extract_i64, make_client, opt_f64, opt_str,
    news::fetch_google_news,
    tpex::fetch_tpex_peratio,
    twse::fetch_twse_bwibbu,
    yahoo::{
        fetch_tw_business_summary, fetch_yahoo_quote_summary, fetch_yahoo_tw_store,
        get_yahoo_session,
    },
};

/// 取得目前 UTC 時間的 ISO-8601 字串 (用於 MetricF64.fetched_at)
fn now_utc() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // 簡易格式化 YYYY-MM-DDTHH:MM:SSZ
    let s = secs;
    let (year, mon, day, hh, mm, ss) = {
        let mut rem = s;
        let ss = rem % 60; rem /= 60;
        let mm = rem % 60; rem /= 60;
        let hh = rem % 24; rem /= 24;
        // 計算日期 (以 1970-01-01 為基準)
        let mut y: u64 = 1970;
        let mut d = rem;
        loop {
            let days_in_year = if y % 4 == 0 && (y % 100 != 0 || y % 400 == 0) { 366 } else { 365 };
            if d < days_in_year { break; }
            d -= days_in_year;
            y += 1;
        }
        let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
        let months = if leap {
            [31u64,29,31,30,31,30,31,31,30,31,30,31]
        } else {
            [31u64,28,31,30,31,30,31,31,30,31,30,31]
        };
        let mut month: u64 = 1;
        for m in &months {
            if d < *m { break; }
            d -= m;
            month += 1;
        }
        (y, month, d + 1, hh, mm, ss)
    };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", year, mon, day, hh, mm, ss)
}

// ─── 台股代號中文名稱對照表 ───────────────────────────────────────────────────

fn get_chinese_stock_name(symbol: &str) -> Option<String> {
    static CHINESE_NAMES: OnceLock<HashMap<&'static str, &'static str>> = OnceLock::new();
    let map = CHINESE_NAMES.get_or_init(|| {
        let mut m = HashMap::new();
        m.insert("2330.TW", "台積電");
        m.insert("2317.TW", "鴻海");
        m.insert("2454.TW", "聯發科");
        m.insert("2308.TW", "台達電");
        m.insert("2382.TW", "廣達");
        m.insert("2881.TW", "富邦金");
        m.insert("2882.TW", "國泰金");
        m.insert("2412.TW", "中華電");
        m.insert("6505.TW", "台塑化");
        m.insert("1301.TW", "台塑");
        m.insert("1303.TW", "南亞");
        m.insert("2002.TW", "中鋼");
        m.insert("2891.TW", "中信金");
        m.insert("2886.TW", "兆豐金");
        m.insert("3711.TW", "日月光投控");
        m.insert("2357.TW", "華碩");
        m.insert("3231.TW", "緯創");
        m.insert("2379.TW", "瑞昱");
        m.insert("3008.TW", "大立光");
        m.insert("2327.TW", "國巨");
        m
    });
    map.get(symbol).cloned().map(|s| s.to_string())
}

// ─── 取得個股詳細財務報表 (損益表、資產負債表、現金流量表) ────────────────────

#[tauri::command]
pub async fn fetch_detailed_fundamentals(symbol: String) -> Result<Value, String> {
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
            return Ok(Value::Object(merged_store));
        }
    }

    let client = make_client();
    let (cookie_value, crumb) = get_yahoo_session().await?;

    let modules = "incomeStatementHistory,incomeStatementHistoryQuarterly,balanceSheetHistory,balanceSheetHistoryQuarterly,cashflowStatementHistory,cashflowStatementHistoryQuarterly";
    let url = format!("https://query2.finance.yahoo.com/v10/finance/quoteSummary/{}?modules={}&crumb={}", symbol, modules, crumb);
    
    let summary_resp = client.get(&url).header("cookie", &cookie_value).send().await.map_err(|e| e.to_string())?;
    let summary_json = summary_resp.json::<Value>().await.map_err(|e| e.to_string())?;
    Ok(summary_json)
}

// ─── 取得個股 K 線資料 (Yahoo Finance) ────────────────────────────────────────

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
        .json::<Value>()
        .await
        .map_err(|e| format!("無法解析 Yahoo Finance K線 JSON: {}", e))?;

    let result = &chart_res["chart"]["result"][0];
    if result.is_null() {
        let err_msg = chart_res["chart"]["error"]["description"]
            .as_str()
            .unwrap_or("查無此股票資料或代號錯誤");
        return Err(format!("Yahoo Finance 錯誤: {}", err_msg));
    }

    let timestamps = extract_i64(&result["timestamp"]);
    let quote = &result["indicators"]["quote"][0];
    let opens = extract_f64(&quote["open"]);
    let highs = extract_f64(&quote["high"]);
    let lows = extract_f64(&quote["low"]);
    let closes = extract_f64(&quote["close"]);
    let volumes = extract_f64(&quote["volume"]);

    let meta = &result["meta"];
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
        current_price: current_price.map(|v| MetricF64::yahoo(v, &now_utc())),
        previous_close: previous_close.map(|v| MetricF64::yahoo(v, &now_utc())),
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
            let ts = now_utc();

            info.sector = opt_str(&ap["sector"]);
            info.industry = opt_str(&ap["industry"]);
            info.long_business_summary = opt_str(&ap["longBusinessSummary"]);

            info.pe             = opt_f64(&sd["trailingPE"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.forward_pe     = opt_f64(&ks["forwardPE"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.pb             = opt_f64(&ks["priceToBook"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.dividend_yield = opt_f64(&sd["dividendYield"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.eps            = opt_f64(&ks["trailingEps"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.market_cap     = opt_f64(&sd["marketCap"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));

            info.roe               = opt_f64(&fd["returnOnEquity"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.gross_margins     = opt_f64(&fd["grossMargins"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.operating_margins = opt_f64(&fd["operatingMargins"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.profit_margins    = opt_f64(&fd["profitMargins"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.revenue_growth    = opt_f64(&fd["revenueGrowth"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.earnings_growth   = opt_f64(&fd["earningsGrowth"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.current_ratio     = opt_f64(&fd["currentRatio"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.quick_ratio       = opt_f64(&fd["quickRatio"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.debt_to_equity    = opt_f64(&fd["debtToEquity"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.free_cashflow     = opt_f64(&fd["freeCashflow"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            info.operating_cashflow= opt_f64(&fd["operatingCashflow"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));

            if info.current_price.is_none() {
                info.current_price = opt_f64(&fd["currentPrice"]["raw"]).map(|v| MetricF64::yahoo(v, &ts));
            }
        }
    }

    // 補充台股官方估值 (PE/PB/殖利率)
    let co_id = symbol.split('.').next().unwrap_or(&symbol);
    let symbol_upper = symbol.to_uppercase();
    if symbol_upper.ends_with(".TW") || symbol_upper.ends_with(".TWO") {
        if let Some(summary_tw) = fetch_tw_business_summary(&symbol_upper).await {
            info.long_business_summary = Some(summary_tw);
        }
        if let Ok(tw_data) = fetch_tw_fundamentals().await {
            if let Some(fund) = tw_data.get(co_id) {
                let ts = now_utc();
                // 判斷上市/上櫃決定 source
                let tw_src = if symbol_upper.ends_with(".TWO") { "TPEx" } else { "TWSE" };
                let make_tw_metric = |v: f64| MetricF64 {
                    value: v,
                    source: tw_src.to_string(),
                    fetched_at: ts.clone(),
                };
                if info.pe.is_none() {
                    info.pe = fund.pe.map(&make_tw_metric);
                }
                if info.pb.is_none() {
                    info.pb = fund.pb.map(&make_tw_metric);
                }
                if info.dividend_yield.is_none() {
                    info.dividend_yield = fund.yield_rate.map(&make_tw_metric);
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

// ─── 取得個股基本資訊 ─────────────────────────────────────────────────────────

#[tauri::command]
pub async fn fetch_stock_info(symbol: String) -> Result<StockInfo, String> {
    let summary_json = fetch_yahoo_quote_summary(&symbol).await?;
    let qs = &summary_json["quoteSummary"]["result"][0];
    if qs.is_null() {
        return Err(format!("找不到股票基本資訊: {}", symbol));
    }

    let ap = &qs["assetProfile"];
    let fd = &qs["financialData"];
    let ks = &qs["defaultKeyStatistics"];
    let sd = &qs["summaryDetail"];

    let mut name = symbol.clone();
    if let Some(zh_name) = get_chinese_stock_name(&symbol) {
        name = zh_name;
    }

    let ts = now_utc();
    let mut info = StockInfo {
        symbol: symbol.clone(),
        name,
        sector: opt_str(&ap["sector"]),
        industry: opt_str(&ap["industry"]),
        current_price:      opt_f64(&fd["currentPrice"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        previous_close:     opt_f64(&sd["previousClose"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        pe:                 opt_f64(&sd["trailingPE"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        forward_pe:         opt_f64(&ks["forwardPE"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        pb:                 opt_f64(&ks["priceToBook"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        dividend_yield:     opt_f64(&sd["dividendYield"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        eps:                opt_f64(&ks["trailingEps"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        roe:                opt_f64(&fd["returnOnEquity"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        gross_margins:      opt_f64(&fd["grossMargins"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        operating_margins:  opt_f64(&fd["operatingMargins"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        profit_margins:     opt_f64(&fd["profitMargins"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        revenue_growth:     opt_f64(&fd["revenueGrowth"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        earnings_growth:    opt_f64(&fd["earningsGrowth"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        current_ratio:      opt_f64(&fd["currentRatio"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        quick_ratio:        opt_f64(&fd["quickRatio"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        debt_to_equity:     opt_f64(&fd["debtToEquity"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        free_cashflow:      opt_f64(&fd["freeCashflow"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        operating_cashflow: opt_f64(&fd["operatingCashflow"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        net_income:         None,
        market_cap:         opt_f64(&sd["marketCap"]["raw"]).map(|v| MetricF64::yahoo(v, &ts)),
        long_business_summary: opt_str(&ap["longBusinessSummary"]),
    };

    if let Ok(tw_map) = fetch_tw_fundamentals().await {
        let co_id = symbol.split('.').next().unwrap_or(&symbol);
        if let Some(fund) = tw_map.get(co_id) {
            let ts2 = now_utc();
            let tw_src = if symbol.to_uppercase().ends_with(".TWO") { "TPEx" } else { "TWSE" };
            let make_tw = |v: f64| MetricF64 { value: v, source: tw_src.to_string(), fetched_at: ts2.clone() };
            if fund.pe.is_some()         { info.pe             = fund.pe.map(&make_tw); }
            if fund.pb.is_some()         { info.pb             = fund.pb.map(&make_tw); }
            if fund.yield_rate.is_some() { info.dividend_yield = fund.yield_rate.map(&make_tw); }
        }
    }

    if info.long_business_summary.is_none() {
        let co_id = symbol.split('.').next().unwrap_or(&symbol);
        if let Some(summary) = fetch_tw_business_summary(co_id).await {
            info.long_business_summary = Some(summary);
        }
    }

    Ok(info)
}

// ─── 取得 TWSE / TPEx 官方估值快取 ──────────────────────────────────────────

static TW_FUNDAMENTALS_CACHE: OnceLock<std::sync::Mutex<Option<(std::time::Instant, HashMap<String, TwFundamental>)>>> = OnceLock::new();

#[tauri::command]
pub async fn fetch_tw_fundamentals() -> Result<HashMap<String, TwFundamental>, String> {
    let cache_mutex = TW_FUNDAMENTALS_CACHE.get_or_init(|| std::sync::Mutex::new(None));
    {
        if let Ok(guard) = cache_mutex.lock() {
            if let Some((fetched_at, ref data)) = *guard {
                if fetched_at.elapsed().as_secs() < 3600 {
                    return Ok(data.clone());
                }
            }
        }
    }

    let mut map = HashMap::new();

    // 1. TWSE 上市
    if let Ok(twse_map) = fetch_twse_bwibbu().await {
        map.extend(twse_map);
    }

    // 2. TPEx 上櫃
    if let Ok(tpex_map) = fetch_tpex_peratio().await {
        map.extend(tpex_map);
    }

    {
        if let Ok(mut cache) = cache_mutex.lock() {
            *cache = Some((std::time::Instant::now(), map.clone()));
        }
    }

    Ok(map)
}

// ─── 抓取相關新聞 ─────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn fetch_news(query: String) -> Result<Vec<NewsItem>, String> {
    fetch_google_news(&query).await
}

// ─── 批次抓取股票報價 ─────────────────────────────────────────────────────────

async fn fetch_single_stock_data_limited(client: &reqwest::Client, symbol: &str) -> Option<StockData> {
    let url = format!(
        "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=1y&interval=1d",
        symbol
    );
    if let Ok(resp) = client.get(&url).send().await {
        if let Ok(json) = resp.json::<Value>().await {
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
                current_price:      current_price.map(|v| MetricF64::yahoo(v, &now_utc())),
                previous_close:     prev.map(|v| MetricF64::yahoo(v, &now_utc())),
                pe: None, forward_pe: None, pb: None, dividend_yield: None, eps: None,
                roe: None, gross_margins: None, operating_margins: None, profit_margins: None,
                revenue_growth: None, earnings_growth: None, current_ratio: None, quick_ratio: None,
                debt_to_equity: None, free_cashflow: None, operating_cashflow: None,
                net_income: None, market_cap: None, long_business_summary: None,
            };

            return Some(StockData { ohlcv, info });
        }
    }
    None
}

#[tauri::command]
pub async fn fetch_batch_stock_data(symbols: Vec<String>) -> Result<Vec<StockData>, String> {
    use std::sync::Arc;
    let client = Arc::new(make_client());
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
pub async fn get_stock_list(app: tauri::AppHandle) -> Result<Value, String> {
    use tauri::Manager;
    let local_path = app.path().app_data_dir()
        .map(|p| p.join("taiwan_stocks.json"))
        .map_err(|e| e.to_string())?;

    if local_path.exists() {
        if let Ok(content) = std::fs::read_to_string(&local_path) {
            if let Ok(json) = serde_json::from_str::<Value>(&content) {
                return Ok(json);
            }
        }
    }

    // 回退到嵌入的預設清單
    let default_stocks: Value = serde_json::from_str(include_str!("../assets/taiwan_stocks.json"))
        .map_err(|e| format!("解析內建股票資料庫失敗: {}", e))?;
    Ok(default_stocks)
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
    output
}

fn parse_isin_html(html: &str, suffix: &str) -> Vec<Value> {
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
                        if code.len() == 4 && code.chars().all(|c| c.is_ascii_digit()) {
                            let mut obj = serde_json::Map::new();
                            obj.insert("code".to_string(), Value::String(code.to_string()));
                            obj.insert("name".to_string(), Value::String(name));
                            obj.insert("symbol".to_string(), Value::String(format!("{}.{}", code, suffix)));
                            obj.insert("market".to_string(), Value::String(if suffix == "TW" { "上市".to_string() } else { "上櫃".to_string() }));
                            stocks.push(Value::Object(obj));
                        }
                    }
                }
            }
        }
    }
    stocks
}

#[tauri::command]
pub async fn update_stock_list(app: tauri::AppHandle) -> Result<Value, String> {
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

    let final_json = Value::Array(all_stocks);

    let local_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&local_dir).map_err(|e| e.to_string())?;
    let local_path = local_dir.join("taiwan_stocks.json");
    
    if let Ok(serialized) = serde_json::to_string_pretty(&final_json) {
        let _ = std::fs::write(&local_path, serialized);
    }

    Ok(final_json)
}
