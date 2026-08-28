use crate::models::NewsItem;
use super::make_client;

pub fn extract_xml_tag(text: &str, tag: &str) -> Option<String> {
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

pub async fn fetch_google_news(query: &str) -> Result<Vec<NewsItem>, String> {
    let client = make_client();
    let url = format!(
        "https://news.google.com/rss/search?q={}&hl=zh-TW&gl=TW&ceid=TW:zh-Hant",
        urlencoding::encode(query)
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
