/**
 * StockT Institutional-Grade Canonical Quantitative Model Specification (v2.0)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 * SINGLE SOURCE OF TRUTH (SSOT) FOR ALL QUANTITATIVE FEATURES & MODELS
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Guarantees 100% mathematical parity across:
 * - Rule-based Heuristic Factor Engine (aiAlphaModel.ts)
 * - Machine Learning Decision Tree & Ridge Ensemble Kernel (mlTreeModel.ts)
 * - Cryptographic Deterministic Provenance Hasher (quantProvenance.ts)
 * - UI Rendering, Table Headers, Quality Audits & HTML Export (AIAlphaScanTab.tsx)
 */

export type FactorCategory = "OHLCV" | "Fundamental" | "Safety" | "Valuation";

export interface CanonicalFeatureDefinition {
  index: number;
  key: string;
  name: string;
  label: string;
  category: FactorCategory;
  heuristicWeight: number; // Sum across all 18 features must be strictly 1.0000
  linearWeight: number;    // ML Ridge linear interaction coefficient
  mean: number;            // TWSE/TPEx Point-in-Time population mean
  std: number;             // TWSE/TPEx Point-in-Time population std dev
}

export interface DecisionTree {
  fIdx: number;     // Index into CANONICAL_FEATURES (0 ~ 17)
  thresh: number;   // Z-score threshold
  leftVal: number;  // Left leaf value
  rightVal: number; // Right leaf value
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Unified 18-Feature Canonical Schema Specification
// ─────────────────────────────────────────────────────────────────────────────

export const CANONICAL_FEATURES: CanonicalFeatureDefinition[] = [
  // ── OHLCV 價量動能 (8 項，權重 0.54) ──
  {
    index: 0,
    key: "momentum20",
    name: "momentum20",
    label: "20日波段動能",
    category: "OHLCV",
    heuristicWeight: 0.09,
    linearWeight: -0.004683,
    mean: 0.018256,
    std: 0.097857,
  },
  {
    index: 1,
    key: "momentum60",
    name: "momentum60",
    label: "60日季波段動能",
    category: "OHLCV",
    heuristicWeight: 0.08,
    linearWeight: -0.002131,
    mean: 0.058755,
    std: 0.179020,
  },
  {
    index: 2,
    key: "momentum120",
    name: "momentum120",
    label: "120日半年波段動能",
    category: "OHLCV",
    heuristicWeight: 0.06,
    linearWeight: 0.004821,
    mean: 0.121502,
    std: 0.267050,
  },
  {
    index: 3,
    key: "ma20Bias",
    name: "MA20",
    label: "月線 (MA20) 乖離率",
    category: "OHLCV",
    heuristicWeight: 0.07,
    linearWeight: 0.001786,
    mean: 0.007005,
    std: 0.054919,
  },
  {
    index: 4,
    key: "ma60Bias",
    name: "MA60",
    label: "季線 (MA60) 乖離率",
    category: "OHLCV",
    heuristicWeight: 0.06,
    linearWeight: 0.010496,
    mean: 0.023399,
    std: 0.098352,
  },
  {
    index: 5,
    key: "ma120Bias",
    name: "MA120",
    label: "半年線 (MA120) 位階",
    category: "OHLCV",
    heuristicWeight: 0.05,
    linearWeight: -0.005974,
    mean: 0.048472,
    std: 0.139118,
  },
  {
    index: 6,
    key: "ma240Bias",
    name: "MA240",
    label: "年線 (MA240) 牛熊分界",
    category: "OHLCV",
    heuristicWeight: 0.07,
    linearWeight: -0.011304,
    mean: 0.099291,
    std: 0.197225,
  },
  {
    index: 7,
    key: "volumeSurge",
    name: "VolumeSurge",
    label: "5日均量比 (Volume Surge)",
    category: "OHLCV",
    heuristicWeight: 0.06,
    linearWeight: -0.000418,
    mean: 1.003070,
    std: 0.125257,
  },

  // ── Fundamental 獲利與成長 (4 項，權重 0.29) ──
  {
    index: 8,
    key: "roe",
    name: "ROE",
    label: "股東權益報酬率 (ROE)",
    category: "Fundamental",
    heuristicWeight: 0.10,
    linearWeight: 0.012841,
    mean: 0.151920,
    std: 0.019161,
  },
  {
    index: 9,
    key: "grossMargins",
    name: "GrossMargins",
    label: "營業毛利率",
    category: "Fundamental",
    heuristicWeight: 0.05,
    linearWeight: 0.002191,
    mean: 0.472390,
    std: 0.039348,
  },
  {
    index: 10,
    key: "operatingMargins",
    name: "OperatingMargins",
    label: "營業利益率",
    category: "Fundamental",
    heuristicWeight: 0.06,
    linearWeight: 0.003182,
    mean: 0.307050,
    std: 0.025578,
  },
  {
    index: 11,
    key: "revenueGrowthYoY",
    name: "RevenueGrowthYoY",
    label: "營收年成長率 (YoY)",
    category: "Fundamental",
    heuristicWeight: 0.08,
    linearWeight: 0.008450,
    mean: 0.125000,
    std: 0.185000,
  },

  // ── Safety 財務健全度 (2 項，權重 0.08) ──
  {
    index: 12,
    key: "debtToEquity",
    name: "DebtToEquity",
    label: "負債淨值比 (Debt to Equity)",
    category: "Safety",
    heuristicWeight: 0.04,
    linearWeight: -0.002100,
    mean: 42.500000,
    std: 15.000000,
  },
  {
    index: 13,
    key: "currentRatio",
    name: "CurrentRatio",
    label: "流動比率 (Current Ratio)",
    category: "Safety",
    heuristicWeight: 0.04,
    linearWeight: 0.001500,
    mean: 185.000000,
    std: 65.000000,
  },

  // ── Fundamental 現金流 (1 項，權重 0.05) ──
  {
    index: 14,
    key: "freeCashFlow",
    name: "FCF",
    label: "自由現金流 (Free Cash Flow)",
    category: "Fundamental",
    heuristicWeight: 0.05,
    linearWeight: 0.003200,
    mean: 50.000000,
    std: 120.000000,
  },

  // ── Valuation 估值與殖利率 (3 項，權重 0.14) ──
  {
    index: 15,
    key: "pe",
    name: "PE",
    label: "本益比 (P/E)",
    category: "Valuation",
    heuristicWeight: 0.05,
    linearWeight: -0.001852,
    mean: 19.970000,
    std: 3.825716,
  },
  {
    index: 16,
    key: "pb",
    name: "PB",
    label: "股價淨值比 (P/B)",
    category: "Valuation",
    heuristicWeight: 0.04,
    linearWeight: -0.002852,
    mean: 4.392000,
    std: 0.841770,
  },
  {
    index: 17,
    key: "dividendYield",
    name: "Dividend Yield",
    label: "現金殖利率",
    category: "Valuation",
    heuristicWeight: 0.05,
    linearWeight: 0.002450,
    mean: 0.038000,
    std: 0.025000,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. Machine Learning Tree Ensemble Specification
// ─────────────────────────────────────────────────────────────────────────────

export const ML_DECISION_TREES: DecisionTree[] = [
  { fIdx: 8, thresh: -1.023939, leftVal: -0.000226, rightVal: 0.018445 },  // roe (idx 8)
  { fIdx: 9, thresh: -0.901958, leftVal: -0.000877, rightVal: 0.015972 },  // grossMargins (idx 9)
  { fIdx: 8, thresh: -1.023939, leftVal: -0.001746, rightVal: 0.014005 },  // roe (idx 8)
  { fIdx: 10, thresh: -0.901958, leftVal: -0.002059, rightVal: 0.012151 }, // operatingMargins (idx 10)
  { fIdx: 2, thresh: -0.765588, leftVal: 0.019293, rightVal: 0.003548 },   // momentum120 (idx 2)
  { fIdx: 11, thresh: -0.850000, leftVal: -0.003722, rightVal: 0.009737 }, // revenueGrowthYoY (idx 11)
  { fIdx: 9, thresh: -0.901958, leftVal: -0.003608, rightVal: 0.008466 },  // grossMargins (idx 9)
  { fIdx: 2, thresh: -0.765588, leftVal: 0.015046, rightVal: 0.001377 }    // momentum120 (idx 2)
];

export const ML_MODEL_BIAS = 0.012844;
export const ML_LEARNING_RATE = 0.15;

// ─────────────────────────────────────────────────────────────────────────────
// 3. Fast Lookups & Single Source of Truth Invariant Checks
// ─────────────────────────────────────────────────────────────────────────────

export const TOTAL_CANONICAL_FACTORS = CANONICAL_FEATURES.length; // Exactly 18

export const CANONICAL_FEATURE_KEYS = CANONICAL_FEATURES.map(f => f.key);
export const CANONICAL_FEATURE_NAMES = CANONICAL_FEATURES.map(f => f.name);

export const CANONICAL_WEIGHT_BY_NAME: Record<string, number> = Object.fromEntries(
  CANONICAL_FEATURES.map(f => [f.name, f.heuristicWeight])
);

export const CANONICAL_WEIGHT_BY_KEY: Record<string, number> = Object.fromEntries(
  CANONICAL_FEATURES.map(f => [f.key, f.heuristicWeight])
);

export const CANONICAL_FEATURE_BY_INDEX: Record<number, CanonicalFeatureDefinition> = Object.fromEntries(
  CANONICAL_FEATURES.map(f => [f.index, f])
);

/**
 * Strict Mathematical Invariant Verification: Total heuristic weight must be exactly 1.0000
 */
export const CANONICAL_TOTAL_WEIGHT = Number(
  CANONICAL_FEATURES.reduce((sum, f) => sum + f.heuristicWeight, 0).toFixed(6)
);

if (Math.abs(CANONICAL_TOTAL_WEIGHT - 1.0) > 0.0001) {
  throw new Error(`[FATAL QUANT ERROR] Canonical feature weights do not sum to 1.0000 (actual: ${CANONICAL_TOTAL_WEIGHT})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Institutional Model Specification Artifact (For Cryptographic Provenance)
// ─────────────────────────────────────────────────────────────────────────────

export const CANONICAL_MODEL_VERSION = "institutional-18-factor-ensemble-v2.0";
export const CANONICAL_RANKING_ALGORITHM = "deterministic-multitier-v2.0";

export const CANONICAL_QUANT_SPEC = {
  version: CANONICAL_MODEL_VERSION,
  rankingAlgorithm: CANONICAL_RANKING_ALGORITHM,
  featureCount: TOTAL_CANONICAL_FACTORS,
  totalHeuristicWeight: CANONICAL_TOTAL_WEIGHT,
  features: CANONICAL_FEATURES,
  mlTrees: ML_DECISION_TREES,
  mlBias: ML_MODEL_BIAS,
  mlLearningRate: ML_LEARNING_RATE,
};
