import { invoke } from "../utils/platform";

export interface TwFundamental {
  pe?: number | null;
  pb?: number | null;
  yield_rate?: number | null;
}

export class FundamentalService {
  async getDetailedFundamentals(symbol: string): Promise<any> {
    return await invoke<any>("fetch_detailed_fundamentals", { symbol });
  }

  async getTwFundamentals(): Promise<Record<string, TwFundamental>> {
    return await invoke<Record<string, TwFundamental>>("fetch_tw_fundamentals", {});
  }
}

export const fundamentalService = new FundamentalService();
