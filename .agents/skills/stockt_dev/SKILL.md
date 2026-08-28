---
name: stockt_dev
description: Comprehensive development guidelines and architectural context for StockT (Tauri Desktop & GitHub Pages Web App). Covers cross-platform build commands, multi-platform runtime adapters, Taiwan market conventions, null-safety rules, and business logic caveats.
---

# StockT (阿山股市終端機 v2.0) Development Guidelines

StockT is a cross-platform financial analytics application supporting both **Tauri Desktop (Linux RPM / Windows EXE)** and **GitHub Pages (Web / Mobile RWD)** using **React 18 + TypeScript + Vite** on the frontend and **Tauri (Rust)** on the desktop backend.

---

## 1. Environment & Build Setup

### Linux Build & Packaging
On Linux, build and package the `.rpm` installer to the project root:
```bash
. "$HOME/.cargo/env" && npm run build-update
```
To install / reinstall locally:
```bash
sudo dnf reinstall -y ./stockt-0.1.0-1.x86_64.rpm
```

### Windows Build & Packaging
On Windows environments with standalone toolchains, prepend paths before executing:
```powershell
$env:PATH = "f:\StockT\node-v20.12.2-win-x64;f:\StockT\mingw64\mingw64\bin;" + $env:PATH; npm run build-update
```
*Note*: `WebView2Loader.dll` must accompany `stockt.exe` in the release output folder.

### GitHub Pages (Web Deployment)
- Automated deployment is configured via `.github/workflows/gh-pages.yml`.
- Pushing or merging to the `main` branch automatically builds Vite and deploys the static web app to **`https://b8401121.github.io/StockT/`**.

---

## 2. Multi-Platform Runtime Architecture

The app uses `src/utils/platform.ts` with `isTauri()` to dynamically switch between Desktop and Web environments:

| Feature | Tauri Desktop (`isTauri() === true`) | GitHub Pages (`isTauri() === false`) |
| :--- | :--- | :--- |
| **Market Data** | Rust backend (`fetch.rs`) via `invoke()` | Yahoo Web API + CORS Proxy + Bundled TWSE/MOPS DB |
| **Watchlist Storage** | Local JSON files in root folder | Firebase Firestore with client-side AES-GCM encryption |
| **File Export** | Rust IPC writes directly to OS `Downloads/` | Browser dynamic `Blob` download |
| **Window Controls** | Tauri Native Window API (`@tauri-apps/api`) | Browser standard Fullscreen API |

---

### UI Color Conventions (色彩規範：股價成交量 vs 其他因素)
> [!IMPORTANT]
> **絕對區分「股價/成交量」與「其他非價格因素」的色彩邏輯：**
> 
> 1. **股價、成交量、價格漲跌、價差損益 (Price & Volume Action)**：
>    - **漲用紅色 (🔴 RED)**: `var(--accent-red)` / `#ff5252` (價格上漲 `▲`、正報酬 PnL、成交量上漲紅量)。
>    - **跌用綠色 (🟢 GREEN)**: `var(--accent-green)` / `#4caf50` (價格下跌 `▼`、負報酬虧損 PnL、成交量下跌綠量)。
> 
> 2. **其他因素（基本面指標、財務健康、風險評估、地雷、17 維神經網路因子、分數評級、指標診斷）**：
>    - **不好的用紅色 (🔴 RED 警示/危險)**: `var(--accent-red)` / `#ef4444` / `#dc2626` (財務地雷 💣、虧損/負值 `ROE/EPS < 0`、營收衰退、現金流流出燒錢、負債過高 `D/E > 200%`、自有資本率過低 `< 30%`、AI 低勝率 `< 40%`、偏空避險、評分危險 F 級、檢驗未通過 ✗)。
>    - **好的用綠色 / 青藍色 / 紫色 (🟢 GREEN / 🔵 CYAN / 🟣 PURPLE 安全/優質)**: `#4ade80` / `#38bdf8` / `#a855f7` (評分 S/A 級、通過檢驗 ✓、高 ROE/營收高成長、現金流充沛、AI 高勝率 `> 75%`、強烈看多)。
>    - **中性用黃色 / 灰色 (🟡 AMBER / ⚪ GRAY)**: `#facc15` / `#94a3b8` (中性持有、普通 C 級)。

