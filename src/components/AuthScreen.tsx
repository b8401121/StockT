import React, { useState } from "react";
import { registerUser, loginUser } from "../utils/firebase";

interface AuthScreenProps {
  onLoginSuccess: (username: string) => void;
  onGuestMode: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onLoginSuccess, onGuestMode }) => {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: "error" | "success" | "info"; text: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    if (!u) { setStatusMsg({ type: "error", text: "請輸入帳號名稱" }); return; }
    if (!password) { setStatusMsg({ type: "error", text: "請輸入密碼" }); return; }
    if (password.length < 6) { setStatusMsg({ type: "error", text: "密碼至少需要 6 個字元" }); return; }
    if (tab === "register" && password !== passwordConfirm) {
      setStatusMsg({ type: "error", text: "兩次輸入的密碼不一致" }); return;
    }

    setLoading(true);
    setStatusMsg({ type: "info", text: tab === "login" ? "🔐 登入驗證中..." : "✨ 建立帳號中..." });

    try {
      if (tab === "register") {
        await registerUser(u, password);
      } else {
        await loginUser(u, password);
      }
      setStatusMsg({ type: "success", text: `🎉 歡迎，【${u}】！` });
      setTimeout(() => onLoginSuccess(u), 600);
    } catch (err: any) {
      const code = err?.code ?? "";
      let msg = err?.message ?? String(err);
      if (code === "auth/email-already-in-use") msg = "此帳號名稱已被使用，請換一個或直接登入";
      else if (code === "auth/user-not-found" || code === "auth/invalid-credential") msg = "帳號不存在或密碼錯誤";
      else if (code === "auth/wrong-password") msg = "密碼錯誤，請重新確認";
      else if (code === "auth/network-request-failed") msg = "網路連線失敗，請確認網路狀態";
      setStatusMsg({ type: "error", text: msg });
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
        background: "rgba(22, 26, 38, 0.92)",
        backdropFilter: "blur(16px)",
        borderRadius: "20px",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        boxShadow: "0 20px 60px rgba(0, 0, 0, 0.7)",
        width: "420px", maxWidth: "100%",
        padding: "36px 32px",
        display: "flex", flexDirection: "column", gap: "20px"
      }}>
        {/* Logo */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "2.8rem", marginBottom: "8px" }}>⛰️</div>
          <h1 style={{
            margin: "0 0 6px 0", fontSize: "1.5rem", fontWeight: 800,
            background: "linear-gradient(135deg, #64b5f6, #42a5f5)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent"
          }}>
            阿山股市終端機 v2.0
          </h1>
          <p style={{ margin: 0, fontSize: "0.82rem", color: "rgba(255,255,255,0.5)" }}>
            雲端同步 ｜ 個人收藏名單
          </p>
        </div>

        {/* Tab */}
        <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", borderRadius: "10px", padding: "4px" }}>
          {(["login", "register"] as const).map((t) => (
            <button key={t} type="button"
              style={{
                flex: 1, padding: "10px", border: "none", borderRadius: "8px",
                background: tab === t ? (t === "login" ? "var(--accent-blue)" : "#4caf50") : "transparent",
                color: tab === t ? "#fff" : "rgba(255,255,255,0.6)",
                fontWeight: 700, cursor: "pointer", fontSize: "0.92rem", transition: "all 0.2s"
              }}
              onClick={() => { setTab(t); setStatusMsg(null); }}
            >
              {t === "login" ? "🔑 登入帳號" : "✨ 建立帳號"}
            </button>
          ))}
        </div>

        {/* 狀態訊息 */}
        {statusMsg && (
          <div style={{
            background: statusMsg.type === "error" ? "rgba(255,82,82,0.12)" : statusMsg.type === "success" ? "rgba(76,175,80,0.12)" : "rgba(33,150,243,0.12)",
            border: `1px solid ${statusMsg.type === "error" ? "rgba(255,82,82,0.4)" : statusMsg.type === "success" ? "rgba(76,175,80,0.4)" : "rgba(33,150,243,0.4)"}`,
            color: statusMsg.type === "error" ? "#ff8a80" : statusMsg.type === "success" ? "#a5d6a7" : "#90caf9",
            borderRadius: "8px", padding: "10px 14px", fontSize: "0.85rem", lineHeight: 1.4
          }}>
            {statusMsg.text}
          </div>
        )}

        {/* 表單 */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div>
            <label style={{ display: "block", fontSize: "0.82rem", color: "rgba(255,255,255,0.7)", marginBottom: "6px" }}>
              👤 帳號名稱
            </label>
            <input
              type="text" className="input-field" placeholder="輸入您的帳號名稱（如：小李、Alan）"
              value={username} onChange={(e) => setUsername(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", fontSize: "0.9rem", boxSizing: "border-box" }}
              required autoFocus
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "0.82rem", color: "rgba(255,255,255,0.7)", marginBottom: "6px" }}>
              🔒 密碼（至少 6 個字元）
            </label>
            <input
              type="password" className="input-field" placeholder="請輸入密碼"
              value={password} onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%", padding: "10px 12px", fontSize: "0.9rem", boxSizing: "border-box" }}
              required
            />
          </div>
          {tab === "register" && (
            <div>
              <label style={{ display: "block", fontSize: "0.82rem", color: "rgba(255,255,255,0.7)", marginBottom: "6px" }}>
                🔒 確認密碼
              </label>
              <input
                type="password" className="input-field" placeholder="請再次輸入密碼"
                value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", fontSize: "0.9rem", boxSizing: "border-box" }}
                required
              />
            </div>
          )}
          <button
            type="submit"
            className={`btn ${tab === "login" ? "btn-primary" : "btn-success"}`}
            style={{ width: "100%", padding: "12px", fontSize: "1rem", fontWeight: 700, borderRadius: "10px", marginTop: "4px" }}
            disabled={loading}
          >
            {loading ? "⏳ 處理中..." : (tab === "login" ? "🚀 登入並開啟收藏名單" : "✨ 建立帳號並登入")}
          </button>
        </form>

        {/* 訪客模式 */}
        <div style={{ textAlign: "center", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "14px" }}>
          <button
            type="button" onClick={onGuestMode}
            style={{ background: "transparent", border: "none", color: "rgba(255,255,255,0.45)", fontSize: "0.82rem", cursor: "pointer", textDecoration: "underline" }}
          >
            👀 暫不登入，以訪客模式使用（無法使用收藏功能）
          </button>
        </div>
      </div>
    </div>
  );
};
