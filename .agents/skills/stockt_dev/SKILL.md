---
name: stockt_dev
description: Comprehensive development guidelines and architectural context for StockT (Tauri Desktop & GitHub Pages Web App). Covers cross-platform build commands, multi-platform runtime adapters, Taiwan market conventions, Metric<T> provenance pipeline, honest multi-factor modeling, null-safety rules, and business logic caveats.
---

# StockT (阿山股市終端機 v2.0) Development Guidelines

StockT is a cross-platform financial analytics application supporting both **Tauri Desktop (Linux RPM / Windows EXE)** and **GitHub Pages (Web / Mobile RWD)** using **React 18 + TypeScript + Vite** on the frontend and **Tauri 2 (Rust)** on the desktop backend.

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

## 2. Multi-Platform Runtime Architecture & Data Provenance

The app uses `src/utils/platform.ts` with `isTauri()` to dynamically switch between Desktop and Web environments:

| Feature | Tauri Desktop (`isTauri() === true`) | GitHub Pages (`isTauri() === false`) |
| :--- | :--- | :--- |
| **Market Data** | Rust backend (`fetch.rs`) via `invoke()` | Yahoo Web API + CORS Proxy + Bundled TWSE/MOPS DB |
| **Data Provenance** | `MetricF64` (`value`, `source`, `period`, `published_at`, `fetched_at`) | `Metric<number>` (`value`, `source`, `period`, `publishedAt`, `fetchedAt`) |
| **Watchlist Storage** | Local JSON files in root folder | Firebase Firestore with client-side AES-GCM encryption |
| **File Export** | Rust IPC writes directly to OS `Downloads/` | Browser dynamic `Blob` download |
| **Window Controls** | Tauri Native Window API (`@tauri-apps/api`) | Browser standard Fullscreen API |

### End-to-End Metric<T> Data Provenance & Point-in-Time (PIT) Pipeline
All quantitative financial metrics flow through a typed provenance container distinguishing **four crucial time dimensions** to prevent Look-Ahead Bias and intraday timing bias:

| Time Field | Meaning | Example |
| :--- | :--- | :--- |
| `period` | 數據所屬財務/交易期間 | `2024Q2`, `2024-07`, `2026-08-28` |
| `publishedAt` | 公司或交易所實際公告時間 (Actual Announcement) | `2024-08-07T16:30:00+08:00` |
| `availableAt` | Backtest/模型允許使用該特徵的最早時間點 (Point-in-Time) | `2024-08-14` (最晚法定截止日) 或 `2026-08-28T13:30:00+08:00` (收盤) |
| `availabilityPolicy` | 可用性生成政策 (Policy Type) | `"conservative_statutory_deadline"`, `"market_close"`, `"next_market_open"` |
| `fetchedAt` | StockT 實際發送 HTTP 請求抓取時間 (ISO 8601 UTC) | `2026-08-28T14:45:00Z` |

```
Rust Backend (fetch.rs / yahoo.rs / twse.rs / tpex.rs)
  ↓ MetricF64 { value, source, period, published_at, available_at, availability_policy, fetched_at }
Tauri IPC / Deserialization
  ↓ Metric<number> { value, source, period, publishedAt, availableAt, availabilityPolicy, fetchedAt }
StockInfo / StockInfoFull (TypeScript)
  ↓ metricVal, metricSource, metricPeriod, metricPublishedAt, metricAvailableAt, metricPolicy, formatAsOf
AI Alpha Multi-Factor Engine (aiAlphaModel.ts)
  ↓ FactorResult { value, source, asOf: "2024Q2 (生效: 2024-08-14)", status, available }
UI (AnalysisTab / Scanners) -> Transparently displays real data provenance & PIT dates
```

#### Availability Policy Taxonomy:
- `"immediate"`: 即時盤中行情 (即時報價，當下有效)。
- `"market_close"`: 盤後結算數據 (例如 TWSE/TPEx 收盤 PE/PB/殖利率，每日 13:30 收盤結算後生效)。
- `"next_market_open"`: 盤後公告數據 (公告時間後之次一交易日 09:00 開盤生效)。
- `"conservative_statutory_deadline"`: 最晚法定公告截止日推定 (Q1: 05-15, Q2: 08-14, Q3: 11-14, Q4: 次年 03-31)。

#### Backtest Configuration Specification:
```json
{
  "signal_time": "market_close",
  "execution_time": "next_market_open",
  "holding_period": 20,
  "holding_period_unit": "trading_days",
  "entry_timing": "T+1_open",
  "exit_timing": "T+20_close",
  "benchmark": "TAIEX",
  "timezone": "Asia/Taipei",
  "availability_rule": "feature.availableAt <= signalTimestamp"
}
```

