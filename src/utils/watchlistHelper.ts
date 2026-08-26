import { invoke } from "./platform";
import { loadUserVault, saveUserVault } from "./vault";

export async function addStockToUserWatchlist(
  symbol: string,
  stockName?: string
): Promise<{ success: boolean; message: string }> {
  try {
    let cat = "自選/其他";
    try {
      cat = await invoke<string>("get_category_by_symbol", { symbol });
    } catch {}

    const authUser = sessionStorage.getItem("stockt_auth_user");
    const authPass = sessionStorage.getItem("stockt_auth_pass");

    const newEntry = {
      symbol,
      date: new Date().toISOString().slice(0, 10),
      price: 0,
      shares: 0,
      sell_price: 0,
    };

    if (authUser && authPass) {
      // 1. 已登入用戶 -> 存入個人 AES-256 加密保險箱並同步 GitHub
      let userWatchlist: Record<string, any[]> = {};
      try {
        const res = await loadUserVault(authUser, authPass);
        userWatchlist = res.data || {};
      } catch {}

      let exists = false;
      for (const entries of Object.values(userWatchlist)) {
        if (entries.some((e: any) => e.symbol === symbol)) {
          exists = true;
          break;
        }
      }

      if (exists) {
        if (!window.confirm(`「${stockName || symbol}」已經存在於您的自選股中。\n您要追加一筆新的購入紀錄嗎？`)) {
          return { success: false, message: "已取消加入" };
        }
      }

      const updatedList = { ...userWatchlist };
      if (!updatedList[cat]) updatedList[cat] = [];
      updatedList[cat].push(newEntry);

      await saveUserVault(authUser, authPass, updatedList, true);
      window.dispatchEvent(new Event("stockt_watchlist_updated"));
      return {
        success: true,
        message: `🎉 已成功將「${stockName || symbol}」加入【${authUser}】的專屬自選股（分類：${cat}）！`,
      };
    } else {
      // 2. 訪客模式 -> 存入本地預設名單
      const filename = "我的自選股";
      let listData: Record<string, any[]> = {};
      try {
        listData = await invoke<Record<string, any[]>>("load_watchlist", { filename });
      } catch {
        listData = {};
      }

      let exists = false;
      for (const entries of Object.values(listData)) {
        if (entries.some((e: any) => e.symbol === symbol)) {
          exists = true;
          break;
        }
      }

      if (exists) {
        if (!window.confirm(`「${stockName || symbol}」已經存在於自選股中。\n您要追加一筆新的購入紀錄嗎？`)) {
          return { success: false, message: "已取消加入" };
        }
      }

      const updatedList = { ...listData };
      if (!updatedList[cat]) updatedList[cat] = [];
      updatedList[cat].push(newEntry);

      await invoke("save_watchlist", { watchlist: updatedList, filename });
      window.dispatchEvent(new Event("stockt_watchlist_updated"));
      return {
        success: true,
        message: `🎉 已成功將「${stockName || symbol}」存入自選股清單（分類：${cat}）！`,
      };
    }
  } catch (err: any) {
    return { success: false, message: `存入失敗: ${err.message || err}` };
  }
}
