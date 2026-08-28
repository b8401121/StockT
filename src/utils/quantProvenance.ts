/**
 * StockT Deterministic Quantitative Audit Provenance Engine (v1.0)
 * 
 * Provides cryptographic/deterministic provenance fingerprints ensuring:
 * Same Snapshot + Same Model + Same Config = Same Ranking = Same ResultHash
 */

/**
 * Fast & robust cross-platform SHA-256 string hasher
 * Works in Browser (WebCrypto), Node.js, WebWorker, and Tauri environments
 */
export async function computeSHA256(input: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle && typeof TextEncoder !== "undefined") {
    try {
      const msgBuffer = new TextEncoder().encode(input);
      const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return "sha256:" + hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    } catch {
      // Fallback if subtle crypto fails
    }
  }

  // Pure TypeScript 32-bit FNV-1a + Murmur3 hash fallback
  let h1 = 0x811c9dc5;
  let h2 = 0xdeadbeef;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 0x01000193);
    h2 = Math.imul(h2 ^ (ch * 31), 0x5bd1e995);
  }
  const part1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const part2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `fnv1a:${part1}${part2}`;
}

export interface DeterministicProvenanceReport {
  scanId: string;
  scanTimestamp: string;
  rankingAlgorithm: string;
  modelHash: string;
  universeHash: string;
  inputSnapshotHash: string;
  strategyConfigHash: string;
  resultHash: string;
  itemCount: number;
}

/**
 * Immutable canonical fingerprint of the 17-Factor Rules + ML Decision Trees + Linear Weights
 */
export const CANONICAL_MODEL_VERSION = "17-factor-ensemble-v1.0.0";
export const CANONICAL_MODEL_HASH = "sha256:d8b2e1f4a90847c50119e71fa084cb9142ec80b74158e652a8d6e902f8216c5b";
export const CANONICAL_RANKING_ALGORITHM = "deterministic-multitier-v1.0";

/**
 * Compute reproducible hash of the universe list
 */
export async function computeUniverseHash(symbols: string[]): Promise<string> {
  const sorted = [...symbols].sort((a, b) => {
    const codeA = Number(a.replace(/\.(TW|TWO)$/, ""));
    const codeB = Number(b.replace(/\.(TW|TWO)$/, ""));
    if (Number.isFinite(codeA) && Number.isFinite(codeB) && codeA !== codeB) {
      return codeA - codeB;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return computeSHA256(JSON.stringify(sorted));
}

/**
 * Compute reproducible hash of the input snapshot features
 */
export async function computeInputSnapshotHash(symbols: string[], fundamentals: Record<string, any>): Promise<string> {
  const canonicalData = symbols.map(sym => {
    const cleanSym = sym.replace(/\.(TW|TWO)$/, "");
    const f = fundamentals[cleanSym] || fundamentals[sym] || {};
    return {
      s: cleanSym,
      c: f.close_price ?? f.c ?? 0,
      pe: f.pe ?? f.tw_pe ?? null,
      pb: f.pb ?? f.tw_pb ?? null,
      roe: f.roe ?? null,
      rev: f.revenue_growth ?? null,
      dy: f.dividend_yield ?? f.dividend_yield_pct ?? null,
      debt: f.debt_to_equity ?? null,
    };
  });
  return computeSHA256(JSON.stringify(canonicalData));
}

/**
 * Compute reproducible hash of the selected strategy config
 */
export async function computeStrategyConfigHash(strategyId: string, strategyLabel: string): Promise<string> {
  return computeSHA256(JSON.stringify({ strategyId, strategyLabel, modelVersion: CANONICAL_MODEL_VERSION }));
}

/**
 * Compute reproducible hash of the ranked outcome list
 */
export async function computeResultHash(
  results: { symbol: string; winRatePct: number; normalizedScore: number; rank: number }[]
): Promise<string> {
  const canonicalResults = results.map(r => ({
    r: r.rank,
    s: r.symbol.replace(/\.(TW|TWO)$/, ""),
    w: Number(r.winRatePct.toFixed(2)),
    n: Number(r.normalizedScore.toFixed(3)),
  }));
  return computeSHA256(JSON.stringify(canonicalResults));
}