### Null Safety & Defensive Data Parsing Rules
> [!IMPORTANT]
> In JavaScript, `isNaN(null)` evaluates to `false`, `null < 30` evaluates to `true` (`0 < 30`), and strings like `"Infinity"` or `"NaN"` from JSON will evaluate to truthy but lack `.toFixed()`.
> **NEVER** call `.toFixed()` directly on raw objects or unverified numbers.

Always use strict number conversion and formatting utilities (`toSafeNum` / `fmtFixed`):
```typescript
export function fmtFixed(v: any, digits = 1, fallback = "-"): string {
  if (v == null || v === "" || v === "Infinity" || v === "-Infinity" || v === "NaN") return fallback;
  const num = Number(v);
  if (isNaN(num) || !isFinite(num)) return fallback;
  return num.toFixed(digits);
}

export function toSafeNum(v: any, fallback: number): number;
export function toSafeNum(v: any, fallback?: number | null): number | null;
export function toSafeNum(v: any, fallback: number | null = null): number | null {
  if (v == null || v === "" || v === "Infinity" || v === "-Infinity" || v === "NaN") return fallback;
  const num = Number(v);
  return isNaN(num) || !isFinite(num) ? fallback : num;
}
```

### Chart UX & Interactive HUD (TradingView Style)
- **Top-Left Pinned HUD (`ChartHUDView`)**: Interactive K-line charts (including main chart and full-screen zoom modal) pin the information card at `left: 70px; top: 8px` (avoiding the left price scale).
- **Never Obstruct Cursor/Candles**: Never render floating tooltips directly tracking underneath mouse cursor. Use pinned HUD overlay that reacts to `subscribeCrosshairMove`.
- **Default Display**: When cursor leaves the chart area, default to displaying the latest trading day's metrics (OHLCV, Change ▲/▼, Volume in 張/股, MA5/10/20).

---

## 4. Core Business Logic & Financial Formulas

### 1. Cumulative P&L (總累積獲利)
$$\text{Grand Total P&L} = \text{Unrealized P&L} + \text{Realized P&L} + \text{Est. Net Dividends}$$
$$\text{Grand Total ROI} = \frac{\text{Grand Total P&L}}{\text{Total Combined Cost}} \times 100\%$$

### 2. Dividend & Ex-Dividend Calculations (`WatchlistTab.tsx`)
- **Ex-dividend qualification**: Buy date must precede the ex-dividend date (`buyDate < exDate`).
- **2.11% NHI Supplement Premium**: Deducted if gross dividend per stock per payout $\ge \text{NT\$} 20,000$.
- **8.5% Tax Credit**: $8.5\%$ of dividend income, capped at $\text{NT\$} 80,000$ per person annually.

### 3. Equity Ratio (自有資本比率 / 股東權益比率)
$$\text{Equity Ratio} = \frac{\text{Total Equity}}{\text{Total Assets}} \times 100\% = \frac{1}{1 + \text{D/E}} \times 100\%$$
- **Good / Solid ($\ge 50\%$)**: Red highlight.
- **High Risk ($< 30\%$)**: Green / Amber warning.

### 4. Landmine Scanning (地雷風險排查)
Risk strings are categorized by leading emoji:
- **Technical (📉 技術面)**: `📉, 😱, 🧨, 🌪️` (MA death cross, low RSI, breaking lower BB band, ATR spike).
- **Financial (💰 財務面)**: `💸, 📛, 🔴, 🩸, 💧, 💦, 🏗️, 📊` (Negative EPS, negative ROE, negative FCF, high debt).

### 5. Yahoo Finance Dynamic Keys
JSON keys for financial statements in `QuoteFinanceStore` are dynamic (e.g. `balanceSheetHistoryQuarterly` keys ending in date suffixes). Always use regex / substring search (`findTwKey`) rather than hardcoded object property keys.

---

## 5. Git & Deployment Workflow

1. Perform local development and testing on the `dev` branch.
2. Commit and push to `origin/dev`:
   ```bash
   git add . && git commit -m "feat/fix: description" && git push origin dev
   ```
3. To deploy to GitHub Pages, merge `dev` into `main` and push:
   ```bash
   git checkout main && git merge dev && git push origin main && git checkout dev
   ```
