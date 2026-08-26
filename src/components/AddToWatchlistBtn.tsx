import React, { useState } from "react";
import { addStockToUserWatchlist } from "../utils/firebase";

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

  const handleAdd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setLoading(true);
    const res = await addStockToUserWatchlist(symbol);
    setLoading(false);
    if (res.success) {
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
        ...style,
      }}
      title="加入個人雲端收藏清單"
    >
      {loading ? "..." : added ? "★ 已收藏" : text}
    </button>
  );
};
