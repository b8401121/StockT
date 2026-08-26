use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

// ─── 資料結構 ─────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PortfolioEntry {
    pub symbol: String,
    #[serde(default)]
    pub date: String,
    #[serde(default)]
    pub price: f64,
    #[serde(default)]
    pub shares: i64,
    #[serde(default)]
    pub sell_price: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PnlResult {
    pub net_cost: f64,
    pub net_market_value: f64,
    pub pnl: f64,
    pub pnl_pct: f64,
    pub buy_fee: f64,
    pub sell_fee: f64,
    pub tax: f64,
}

// ─── 台股損益計算 ─────────────────────────────────────────────────────────────

/// 計算台股損益，考慮手續費 (0.1425%) 及交易稅 (個股 0.3% / ETF 0.1%)
#[tauri::command]
pub fn calculate_tw_pnl(
    symbol: String,
    buy_price: f64,
    current_price: f64,
    shares: i64,
    fee_discount: f64,
) -> Result<PnlResult, String> {
    if buy_price <= 0.0 || shares <= 0 || current_price <= 0.0 {
        return Ok(PnlResult {
            net_cost: 0.0,
            net_market_value: 0.0,
            pnl: 0.0,
            pnl_pct: 0.0,
            buy_fee: 0.0,
            sell_fee: 0.0,
            tax: 0.0,
        });
    }

    let raw_cost = buy_price * shares as f64;
    let raw_value = current_price * shares as f64;

    // 判斷是否為台股
    let clean_sym = symbol.split('.').next().unwrap_or(&symbol);
    let is_tw = symbol.ends_with(".TW")
        || symbol.ends_with(".TWO")
        || clean_sym.chars().all(|c| c.is_ascii_digit());

    if !is_tw {
        let pnl = raw_value - raw_cost;
        let pnl_pct = if raw_cost > 0.0 { pnl / raw_cost * 100.0 } else { 0.0 };
        return Ok(PnlResult {
            net_cost: raw_cost,
            net_market_value: raw_value,
            pnl,
            pnl_pct,
            buy_fee: 0.0,
            sell_fee: 0.0,
            tax: 0.0,
        });
    }

    // 買入手續費
    let buy_fee = if fee_discount == 0.0 {
        0.0
    } else {
        let f = (raw_cost * 0.001425 * fee_discount).floor();
        if f < 20.0 && raw_cost > 0.0 { 20.0 } else { f }
    };

    // 賣出手續費
    let sell_fee = if fee_discount == 0.0 {
        0.0
    } else {
        let f = (raw_value * 0.001425 * fee_discount).floor();
        if f < 20.0 && raw_value > 0.0 { 20.0 } else { f }
    };

    // 交易稅 (ETF 0.1%, 個股 0.3%)
    let is_etf = clean_sym.starts_with("00");
    let tax_rate = if is_etf { 0.001 } else { 0.003 };
    let tax = (raw_value * tax_rate).floor();

    let net_cost = raw_cost + buy_fee;
    let net_market_value = raw_value - sell_fee - tax;
    let pnl = net_market_value - net_cost;
    let pnl_pct = if net_cost > 0.0 { pnl / net_cost * 100.0 } else { 0.0 };

    Ok(PnlResult {
        net_cost,
        net_market_value,
        pnl,
        pnl_pct,
        buy_fee,
        sell_fee,
        tax,
    })
}

// ─── Watchlist 管理 ───────────────────────────────────────────────────────────

