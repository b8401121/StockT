/**
 * StockT Machine Learning Inference Kernel (Pure Wasm/JS Decision Tree Ensemble)
 * 
 * Bound strictly to CANONICAL_QUANT_SPEC (src/utils/canonicalQuantSpec.ts)
 * 100% Feature parity with the 18 Canonical Factors
 */

import {
  CANONICAL_FEATURES,
  ML_DECISION_TREES,
  ML_MODEL_BIAS,
  ML_LEARNING_RATE,
  TOTAL_CANONICAL_FACTORS,
} from "./canonicalQuantSpec";

export interface MLFeatures {
  momentum20?: number | null;      // 0. 20日動能
  momentum60?: number | null;      // 1. 60日季動能
  momentum120?: number | null;     // 2. 120日半年動能
  ma20Bias?: number | null;        // 3. 月線 (MA20) 乖離率
  ma60Bias?: number | null;        // 4. 季線 (MA60) 乖離率
  ma120Bias?: number | null;       // 5. 半年線 (MA120) 乖離率
  ma240Bias?: number | null;       // 6. 年線 (MA240) 乖離率
  volumeSurge?: number | null;     // 7. 5日均量比 (Volume Surge)
  roe?: number | null;             // 8. 股東權益報酬率
  grossMargins?: number | null;    // 9. 營業毛利率
  operatingMargins?: number | null;// 10. 營業利益率
  revenueGrowthYoY?: number | null;// 11. 營收年增率 YoY
  debtToEquity?: number | null;    // 12. 負債權益比
  currentRatio?: number | null;    // 13. 流動比率
  freeCashFlow?: number | null;    // 14. 自由現金流 (FCF)
  pe?: number | null;              // 15. 本益比 (P/E)
  pb?: number | null;              // 16. 股價淨值比 (P/B)
  dividendYield?: number | null;   // 17. 現金殖利率
}

export interface MLInferenceResult {
  linearScore: number;
  treeEnsembleScore: number;
  predictedExcessReturnPct: number;
  mlWinProbabilityPct: number;
  topFeatureContributions: { feature: string; impact: number }[];
}

/**
 * Execute Pure Client-Side Machine Learning Inference on the 18 Canonical Features
 * Null-safe: missing values receive neutral 0 score without fabricating biased fallbacks
 */
export function evaluateMLModel(features: MLFeatures): MLInferenceResult {
  const rawVec: (number | null | undefined)[] = [
    features.momentum20,
    features.momentum60,
    features.momentum120,
    features.ma20Bias,
    features.ma60Bias,
    features.ma120Bias,
    features.ma240Bias,
    features.volumeSurge,
    features.roe,
    features.grossMargins,
    features.operatingMargins,
    features.revenueGrowthYoY,
    features.debtToEquity,
    features.currentRatio,
    features.freeCashFlow,
    features.pe,
    features.pb,
    features.dividendYield,
  ];

  // 1. Z-Score Standardization (Null-safe: Missing values imputed to 0 neutral standardized score)
  const normVec: number[] = new Array(TOTAL_CANONICAL_FACTORS);
  for (let i = 0; i < TOTAL_CANONICAL_FACTORS; i++) {
    const v = rawVec[i];
    const spec = CANONICAL_FEATURES[i];
    if (v === null || v === undefined || isNaN(v) || !isFinite(v)) {
      normVec[i] = 0.0; // Strictly Neutral 0 (No artificial bias fabrication)
    } else {
      const std = spec.std > 0 ? spec.std : 1.0;
      normVec[i] = (v - spec.mean) / std;
    }
  }

  // 2. Ridge Regression Linear Interaction
  let linearScore = ML_MODEL_BIAS;
  const contributions: { feature: string; impact: number }[] = [];

  for (let i = 0; i < TOTAL_CANONICAL_FACTORS; i++) {
    const spec = CANONICAL_FEATURES[i];
    const impact = normVec[i] * spec.linearWeight;
    linearScore += impact;
    contributions.push({
      feature: spec.label,
      impact: Number(impact.toFixed(4)),
    });
  }

  // 3. Tree Ensemble Gradient Boosting Pass
  let treeSum = 0;
  for (const tree of ML_DECISION_TREES) {
    if (normVec[tree.fIdx] <= tree.thresh) {
      treeSum += tree.leftVal;
    } else {
      treeSum += tree.rightVal;
    }
  }
  const treeEnsembleScore = treeSum * ML_LEARNING_RATE;

  // 4. Combined Model Prediction
  const combinedLogit = (linearScore * 0.4 + treeEnsembleScore * 0.6) * 12.0;
  const mlWinProbabilityPct = Number(((1 / (1 + Math.exp(-combinedLogit))) * 100).toFixed(1));
  const predictedExcessReturnPct = Number(((linearScore * 0.4 + treeEnsembleScore * 0.6) * 100).toFixed(2));

  contributions.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  return {
    linearScore: Number(linearScore.toFixed(4)),
    treeEnsembleScore: Number(treeEnsembleScore.toFixed(4)),
    predictedExcessReturnPct,
    mlWinProbabilityPct,
    topFeatureContributions: contributions.slice(0, 5),
  };
}
