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

## 3. Critical UI & Financial Conventions

### Taiwan Stock Market Color Conventions (台股慣例)
- **RED (🔴 漲 / 多頭 / 獲利)**: `var(--accent-red)` / `#ff5252` (Price rise `▲`, positive YoY growth, Bullish advice, capital profit).
- **GREEN (🟢 跌 / 空頭 / 虧損)**: `var(--accent-green)` / `#4caf50` (Price drop `▼`, negative growth, Bearish advice, capital loss).

### Null Safety & JS Type Quirk Rules
> [!IMPORTANT]
> In JavaScript, `isNaN(null)` evaluates to `false` and `null < 30` evaluates to `true` (`0 < 30`).
> **NEVER** call `.toFixed()` directly on numeric values without strict null verification.

Always use a strict validation helper:
```typescript
const isValidNum = (v: any): v is number =>
  v !== null && v !== undefined && typeof v === "number" && !isNaN(v);
```
Ensure all indicator sequences in `src/utils/indicators.ts` and `src/utils/analysis.ts` sanitize input arrays converting `null` / `undefined` into `NaN`.

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
