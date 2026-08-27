import React, { useState, useEffect } from "react";
import { addStockToUserWatchlist, isStockInWatchlist } from "../utils/firebase";

interface AddToWatchlistBtnProps {
  symbol: string;
  text?: string;
  className?: string;
  style?: React.CSSProperties;
}

export const AddToWatchlistBtn: React.FC<AddToWatchlistBtnProps> = ({
  symbol,
  text = "⭐ 收藏",
  className = "btn btn-outline btn-sm",
  style = {},
}) => {
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let mounted = true;
    const checkAdded = async () => {
      if (!symbol) return;
      const isAdded = await isStockInWatchlist(symbol);
      if (mounted) setAdded(isAdded);
    };

    checkAdded();

    const handleUpdate = () => {
      checkAdded();
    };

    window.addEventListener("stockt_watchlist_updated", handleUpdate);
    return () => {
      mounted = false;
      window.removeEventListener("stockt_watchlist_updated", handleUpdate);
    };
  }, [symbol]);

  const handleAdd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (added) {
      alert(`ℹ️【${symbol}】已在您的自選收藏名單中！前往「⭐ 我的收藏」分頁即可查看。`);
      return;
    }
    setLoading(true);
    const res = await addStockToUserWatchlist(symbol);
    setLoading(false);
    if (res.success || res.isAlreadyAdded) {
      setAdded(true);
      alert(res.message);
    } else {
      alert(res.message);
    }
  };

  return (
    <button
      className={className}
      onClick={handleAdd}
      disabled={loading}
      style={{
        cursor: "pointer",
        color: added ? "#ffd700" : undefined,
        borderColor: added ? "rgba(255, 215, 0, 0.4)" : undefined,
        background: added ? "rgba(255, 215, 0, 0.12)" : undefined,
        fontWeight: added ? 700 : undefined,
        ...style,
      }}
      title={added ? "已在您的收藏名單中" : "加入個人自選觀察清單"}
    >
      {loading ? "..." : added ? "★ 已收藏" : text}
    </button>
  );
};
