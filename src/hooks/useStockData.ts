import { useState, useEffect, useCallback, useRef } from "react";
import { StockData } from "../utils/platform";
import { stockService } from "../services/stockService";

export interface UseStockDataResult {
  data: StockData | null;
  loading: boolean;
  error: string | null;
  fetchData: (symbol: string, range?: string) => Promise<StockData | null>;
}

export function useStockData(initialSymbol?: string, initialRange: string = "1y"): UseStockDataResult {
  const [data, setData] = useState<StockData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const lastFetched = useRef<string>("");

  const fetchData = useCallback(async (symbol: string, range: string = "1y") => {
    if (!symbol || !symbol.trim()) return null;
    const key = `${symbol}_${range}`;
    setLoading(true);
    setError(null);
    try {
      const res = await stockService.getStockData(symbol, range);
      setData(res);
      lastFetched.current = key;
      setLoading(false);
      return res;
    } catch (err: any) {
      const msg = typeof err === "string" ? err : err?.message || "載入股票資料失敗";
      setError(msg);
      setLoading(false);
      return null;
    }
  }, []);

  useEffect(() => {
    if (initialSymbol && initialSymbol.trim()) {
      fetchData(initialSymbol, initialRange);
    }
  }, [initialSymbol, initialRange, fetchData]);

  return { data, loading, error, fetchData };
}
