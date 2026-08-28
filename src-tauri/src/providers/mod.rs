pub mod yahoo;
pub mod twse;
pub mod tpex;
pub mod news;

use reqwest::Client;
use std::time::Duration;

pub const APP_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

pub fn make_client() -> Client {
    Client::builder()
        .user_agent(APP_USER_AGENT)
        .timeout(Duration::from_secs(15))
        .build()
        .expect("建立 HTTPS 客戶端失敗")
}

pub fn extract_f64(v: &serde_json::Value) -> Vec<f64> {
    match v.as_array() {
        Some(arr) => arr.iter().map(|x| x.as_f64().unwrap_or(f64::NAN)).collect(),
        None => vec![],
    }
}

pub fn extract_i64(v: &serde_json::Value) -> Vec<i64> {
    match v.as_array() {
        Some(arr) => arr.iter().filter_map(|x| x.as_i64()).collect(),
        None => vec![],
    }
}

pub fn opt_f64(v: &serde_json::Value) -> Option<f64> {
    if v.is_null() { None } else { v.as_f64() }
}

pub fn opt_str(v: &serde_json::Value) -> Option<String> {
    if v.is_null() { None } else { v.as_str().map(|s| s.to_string()) }
}
