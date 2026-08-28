import { useState, useEffect, useCallback } from "react";
import { newsService, NewsItem } from "../services/newsService";

export function useStockNews(query?: string) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(async (targetQuery: string) => {
    if (!targetQuery || !targetQuery.trim()) {
      setNews([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const items = await newsService.getNews(targetQuery);
      setNews(items);
      setLoading(false);
    } catch (e: any) {
      setError(typeof e === "string" ? e : e?.message || "取得新聞失敗");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (query) {
      fetchNews(query);
    }
  }, [query, fetchNews]);

  return { news, loading, error, fetchNews };
}
