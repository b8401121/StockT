import { invoke, StockData } from "../utils/platform";
import { StockEntry } from "../utils/stocks";

export class StockService {
  async getStockData(symbol: string, range: string = "1y"): Promise<StockData> {
    return await invoke<StockData>("fetch_stock_data", { symbol, range });
  }

  async getBatchStockData(symbols: string[]): Promise<StockData[]> {
    return await invoke<StockData[]>("fetch_batch_stock_data", { symbols });
  }

  async getBatchStockDataFull(symbols: string[], range: string = "1y"): Promise<StockData[]> {
    return await invoke<StockData[]>("fetch_batch_stock_data_full", { symbols, range });
  }

  async getStockList(): Promise<StockEntry[]> {
    return await invoke<StockEntry[]>("get_stock_list", {});
  }

  async updateStockList(): Promise<StockEntry[]> {
    return await invoke<StockEntry[]>("update_stock_list", {});
  }

  async openUrl(url: string): Promise<void> {
    await invoke("open_url", { url });
  }

  async exportTxtFile(filename: string, content: string): Promise<string> {
    return await invoke<string>("export_txt_file", { filename, content });
  }

  async translateText(text: string, targetLang: string = "zh-TW"): Promise<string> {
    if (!text || !text.trim()) return "";
    try {
      const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (Array.isArray(json) && Array.isArray(json[0])) {
        return json[0].map((item: any) => item[0]).filter(Boolean).join("");
      }
      return text;
    } catch (e) {
      console.warn("翻譯服務呼叫失敗:", e);
      return text;
    }
  }
}

export const stockService = new StockService();
