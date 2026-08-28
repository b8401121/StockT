import { invoke } from "../utils/platform";

export interface NewsItem {
  title: string;
  link: string;
}

export class NewsService {
  async getNews(query: string): Promise<NewsItem[]> {
    return await invoke<NewsItem[]>("fetch_news", { query });
  }
}

export const newsService = new NewsService();
