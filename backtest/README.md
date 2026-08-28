# StockT Institutional Backtest Engine (v1.0.0-pit)

This directory contains the authoritative configuration, PIT datasets, and verified results for StockT's Honest Multi-Factor Engine (`aiAlphaModel.ts`).

---

## 1. Timing & Execution Invariants

| Phase | Timing Rule | Description |
| :--- | :--- | :--- |
| **Feature Filtering** | `availableAt <= signalTimestamp` | Strict PIT gatekeeper prevents look-ahead bias. |
| **Signal Generation** | `T 13:30:00+08:00 (Market Close)` | 15-factor composite score calculated upon market close. |
| **Order Execution** | `T+1 09:00:00+08:00 (Market Open)` | Orders executed at next trading session opening price. |
| **Holding Period** | `20 Trading Days` | Traverses exact trading calendar skipping weekends & holidays. |
| **Position Exit** | `T+20 Market Close / T+21 Open` | Position closed with full transaction cost accounting. |

---

## 2. Taiwan Transaction Cost & Friction Model

All backtest metrics report both **Gross Return** and **Net Return**:

- **Brokerage Commission**: $14.25\text{ bps}$ ($0.1425\%$, charged on buy and sell, minimum $\text{NT\$} 20$).
- **Securities Transaction Tax (證交稅)**: $30.0\text{ bps}$ ($0.30\%$, charged on sell).
- **Bid-Ask Slippage**: $5.0\text{ bps}$ ($0.05\%$, applied symmetrically on entry and exit).

---

## 3. Survivorship Bias & Corporate Actions

- **Universe**: Filtered dynamically by `listingDate <= T` and `(delistingDate == null || delistingDate > T)`.
- **Corporate Actions**: Uses `adjusted_close` with `total_return` method (cash dividends reinvested, splits/capital reductions adjusted).

---

## 4. Output Artifacts

- [`config.json`](./config.json): Authoritative backtest configuration schema.
- [`results.json`](./results.json): Executable backtest output with empirical calibration curve and net returns.