#### 7 Core Point-in-Time (PIT) Invariant Tests (`pitInvariants.test.ts`):
1. **TEST 1 (Exclusion)**: `feature.availableAt > signalTimestamp` $\implies$ Feature **must be excluded** (look-ahead bias prevented).
2. **TEST 2 (Inclusion)**: `feature.availableAt <= signalTimestamp` $\implies$ Feature **is included**.
3. **TEST 3 (Causality)**: `publishedAt > availableAt` $\implies$ **Invariant violation** (rejected as invalid).
4. **TEST 4 (Calendar Roll)**: `next_market_open` on Friday evening 16:30 $\implies$ Correctly rolls to **Monday 09:00:00** (or next trading day).
5. **TEST 5 (Trading Days)**: `holding_period: 20 trading_days` $\implies$ Traverses **20 trading days** skipping weekends and market holidays.
6. **TEST 6 (Signal Strictness)**: `T close signal` (13:30) $\implies$ Strictly **cannot consume** any `T+1` data.
7. **TEST 7 (Execution Timing)**: `T close signal` $\implies$ Order execution timing is $\ge \text{T+1 09:00:00}$.

#### Helper Functions:
- `metricVal(m)`: Null-safe extraction of `m?.value ?? null`.
- `metricSource(m, fallback)`: Returns provenance source (`"TWSE"`, `"Yahoo Finance"`, `"MOPS"`, etc.).
- `metricPeriod(m, fallback)`: Returns data period (e.g. `"2024Q2"`).
- `metricPublishedAt(m)`: Returns formal publication date (e.g. `"2024-08-07"`).
- `metricAvailableAt(m)`: Returns earliest backtest accessible timestamp (e.g. `"2024-08-14"`).
- `metricPolicy(m)`: Returns availability policy (`"market_close"`, `"conservative_statutory_deadline"`, etc.).
- `formatAsOf(m)`: Formats Point-in-Time display string, e.g. `"2024Q2 (生效: 2024-08-14)"`.
- `metricTs(m)`: Returns ISO-8601 UTC fetch timestamp string (`m?.fetchedAt`).

---

## 3. Data Integrity, Backend Security & Factor Modeling Rules

> [!IMPORTANT]
> **Honest Multi-Factor Model & 0-Tolerance for Fake Fallbacks:**
> 1. **No Fake Momentum Fallbacks**: 
>    - `momentum20` requires $\ge 20$ trading bars (`closes.length >= 20`).
>    - `momentum60` requires $\ge 60$ trading bars (`closes.length >= 60`).
>    - `momentum120` requires $\ge 120$ trading bars (`closes.length >= 120`).
>    - **NEVER** use heuristic proxies (e.g., `1-day return * 2`) to fabricate momentum when data is missing. If bars are insufficient, return `value: null`, `available: false`, `status: "missing"`.
> 2. **Valuation Metric Precedence**:
>    - For Taiwan equities (`.TW` / `.TWO`), TWSE/TPEx official valuations (`tw_pe`, `tw_pb`, `tw_yield`) take precedence over Yahoo Finance trailing estimates.
> 3. **Calibration & Backtest Claim Honesty**:
>    - Differentiate clearly between dynamic backtest empirical results and `HeuristicCalibration` (啟發式校準分位估算).
>    - **DO NOT** hardcode empirical backtest stats (e.g., "68.4% 歷史勝率", "+4.7% Alpha", "IR 1.42") in the UI unless generated dynamically from a reproducible, auditable backtest artifact.
> 4. **Backend TLS & Session Security**:
>    - Never enable `danger_accept_invalid_certs(true)` in HTTP client builders.
>    - Never keep hardcoded session cookies (e.g. `A3=d=AQAB...`) as fallbacks. Dynamic session fetching must fail cleanly with explicit error messages if tokens cannot be retrieved.

---

## 4. UI Color Conventions & Null Safety

### UI Color Conventions (色彩規範：股價成交量 vs 其他因素)
> [!IMPORTANT]
> **絕對區分「股價/成交量」與「其他非價格因素」的色彩邏輯：**
> 
> 1. **股價、成交量、價格漲跌、價差損益 (Price & Volume Action)**：
>    - **漲用紅色 (🔴 RED)**: `var(--accent-red)` / `#ff5252` (價格上漲 `▲`、正報酬 PnL、成交量上漲紅量)。
>    - **跌用綠色 (🟢 GREEN)**: `var(--accent-green)` / `#4caf50` (價格下跌 `▼`、負報酬虧損 PnL、成交量下跌綠量)。
> 
> 2. **其他因素（基本面指標、財務健康、風險評估、地雷、神經網路/多因子、分數評級、指標診斷）**：
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
- **Top-Left Pinned HUD (`ChartHUDView`)**: Interactive K-line charts pin the information card at `left: 70px; top: 8px` (avoiding the left price scale).
- **Never Obstruct Cursor/Candles**: Never render floating tooltips directly tracking underneath mouse cursor. Use pinned HUD overlay that reacts to `subscribeCrosshairMove`.
- **Default Display**: When cursor leaves the chart area, default to displaying the latest trading day's metrics (OHLCV, Change ▲/▼, Volume in 張/股, MA5/10/20).

---

## 5. Core Business Logic & Financial Formulas

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

## 6. Git & Branch Management Workflow

1. Perform local development and testing on the `大修正` feature branch.
2. Commit and push to `origin/大修正`:
   ```bash
   git add -A && git commit -m "feat/fix: description" && git push origin 大修正
   ```
3. To update production and GitHub Pages, sync `大修正` into `main` and `stable`:
   ```bash
   git checkout main && git merge 大修正 && git push origin main
   git checkout stable && git merge main && git push origin stable
   git checkout 大修正
   ```
