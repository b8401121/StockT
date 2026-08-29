// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod models;
mod providers;
mod fetch;
mod portfolio;

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(&url)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            open_url,
            // 資料抓取
            fetch::fetch_stock_data,
            fetch::fetch_tw_fundamentals,
            fetch::fetch_batch_stock_data,
            fetch::fetch_batch_stock_data_full,
            fetch::fetch_news,
            fetch::get_stock_list,
            fetch::update_stock_list,
            fetch::fetch_detailed_fundamentals,
            fetch::fetch_market_overview,
            // 投資組合
            portfolio::load_watchlist,
            portfolio::save_watchlist,
            portfolio::list_watchlists,
            portfolio::calculate_tw_pnl,
            portfolio::get_category_by_symbol,
            portfolio::delete_watchlist,
            portfolio::export_txt_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
