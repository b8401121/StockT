// ─────────────────────────────────────────────────────────────────────────────
// 端對端 Web Crypto API 加密核心模組 (AES-GCM-256 + PBKDF2)
// ─────────────────────────────────────────────────────────────────────────────

export interface EncryptedVaultPayload {
  version: number;
  username: string;
  salt: string;       // Hex encoded 16 bytes
  iv: string;         // Hex encoded 12 bytes
  ciphertext: string; // Base64 encoded encrypted JSON
  updated_at: string; // ISO String
}

// 輔助函式：Buffer 轉 Hex
function buf2hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 輔助函式：Hex 轉 Uint8Array
function hex2buf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

// 輔助函式：Uint8Array 轉 Base64
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

// 輔助函式：Base64 轉 Uint8Array
function base64ToUint8(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * 透過 PBKDF2 從密碼衍生 AES-GCM-256 密鑰
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * 加密投資組合資料
 */
export async function encryptVault(
  data: any,
  password: string,
  username: string
): Promise<EncryptedVaultPayload> {
  const enc = new TextEncoder();
  const jsonStr = JSON.stringify(data);
  const plainBytes = enc.encode(jsonStr);

  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const key = await deriveKey(password, salt);

  const cipherBuffer = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as unknown as BufferSource,
    },
    key,
    plainBytes as unknown as BufferSource
  );

  return {
    version: 1,
    username: username.trim(),
    salt: buf2hex(salt.buffer),
    iv: buf2hex(iv.buffer),
    ciphertext: uint8ToBase64(new Uint8Array(cipherBuffer)),
    updated_at: new Date().toISOString(),
  };
}

/**
 * 解密投資組合資料
 */
export async function decryptVault<T = any>(
  payload: EncryptedVaultPayload,
  password: string
): Promise<T> {
  if (!payload || !payload.salt || !payload.iv || !payload.ciphertext) {
    throw new Error("無效的加密資料格式");
  }

  const salt = hex2buf(payload.salt);
  const iv = hex2buf(payload.iv);
  const cipherBytes = base64ToUint8(payload.ciphertext);

  const key = await deriveKey(password, salt);

  try {
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: iv as unknown as BufferSource,
      },
      key,
      cipherBytes as unknown as BufferSource
    );

    const dec = new TextDecoder();
    const jsonStr = dec.decode(decryptedBuffer);
    return JSON.parse(jsonStr) as T;
  } catch (err) {
    throw new Error("密碼錯誤或資料已被竄改，無法解密！");
  }
}
