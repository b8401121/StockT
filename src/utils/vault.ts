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
 * 測試 GitHub Token 與倉庫連線
 */
export async function testGitHubConnection(cfg: GitHubSyncConfig): Promise<{ success: boolean; message: string; user?: string }> {
  const token = cfg.token.trim().replace(/^(token|Bearer)\s+/i, "");
  if (!token) throw new Error("請先輸入 GitHub Personal Access Token (PAT)");
  if (!cfg.repo.trim()) throw new Error("請輸入 GitHub 倉庫名稱 (例如: b8401121/StockT)");

  // 1. 驗證 Token 身份
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!userRes.ok) {
    if (userRes.status === 401) {
      throw new Error("GitHub Token 無效或已過期，請重新確認！");
    }
    throw new Error(`GitHub 驗證失敗 (${userRes.status}): ${await userRes.text()}`);
  }

  const userData = await userRes.json();

  // 2. 驗證倉庫存取權限
  const repoRes = await fetch(`https://api.github.com/repos/${cfg.repo.trim()}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (!repoRes.ok) {
    if (repoRes.status === 404) {
      throw new Error(`找不到倉庫【${cfg.repo.trim()}】，請確認名稱是否正確或 Token 是否具備私有倉庫權限。`);
    }
    if (repoRes.status === 403) {
      throw new Error(`Token 權限不足，無法存取倉庫【${cfg.repo.trim()}】，建立 Token 時需勾選「repo」或「public_repo」！`);
    }
    throw new Error(`倉庫存取失敗 (${repoRes.status}): ${await repoRes.text()}`);
  }

  return {
    success: true,
    message: `連線成功！已成功驗證 GitHub 帳號: @${userData.login}`,
    user: userData.login,
  };
}

/**
 * 將加密檔案推送到 GitHub (使用 GitHub Contents API)
 */
export async function pushEncryptedVaultToGitHub(
  cfg: GitHubSyncConfig,
  payload: EncryptedVaultPayload
): Promise<{ commitUrl?: string }> {
  const token = cfg.token.trim().replace(/^(token|Bearer)\s+/i, "");
  if (!token) throw new Error("缺少 GitHub Token");
  if (!cfg.repo.trim()) throw new Error("缺少 GitHub 倉庫名稱");

  const branch = cfg.branch?.trim() || "main";
  const repo = cfg.repo.trim();
  const filename = `${encodeURIComponent(payload.username.trim())}.vault.json`;
  const path = `vaults/${filename}`;
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;

  // 先查詢現有 SHA (如果檔案已存在)
  let sha: string | undefined;
  try {
    const getRes = await fetch(`${url}?ref=${branch}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (getRes.ok) {
      const getJson = await getRes.json();
      sha = getJson.sha;
    }
  } catch (err) {
    console.warn("Check file sha error:", err);
  }

  const contentStr = JSON.stringify(payload, null, 2);
  const contentBytes = new TextEncoder().encode(contentStr);
  let binary = "";
  for (let i = 0; i < contentBytes.byteLength; i++) {
    binary += String.fromCharCode(contentBytes[i]);
  }
  const contentBase64 = window.btoa(binary);

  const putRes = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      message: `sync: update encrypted portfolio for @${payload.username}`,
      content: contentBase64,
      branch: branch,
      sha: sha,
    }),
  });

  if (!putRes.ok) {
    let errText = await putRes.text();
    try {
      const errObj = JSON.parse(errText);
      errText = errObj.message || errText;
    } catch {}

    if (putRes.status === 401) throw new Error("GitHub Token 驗證失敗 (401)，請檢查 Token 是否正確！");
    if (putRes.status === 404) throw new Error(`找不到倉庫【${repo}】或分支【${branch}】(404)`);
    if (putRes.status === 403 || putRes.status === 422) throw new Error(`GitHub 寫入被拒絕: ${errText} (請確認 Token 是否具備 repo 寫入權限)`);
    throw new Error(`GitHub 同步失敗 (${putRes.status}): ${errText}`);
  }

  const resJson = await putRes.json();
  return { commitUrl: resJson?.commit?.html_url };
}

/**
 * 從 GitHub 下載特定使用者的加密檔案
 */
export async function fetchEncryptedVaultFromGitHub(
  cfg: GitHubSyncConfig,
  username: string
): Promise<EncryptedVaultPayload> {
  const token = cfg.token.trim().replace(/^(token|Bearer)\s+/i, "");
  const branch = cfg.branch?.trim() || "main";
  const repo = cfg.repo.trim();
  const filename = `${encodeURIComponent(username.trim())}.vault.json`;
  const path = `vaults/${filename}`;
  const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers });

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`在 GitHub 倉庫【${repo}】中找不到使用者【${username}】的雲端檔案 (vaults/${filename})。請確認是否已備份過。`);
    }
    const errText = await res.text();
    throw new Error(`從 GitHub 下載失敗 (${res.status}): ${errText}`);
  }

  const json = await res.json();
  const rawBase64 = (json.content || "").replace(/\s/g, "");
  const binary = window.atob(rawBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const rawText = new TextDecoder().decode(bytes);
  return JSON.parse(rawText) as EncryptedVaultPayload;
}