fn get_watchlist_path(app: &AppHandle, filename: Option<String>) -> PathBuf {
    let mut path = PathBuf::from("D:\\Sam\\script\\StockT");
    if !path.exists() {
        let linux_path = PathBuf::from("/home/sam/文件/script/StockT");
        if linux_path.exists() {
            path = linux_path;
        } else {
            #[cfg(target_os = "windows")]
            {
                if let Ok(exe_path) = std::env::current_exe() {
                    path = exe_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
                } else {
                    path = app
                        .path()
                        .app_data_dir()
                        .unwrap_or_else(|_| PathBuf::from("."));
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                path = app
                    .path()
                    .app_data_dir()
                    .unwrap_or_else(|_| PathBuf::from("."));
            }
        }
    }
    fs::create_dir_all(&path).ok();
    
    let name = filename.unwrap_or_else(|| "李山任的清單".to_string());
    let safe_name = if name == "watchlist" {
        "watchlist.json".to_string()
    } else {
        if name.starts_with("watchlist_") {
            if name.ends_with(".json") { name } else { format!("{}.json", name) }
        } else {
            format!("watchlist_{}.json", name)
        }
    };
    let safe_name = safe_name.replace("/", "").replace("\\", "");
    
    let mut target_file = path.clone();
    target_file.push(&safe_name);
    
    // 自動移轉舊版資料
    if !target_file.exists() {
        let mut old_file = PathBuf::from("D:\\Sam\\script\\stock");
        old_file.push(&safe_name);
        if old_file.exists() {
            fs::copy(&old_file, &target_file).ok();
        }
    }
    
    target_file
}

#[tauri::command]
pub fn list_watchlists(app: AppHandle) -> Result<Vec<String>, String> {
    let mut path = PathBuf::from("D:\\Sam\\script\\StockT");
    if !path.exists() {
        let linux_path = PathBuf::from("/home/sam/文件/script/StockT");
        if linux_path.exists() {
            path = linux_path;
        } else {
            #[cfg(target_os = "windows")]
            {
                if let Ok(exe_path) = std::env::current_exe() {
                    path = exe_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
                } else {
                    path = app
                        .path()
                        .app_data_dir()
                        .unwrap_or_else(|_| PathBuf::from("."));
                }
            }
            #[cfg(not(target_os = "windows"))]
            {
                path = app
                    .path()
                    .app_data_dir()
                    .unwrap_or_else(|_| PathBuf::from("."));
            }
        }
    }
    
    // 首次啟動前，若無名單先遷移「李山任的清單」以供載入顯示
    let default_name = "watchlist_李山任的清單.json";
    let mut target_default = path.clone();
    target_default.push(default_name);
    if !target_default.exists() {
        let mut old_default = PathBuf::from("D:\\Sam\\script\\stock");
        old_default.push(default_name);
        if old_default.exists() {
            fs::copy(&old_default, &target_default).ok();
        }
    }
    
    let mut lists = vec!["李山任的清單".to_string()]; // 預設李山任的清單一定有
    
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(name) = entry.file_name().into_string() {
                if name.starts_with("watchlist_") && name.ends_with(".json") {
                    let base = name[10..name.len() - 5].to_string();
                    if !lists.contains(&base) && !base.is_empty() {
                        lists.push(base);
                    }
                } else if name == "watchlist.json" {
                    if !lists.contains(&"watchlist".to_string()) {
                        lists.push("watchlist".to_string());
                    }
                }
            }
        }
    }
    lists.sort();
    Ok(lists)
}

#[tauri::command]
pub fn load_watchlist(app: AppHandle, filename: Option<String>) -> Result<HashMap<String, Vec<PortfolioEntry>>, String> {
    let path = get_watchlist_path(&app, filename);
    if !path.exists() {
        return Ok(HashMap::new());
    }
    let data = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    // 嘗試解析新格式（dict of list of PortfolioEntry），若失敗嘗試舊格式
    if let Ok(result) = serde_json::from_str::<HashMap<String, Vec<PortfolioEntry>>>(&data) {
        return Ok(result);
    }
    // 舊格式：dict of list of string
    if let Ok(old) = serde_json::from_str::<HashMap<String, Vec<String>>>(&data) {
        let mut new_map: HashMap<String, Vec<PortfolioEntry>> = HashMap::new();
        for (cat, symbols) in old {
            new_map.insert(
                cat,
                symbols.iter().map(|s| PortfolioEntry {
                    symbol: s.clone(),
                    date: String::new(),
                    price: 0.0,
                    shares: 0,
                    sell_price: 0.0,
                }).collect(),
            );
        }
        return Ok(new_map);
    }
    Ok(HashMap::new())
}

#[tauri::command]
pub fn save_watchlist(
    app: AppHandle,
    watchlist: HashMap<String, Vec<PortfolioEntry>>,
    filename: Option<String>
) -> Result<(), String> {
    let path = get_watchlist_path(&app, filename);
    let data = serde_json::to_string_pretty(&watchlist).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_watchlist(app: AppHandle, filename: String) -> Result<(), String> {
    let path = get_watchlist_path(&app, Some(filename));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 取得股票代碼對應的產業分類
#[tauri::command]
pub fn get_category_by_symbol(symbol: String) -> String {
    let code = symbol.split('.').next().unwrap_or(&symbol);
    if !code.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false) {
        return "美股/其他".to_string();
    }
    let prefix2 = &code[..code.len().min(2)];
    if code.starts_with("00") { return "ETF / 指數基金".to_string(); }
    match prefix2 {
        "11" | "12" | "13" | "14" | "15" | "16" => "水泥/食品/紡織".to_string(),
        "17" | "18" | "19" => "化學/玻璃/鋼鐵".to_string(),
        "20" | "21" | "22" | "23" | "24" | "25" | "26" | "27" | "28" | "29" => "機械/電工/金融".to_string(),
        "30" | "31" | "32" | "33" | "34" | "35" | "36" => "建造/資服/半導體".to_string(),
        "37" | "38" => "光電/網路/通信".to_string(),
        "41" | "42" | "43" | "44" | "45" | "46" | "47" | "48" | "49" => "電子零組件/各類".to_string(),
        "50" | "52" | "53" | "54" | "55" | "56" | "57" | "58" | "59" => "服務/觀光/貿易".to_string(),
        "60" | "61" | "62" | "63" | "64" | "65" | "66" | "67" | "68" | "69" => "其他/小型股".to_string(),
        _ => {
            let n: u32 = prefix2.parse().unwrap_or(0);
            if n >= 80 { "生技/電子/其他".to_string() } else { "自選/其他".to_string() }
        }
    }
}

#[tauri::command]
pub fn export_txt_file(
    app: AppHandle,
    filename: String,
    content: String,
) -> Result<String, String> {
    let mut path = app.path().download_dir().map_err(|e| e.to_string())?;
    path.push(&filename);
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

