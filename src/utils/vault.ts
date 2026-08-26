// ─────────────────────────────────────────────────────────────────────────────
// 多用戶加密保險箱管理器 (Vault Manager & GitHub Sync)
// ─────────────────────────────────────────────────────────────────────────────

import { EncryptedVaultPayload, encryptVault, decryptVault } from "./crypto";

export interface VaultUser {
  username: string;
  lastUpdated: string;
}

export interface GitHubSyncConfig {
  token: string;
  repo: string;    // e.g. "b8401121/StockT"
  branch?: string; // default "main"
}

const VAULT_USERS_KEY = "stockt_vault_users_index";
const GITHUB_CONFIG_KEY = "stockt_github_sync_config";

/**
 * 取得本機所有註冊過的使用者列表
 */
export function getLocalVaultUsers(): VaultUser[] {
  try {
    const raw = localStorage.getItem(VAULT_USERS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (e) {
    console.warn(e);
  }
  return [];
}

/**
 * 儲存/更新使用者索引
 */
function recordVaultUser(username: string) {
  const users = getLocalVaultUsers().filter((u) => u.username !== username);
  users.unshift({
    username,
    lastUpdated: new Date().toISOString(),
  });
  localStorage.setItem(VAULT_USERS_KEY, JSON.stringify(users));
}

/**
 * 取得 GitHub 同步設定
 */
export function getGitHubSyncConfig(): GitHubSyncConfig | null {
  try {
    const raw = localStorage.getItem(GITHUB_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

/**
 * 儲存 GitHub 同步設定
 */
export function saveGitHubSyncConfig(cfg: GitHubSyncConfig | null) {
  if (!cfg) {
    localStorage.removeItem(GITHUB_CONFIG_KEY);
  } else {
    localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(cfg));
  }
}

/**
 * 儲存加密保險箱到本機 (以及 GitHub，若有設定)
 */
export async function saveUserVault(
  username: string,
  password: string,
  portfolioData: any,
  syncToGithub = true
): Promise<EncryptedVaultPayload> {
  const payload = await encryptVault(portfolioData, password, username);
  
  // 1. 存入本機 localStorage
  localStorage.setItem(`stockt_vault_${username}`, JSON.stringify(payload));
  recordVaultUser(username);

  // 2. 若設定了 GitHub Token 則非同步推送加密檔案到 GitHub 倉庫
  if (syncToGithub) {
    const cfg = getGitHubSyncConfig();
    if (cfg && cfg.token && cfg.repo) {
      pushEncryptedVaultToGitHub(cfg, payload).catch((err) => {
        console.warn("[GitHub Sync Error]:", err);
      });
    }
  }

  return payload;
}

/**
 * 載入並解密使用者的投資組合
 */
export async function loadUserVault<T = any>(
  username: string,
  password: string,
  tryGithubFirst = false
): Promise<{ data: T; payload: EncryptedVaultPayload }> {
  let payload: EncryptedVaultPayload | null = null;

  // 1. 若開啟了 GitHub 優先同步，嘗試從 GitHub 抓取最新加密檔
  if (tryGithubFirst) {
    const cfg = getGitHubSyncConfig();
    if (cfg && cfg.token && cfg.repo) {
      try {
        payload = await fetchEncryptedVaultFromGitHub(cfg, username);
      } catch (e) {
        console.warn("[GitHub fetch failed, fallback to local]:", e);
      }
    }
  }

  // 2. 若無 GitHub 檔案則從本機讀取
  if (!payload) {
    const raw = localStorage.getItem(`stockt_vault_${username}`);
    if (!raw) {
      throw new Error(`找不到使用者【${username}】的加密檔案。若是首次使用請點擊「建立新帳號」！`);
    }
    payload = JSON.parse(raw);
  }

  if (!payload) {
    throw new Error("無效的加密資料");
  }

  // 3. 解密
  const data = await decryptVault<T>(payload, password);
  return { data, payload };
}

/**
 * 將加密檔案推送到 GitHub (使用 GitHub Contents API)
 */
export async function pushEncryptedVaultToGitHub(
  cfg: GitHubSyncConfig,
  payload: EncryptedVaultPayload
): Promise<void> {
  const branch = cfg.branch || "main";
  const path = `vaults/${encodeURIComponent(payload.username)}.vault.json`;
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${path}`;

  // 先查詢現有 SHA (如果檔案已存在)
  let sha: string | undefined;
  try {
    const getRes = await fetch(`${url}?ref=${branch}`, {
      headers: {
        Authorization: `token ${cfg.token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });
    if (getRes.ok) {
      const getJson = await getRes.json();
      sha = getJson.sha;
    }
  } catch {}

  const contentStr = JSON.stringify(payload, null, 2);
  const contentBase64 = window.btoa(unescape(encodeURIComponent(contentStr)));

  const putRes = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: `sync: update encrypted vault for ${payload.username}`,
      content: contentBase64,
      branch: branch,
      sha: sha,
    }),
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`GitHub 同步失敗: ${err}`);
  }
}

/**
 * 從 GitHub 下載特定使用者的加密檔案
 */
export async function fetchEncryptedVaultFromGitHub(
  cfg: GitHubSyncConfig,
  username: string
): Promise<EncryptedVaultPayload> {
  const branch = cfg.branch || "main";
  const path = `vaults/${encodeURIComponent(username)}.vault.json`;
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${path}?ref=${branch}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!res.ok) {
    throw new Error(`無法從 GitHub 找到使用者【${username}】的雲端存檔。`);
  }

  const json = await res.json();
  const rawText = decodeURIComponent(escape(window.atob(json.content.replace(/\s/g, ""))));
  return JSON.parse(rawText) as EncryptedVaultPayload;
}
