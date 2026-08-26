// ─────────────────────────────────────────────────────────────────────────────
// Firebase 初始化 — 阿山股市終端機 雲端帳號系統
// ─────────────────────────────────────────────────────────────────────────────
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  User,
  Auth,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  onSnapshot,
  Firestore,
} from "firebase/firestore";

// ⚙️ StockT 專用 Firebase 設定（由開發者建立並維護的免費共用專案）
const firebaseConfig = {
  apiKey: "AIzaSyDkdWD1DpoLWJY2eJJ0HZs-3sRCDj947nA",
  authDomain: "stockt-b8401121.firebaseapp.com",
  projectId: "stockt-b8401121",
  storageBucket: "stockt-b8401121.firebasestorage.app",
  messagingSenderId: "328586757109",
  appId: "1:328586757109:web:451433d7fd36fcb24896bc",
  measurementId: "G-8MWNYJ5DFP",
};

let app: FirebaseApp;
let auth: Auth;
let db: Firestore;

try {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
  auth = getAuth(app);
  db = getFirestore(app);
} catch (e) {
  console.error("[Firebase] Init error:", e);
}

// 帳號名稱 → Firebase email（內部格式，用戶看不到）
function toEmail(username: string): string {
  const safe = username.trim().replace(/\s+/g, "_").replace(/[^\w\u4e00-\u9fff.-]/g, "");
  return `${safe}@stockt.app`;
}

export function getFirebaseAuth(): Auth { return auth; }
export function getFirebaseDb(): Firestore { return db; }

/** 建立新帳號 */
export async function registerUser(username: string, password: string): Promise<User> {
  const email = toEmail(username);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    // 初始化空白自選股清單到 Firestore
    await setDoc(doc(db, "watchlists", cred.user.uid), {
      username,
      lists: { "我的自選股": [] },
      updatedAt: new Date().toISOString(),
    });
    return cred.user;
  } catch (err: any) {
    if (err?.code === "auth/email-already-in-use") {
      throw new Error("此帳號名稱已被使用，請換一個或直接切換到「登入帳號」！");
    }
    throw err;
  }
}

/** 登入 */
export async function loginUser(username: string, password: string): Promise<User> {
  const email = toEmail(username);
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

/** 登出 */
export async function logoutUser(): Promise<void> {
  await signOut(auth);
}

/** 監聽登入狀態 */
export function onAuthChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

/** 載入雲端收藏名單 */
export async function loadWatchlistFromCloud(uid: string): Promise<{ lists: Record<string, any[]>; username: string }> {
  const snap = await getDoc(doc(db, "watchlists", uid));
  if (snap.exists()) {
    const data = snap.data();
    return {
      lists: data.lists ?? { "我的自選股": [] },
      username: data.username ?? "",
    };
  }
  return { lists: { "我的自選股": [] }, username: "" };
}

/** 儲存收藏名單到雲端 */
export async function saveWatchlistToCloud(uid: string, username: string, lists: Record<string, any[]>): Promise<void> {
  await setDoc(doc(db, "watchlists", uid), {
    username,
    lists,
    updatedAt: new Date().toISOString(),
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("stockt_watchlist_updated", { detail: { lists } }));
  }
}

/** 將特定股票加入用戶的自選股清單（雲端同步） */
export async function addStockToUserWatchlist(
  symbol: string,
  listName = "我的自選股",
  price = 0,
  shares = 1000
): Promise<{ success: boolean; message: string }> {
  const user = auth.currentUser;
  if (!user) {
    return { success: false, message: "🔒 請先登入帳號以啟用雲端收藏功能！" };
  }
  const cleanSym = symbol.trim().toUpperCase();
  try {
    const { lists, username } = await loadWatchlistFromCloud(user.uid);
    const targetList = lists[listName] ? [...lists[listName]] : [];
    const exists = targetList.some((it: any) => (typeof it === "string" ? it === cleanSym : it.symbol === cleanSym));
    if (exists) {
      return { success: true, message: `ℹ️【${cleanSym}】已在您的「${listName}」收藏清單中！` };
    }
    targetList.push({
      symbol: cleanSym,
      date: new Date().toISOString().slice(0, 10),
      price: price || 0,
      shares: shares || 1000,
    });
    const updatedLists = { ...lists, [listName]: targetList };
    await saveWatchlistToCloud(user.uid, username, updatedLists);
    return { success: true, message: `🎉 已成功將【${cleanSym}】加入「${listName}」！` };
  } catch (err: any) {
    console.error("Add to watchlist error:", err);
    return { success: false, message: `收藏失敗：${err?.message || err}` };
  }
}

/** 實時監聽用戶收藏名單變更 */
export function subscribeWatchlist(
  uid: string,
  callback: (data: { lists: Record<string, any[]>; username: string }) => void
): () => void {
  const unsub = onSnapshot(
    doc(db, "watchlists", uid),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        callback({
          lists: data.lists ?? { "我的自選股": [] },
          username: data.username ?? "",
        });
      } else {
        callback({ lists: { "我的自選股": [] }, username: "" });
      }
    },
    (err) => {
      console.error("Watchlist snapshot error:", err);
    }
  );
  return unsub;
}
