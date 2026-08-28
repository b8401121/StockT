/**
 * Deterministic Canonical JSON Serializer & Hasher
 * 
 * Complies with RFC 8785 (JSON Canonicalization Scheme):
 * - Keys sorted lexicographically
 * - No insignificant whitespace
 * - Deterministic representation of numbers, booleans, arrays, objects
 */

import crypto from "crypto";

/**
 * 遞迴將任意 JavaScript 物件/值轉換為確定性（Deterministic）標準化 JSON 字串
 */
export function canonicalizeJson(value: any): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJson(item));
    return `[${items.join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  const pairs = keys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(value[k])}`);

  return `{${pairs.join(",")}}`;
}

/**
 * 計算物件之 Canonical SHA-256 雜湊
 */
export function computeCanonicalSha256(value: any): string {
  const canonicalStr = canonicalizeJson(value);
  return crypto.createHash("sha256").update(canonicalStr, "utf-8").digest("hex");
}
