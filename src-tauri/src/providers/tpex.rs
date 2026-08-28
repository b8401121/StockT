use std::collections::HashMap;
use crate::models::TwFundamental;
use super::make_client;

pub async fn fetch_tpex_peratio() -> Result<HashMap<String, TwFundamental>, String> {
    let client = make_client();
    let mut map = HashMap::new();

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

    Ok(map)
}
