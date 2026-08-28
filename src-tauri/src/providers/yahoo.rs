use std::sync::OnceLock;
use serde_json::Value;
use super::make_client;

struct YahooSession {
    cookie: String,
    crumb: String,
    fetched_at: std::time::Instant,
}

static YAHOO_SESSION: OnceLock<tokio::sync::Mutex<Option<YahooSession>>> = OnceLock::new();

pub async fn get_yahoo_session() -> Result<(String, String), String> {
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

pub fn unescape_unicode(input: &str) -> String {
    let mut result = String::new();
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') => result.push('\n'),
                Some('r') => result.push('\r'),
                Some('t') => result.push('\t'),
                Some('"') => result.push('"'),
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

pub async fn fetch_tw_business_summary(co_id: &str) -> Option<String> {
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

pub async fn fetch_yahoo_tw_store(co_id: &str, page: &str) -> Option<Value> {
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
                        while json_end > 0 && (rest.as_bytes()[json_end - 1] == b';' || rest.as_bytes()[json_end - 1] == b'\n' || rest.as_bytes()[json_end - 1] == b'\r' || rest.as_bytes()[json_end - 1] == b' ') {
                            json_end -= 1;
                        }
                        let json_str = &rest[..json_end];
                        let cleaned = json_str.replace(":undefined", ":null").replace(":NaN", ":null");
                        if let Ok(json_val) = serde_json::from_str::<Value>(&cleaned) {
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

pub async fn fetch_yahoo_quote_summary(symbol: &str) -> Result<Value, String> {
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
        
    let summary_json = summary_resp.json::<Value>().await
        .map_err(|e| format!("解析 quoteSummary 失敗: {}", e))?;
        
    Ok(summary_json)
}
