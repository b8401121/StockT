import React, { useState, useEffect } from "react";
import {
  getLocalVaultUsers,
  loadUserVault,
  saveUserVault,
  getGitHubSyncConfig,
  saveGitHubSyncConfig,
  testGitHubConnection,
  VaultUser,
} from "../utils/vault";

interface AuthScreenProps {
  onLoginSuccess: (username: string, password: string) => void;
  onGuestMode: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLoginSuccess, onGuestMode }) => {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");

  // GitHub 同步設定
  const [githubToken, setGithubToken] = useState("");
  const [githubRepo, setGithubRepo] = useState("b8401121/StockT");
  const [showGithubSettings, setShowGithubSettings] = useState(false);

  const [vaultUsers, setVaultUsers] = useState<VaultUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);

  useEffect(() => {
    setVaultUsers(getLocalVaultUsers());
    const savedGithub = getGitHubSyncConfig();
    if (savedGithub) {
      if (savedGithub.token) setGithubToken(savedGithub.token);
      if (savedGithub.repo) setGithubRepo(savedGithub.repo);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    if (!u) {
      setStatusMsg({ type: "error", text: "請輸入使用者名稱" });
      return;
    }
    if (!password) {
      setStatusMsg({ type: "error", text: "請輸入登入密碼" });
      return;
    }

    setLoading(true);
    setStatusMsg({ type: "info", text: "正在驗證身份與解密個人資料..." });

    try {
      // 儲存 GitHub 設定 (若有輸入)
      if (githubToken.trim() && githubRepo.trim()) {
        saveGitHubSyncConfig({
          token: githubToken.trim(),
          repo: githubRepo.trim(),
          branch: "main",
        });
      }

      // 優先嘗試從 GitHub 雲端還原（若有 Token），若無或失敗則從本地保險箱解密
      const hasGithub = !!(githubToken.trim() && githubRepo.trim());
      await loadUserVault(u, password, hasGithub);

      sessionStorage.setItem("stockt_auth_user", u);
      sessionStorage.setItem("stockt_auth_pass", password);

      setStatusMsg({ type: "success", text: `🎉 歡迎回來，【${u}】！登入成功。` });
      setTimeout(() => {
        onLoginSuccess(u, password);
      }, 600);
    } catch (err: any) {
      const msg = String(err.message || err);
      setStatusMsg({ type: "error", text: msg });
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    if (!u) {
      setStatusMsg({ type: "error", text: "請設定使用者名稱" });
      return;
    }
    if (!password) {
      setStatusMsg({ type: "error", text: "請設定專屬密碼" });
      return;
    }
    if (password !== passwordConfirm) {
      setStatusMsg({ type: "error", text: "兩次輸入的密碼不一致，請重新確認！" });
      return;
    }

    setLoading(true);
    setStatusMsg({ type: "info", text: "正在建立 AES-256 加密保險箱..." });

    try {
      // 儲存 GitHub 設定
      if (githubToken.trim() && githubRepo.trim()) {
        saveGitHubSyncConfig({
          token: githubToken.trim(),
          repo: githubRepo.trim(),
          branch: "main",
        });
      }

      // 初始化完全空白的乾淨自選股清單
      const emptyWatchlist = {};
      await saveUserVault(u, password, emptyWatchlist, true);

      sessionStorage.setItem("stockt_auth_user", u);
      sessionStorage.setItem("stockt_auth_pass", password);

      setStatusMsg({ type: "success", text: `🎉 帳號【${u}】建立成功！已同步初始化。` });
      setTimeout(() => {
        onLoginSuccess(u, password);
      }, 600);
    } catch (err: any) {
      setStatusMsg({ type: "error", text: `建立失敗: ${err.message || err}` });
    } finally {
      setLoading(false);
    }
  };

  const handleTestGithub = async () => {
    if (!githubToken.trim()) {
      setStatusMsg({ type: "error", text: "請先填入 GitHub Token" });
      return;
    }
    setLoading(true);
    setStatusMsg({ type: "info", text: "正在測試 GitHub 連線與權限..." });
    try {
      const res = await testGitHubConnection({
        token: githubToken.trim(),
        repo: githubRepo.trim() || "b8401121/StockT",
        branch: "main",
      });
      saveGitHubSyncConfig({
        token: githubToken.trim(),
        repo: githubRepo.trim() || "b8401121/StockT",
        branch: "main",
      });
      setStatusMsg({ type: "success", text: `✅ ${res.message}` });
    } catch (err: any) {
      setStatusMsg({ type: "error", text: `❌ 連線失敗: ${err.message || err}` });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "radial-gradient(circle at center, #1b1f2e 0%, #0d0f17 100%)",
      display: "flex", justifyContent: "center", alignItems: "center",
      zIndex: 99999, padding: "20px", color: "#fff"
    }}>
      <div style={{
        background: "rgba(22, 26, 38, 0.85)",
        backdropFilter: "blur(16px)",
        borderRadius: "20px",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        boxShadow: "0 20px 60px rgba(0, 0, 0, 0.7)",
        width: "480px", maxWidth: "100%",
        padding: "36px 32px",
        display: "flex", flexDirection: "column", gap: "20px"
      }}>
        {/* 頂部 LOGO 與標題 */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2.8rem", marginBottom: "8px" }}>⛰️</div>
          <h1 style={{ margin: "0 0 6px 0", fontSize: "1.6rem", fontWeight: 800, letterSpacing: "1px", background: "linear-gradient(135deg, #64b5f6, #42a5f5)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            阿山股市終端機 v2.0
          </h1>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "rgba(255, 255, 255, 0.6)" }}>
            端對端 AES-256 加密 ｜ GitHub 跨裝置雲端同步
          </p>
        </div>

        {/* Tab 切換：登入 / 註冊 */}
        <div style={{
          display: "flex", background: "rgba(255, 255, 255, 0.05)",
          borderRadius: "10px", padding: "4px"
        }}>
          <button
            type="button"
            style={{
              flex: 1, padding: "10px", border: "none", borderRadius: "8px",
              background: tab === "login" ? "var(--accent-blue)" : "transparent",
              color: tab === "login" ? "#fff" : "rgba(255, 255, 255, 0.6)",
              fontWeight: 700, cursor: "pointer", fontSize: "0.95rem", transition: "all 0.2s"
            }}
            onClick={() => { setTab("login"); setStatusMsg(null); }}
          >
            🔑 登入個人帳號
          </button>
          <button
            type="button"
            style={{
              flex: 1, padding: "10px", border: "none", borderRadius: "8px",
              background: tab === "register" ? "#4caf50" : "transparent",
              color: tab === "register" ? "#fff" : "rgba(255, 255, 255, 0.6)",
              fontWeight: 700, cursor: "pointer", fontSize: "0.95rem", transition: "all 0.2s"
            }}
            onClick={() => { setTab("register"); setStatusMsg(null); }}
          >
            ✨ 註冊新帳號
          </button>
        </div>

        {/* 狀態 / 錯誤訊息提示條 */}
        {statusMsg && (
          <div style={{
            background: statusMsg.type === "error" ? "rgba(255, 82, 82, 0.15)" : statusMsg.type === "success" ? "rgba(76, 175, 80, 0.15)" : "rgba(33, 150, 243, 0.15)",
            border: `1px solid ${statusMsg.type === "error" ? "rgba(255, 82, 82, 0.4)" : statusMsg.type === "success" ? "rgba(76, 175, 80, 0.4)" : "rgba(33, 150, 243, 0.4)"}`,
            color: statusMsg.type === "error" ? "#ff8a80" : statusMsg.type === "success" ? "#a5d6a7" : "#90caf9",
            borderRadius: "8px", padding: "10px 14px", fontSize: "0.85rem", lineHeight: 1.4
          }}>
            {statusMsg.text}
          </div>
        )}

        {/* 登入 / 註冊 表單 */}
        <form onSubmit={tab === "login" ? handleLogin : handleRegister} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.82rem", color: "rgba(255, 255, 255, 0.7)", marginBottom: "6px" }}>
              👤 使用者名稱 (帳號)
            </label>
            {tab === "login" && vaultUsers.length > 0 ? (
              <div style={{ display: "flex", gap: "8px" }}>
                <input
                  type="text" className="input-field" placeholder="請輸入使用者名稱"
                  value={username} onChange={(e) => setUsername(e.target.value)}
                  style={{ flex: 1, padding: "10px 12px", fontSize: "0.9rem" }} required
                />
                <select
                  className="select-field"
                  onChange={(e) => e.target.value && setUsername(e.target.value)}
                  style={{ width: "130px", fontSize: "0.82rem" }}
                >
                  <option value="">本機帳號...</option>
                  {vaultUsers.map((u) => <option key={u.username} value={u.username}>{u.username}</option>)}
                </select>
              </div>
            ) : (
              <input
                type="text" className="input-field" placeholder="例如: 小李 / Alice"
                value={username} onChange={(e) => setUsername(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", fontSize: "0.9rem" }} required
              />
            )}
          </div>

          <div>
            <label style={{ display: "block", fontSize: "0.82rem", color: "rgba(255, 255, 255, 0.7)", marginBottom: "6px" }}>
              🔒 專屬解密密碼
            </label>
            <input
              type="password" className="input-field" placeholder="請輸入您的密碼"
              value={password} onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", fontSize: "0.9rem" }} required
            />
          </div>

          {tab === "register" && (
            <div>
              <label style={{ display: "block", fontSize: "0.82rem", color: "rgba(255, 255, 255, 0.7)", marginBottom: "6px" }}>
                🔒 再次確認密碼
              </label>
              <input
                type="password" className="input-field" placeholder="請再次輸入密碼以確認"
                value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", fontSize: "0.9rem" }} required
              />
            </div>
          )}

          {/* GitHub 跨裝置同步選單 (摺疊) */}
          <div style={{
            background: "rgba(255, 255, 255, 0.03)", border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "10px", padding: "12px", marginTop: "4px"
          }}>
            <div
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer" }}
              onClick={() => setShowGithubSettings(!showGithubSettings)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.85rem", color: "#64b5f6", fontWeight: 600 }}>
                <span>☁️</span>
                <span>GitHub 跨裝置雲端同步設定</span>
              </div>
              <span style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.5)" }}>
                {showGithubSettings ? "▲ 收合" : "▼ 展開設定 (換電腦必填)"}
              </span>
            </div>

            {showGithubSettings && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px", paddingTop: "10px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.6)", lineHeight: 1.4 }}>
                  填入 GitHub Token 後，在<b>任何電腦或手機</b>只要輸入同一個帳號密碼，系統就會自動從 GitHub 下載您的加密檔案並解密還原！
                </div>
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                    <label style={{ fontSize: "0.75rem", color: "rgba(255,255,255,0.6)" }}>GitHub Token (PAT)</label>
                    <a href="https://github.com/settings/tokens/new?scopes=repo&description=StockT-Portfolio-Sync" target="_blank" rel="noreferrer" style={{ fontSize: "0.72rem", color: "#64b5f6" }}>
                      🔗 點此建立 Token
                    </a>
                  </div>
                  <input
                    type="password" className="input-field" placeholder="ghp_xxxxxxxxxxxxxx"
                    value={githubToken} onChange={(e) => setGithubToken(e.target.value)}
                    style={{ width: "100%", padding: "6px 8px", fontSize: "0.82rem" }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: "0.75rem", color: "rgba(255,255,255,0.6)", marginBottom: "4px" }}>GitHub 倉庫名稱</label>
                  <input
                    type="text" className="input-field" placeholder="b8401121/StockT"
                    value={githubRepo} onChange={(e) => setGithubRepo(e.target.value)}
                    style={{ width: "100%", padding: "6px 8px", fontSize: "0.82rem" }}
                  />
                </div>
                <button type="button" className="btn btn-outline btn-sm" onClick={handleTestGithub} disabled={loading} style={{ alignSelf: "flex-start", fontSize: "0.75rem" }}>
                  🔍 測試 GitHub 連線
                </button>
              </div>
            )}
          </div>

          <button
            type="submit"
            className={`btn ${tab === "login" ? "btn-primary" : "btn-success"}`}
            style={{ width: "100%", padding: "12px", fontSize: "1rem", fontWeight: 700, marginTop: "6px", borderRadius: "10px" }}
            disabled={loading}
          >
            {loading ? <span className="loading-spinner" /> : (tab === "login" ? "🚀 登入並解鎖專屬投資組合" : "✨ 建立帳號並登入")}
          </button>
        </form>

        {/* 訪客通道 */}
        <div style={{ textAlign: "center", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "14px" }}>
          <button
            type="button"
            onClick={onGuestMode}
            style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.5)", fontSize: "0.82rem", cursor: "pointer", textDecoration: "underline" }}
          >
            👀 暫不登入，以訪客模式體驗（僅看盤與AI選股）
          </button>
        </div>
      </div>
    </div>
  );
};
