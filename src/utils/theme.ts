// ─── StockT 主題管理系統 ──────────────────────────────────────────
import { useState, useEffect } from "react";

export type AppTheme = "dark" | "warm";

const THEME_STORAGE_KEY = "stockt_theme_mode";

let currentTheme: AppTheme = (typeof localStorage !== "undefined" ? localStorage.getItem(THEME_STORAGE_KEY) as AppTheme : "dark") || "dark";
const listeners = new Set<(theme: AppTheme) => void>();

export function getTheme(): AppTheme {
  return currentTheme;
}

export function setTheme(newTheme: AppTheme) {
  currentTheme = newTheme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, newTheme);
  } catch {}
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", newTheme);
  }
  listeners.forEach((cb) => cb(newTheme));
}

export function toggleTheme(): AppTheme {
  const next = currentTheme === "dark" ? "warm" : "dark";
  setTheme(next);
  return next;
}

// 初始化
if (typeof document !== "undefined") {
  document.documentElement.setAttribute("data-theme", currentTheme);
}

export function useAppTheme(): [AppTheme, (theme: AppTheme) => void, () => void] {
  const [theme, setLocalTheme] = useState<AppTheme>(currentTheme);

  useEffect(() => {
    const handler = (t: AppTheme) => setLocalTheme(t);
    listeners.add(handler);
    return () => {
      listeners.delete(handler);
    };
  }, []);

  return [theme, setTheme, toggleTheme];
}
