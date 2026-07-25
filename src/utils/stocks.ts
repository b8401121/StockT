import { invoke } from "@tauri-apps/api/core";

export interface StockEntry {
  symbol: string;
  name: string;
}

let cachedStocks: StockEntry[] = [];
let listeners: ((stocks: StockEntry[]) => void)[] = [];

export function getCachedStocks(): StockEntry[] {
  return cachedStocks;
}

export async function loadStocks(): Promise<StockEntry[]> {
  try {
    const list = await invoke<StockEntry[]>("get_stock_list");
    cachedStocks = list;
    listeners.forEach((l) => l(list));
    return list;
  } catch (e) {
    console.error("Failed to load stocks:", e);
    return [];
  }
}

export async function updateStocks(): Promise<number> {
  const result = await invoke<{ status: string; count: number }>("update_stock_list");
  await loadStocks(); // reload after update
  return result.count;
}

export function subscribeStocks(listener: (stocks: StockEntry[]) => void) {
  listeners.push(listener);
  if (cachedStocks.length > 0) {
    listener(cachedStocks);
  }
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
