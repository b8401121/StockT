/**
 * 台灣上市/上櫃個股專屬業務與產業介紹知識庫
 * 整合台灣證券交易所 (TWSE) 與櫃檯買賣中心 (TPEx) 公開資訊觀測站 (MOPS) 官方登記主要業務
 */

import mopsData from "./twse_mops_profiles.json";

interface MopsProfile {
  name: string;
  symbol: string;
  business: string;
}

const MOPS_MAP: Record<string, MopsProfile> = mopsData as unknown as Record<string, MopsProfile>;

/**
 * 取得精準台股公司業務與營業項目介紹
 */
export function getCompanyBusinessSummary(coId: string, normSym: string, stockName: string, category?: string): string {
  const code = coId.replace(/[^0-9]/g, "");
  const cleanName = (stockName || MOPS_MAP[code]?.name || normSym).replace(/\(.*\)/, "").replace(/\.TW.*/, "").replace(/\.TWO.*/, "").trim();

  // 1. 優先匹配官方 MOPS / 深度業務資料庫
  if (MOPS_MAP[code] && MOPS_MAP[code].business && MOPS_MAP[code].business.length > 5) {
    return MOPS_MAP[code].business;
  }

  const num = parseInt(code, 10);
  const cat = category || "";

  // 2. 根據股票代號區間與產業類別進行專業營業項目生成
  if (cat.includes("半導體") || (num >= 3000 && num <= 3700 && (cleanName.includes("科") || cleanName.includes("半導體") || cleanName.includes("晶")))) {
    return `【${cleanName} (${normSym}) 主要營業項目】：積體電路 (IC) 研發設計、晶圓製造、半導體封裝測試、材料零件與自動化檢測設備之生產與銷售。`;
  }

  if (cat.includes("IC設計") || cleanName.includes("設計") || cleanName.includes("矽")) {
    return `【${cleanName} (${normSym}) 主要營業項目】：特殊應用晶片 (ASIC)、微控制器 (MCU)、電源管理 IC 或利基型晶片研發與矽智財 (IP) 授權服務。`;
  }

  if (cat.includes("電腦") || cat.includes("伺服器") || cleanName.includes("電腦") || cleanName.includes("電") || (num >= 2300 && num <= 2399)) {
    return `【${cleanName} (${normSym}) 主要營業項目】：個人電腦、高效能雲端伺服器、工業電腦 (IPC)、儲存設備及周邊電子系統之研發設計、製造與全球行銷服務。`;
  }

  if (cat.includes("光電") || cleanName.includes("光") || cleanName.includes("晶") || (num >= 3400 && num <= 3600)) {
    return `【${cleanName} (${normSym}) 主要營業項目】：光學鏡頭模組、光電元件、LED 發光元件、面板顯示模組或光學膜材料之研發、製造與銷售。`;
  }

  if (cat.includes("通信") || cat.includes("網通") || cleanName.includes("通") || cleanName.includes("網") || (num >= 3700 && num <= 3800) || (num >= 6200 && num <= 6299)) {
    return `【${cleanName} (${normSym}) 主要營業項目】：無線通訊模組、網路交換設備、寬頻連網裝置及車聯網通訊系統之研發製造與銷售。`;
  }

  if (cat.includes("零組件") || (num >= 4100 && num <= 4999) || (num >= 6100 && num <= 6199) || cleanName.includes("科技") || cleanName.includes("電子")) {
    return `【${cleanName} (${normSym}) 主要營業項目】：高精密電子零組件、印刷電路板 (PCB)、連接器、被動元件或散熱模組等相關產品之研發製造與銷售。`;
  }

  if (cat.includes("金融") || (num >= 2800 && num <= 2899)) {
    return `【${cleanName} (${normSym}) 主要營業項目】：商業銀行存貸、保險經紀、證券交易投資、外匯操作及資產財富管理之多元金融整合服務。`;
  }

  if (cat.includes("航運") || (num >= 2600 && num <= 2699)) {
    return `【${cleanName} (${normSym}) 主要營業項目】：海運貨櫃定期航線、散裝散貨運送、航空客貨運及海空綜合物流服務。`;
  }

  if (cat.includes("生技") || (num >= 4100 && num <= 4199) || (num >= 6400 && num <= 6500 && cleanName.includes("生"))) {
    return `【${cleanName} (${normSym}) 主要營業項目】：新藥研發、學名藥製造、醫療器材開發及專業健康生技產品之生產與銷售。`;
  }

  return `【${cleanName} (${normSym}) 主要營業項目】：深耕本業製造、產品研發與海內外行銷服務。`;
}
